import { useCallback } from 'react';
import { useModel } from './ModelContext';

export interface UseChatPlanReturn {
  sendMessage: (topicId: string, content: string, attachments?: string[], senderId?: string) => Promise<void>;
  sendMessageWithAI: (topicId: string, content: string) => Promise<void>;
  getMessages: (topicId: string) => Promise<any[]>;
  deleteMessage: (messageId: string) => Promise<void>;
  getAIPersonIdForTopic: (topicId: string) => string | undefined;
}

export function useChatPlan(): UseChatPlanReturn {
  const model = useModel();

  const sendMessage = useCallback(async (
    topicId: string,
    content: string,
    attachments: string[] = [],
    senderId?: string
  ) => {
    if (!model.chatPlan) {
      throw new Error('ChatPlan not available');
    }

    await model.chatPlan.sendMessage({
      topicId: topicId,
      content,
      attachments,
      senderId
    });
  }, [model]);

  const sendMessageWithAI = useCallback(async (topicId: string, content: string) => {
    if (!model.chatPlan) {
      throw new Error('ChatPlan not available');
    }

    // Send message - AIMessageListener will automatically trigger AI response
    await model.chatPlan.sendMessage({
      topicId: topicId,
      content,
      attachments: []
    });
  }, [model]);

  const getMessages = useCallback(async (topicId: string): Promise<any[]> => {
    if (!model.chatPlan) {
      console.warn('[useChatPlan] ChatPlan not available yet, returning empty messages');
      return [];
    }

    const response = await model.chatPlan.getMessages({ topicId: topicId });
    return response.messages || [];
  }, [model]);

  const deleteMessage = useCallback(async (messageId: string) => {
    if (!model.chatPlan) {
      throw new Error('ChatPlan not available');
    }

    await model.chatPlan.deleteMessage(messageId);
  }, [model]);

  const getAIPersonIdForTopic = useCallback((topicId: string): string | undefined => {
    // Get the AI's personId for this topic (AI has its own identity)
    return model.aiAssistantPlan?.getAIPersonForTopic?.(topicId);
  }, [model]);

  return {
    sendMessage,
    sendMessageWithAI,
    getMessages,
    deleteMessage,
    getAIPersonIdForTopic
  };
}
