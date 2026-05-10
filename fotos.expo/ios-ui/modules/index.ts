/**
 * Module exports for iOS - re-exported from @vger/vger.core
 *
 * IMPORTANT: Use direct imports to avoid bundling Node.js-only modules (like BaileysModule)
 * that Metro can't tree-shake from barrel exports.
 */

export { CoreModule } from '@vger/vger.core/modules/CoreModule.js';
export { IndexModule } from '@vger/vger.core/modules/IndexModule.js';
export { AIModule, type LLMConfigAdapter } from '@vger/vger.core/modules/AIModule.js';
export { ChatModule } from '@vger/vger.core/modules/ChatModule.js';
export { ConnectionModule } from '@vger/vger.core/modules/ConnectionModule.js';
export { TrustModule } from '@vger/vger.core/modules/TrustModule.js';
export { MemoryModule } from '@vger/vger.core/modules/MemoryModule.js';
export { AnalysisModule } from '@vger/vger.core/modules/AnalysisModule.js';
export { DeviceModule } from '@vger/vger.core/modules/DeviceModule.js';
export { MCPModule } from '@vger/vger.core/modules/MCPModule.js';
export { JournalModule } from '@vger/vger.core/modules/JournalModule.js';
export { InstanceModule } from '@vger/vger.core/modules/InstanceModule.js';
export { KnowledgeNavigatorModule } from '@vger/vger.core/modules/KnowledgeNavigatorModule.js';

// iOS-specific modules
export {
  LocalModelModule,
  LocalModelPlan,
  AVAILABLE_MODELS,
  type LocalModelInfo,
  type ModelState,
  type ModelStatus,
  type ProgressCallback
} from './LocalModelModule';
