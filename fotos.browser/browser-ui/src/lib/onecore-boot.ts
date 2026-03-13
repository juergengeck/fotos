/**
 * ONE.core boot module for fotos.browser.
 *
 * Follows the same pattern as glue.browser's bootGlueModel():
 *   1. Create MultiUser with all required recipes
 *   2. Login or register with auto-generated credentials (localStorage/sessionStorage)
 *   3. Initialize ModuleRegistry (CoreModule, TrustModule, ConnectionModule, GlueModule)
 *   4. Set up glue identity via ensureStartupGlueIdentity
 *   5. Fire-and-forget headless connection
 *   6. Return FotosModel
 */
import MultiUser from '@refinio/one.models/lib/models/Authenticator/MultiUser.js';

import type LeuteModel from '@refinio/one.models/lib/models/Leute/LeuteModel.js';
import type ConnectionsModel from '@refinio/one.models/lib/models/ConnectionsModel.js';
import type { ConnectionModule as ConnectionModuleType } from '@vger/vger.core/modules/ConnectionModule.js';
import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person } from '@refinio/one.core/lib/recipes.js';
import type { TrustPlan } from '@refinio/trust.core/plans/TrustPlan.js';

// ModuleRegistry + modules
import { ModuleRegistry, RefinioApiRecipes } from '@refinio/api/plan-system';
import { CoreModule } from '@vger/vger.core/modules/CoreModule.js';
import { TrustModule } from '@vger/vger.core/modules/TrustModule.js';
import { ConnectionModule } from '@vger/vger.core/modules/ConnectionModule.js';
import { contentRules } from '@vger/vger.core/modules';
import { GlueModule } from '@vger/vger.glue';

// Recipes
import RecipesStable from '@refinio/one.models/lib/recipes/recipes-stable.js';
import RecipesExperimental from '@refinio/one.models/lib/recipes/recipes-experimental.js';
import GlueContentRecipes from '@glueone/glue.core/recipes/GlueContentRecipes.js';
import PresenceRecipes from '@glueone/glue.core/recipes/PresenceRecipes.js';
import TimeTrieRecipes from '@glueone/glue.core/recipes/TimeTrieRecipes.js';
import PresenceTrieRecipes from '@glueone/glue.core/recipes/PresenceTrieRecipes.js';
import { AllRecipes as TrustCoreRecipes } from '@refinio/trust.core/recipes';
import { FotosRecipes } from '@refinio/fotos.core';
import {
  SettingsRecipes,
  InstanceSettingsStorage,
  SettingsPlan,
  registerSubscriptionSettings,
  registerGlueSettings,
} from '@refinio/settings.core';

// ONE.core instance helpers
import { getInstanceIdHash, getInstanceOwnerIdHash } from '@refinio/one.core/lib/instance.js';
import { getLocalInstanceOfPerson } from '@refinio/one.models/lib/misc/instance.js';
import { getDefaultKeys } from '@refinio/one.core/lib/keychain/keychain.js';

import { ensureStartupGlueIdentity } from './glueIdentity.js';
import { registerFotosHistorySettings } from './fotosHistorySettings.js';
import { registerFotosSettings } from './fotosSettings.js';
import { grantFotosAccess } from './fotos-manifest.js';
import { API_BASE, COMM_SERVER_URL } from '../config.js';

// ---------------------------------------------------------------------------
// Credentials (auto-generated, stored in localStorage/sessionStorage)
// ---------------------------------------------------------------------------

const PERSISTENT_KEY = 'fotos_creds';
const SESSION_KEY = 'fotos_creds_session';

interface FotosCreds {
  email: string;
  secret: string;
  instanceName: string;
}

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
  connectionsModel: ConnectionsModel;
  connectionModule: ConnectionModuleType;
  trustPlan: TrustPlan;
  settingsPlan: SettingsPlan;
  glueModule: GlueModule;
}

// ---------------------------------------------------------------------------
// Module-level singleton state
// ---------------------------------------------------------------------------

let oneInstance: MultiUser | null = null;
let glueModuleInstance: GlueModule | null = null;
let publicationIdentity: SHA256IdHash<Person> | null = null;

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ensureCommserverEndpointForPerson(
  leuteModel: LeuteModel,
  personId: SHA256IdHash<Person>,
  commServerUrl: string,
): Promise<void> {
  try {
    const instanceId = await getLocalInstanceOfPerson(personId);
    const profile = await leuteModel.getMainProfile(personId);
    const endpoints = profile.communicationEndpoints ?? [];
    const nextEndpoint = {
      $type$: 'OneInstanceEndpoint' as const,
      personId,
      instanceId,
      personKeys: await getDefaultKeys(personId),
      instanceKeys: await getDefaultKeys(instanceId as any),
      url: commServerUrl,
    } as any;

    const existingIndex = endpoints.findIndex((ep: any) =>
      ep.$type$ === 'OneInstanceEndpoint' &&
      ep.personId === personId &&
      ep.instanceId === instanceId,
    );

    if (existingIndex >= 0) {
      const existingEndpoint = endpoints[existingIndex] as { url?: string };
      if (existingEndpoint.url === commServerUrl) {
        return;
      }
      endpoints[existingIndex] = nextEndpoint;
      profile.communicationEndpoints = endpoints;
      await profile.saveAndLoad();
      return;
    }

    endpoints.push(nextEndpoint);
    profile.communicationEndpoints = endpoints;
    await profile.saveAndLoad();
  } catch (err) {
    console.warn('[fotos.one] Failed to ensure OneInstanceEndpoint:', err);
  }
}

// ---------------------------------------------------------------------------
// Module init (after ONE.core login)
// ---------------------------------------------------------------------------

async function initModules(
  one: MultiUser,
  commServerUrl: string,
): Promise<FotosModel> {
  registerSubscriptionSettings();
  registerGlueSettings();
  registerFotosSettings();
  registerFotosHistorySettings();

  const storage = new InstanceSettingsStorage({
    instanceIdHash: getInstanceIdHash()!,
  });
  const settingsPlan = new SettingsPlan(storage);

  // ModuleRegistry: CoreModule -> TrustModule -> ConnectionModule -> GlueModule
  const registry = new ModuleRegistry();

  const coreModule = new CoreModule(commServerUrl);
  const trustModule = new TrustModule();
  const connectionModule = new ConnectionModule(commServerUrl, API_BASE, undefined);
  connectionModule.enableCredentialAutoConnect = false;
  const connectionModuleWithFotos = connectionModule as ConnectionModuleType & {
    connectToGlueServer?: (personId: SHA256IdHash<Person>) => Promise<void>;
    fotosAccessGranter?: (remotePersonId: SHA256IdHash<Person>) => Promise<void>;
    fotosTrustFilter?: (remotePersonId: SHA256IdHash<Person>) => Promise<boolean>;
  };
  connectionModuleWithFotos.fotosAccessGranter = async (remotePersonId: SHA256IdHash<Person>) => {
    await grantFotosAccess(remotePersonId);
  };
  connectionModuleWithFotos.fotosTrustFilter = async (remotePersonId: SHA256IdHash<Person>) => {
    return remotePersonId === publicationIdentity;
  };

  // Lazy proxy for OneCore — getters resolve after module init
  const oneCore = {
    get leuteModel() { return coreModule.leuteModel; },
    get channelManager() { return coreModule.channelManager; },
    get topicModel() { return coreModule.topicModel; },
    get connectionsModel() { return connectionModule.connectionsModel; },
    get ownerId() { return getInstanceOwnerIdHash(); },
    get initialized() { return true; },
    getInfo() { return { initialized: true, ownerId: getInstanceOwnerIdHash() }; },
  };
  registry.supply('OneCore', oneCore);
  registry.supply('SyncRules', contentRules);
  registry.supply('SettingsPlan', settingsPlan);
  registry.register(coreModule);
  registry.register(trustModule);
  registry.register(connectionModule);

  // GlueModule — presence and peer connections
  if (glueModuleInstance) {
    await glueModuleInstance.shutdown();
    glueModuleInstance = null;
  }
  const glueModule = new GlueModule(API_BASE, commServerUrl);
  glueModule.enableMailboxPairing = false;

  // Inject browser platform hooks
  glueModule.onVisibilityChange = (cb: (visible: boolean) => void) => {
    const handler = () => cb(!document.hidden);
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  };
  glueModule.onBeforeUnload = (cb: () => void) => {
    window.addEventListener('beforeunload', cb);
    return () => window.removeEventListener('beforeunload', cb);
  };
  glueModule.getLocalTransportCapabilities = async () => ['webrtc', 'commserver-relay'];
  glueModule.connectToPeerDirectByKey = (encKey: string, ownId: string, caps?: string[]) =>
    connectionModule.connectToPeerByKey(encKey, ownId as any, caps);
  glueModule.connectToPeerRelayByKey = (encKey: string, ownId: string, remotePersonId: string) =>
    connectionModule.connectToPeerRelayByKey(encKey, ownId as any, remotePersonId as any);

  // Incoming CHUM admission boundary
  const glueModuleWithAdmission = glueModule as GlueModule & {
    shouldAcceptIncomingPeer?: (personId: string) => boolean;
  };
  connectionModule.setUnknownPeerIdentityMatcher((remotePersonId) => {
    const personId = String(remotePersonId);
    return glueModuleWithAdmission.shouldAcceptIncomingPeer?.(personId) ?? false;
  });

  registry.register(glueModule);

  // Do not pre-activate Glue from settings before the configured publication
  // identity has been validated against local instance state. A wiped browser
  // can retain a stale person id in settings without having the corresponding
  // local instance anymore.
  const ownerId = getInstanceOwnerIdHash()! as SHA256IdHash<Person>;
  publicationIdentity = null;

  await registry.initAll();
  glueModuleInstance = glueModule;

  // Post-init: extract models
  const leuteModel = coreModule.leuteModel;
  const connectionsModel = connectionModule.connectionsModel;

  // Ensure glue identity
  const startupGlueIdentity = await ensureStartupGlueIdentity(
    settingsPlan,
    leuteModel,
    ownerId,
  );
  publicationIdentity = startupGlueIdentity.personId;
  registry.supply('GlueOwnerId', String(publicationIdentity));
  registry.supply('PublicationIdentity', String(publicationIdentity));
  await ensureCommserverEndpointForPerson(leuteModel, publicationIdentity, commServerUrl);
  await glueModule.activateAfterIdentityCreation();

  // Fire-and-forget headless connection
  connectionModuleWithFotos.connectToGlueServer?.(publicationIdentity).then(() => {
    modelUpdater?.(prev => prev ? { ...prev, headlessConnected: true } : null);
  }).catch((err: unknown) =>
    console.warn('[fotos.one] glue server auto-connect failed:', err));

  console.log('[fotos.one] ModuleRegistry initialized');

  return {
    initialized: true,
    headlessConnected: false,
    one,
    ownerId,
    publicationIdentity,
    leuteModel,
    connectionsModel,
    connectionModule,
    trustPlan: trustModule.trustPlan,
    settingsPlan,
    glueModule,
  };
}

// ---------------------------------------------------------------------------
// Boot entry point
// ---------------------------------------------------------------------------

/**
 * Boot ONE.core for fotos.browser.
 * Auto-generates ephemeral credentials on first visit.
 * Returns a FotosModel with initialized modules and federation.
 */
export async function bootFotosModel(
  onStatus?: (status: string) => void,
): Promise<FotosModel> {
  if (oneInstance) {
    throw new Error('[fotos.one] bootFotosModel called but ONE.core is already initialized');
  }

  const one = new MultiUser({
    directory: 'fotos.one.storage',
    recipes: [
      ...RecipesStable,
      ...RecipesExperimental,
      ...GlueContentRecipes,
      ...PresenceRecipes,
      ...TimeTrieRecipes,
      ...PresenceTrieRecipes,
      ...TrustCoreRecipes,
      ...SettingsRecipes,
      ...RefinioApiRecipes,
      ...FotosRecipes,
    ],
  });
  oneInstance = one;

  // Credential lookup: localStorage -> sessionStorage -> generate new
  let email: string;
  let secret: string;
  let instanceName = 'fotos-visitor';

  const persisted = localStorage.getItem(PERSISTENT_KEY);
  const session = sessionStorage.getItem(SESSION_KEY);

  if (persisted) {
    const creds: FotosCreds = JSON.parse(persisted);
    email = creds.email;
    secret = creds.secret;
    instanceName = creds.instanceName || instanceName;
  } else if (session) {
    const creds: FotosCreds = JSON.parse(session);
    email = creds.email;
    secret = creds.secret;
  } else {
    const idBytes = new Uint8Array(5);
    crypto.getRandomValues(idBytes);
    const id = Array.from(idBytes, b => b.toString(16).padStart(2, '0')).join('');
    email = `fotos-visitor-${id}@fotos.one`;
    const secretBytes = new Uint8Array(32);
    crypto.getRandomValues(secretBytes);
    secret = Array.from(secretBytes, b => b.toString(16).padStart(2, '0')).join('');
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ email, secret }));
  }

  onStatus?.('opening storage');
  try {
    await one.loginOrRegister(email, secret, instanceName);
  } catch (loginError) {
    console.error('[fotos.one] Login failed:', loginError);
    onStatus?.('login failed — see console');
    throw loginError;
  }
  console.log('[fotos.one] ONE.core booted:', email);

  onStatus?.('initializing');
  const result = await initModules(one, COMM_SERVER_URL);
  return result;
}
