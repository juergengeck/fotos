import { useState, useEffect, useCallback, useRef } from 'react';
import { useModel } from './ModelContext';
import type { Topic as RawTopic } from '@refinio/one.models/lib/recipes/ChatRecipes.js';
import type { HashGroup, Person } from '@refinio/one.core/lib/recipes.js';
import { getObject } from '@refinio/one.core/lib/storage-unversioned-objects.js';
import type { SHA256IdHash, SHA256Hash } from '@refinio/one.core/lib/util/type-checks.js';

// Enriched participant with resolved name and LLM flag
export interface EnrichedParticipant {
  id: string;
  name?: string;
  isLLM: boolean;
}

// UI-friendly topic with computed ID hash and enrichment
export interface Topic extends RawTopic {
  id: string; // Computed ID hash for UI usage
  // Enrichment fields (aligned with vger.cube)
  isAITopic?: boolean;
  modelName?: string;
  llmModelId?: string;
  isProcessing?: boolean;
  enrichedParticipants?: EnrichedParticipant[];
}

export interface UseTopicsReturn {
  topics: Topic[];
  isLoading: boolean;
  createTopic: (name: string, isAI?: boolean, llmModelId?: string) => Promise<string>;
  deleteTopic: (topicId: string) => Promise<void>;
  renameTopic: (topicId: string, newName: string) => Promise<void>;
  refreshTopics: () => Promise<void>;
  updateTopicLastMessage: (topicId: string, message: string) => void;
}

export function useTopics(): UseTopicsReturn {
  const model = useModel();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Track processing topics (topicId → Set of AI personIds currently processing)
  const processingTopicsRef = useRef<Map<string, Set<string>>>(new Map());

  /**
   * Resolve participants from Topic.participants HashGroup
   * Returns enriched participants with names and isLLM flag
   */
  const resolveParticipants = useCallback(async (
    topic: RawTopic,
    topicId: string
  ): Promise<EnrichedParticipant[]> => {
    try {
      // Get participant person IDs from HashGroup
      const hashGroup = await getObject<HashGroup<Person>>(topic.participants as SHA256Hash<HashGroup<Person>>);
      if (!hashGroup?.person) return [];

      // Get contacts for name resolution
      const contactsResponse = await model.contactsPlan?.getContacts();
      const contactList = contactsResponse?.data || [];
      const contactMap = new Map(
        contactList.map((c: { personId: string; name: string }) => [c.personId, c])
      );

      // Resolve each participant
      const participants: EnrichedParticipant[] = [];
      for (const personId of hashGroup.person) {
        const personIdStr = String(personId);
        const contact = contactMap.get(personIdStr) as { personId: string; name: string } | undefined;
        const isLLM = model.aiAssistantPlan?.isAIPerson?.(personIdStr as SHA256IdHash<Person>) ?? false;

        participants.push({
          id: personIdStr,
          name: contact?.name || personIdStr.substring(0, 8),
          isLLM,
        });
      }

      return participants;
    } catch (error) {
      console.warn(`[useTopics] Failed to resolve participants for topic ${topicId}:`, error);
      return [];
    }
  }, [model]);

  /**
   * Enrich a topic with AI-related metadata (model name, processing state, participants)
   */
  const enrichTopic = useCallback(async (topic: RawTopic, topicId: string): Promise<Topic> => {
    // Check if AI topic
    const isAITopic = model.aiAssistantPlan?.isAITopic?.(topicId) ?? false;

    // Get model info for AI topics
    let modelName: string | undefined;
    let llmModelId: string | undefined;
    if (isAITopic && model.aiAssistantPlan && model.llmManager) {
      try {
        llmModelId = await model.aiAssistantPlan.getModelIdForTopic(topicId) ?? undefined;
        if (llmModelId) {
          // Get human-readable model name
          const modelInfo = model.llmManager.getModel(llmModelId);
          modelName = modelInfo?.displayName || modelInfo?.name || llmModelId;
        }
      } catch (error) {
        console.warn(`[useTopics] Failed to get model info for topic ${topicId}:`, error);
      }
    }

    // Check if AI is currently processing (tracked via ref)
    const processingAIs = processingTopicsRef.current.get(topicId);
    const isProcessing = processingAIs ? processingAIs.size > 0 : false;

    // Resolve participant names
    const enrichedParticipants = await resolveParticipants(topic, topicId);

    return {
      ...topic,
      id: topicId,
      isAITopic,
      modelName,
      llmModelId,
      isProcessing,
      enrichedParticipants,
    };
  }, [model, resolveParticipants]);

  const loadTopics = useCallback(async () => {
    if (!model.initialized) {
      setIsLoading(true);
      return;
    }

    try {
      if (!model.topicModel) {
        console.warn('[useTopics] TopicModel not available');
        setIsLoading(false);
        return;
      }

      // Use allWithIdHash() to get pre-computed hashes from TopicRegistry
      // This ensures consistency with Model.buildTopicNameCache() which uses the same method
      const topicsWithIds = await model.topicModel.topics.allWithIdHash();
      // Transform and enrich topics using the pre-computed idHash
      const enrichedTopics = await Promise.all(
        topicsWithIds.map(async ({ topic: rawTopic, idHash }: { topic: RawTopic; idHash: unknown }) => {
          return enrichTopic(rawTopic, String(idHash));
        })
      );
      setTopics(enrichedTopics);
    } catch (error) {
      console.error('[useTopics] Error loading topics:', error);
    } finally {
      setIsLoading(false);
    }
  }, [model, enrichTopic]);

  useEffect(() => {
    loadTopics();

    // Subscribe to topic changes
    const disconnectHandler = model.onTopicsChanged(async () => {
      await loadTopics();
    });

    return () => disconnectHandler();
  }, [model, loadTopics]);

  const createTopic = useCallback(async (name: string, isAI: boolean = false, llmModelId?: string): Promise<string> => {
    if (!model.chatPlan) {
      // Provide diagnostic info to help debug initialization issues
      const diagnostics = {
        initialized: model.initialized,
        hasTopicModel: !!model.topicModel,
        hasLeuteModel: !!model.leuteModel,
        hasChannelManager: !!model.channelManager,
      };
      console.error('[useTopics] ChatPlan not available. Diagnostics:', diagnostics);
      throw new Error(`ChatPlan not available (initialized: ${model.initialized})`);
    }

    // For AI conversations, ensure the AI contact exists first (like vger.cube does)
    // This creates the Person/Profile/Someone for the LLM model if it doesn't exist
    if (isAI && llmModelId && model.aiPlan) {
      console.log('[useTopics] Ensuring AI contact exists for model:', llmModelId);
      const contactResult = await model.aiPlan.getOrCreateContact({ modelId: llmModelId });
      if (!contactResult.success) {
        throw new Error(`Failed to create AI contact: ${contactResult.error}`);
      }
      console.log('[useTopics] AI contact ready:', contactResult.data?.personId?.substring(0, 8));
    }

    // ChatPlan uses createConversation, not createTopic
    // Pass llmModelId when creating AI conversations (like vger.cube does)
    const result = await model.chatPlan.createConversation({
      name,
      type: isAI ? 'ai' : 'chat',
      llmModelId,
    });

    if (!result.success || !result.data?.id) {
      throw new Error(result.error || 'Failed to create conversation');
    }

    await loadTopics();
    return result.data.id;
  }, [model, loadTopics]);

  const deleteTopic = useCallback(async (topicId: string) => {
    if (!model.topicModel) {
      throw new Error('TopicModel not available');
    }

    await model.topicModel.deleteTopic(topicId);
    await loadTopics();
  }, [model, loadTopics]);

  const renameTopic = useCallback(async (topicId: string, newName: string) => {
    if (!model.topicModel) {
      throw new Error('TopicModel not available');
    }

    await model.topicModel.renameTopic(topicId, newName);
    await loadTopics();
  }, [model, loadTopics]);

  const updateTopicLastMessage = useCallback((topicId: string, message: string) => {
    setTopics(prev => prev.map(topic =>
      topic.id === topicId ? { ...topic, lastMessage: message } : topic
    ));
  }, []);

  return {
    topics,
    isLoading,
    createTopic,
    deleteTopic,
    renameTopic,
    refreshTopics: loadTopics,
    updateTopicLastMessage
  };
}
