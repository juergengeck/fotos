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

// Hooks for React components
export { ModelProvider, useModel } from './hooks/ModelContext';
export { useTopics } from './hooks/useTopics';
export type { UseTopicsReturn } from './hooks/useTopics';
export { useChatPlan } from './hooks/useChatPlan';
export type { UseChatPlanReturn } from './hooks/useChatPlan';
export { useContactsPlan } from './hooks/useContactsPlan';
export type { UseContactsPlanReturn, Contact } from './hooks/useContactsPlan';
export { useConnectionPlan } from './hooks/useConnectionPlan';
export type { UseConnectionPlanReturn, DeviceConnection } from './hooks/useConnectionPlan';
export { useLLMConfig } from './hooks/useLLMConfig';
export type { UseLLMConfigReturn, LLMModel } from './hooks/useLLMConfig';
export { useMemory } from './hooks/useMemory';
export type { UseMemoryReturn, Subject, Keyword } from './hooks/useMemory';
export { useImapSource } from './hooks/useImapSource';
export type {
  UseImapSourceParams,
  UseImapSourceReturn,
  ImapMailboxRecord,
  ImapThreadTopicRecord,
} from './hooks/useImapSource';
export { useAuth } from './hooks/useAuth';
export type { UseAuthReturn } from './hooks/useAuth';
export { useDevices } from './hooks/useDevices';
export type { TrustLevel, RegisteredDevice, DiscoveredDevice, CollectedPeer } from './hooks/useDevices';
export { useJournal } from './hooks/useJournal';
export type { UseJournalReturn } from './hooks/useJournal';
export { useInstances } from './hooks/useInstances';
export type { UseInstancesReturn, InstanceEntry } from './hooks/useInstances';

// Topic Analysis Hooks (AI message data analytics)
export { useChatSubjects } from './hooks/useChatSubjects';
export type { UseChatSubjectsReturn, ChatSubject } from './hooks/useChatSubjects';
export { useChatKeywords } from './hooks/useChatKeywords';
export type { UseChatKeywordsReturn, ChatKeyword } from './hooks/useChatKeywords';
export { useTopicSummary } from './hooks/useTopicSummary';
export type { UseTopicSummaryReturn, TopicSummary } from './hooks/useTopicSummary';
export { useTopicAnalysis } from './hooks/useTopicAnalysis';
export type { UseTopicAnalysisReturn, AnalysisResult } from './hooks/useTopicAnalysis';

// Components
export { KeywordCloud } from './components/KeywordCloud';
export { SubjectList } from './components/SubjectList';
export { TopicAnalyticsPanel } from './components/TopicAnalyticsPanel';
export { TabScreenLayout, HEADER_HEIGHT, TAB_BAR_HEIGHT } from './components/TabScreenLayout';
export type { TabScreenLayoutProps } from './components/TabScreenLayout';

// Services
export { DiscoveryCollectionAdapter } from './services/DiscoveryCollectionAdapter';
export type { DiscoveryCollectionAdapterDeps } from './services/DiscoveryCollectionAdapter';
