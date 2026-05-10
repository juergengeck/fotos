/**
 * Type-safe AI event system for React Native
 *
 * Uses centralized event registry from @vger/vger.core/events as source of truth.
 * Provides platform-specific event emission via React Native's DeviceEventEmitter.
 */

import { DeviceEventEmitter } from 'react-native';
import { Events, EventPayloads, EventName } from '@vger/vger.core/events';

// Re-export for convenience
export { Events, EventPayloads, EventName };

/**
 * Type-safe event listener
 */
export type AIEventListener<K extends EventName> = (data: EventPayloads[K]) => void;

/**
 * Emit a type-safe AI event via React Native DeviceEventEmitter
 */
export function emitAIEvent<K extends EventName>(
  eventName: K,
  data: EventPayloads[K]
): void {
  DeviceEventEmitter.emit(eventName, data);
}

/**
 * Add a type-safe AI event listener
 */
export function addAIEventListener<K extends EventName>(
  eventName: K,
  listener: AIEventListener<K>
): () => void {
  const subscription = DeviceEventEmitter.addListener(eventName, listener);

  return () => {
    subscription.remove();
  };
}

/**
 * Remove all listeners for a given AI event type
 */
export function removeAllAIEventListeners<K extends EventName>(
  eventName: K
): void {
  DeviceEventEmitter.removeAllListeners(eventName);
}
