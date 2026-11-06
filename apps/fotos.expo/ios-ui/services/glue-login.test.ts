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
const subject = 'ab'.repeat(32), secret = '98'.repeat(32);
beforeEach(() => {
  vi.resetModules(); native.values.clear(); native.writes.mockClear();
  native.random.mockImplementation(() => {throw new Error('Offline restore cannot mint a secret');});
  native.browser.mockImplementation(() => {throw new Error('Offline restore cannot open Glue');});
  vi.stubGlobal('fetch', vi.fn(() => {throw new Error('Networking disabled');}));
});
afterEach(() => vi.unstubAllGlobals());
describe('Expo offline Glue reopening', () => {
  it('opens the existing local account after process restart while networking is disabled', async () => {
    native.values.set(`glue.one.${subject}`, secret);
    const first = await import('./glue-login'); await first.rememberGlueSession(subject);
    vi.resetModules();
    const restarted = await import('./glue-login'); const localLogin = vi.fn(async () => {});
    await expect(restarted.restoreGlueSession(localLogin)).resolves.toBe(true);
    expect(localLogin).toHaveBeenCalledWith(`glue:${subject}`, secret);
    expect(native.random).not.toHaveBeenCalled(); expect(native.browser).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('explicit logout prevents restore after restart and retains the saved secret', async () => {
    native.values.set(`glue.one.${subject}`, secret);
    const session = await import('./glue-login'); await session.rememberGlueSession(subject); await session.clearGlueSession();
    vi.resetModules(); const restarted = await import('./glue-login'); const localLogin = vi.fn();
    await expect(restarted.restoreGlueSession(localLogin)).resolves.toBe(false);
    expect(localLogin).not.toHaveBeenCalled(); expect(native.values.get(`glue.one.${subject}`)).toBe(secret);
  });
  it.each(['missing', 'corrupt'])('reports a %s local credential without a remote login or replacement', async mode => {
    native.values.set('glue.one.active-subject', subject);
    if (mode === 'corrupt') native.values.set(`glue.one.${subject}`, 'corrupt');
    const session = await import('./glue-login'); const localLogin = vi.fn();
    await expect(session.restoreGlueSession(localLogin)).rejects.toThrow();
    expect(localLogin).not.toHaveBeenCalled(); expect(native.writes).not.toHaveBeenCalled();
    expect(native.random).not.toHaveBeenCalled(); expect(native.browser).not.toHaveBeenCalled();
  });
  it('invalidates a prepared login continuation when logout happens during local login', async () => {
    native.values.set(`glue.one.${subject}`, secret);
    const session = await import('./glue-login');
    const rememberAfterLocalLogin = session.prepareGlueSession();
    await session.clearGlueSession();
    await rememberAfterLocalLogin(subject);
    await expect(session.restoreGlueSession(vi.fn())).resolves.toBe(false);
    expect(native.values.has('glue.one.active-subject')).toBe(false);
  });

});
