import {DeviceEventEmitter} from 'react-native';
import type {LLMPlatform} from '@refinio/agent.core/services/llm-platform.js';
import type {AIPlanEventEmitter} from '@refinio/agent.core/services/ai-plan-events.js';

/** Native event transport required by the shared initializer. No inference capability is supplied. */
export const firePlatformEvents: LLMPlatform & AIPlanEventEmitter = {
  emitProgress(topicId, progress) {
    DeviceEventEmitter.emit('ai:progress', {topicId, progress});
  },
  emitError(topicId, error) {
    DeviceEventEmitter.emit('ai:error', {topicId, error: error.message});
  },
  emitMessageUpdate(topicId, messageId, content, status, modelId, modelName) {
    DeviceEventEmitter.emit('ai:messageUpdate', {topicId, messageId, content, status, modelId, modelName});
  },
  emitDefaultModelChanged(payload) {
    DeviceEventEmitter.emit('ai:defaultModelChanged', payload);
  },
  emitContactsUpdated() {
    DeviceEventEmitter.emit('contacts:updated');
  },
};
