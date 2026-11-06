import * as SecureStore from 'expo-secure-store';
import {getRandomBytesAsync} from 'expo-crypto';
import {Directory, File, Paths} from 'expo-file-system';
import MultiUser from '@refinio/one.models/lib/models/Authenticator/MultiUser.js';
import type {Signature} from '@refinio/one.models/lib/recipes/SignatureRecipes.js';
import {getInstanceIdHash, getInstanceOwnerIdHash} from '@refinio/one.core/lib/instance.js';
import {getObjectByIdHash, onVersionedObj, storeVersionedObject} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {getObject, getObjectWithType, storeUnversionedObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {calculateHashOfObj, calculateIdHashOfObj} from '@refinio/one.core/lib/util/object.js';
import {readBlobAsArrayBuffer} from '@refinio/one.core/lib/storage-blob.js';
import {onChumImportBatch, onChumObjectImported} from '@refinio/one.core/lib/chum-sync.js';
import type {BLOB, Instance, Person} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import {SettingsPlan, SecretsPlan, InstanceSettingsStorage} from '@refinio/settings.core';
import {registerVgerCoreSettings} from '@vger/vger.core/settings';
import {initializeMobileBackboneModules, shutdownModules,
  type PlatformAdapters, type InitResult} from '@vger/vger.core/initialization/initializeMobileBackboneModules.js';
import {createModuleInitializationContext} from '@vger/vger.core/initialization/ModuleInitializationContext.js';
import type {CoreModule} from '@vger/vger.core/modules/CoreModule.js';
import type {ConnectionModule} from '@vger/vger.core/modules/ConnectionModule.js';
import {fotosContentRules} from '@refinio/fotos.core/sync-rules';
import {projectReceivedFotosShares} from '@refinio/fotos.core/received-shares';
import type {FotosMediaVariant} from '@refinio/fotos.core';
import {DEVICE_NAME, loadDeviceIdentity} from './identity';
import {BlobMediaCache, projectVerifiedPhotos} from './media';
import {fireRecipes, fireReverseMaps, fireIdReverseMaps} from './recipes';
import {firePlatformEvents} from './platformEvents';
import {RuntimeController, type FireTvBackend} from './RuntimeController';
import {classifyFotosArrival, isTrustEvidenceType, type FireTvChange} from './changes';

class NativeFireTvBackend implements FireTvBackend {
  private one?: MultiUser;
  private loggedIn = false;
  private initialized = false;
  private trustRevision = 0;
  private refreshedTrustRevision = 0;
  private result?: InitResult;
  private settingsPlan?: SettingsPlan;
  private secretsPlan?: SecretsPlan;
  private readonly context = createModuleInitializationContext();
  private readonly cacheDirectory = new Directory(Paths.cache, 'fotos.fire.media');
  private readonly cache = new BlobMediaCache({
    exists: name => new File(this.cacheDirectory, name).exists,
    write: (name, bytes) => {
      this.cacheDirectory.create({idempotent: true, intermediates: true});
      new File(this.cacheDirectory, name).write(bytes);
    },
    uri: name => new File(this.cacheDirectory, name).uri,
  }, hash => readBlobAsArrayBuffer(hash as SHA256Hash<BLOB>));

  async open(): Promise<void> {
    if (this.initialized) return;
    const identity = await loadDeviceIdentity(SecureStore, getRandomBytesAsync);
    this.one = new MultiUser({
      directory: 'fotos.fire.storage',
      recipes: fireRecipes,
      reverseMaps: fireReverseMaps as never,
      reverseMapsForIdObjects: fireIdReverseMaps as never,
      storageInitTimeout: 20000,
    });
    // Module initialization is outside onLogin: a module failure must never
    // invoke MultiUser.register's closeAndDeleteCurrentInstance failure path.
    await this.one.loginOrRegister(identity.email, identity.secret, identity.instanceName);
    this.loggedIn = true;
    const instanceId = getInstanceIdHash();
    const ownerId = getInstanceOwnerIdHash();
    if (!instanceId || !ownerId) throw new Error('ONE did not publish the Fire TV identity');
    registerVgerCoreSettings();
    this.settingsPlan = new SettingsPlan(new InstanceSettingsStorage({
      instanceIdHash: instanceId as SHA256IdHash<Instance>,
      ownerPersonIdHash: ownerId as SHA256IdHash<Person>,
    }));
    this.secretsPlan = new SecretsPlan();
    const backend = this;
    const oneCore = {
      get initialized() { return backend.initialized; },
      get ownerId() { return getInstanceOwnerIdHash(); },
      get instanceId() { return getInstanceIdHash(); },
      instanceName: DEVICE_NAME,
      get settingsPlan() { return backend.settingsPlan; },
      get secretsPlan() { return backend.secretsPlan; },
      getInfo: () => ({ownerId: getInstanceOwnerIdHash(), initialized: this.initialized}),
      storeVersionedObject, storeUnversionedObject, getObjectByIdHash, getObject,
      calculateHashOfObj, calculateIdHashOfObj,
    };
    const adapters: Omit<PlatformAdapters, 'llmConfigAdapter'> = {
      platform: 'fire', oneCore, llmPlatform: firePlatformEvents,
      commServerUrl: 'wss://api.glue.one/comm', webUrl: 'https://fotos.one',
      instanceId: instanceId as SHA256IdHash<Instance>, instanceName: DEVICE_NAME,
      settingsPlan: this.settingsPlan, secretsPlan: this.secretsPlan,
      storageFunction: storeVersionedObject,
      additionalSupplies: {SyncRules: fotosContentRules},
      contextProvider: {getDeviceName: async () => DEVICE_NAME, getLocale: () => 'en'},
      options: {disableWhatsApp: true, deviceType: 'fire', enableGlueServices: false},
    };
    // llmConfigAdapter is required by the broad type but only consumed by AI
    // profiles. The backbone supplies a real native event transport and no AI.
    this.result = await initializeMobileBackboneModules(adapters as PlatformAdapters, this.context);
    this.initialized = true;
    await this.core.leuteModel.trust.refreshCaches();
    await this.result.startListeners();
  }

  private get core(): CoreModule {
    const core = this.result?.registry.getModule<CoreModule>('CoreModule');
    if (!core) throw new Error('The Fire TV core module is unavailable');
    return core;
  }

  async projectPhotos() {
    const subject = getInstanceOwnerIdHash();
    if (!subject) throw new Error('The Fire TV photo recipient is unavailable');
    if (this.refreshedTrustRevision !== this.trustRevision) {
      const revision = this.trustRevision;
      await this.core.leuteModel.trust.refreshCaches();
      this.refreshedTrustRevision = revision;
    }
    const scopes = await projectReceivedFotosShares(String(subject), signature =>
      this.core.leuteModel.trust.verifySignatureWithTrustedKeys(signature as Signature));
    return projectVerifiedPhotos(scopes, {
      entryId: async entry => String(await calculateIdHashOfObj({$type$: 'FotosEntry', contentHash: entry.contentHash})),
      getVariant: hash => getObjectWithType(hash as SHA256Hash<FotosMediaVariant>, 'FotosMediaVariant'),
      mediaUri: (hash, mime) => this.cache.resolve(hash, mime),
    });
  }

  subscribeChanges(listener: (change: FireTvChange) => void): () => void {
    const notify = (imported: {kind: string; type: string}) => {
      const change = classifyFotosArrival(imported);
      if (!change) return;
      if (isTrustEvidenceType(imported.type)) ++this.trustRevision;
      listener(change);
    };
    const cleanups = [
      onVersionedObj.addListener(result => { notify({kind: 'object', type: result.obj.$type$}); }),
      onChumObjectImported.addListener(event => { notify(event.imported); }),
      onChumImportBatch.addListener(event => {
        let change: FireTvChange | undefined;
        let trustChanged = false;
        for (const imported of event.batch.imported) {
          const arrivalChange = classifyFotosArrival(imported);
          if (arrivalChange === 'authorization' || !change) change = arrivalChange;
          if (isTrustEvidenceType(imported.type)) trustChanged = true;
        }
        if (trustChanged) ++this.trustRevision;
        if (change) listener(change);
      }),
      this.core.leuteModel.trust.onTrustedKeysChanged.listen(() => { listener('authorization'); }),
      this.core.leuteModel.trust.onPersonRightsChanged.listen(() => { listener('authorization'); }),
    ];
    return () => { for (const cleanup of cleanups) cleanup(); };
  }

  async createPairingInvitation(): Promise<string> {
    const module = this.result?.registry.getModule<ConnectionModule>('ConnectionModule');
    if (!module?.connectionPlan) throw new Error('Pairing is unavailable before the connection module is ready');
    const response = await module.connectionPlan.createPairingInvitation({mode: 'IoP'});
    if (!response.success || !response.invitation?.url) {
      throw new Error(response.error || 'The connection module did not return a pairing invitation');
    }
    return response.invitation.url;
  }

  async close(): Promise<void> {
    this.initialized = false;
    await shutdownModules(this.context);
    this.result = undefined;
    if (this.loggedIn && this.one) {
      await this.one.logout();
      this.loggedIn = false;
    }
    this.one = undefined;
    this.settingsPlan = undefined;
    this.secretsPlan = undefined;
  }
}

export class FireTvRuntime extends RuntimeController {
  constructor() { super(new NativeFireTvBackend()); }
}

export type {FireTvSnapshot} from './RuntimeController';
