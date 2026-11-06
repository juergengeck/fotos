/**
 * useTopicAnalysis Hook
 * Combined hook for all topic analysis features:
 * - Subjects extraction
 * - Keywords extraction
 * - Summaries
 * - Analysis triggering
 *
 * iOS version - uses Model directly
 */

import { useState, useCallback } from 'react';
import { useModel } from './ModelContext';
import { useChatSubjects, ChatSubject } from './useChatSubjects';
import { useChatKeywords, ChatKeyword } from './useChatKeywords';
import { useTopicSummary, TopicSummary } from './useTopicSummary';

export interface AnalysisResult {
  subjects: ChatSubject[];
  keywords: string[];
  summary: TopicSummary | null;
}

export interface UseTopicAnalysisReturn {
  // Subject data
  subjects: ChatSubject[];
  subjectsLoading: boolean;
  subjectsError: string | null;

  // Keyword data
  keywords: ChatKeyword[];
  keywordsLoading: boolean;
  keywordsError: string | null;

  // Summary data
  summary: TopicSummary | null;
  summaryHistory: TopicSummary[];
  summaryLoading: boolean;
  summaryError: string | null;

  // Analysis actions
  analyzeMessages: (messages?: any[]) => Promise<AnalysisResult | null>;
  analyzing: boolean;

  // Refresh actions
  refreshAll: () => Promise<void>;

  // Change detection
  subjectsJustAppeared: boolean;
  keywordsJustAppeared: boolean;
}

export function useTopicAnalysis(topicId: string | null): UseTopicAnalysisReturn {
  const model = useModel();

  // Use individual hooks
  const {
    subjects,
    loading: subjectsLoading,
    error: subjectsError,
    refetch: refetchSubjects,
    subjectsJustAppeared
  } = useChatSubjects(topicId);

  const {
    keywords,
    loading: keywordsLoading,
    error: keywordsError,
    refetch: refetchKeywords,
    keywordsJustAppeared
  } = useChatKeywords(topicId);

  const {
    summary,
    history: summaryHistory,
    loading: summaryLoading,
    error: summaryError,
    refetch: refetchSummary
  } = useTopicSummary(topicId);

  const [analyzing, setAnalyzing] = useState(false);

  // Trigger message analysis using LLM
  const analyzeMessages = useCallback(async (messages?: any[]): Promise<AnalysisResult | null> => {
    if (!topicId || !model.initialized || !model.topicAnalysisPlan) {
      console.warn('[useTopicAnalysis] Cannot analyze: missing topicId or plan');
      return null;
    }

    try {
      setAnalyzing(true);

      console.log('[useTopicAnalysis] Triggering message analysis for:', topicId);
      const response = await model.topicAnalysisPlan.analyzeMessages({
        topicId,
        messages,
        forceReanalysis: true
      });

      if (response.success && response.data) {
        console.log('[useTopicAnalysis] Analysis complete:', {
          subjects: response.data.subjects?.length || 0,
          keywords: response.data.keywords?.length || 0
        });

        // Refresh all data after analysis
        await Promise.all([
          refetchSubjects(),
          refetchKeywords(),
          refetchSummary()
        ]);

        return {
          subjects: response.data.subjects || [],
          keywords: response.data.keywords || [],
          summary: response.data.summary || null
        };
      }

      console.log('[useTopicAnalysis] Analysis returned no data:', response.error);
      return null;
    } catch (err) {
      console.error('[useTopicAnalysis] Analysis error:', err);
      return null;
    } finally {
      setAnalyzing(false);
    }
  }, [topicId, model, refetchSubjects, refetchKeywords, refetchSummary]);

  // Refresh all data
  const refreshAll = useCallback(async () => {
    await Promise.all([
      refetchSubjects(),
      refetchKeywords(),
      refetchSummary()
    ]);
  }, [refetchSubjects, refetchKeywords, refetchSummary]);

  return {
    // Subject data
    subjects,
    subjectsLoading,
    subjectsError,

    // Keyword data
    keywords,
    keywordsLoading,
    keywordsError,

    // Summary data
    summary,
    summaryHistory,
    summaryLoading,
    summaryError,

    // Analysis actions
    analyzeMessages,
    analyzing,

    // Refresh actions
    refreshAll,

    // Change detection
    subjectsJustAppeared,
    keywordsJustAppeared
  };
}

// Re-export types for convenience
export type { ChatSubject } from './useChatSubjects';
export type { ChatKeyword } from './useChatKeywords';
export type { TopicSummary } from './useTopicSummary';
