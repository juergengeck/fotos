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
import {updateInstance} from '@refinio/one.core/lib/instance-updater.js';
import {onChumImportBatch, onChumObjectImported} from '@refinio/one.core/lib/chum-sync.js';
import type {BLOB, Instance, Person} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import {SettingsPlan, SecretsPlan, InstanceSettingsStorage, registerBuiltInSettings,
  SettingsPlanMetadata, SecretsPlanMetadata} from '@refinio/settings.core';
import {DevicesPlan, registerDevicesPlan} from '@refinio/device.core';
import {registerDeviceSettings} from '@refinio/settings.devices';
import {ModuleRegistry, initializeModuleGraph} from '@refinio/api/plan-system';
import {getGlobalOperationRegistry} from '@refinio/api/registry';
import {CoreModule} from '@vger/vger.core/modules/CoreModule.js';
import {TrustModule} from '@vger/vger.core/modules/TrustModule.js';
import {IssuerKeyLifecycleModule} from '@refinio/trust.core/modules/IssuerKeyLifecycleModule.js';
import {InstanceAuthorityModule} from '@refinio/trust.core/modules/InstanceAuthorityModule.js';
import {PersonalTrustModule} from '@refinio/trust.me/modules/PersonalTrustModule.js';
import {JournalModule} from '@vger/vger.core/modules/JournalModule.js';
import {ChatModule} from '@vger/vger.core/modules/ChatModule.js';
import {ConnectionModule} from '@vger/vger.core/modules/ConnectionModule.js';
import {DeviceModule} from '@vger/vger.core/modules/DeviceModule.js';
import {InstanceModule} from '@vger/vger.core/modules/InstanceModule.js';
import {ExportPlan} from '@vger/vger.core/plans/ExportPlan.js';
import {projectReceivedFotosShares} from '@refinio/fotos.core/received-shares';
import type {FotosMediaVariant} from '@refinio/fotos.core';
import {DEVICE_NAME, DEVICE_STORAGE_DIRECTORY, loadDeviceIdentity, openDeviceAccount} from './identity';
import {BlobMediaCache, projectVerifiedPhotos} from './media';
import {fireOneCoreConfig} from './recipes';
import {admitRuntimeSchema} from './schema';
import {RuntimeController, type FireTvBackend} from './RuntimeController';
import {classifyFotosArrival, type FireTvChange} from './changes';

class NativeFireTvBackend implements FireTvBackend {
  private one?: MultiUser;
  private loggedIn = false;
  private initialized = false;
  private registry?: ModuleRegistry;
  private deviceModule?: DeviceModule;
  private settingsPlan?: SettingsPlan;
  private secretsPlan?: SecretsPlan;
  private devicesPlan?: DevicesPlan;
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
      directory: DEVICE_STORAGE_DIRECTORY,
      recipes: fireOneCoreConfig.recipes,
      reverseMaps: fireOneCoreConfig.reverseMaps as never,
      reverseMapsForIdObjects: fireOneCoreConfig.reverseMapsForIdObjects,
      storageInitTimeout: 20000,
    });
    // Module initialization is outside onLogin: a module failure must never
    // invoke MultiUser.register's closeAndDeleteCurrentInstance failure path.
    await openDeviceAccount(this.one, identity, SecureStore, () => { this.loggedIn = true; });
    const instanceId = getInstanceIdHash();
    const ownerId = getInstanceOwnerIdHash();
    if (!instanceId || !ownerId) throw new Error('ONE did not publish the Fire TV identity');
    await admitRuntimeSchema((await getObjectByIdHash(instanceId)).obj, fireOneCoreConfig, {
      hashRecipe: calculateHashOfObj,
      publish: additions => updateInstance({
        recipes: additions.recipes,
        enabledReverseMapTypes: additions.enabledReverseMapTypes as Instance['enabledReverseMapTypes'],
        enabledReverseMapTypesForIdObjects: additions.enabledReverseMapTypesForIdObjects as Instance['enabledReverseMapTypesForIdObjects'],
      }),
    });
    registerBuiltInSettings();
    registerDeviceSettings();
    this.settingsPlan = new SettingsPlan(new InstanceSettingsStorage({
      instanceIdHash: instanceId as SHA256IdHash<Instance>,
      ownerPersonIdHash: ownerId as SHA256IdHash<Person>,
    }));
    this.secretsPlan = new SecretsPlan();
    this.deviceModule = new DeviceModule();
    this.devicesPlan = new DevicesPlan({
      getDevicePlan: () => this.deviceModule?.devicePlan ?? null,
      getOwnerPersonIdHash: getInstanceOwnerIdHash,
      getCurrentInstanceIdHash: getInstanceIdHash,
      getCurrentDevicePlatform: () => 'fire',
    });
    const operationRegistry = getGlobalOperationRegistry();
    operationRegistry.register('settings', this.settingsPlan, SettingsPlanMetadata);
    operationRegistry.register('secrets', this.secretsPlan, SecretsPlanMetadata);
    registerDevicesPlan(operationRegistry, this.devicesPlan);
    const backend = this;
    const oneCore = {
      get initialized() { return backend.initialized; },
      get ownerId() { return getInstanceOwnerIdHash(); },
      get instanceId() { return getInstanceIdHash(); },
      instanceName: DEVICE_NAME,
      get settingsPlan() { return backend.settingsPlan; },
      get secretsPlan() { return backend.secretsPlan; },
      get devicesPlan() { return backend.devicesPlan; },
      getInfo: () => ({ownerId: getInstanceOwnerIdHash(), initialized: this.initialized}),
      storeVersionedObject, storeUnversionedObject, getObjectByIdHash, getObject,
      calculateHashOfObj, calculateIdHashOfObj,
    };
    const connection = new ConnectionModule('wss://api.glue.one/comm', 'https://fotos.one');
    connection.setGlueContentSyncEnabled(false);
    connection.setManagedOutgoingConnections(true);
    const instance = new InstanceModule();
    await instance.setLocalInstance(instanceId, 'fire',
      ['settings', 'secrets', 'devices', 'connections', 'trust'], DEVICE_NAME);
    this.registry = await initializeModuleGraph({
      registry: new ModuleRegistry(operationRegistry),
      modules: [new CoreModule('wss://api.glue.one/comm'), new TrustModule(),
        new IssuerKeyLifecycleModule(), new InstanceAuthorityModule(), new PersonalTrustModule(),
        new JournalModule(), new ChatModule(), connection, this.deviceModule, instance],
      supplies: {
        OneCore: oneCore,
        ExportPlan: new ExportPlan(),
        SettingsPlan: this.settingsPlan,
        SecretsPlan: this.secretsPlan,
        DevicesPlan: this.devicesPlan,
        SyncRules: new Map(fireOneCoreConfig.syncRules),
        PostStoreImportBatch: onChumImportBatch,
      },
      storageFunction: storeVersionedObject,
    });
    this.initialized = true;
    await this.core.leuteModel.trust.refreshCaches();
  }

  private get core(): CoreModule {
    const core = this.registry?.getModule<CoreModule>('CoreModule');
    if (!core) throw new Error('The Fire TV core module is unavailable');
    return core;
  }

  async projectPhotos() {
    const subject = getInstanceOwnerIdHash();
    if (!subject) throw new Error('The Fire TV photo recipient is unavailable');
    await this.core.leuteModel.trust.waitForPendingTrustUpdates();
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
      listener(change);
    };
    const personalTrust = this.registry?.getModule<PersonalTrustModule>('PersonalTrustModule');
    if (!personalTrust) throw new Error('The Fire TV personal trust owner is unavailable');
    const cleanups = [
      onVersionedObj.addListener(result => { notify({kind: 'object', type: result.obj.$type$}); }),
      onChumObjectImported.addListener(event => { notify(event.imported); }),
      onChumImportBatch.addListener(event => {
        let change: FireTvChange | undefined;
        for (const imported of event.batch.imported) {
          const arrivalChange = classifyFotosArrival(imported);
          if (arrivalChange === 'authorization' || !change) change = arrivalChange;
        }
        if (change) listener(change);
      }),
      this.core.leuteModel.trust.onTrustedKeysChanged.listen(() => { listener('authorization'); }),
      this.core.leuteModel.trust.onPersonRightsChanged.listen(() => { listener('authorization'); }),
      personalTrust.model.onChanged.listen(() => { listener('authorization'); }),
      personalTrust.model.onOwnerCredentialChanged.listen(() => { listener('authorization'); }),
      personalTrust.model.onOwnerCredentialProjectionChanged.listen(() => { listener('authorization'); }),
      personalTrust.model.onOwnerCredentialRevoked.listen(() => { listener('authorization'); }),
    ];
    return () => { for (const cleanup of cleanups) cleanup(); };
  }

  async createPairingInvitation(): Promise<string> {
    const module = this.registry?.getModule<ConnectionModule>('ConnectionModule');
    if (!module?.connectionPlan) throw new Error('Pairing is unavailable before the connection module is ready');
    const response = await module.connectionPlan.createPairingInvitation({mode: 'IoP'});
    if (!response.success || !response.invitation?.url) {
      throw new Error(response.error || 'The connection module did not return a pairing invitation');
    }
    return response.invitation.url;
  }

  async close(): Promise<void> {
    this.initialized = false;
    await this.registry?.shutdownAll();
    this.registry = undefined;
    if (this.loggedIn && this.one) {
      await this.one.logout();
      this.loggedIn = false;
    }
    this.one = undefined;
    this.settingsPlan = undefined;
    this.secretsPlan = undefined;
    this.devicesPlan = undefined;
    this.deviceModule = undefined;
  }
}

export class FireTvRuntime extends RuntimeController {
  constructor() { super(new NativeFireTvBackend()); }
}

export type {FireTvSnapshot} from './RuntimeController';
