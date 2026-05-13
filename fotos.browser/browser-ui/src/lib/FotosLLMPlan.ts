import { getTextGenerationModels, type ModelInfo } from '@refinio/local.core';
import { LLMManager } from '../../../../../vger/packages/agent.core/dist/services/llm-manager.js';
import type { ChatMessage } from '@vger/vger.core/services/llm-platform.js';
import { BrowserLLMPlatform } from '../../../../../vger/packages/vger.browser/adapters/browser-llm-platform.ts';
import {
  buildPhotoAnalyticsComparisonPrompt,
  type PhotoAnalyticsSnapshot,
} from './fotosLLMComparison';

type RuntimeModelInfo = Awaited<ReturnType<BrowserLLMPlatform['getAvailableLocalModels']>>[number];

export interface FotosLLMModelSummary {
  modelId: string;
  name: string;
  familyName: string;
  sizeBytes: number;
  contextLength: number;
  loaded: boolean;
  supportsVision: boolean;
  supportsThinking: boolean;
  supportsTools: boolean;
  supportsStreaming: boolean;
  source: 'local';
}

export interface FotosLLMStatus {
  initialized: boolean;
  loadedModelId: string | null;
  models: FotosLLMModelSummary[];
}

export interface FotosLLMComparisonResult {
  modelId: string;
  modelName: string;
  comparisonMode: 'structured-snapshot';
  supportsVision: boolean;
  imageInputReady: boolean;
  response: string;
  thinking?: string;
  snapshot: PhotoAnalyticsSnapshot;
}

function getLocalCapabilities(modelId: string): string[] {
  const capabilities = ['chat', 'streaming'];

  if (modelId === 'gemma-4-e2b-it') {
    capabilities.push('vision');
  }

  return capabilities;
}

function createRegisteredLLM(model: RuntimeModelInfo, modelInfo?: ModelInfo): Record<string, unknown> {
  const now = Date.now();
  const nowString = new Date(now).toISOString();

  return {
    $type$: 'LLM',
    modelId: model.id,
    name: modelInfo?.name ?? model.name,
    filename: model.id,
    provider: 'transformers',
    inferenceType: 'ondevice',
    description: `On-device ${modelInfo?.name ?? model.name}`,
    contextLength: modelInfo?.contextLength ?? 4096,
    maxTokens: 2048,
    capabilities: getLocalCapabilities(model.id),
    server: 'local',
    modelType: 'local',
    size: modelInfo?.sizeBytes ?? model.size,
    active: true,
    deleted: false,
    created: now,
    modified: now,
    createdAt: nowString,
    lastUsed: nowString,
  };
}

function normalizeTextResponse(result: unknown): { response: string; thinking?: string } {
  if (typeof result === 'string') {
    return { response: result.trim() };
  }

  if (result && typeof result === 'object') {
    const record = result as Record<string, unknown>;
    const response = typeof record.content === 'string'
      ? record.content
      : typeof record.response === 'string'
        ? record.response
        : '';
    const thinking = typeof record.thinking === 'string' ? record.thinking : undefined;

    return {
      response: response.trim(),
      ...(thinking ? { thinking } : {}),
    };
  }

  return { response: String(result ?? '').trim() };
}

export class FotosLLMPlan {
  private readonly platform = new BrowserLLMPlatform();
  private readonly llmManager = new LLMManager(this.platform);
  private initialized = false;
  private loadedModelId: string | null = null;

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const runtimeModels = await this.platform.getAvailableLocalModels?.() ?? [];
    const localModelMap = new Map<string, ModelInfo>(
      getTextGenerationModels().map((modelInfo) => [modelInfo.id, modelInfo]),
    );
    const registry = this.llmManager.getRegistry();

    for (const runtimeModel of runtimeModels) {
      const modelInfo = localModelMap.get(runtimeModel.id);

      if (registry.has(runtimeModel.id)) {
        continue;
      }

      registry.register(
        createRegisteredLLM(runtimeModel, modelInfo) as any,
        'local',
      );
    }

    this.initialized = true;
  }

  private async getRuntimeModelSummaries(): Promise<FotosLLMModelSummary[]> {
    await this.ensureInitialized();

    const models = await this.llmManager.getAvailableModels();
    const capabilityService = this.llmManager.getCapabilityService();

    return Promise.all(
      models
        .filter((model: any) => model.provider === 'transformers' || model.provider === 'local')
        .map(async (model: any) => {
          const modelId = String(model.modelId || model.name);
          const loaded = this.platform.isLocalModelLoaded?.(modelId) ?? this.loadedModelId === modelId;
          const capabilities = await capabilityService.getCapabilities(modelId);

          return {
            modelId,
            name: String(model.name || modelId),
            familyName: String(model.name || modelId).split(' ')[0] || modelId,
            sizeBytes: Number(model.size || 0),
            contextLength: Number(model.contextLength || capabilities.contextWindow || 4096),
            loaded,
            supportsVision: capabilities.supportsVision === true,
            supportsThinking: capabilities.supportsThinking === true,
            supportsTools: capabilities.supportsTools === true,
            supportsStreaming: capabilities.supportsStreaming !== false,
            source: 'local' as const,
          };
        }),
    );
  }

  async listModels(): Promise<FotosLLMModelSummary[]> {
    return this.getRuntimeModelSummaries();
  }

  async status(): Promise<FotosLLMStatus> {
    const models = await this.getRuntimeModelSummaries();
    const loadedModel = models.find((model) => model.loaded) ?? null;
    this.loadedModelId = loadedModel?.modelId ?? null;

    return {
      initialized: this.initialized,
      loadedModelId: this.loadedModelId,
      models,
    };
  }

  async loadModel(
    params: { modelId: string },
    onProgress?: (progress: number) => void,
  ): Promise<FotosLLMStatus> {
    await this.ensureInitialized();
    await this.platform.loadLocalModel?.(params.modelId, onProgress);
    this.loadedModelId = params.modelId;
    return this.status();
  }

  async unloadModel(params?: { modelId?: string }): Promise<FotosLLMStatus> {
    await this.ensureInitialized();
    const modelId = params?.modelId ?? this.loadedModelId;

    if (modelId) {
      await this.platform.unloadLocalModel?.(modelId);
    }

    this.loadedModelId = null;
    return this.status();
  }

  async comparePhotoAnalytics(params: {
    modelId: string;
    snapshot: PhotoAnalyticsSnapshot;
    prompt?: string;
  }): Promise<FotosLLMComparisonResult> {
    await this.ensureInitialized();

    if (this.loadedModelId !== params.modelId) {
      await this.loadModel({ modelId: params.modelId });
    }

    const capabilityService = this.llmManager.getCapabilityService();
    const supportsVision = await capabilityService.supportsVision(params.modelId);
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: 'You are auditing a photo ingestion and analytics pipeline. Keep the answer precise and grounded in the provided evidence.',
      },
      {
        role: 'user',
        content: buildPhotoAnalyticsComparisonPrompt(params.snapshot, {
          customPrompt: params.prompt,
          visionCapable: supportsVision,
        }),
      },
    ];

    const result = await this.llmManager.chat(messages, params.modelId, {
      temperature: 0.15,
      maxTokens: 1200,
      disableTools: true,
    });
    const normalized = normalizeTextResponse(result);
    const models = await this.getRuntimeModelSummaries();
    const modelSummary = models.find((model) => model.modelId === params.modelId);

    return {
      modelId: params.modelId,
      modelName: modelSummary?.name ?? params.modelId,
      comparisonMode: 'structured-snapshot',
      supportsVision,
      imageInputReady: false,
      response: normalized.response,
      thinking: normalized.thinking,
      snapshot: params.snapshot,
    };
  }
}

export const fotosLLMPlan = new FotosLLMPlan();
