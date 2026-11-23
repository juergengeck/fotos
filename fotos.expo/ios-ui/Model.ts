import { createFotosRuntimeModules } from './fotos-runtime-modules';
import { getFotosRuntimeRecipeConfig } from './fotos-runtime-recipes';
/** Fotos mobile runtime: identity, trust, connections, settings and gallery sync. */
import MultiUser from '@refinio/one.models/lib/models/Authenticator/MultiUser.js';
import { OEvent } from '@refinio/one.models/lib/misc/OEvent.js';

// ONE.core imports for StoryFactory and instance info
import { storeVersionedObject, getObjectByIdHash } from '@refinio/one.core/lib/storage-versioned-objects.js';
import { getObject, storeUnversionedObject } from '@refinio/one.core/lib/storage-unversioned-objects.js';
import { getOnlyLatestReferencingObjsHashAndId } from '@refinio/one.core/lib/reverse-map-query.js';
import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Instance, Person } from '@refinio/one.core/lib/recipes.js';
import { onChumImportBatch } from '@refinio/one.core/lib/chum-sync.js';
import { getInstanceIdHash, getInstanceOwnerIdHash } from '@refinio/one.core/lib/instance.js';
import { createCryptoApiFromDefaultKeys } from '@refinio/one.core/lib/keychain/keychain.js';
import { calculateHashOfObj, calculateIdHashOfObj } from '@refinio/one.core/lib/util/object.js';

// Device management - Device.displayName is source of truth for mDNS name
import {
    DevicePlan,
    DevicesPlan,
    registerDevicesPlan,
    type Device,
} from '@refinio/device.core';

// Instance tracking - creates retroactive assemblies for Instance and Owner
import { InstancePlan } from '@vger/vger.core/plans/InstancePlan.js';

import { ModuleRegistry, initializeModuleGraph } from '@refinio/api/plan-system';

import { ExportPlan } from '@vger/vger.core/plans/ExportPlan.js';
import { registerDeviceSettings } from '@refinio/settings.devices';
import {
    getFotosPlatformCapabilities,
    getFotosPlatformDefaults,
    type FotosInstancePlatform,
    type FotosPlatformCapabilities,
} from '../src/mobile-platform';

import { fotosContentRules } from '@refinio/fotos.core/sync-rules';
// Settings.core recipes and storage (for IoM-compatible settings)
import {
    SettingsPlan,
    SettingsPlanMetadata,
    SecretsPlan,
    SecretsPlanMetadata,
    InstanceSettingsStorage,
    registerBuiltInSettings,
} from '@refinio/settings.core';
import { normalizeFotosSettingsSection, registerFotosSettings } from './fotos-settings';

// Module system
import { operationRegistry } from '@refinio/api/registry';

// iOS-specific mDNS discovery provider (matches vger.cube's MDNSDiscoveryAdapter)
import { iOSMDNSDiscoveryAdapter, type iOSMDNSConfig } from './services/iOSMDNSDiscoveryAdapter';
import {
    getDiscoveryCollectionSettings,
    getPersistedDiscoveryEnabled,
    readDiscoveryEnabledFromSettings,
} from './services/discovery-settings';
import {
    FotosMediaLibrarySync,
    type FotosSharedFileImportSummary,
    type FotosPhotoLibrarySyncSummary,
} from './services/FotosMediaLibrarySync';
import type { FotosShareInboxStatus } from './services/FotosShareInbox';

// Discovery collection adapter (verified peer discovery)
import { DiscoveryCollectionAdapter } from './services/DiscoveryCollectionAdapter';

interface ModelOptions {
    webUrl?: string;
    storageDirectory?: string;
    localDeviceType?: string;
    localInstancePlatform?: FotosInstancePlatform;
    defaultDeviceDisplayName?: string;
    defaultInstanceName?: string;
    appLabel?: string;
}

type ResolvedModelOptions = Required<ModelOptions>;

interface InitializedModuleRegistry {
    getModule(moduleName: string): any;
    getStoryFactory?: () => any;
    shutdownAll(): Promise<void>;
}

function getDefaultModelOptions(): ResolvedModelOptions {
    return {
        webUrl: 'https://fotos.one',
        ...getFotosPlatformDefaults(),
    };
}

// =============================================================================
// MODEL CLASS
// =============================================================================

/**
 * Model - Fotos mobile runtime
 *
 * Uses modular architecture with ModuleRegistry.
 * Modules handle their own initialization and dependencies.
 */
export default class Model {
    public onOneModelsReady = new OEvent<() => void>();
    public onTopicsChanged = new OEvent<() => void>();
    public onContactsChanged = new OEvent<() => void>();
    public onConnectionsChanged = new OEvent<() => void>();
    public initialized: boolean = false;

    // ownerId and instanceId are available from ONE.core after login
    get ownerId(): string | undefined { return getInstanceOwnerIdHash(); }
    get instanceId(): string | undefined { return getInstanceIdHash(); }

    private moduleRegistry: InitializedModuleRegistry | null = null;
    private modules: Map<string, any> = new Map();
    private readonly runtimeCore: Record<string, any>;
    private runtimeCoreInitialized = false;
    private readonly webUrl: string;
    private readonly modelOptions: ResolvedModelOptions;
    private readonly currentPlatformCapabilities: FotosPlatformCapabilities;

    // MultiUser instance (ONE.core authentication and storage)
    public one: MultiUser;

    // Discovery collection adapter (verified peer discovery via handshake)
    private discoveryCollectionAdapter: DiscoveryCollectionAdapter | null = null;

    // Settings storage (lazy initialized)
    private _settingsStorage: InstanceSettingsStorage | null = null;
    private _settingsPlan: SettingsPlan | null = null;
    private _secretsPlan: SecretsPlan | null = null;
    private _devicesPlan: DevicesPlan | null = null;
    private _fotosMediaLibrarySync: FotosMediaLibrarySync | null = null;
    private settingsUnsubscribe: (() => void) | null = null;
    private lastDiscoveryEnabled: boolean | null = null;

    constructor(
        private commServerUrl: string,
        webUrlOrOptions: string | ModelOptions = 'https://fotos.one'
    ) {
        const options = typeof webUrlOrOptions === 'string'
            ? { webUrl: webUrlOrOptions }
            : webUrlOrOptions;

        this.currentPlatformCapabilities = getFotosPlatformCapabilities();
        this.modelOptions = {
            ...getDefaultModelOptions(),
            ...options,
        };
        this.webUrl = this.modelOptions.webUrl;
        this.runtimeCore = this.createRuntimeCore();

        console.log(`[Model] Constructing ${this.modelOptions.appLabel} Model (Modular Architecture)...`);
        console.log('[Model] Runtime platform:', this.currentPlatformCapabilities.platformLabel);
        console.log('[Model] CommServer URL:', commServerUrl);
        console.log('[Model] Web URL:', this.webUrl);

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
            get platformCapabilities() { return model.currentPlatformCapabilities; },
            get instanceModule() { return model.modules.get('instance'); },
            get settingsPlan() { return model._settingsPlan ?? undefined; },
            get secretsPlan() { return model._secretsPlan ?? undefined; },
            get devicesPlan() { return model._devicesPlan ?? undefined; },
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
        return new MultiUser({
            directory: this.modelOptions.storageDirectory,
            ...getFotosRuntimeRecipeConfig(),
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

            this.moduleRegistry = await this.initializeRuntime();
            this.bindInitializedModules(this.moduleRegistry);
            this.runtimeCoreInitialized = true;

            // Verify critical modules are initialized
            this.verifyCriticalModules();

            // Configure InstanceModule with local instance info
            this.configureInstanceModule();

            // PHASE 5: Post-init lifecycle
            await this.postInit(instanceName);

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

    private async initializeRuntime(): Promise<ModuleRegistry> {
        await this.supplySettingsPlan();
        const discoveryEnabled = this.currentPlatformCapabilities.supportsLocalNetworkDiscovery
            ? await getPersistedDiscoveryEnabled({ settingsPlan: this._settingsPlan }) : false;
        this.lastDiscoveryEnabled = discoveryEnabled;
        const {modules, connection} = createFotosRuntimeModules(this.commServerUrl, this.webUrl);
        // ConnectionModule requires chat/group plans for pairing and group sync.
        // AI, memory, inference, agent and IMAP modules are not part of this graph.
        return initializeModuleGraph({
            registry: new ModuleRegistry(operationRegistry),
            modules,
            supplies: {
                OneCore: this.runtimeCore,
                ExportPlan: new ExportPlan(),
                SettingsPlan: this._settingsPlan,
                SecretsPlan: this._secretsPlan,
                DevicesPlan: this._devicesPlan,
                SyncRules: fotosContentRules,
                PostStoreImportBatch: onChumImportBatch,
            },
            storageFunction: storeVersionedObject,
            beforeInit: async () => {
                if (this.currentPlatformCapabilities.supportsLocalNetworkDiscovery) {
                    connection.setLocalDiscoveryProvider(
                        new iOSMDNSDiscoveryAdapter(await this.buildMDNSConfig()), discoveryEnabled);
                }
            },
        });
    }

    /**
     * Create the shared `settings`, `secrets`, and `devices` plans.
     * The retained modules consume these plans through ModuleRegistry demands.
     */
    private async supplySettingsPlan(): Promise<void> {
        const instanceId = this.instanceId;
        if (!instanceId) {
            throw new Error('[Model] Cannot create SettingsPlan - instanceId not available');
        }

        // Register dynamic settings sections before creating storage.
        registerBuiltInSettings();
        registerDeviceSettings();
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
            ...(this.currentPlatformCapabilities.supportsUdpHandshake ? { quicvcPort: 49497 } : {}),
            capabilities: this.currentPlatformCapabilities.supportsUdpHandshake ? ['quicvc'] : [],
        };
    }

    private bindInitializedModules(registry: InitializedModuleRegistry): void {
        const requiredModules = {
            core: 'CoreModule',
            assembly: 'AssemblyModule',
            trust: 'TrustModule',
            chat: 'ChatModule',
            connection: 'ConnectionModule',
            device: 'DeviceModule',
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
                ['settings', 'secrets', 'devices', 'connections', 'trust'],
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

        // Initialize discovery collection adapter
        console.log('[Model] Initializing discovery collection adapter...');
        await this.initializeDiscoveryCollection();
        console.log('[Model] Discovery collection adapter initialized');

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
            await this.moduleRegistry?.shutdownAll();

            this.initialized = false;
            this.runtimeCoreInitialized = false;
            this.moduleRegistry = null;
            this.modules.clear();
            this._settingsStorage = null;
            this._settingsPlan = null;
            this._secretsPlan = null;
            this._devicesPlan = null;
            this._fotosMediaLibrarySync = null;
            // Note: ownerId/instanceId are getters from ONE.core - cleared automatically on logout
            this.lastDiscoveryEnabled = null;

            console.log('[Model] Shutdown complete');
        } catch (error) {
            console.error('[Model] Shutdown error:', error);
            throw error;
        }
    }

    // --- Core Module ---
    get leuteModel() { return this.modules.get('core').leuteModel; }
    get channelManager() { return this.modules.get('core').channelManager; }
    get topicModel() { return this.modules.get('core').topicModel; }
    get connections() { return this.modules.get('connection').connectionsModel; }
    get settings() { return this.modules.get('core').settings; }
    /** Topic update events from CoreModule - emits topicId when messages change (via CHUM or local) */

    // --- Trust Module ---
    get trustModel() { return this.modules.get('trust').trustModel; }
    get trustPlan() { return this.modules.get('trust').trustPlan; }

    get chatPlan() { return this.modules.get('chat')?.chatPlan; }
    get contactsPlan() { return this.modules.get('chat')?.contactsPlan; }

    // --- Connection Module ---
    get connectionPlan() { return this.modules.get('connection')?.connectionPlan; }
    get groupChatPlan() { return this.modules.get('connection')?.groupChatPlan; }
    get discoveryService() { return this.modules.get('connection')?.discoveryService; }

    // --- Device Module ---
    get devicePlan() { return this.modules.get('device')?.devicePlan; }

    // --- Instance Module ---
    get instanceRegistryPlan() { return this.modules.get('instance')?.instanceRegistryPlan; }

    get platformCapabilities(): FotosPlatformCapabilities {
        return this.currentPlatformCapabilities;
    }

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

    get fotosMediaLibrarySync(): FotosMediaLibrarySync | null {
        if (!this.initialized) {
            return null;
        }

        if (!this._fotosMediaLibrarySync) {
            this._fotosMediaLibrarySync = new FotosMediaLibrarySync({
                calculateIdHashOfObj: async (obj) => await calculateIdHashOfObj(obj as any) as string,
                getObjectByIdHash: async (idHash) => await getObjectByIdHash(idHash as any),
                storeVersionedObject: async (obj) => await storeVersionedObject(obj as any) as any,
                getInstanceId: () => this.instanceId,
                getOwnerId: () => this.ownerId,
                getIntakeMode: async () => normalizeFotosSettingsSection(
                    (await this._settingsPlan?.getSection({ moduleId: 'fotos' }))?.values,
                ).defaultMode,
            });
        }

        return this._fotosMediaLibrarySync;
    }

    async syncRecentPhotoLibraryAssets(limit?: number): Promise<FotosPhotoLibrarySyncSummary> {
        const service = this.fotosMediaLibrarySync;
        if (!service) {
            throw new Error('[Model] Photo-library sync is unavailable before runtime initialization');
        }

        return service.syncRecentAssets(limit);
    }

    async syncPhotoLibraryAssetsById(assetIds: string[]): Promise<FotosPhotoLibrarySyncSummary> {
        const service = this.fotosMediaLibrarySync;
        if (!service) {
            throw new Error('[Model] Photo-library sync is unavailable before runtime initialization');
        }

        return service.syncAssetIds(assetIds);
    }

    async getPendingSharedInboxStatus(): Promise<FotosShareInboxStatus> {
        const service = this.fotosMediaLibrarySync;
        if (!service) {
            throw new Error('[Model] Share inbox is unavailable before runtime initialization');
        }

        return service.getShareInboxStatus();
    }

    async importPendingSharedInbox(): Promise<FotosSharedFileImportSummary> {
        const service = this.fotosMediaLibrarySync;
        if (!service) {
            throw new Error('[Model] Share inbox is unavailable before runtime initialization');
        }

        return service.importPendingSharedInbox();
    }

}
