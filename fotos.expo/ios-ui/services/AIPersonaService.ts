/**
 * AIPersonaService - Generate AI persona using local Granite model
 *
 * Uses AICreationService from vger.core with LocalModelPlan for on-device inference.
 */

import { AICreationService, type CreationContext, type CreationResult } from '@vger/vger.core/services/AICreateService.js';
import type { LocalModelPlan } from '../modules/LocalModelModule';
import { AVAILABLE_MODELS } from '../modules/LocalModelModule';
import * as Device from 'expo-constants';
import { Platform, NativeModules } from 'react-native';

// Get device locale from native modules
function getDeviceLocale(): string {
  try {
    if (Platform.OS === 'ios') {
      return NativeModules.SettingsManager?.settings?.AppleLocale ||
             NativeModules.SettingsManager?.settings?.AppleLanguages?.[0] ||
             'en';
    }
    return NativeModules.I18nManager?.localeIdentifier || 'en';
  } catch {
    return 'en';
  }
}

/**
 * Generate AI persona name and email using local Granite model
 *
 * @param localModelPlan - LocalModelPlan instance for inference
 * @param modelId - Model ID to use (e.g., 'granite-350m')
 * @returns CreationResult with name, email, and creationContext
 */
export async function generateAIPersona(
  localModelPlan: LocalModelPlan,
  modelId: string
): Promise<CreationResult> {
  console.log('[AIPersonaService] Generating AI persona with model:', modelId);

  // Build creation context from device info
  const context: CreationContext = {
    device: Device.default.deviceName || 'iOS-Device',
    locale: getDeviceLocale(),
    time: new Date(),
    app: 'VGER'
  };

  console.log('[AIPersonaService] Creation context:', context);

  // Find model info
  const modelInfo = AVAILABLE_MODELS.find(m => m.id === modelId);
  if (!modelInfo) {
    throw new Error(`[AIPersonaService] Unknown model: ${modelId}`);
  }

  // Ensure model is loaded
  if (!localModelPlan.isModelLoaded() || localModelPlan.getLoadedModelId() !== modelId) {
    console.log('[AIPersonaService] Loading model...');
    await localModelPlan.loadModel(modelInfo);
  }

  // Create AICreationService with local model chat function
  const creationService = new AICreationService(async (messages, _reqModelId) => {
    // Convert chat messages to single prompt for transformers.js
    const promptParts: string[] = [];
    for (const msg of messages) {
      if (msg.role === 'system') {
        promptParts.push(msg.content);
      } else if (msg.role === 'user') {
        promptParts.push(`\n${msg.content}`);
      }
    }
    const prompt = promptParts.join('\n');

    console.log('[AIPersonaService] Generating name with prompt length:', prompt.length);

    const response = await localModelPlan.generateResponse(prompt, {
      maxNewTokens: 64,  // Short response for name generation
      temperature: 0.8,  // Some creativity for unique names
    });

    console.log('[AIPersonaService] Raw response:', response);
    return response;
  });

  // Generate the name
  const result = await creationService.generateName(context, modelId);
  console.log('[AIPersonaService] Generated persona:', result.name, result.email);

  return result;
}
