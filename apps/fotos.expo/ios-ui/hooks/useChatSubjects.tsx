/**
 * useChatSubjects Hook
 * Fetches and manages subjects for a specific chat topic
 * iOS version - uses Model directly instead of Electron IPC
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useModel } from './ModelContext';

export interface ChatSubject {
  id: string;
  idHash?: string;
  name: string;
  description?: string;
  keywords: string[];
  messageCount: number;
  timestamp: number;
  timeRanges?: Array<{ start: number; end: number }>;
  archived?: boolean;
}

export interface UseChatSubjectsReturn {
  subjects: ChatSubject[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  subjectsJustAppeared: boolean;
}

const EMPTY_SUBJECTS: ChatSubject[] = [];

export function useChatSubjects(topicId: string | null): UseChatSubjectsReturn {
  const model = useModel();

  const [subjects, setSubjects] = useState<ChatSubject[]>(EMPTY_SUBJECTS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs to track and cancel stale requests
  const requestCounter = useRef(0);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track previous subject count for change detection
  const prevSubjectCountRef = useRef(0);

  // Fetch subjects using topicAnalysisPlan
  const fetchSubjects = useCallback(async () => {
    if (!topicId || !model.initialized) {
      return;
    }

    const currentRequest = ++requestCounter.current;

    try {
      if (loading) {
        return;
      }

      setLoading(true);

      // Check if topicAnalysisPlan exists
      if (!model.topicAnalysisPlan) {
        console.warn('[useChatSubjects] TopicAnalysisPlan not available');
        setLoading(false);
        return;
      }

      console.log('[useChatSubjects] Calling topicAnalysisPlan.getSubjects for:', topicId);
      const response = await model.topicAnalysisPlan.getSubjects({
        topicId,
        includeArchived: false
      });

      // Only update if this is still the latest request
      if (currentRequest === requestCounter.current) {
        if (response.success && response.data?.subjects) {
          // Transform to our interface
          const transformedSubjects: ChatSubject[] = response.data.subjects.map((s: any) => ({
            id: s.id || s.keywords?.join('-') || String(Date.now()),
            idHash: s.idHash,
            name: s.name || s.keywords?.slice(0, 3).join(', ') || 'Subject',
            description: s.description,
            keywords: s.keywords || [],
            messageCount: s.messageCount || 0,
            timestamp: s.timestamp || s.lastSeenAt || Date.now(),
            timeRanges: s.timeRanges,
            archived: s.archived
          }));

          console.log('[useChatSubjects] Subjects loaded:', transformedSubjects.length);
          setSubjects(transformedSubjects);
          setError(null);
        } else {
          console.log('[useChatSubjects] No subjects in response:', response.error);
          setSubjects(EMPTY_SUBJECTS);
        }
      }
    } catch (err) {
      if (currentRequest === requestCounter.current) {
        console.error('[useChatSubjects] Fetch error:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch subjects');
      }
    } finally {
      if (currentRequest === requestCounter.current) {
        setLoading(false);
      }
    }
  }, [topicId, model, loading]);

  // Detect when subjects appear (0 -> N) and return flag
  const subjectsJustAppeared = prevSubjectCountRef.current === 0 && subjects.length > 0;

  // Only update ref when subjects count actually changes
  useEffect(() => {
    prevSubjectCountRef.current = subjects.length;
  }, [subjects.length]);

  // Load subjects when topicId changes
  useEffect(() => {
    setError(null);

    if (!topicId) {
      setSubjects(EMPTY_SUBJECTS);
      return;
    }

    // Cancel any pending debounce timer
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    // Debounce the fetch
    debounceTimer.current = setTimeout(() => {
      fetchSubjects();
    }, 300);

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [topicId, fetchSubjects]);

  // Subscribe to model events for updates
  useEffect(() => {
    if (!model.initialized || !topicId) return;

    // Listen for topic changes that might include new subjects
    const disconnectHandler = model.onTopicsChanged(() => {
      // Refresh subjects when topics change (subjects might be extracted)
      fetchSubjects();
    });

    return () => {
      disconnectHandler();
    };
  }, [model, topicId, fetchSubjects]);

  return {
    subjects,
    loading,
    error,
    refetch: fetchSubjects,
    subjectsJustAppeared
  };
}
