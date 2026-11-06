/**
 * useTopicSummary Hook
 * Fetches and manages summaries for a specific chat topic
 * iOS version - uses Model directly
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useModel } from './ModelContext';

export interface TopicSummary {
  id?: string;
  idHash?: string;
  subject?: string;
  topic: string;
  prose: string;
  content?: string; // Alias for prose
  version?: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface UseTopicSummaryReturn {
  summary: TopicSummary | null;
  history: TopicSummary[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  updateSummary: (content: string, changeReason?: string) => Promise<boolean>;
  generateSummary: () => Promise<boolean>;
}

export function useTopicSummary(topicId: string | null): UseTopicSummaryReturn {
  const model = useModel();

  const [summary, setSummary] = useState<TopicSummary | null>(null);
  const [history, setHistory] = useState<TopicSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs to track and cancel stale requests
  const requestCounter = useRef(0);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch summary using topicAnalysisPlan
  const fetchSummary = useCallback(async () => {
    if (!topicId || !model.initialized) {
      return;
    }

    const currentRequest = ++requestCounter.current;

    try {
      setLoading(true);

      // Check if topicAnalysisPlan exists
      if (!model.topicAnalysisPlan) {
        console.warn('[useTopicSummary] TopicAnalysisPlan not available');
        setLoading(false);
        return;
      }

      console.log('[useTopicSummary] Calling topicAnalysisPlan.getSummary for:', topicId);
      const response = await model.topicAnalysisPlan.getSummary({
        topicId,
        includeHistory: true
      });

      // Only update if this is still the latest request
      if (currentRequest === requestCounter.current) {
        if (response.success && response.data) {
          const current = response.data.current;
          if (current) {
            const transformedSummary: TopicSummary = {
              id: current.id,
              idHash: current.idHash,
              subject: current.subject,
              topic: current.topic || topicId,
              prose: current.prose || current.content || '',
              content: current.content || current.prose,
              version: current.version,
              createdAt: current.createdAt,
              updatedAt: current.updatedAt
            };
            setSummary(transformedSummary);
          } else {
            setSummary(null);
          }

          // Transform history
          if (response.data.history && Array.isArray(response.data.history)) {
            const transformedHistory: TopicSummary[] = response.data.history.map((h: any) => ({
              id: h.id,
              idHash: h.idHash,
              subject: h.subject,
              topic: h.topic || topicId,
              prose: h.prose || h.content || '',
              content: h.content || h.prose,
              version: h.version,
              createdAt: h.createdAt,
              updatedAt: h.updatedAt
            }));
            setHistory(transformedHistory);
          } else {
            setHistory([]);
          }

          setError(null);
        } else {
          setSummary(null);
          setHistory([]);
        }
      }
    } catch (err) {
      if (currentRequest === requestCounter.current) {
        console.error('[useTopicSummary] Fetch error:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch summary');
      }
    } finally {
      if (currentRequest === requestCounter.current) {
        setLoading(false);
      }
    }
  }, [topicId, model]);

  // Load summary when topicId changes
  useEffect(() => {
    setSummary(null);
    setHistory([]);
    setError(null);

    if (!topicId) {
      return;
    }

    // Cancel any pending debounce timer
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    // Debounce the fetch
    debounceTimer.current = setTimeout(() => {
      fetchSummary();
    }, 300);

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [topicId, fetchSummary]);

  // Update summary with provided content
  const updateSummary = useCallback(async (content: string, changeReason?: string): Promise<boolean> => {
    if (!topicId || !model.initialized || !model.topicAnalysisPlan) {
      return false;
    }

    try {
      setLoading(true);

      const response = await model.topicAnalysisPlan.updateSummary({
        topicId,
        content,
        changeReason,
        autoGenerate: false
      });

      if (response.success && response.data?.summary) {
        const updatedSummary: TopicSummary = {
          id: response.data.summary.id,
          idHash: response.data.summary.idHash,
          subject: response.data.summary.subject,
          topic: response.data.summary.topic || topicId,
          prose: response.data.summary.prose || response.data.summary.content || '',
          content: response.data.summary.content || response.data.summary.prose,
          version: response.data.summary.version,
          createdAt: response.data.summary.createdAt,
          updatedAt: response.data.summary.updatedAt
        };
        setSummary(updatedSummary);
        return true;
      }

      return false;
    } catch (err) {
      console.error('[useTopicSummary] Update error:', err);
      setError(err instanceof Error ? err.message : 'Failed to update summary');
      return false;
    } finally {
      setLoading(false);
    }
  }, [topicId, model]);

  // Generate summary using LLM
  const generateSummary = useCallback(async (): Promise<boolean> => {
    if (!topicId || !model.initialized || !model.topicAnalysisPlan) {
      return false;
    }

    try {
      setLoading(true);

      const response = await model.topicAnalysisPlan.updateSummary({
        topicId,
        autoGenerate: true
      });

      if (response.success && response.data?.summary) {
        const generatedSummary: TopicSummary = {
          id: response.data.summary.id,
          idHash: response.data.summary.idHash,
          subject: response.data.summary.subject,
          topic: response.data.summary.topic || topicId,
          prose: response.data.summary.prose || response.data.summary.content || '',
          content: response.data.summary.content || response.data.summary.prose,
          version: response.data.summary.version,
          createdAt: response.data.summary.createdAt,
          updatedAt: response.data.summary.updatedAt
        };
        setSummary(generatedSummary);
        return true;
      }

      return false;
    } catch (err) {
      console.error('[useTopicSummary] Generate error:', err);
      setError(err instanceof Error ? err.message : 'Failed to generate summary');
      return false;
    } finally {
      setLoading(false);
    }
  }, [topicId, model]);

  return {
    summary,
    history,
    loading,
    error,
    refetch: fetchSummary,
    updateSummary,
    generateSummary
  };
}
