/**
 * Hook for managing local LLM model state
 *
 * Provides model download, status, and management for local inference.
 * Creates AI Person and LLM Person in ONE.core when a model is downloaded.
 * Uses LocalModelPlan from the module system.
 */

import { useState, useEffect, useCallback } from 'react';
import { useModel } from './ModelContext';
import {
  AVAILABLE_MODELS,
  type ModelState,
  type LocalModelInfo,
} from '../modules/LocalModelModule';

export interface UseLocalModelReturn {
  /** Current model state */
  state: ModelState;
  /** Available models for download */
  availableModels: LocalModelInfo[];
  /** Currently selected model info */
  selectedModel: LocalModelInfo | null;
  /** Select which local model card to manage */
  selectModel: (modelId: string) => Promise<void>;
  /** Start downloading a model */
  download: (modelId: string) => Promise<void>;
  /** Delete a downloaded model */
  remove: (modelId: string) => Promise<void>;
  /** Refresh model state */
  refresh: () => Promise<void>;
  /** Whether the plan is ready */
  isReady: boolean;
}

export function useLocalModel(): UseLocalModelReturn {
  const model = useModel();
  const [state, setState] = useState<ModelState>({ status: 'not_installed' });
  const [selectedModel, setSelectedModel] = useState<LocalModelInfo | null>(
    AVAILABLE_MODELS[0] || null
  );

  // Get the LocalModelPlan from the module system
  const localModelPlan = model?.localModelPlan;
  const isReady = !!localModelPlan;

  const refresh = useCallback(async () => {
    console.log('[useLocalModel] refresh called - selectedModel:', selectedModel?.id, 'localModelPlan:', !!localModelPlan);
    if (!selectedModel || !localModelPlan) {
      console.log('[useLocalModel] Early return - missing dependencies');
      return;
    }

    try {
      console.log('[useLocalModel] Calling getModelState for:', selectedModel.id);
      const modelState = await localModelPlan.getModelState(selectedModel.id);
      console.log('[useLocalModel] getModelState returned:', modelState);
      setState(modelState);
    } catch (error) {
      console.error('[useLocalModel] getModelState error:', error);
      setState({
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }, [selectedModel, localModelPlan]);

  useEffect(() => {
    if (isReady) {
      refresh();
    }
  }, [refresh, isReady]);

  const selectModel = useCallback(async (modelId: string) => {
    const localModel = AVAILABLE_MODELS.find((m) => m.id === modelId);
    if (!localModel) {
      throw new Error(`Model ${modelId} not found`);
    }

    setSelectedModel(localModel);
    if (!localModelPlan) {
      throw new Error('LocalModelPlan not initialized');
    }

    try {
      const modelState = await localModelPlan.getModelState(localModel.id);
      setState(modelState);
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
      setState({
        status: 'error',
        error: error.message,
        modelId,
      });
    }
  }, [localModelPlan]);

  const download = useCallback(
    async (modelId: string) => {
      if (!localModelPlan) {
        throw new Error('LocalModelPlan not initialized');
      }

      const localModel = AVAILABLE_MODELS.find((m) => m.id === modelId);
      if (!localModel) {
        throw new Error(`Model ${modelId} not found`);
      }

      setSelectedModel(localModel);
      setState({ status: 'downloading', progress: 0, modelId });

      try {
        await localModelPlan.downloadModel(localModel, (progress: number) => {
          setState({ status: 'downloading', progress, modelId });
        });

        // Create AI Person and LLM Person in ONE.core
        if (model?.aiAssistantPlan) {
          console.log(`[useLocalModel] Creating AI contact for model: ${modelId}`);
          await model.aiAssistantPlan.ensureAIForModel({
            modelId,
            customName: localModel.name,
            customEmail: `${modelId.replace(/[^a-zA-Z0-9]/g, '-')}@ai.local`,
            selectedModel: {
              id: localModel.id,
              name: localModel.name,
              provider: localModel.backend === 'mlx' ? 'mlx' : 'llama.rn',
              server: 'local',
              inferenceType: 'ondevice',
              modelType: 'local',
              contextLength: localModel.contextLength,
              capabilities: ['chat'],
            },
          });
          console.log(`[useLocalModel] AI contact created for ${modelId}`);
        } else {
          console.warn('[useLocalModel] aiAssistantPlan not available - skipping AI contact creation');
        }

        setState({ status: 'installed', modelId });
      } catch (error) {
        setState({
          status: 'error',
          error: error instanceof Error ? error.message : 'Download failed',
          modelId,
        });
      }
    },
    [model, localModelPlan]
  );

  const remove = useCallback(async (modelId: string) => {
    if (!localModelPlan) {
      throw new Error('LocalModelPlan not initialized');
    }

    try {
      await localModelPlan.deleteModel(modelId);
      setState({ status: 'not_installed' });
    } catch (error) {
      setState({
        status: 'error',
        error: error instanceof Error ? error.message : 'Delete failed',
      });
    }
  }, [localModelPlan]);

  return {
    state,
    availableModels: AVAILABLE_MODELS,
    selectedModel,
    selectModel,
    download,
    remove,
    refresh,
    isReady,
  };
}
