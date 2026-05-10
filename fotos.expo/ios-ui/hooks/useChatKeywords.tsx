/**
 * useChatKeywords Hook
 * Fetches and manages keywords for a specific chat topic
 * iOS version - uses Model directly instead of Electron IPC
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useModel } from './ModelContext';

export interface ChatKeyword {
  term: string;
  frequency: number;
  score?: number;
  subjects: string[];
  createdAt: number;
  lastSeen: number;
}

export interface UseChatKeywordsReturn {
  keywords: ChatKeyword[];
  loading: boolean;
  error: string | null;
  updateKeywordsForNewMessage: (messageText: string) => void;
  refetch: () => Promise<void>;
  keywordsJustAppeared: boolean;
}

const EMPTY_KEYWORDS: ChatKeyword[] = [];

export function useChatKeywords(topicId: string | null): UseChatKeywordsReturn {
  const model = useModel();

  const [keywords, setKeywords] = useState<ChatKeyword[]>(EMPTY_KEYWORDS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs to track and cancel stale requests
  const extractionInProgress = useRef(false);
  const requestCounter = useRef(0);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track previous keyword count for change detection
  const prevKeywordCountRef = useRef(0);

  // Fetch keywords using topicAnalysisPlan
  const fetchKeywords = useCallback(async () => {
    if (!topicId || !model.initialized) {
      return;
    }

    // Skip if another extraction is already in progress
    if (extractionInProgress.current) {
      return;
    }

    const currentRequest = ++requestCounter.current;
    extractionInProgress.current = true;

    try {
      // Only show loading for initial load
      if (keywords.length === 0) {
        setLoading(true);
      }

      // Check if topicAnalysisPlan exists
      if (!model.topicAnalysisPlan) {
        console.warn('[useChatKeywords] TopicAnalysisPlan not available');
        setLoading(false);
        extractionInProgress.current = false;
        return;
      }

      console.log('[useChatKeywords] Calling topicAnalysisPlan.getKeywords for:', topicId);
      const response = await model.topicAnalysisPlan.getKeywords({
        topicId,
        limit: 15
      });

      // Only update if this is still the latest request
      if (currentRequest === requestCounter.current) {
        if (response.success && response.data?.keywords) {
          // Transform to our interface
          const transformedKeywords: ChatKeyword[] = response.data.keywords.map((k: any) => ({
            term: k.term,
            frequency: k.frequency || 1,
            score: k.score,
            subjects: k.subjects || [],
            createdAt: k.createdAt || Date.now(),
            lastSeen: k.lastSeen || Date.now()
          }));

          console.log('[useChatKeywords] Keywords loaded:', transformedKeywords.length);
          setKeywords(transformedKeywords);
          setError(null);
        } else {
          // Try fallback: extract keywords from subjects
          const subjectsResponse = await model.topicAnalysisPlan.getSubjects({
            topicId,
            includeArchived: false
          });

          if (currentRequest === requestCounter.current) {
            if (subjectsResponse.success && subjectsResponse.data?.subjects) {
              const allKeywordTerms = new Set<string>();

              subjectsResponse.data.subjects.forEach((subject: { keywords?: string[] }) => {
                if (subject.keywords && Array.isArray(subject.keywords)) {
                  subject.keywords.forEach((keyword: string) => {
                    // Only include single words
                    if (!keyword.includes(' ') && !keyword.includes('+')) {
                      allKeywordTerms.add(keyword);
                    }
                  });
                }
              });

              // Create keyword objects from terms
              const keywordArray: ChatKeyword[] = Array.from(allKeywordTerms).slice(0, 15).map(term => ({
                term,
                frequency: 1,
                subjects: [],
                createdAt: Date.now(),
                lastSeen: Date.now()
              }));
              setKeywords(keywordArray);
            } else {
              setKeywords(EMPTY_KEYWORDS);
            }
          }
        }
      }
    } catch (err) {
      if (currentRequest === requestCounter.current) {
        console.error('[useChatKeywords] Fetch error:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch keywords');
      }
    } finally {
      extractionInProgress.current = false;
      if (currentRequest === requestCounter.current) {
        setLoading(false);
      }
    }
  }, [topicId, model, keywords.length]);

  // Detect when keywords appear (0 -> N) and return flag
  const keywordsJustAppeared = prevKeywordCountRef.current === 0 && keywords.length > 0;

  // Only update ref when keywords count actually changes
  useEffect(() => {
    prevKeywordCountRef.current = keywords.length;
  }, [keywords.length]);

  // Load keywords when topicId changes
  useEffect(() => {
    // Clear keywords when topicId changes to prevent stale data
    setKeywords(EMPTY_KEYWORDS);

    if (!topicId) {
      return;
    }

    // Cancel any pending debounce timer
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    // Debounce the fetch
    debounceTimer.current = setTimeout(() => {
      fetchKeywords();
    }, 300);

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [topicId, fetchKeywords]);

  // Non-blocking update for new message
  const updateKeywordsForNewMessage = useCallback((messageText: string) => {
    if (!messageText || !topicId || !model.initialized || !model.topicAnalysisPlan) {
      return;
    }

    // Increment request counter
    const currentRequest = ++requestCounter.current;

    // Fire and forget - don't block on this
    const performUpdate = async () => {
      try {
        console.log('[useChatKeywords] Updating keywords for new message (non-blocking)');

        // Convert ChatKeyword[] to string[] for API
        const existingTerms = keywords.map(k => k.term);

        const response = await model.topicAnalysisPlan.extractRealtimeKeywords({
          text: messageText,
          existingKeywords: existingTerms,
          maxKeywords: 15
        });

        // Only update if this is still the latest request
        if (currentRequest === requestCounter.current) {
          if (response.success && response.data?.keywords) {
            // Convert string[] back to ChatKeyword[]
            const newKeywords: ChatKeyword[] = response.data.keywords.map((term: string) => ({
              term,
              frequency: 1,
              subjects: [],
              createdAt: Date.now(),
              lastSeen: Date.now()
            }));
            setKeywords(newKeywords);
          }
        }
      } catch (err) {
        console.error('[useChatKeywords] Update error (non-blocking):', err);
        // Don't set error state for non-blocking updates
      }
    };

    // Start update without blocking
    performUpdate();
  }, [topicId, model, keywords]);

  // Subscribe to model events for updates
  useEffect(() => {
    if (!model.initialized || !topicId) return;

    // Listen for topic changes that might include new keywords
    const disconnectHandler = model.onTopicsChanged(() => {
      // Refresh keywords when topics change
      fetchKeywords();
    });

    return () => {
      disconnectHandler();
    };
  }, [model, topicId, fetchKeywords]);

  return {
    keywords,
    loading,
    error,
    updateKeywordsForNewMessage,
    refetch: fetchKeywords,
    keywordsJustAppeared
  };
}
