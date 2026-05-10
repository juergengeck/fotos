/**
 * VGER iOS Model - Modular Architecture
 *
 * Orchestrates module lifecycle using demand/supply pattern:
 *
 * PHASE 1: Supply platform adapters (IOSLLMPlatform, ExportPlan, MeaningPlan, etc.)
 * PHASE 2: Register modules (CoreModule, AIModule, ChatModule, etc.)
 * PHASE 3: Setup providers (mDNS config, discovery service)
 * PHASE 4: Initialize all modules (topological sort, dependency injection)
 * PHASE 5: Post-init (instance assemblies, topic analysis, AI listener, discovery collection)
 *
 * For class-based Model, the phases map to:
 * - constructor: Phase 1 (supply adapters) + Phase 2 (register modules)
 * - init(): Phase 3 (setup providers) -> Phase 4 (initAll) -> Phase 5 (post-init)
 */

import MultiUser from '@refinio/one.models/lib/models/Authenticator/MultiUser.js';
import { OEvent } from '@refinio/one.models/lib/misc/OEvent.js';
import RecipesStable from '@refinio/one.models/lib/recipes/recipes-stable.js';
import RecipesExperimental from '@refinio/one.models/lib/recipes/recipes-experimental.js';
import GlueContentRecipes from '@glueone/glue.core/recipes/GlueContentRecipes.js';
import {
    ReverseMapsStable,
    ReverseMapsForIdObjectsStable
} from '@refinio/one.models/lib/recipes/reversemaps-stable.js';
import {
    ReverseMapsExperimental,
    ReverseMapsForIdObjectsExperimental
} from '@refinio/one.models/lib/recipes/reversemaps-experimental.js';

// ONE.core imports for StoryFactory and instance info
import { storeVersionedObject, getObjectByIdHash } from '@refinio/one.core/lib/storage-versioned-objects.js';
import { getObject, storeUnversionedObject } from '@refinio/one.core/lib/storage-unversioned-objects.js';
import { getOnlyLatestReferencingObjsHashAndId } from '@refinio/one.core/lib/reverse-map-query.js';
import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Instance, Person } from '@refinio/one.core/lib/recipes.js';
import { getInstanceIdHash, getInstanceOwnerIdHash } from '@refinio/one.core/lib/instance.js';
import { createCryptoApiFromDefaultKeys } from '@refinio/one.core/lib/keychain/keychain.js';
import { calculateHashOfObj, calculateIdHashOfObj } from '@refinio/one.core/lib/util/object.js';

// Device management - Device.displayName is source of truth for mDNS name
import {
    DeviceCoreRecipes,
    DeviceCoreReverseMaps,
    DevicePlan,
    DevicesPlan,
    registerDevicesPlan,
    type Device,
} from '@refinio/device.core';

// Instance tracking - creates retroactive assemblies for Instance and Owner
import { InstancePlan } from '@vger/vger.core/plans/InstancePlan.js';

// MeaningPlan - semantic similarity plan for KnowledgeNavigatorModule
// On iOS, created without MeaningDimension/EmbeddingProvider (gracefully degrades).
// When iOS gains embedding support, call meaningPlan.setDimension() to activate.
import { MeaningPlan } from '@vger/vger.core/plans/MeaningPlan.js';
import { registerVgerCoreSettings } from '@vger/vger.core/settings';
import {
    initializeMobileLibraryModules,
    shutdownModules,
    type InitResult,
    type PlatformAdapters,
    type ModuleInitializationProfile,
    getLocalInstancePlanTypesForProfile,
} from '@vger/vger.core/initialization/initializeMobileLibraryModules.js';

import { VGER_CORE_RECIPES } from '@vger/vger.core/recipes';

// Assembly recipes - use local lenient StoryRecipe (allows optional product)
import { StoryRecipe } from './recipes/StoryRecipe';
import { AssemblyRecipe, TraceContentRecipe } from '@refinio/assembly.core/recipes';

// Plan recipe from refinio.api
import { PlanRecipe } from '@refinio/api/recipes';

// Trust.core recipes
import { AllRecipes as TrustCoreRecipes, AllReverseMaps as TrustCoreReverseMaps } from '@refinio/trust.core/recipes/index.js';

// Cube.core recipes
import { CubeCoreRecipes } from '@refinio/cube.core';

// Meaning.core recipes for semantic embedding dimension
import { MeaningCoreRecipes } from '@refinio/meaning.core/recipes/index.js';

import { SourceImapRecipes } from '@refinio/source.imap/recipes';
import { contentRules } from '@refinio/sync.core/rules/default-rules.js';
import { FotosRecipes } from '@refinio/fotos.core';

// Settings.core recipes and storage (for IoM-compatible settings)
import {
    SettingsRecipes,
    SettingsPlan,
    SettingsPlanMetadata,
    SecretsPlan,
    SecretsPlanMetadata,
    InstanceSettingsStorage,
} from '@refinio/settings.core';
import { registerFotosSettings } from './fotos-settings';

// Module system
import { operationRegistry } from '@refinio/api/registry';
import { DeviceModule } from '@vger/vger.core/modules/DeviceModule.js';
import { MCPModule } from '@vger/vger.core/modules/MCPModule.js';
import { LocalModelModule } from './modules/LocalModelModule';
import { registerExpoImapSourceOperation } from './plans/imap-source';

// iOS-specific adapters for AIModule
import { IOSLLMPlatform } from '../adapters/ios-llm-platform';
import { iosOllamaValidator, iosConfigManager } from '../adapters/ios-llm-config';

// iOS-specific mDNS discovery provider (matches vger.cube's MDNSDiscoveryAdapter)
import { iOSMDNSDiscoveryAdapter, type iOSMDNSConfig } from './services/iOSMDNSDiscoveryAdapter';
import {
    getDiscoveryCollectionSettings,
    getPersistedDiscoveryEnabled,
    readDiscoveryEnabledFromSettings,
} from './services/discovery-settings';

// IngestionPlan from memory.core (platform-agnostic)
import { IngestionPlan } from '@refinio/memory.core';

// Discovery collection adapter (verified peer discovery)
import { DiscoveryCollectionAdapter } from './services/DiscoveryCollectionAdapter';

interface ModelOptions {
    webUrl?: string;
    storageDirectory?: string;
    localDeviceType?: string;
    localInstancePlatform?: 'ios' | 'cube' | 'browser' | 'headless' | 'html' | 'fire' | 'unknown';
    moduleProfile?: ModuleInitializationProfile;
    defaultDeviceDisplayName?: string;
    defaultInstanceName?: string;
    appLabel?: string;
}

type ResolvedModelOptions = Required<ModelOptions>;

interface InitializedModuleRegistry {
    getModule(moduleName: string): any;
    getStoryFactory?: () => any;
}

const DEFAULT_MODEL_OPTIONS: ResolvedModelOptions = {
    webUrl: 'https://fotos.one',
    storageDirectory: 'fotos.ios.storage',
    localDeviceType: 'ios',
    localInstancePlatform: 'ios',
    moduleProfile: 'mobile-library',
    defaultDeviceDisplayName: 'fotos iOS',
    defaultInstanceName: 'fotos-ios',
    appLabel: 'fotos iOS',
};

// =============================================================================
// MODEL CLASS
// =============================================================================

/**
 * Model - Main model class for VGER iOS
 *
 * Uses modular architecture with ModuleRegistry.
 * Modules handle their own initialization and dependencies.
 */
export default class Model {
    public onOneModelsReady = new OEvent<() => void>();
    public onContactsChanged = new OEvent<() => void>();
    public onTopicsChanged = new OEvent<() => void>();
    public onConnectionsChanged = new OEvent<() => void>();
    public initialized: boolean = false;

    // Topic name cache - O(1) lookup, populated at init, updated on topic changes
    private topicNameCache = new Map<string, string>();

    // ownerId and instanceId are available from ONE.core after login
    get ownerId(): string | undefined { return getInstanceOwnerIdHash(); }
    get instanceId(): string | undefined { return getInstanceIdHash(); }

    private moduleRegistry: InitializedModuleRegistry | null = null;
    private modules: Map<string, any> = new Map();
    private readonly runtimeCore: Record<string, any>;
    private runtimeCoreInitialized = false;
    private readonly webUrl: string;
    private readonly modelOptions: ResolvedModelOptions;

    // MultiUser instance (ONE.core authentication and storage)
    public one: MultiUser;

    // iOS-specific adapters (kept as references for post-init wiring)
    // Initialized in supplyPlatformAdapters() called from constructor
    private iosLlmPlatform!: IOSLLMPlatform;
    private localModelModule!: LocalModelModule;
    private meaningPlan!: MeaningPlan;
    private initResult: InitResult | null = null;

    // Discovery collection adapter (verified peer discovery via handshake)
    private discoveryCollectionAdapter: DiscoveryCollectionAdapter | null = null;

    // Ingestion plan (created lazily after initialization)
    private _ingestionPlan: InstanceType<typeof IngestionPlan> | null = null;

    // Settings storage (lazy initialized)
    private _settingsStorage: InstanceSettingsStorage | null = null;
    private _settingsPlan: SettingsPlan | null = null;
    private _secretsPlan: SecretsPlan | null = null;
    private _devicesPlan: DevicesPlan | null = null;
    private _imapSourcePlan: ReturnType<typeof registerExpoImapSourceOperation> | null = null;
    private settingsUnsubscribe: (() => void) | null = null;
    private lastDiscoveryEnabled: boolean | null = null;

    constructor(
        private commServerUrl: string,
        webUrlOrOptions: string | ModelOptions = 'https://vger.one'
    ) {
        const options = typeof webUrlOrOptions === 'string'
            ? { webUrl: webUrlOrOptions }
            : webUrlOrOptions;

        this.modelOptions = {
            ...DEFAULT_MODEL_OPTIONS,
            ...options,
        };
        this.webUrl = this.modelOptions.webUrl;
        this.runtimeCore = this.createRuntimeCore();

        console.log(`[Model] Constructing ${this.modelOptions.appLabel} Model (Modular Architecture)...`);
        console.log('[Model] CommServer URL:', commServerUrl);
        console.log('[Model] Web URL:', this.webUrl);

        this.iosLlmPlatform = new IOSLLMPlatform();
        this.localModelModule = new LocalModelModule();
        this.meaningPlan = new MeaningPlan();
        this.modules.set('localModel', this.localModelModule);

        // Setup ONE.core MultiUser with all recipes
        this.one = this.createMultiUser();

        // Setup login/logout handlers
        this.one.onLogin(this.init.bind(this));
        this.one.onLogout(this.shutdown.bind(this));

        console.log('[Model] Construction complete - waiting for login');
    }

    private createRuntimeCore(): Record<string, any> {
        const model = this;
        return {
            get initialized() { return model.runtimeCoreInitialized; },
            get ownerId() { return getInstanceOwnerIdHash(); },
            get instanceId() { return getInstanceIdHash(); },
            get instanceName() { return model.modelOptions.defaultInstanceName; },
            get instanceModule() { return model.modules.get('instance'); },
            get settingsPlan() { return model._settingsPlan ?? undefined; },
            get secretsPlan() { return model._secretsPlan ?? undefined; },
            get devicesPlan() { return model._devicesPlan ?? undefined; },
            get localModelPlan() { return model.localModelModule.localModelPlan; },
            getInfo: () => ({
                ownerId: getInstanceOwnerIdHash(),
                initialized: model.initialized,
            }),
            storeVersionedObject,
            storeUnversionedObject,
            getObjectByIdHash,
            getObject,
            calculateHashOfObj,
            calculateIdHashOfObj,
        };
    }

    /**
     * Create MultiUser instance with all recipes.
     */
    private createMultiUser(): MultiUser {
        const recipeGroups: Array<{ name: string; recipes: any[] }> = [
            { name: 'one.models/stable', recipes: RecipesStable },
            { name: 'one.models/experimental', recipes: RecipesExperimental },
            { name: 'glue.core/content', recipes: GlueContentRecipes },
            { name: 'vger.core', recipes: VGER_CORE_RECIPES },
            { name: 'assembly.core', recipes: [StoryRecipe, AssemblyRecipe, TraceContentRecipe] },
            { name: 'refinio.api', recipes: [PlanRecipe] },
            { name: 'trust.core', recipes: TrustCoreRecipes as any[] },
            { name: 'cube.core', recipes: CubeCoreRecipes },
            { name: 'meaning.core', recipes: MeaningCoreRecipes },
            { name: 'device.core', recipes: DeviceCoreRecipes },
            { name: 'source.imap', recipes: SourceImapRecipes },
            { name: 'settings.core', recipes: SettingsRecipes },
            { name: 'fotos.core', recipes: FotosRecipes as any[] },
        ];

        const recipes: any[] = [];
        for (const group of recipeGroups) {
            if (!Array.isArray(group.recipes)) {
                throw new Error(`[Model] Recipe group ${group.name} is not an array`);
            }

            group.recipes.forEach((recipe, index) => {
                if (recipe === undefined) {
                    throw new Error(`[Model] Recipe ${group.name}[${index}] is undefined`);
                }
                if (recipe === null || typeof recipe !== 'object') {
                    throw new Error(`[Model] Recipe ${group.name}[${index}] is not an object`);
                }
                if (recipe.$type$ !== 'Recipe') {
                    throw new Error(`[Model] Recipe ${group.name}[${index}] has invalid $type$: ${String(recipe.$type$)}`);
                }
                if (typeof recipe.name !== 'string' || recipe.name.length === 0) {
                    throw new Error(`[Model] Recipe ${group.name}[${index}] has invalid name`);
                }
                if (!Array.isArray(recipe.rule)) {
                    throw new Error(`[Model] Recipe ${group.name}[${index}] (${recipe.name}) has invalid rule`);
                }
                recipes.push(recipe);
            });
        }

        const recipeNames = recipes.map((recipe) => recipe.name);
        const nameCounts = new Map<string, number>();
        for (const name of recipeNames) {
            nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
        }
        const duplicateNames = [...nameCounts.entries()].filter(([, count]) => count > 1);
        if (duplicateNames.length > 0) {
            throw new Error(`[Model] Duplicate recipes detected: ${duplicateNames.map(([name]) => name).join(', ')}`);
        }

        return new MultiUser({
            directory: this.modelOptions.storageDirectory,
            recipes,
            reverseMaps: new Map([
                ...ReverseMapsStable,
                ...ReverseMapsExperimental,
                ...TrustCoreReverseMaps,
                ...(DeviceCoreReverseMaps || []),
                ['LLM', new Set(['owner'])],
                ['AI', new Set(['owner'])]
            ]) as any,
            reverseMapsForIdObjects: new Map([
                ...ReverseMapsForIdObjectsStable,
                ...ReverseMapsForIdObjectsExperimental
            ]),
            storageInitTimeout: 20000
        });
    }

    // =========================================================================
    // PHASE 3-5: INITIALIZATION (called on login)
    // =========================================================================

    async init(instanceName?: string, _secret?: string): Promise<void> {
        if (this.initialized) {
            throw new Error('Model already initialized');
        }

        try {
            console.log('[Model] ===== Initializing all modules =====');

            const adapters = await this.createPlatformAdapters(instanceName);
            const result = await initializeMobileLibraryModules(adapters);
            this.initResult = result;
            this.moduleRegistry = result.registry;
            this.bindInitializedModules(result.registry);
            this.runtimeCoreInitialized = true;

            // Verify critical modules are initialized
            this.verifyCriticalModules();

            // Configure InstanceModule with local instance info
            this.configureInstanceModule();

            // PHASE 5: Post-init lifecycle
            await this.postInit(instanceName);

            // Register local IMAP query surfaces over synced storage.
            this._imapSourcePlan = registerExpoImapSourceOperation();

            // Mark as initialized
            this.initialized = true;
            console.log(`[Model] Owner ID: ${this.ownerId?.substring(0, 8)}...`);

            // Emit onOneModelsReady event
            this.onOneModelsReady.emit();

            console.log('[Model] ===== Initialization complete =====');
        } catch (error) {
            console.error('[Model] Initialization failed:', error);
            this.initialized = false;
            this.runtimeCoreInitialized = false;
            throw error;
        }
    }

    // =========================================================================
    // PHASE 3: SETUP PROVIDERS
    // =========================================================================

    /**
     * Create the shared platform adapter object consumed by vger.core's
     * demand/supply module initializer.
     */
    private async createPlatformAdapters(instanceName?: string): Promise<PlatformAdapters> {
        console.log('[Model] Phase 3: Preparing shared platform adapters...');

        await this.supplySettingsPlan();
        const mdnsConfig = await this.buildMDNSConfig();
        const discoveryEnabled = await getPersistedDiscoveryEnabled({
            settingsPlan: this._settingsPlan,
        });
        this.lastDiscoveryEnabled = discoveryEnabled;

        const adapters: PlatformAdapters = {
            platform: this.modelOptions.localInstancePlatform,
            oneCore: this.runtimeCore,
            llmPlatform: this.iosLlmPlatform,
            llmConfigAdapter: { ollamaValidator: iosOllamaValidator, configManager: iosConfigManager },
            commServerUrl: this.commServerUrl,
            webUrl: this.webUrl,
            settingsPlan: this._settingsPlan,
            secretsPlan: this._secretsPlan,
            devicesPlan: this._devicesPlan,
            instanceId: this.instanceId as SHA256IdHash<Instance> | undefined,
            instanceName: instanceName || this.modelOptions.defaultInstanceName,
            storageFunction: storeVersionedObject,
            additionalSupplies: {
                MeaningPlan: this.meaningPlan,
                SyncRules: contentRules,
            },
            additionalModules: [
                new DeviceModule(),
                new MCPModule(),
                this.localModelModule,
            ],
            beforeInit: async (_registry: any, connectionModule: any) => {
                this.wireLocalModelPlan();
                const mdnsAdapter = new iOSMDNSDiscoveryAdapter(mdnsConfig);
                connectionModule.setLocalDiscoveryProvider(mdnsAdapter, discoveryEnabled);
                console.log(`[Model] mDNS discovery provider set on ConnectionModule (autoStart=${discoveryEnabled})`);
            },
            contextProvider: {
                getDeviceName: async () => this.modelOptions.defaultDeviceDisplayName,
                getLocale: () => 'en',
            },
            options: {
                disableWhatsApp: true,
                deviceType: this.modelOptions.localDeviceType,
                enableGlueServices: true,
            },
        };

        if (!adapters.settingsPlan || !adapters.secretsPlan || !adapters.devicesPlan) {
            throw new Error('[Model] Shared settings, secrets, and devices plans must be created before module init');
        }

        console.log('[Model] Phase 3 complete');
        return adapters;
    }

    /**
     * Create the shared `settings`, `secrets`, and `devices` plans.
     * The plans are fed into initializeModules() so AI/Memory/Connection
     * consume the same public plan surfaces via ModuleRegistry demands.
     */
    private async supplySettingsPlan(): Promise<void> {
        const instanceId = this.instanceId;
        if (!instanceId) {
            throw new Error('[Model] Cannot create SettingsPlan - instanceId not available');
        }

        // Register dynamic settings sections before creating storage.
        registerVgerCoreSettings();
        registerFotosSettings();

        const storage = new InstanceSettingsStorage({
            instanceIdHash: instanceId as SHA256IdHash<Instance>,
            ownerPersonIdHash: this.ownerId as SHA256IdHash<Person> | undefined,
        });
        const settingsPlan = new SettingsPlan(storage);
        const secretsPlan = new SecretsPlan();
        const devicesPlan = new DevicesPlan({
            getDevicePlan: () => this.devicePlan,
            getOwnerPersonIdHash: () => this.ownerId as SHA256IdHash<Person> | undefined,
            getCurrentInstanceIdHash: () => this.instanceId as SHA256IdHash<Instance> | undefined,
            getCurrentDevicePlatform: () => 'mobile',
        });

        this._settingsStorage = storage;
        this._settingsPlan = settingsPlan;
        this._secretsPlan = secretsPlan;
        this._devicesPlan = devicesPlan;
        operationRegistry.register('settings', settingsPlan, SettingsPlanMetadata);
        operationRegistry.register('secrets', secretsPlan, SecretsPlanMetadata);
        registerDevicesPlan(operationRegistry, devicesPlan);

        console.log('[Model] SettingsPlan, SecretsPlan, and DevicesPlan prepared');
    }

    /**
     * Build mDNS discovery config from ONE.core identity.
     * Uses Device.displayName as the source of truth for mDNS name.
     */
    private async buildMDNSConfig(): Promise<iOSMDNSConfig> {
        const ownerId = this.ownerId;
        const instanceId = this.instanceId;
        if (!ownerId || !instanceId) {
            throw new Error('[Model] Cannot build mDNS config - ownerId or instanceId not available');
        }

        const cryptoApi = await createCryptoApiFromDefaultKeys(instanceId as SHA256IdHash<Instance>);
        const pubKeyHex = Array.from(cryptoApi.publicEncryptionKey)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
        console.log('[Model] Got mDNS encryption public key:', pubKeyHex.substring(0, 16) + '...');

        const { getInstanceOwnerEmail } = await import('@refinio/one.core/lib/instance.js');
        const email = getInstanceOwnerEmail();

        // Get or create local Device - displayName is the source of truth for mDNS name
        const devicePlan = new DevicePlan({
            storeVersionedObject,
            getObjectByIdHash,
            getObject,
            getReverseMapEntries: async (key: any, type: string) => {
                return await getOnlyLatestReferencingObjsHashAndId(key, type as any);
            }
        });

        const localDeviceResult = await devicePlan.getOrCreateLocalDevice(
            instanceId as SHA256IdHash<Instance>,
            ownerId as SHA256IdHash<Person>,
            this.modelOptions.defaultDeviceDisplayName
        );

        if (!localDeviceResult.success || !localDeviceResult.device) {
            throw new Error(`[Model] Failed to get/create local device for mDNS: ${localDeviceResult.error}`);
        }

        const displayName = localDeviceResult.device.displayName;
        console.log(`[Model] Local Device: ${localDeviceResult.created ? 'created' : 'found'}, displayName="${displayName}"`);

        return {
            deviceId: instanceId,
            pubKey: pubKeyHex,
            personId: ownerId,
            ...(email ? { email } : {}),
            displayName,
            deviceType: this.modelOptions.localDeviceType,
            quicvcPort: 49497,
            capabilities: ['quicvc'],
        };
    }

    /**
     * Wire LocalModelPlan to IOSLLMPlatform before initAll().
     * This allows AIModule.init() to discover installed models via platform.
     */
    private wireLocalModelPlan(): void {
        if (this.localModelModule.localModelPlan && this.iosLlmPlatform) {
            this.iosLlmPlatform.setLocalModelPlan(this.localModelModule.localModelPlan);
            console.log('[Model] LocalModelPlan wired to IOSLLMPlatform');
        }
    }

    private bindInitializedModules(registry: InitializedModuleRegistry): void {
        const requiredModules = {
            core: 'CoreModule',
            index: 'IndexModule',
            trust: 'TrustModule',
            journal: 'JournalModule',
            analysis: 'AnalysisModule',
            memory: 'MemoryModule',
            knowledgeNavigator: 'KnowledgeNavigatorModule',
            chat: 'ChatModule',
            ai: 'AIModule',
            connection: 'ConnectionModule',
            device: 'DeviceModule',
            mcp: 'MCPModule',
            instance: 'InstanceModule',
        } as const;

        const nextModules = new Map<string, any>();
        for (const [alias, moduleName] of Object.entries(requiredModules)) {
            const module = registry.getModule(moduleName);
            if (!module) {
                throw new Error(`[Model] ${moduleName} was not initialized by the shared module graph`);
            }
            nextModules.set(alias, module);
        }
        nextModules.set('localModel', this.localModelModule);
        this.modules = nextModules;
    }

    /**
     * Verify critical modules are initialized correctly.
     */
    private verifyCriticalModules(): void {
        const chatModule = this.modules.get('chat');
        if (!chatModule?.chatPlan) {
            console.error('[Model] ChatModule.chatPlan is undefined after init!');
            console.error('[Model] ChatModule exists:', !!chatModule);
            console.error('[Model] ChatModule keys:', chatModule ? Object.keys(chatModule) : 'N/A');
            throw new Error('ChatModule initialization failed - chatPlan is undefined');
        }
        console.log('[Model] ChatModule.chatPlan verified');
    }

    /**
     * Configure InstanceModule with local instance info.
     */
    private configureInstanceModule(): void {
        const instanceModule = this.modules.get('instance');
        if (instanceModule && this.instanceId) {
            instanceModule.setLocalInstance(
                this.instanceId as any,
                this.modelOptions.localInstancePlatform,
                getLocalInstancePlanTypesForProfile(this.modelOptions.moduleProfile),
                this.modelOptions.defaultDeviceDisplayName
            );
            console.log('[Model] InstanceModule configured');
        }
    }

    // =========================================================================
    // PHASE 5: POST-INIT
    // =========================================================================

    /**
     * Post-initialization tasks after all modules are ready.
     * Creates assemblies, starts listeners, initializes discovery.
     */
    private async postInit(instanceName?: string): Promise<void> {
        console.log('[Model] Phase 5: Post-init...');

        // Create retroactive Assemblies for Instance and Owner
        await this.createInstanceAssemblies(instanceName);

        // Wire up event emitters from ConnectionModule to Model
        this.wireConnectionEvents();
        this.wireDiscoverySettings();

        // Build topic name cache for instant O(1) lookups
        console.log('[Model] Building topic name cache...');
        await this.buildTopicNameCache();
        console.log('[Model] Topic name cache ready');

        // Initialize discovery collection adapter
        console.log('[Model] Initializing discovery collection adapter...');
        await this.initializeDiscoveryCollection();
        console.log('[Model] Discovery collection adapter initialized');

        // Initialize topic analysis (creates TopicAnalysisModel, ProposalsPlan, etc.)
        console.log('[Model] Initializing topic analysis...');
        const aiModule = this.modules.get('ai');
        await aiModule.initTopicAnalysis();
        console.log('[Model] Topic analysis initialized');

        if (!this.initResult) {
            throw new Error('[Model] Shared module init result missing before data load');
        }
        console.log('[Model] Loading shared AI/Memory data...');
        await this.initResult.startListeners();
        console.log('[Model] Shared AI/Memory data loaded');

        // Scan existing AI conversations
        console.log('[Model] Scanning existing AI conversations...');
        const registeredCount = await this.aiAssistantPlan.scanExistingConversations();
        console.log(`[Model] Registered ${registeredCount} existing AI topics`);

        // Start AI message listener
        console.log('[Model] Starting AI message listener...');
        await aiModule.startMessageListener(this.ownerId);
        console.log('[Model] AI message listener started');

        console.log('[Model] Phase 5 complete');
    }

    /**
     * Create retroactive Assemblies for Instance and Owner (bootstrap problem).
     * Instance and Owner were created before StoryFactory existed.
     */
    private async createInstanceAssemblies(instanceName?: string): Promise<void> {
        try {
            const storyFactory = this.moduleRegistry?.getStoryFactory?.();
            if (!storyFactory || !this.ownerId || !this.instanceId) {
                console.warn('[Model] Cannot record instance creation - missing StoryFactory or IDs');
                return;
            }

            const instancePlan = new InstancePlan({
                storyFactory: storyFactory as any,
                ownerId: this.ownerId as any,
                instanceId: this.instanceId as any,
                instanceName: instanceName || this.modelOptions.defaultInstanceName
            });
            await instancePlan.init();
            await instancePlan.recordInstanceCreation();
            console.log('[Model] Instance and Owner assemblies created in journal');
        } catch (error) {
            console.error('[Model] Failed to record instance creation:', error);
            // Non-critical - continue without instance assembly
        }
    }

    /**
     * Wire up event emitters from ConnectionModule to Model.
     */
    private wireConnectionEvents(): void {
        const connectionModule = this.modules.get('connection');
        connectionModule.onContactsChanged(() => this.onContactsChanged.emit());
        connectionModule.onTopicsChanged(async () => {
            // Rebuild topic name cache BEFORE emitting event to avoid race conditions
            await this.buildTopicNameCache().catch(e => console.error('[Model] Failed to rebuild topic cache:', e));
            this.onTopicsChanged.emit();
        });
        connectionModule.onConnectionsChanged(() => this.onConnectionsChanged.emit());
    }

    /**
     * Keep local mDNS runtime state fed from settings.core.
     */
    private wireDiscoverySettings(): void {
        if (!this._settingsPlan) {
            throw new Error('[Model] Cannot wire discovery settings without SettingsPlan');
        }
        const discoveryService = this.discoveryService;
        if (!discoveryService) {
            throw new Error('[Model] Cannot wire discovery settings without DiscoveryService');
        }

        this.settingsUnsubscribe?.();
        this.settingsUnsubscribe = this._settingsPlan.subscribe((settings) => {
            const enabled = readDiscoveryEnabledFromSettings(settings);
            if (enabled === this.lastDiscoveryEnabled) {
                return;
            }

            this.lastDiscoveryEnabled = enabled;
            if (enabled) {
                discoveryService.start({ methods: ['local'] });
            } else {
                discoveryService.stop();
            }
            console.log(`[Model] mDNS discovery ${enabled ? 'enabled' : 'disabled'} from settings.core`);
        });
    }

    /**
     * Initialize discovery collection adapter with required dependencies.
     */
    private async initializeDiscoveryCollection(): Promise<void> {
        try {
            const coreModule = this.modules.get('core');

            if (!coreModule?.leuteModel || !this.discoveryService) {
                console.warn('[Model] Cannot initialize discovery collection - missing dependencies');
                console.warn('[Model] leuteModel:', !!coreModule?.leuteModel);
                console.warn('[Model] discoveryService:', !!this.discoveryService);
                return;
            }

            // Get cryptoApi from ONE.core keychain
            const instanceId = getInstanceIdHash();
            if (!instanceId) {
                console.warn('[Model] Cannot initialize discovery collection - instanceId not available');
                return;
            }

            const cryptoApi = await createCryptoApiFromDefaultKeys(instanceId);
            if (!cryptoApi) {
                console.warn('[Model] Cannot initialize discovery collection - cryptoApi not available');
                return;
            }
            console.log('[Model] Got cryptoApi from keychain for instance:', instanceId.substring(0, 8));

            this.discoveryCollectionAdapter = new DiscoveryCollectionAdapter({
                cryptoApi,
                leuteModel: coreModule.leuteModel,
                discoveryService: this.discoveryService,
                getSettings: async () => getDiscoveryCollectionSettings({
                    settingsPlan: this._settingsPlan,
                }),
            });

            await this.discoveryCollectionAdapter.initialize();
        } catch (error) {
            console.error('[Model] Failed to initialize discovery collection:', error);
            // Non-critical - continue without discovery collection
        }
    }

    // =========================================================================
    // SHUTDOWN
    // =========================================================================

    async shutdown(): Promise<void> {
        console.log('[Model] Shutting down...');

        try {
            // Shutdown discovery collection adapter
            if (this.discoveryCollectionAdapter) {
                await this.discoveryCollectionAdapter.shutdown();
                this.discoveryCollectionAdapter = null;
            }
            this.settingsUnsubscribe?.();
            this.settingsUnsubscribe = null;

            // Shutdown all modules in reverse order through the shared init context.
            await shutdownModules();

            this.initialized = false;
            this.runtimeCoreInitialized = false;
            this.moduleRegistry = null;
            this.initResult = null;
            this.modules.clear();
            this.modules.set('localModel', this.localModelModule);
            this._settingsStorage = null;
            this._settingsPlan = null;
            this._secretsPlan = null;
            this._devicesPlan = null;
            // Note: ownerId/instanceId are getters from ONE.core - cleared automatically on logout
            this.lastDiscoveryEnabled = null;

            console.log('[Model] Shutdown complete');
        } catch (error) {
            console.error('[Model] Shutdown error:', error);
            throw error;
        }
    }

    // =========================================================================
    // TOPIC NAME CACHE
    // =========================================================================

    /**
     * Get topic display name from cache - O(1) lookup.
     * Returns the cached display name, or a truncated hash if not found.
     */
    getTopicName(topicId: string): string {
        return this.topicNameCache.get(topicId) || `Chat ${topicId.substring(0, 8)}`;
    }

    /**
     * Build topic name cache from TopicRegistry.
     * Uses allWithIdHash() to avoid recomputing hashes.
     * Called at init and when topics change.
     */
    async buildTopicNameCache(): Promise<void> {
        if (!this.topicModel) {
            console.warn('[Model] Cannot build topic name cache - topicModel not ready');
            return;
        }

        try {
            const startTime = Date.now();
            const topicsWithIds = await this.topicModel.topics.allWithIdHash();

            this.topicNameCache.clear();
            for (const { topic, idHash } of topicsWithIds) {
                const name = topic.displayName ?? topic.originalName ?? `Chat ${String(idHash).substring(0, 8)}`;
                this.topicNameCache.set(String(idHash), name);
            }

            console.log(`[Model] Topic name cache built: ${this.topicNameCache.size} topics in ${Date.now() - startTime}ms`);
        } catch (error) {
            console.error('[Model] Failed to build topic name cache:', error);
        }
    }

    /**
     * Update a single topic in the cache (called when topic is renamed)
     */
    updateTopicNameCache(topicId: string, displayName: string): void {
        this.topicNameCache.set(topicId, displayName);
    }

    // =========================================================================
    // GLUE.ONE SHARING
    // =========================================================================

    /**
     * Share a message to the glue.one public topic.
     * The glue topic has demandsTrustLevel: 'none' making it publicly accessible.
     */
    async shareToGlue(message: {
        id: string;
        text: string;
        senderName: string;
        topicName?: string;
    }): Promise<{ success: boolean; error?: string }> {
        try {
            // Get glue topic ID from AIAssistantPlan's topic manager
            let glueTopicId = this.aiAssistantPlan?.getGlueTopicId();

            if (!glueTopicId) {
                // Ensure default chats are created (includes glue topic)
                await this.aiAssistantPlan?.ensureDefaultChats?.();
                glueTopicId = this.aiAssistantPlan?.getGlueTopicId();
            }

            if (!glueTopicId) {
                return { success: false, error: 'Glue topic not available' };
            }

            // Format the shared content
            let content = message.text;
            if (message.topicName) {
                content = `*Shared from "${message.topicName}"*\n\n${content}`;
            }

            // Post to glue topic via chatPlan
            const result = await this.chatPlan.sendMessage({
                topicId: glueTopicId,
                content,
                senderId: this.ownerId
            });

            return result;
        } catch (error) {
            console.error('[Model] shareToGlue failed:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    // =========================================================================
    // GETTERS: MODULE ACCESSORS
    // =========================================================================

    // --- Core Module ---
    get leuteModel() { return this.modules.get('core').leuteModel; }
    get channelManager() { return this.modules.get('core').channelManager; }
    get topicModel() { return this.modules.get('core').topicModel; }
    get connections() { return this.modules.get('connection').connectionsModel; }
    get settings() { return this.modules.get('core').settings; }
    /** Topic update events from CoreModule - emits topicId when messages change (via CHUM or local) */
    get onTopicUpdated() { return this.modules.get('core').onTopicUpdated; }

    // --- Trust Module ---
    get trustModel() { return this.modules.get('trust').trustModel; }
    get trustPlan() { return this.modules.get('trust').trustPlan; }

    // --- Chat Module ---
    get chatPlan() { return this.modules.get('chat').chatPlan; }
    get groupPlan() { return this.modules.get('chat').groupPlan; }
    get contactsPlan() { return this.modules.get('chat').contactsPlan; }
    get exportPlan() { return this.modules.get('chat').exportPlan; }
    get feedForwardPlan() { return this.modules.get('chat').feedForwardPlan; }
    get topicGroupManager() { return this.modules.get('chat').topicGroupManager; }

    // --- AI Module ---
    get aiPlan() { return this.modules.get('ai').aiPlan; }
    get aiAssistantPlan() { return this.modules.get('ai').aiAssistantPlan; }
    get topicAnalysisPlan() { return this.modules.get('ai').topicAnalysisPlan; }
    get llmConfigPlan() { return this.modules.get('ai').llmConfigPlan; }
    get proposalsPlan() { return this.modules.get('ai').proposalsPlan; }
    get keywordDetailPlan() { return this.modules.get('ai').keywordDetailPlan; }
    get wordCloudSettingsPlan() { return this.modules.get('ai').wordCloudSettingsPlan; }
    get cryptoPlan() { return this.modules.get('ai').cryptoPlan; }
    get auditPlan() { return this.modules.get('ai').auditPlan; }
    get subjectsPlan() { return this.modules.get('ai').subjectsPlan; }
    get llmManager() { return this.modules.get('ai').llmManager; }
    get llmObjectManager() { return this.modules.get('ai').llmObjectManager; }
    get aiObjectManager() { return this.modules.get('ai').aiObjectManager; }
    get aiSettingsManager() { return this.modules.get('ai').aiSettingsManager; }
    get topicAnalysisModel() { return this.modules.get('ai').topicAnalysisModel; }
    get aiMessageListener() { return this.modules.get('ai').aiMessageListener; }

    // --- Connection Module ---
    get connectionPlan() { return this.modules.get('connection')?.connectionPlan; }
    get groupChatPlan() { return this.modules.get('connection')?.groupChatPlan; }
    get discoveryService() { return this.modules.get('connection')?.discoveryService; }

    // --- Device Module ---
    get devicePlan() { return this.modules.get('device')?.devicePlan; }

    // --- MCP Module ---
    get mcpModule() { return this.modules.get('mcp'); }
    get mcpDemandManager() { return this.modules.get('mcp').demandManager; }
    get mcpRemoteClient() { return this.modules.get('mcp').remoteClient; }

    // --- Journal Module ---
    get journalModule() { return this.modules.get('journal'); }
    get journalPlan() { return this.modules.get('journal').journalPlan; }
    get assemblyPlan() { return this.modules.get('journal').assemblyPlan; }
    get assemblyDimension() { return this.modules.get('journal').assemblyDimension; }

    // --- LocalModel Module ---
    get localModelPlan() { return this.modules.get('localModel')?.localModelPlan; }

    // --- Memory Module ---
    get coreMemoryPlan() { return this.modules.get('memory')?.getCoreMemoryPlan(); }
    get memoryTopicsPlan() { return this.modules.get('memory')?.getMemoryTopicsPlan(); }
    get memoryPlan() { return this.memoryTopicsPlan; }
    get chatMemoryPlan() { return this.modules.get('memory')?.chatMemoryPlan; }

    // --- Instance Module ---
    get instanceRegistryPlan() { return this.modules.get('instance')?.instanceRegistryPlan; }

    // --- Explicit public plan accessors ---
    // Expo UI must consume narrow surfaced plans, not the registry itself.
    get imapSourcePlan() { return this._imapSourcePlan ?? undefined; }

    // --- Cube storage / plan ---
    get cubeStorage() { return this.modules.get('ai')?.cubeStorage; }
    get cubePlan() { return this.modules.get('ai')?.cubePlan; }

    // --- Discovery Collection ---
    get discoveryCollection(): DiscoveryCollectionAdapter | null {
        return this.discoveryCollectionAdapter;
    }

    // --- Settings Storage ---
    get instanceSettingsStorage(): InstanceSettingsStorage | undefined {
        return this._settingsStorage ?? undefined;
    }

    // --- Settings Plan ---
    get settingsPlan(): SettingsPlan | undefined {
        return this._settingsPlan ?? undefined;
    }

    get secretsPlan(): SecretsPlan | undefined {
        return this._secretsPlan ?? undefined;
    }

    get devicesPlan(): DevicesPlan | undefined {
        return this._devicesPlan ?? undefined;
    }

    // --- Ingestion Plan (lazy) ---
    get ingestionPlan(): InstanceType<typeof IngestionPlan> | null {
        if (!this.initialized) return null;
        if (!this._ingestionPlan) {
            this._ingestionPlan = new IngestionPlan({
                chatPlan: this.chatPlan,
                leuteModel: this.leuteModel,
                aiAssistantPlan: this.aiAssistantPlan,
                aiPlan: this.aiPlan
            });
        }
        return this._ingestionPlan;
    }
}
