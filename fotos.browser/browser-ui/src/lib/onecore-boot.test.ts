import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const runtime = vi.hoisted(() => ({
  instanceId: undefined as string | undefined,
  syncEnabled: false,
  order: [] as string[],
  credentials: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  prepareTrustStorage: vi.fn(),
  init: vi.fn(),
  shutdown: vi.fn(),
  connect: vi.fn(),
  constructed: vi.fn(),
}));

vi.mock('@refinio/one.models/lib/models/Authenticator/MultiUser.js', () => ({
  default: class {
    authState = {currentState: 'logged_out'};
    constructor() { runtime.constructed(); }
    async loginOrRegister() {
      runtime.instanceId = 'instance';
      await runtime.login();
      this.authState.currentState = 'logged_in';
    }
    async logout() {
      await runtime.logout();
      runtime.order.push('storage-close');
      runtime.instanceId = undefined;
    }
  },
}));
vi.mock('@refinio/one.core/lib/instance.js', () => ({
  getInstanceIdHash: () => runtime.instanceId,
  getInstanceOwnerIdHash: () => 'owner',
  closeInstance: () => {
    runtime.order.push('storage-close');
    runtime.instanceId = undefined;
  },
}));
vi.mock('@refinio/one.core/lib/storage-versioned-objects.js', () => ({storeVersionedObject: vi.fn()}));
vi.mock('@refinio/one.core/lib/chum-sync.js', () => ({onChumImportBatch: {}}));
vi.mock('@refinio/one.models/lib/misc/instance.js', () => ({getLocalInstanceOfPerson: async () => 'publication-instance'}));
vi.mock('@refinio/api/plan-system', () => ({
  ModuleRegistry: class {
    setStorageFunction() {}
    supply() {}
    register() {}
    initAll = runtime.init;
    async shutdownAll() {
      runtime.order.push('modules-stop');
      await runtime.shutdown();
    }
  },
}));
vi.mock('@vger/vger.core/modules/CoreModule.js', () => ({CoreModule: class { leuteModel = {}; }}));
vi.mock('@vger/vger.core/modules/ChatModule.js', () => ({ChatModule: class { contactsPlan = {}; }}));
vi.mock('@vger/vger.core/modules/JournalModule.js', () => ({JournalModule: class {}}));
vi.mock('@vger/vger.core/modules/IndexModule.js', () => ({IndexModule: class {}}));
vi.mock('@vger/vger.core/modules/TrustModule.js', () => ({TrustModule: class { trustPlan = {}; }}));
vi.mock('@refinio/trust.core/modules/IssuerKeyLifecycleModule.js', () => ({IssuerKeyLifecycleModule: class {}}));
vi.mock('@refinio/trust.core/modules/InstanceAuthorityModule.js', () => ({InstanceAuthorityModule: class {}}));
vi.mock('@refinio/trust.me/modules/PersonalTrustModule.js', () => ({PersonalTrustModule: class {}}));
vi.mock('@refinio/trust.me/services', () => ({preparePersonalTrustStorage: runtime.prepareTrustStorage}));
vi.mock('@vger/vger.core/modules/ConnectionModule.js', () => ({
  ConnectionModule: class {
    connectionsModel = {};
    addChumSyncRuntimeObjectTypes() {}
    setManagedOutgoingConnections() {}
    setUnknownPeerIdentityMatcher() {}
    connectToGlueServer = runtime.connect;
  },
}));
vi.mock('@vger/vger.core/plans/ExportPlan.js', () => ({ExportPlan: class {}}));
vi.mock('@vger/vger.glue', () => ({
  GlueModule: class { async activateForIdentity() {} },
  ensureCommserverEndpointForPerson: vi.fn(),
}));
vi.mock('@refinio/settings.devices', () => ({registerDeviceSettings() {}}));
vi.mock('@refinio/device.core', () => ({createLocalDevicesPlan: async () => ({})}));
vi.mock('@refinio/settings.core', () => ({
  InstanceSettingsStorage: class {},
  SettingsPlan: class { async getSection() { return {values: {syncEnabled: runtime.syncEnabled}}; } },
  registerRefinioSettings() {},
  registerSubscriptionSettings() {},
  registerGlueSettings() {},
}));
vi.mock('./glueIdentityState.js', () => ({resolveGluePublicationIdentity: () => runtime.syncEnabled ? 'publication' : null}));
vi.mock('./fotosHistorySettings.js', () => ({registerFotosHistorySettings() {}}));
vi.mock('./fotosSettings.js', () => ({registerFotosSettings() {}}));
vi.mock('./fotosSyncRules.js', () => ({fotosContentRules: []}));
vi.mock('./fotosOneCoreConfig.js', () => ({FotosOneCoreRecipes: [], FotosReverseMaps: [], FotosReverseMapsForIdObjects: []}));
vi.mock('./fotosGlueLogin.js', () => ({getFotosGlueLogin: () => ({resolveBoot: runtime.credentials})}));

import {bootFotosModel, setModelUpdater, shutdownFotosModel} from './onecore-boot.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return {promise, resolve};
}

describe('Fotos runtime ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtime.order = [];
    runtime.instanceId = undefined;
    runtime.syncEnabled = false;
    runtime.credentials.mockResolvedValue({creds: {email: 'visitor@fotos.one', secret: 'local-secret', instanceName: 'visitor'}});
    runtime.login.mockResolvedValue(undefined);
    runtime.logout.mockResolvedValue(undefined);
    runtime.prepareTrustStorage.mockResolvedValue({changed: false});
    runtime.init.mockResolvedValue(undefined);
    runtime.shutdown.mockResolvedValue(undefined);
    runtime.connect.mockResolvedValue(undefined);
    vi.stubGlobal('window', {location: {origin: 'https://fotos.one'}});
  });
  afterEach(async () => {
    runtime.shutdown.mockResolvedValue(undefined);
    await shutdownFotosModel();
    vi.unstubAllGlobals();
  });

  it('can retry credential resolution without opening a replacement runtime', async () => {
    const failure = new Error('vault unavailable');
    runtime.credentials.mockRejectedValueOnce(failure);
    await expect(bootFotosModel()).rejects.toBe(failure);
    expect(runtime.constructed).not.toHaveBeenCalled();
    await expect(bootFotosModel()).resolves.toMatchObject({initialized: true});
  });

  it('closes storage acquired by a failed login before allowing retry', async () => {
    const failure = new Error('login interrupted');
    runtime.login.mockRejectedValueOnce(failure);
    await expect(bootFotosModel()).rejects.toBe(failure);
    expect(runtime.order).toEqual(['storage-close']);
    await expect(bootFotosModel()).resolves.toMatchObject({initialized: true});
  });

  it('drains a partially initialized graph before closing storage and retrying', async () => {
    const failure = new Error('module init failed');
    runtime.init.mockRejectedValueOnce(failure);
    await expect(bootFotosModel()).rejects.toBe(failure);
    expect(runtime.order).toEqual(['modules-stop', 'storage-close']);
    await expect(bootFotosModel()).resolves.toMatchObject({initialized: true});
  });

  it('prepares existing trust storage before modules can write native trust state', async () => {
    runtime.prepareTrustStorage.mockResolvedValueOnce({changed: true});
    await bootFotosModel();
    expect(runtime.prepareTrustStorage).toHaveBeenCalledTimes(1);
    expect(runtime.login.mock.invocationCallOrder[0]).toBeLessThan(runtime.prepareTrustStorage.mock.invocationCallOrder[0]);
    expect(runtime.prepareTrustStorage.mock.invocationCallOrder[0]).toBeLessThan(runtime.init.mock.invocationCallOrder[0]);
  });

  it('stops module startup if existing trust storage requires an explicit migration', async () => {
    const failure = new Error('historical trust index migration required');
    runtime.prepareTrustStorage.mockRejectedValueOnce(failure);
    await expect(bootFotosModel()).rejects.toBe(failure);
    expect(runtime.init).not.toHaveBeenCalled();
    expect(runtime.order).toEqual(['storage-close']);
  });

  it('closes a login interrupted before ONE publishes an instance ID', async () => {
    const failure = new Error('recipe load failed after storage opened');
    runtime.login.mockImplementationOnce(async () => {
      runtime.instanceId = undefined;
      throw failure;
    });
    await expect(bootFotosModel()).rejects.toBe(failure);
    expect(runtime.order).toEqual(['storage-close']);
    await expect(bootFotosModel()).resolves.toMatchObject({initialized: true});
  });

  it('releases storage even when a logout listener rejects', async () => {
    await bootFotosModel();
    const failure = new Error('logout listener failed');
    runtime.logout.mockRejectedValueOnce(failure);
    await expect(shutdownFotosModel()).rejects.toMatchObject({errors: [failure]});
    expect(runtime.order).toEqual(['modules-stop', 'storage-close']);
    await expect(bootFotosModel()).resolves.toMatchObject({initialized: true});
  });

  it('rejects concurrent boot while credentials are still opening', async () => {
    const waiting = deferred<unknown>();
    runtime.credentials.mockReturnValueOnce(waiting.promise);
    const opening = bootFotosModel();
    await expect(bootFotosModel()).rejects.toThrow('already initialized or opening');
    waiting.resolve({creds: {email: 'visitor@fotos.one', secret: 'local-secret', instanceName: 'visitor'}});
    await opening;
    expect(runtime.constructed).toHaveBeenCalledTimes(1);
  });

  it('retains a connection completed before React subscribes', async () => {
    runtime.syncEnabled = true;
    const model = await bootFotosModel();
    expect(model.headlessConnected).toBe(true);
  });

  it('ignores a late connection completion from a previous runtime', async () => {
    runtime.syncEnabled = true;
    const oldConnection = deferred<void>();
    const newConnection = deferred<void>();
    runtime.connect.mockReturnValueOnce(oldConnection.promise).mockReturnValueOnce(newConnection.promise);
    await bootFotosModel();
    await shutdownFotosModel();
    const current = await bootFotosModel();
    const update = vi.fn();
    setModelUpdater(update);
    oldConnection.resolve();
    await Promise.resolve();
    expect(update).not.toHaveBeenCalled();
    expect(current.headlessConnected).toBe(false);
    newConnection.resolve();
    await Promise.resolve();
    expect(current.headlessConnected).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('still releases storage when module teardown fails and reports both failures', async () => {
    const initError = new Error('init failed');
    const teardownError = new Error('teardown failed');
    runtime.init.mockRejectedValueOnce(initError);
    runtime.shutdown.mockRejectedValueOnce(teardownError);
    await expect(bootFotosModel()).rejects.toMatchObject({errors: [initError, expect.any(AggregateError)]});
    expect(runtime.order).toEqual(['modules-stop', 'storage-close']);
    await expect(bootFotosModel()).resolves.toMatchObject({initialized: true});
  });
});
