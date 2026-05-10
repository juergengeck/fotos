/**
 * useMessageTrace Hook
 * Fetches trace data for a specific AI message
 * iOS version - queries TraceContent from ONE.core
 */

import { useState, useEffect, useCallback } from 'react';
import { getObjectByIdObj } from '@refinio/one.core/lib/storage-versioned-objects.js';
import type {
  TraceContent,
  ContextInjectionTrace,
  SubjectExtractionTrace,
  LLMCallTrace
} from '@refinio/assembly.core/recipes';

export interface MessageTrace {
  messageId: string;
  timestamp: number;
  processingTimeMs: number;
  llmCall?: {
    model: string;
    provider: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    generationTimeMs?: number;
  };
  contextInjection?: {
    subjects: Array<{
      id: string;
      keywords: string[];
      description?: string;
    }>;
    tokenCount: number;
  };
  subjectExtraction?: {
    extracted: Array<{
      keywords: string[];
      description: string;
      confidence: number;
    }>;
    storedToMemory: boolean;
  };
}

export interface UseMessageTraceReturn {
  trace: MessageTrace | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useMessageTrace(messageId: string | null): UseMessageTraceReturn {
  const [trace, setTrace] = useState<MessageTrace | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTrace = useCallback(async () => {
    if (!messageId) {
      setTrace(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Query TraceContent by authored Message object id
      // Cast to any because getObjectByIdObj expects full type but we only provide ID fields
      const result = await getObjectByIdObj({
        $type$: 'TraceContent',
        messageId
      } as any);

      if (result?.obj) {
        const traceContent = result.obj as TraceContent;
        const llm = traceContent.llmCall as LLMCallTrace | undefined;
        const ctx = traceContent.contextInjection as ContextInjectionTrace | undefined;
        const ext = traceContent.subjectExtraction as SubjectExtractionTrace | undefined;

        setTrace({
          messageId: traceContent.messageId,
          timestamp: traceContent.timestamp,
          processingTimeMs: traceContent.processingTimeMs || 0,
          llmCall: llm ? {
            model: llm.model,
            provider: llm.provider,
            promptTokens: llm.promptTokens,
            completionTokens: llm.completionTokens,
            totalTokens: llm.totalTokens,
            generationTimeMs: llm.generationTimeMs
          } : undefined,
          contextInjection: ctx ? {
            subjects: ctx.subjects.map((s: ContextInjectionTrace['subjects'][0]) => ({
              id: s.idHash,
              keywords: s.keywords,
              description: s.description
            })),
            tokenCount: ctx.tokenCount
          } : undefined,
          subjectExtraction: ext ? {
            extracted: ext.extracted.map((e: SubjectExtractionTrace['extracted'][0]) => ({
              keywords: e.keywords,
              description: e.description,
              confidence: e.confidence
            })),
            storedToMemory: ext.storedToMemory
          } : undefined
        });
      } else {
        setTrace(null);
      }
    } catch (err: unknown) {
      // Not found is not an error - just means no trace exists
      if ((err as { name?: string })?.name === 'FileNotFoundError') {
        setTrace(null);
      } else {
        console.error('[useMessageTrace] Error fetching trace:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch trace');
      }
    } finally {
      setLoading(false);
    }
  }, [messageId]);

  useEffect(() => {
    fetchTrace();
  }, [fetchTrace]);

  return {
    trace,
    loading,
    error,
    refetch: fetchTrace
  };
}
