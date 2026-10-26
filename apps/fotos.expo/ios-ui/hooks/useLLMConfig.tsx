import { useState, useEffect, useCallback } from 'react';
import { useModel } from './ModelContext';

export interface LLMModel {
  id: string;
  name: string;
  modelType: 'local' | 'remote';
  provider?: string;
  isActive: boolean;
  isLoaded?: boolean;
}

export interface UseLLMConfigReturn {
  models: LLMModel[];
  activeModel: LLMModel | null;
  isLoading: boolean;
  setActiveModel: (modelId: string) => Promise<void>;
  addModel: (config: { name: string; modelType: 'local' | 'remote'; provider?: string }) => Promise<void>;
  removeModel: (modelId: string) => Promise<void>;
  refreshModels: () => Promise<void>;
}

export function useLLMConfig(): UseLLMConfigReturn {
  const model = useModel();
  const [models, setModels] = useState<LLMModel[]>([]);
  const [activeModel, setActiveModelState] = useState<LLMModel | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadModels = useCallback(async () => {
    if (!model.initialized) {
      setIsLoading(true);
      return;
    }

    try {
      if (!model.llmConfigPlan) {
        console.warn('[useLLMConfig] LLMConfigPlan not available');
        setIsLoading(false);
        return;
      }

      const allModels = await model.llmConfigPlan.getModels();
      setModels(allModels);

      const active = allModels.find((m: LLMModel) => m.isActive) || null;
      setActiveModelState(active);
    } catch (error) {
      console.error('[useLLMConfig] Error loading models:', error);
      // Set empty array on error
      setModels([]);
      setActiveModelState(null);
    } finally {
      setIsLoading(false);
    }
  }, [model]);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  const setActiveModel = useCallback(async (modelId: string) => {
    if (!model.llmConfigPlan) {
      throw new Error('LLMConfigPlan not available');
    }

    await model.llmConfigPlan.setActiveModel(modelId);
    await loadModels();
  }, [model, loadModels]);

  const addModel = useCallback(async (config: {
    name: string;
    modelType: 'local' | 'remote';
    provider?: string
  }) => {
    if (!model.llmConfigPlan) {
      throw new Error('LLMConfigPlan not available');
    }

    await model.llmConfigPlan.addModel(config);
    await loadModels();
  }, [model, loadModels]);

  const removeModel = useCallback(async (modelId: string) => {
    if (!model.llmConfigPlan) {
      throw new Error('LLMConfigPlan not available');
    }

    await model.llmConfigPlan.removeModel(modelId);
    await loadModels();
  }, [model, loadModels]);

  return {
    models,
    activeModel,
    isLoading,
    setActiveModel,
    addModel,
    removeModel,
    refreshModels: loadModels
  };
}
