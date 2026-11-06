/**
 * LocalModelModule - iOS-specific on-device LLM management
 *
 * Uses llama.rn for GGUF-based model inference with Metal GPU acceleration.
 * Uses MLX Swift for MLX-format models on iOS.
 */

import type { Module } from '@refinio/api';
import type { ChatMessage } from '@vger/vger.core/services/llm-platform.js';
import { Paths, Directory, File } from 'expo-file-system/next';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import { initLlama, type ContextParams, type LlamaContext } from 'llama.rn';
import {
  addMLXDownloadProgressListener,
  addMLXTokenListener,
  getVGERMLXModule,
  isVGERMLXModuleLinked,
} from './VGERMLXNative';

/** Model download/load state */
export type ModelStatus =
  | 'not_installed'
  | 'downloading'
  | 'installed'
  | 'loading'
  | 'ready'
  | 'error';

/** Model state with optional progress/error info */
export interface ModelState {
  status: ModelStatus;
  progress?: number;
  error?: string;
  modelId?: string;
}

/** Supported local models */
interface BaseLocalModelInfo {
  id: string;
  name: string;
  size: string;
  description: string;
  backend: 'gguf' | 'mlx';
  contextLength: number;
  familyName: string;
}

export interface GGUFLocalModelInfo extends BaseLocalModelInfo {
  backend: 'gguf';
  huggingFaceId: string;
  ggufFile: string;
  expectedBytes?: number;
  llamaRuntime: Required<Pick<
    ContextParams,
    | 'cache_type_k'
    | 'cache_type_v'
    | 'flash_attn_type'
    | 'n_batch'
    | 'n_gpu_layers'
    | 'n_ubatch'
    | 'swa_full'
    | 'use_mlock'
  >>;
}

export interface MLXLocalModelInfo extends BaseLocalModelInfo {
  backend: 'mlx';
  mlxModelId: string;
  minimumIOSVersion: string;
}

export type LocalModelInfo = GGUFLocalModelInfo | MLXLocalModelInfo;

/** Progress callback type */
export type ProgressCallback = (progress: number) => void;

/** Available models for download */
export const AVAILABLE_MODELS: LocalModelInfo[] = [
  {
    id: 'gemma-4-e2b-q2-8k',
    name: 'Gemma 4 E2B (Q2, 8K experiment)',
    size: '1.47GB',
    description: 'Extreme iPhone 13 mini test: Gemma 4 E2B Q2_K text-only GGUF with an 8K runtime context.',
    huggingFaceId: 'eaddario/gemma-4-E2B-it-GGUF',
    backend: 'gguf',
    ggufFile: 'gemma-4-E2B-it-Q2_K.gguf',
    expectedBytes: 1468138752,
    contextLength: 8192,
    familyName: 'gemma',
    llamaRuntime: {
      n_batch: 128,
      n_ubatch: 64,
      n_gpu_layers: 99,
      use_mlock: false,
      cache_type_k: 'q4_0',
      cache_type_v: 'q4_0',
      flash_attn_type: 'auto',
      swa_full: false,
    },
  },
  {
    id: 'lfm2.5-350m',
    name: 'LFM2.5 350M (MLX 4-bit)',
    size: '~212MB',
    description: 'Recommended native phone default for local VGER tasks, structured extraction, and tool-oriented actions via MLX.',
    backend: 'mlx',
    mlxModelId: 'LiquidAI/LFM2.5-350M-MLX-4bit',
    minimumIOSVersion: '17.0',
    contextLength: 2048,
    familyName: 'LFM',
  },
  {
    id: 'granite-350m-gguf',
    name: 'Granite 4.0 Nano (350M)',
    size: '~250MB',
    description: 'Fast, lightweight model via llama.cpp (Metal GPU)',
    huggingFaceId: 'ibm-granite/granite-4.0-350m-GGUF',
    backend: 'gguf',
    ggufFile: 'granite-4.0-350m-Q4_K_M.gguf',
    contextLength: 2048,
    familyName: 'granite',
    llamaRuntime: {
      n_batch: 512,
      n_ubatch: 256,
      n_gpu_layers: 99,
      use_mlock: false,
      cache_type_k: 'q4_0',
      cache_type_v: 'q4_0',
      flash_attn_type: 'auto',
      swa_full: false,
    },
  },
  {
    id: 'gemma-3-1b-mlx',
    name: 'Gemma 3 1B (MLX 4-bit)',
    size: '~733MB',
    description: 'Apple MLX runtime model for fast on-device iOS inference',
    backend: 'mlx',
    mlxModelId: 'mlx-community/gemma-3-1b-it-qat-4bit',
    minimumIOSVersion: '17.0',
    contextLength: 8192,
    familyName: 'gemma',
  },
];

/**
 * LocalModelPlan - Plan for local model operations
 *
 * GGUF models are routed through llama.rn. MLX models are routed through
 * VGERMLXModule, an iOS native bridge backed by MLX Swift.
 */
export class LocalModelPlan {
  private cachedModelId: string | null = null;
  private llamaContext: LlamaContext | null = null;
  private loadedBackend: LocalModelInfo['backend'] | null = null;
  private modelsDirectory: Directory | null = null;
  private loadingPromise: Promise<void> | null = null;

  /** Check if local models are available */
  isAvailable(): boolean {
    return true;
  }

  /** Get reason why local models are unavailable */
  getUnavailableReason(): string | null {
    return null;
  }

  private getModelsDirectory(): Directory {
    if (!this.modelsDirectory) {
      this.modelsDirectory = new Directory(Paths.document, 'models');
    }
    return this.modelsDirectory;
  }

  getModelsDir(): string {
    const uri = this.getModelsDirectory().uri;
    return uri.startsWith('file://') ? uri.substring(7) : uri;
  }

  private getGGUFFileSize(file: File): number {
    const size = file.size;
    if (typeof size !== 'number') {
      throw new Error(`[LocalModelPlan] Could not read GGUF file size: ${file.uri}`);
    }
    return size;
  }

  private assertCompleteGGUF(modelInfo: GGUFLocalModelInfo, file: File): number {
    const size = this.getGGUFFileSize(file);
    if (typeof modelInfo.expectedBytes === 'number' && size !== modelInfo.expectedBytes) {
      throw new Error(
        `[LocalModelPlan] Incomplete GGUF for ${modelInfo.id}: expected ${modelInfo.expectedBytes} bytes, found ${size} bytes`
      );
    }
    return size;
  }

  async getModelState(modelId: string): Promise<ModelState> {
    const modelInfo = AVAILABLE_MODELS.find(m => m.id === modelId);
    if (!modelInfo) {
      throw new Error(`[LocalModelPlan] Unknown local model: ${modelId}`);
    }

    if (modelInfo.backend === 'mlx') {
      if (!isVGERMLXModuleLinked()) {
        return {
          status: 'error',
          modelId,
          error: 'VGERMLXModule is not linked. Rebuild the iOS app with MLX support.',
        };
      }

      const nativeMLX = getVGERMLXModule();
      const available = await nativeMLX.isAvailable();
      if (!available) {
        const unavailableReason = await nativeMLX.getUnavailableReason();
        return {
          status: 'error',
          modelId,
          error: unavailableReason ?? `MLX requires iOS ${modelInfo.minimumIOSVersion} or newer.`,
        };
      }

      const state = await nativeMLX.getModelState(modelInfo.mlxModelId);
      return { ...state, modelId };
    }

    console.log(`[LocalModelPlan] Checking model state for ${modelId}`);

    const modelsDir = this.getModelsDirectory();
    const ggufFile = new File(modelsDir, modelInfo.ggufFile);
    if (ggufFile.exists) {
      try {
        const size = this.assertCompleteGGUF(modelInfo, ggufFile);
        console.log(`[LocalModelPlan] Complete GGUF file found: ${ggufFile.uri} (${size} bytes)`);
      } catch (error) {
        console.warn(error instanceof Error ? error.message : error);
        return { status: 'not_installed', modelId };
      }
      return { status: 'installed', modelId };
    }
    return { status: 'not_installed' };
  }

  async ensureModelsDir(): Promise<void> {
    const modelsDir = this.getModelsDirectory();
    if (!modelsDir.exists) {
      modelsDir.create();
    }
  }

  async downloadModel(
    modelInfo: LocalModelInfo,
    onProgress: ProgressCallback
  ): Promise<void> {
    if (modelInfo.backend === 'mlx') {
      const nativeMLX = getVGERMLXModule();
      const subscription = addMLXDownloadProgressListener(modelInfo.mlxModelId, onProgress);
      try {
        await nativeMLX.downloadModel(modelInfo.mlxModelId);
        onProgress(100);
      } finally {
        subscription.remove();
      }
      return;
    }

    await this.ensureModelsDir();

    const url = `https://huggingface.co/${modelInfo.huggingFaceId}/resolve/main/${modelInfo.ggufFile}`;
    const destUri = this.getModelsDirectory().uri + '/' + modelInfo.ggufFile;

    console.log(`[LocalModelPlan] Downloading GGUF: ${url}`);
    console.log(`[LocalModelPlan] Destination: ${destUri}`);

    const downloadResumable = FileSystemLegacy.createDownloadResumable(
      url,
      destUri,
      {},
      (progress) => {
        if (progress.totalBytesExpectedToWrite > 0) {
          onProgress((progress.totalBytesWritten / progress.totalBytesExpectedToWrite) * 100);
        }
      }
    );

    const result = await downloadResumable.downloadAsync();
    if (!result || result.status !== 200) {
      throw new Error(`Failed to download GGUF: status ${result?.status}`);
    }

    this.assertCompleteGGUF(modelInfo, new File(this.getModelsDirectory(), modelInfo.ggufFile));
    console.log(`[LocalModelPlan] GGUF downloaded to: ${result.uri}`);
    onProgress(100);
  }

  async deleteModel(modelId: string): Promise<void> {
    const modelInfo = AVAILABLE_MODELS.find(m => m.id === modelId);
    if (!modelInfo) {
      throw new Error(`[LocalModelPlan] Unknown model to delete: ${modelId}`);
    }

    if (modelInfo.backend === 'mlx') {
      const nativeMLX = getVGERMLXModule();
      await nativeMLX.deleteModel(modelInfo.mlxModelId);
      if (this.cachedModelId === modelInfo.id) {
        this.cachedModelId = null;
        this.loadedBackend = null;
      }
      return;
    }

    const modelsDir = this.getModelsDirectory();
    const ggufFile = new File(modelsDir, modelInfo.ggufFile);
    if (ggufFile.exists) {
      console.log(`[LocalModelPlan] Deleting GGUF file: ${ggufFile.uri}`);
      ggufFile.delete();
    }
  }

  async getDownloadedModelsSize(): Promise<number> {
    const modelsDir = this.getModelsDirectory();
    if (!modelsDir.exists) return 0;

    let totalSize = 0;
    const items = modelsDir.list();

    for (const item of items) {
      if (item instanceof File) {
        totalSize += item.size ?? 0;
      }
    }

    return totalSize;
  }

  async loadModel(modelInfo: LocalModelInfo): Promise<void> {
    if (this.cachedModelId === modelInfo.id && this.loadedBackend === 'mlx') {
      return;
    }

    if (this.cachedModelId === modelInfo.id && this.llamaContext && this.loadedBackend === 'gguf') {
      return;
    }

    // If this model is already being loaded, wait for it
    if (this.loadingPromise) {
      await this.loadingPromise;
      if (
        this.cachedModelId === modelInfo.id &&
        ((modelInfo.backend === 'gguf' && this.llamaContext) || this.loadedBackend === 'mlx')
      ) {
        return;
      }
    }

    // Unload any previous model
    await this.unloadModel();

    this.loadingPromise = modelInfo.backend === 'gguf'
      ? this.loadGGUF(modelInfo)
      : this.loadMLX(modelInfo);

    try {
      await this.loadingPromise;
    } finally {
      this.loadingPromise = null;
    }
  }

  private async loadGGUF(modelInfo: GGUFLocalModelInfo): Promise<void> {
    const modelPath = this.getModelsDir() + '/' + modelInfo.ggufFile;
    console.log('[LocalModelPlan] Loading GGUF via llama.rn:', modelPath);

    try {
      this.llamaContext = await initLlama({
        model: modelPath,
        n_ctx: modelInfo.contextLength,
        ...modelInfo.llamaRuntime,
      });
      this.cachedModelId = modelInfo.id;
      this.loadedBackend = 'gguf';
      console.log(`[LocalModelPlan] GGUF loaded - GPU: ${this.llamaContext.gpu}, device: ${this.llamaContext.gpuDevice || 'none'}`);
      if (!this.llamaContext.gpu) {
        console.warn(`[LocalModelPlan] No GPU: ${this.llamaContext.reasonNoGPU}`);
      }
    } catch (error) {
      this.llamaContext = null;
      this.cachedModelId = null;
      this.loadedBackend = null;
      throw new Error(`Failed to load GGUF model: ${error}`);
    }
  }

  private async loadMLX(modelInfo: MLXLocalModelInfo): Promise<void> {
    console.log('[LocalModelPlan] Loading MLX via native bridge:', modelInfo.mlxModelId);
    const nativeMLX = getVGERMLXModule();
    await nativeMLX.loadModel(modelInfo.mlxModelId);
    this.cachedModelId = modelInfo.id;
    this.loadedBackend = 'mlx';
  }

  async unloadModel(): Promise<void> {
    if (this.llamaContext) {
      await this.llamaContext.release();
      this.llamaContext = null;
    }
    if (this.loadedBackend === 'mlx') {
      await getVGERMLXModule().unloadModel();
    }
    this.cachedModelId = null;
    this.loadedBackend = null;
    console.log('[LocalModelPlan] Model unloaded');
  }

  isModelLoaded(): boolean {
    return this.llamaContext !== null || this.loadedBackend === 'mlx';
  }

  getLoadedModelId(): string | null {
    return this.cachedModelId;
  }

  async generateResponse(
    prompt: string,
    options?: {
      maxNewTokens?: number;
      temperature?: number;
      topP?: number;
      onToken?: (token: string) => void;
    }
  ): Promise<string> {
    const {
      maxNewTokens = 256,
      temperature = 0.7,
      topP = 0.9,
      onToken,
    } = options || {};

    if (this.loadedBackend === 'mlx') {
      const modelInfo = AVAILABLE_MODELS.find(m => m.id === this.cachedModelId);
      if (!modelInfo || modelInfo.backend !== 'mlx') {
        throw new Error('[LocalModelPlan] MLX model metadata missing for loaded model.');
      }
      const nativeMLX = getVGERMLXModule();
      const subscription = onToken
        ? addMLXTokenListener(modelInfo.mlxModelId, onToken)
        : null;
      try {
        return await nativeMLX.generateResponse(modelInfo.mlxModelId, prompt, {
          maxNewTokens,
          temperature,
          topP,
        });
      } finally {
        subscription?.remove();
      }
    }

    if (!this.llamaContext) {
      throw new Error('No model loaded. Call loadModel() first.');
    }

    console.log('[LocalModelPlan] Generating, prompt length:', prompt.length);

    const result = await this.llamaContext.completion(
      {
        messages: [{ role: 'user', content: prompt }],
        n_predict: maxNewTokens,
        temperature,
        top_p: topP,
      },
      onToken ? (data) => { if (data.token) onToken(data.token); } : undefined,
    );

    console.log(`[LocalModelPlan] Generated ${result.tokens_predicted} tokens`);
    return result.text;
  }

  /**
   * Chat completion using llama.rn's native message format and chat template.
   */
  async generateChatCompletion(
    messages: ChatMessage[],
    options?: {
      maxNewTokens?: number;
      temperature?: number;
      topP?: number;
      onToken?: (token: string) => void;
    }
  ): Promise<string> {
    const {
      maxNewTokens = 256,
      temperature = 0.7,
      topP = 0.9,
      onToken,
    } = options || {};

    if (this.loadedBackend === 'mlx') {
      const modelInfo = AVAILABLE_MODELS.find(m => m.id === this.cachedModelId);
      if (!modelInfo || modelInfo.backend !== 'mlx') {
        throw new Error('[LocalModelPlan] MLX model metadata missing for loaded model.');
      }

      const nativeMLX = getVGERMLXModule();
      const subscription = onToken
        ? addMLXTokenListener(modelInfo.mlxModelId, onToken)
        : null;
      try {
        return await nativeMLX.generateChatCompletion(modelInfo.mlxModelId, messages, {
          maxNewTokens,
          temperature,
          topP,
        });
      } finally {
        subscription?.remove();
      }
    }

    if (!this.llamaContext) {
      throw new Error('No model loaded for chat completion.');
    }

    const result = await this.llamaContext.completion(
      {
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        n_predict: maxNewTokens,
        temperature,
        top_p: topP,
        stop: ['</s>', '<|endoftext|>', '<|end|>'],
      },
      onToken ? (data) => { if (data.token) onToken(data.token); } : undefined,
    );

    return result.text;
  }
}

/**
 * LocalModelModule - Module for on-device LLM functionality
 */
export class LocalModelModule implements Module {
  readonly name = 'LocalModelModule';

  static demands: Array<{ targetType: string; required: boolean }> = [];

  static supplies = [
    { targetType: 'LocalModelPlan' }
  ];

  localModelPlan: LocalModelPlan = new LocalModelPlan();

  async init(): Promise<void> {
    console.log('[LocalModelModule] Initialized');
  }

  async shutdown(): Promise<void> {
    if (this.localModelPlan) {
      await this.localModelPlan.unloadModel();
    }
    console.log('[LocalModelModule] Shutdown complete');
  }

  setDependency(_targetType: string, _instance: any): void {
    // LocalModelModule has no injected dependencies on iOS.
  }

  emitSupplies(registry: any): void {
    registry.supply('LocalModelPlan', this.localModelPlan);
  }
}
