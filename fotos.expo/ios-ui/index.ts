/**
 * VGER iOS UI Layer
 *
 * Exports the main Model class for iOS platform
 */

import type Model from './Model';

export { default as Model } from './Model';
export type { default as ModelType } from './Model';

// Global model instance
let globalModel: Model | null = null;

export function setGlobalModel(model: Model): void {
  globalModel = model;
}

export function getModel(): Model | null {
  return globalModel;
}

// Public runtime surfaces used by the Fotos app.
export { ModelProvider, useModel } from './hooks/ModelContext';
export { useContactsPlan } from './hooks/useContactsPlan';
export type { UseContactsPlanReturn, Contact } from './hooks/useContactsPlan';
export { useConnectionPlan } from './hooks/useConnectionPlan';
export type { UseConnectionPlanReturn, DeviceConnection } from './hooks/useConnectionPlan';
export { useAuth } from './hooks/useAuth';
export type { UseAuthReturn } from './hooks/useAuth';
export { useDevices } from './hooks/useDevices';
export type { TrustLevel, RegisteredDevice, DiscoveredDevice, CollectedPeer } from './hooks/useDevices';
export { useInstances } from './hooks/useInstances';
export type { UseInstancesReturn, InstanceEntry } from './hooks/useInstances';
export { TabScreenLayout, HEADER_HEIGHT, TAB_BAR_HEIGHT } from './components/TabScreenLayout';
export type { TabScreenLayoutProps } from './components/TabScreenLayout';
export { DiscoveryCollectionAdapter } from './services/DiscoveryCollectionAdapter';
export type { DiscoveryCollectionAdapterDeps } from './services/DiscoveryCollectionAdapter';
