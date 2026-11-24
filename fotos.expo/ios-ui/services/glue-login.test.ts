import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const native = vi.hoisted(() => ({values: new Map<string, string>(), random: vi.fn(), browser: vi.fn(), writes: vi.fn()}));
vi.mock('expo-crypto', () => ({getRandomBytes: native.random}));
vi.mock('expo-web-browser', () => ({openAuthSessionAsync: native.browser, dismissAuthSession: vi.fn()}));
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only',
  getItemAsync: async (key: string) => native.values.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {native.writes(key, value); native.values.set(key, value);},
  deleteItemAsync: async (key: string) => {native.values.delete(key);},
}));

const canonical = {
  identity: 'gecko@glue.one',
  personId: 'ab'.repeat(32),
  instanceId: 'cd'.repeat(32),
  email: 'gecko@glue.one',
  instanceName: 'fotos-expo-12345678-1234-4123-8123-1234567890ab',
  secret: '98'.repeat(32),
};

beforeEach(() => {
  vi.resetModules();
  native.values.clear();
  native.writes.mockClear();
  native.random.mockImplementation(() => {throw new Error('Offline restore cannot mint a secret');});
  native.browser.mockImplementation(() => {throw new Error('Offline restore cannot open Glue');});
  vi.stubGlobal('fetch', vi.fn(() => {throw new Error('Networking disabled');}));
});
afterEach(() => vi.unstubAllGlobals());

describe('Expo canonical Glue offline reopening', () => {
  it('opens the existing canonical Glue account after process restart while networking is disabled', async () => {
    const first = await import('./glue-login');
    await first.rememberGlueSession(canonical);
    vi.resetModules();
    const restarted = await import('./glue-login');
    const localLogin = vi.fn(async () => {});
    await expect(restarted.restoreGlueSession(localLogin)).resolves.toEqual(canonical);
    expect(localLogin).toHaveBeenCalledWith(canonical);
    expect(native.random).not.toHaveBeenCalled();
    expect(native.browser).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('explicit logout prevents restore after restart while retaining the enrolled subject credentials', async () => {
    const session = await import('./glue-login');
    await session.rememberGlueSession(canonical);
    await session.clearGlueSession();
    vi.resetModules();
    const restarted = await import('./glue-login');
    const localLogin = vi.fn();
    await expect(restarted.restoreGlueSession(localLogin)).resolves.toBeNull();
    expect(localLogin).not.toHaveBeenCalled();
    await expect(restarted.findEnrolledGlueAccount('gecko')).resolves.toEqual(canonical);
  });

  it('forgetGlueSubject clears stale credentials after reinstall', async () => {
    const session = await import('./glue-login');
    await session.rememberGlueSession(canonical);
    await session.forgetGlueSubject(canonical.personId);
    await expect(session.restoreGlueSession(vi.fn())).resolves.toBeNull();
    await expect(session.findEnrolledGlueAccount('gecko')).resolves.toBeNull();
  });

  it.each(['missing', 'corrupt'])('reports a %s canonical credential without a remote login or replacement', async mode => {
    native.values.set('glue.one.canonical.active', canonical.personId);
    if (mode === 'corrupt') native.values.set(`glue.one.canonical.creds.${canonical.personId}`, '{corrupt');
    const session = await import('./glue-login');
    const localLogin = vi.fn();
    await expect(session.restoreGlueSession(localLogin)).rejects.toThrow();
    expect(localLogin).not.toHaveBeenCalled();
    expect(native.writes).not.toHaveBeenCalled();
    expect(native.random).not.toHaveBeenCalled();
    expect(native.browser).not.toHaveBeenCalled();
  });

  it('invalidates a prepared login continuation when logout happens during local login', async () => {
    const session = await import('./glue-login');
    const rememberAfterLocalLogin = session.prepareGlueSession();
    await session.clearGlueSession();
    await rememberAfterLocalLogin(canonical);
    await expect(session.restoreGlueSession(vi.fn())).resolves.toBeNull();
    expect(native.values.has('glue.one.canonical.active')).toBe(false);
  });
});
