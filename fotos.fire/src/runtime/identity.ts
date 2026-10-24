/** Credentials unlock the ONE encrypted store; they never enter a pairing URL. */
export interface LocalDeviceIdentity {
  version: 1;
  email: string;
  secret: string;
  instanceName: string;
}

export const DEVICE_IDENTITY_KEY = 'fotos.fire.local-identity.v1';
export const DEVICE_NAME = 'Fotos Fire TV';

export interface IdentityStorage {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
}

export async function loadDeviceIdentity(
  storage: IdentityStorage,
  randomBytes: (size: number) => Promise<Uint8Array>,
): Promise<LocalDeviceIdentity> {
  const saved = await storage.getItemAsync(DEVICE_IDENTITY_KEY);
  if (saved !== null) {
    let identity: unknown;
    try {
      identity = JSON.parse(saved);
    } catch {
      // JSON parser errors can quote their input. Never surface stored secrets.
      throw new Error('The saved Fire TV identity is invalid. The existing store has been preserved.');
    }
    const value = identity as Partial<LocalDeviceIdentity> | null;
    if (!value || value.version !== 1 || typeof value.email !== 'string'
      || !/^fire-[a-f0-9]{32}@device.fotos.one$/.test(value.email)
      || typeof value.secret !== 'string' || !/^[a-f0-9]{64}$/.test(value.secret)
      || value.instanceName !== DEVICE_NAME) {
      throw new Error('The saved Fire TV identity is invalid. The existing store has been preserved.');
    }
    return value as LocalDeviceIdentity;
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
  await storage.setItemAsync(DEVICE_IDENTITY_KEY, JSON.stringify(identity));
  return identity;
}
