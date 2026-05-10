# vger.core Modules

For the fotos-specific runtime cut and dependency spine, see [vger-core-fotos-module-cut.md](/Users/gecko/src/fotos/fotos.expo/docs/vger-core-fotos-module-cut.md).

This inventory is based on:

- `../vger/packages/vger.core/src/modules/index.ts`
- `../vger/packages/vger.core/src/modules/*.ts`

At the moment, `vger.core` contains 22 module classes:

- 21 barrel-exported modules through `@vger/vger.core/modules`
- 1 direct-import-only module: `BaileysModule`

## Quick Scan

### Barrel exports

- `AIModule`
- `AgentAssistantModule`
- `AgentCapabilityModule`
- `AnalysisModule`
- `ChatModule`
- `CodingModule`
- `ConnectionModule`
- `CoreModule`
- `DeviceModule`
- `IndexModule`
- `InstanceModule`
- `JournalModule`
- `KnowledgeNavigatorModule`
- `MCPModule`
- `MemoryModule`
- `OrchestrationModule`
- `Phase2WritebackModule`
- `PlanAutomationModule`
- `TrustModule`
- `TrustPdfModule`
- `WorkspaceFilesModule`

### Direct import only

- `BaileysModule`

## Detailed Inventory

## AIModule
- Barrel export: yes
- File: `src/modules/AIModule.ts`
- Purpose: LLM configuration, AI plans, topic analysis plumbing, and AI message listener setup.
- Demands: `LeuteModel`, `ChannelManager`, `TopicModel`, `Settings`, `TrustPlan`, `JournalPlan`, `OneCore`, `TopicAnalysisModel`, `StoryFactory`, `SettingsPlan`, `SecretsPlan`, `LLMManager`, `ChatTrieManager`, `AgentCapabilityService`, `PersistentTagIndexService`, `TagBindingService`, `TopicDimension`, `ContactDimension`, `MeaningPlan`, `EventRecordingPlan`, `ChatPlan`, `FileSystemOps`, `EmbeddingIndex`, `SemanticTrie`, `AgentRuntimeManifest`, `InterpreterBookPlan`, `MemoryAdminPlan`
- Supplies: `AIPlan`, `AIAssistantPlan`, `TopicAnalysisPlan`, `LLMPlan`, `LLMConfigPlan`, `ProposalsPlan`, `KeywordDetailPlan`, `WordCloudSettingsPlan`, `CryptoPlan`, `AuditPlan`, `SubjectsPlan`, `LLMManager`, `LLMObjectManager`, `AIObjectManager`, `GlobalLLMSettingsManager`, `AIMessageListener`

## AgentAssistantModule
- Barrel export: yes
- File: `src/modules/AgentAssistantModule.ts`
- Purpose: Agent-side assistant plan that bridges AI, memory, workspace, and git-aware codebook materialization.
- Demands: `OneCore`, `AIAssistantPlan`, `TopicAnalysisModel`, `AgentCapabilityService`, `CoreMemoryPlan`, `SettingsPlan`, `ChatPlan`, `WorkspaceRoot`, `GitSourceService`
- Supplies: `AgentAssistantPlan`

## AgentCapabilityModule
- Barrel export: yes
- File: `src/modules/AgentCapabilityModule.ts`
- Purpose: Capability, tag, governance, and effective-access services for agent behavior control.
- Demands: `OneCore`, `ChatTrieManager`, `ConnectionPlan`
- Supplies: `PersistentTagIndexService`, `PersistentTagGovernanceService`, `PersistentEffectiveAccessService`, `FilterModel`, `TagBindingService`, `TagApprovalService`, `AgentCapabilityService`, `AgentCapabilityEvolutionControlPlan`, `AgentCapabilityMeasurementAgent`

## AnalysisModule
- Barrel export: yes
- File: `src/modules/AnalysisModule.ts`
- Purpose: Topic analysis infrastructure and keyword dimension support for memories and documents.
- Demands: `TopicModel`, `ChatTrieManager`, `StoryFactory`
- Supplies: `TopicAnalysisModel`, `TopicKeywordDimension`

## BaileysModule
- Barrel export: no
- File: `src/modules/BaileysModule.ts`
- Purpose: WhatsApp integration via Baileys; intentionally excluded from the standard barrel export.
- Demands: `LeuteModel`, `ChannelManager`, `TopicModel`, `OneCore`, `TopicDimension`
- Supplies: `BaileysConnectionPlan`, `BaileysMessagePlan`, `BaileysClient`

## ChatModule
- Barrel export: yes
- File: `src/modules/ChatModule.ts`
- Purpose: Chat, groups, contacts, trie management, and feed-forward collaboration flows.
- Demands: `LeuteModel`, `TopicModel`, `OneCore`, `ExportPlan`, `TrustPlan`, `AIAssistantPlan`, `ContactDimension`, `TopicDimension`, `AgentCapabilityService`, `SyncEventBus`, `StoryFactory`
- Supplies: `ChatPlan`, `ChatTrieManager`, `GroupPlan`, `ContactsPlan`, `FeedForwardPlan`

## CodingModule
- Barrel export: yes
- File: `src/modules/CodingModule.ts`
- Purpose: Coding plans plus artifact, diff, worktree, and phase-2 projection helpers.
- Demands: `OneCore`, `GitSourceService`
- Supplies: `CodingPlan`, `CodingRunPlan`, `AgentOrchestrationRecorder`, `CodingArtifactStore`, `CodingPhase2Projector`, `CodingDemandContextBuilder`, `CodingWorktreeDiffProbe`, `CodingWorktreeStateProbe`, `CodingWorkspaceIsolator`

## ConnectionModule
- Barrel export: yes
- File: `src/modules/ConnectionModule.ts`
- Purpose: Peer discovery, pairing, sync/trust coordination, transport matching, and live connection state.
- Demands: `OneCore`, `LeuteModel`, `TopicModel`, `ChatPlan`, `GroupPlan`, `TrustPlan`, `BridgeReady`, `QuicVCProvider`, `TrustModel`, `SyncRules`, `SettingsPlan`, `ChatTrieManager`, `TransportMatcher`
- Supplies: `ConnectionModule`, `ConnectionsModel`, `ConnectionPlan`, `GroupChatPlan`, `DiscoveryService`, `SyncEventBus`

## CoreModule
- Barrel export: yes
- File: `src/modules/CoreModule.ts`
- Purpose: Foundational ONE-core-facing models: people, channels, topics, and settings.
- Demands: `OneCore`, `Settings`, `TopicDimension`, `ChatTrieManager`
- Supplies: `LeuteModel`, `ChannelManager`, `TopicModel`, `Settings`

## DeviceModule
- Barrel export: yes
- File: `src/modules/DeviceModule.ts`
- Purpose: Device discovery and device/network information plans.
- Demands: `OneCore`, `DiscoveryService`
- Supplies: `NetworkDeviceInfoPlan`, `DevicePlan`, `DeviceDiscoveryPlan`

## IndexModule
- Barrel export: yes
- File: `src/modules/IndexModule.ts`
- Purpose: Dimensional indexes for contacts and topics.
- Demands: `LeuteModel`, `TopicModel`
- Supplies: `ContactDimension`, `TopicDimension`

## InstanceModule
- Barrel export: yes
- File: `src/modules/InstanceModule.ts`
- Purpose: Instance registry for IoM/IoP views across local and remote devices.
- Demands: `ConnectionPlan`, `ConnectionsModel`, `TrustPlan`, `LeuteModel`
- Supplies: `InstanceRegistryPlan`

## JournalModule
- Barrel export: yes
- File: `src/modules/JournalModule.ts`
- Purpose: Assembly indexing, journal/event recording, and assembly dimension support.
- Demands: `OneCore`, `LeuteModel`, `StoryFactory`
- Supplies: `AssemblyPlan`, `AssemblyListener`, `AssemblyDimension`, `JournalPlan`, `EventRecordingPlan`

## KnowledgeNavigatorModule
- Barrel export: yes
- File: `src/modules/KnowledgeNavigatorModule.ts`
- Purpose: Knowledge navigator plan plus subject-memory support over analysis, meaning, and memory services.
- Demands: `TopicAnalysisModel`, `MeaningPlan`, `LLMManager`, `LeuteModel`, `ChatPlan`, `KnowledgeAssembly`, `SubjectsPlan`, `EmbeddingPipeline`, `CoreMemoryPlan`, `AIAssistantPlan`, `MemoryStorageHandler`
- Supplies: `KnowledgeNavigatorPlan`, `SubjectMemoryPlan`

## MCPModule
- Barrel export: yes
- File: `src/modules/MCPModule.ts`
- Purpose: Remote MCP client support for browser/mobile-style platforms.
- Demands: `LeuteModel`, `ChatPlan`
- Supplies: `MCPDemandManager`, `MCPRemoteClient`

## MemoryModule
- Barrel export: yes
- File: `src/modules/MemoryModule.ts`
- Purpose: Memory ingestion, recall, semantic trie, and chat-memory/book services.
- Demands: `ChannelManager`, `TopicAnalysisModel`, `SubjectsPlan`, `OneCore`, `LeuteModel`, `AuditService`, `StoryFactory`, `MeaningPlan`, `FileSystemOps`, `ExportDirectories`, `SettingsPlan`, `AIAssistantPlan`, `ChatPlan`, `JournalPlan`, `ChatTrieManager`, `TopicDimension`, `AgentCapabilityService`, `LLMManager`, `WikipediaPipelinePlan`, `WebSourceOperation`, `YouTubeSourceOperation`
- Supplies: `MemoryPlan`, `CoreMemoryPlan`, `ChatMemoryPlan`, `ChatMemoryService`, `SessionMemoryPlan`, `RecallPlan`, `SemanticTrie`, `ChatBookPlan`

## OrchestrationModule
- Barrel export: yes
- File: `src/modules/OrchestrationModule.ts`
- Purpose: Executable plan manager and orchestration glue for AI/coding demand fulfillment.
- Demands: `SettingsPlan`, `AgentCapabilityService`, `AIAssistantPlan`, `AgentAssistantPlan`, `AgentContainerProvisioner`, `CodingArtifactStore`, `CodingDemandContextBuilder`, `CodingWorktreeDiffProbe`, `CodingWorktreeStateProbe`, `CodingWorkspaceIsolator`, `Phase2WritebackPlan`, `CodingRunPlan`, `AgentOrchestrationRecorder`, `DemandFulfillment`, `SubstrateRestart`
- Supplies: `ExecutablePlanManager`

## Phase2WritebackModule
- Barrel export: yes
- File: `src/modules/Phase2WritebackModule.ts`
- Purpose: Phase-2 writeback plan driven by the coding projector.
- Demands: `CodingPhase2Projector`
- Supplies: `Phase2WritebackPlan`

## PlanAutomationModule
- Barrel export: yes
- File: `src/modules/PlanAutomationModule.ts`
- Purpose: Triggered automation runner that reacts to chat/activity and invokes executable plans.
- Demands: `ChatTrieManager`, `StoryFactory`, `AIAssistantPlan`, `AgentCapabilityService`, `ExecutablePlanManager`
- Supplies: `TriggeredPlanRunner`

## TrustModule
- Barrel export: yes
- File: `src/modules/TrustModule.ts`
- Purpose: Trust and identity model/plan wiring.
- Demands: `LeuteModel`, `StoryFactory`
- Supplies: `TrustModel`, `TrustPlan`

## TrustPdfModule
- Barrel export: yes
- File: `src/modules/TrustPdfModule.ts`
- Purpose: PDF certificate registry plus certificate/signing plans.
- Demands: `PdfCertificateProvider`, `PdfSigningProvider`
- Supplies: `PdfCertificateRegistryModel`, `PdfCertificatePlan`, `PdfSigningPlan`

## WorkspaceFilesModule
- Barrel export: yes
- File: `src/modules/WorkspaceFilesModule.ts`
- Purpose: Workspace-bounded file access plan built on injected filesystem operations.
- Demands: `FileSystemOps`, `WorkspaceRoot`
- Supplies: `WorkspaceFilesPlan`
