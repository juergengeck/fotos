import { registerDeviceSettings } from '@refinio/settings.devices';
import { createLocalDevicesPlan, type DevicesPlan } from '@refinio/device.core';
/**
 * ONE.core boot module for fotos.browser.
 *
 * Follows the same pattern as glue.browser's bootGlueModel():
 *   1. Create MultiUser with all required recipes
 *   2. Login or register with auto-generated credentials (localStorage/sessionStorage)
 *   3. Initialize ModuleRegistry (CoreModule, ChatModule, IndexModule, TrustModule, ConnectionModule, GlueModule)
 *   4. Activate glue.one only when sync is explicitly enabled
 *   5. Fire-and-forget headless connection when sync is enabled
 *   6. Return FotosModel
 */
import MultiUser from '@refinio/one.models/lib/models/Authenticator/MultiUser.js';

import type LeuteModel from '@refinio/one.models/lib/models/Leute/LeuteModel.js';
import type ConnectionsModel from '@refinio/one.models/lib/models/ConnectionsModel.js';
import type { ConnectionModule as ConnectionModuleType } from '@vger/vger.core/modules/ConnectionModule.js';
import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person } from '@refinio/one.core/lib/recipes.js';
import type { TrustPlan } from '@refinio/trust.core/plans/TrustPlan.js';
import { TRUST_LEVEL_ORDER, type TrustLevel } from '@refinio/trust.core/types/trust-types.js';

// ModuleRegistry + modules
import { ModuleRegistry } from '@refinio/api/plan-system';
import { CoreModule } from '@vger/vger.core/modules/CoreModule.js';
import { ChatModule } from '@vger/vger.core/modules/ChatModule.js';
import { JournalModule } from '@vger/vger.core/modules/JournalModule.js';
import { IndexModule } from '@vger/vger.core/modules/IndexModule.js';
import { TrustModule } from '@vger/vger.core/modules/TrustModule.js';
import { IssuerKeyLifecycleModule } from '@refinio/trust.core/modules/IssuerKeyLifecycleModule.js';
import { InstanceAuthorityModule } from '@refinio/trust.core/modules/InstanceAuthorityModule.js';
import { PersonalTrustModule } from '@refinio/trust.me/modules/PersonalTrustModule.js';
import { preparePersonalTrustStorage } from '@refinio/trust.me/services';
import { ConnectionModule } from '@vger/vger.core/modules/ConnectionModule.js';
import { GlueModule, ensureCommserverEndpointForPerson } from '@vger/vger.glue';
import { ExportPlan } from '@vger/vger.core/plans/ExportPlan.js';

import {
  DEFAULT_GLUE_CONNECTION_BINDING_ID,
} from '@glueone/glue.core';
import {
  InstanceSettingsStorage,
  SettingsPlan,
  registerRefinioSettings,
  registerSubscriptionSettings,
  registerGlueSettings,
} from '@refinio/settings.core';

// ONE.core instance helpers
import { closeInstance, getInstanceIdHash, getInstanceOwnerIdHash } from '@refinio/one.core/lib/instance.js';
import { storeVersionedObject } from '@refinio/one.core/lib/storage-versioned-objects.js';
import { getLocalInstanceOfPerson } from '@refinio/one.models/lib/misc/instance.js';
import { onChumImportBatch } from '@refinio/one.core/lib/chum-sync.js';

import { registerFotosHistorySettings } from './fotosHistorySettings.js';
import { registerFotosSettings } from './fotosSettings.js';
import { fotosContentRules } from './fotosSyncRules.js';
import { API_BASE, COMM_SERVER_URL } from '../config.js';
import { getFotosGlueLogin } from './fotosGlueLogin.js';
import { resolveGluePublicationIdentity } from './glueIdentityState.js';
import {
  FotosOneCoreRecipes,
  FotosReverseMaps,
  FotosReverseMapsForIdObjects,
} from './fotosOneCoreConfig.js';

// ---------------------------------------------------------------------------
// Credentials (auto-generated, stored in localStorage/sessionStorage)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// FotosModel — returned after boot
// ---------------------------------------------------------------------------

export interface FotosModel {
  initialized: boolean;
  headlessConnected: boolean;
  one: MultiUser;
  ownerId: SHA256IdHash<Person> | null;
  publicationIdentity: SHA256IdHash<Person> | null;
  leuteModel: LeuteModel;
  contactsPlan: {
    getContacts?: () => Promise<{
      success: boolean;
      data?: Array<{
        personId?: unknown;
        name?: unknown;
        email?: unknown;
        identity?: unknown;
        createdAt?: unknown;
        updatedAt?: unknown;
      }>;
      error?: string;
    }>;
    listContacts?: (options?: {
      offset?: number;
      limit?: number;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    }) => Promise<{
      success: boolean;
      contacts?: Array<{
        personId?: unknown;
        name?: unknown;
        email?: unknown;
        identity?: unknown;
        createdAt?: unknown;
        updatedAt?: unknown;
      }>;
      error?: string;
    }>;
  };
  connectionsModel: ConnectionsModel | null;
  connectionModule: ConnectionModuleType | null;
  trustPlan: TrustPlan;
  settingsPlan: SettingsPlan;
  devicesPlan: DevicesPlan;
  glueModule: GlueModule | null;
}

// ---------------------------------------------------------------------------
// Module-level singleton state
// ---------------------------------------------------------------------------

let oneInstance: MultiUser | null = null;
let registryInstance: ModuleRegistry | null = null;
let bootPromise: Promise<FotosModel> | null = null;
let closePromise: Promise<void> | null = null;
let runtimeGeneration = 0;
let publicationIdentity: SHA256IdHash<Person> | null = null;

type BrowserGlueModule = GlueModule;

async function getLocalInstanceIdForPerson(personId: string): Promise<string> {
  const localInstanceId = await getLocalInstanceOfPerson(personId as any);
  const normalized = typeof localInstanceId === 'string' ? localInstanceId.trim() : '';
  if (!normalized) {
    throw new Error(`No local instance found for glue person ${personId.substring(0, 12)}`);
  }

  return normalized;
}

// Mutable callback for external state updates (e.g., React)
let modelUpdater: ((fn: (prev: FotosModel | null) => FotosModel | null) => void) | null = null;

/**
 * Set the external model updater callback.
 * Call this from your React hook/context to receive state updates.
 */
export function setModelUpdater(
  updater: ((fn: (prev: FotosModel | null) => FotosModel | null) => void) | null,
): void {
  modelUpdater = updater;
}

/** Drain the module graph while ONE storage is still available. */
function closeFotosRuntime(): Promise<void> {
  if (closePromise) return closePromise;
  // Invalidate connection completions before the first asynchronous teardown.
  runtimeGeneration++;
  const one = oneInstance;
  const registry = registryInstance;
  const closing = (async () => {
    const failures: unknown[] = [];
    try {
      await registry?.shutdownAll();
    } catch (error) {
      failures.push(error);
    }
    let loggedOut = false;
    try {
      if (one?.authState.currentState === 'logged_in') {
        await one.logout();
        loggedOut = true;
      }
    } catch (error) {
      failures.push(error);
    }
    try {
      // initInstance can open storage and unlock keys before publishing its ID.
      // An interrupted login (or logout listener) still belongs to this runtime.
      if (!loggedOut && (one || getInstanceIdHash())) closeInstance();
    } catch (error) {
      failures.push(error);
    } finally {
      oneInstance = null;
      registryInstance = null;
      publicationIdentity = null;
      modelUpdater?.(prev => prev ? { ...prev, initialized: false, headlessConnected: false } : null);
      modelUpdater = null;
    }
    if (failures.length) throw new AggregateError(failures, '[fotos.one] Runtime shutdown failed');
  })().finally(() => {
    if (closePromise === closing) closePromise = null;
  });
  closePromise = closing;
  return closing;
}

export async function shutdownFotosModel(): Promise<void> {
  // A boot owns storage until it either returns a complete graph or cleans up.
  await bootPromise?.catch(() => undefined);
  await closeFotosRuntime();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getConfiguredPublicationIdentity(
  settingsPlan: SettingsPlan,
  ownerId: SHA256IdHash<Person>,
): Promise<{
  publicationIdentity: SHA256IdHash<Person> | null;
  syncEnabled: boolean;
}> {
  try {
    const { values } = await settingsPlan.getSection({ moduleId: 'glue' });
    const configuredPublicationIdentity = resolveGluePublicationIdentity(
      values,
      null,
      DEFAULT_GLUE_CONNECTION_BINDING_ID,
    );
    const syncEnabled = values.syncEnabled === true;

    if (
      !configuredPublicationIdentity ||
      configuredPublicationIdentity === ownerId
    ) {
      return {
        publicationIdentity: null,
        syncEnabled,
      };
    }

    return {
      publicationIdentity: configuredPublicationIdentity as SHA256IdHash<Person>,
      syncEnabled,
    };
  } catch {
    return {
      publicationIdentity: null,
      syncEnabled: false,
    };
  }
}

// ---------------------------------------------------------------------------
// Module init (after ONE.core login)
// ---------------------------------------------------------------------------

async function initModules(
  one: MultiUser,
  commServerUrl: string,
  generation: number,
): Promise<FotosModel> {
  registerSubscriptionSettings();
  registerDeviceSettings();
  registerGlueSettings();
  registerRefinioSettings();
  registerFotosSettings();
  registerFotosHistorySettings();

  const storage = new InstanceSettingsStorage({
    instanceIdHash: getInstanceIdHash()!,
  });
  const settingsPlan = new SettingsPlan(storage);
  const devicesPlan = await createLocalDevicesPlan({ displayName: 'Fotos browser', platform: 'browser' });
  const ownerId = getInstanceOwnerIdHash()! as SHA256IdHash<Person>;
  const glueStartup = await getConfiguredPublicationIdentity(settingsPlan, ownerId);
  const syncEnabled = glueStartup.syncEnabled;
  publicationIdentity = glueStartup.publicationIdentity;

  // ModuleRegistry: CoreModule -> JournalModule -> ChatModule -> IndexModule -> TrustModule -> ConnectionModule -> GlueModule
  const registry = new ModuleRegistry();
  registryInstance = registry;
  registry.setStorageFunction(storeVersionedObject);

  const exportPlan = new ExportPlan();
  const coreModule = new CoreModule(commServerUrl);
  const journalModule = new JournalModule();
  const chatModule = new ChatModule();
  const indexModule = new IndexModule();
  const trustModule = new TrustModule();
  const issuerKeyLifecycleModule = new IssuerKeyLifecycleModule();
  const instanceAuthorityModule = new InstanceAuthorityModule();
  const personalTrustModule = new PersonalTrustModule();
  let connectionModule: ConnectionModuleType | null = null;
  let connectionModuleWithFotos: (ConnectionModuleType & {
    connectToGlueServer?: (personId: SHA256IdHash<Person>) => Promise<void>;
    fotosTrustFilter?: (remotePersonId: SHA256IdHash<Person>) => Promise<boolean>;
  }) | null = null;

  // Lazy proxy for OneCore — getters resolve after module init
  const oneCore = {
    get leuteModel() { return coreModule.leuteModel; },
    get channelManager() { return coreModule.channelManager; },
    get topicModel() { return coreModule.topicModel; },
    get connectionsModel() { return connectionModule?.connectionsModel ?? null; },
    get ownerId() { return getInstanceOwnerIdHash(); },
    get instanceId() { return getInstanceIdHash(); },
    get initialized() { return true; },
    getInfo() { return { initialized: true, ownerId: getInstanceOwnerIdHash() }; },
  };
  registry.supply('OneCore', oneCore);
  // Trust modules compose rules with owner-bound handlers for this runtime.
  registry.supply('SyncRules', new Map(fotosContentRules));
  registry.supply('PostStoreImportBatch', onChumImportBatch);
  registry.supply('SettingsPlan', settingsPlan);
  registry.supply('DevicesPlan', devicesPlan);
  registry.supply('ExportPlan', exportPlan);
  registry.register(coreModule);
  registry.register(journalModule);
  registry.register(chatModule);
  registry.register(indexModule);
  registry.register(trustModule);
  registry.register(issuerKeyLifecycleModule);
  registry.register(instanceAuthorityModule);
  registry.register(personalTrustModule);

  let glueModule: GlueModule | null = null;

  // Keep the app offline unless sync is explicitly enabled.
  if (syncEnabled && publicationIdentity) {
    const nextConnectionModule = new ConnectionModule(
      commServerUrl,
      window.location.origin,
      undefined,
      API_BASE,
    );
    nextConnectionModule.enableCredentialAutoConnect = false;
    nextConnectionModule.addChumSyncRuntimeObjectTypes({
      traceObjectTypes: [
        'FotosShareCertificateChain',
        'FotosShareCertificate',
        'FotosShareManifest',
      ],
    });
    // The authenticated endpoint and route lifecycle belong to ConnectionsModel.
    // Pairing commits the endpoint and releases its CHUM route after access is
    // published. Disabling this owner strands accepted photo invitations.
    nextConnectionModule.setManagedOutgoingConnections(true);
    connectionModule = nextConnectionModule;
    connectionModuleWithFotos = nextConnectionModule as ConnectionModuleType & {
      connectToGlueServer?: (personId: SHA256IdHash<Person>) => Promise<void>;
      fotosTrustFilter?: (remotePersonId: SHA256IdHash<Person>) => Promise<boolean>;
    };
    connectionModuleWithFotos.fotosTrustFilter = async (remotePersonId: SHA256IdHash<Person>) => {
      const trustLevel = (await trustModule.trustModel.getTrustLevelById(remotePersonId) ?? 'unknown') as TrustLevel;
      return trustLevel !== 'ignore' && TRUST_LEVEL_ORDER[trustLevel] >= TRUST_LEVEL_ORDER.low;
    };
    registry.register(connectionModule);

    // GlueModule — presence and peer connections
    glueModule = new GlueModule(API_BASE, commServerUrl);
    glueModule.enableMailboxPairing = false;
    // The Glue authority publishes the shared presence manifest from its
    // authenticated browser connections. A browser writing that same manifest
    // would replace the authority's peer list with its own single entry.
    glueModule.publishOwnPresence = false;

    // Inject browser platform hooks
    const browserGlueModule = glueModule as BrowserGlueModule;
    const gluePublicationIdentity = String(publicationIdentity);
    const gluePublicationInstanceId = await getLocalInstanceIdForPerson(gluePublicationIdentity);
    browserGlueModule.localPersonId = gluePublicationIdentity;
    browserGlueModule.localInstanceId = gluePublicationInstanceId;

    browserGlueModule.onVisibilityChange = (cb: (visible: boolean) => void) => {
      const handler = () => cb(!document.hidden);
      document.addEventListener('visibilitychange', handler);
      return () => document.removeEventListener('visibilitychange', handler);
    };
    browserGlueModule.onBeforeUnload = (cb: () => void) => {
      window.addEventListener('beforeunload', cb);
      return () => window.removeEventListener('beforeunload', cb);
    };
    browserGlueModule.getLocalTransportCapabilities = async () => ['webrtc', 'commserver-relay'];
    browserGlueModule.connectToPeerByKey = (key, ownId, capabilities, remoteId, relayUrl) =>
      nextConnectionModule.connectToPeerByKey(key, ownId as any, capabilities, remoteId as any, undefined, relayUrl);
    browserGlueModule.connectToPeerDirectByKey = (key, ownId, capabilities, remoteId, peerPublicKey) =>
      nextConnectionModule.connectToPeerDirectByKey(
        key, ownId as any, capabilities, remoteId as any, peerPublicKey as any,
      );
    browserGlueModule.connectToPeerRelayByKey = (key, ownId, remoteId, relayUrl) =>
      nextConnectionModule.connectToPeerRelayByKey(key, ownId as any, remoteId as any, undefined, relayUrl);
    browserGlueModule.disconnectPeerRelayByKey = (key, ownId) =>
      nextConnectionModule.disconnectPeerRelayByKey(key, ownId as any);
    browserGlueModule.getBestConnectionLaneHint = async personId => {
      const selection = await nextConnectionModule.getBestConnectionLane({remotePersonId: personId});
      return selection.selected?.routeKey ? {
        source: selection.selected.source,
        routeKey: selection.selected.routeKey,
        transport: selection.selected.transport,
        routeId: selection.selected.routeId,
        relayUrl: selection.selected.relayUrl,
      } : undefined;
    };
    nextConnectionModule.setPeerConnectionDemandProvider({
      requestPeerConnection: personId => browserGlueModule.requestPeerConnectionWithBestKnownLane(personId),
      getPeerConnectionState: personId => browserGlueModule.getPeerConnectionState(personId),
      addPeerConnectionStateListener: listener => browserGlueModule.addPeerConnectionStateListener(listener),
      getWantedPeerIds: () => browserGlueModule.getWantedPeerIds(),
      setWantedPeerIds: personIds => browserGlueModule.setWantedPeerIds(personIds),
      getConnectablePeerIds: () => browserGlueModule.getConnectablePeerIds(),
      getPeerConnectionDebugState: () => browserGlueModule.getPeerConnectionCoordinatorDebug() as any,
      getPassiveDirectConnectionDemands: () => browserGlueModule.getPassiveDirectConnectionDemands() as any,
      getPeerPresenceDebugInfo: personId => browserGlueModule.getPeerPresenceDebugInfo(personId),
      getPresenceDebugSnapshot: limit => browserGlueModule.getPresenceDebugSnapshot(limit),
      getPresenceStoredSnapshot: limit => browserGlueModule.getPresenceStoredSnapshot(limit),
      getPresenceTrace: limit => browserGlueModule.getPresenceTrace(limit),
    });

    // Incoming CHUM admission boundary
    connectionModule.setUnknownPeerIdentityMatcher((remotePersonId, remotePublicKey) => {
      const personId = String(remotePersonId);
      return browserGlueModule.shouldAcceptIncomingPeer?.(personId, remotePublicKey) ?? false;
    });
    nextConnectionModule.setDirectPeerSyncMatcher((remotePersonId, remotePublicKey) =>
      browserGlueModule.shouldAcceptIncomingPeer(String(remotePersonId), remotePublicKey),
    );

    registry.register(glueModule);
  }

  await registry.initAll();

  // Post-init: extract models
  const leuteModel = coreModule.leuteModel;
  const connectionsModel = connectionModule?.connectionsModel ?? null;
  publicationIdentity = (await getConfiguredPublicationIdentity(settingsPlan, ownerId)).publicationIdentity;

  const model: FotosModel = {
    initialized: true,
    headlessConnected: false,
    one,
    ownerId,
    publicationIdentity,
    leuteModel,
    contactsPlan: chatModule.contactsPlan,
    connectionsModel,
    connectionModule,
    trustPlan: trustModule.trustPlan,
    settingsPlan,
    devicesPlan,
    glueModule,
  };

  if (syncEnabled && publicationIdentity && glueModule && connectionModuleWithFotos) {
    registry.supply('GlueOwnerId', String(publicationIdentity));
    registry.supply('PublicationIdentity', String(publicationIdentity));
    await ensureCommserverEndpointForPerson(leuteModel, publicationIdentity, commServerUrl);
    await glueModule.activateForIdentity(String(publicationIdentity));

    connectionModuleWithFotos.connectToGlueServer?.(publicationIdentity).then(() => {
      if (generation !== runtimeGeneration || oneInstance !== one) return;
      // Preserve a completion that arrives before React installs its updater.
      model.headlessConnected = true;
      modelUpdater?.(prev => prev ? { ...prev, headlessConnected: true } : null);
    }).catch((err: unknown) =>
      console.warn('[fotos.one] glue server auto-connect failed:', err));
  }

  console.log('[fotos.one] ModuleRegistry initialized');

  return model;
}

// ---------------------------------------------------------------------------
// Boot entry point
// ---------------------------------------------------------------------------

/**
 * Boot ONE.core for fotos.browser.
 * Generates visitor credentials on first visit and persists them for future boots.
 * Returns a FotosModel with initialized modules and federation.
 */
export function bootFotosModel(
  onStatus?: (status: string) => void,
): Promise<FotosModel> {
  if (oneInstance || bootPromise) {
    return Promise.reject(new Error('[fotos.one] bootFotosModel called but ONE.core is already initialized or opening'));
  }

  const opening = openFotosModel(onStatus).finally(() => {
    if (bootPromise === opening) bootPromise = null;
  });
  bootPromise = opening;
  return opening;
}

async function openFotosModel(onStatus?: (status: string) => void): Promise<FotosModel> {
  await closePromise;
  const generation = ++runtimeGeneration;
  try {
    onStatus?.('opening account');
    const {
      creds: { email, secret, instanceName },
      accountId,
      source: credentialSource,
      persistent: credentialsPersisted,
      sessionScoped,
      storageDirectory,
    } = await getFotosGlueLogin().resolveBoot();

    const one = new MultiUser({
      directory: storageDirectory,
      recipes: FotosOneCoreRecipes,
      reverseMaps: FotosReverseMaps as never,
      reverseMapsForIdObjects: FotosReverseMapsForIdObjects as never,
    });
    oneInstance = one;

    console.log('[fotos.one] Boot credentials:', {
      source: credentialSource,
      persistent: credentialsPersisted,
      sessionScoped,
      accountId,
      storageDirectory,
      email,
      instanceName,
    });

    onStatus?.('opening storage');
    await one.loginOrRegister(email, secret, instanceName);
    console.log('[fotos.one] ONE.core booted:', email);

    // Existing instances restore their persisted reverse maps. Enable the new
    // trust indexes before any trust owner can author its first native state.
    await preparePersonalTrustStorage();
    onStatus?.('initializing');
    return await initModules(one, COMM_SERVER_URL, generation);
  } catch (error) {
    onStatus?.('startup failed — local data remains on this device');
    try {
      await closeFotosRuntime();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], '[fotos.one] Startup and cleanup failed');
    }
    throw error;
  }
}
