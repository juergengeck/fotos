/** Credentials unlock the ONE encrypted store; they never enter a pairing URL. */
export interface LocalDeviceIdentity {
  version: 1;
  email: string;
  secret: string;
  instanceName: string;
}

export const DEVICE_IDENTITY_KEY = 'fotos.fire.local-identity.v1';
export const DEVICE_NAME = 'Fotos Fire TV';
export const DEVICE_STORAGE_DIRECTORY = 'fotos.fire.storage';

export type DeviceProvisioningState = 'pending' | 'established';

export interface LoadedDeviceIdentity {
  credentials: LocalDeviceIdentity;
  provisioning: DeviceProvisioningState;
}

export interface LocalDeviceAuthenticator {
  login(email: string, secret: string, instanceName: string): Promise<void>;
  loginOrRegister(email: string, secret: string, instanceName: string): Promise<void>;
}

/** Pending provisioning reuses durable credentials; established accounts remain login-only. */
export async function openDeviceAccount(
  authenticator: LocalDeviceAuthenticator,
  loaded: LoadedDeviceIdentity,
  storage: IdentityStorage,
  onAuthenticated: () => void,
): Promise<void> {
  const {email, secret, instanceName} = loaded.credentials;
  if (loaded.provisioning === 'pending') {
    // This covers interruption before storage creation or after complete auth.
    // The auth owner cannot resume a partial storage directory; preserve its
    // failure and these pending credentials rather than replacing or erasing it.
    await authenticator.loginOrRegister(email, secret, instanceName);
  } else {
    await authenticator.login(email, secret, instanceName);
  }
  // The caller must own cleanup even if persisting the completion marker fails.
  onAuthenticated();
  if (loaded.provisioning === 'pending') {
    await storage.setItemAsync(DEVICE_IDENTITY_KEY,
      JSON.stringify({...loaded.credentials, provisioning: 'established'}));
    loaded.provisioning = 'established';
  }
}

export interface IdentityStorage {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
}

export async function loadDeviceIdentity(
  storage: IdentityStorage,
  randomBytes: (size: number) => Promise<Uint8Array>,
): Promise<LoadedDeviceIdentity> {
  const saved = await storage.getItemAsync(DEVICE_IDENTITY_KEY);
  if (saved !== null) {
    let identity: unknown;
    try {
      identity = JSON.parse(saved);
    } catch {
      // JSON parser errors can quote their input. Never surface stored secrets.
      throw new Error('The saved Fire TV identity is invalid. The existing store has been preserved.');
    }
    const value = identity as Partial<LocalDeviceIdentity> & {provisioning?: unknown} | null;
    if (!value || value.version !== 1 || typeof value.email !== 'string'
      || !/^fire-[a-f0-9]{32}@device.fotos.one$/.test(value.email)
      || typeof value.secret !== 'string' || !/^[a-f0-9]{64}$/.test(value.secret)
      || value.instanceName !== DEVICE_NAME
      || (value.provisioning !== undefined && value.provisioning !== 'pending' && value.provisioning !== 'established')) {
      throw new Error('The saved Fire TV identity is invalid. The existing store has been preserved.');
    }
    const credentials: LocalDeviceIdentity = {version: value.version, email: value.email,
      secret: value.secret, instanceName: value.instanceName};
    // Version 1 records written before provisioning markers are established.
    return {credentials, provisioning: value.provisioning === 'pending' ? 'pending' : 'established'};
  }
  const bytes = await randomBytes(48);
  if (bytes.length !== 48) throw new Error('Secure identity generation returned incomplete entropy');
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  const identity: LocalDeviceIdentity = {
    version: 1,
    email: `fire-${hex.slice(0, 32)}@device.fotos.one`,
    secret: hex.slice(32),
    instanceName: DEVICE_NAME,
  };
  // Persist before opening ONE so a later startup can always unlock this store.
  await storage.setItemAsync(DEVICE_IDENTITY_KEY, JSON.stringify({...identity, provisioning: 'pending'}));
  return {credentials: identity, provisioning: 'pending'};
}
