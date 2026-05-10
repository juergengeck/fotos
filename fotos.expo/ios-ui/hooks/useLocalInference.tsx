/**
 * Hook for local LLM inference
 *
 * Provides functions to load the local model and generate responses.
 * Integrates with the AI event system for streaming updates.
 * Uses LocalModelPlan from the module system.
 */

import { useState, useCallback } from 'react';
import { useModel } from './ModelContext';
import { AVAILABLE_MODELS } from '../modules/LocalModelModule';
import { emitAIEvent, Events } from '../events/AIEventTypes';

export interface UseLocalInferenceReturn {
  /** Whether the model is currently loaded in memory */
  isLoaded: boolean;
  /** Whether inference is currently running */
  isGenerating: boolean;
  /** Load the model into memory */
  load: (modelId?: string) => Promise<void>;
  /** Unload the model from memory */
  unload: () => void;
  /** Generate a response from the local model */
  generate: (
    topicId: string,
    prompt: string,
    options?: {
      maxNewTokens?: number;
      temperature?: number;
    }
  ) => Promise<string>;
  /** Current error if any */
  error: string | null;
  /** Whether the plan is ready */
  isReady: boolean;
}

export function useLocalInference(): UseLocalInferenceReturn {
  const model = useModel();
  const localModelPlan = model?.localModelPlan;
  const isReady = !!localModelPlan;

  const [isLoaded, setIsLoaded] = useState(localModelPlan?.isModelLoaded() ?? false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (modelId?: string) => {
    if (!localModelPlan) {
      throw new Error('LocalModelPlan not initialized');
    }

    setError(null);

    // Find model info
    const modelInfo = modelId
      ? AVAILABLE_MODELS.find((m) => m.id === modelId)
      : AVAILABLE_MODELS[0];

    if (!modelInfo) {
      const err = `Model ${modelId || 'default'} not found`;
      setError(err);
      throw new Error(err);
    }

    try {
      await localModelPlan.loadModel(modelInfo);
      setIsLoaded(true);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : 'Failed to load model';
      setError(errMsg);
      throw e;
    }
  }, [localModelPlan]);

  const unload = useCallback(() => {
    if (localModelPlan) {
      localModelPlan.unloadModel();
      setIsLoaded(false);
    }
  }, [localModelPlan]);

  const generate = useCallback(
    async (
      topicId: string,
      prompt: string,
      options?: {
        maxNewTokens?: number;
        temperature?: number;
      }
    ): Promise<string> => {
      if (!localModelPlan) {
        throw new Error('LocalModelPlan not initialized');
      }

      if (!localModelPlan.isModelLoaded()) {
        throw new Error('Model not loaded');
      }

      setIsGenerating(true);
      setError(null);

      // Generate a unique message ID for this response
      const messageId = `local-${Date.now()}`;

      try {
        // Emit progress start
        emitAIEvent(Events.AI_RESPONDING, { topicId, progress: 0 });
        console.log('[useLocalInference] Starting generateResponse for topicId:', topicId);

        // Track timing for trace
        const startTime = Date.now();

        const response = await localModelPlan.generateResponse(prompt, {
          maxNewTokens: options?.maxNewTokens,
          temperature: options?.temperature,
        });

        const generationTimeMs = Date.now() - startTime;

        console.log('[useLocalInference] generateResponse returned:', response?.length, 'chars');
        console.log('[useLocalInference] Emitting LLM_COMPLETE event');

        // Emit completion with timing data for trace
        const loadedModelId = localModelPlan.getLoadedModelId();
        const loadedModel = loadedModelId
          ? AVAILABLE_MODELS.find((modelInfo) => modelInfo.id === loadedModelId)
          : undefined;

        emitAIEvent(Events.LLM_COMPLETE, {
          topicId,
          messageId,
          content: response,
          status: 'success',
          modelId: loadedModelId ?? 'local',
          modelName: loadedModel?.name ?? 'Local model',
          // Trace data for local inference
          trace: {
            generationTimeMs,
            promptLength: prompt.length,
            responseLength: response.length,
          }
        });

        return response;
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : 'Generation failed';
        setError(errMsg);

        emitAIEvent(Events.AI_ERROR, {
          topicId,
          error: errMsg,
        });

        throw e;
      } finally {
        setIsGenerating(false);
      }
    },
    [localModelPlan]
  );

  return {
    isLoaded,
    isGenerating,
    load,
    unload,
    generate,
    error,
    isReady,
  };
}
