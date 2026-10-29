import { NativeEventEmitter, NativeModules } from 'react-native';
import type { EmitterSubscription } from 'react-native';

import type { ChatMessage } from '@vger/vger.core/services/llm-platform.js';
import type { ModelState } from './LocalModelModule';

export interface MLXGenerationOptions {
  maxNewTokens?: number;
  temperature?: number;
  topP?: number;
}

export interface VGERMLXNativeModule {
  addListener(eventType: string): void;
  removeListeners(count: number): void;
  isAvailable(): Promise<boolean>;
  getUnavailableReason(): Promise<string | null>;
  getModelState(modelId: string): Promise<ModelState>;
  downloadModel(modelId: string): Promise<ModelState>;
  deleteModel(modelId: string): Promise<ModelState>;
  loadModel(modelId: string): Promise<ModelState>;
  unloadModel(): Promise<void>;
  generateResponse(
    modelId: string,
    prompt: string,
    options?: MLXGenerationOptions
  ): Promise<string>;
  generateChatCompletion(
    modelId: string,
    messages: ChatMessage[],
    options?: MLXGenerationOptions
  ): Promise<string>;
}

interface MLXProgressEvent {
  modelId: string;
  progress: number;
}

interface MLXTokenEvent {
  modelId: string;
  token: string;
}

const nativeModule = NativeModules.VGERMLXModule as VGERMLXNativeModule | undefined;

export function getVGERMLXModule(): VGERMLXNativeModule {
  if (!nativeModule) {
    throw new Error(
      'VGERMLXModule is not linked. Rebuild the iOS app after adding the MLX Swift native bridge.'
    );
  }
  return nativeModule;
}

export function isVGERMLXModuleLinked(): boolean {
  return !!nativeModule;
}

function createEmitter(): NativeEventEmitter {
  const module = getVGERMLXModule();
  return new NativeEventEmitter(module);
}

export function addMLXDownloadProgressListener(
  modelId: string,
  onProgress: (progress: number) => void
): EmitterSubscription {
  return createEmitter().addListener('VGERMLXDownloadProgress', (event: MLXProgressEvent) => {
    if (event.modelId === modelId) {
      onProgress(event.progress);
    }
  });
}

export function addMLXTokenListener(
  modelId: string,
  onToken: (token: string) => void
): EmitterSubscription {
  return createEmitter().addListener('VGERMLXToken', (event: MLXTokenEvent) => {
    if (event.modelId === modelId) {
      onToken(event.token);
    }
  });
}
