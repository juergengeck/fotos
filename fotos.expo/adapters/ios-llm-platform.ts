/**
 * iOS LLM Platform Implementation
 *
 * Implements LLMPlatform interface for React Native environments.
 * This adapter bridges vger.core's platform-agnostic LLM operations with
 * React Native's DeviceEventEmitter API for cross-component communication.
 *
 * Uses centralized event registry from @vger/vger.core/events.
 */

import type { LLMPlatform, LLMModelResidencyStatus, ChatMessage, LocalChatOptions } from '@vger/vger.core/services/llm-platform.js';
import { Events } from '@vger/vger.core/events';
import { emitAIEvent } from '../ios-ui/events/AIEventTypes';
import { AVAILABLE_MODELS, type LocalModelPlan } from '../ios-ui/modules/LocalModelModule';

function mapIOSModelState(status: 'not_installed' | 'downloading' | 'installed' | 'loading' | 'ready' | 'error'): LLMModelResidencyStatus['status'] {
  if (status === 'not_installed' || status === 'installed') {
    return 'unloaded';
  }
  return status;
}

export class IOSLLMPlatform implements LLMPlatform {
  // LocalModelPlan is injected after module initialization
  private localModelPlan: LocalModelPlan | null = null;

  /**
   * Set LocalModelPlan for local inference
   * Called after module initialization in Model.ts
   */
  setLocalModelPlan(plan: LocalModelPlan): void {
    this.localModelPlan = plan;
    console.log('[IOSLLMPlatform] LocalModelPlan injected');
  }
  /**
   * Emit progress update via type-safe event system
   */
  emitProgress(topicId: string, progress: number): void {
    emitAIEvent(Events.AI_RESPONDING, {
      topicId,
      progress,
    });
  }

  /**
   * Emit error via type-safe event system
   */
  emitError(topicId: string, error: Error): void {
    emitAIEvent(Events.AI_ERROR, {
      topicId,
      error: error.message,
    });
  }

  /**
   * Emit message update via type-safe event system
   */
  emitMessageUpdate(
    topicId: string,
    messageId: string,
    content: string | { thinking?: string; response: string; raw?: string },
    status: string,
    modelId?: string,
    modelName?: string
  ): void {
    // Normalize content to string format (extract response)
    const text = typeof content === 'string'
      ? content
      : content.response;

    if (status === 'responding') {
      emitAIEvent(Events.AI_RESPONDING, {
        topicId,
        progress: 0,
      });
    } else if (status === 'streaming') {
      emitAIEvent(Events.LLM_STREAM, {
        topicId,
        messageId,
        content: text,
        modelId,
        modelName,
      });
    } else if (status === 'complete' || status === 'error') {
      emitAIEvent(Events.LLM_COMPLETE, {
        topicId,
        messageId,
        content: text,
        status: status === 'error' ? 'error' : 'success',
        modelId,
        modelName,
      });
    }
  }

  /**
   * Emit analysis update via type-safe event system
   * Notifies UI when subjects/keywords are extracted from AI responses
   */
  emitAnalysisUpdate(topicId: string, updateType: 'subjects' | 'keywords' | 'both'): void {
    if (updateType === 'keywords' || updateType === 'both') {
      emitAIEvent(Events.KEYWORDS_UPDATED, { topicId });
    }
    if (updateType === 'subjects' || updateType === 'both') {
      emitAIEvent(Events.SUBJECTS_UPDATED, { topicId });
    }
  }

  /**
   * Emit thinking stream update (for models with extended thinking like DeepSeek R1)
   */
  emitThinkingUpdate(topicId: string, messageId: string, thinkingContent: string): void {
    emitAIEvent(Events.LLM_THINKING, { topicId, messageId, content: thinkingContent });
  }

  /**
   * Emit thinking status update during AI response generation
   */
  emitThinkingStatus(topicId: string, status: string): void {
    emitAIEvent(Events.LLM_STATUS, { topicId, status });
  }

  /**
   * MCP server operations not supported in React Native
   * React Native environments cannot spawn child processes
   */
  // startMCPServer and stopMCPServer are intentionally not implemented
  // The interface marks them as optional

  /**
   * Read model file from expo-file-system or remote fetch
   * iOS-specific implementation for model loading
   */
  async readModelFile(path: string): Promise<Uint8Array> {
    // In React Native, we would fetch from a URL or read from expo-file-system
    // This is a placeholder - actual implementation would depend on storage strategy
    throw new Error(
      'iOS model file reading not yet implemented - use fetch() or expo-file-system'
    );
  }

  /**
   * Lookup local model info by ID for AI Person creation during model switching
   * Uses AVAILABLE_MODELS from LocalModelModule
   */
  async lookupLocalModel(modelId: string): Promise<{ displayName: string; provider: string } | null> {
    const model = AVAILABLE_MODELS.find(m => m.id === modelId);
    if (model) {
      return {
        displayName: model.name,
        provider: model.backend === 'gguf' ? 'local-gguf' : 'local-mlx',
      };
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Local Model Operations (LLMPlatform interface)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Execute local inference via llama.rn (GGUF) or transformers.js (ONNX)
   */
  async chatWithLocal(
    modelId: string,
    messages: ChatMessage[],
    options: LocalChatOptions
  ): Promise<string> {
    console.log(`[IOSLLMPlatform] chatWithLocal called for model: ${modelId}`);

    if (!this.localModelPlan) {
      throw new Error('[IOSLLMPlatform] LocalModelPlan not set - call setLocalModelPlan() first');
    }

    const modelInfo = AVAILABLE_MODELS.find(m => m.id === modelId);
    if (!modelInfo) {
      throw new Error(`[IOSLLMPlatform] Unknown local model: ${modelId}`);
    }

    if (!this.localModelPlan.isModelLoaded() || this.localModelPlan.getLoadedModelId() !== modelId) {
      const state = await this.localModelPlan.getModelState(modelId);
      const readiness = state.status === 'loading' || state.status === 'downloading'
        ? `still ${state.status}`
        : state.status;
      throw new Error(`[IOSLLMPlatform] Local model ${modelId} is ${readiness}. Load it explicitly before chat.`);
    }

    return this.localModelPlan.generateChatCompletion(messages, {
      maxNewTokens: options.maxTokens ?? 256,
      temperature: options.temperature ?? 0.7,
      onToken: options.onStream ? (token) => options.onStream!(token) : undefined,
    });
  }

  /**
   * Check if a local model is currently loaded
   */
  isLocalModelLoaded(modelId: string): boolean {
    if (!this.localModelPlan) {
      return false;
    }
    return this.localModelPlan.isModelLoaded() && this.localModelPlan.getLoadedModelId() === modelId;
  }

  async getLocalModelStatus(modelId: string): Promise<LLMModelResidencyStatus> {
    if (!this.localModelPlan) {
      return {
        modelId,
        provider: 'local',
        server: 'embedded',
        supportsResidency: true,
        status: 'unloaded',
      };
    }

    const state = await this.localModelPlan.getModelState(modelId);
    return {
      modelId,
      provider: 'local',
      server: 'embedded',
      supportsResidency: true,
      status: mapIOSModelState(state.status),
      progress: state.progress,
      error: state.error,
    };
  }

  /**
   * Load a local model
   */
  async loadLocalModel(modelId: string, onProgress?: (progress: number) => void): Promise<void> {
    if (!this.localModelPlan) {
      throw new Error('[IOSLLMPlatform] LocalModelPlan not set');
    }

    const modelInfo = AVAILABLE_MODELS.find(m => m.id === modelId);
    if (!modelInfo) {
      throw new Error(`[IOSLLMPlatform] Unknown local model: ${modelId}`);
    }

    // First check if model is installed
    const state = await this.localModelPlan.getModelState(modelId);
    if (state.status === 'not_installed') {
      throw new Error(`[IOSLLMPlatform] Model ${modelId} not installed. Download it first.`);
    }

    await this.localModelPlan.loadModel(modelInfo);
  }

  /**
   * Unload a local model
   */
  async unloadLocalModel(_modelId: string): Promise<void> {
    if (!this.localModelPlan) {
      return;
    }
    await this.localModelPlan.unloadModel();
  }

  /**
   * Get available local models with installation status
   */
  async getAvailableLocalModels(): Promise<Array<{ id: string; name: string; size: number; installed: boolean }>> {
    const models: Array<{ id: string; name: string; size: number; installed: boolean }> = [];

    for (const model of AVAILABLE_MODELS) {
      let installed = false;
      if (this.localModelPlan) {
        const state = await this.localModelPlan.getModelState(model.id);
        installed = state.status === 'installed' || state.status === 'ready';
      }

      models.push({
        id: model.id,
        name: model.name,
        size: 0, // Size would need to be computed from downloaded files
        installed,
      });
    }

    return models;
  }

  /**
   * Get installed text-generation models for ONE.core registration
   */
  async getInstalledTextGenModels(): Promise<Array<{
    id: string;
    name: string;
    sizeBytes: number;
    contextLength?: number;
    familyName?: string;
  }>> {
    const installed: Array<{
      id: string;
      name: string;
      sizeBytes: number;
      contextLength?: number;
      familyName?: string;
    }> = [];

    if (!this.localModelPlan) {
      return installed;
    }

    for (const model of AVAILABLE_MODELS) {
      const state = await this.localModelPlan.getModelState(model.id);
      if (state.status === 'installed' || state.status === 'ready') {
        installed.push({
          id: model.id,
          name: model.name,
          sizeBytes: 0,
          contextLength: model.contextLength,
          familyName: model.familyName,
        });
      }
    }

    return installed;
  }
}
