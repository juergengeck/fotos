import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@glueone/auth.core', () => ({
  createBrowserCredentialVault: vi.fn(), createBrowserGlueLogin: vi.fn(),
}));
import { createFotosGlueLoginSession } from './fotosGlueLogin';
import {
  ACCOUNTS_KEY, ACTIVE_ACCOUNT_KEY, SESSION_ACTIVE_ACCOUNT_KEY,
  resolveFotosBootCreds,
} from './fotosBootCreds';

function storage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; }, clear: () => values.clear(),
    getItem: key => values.get(key) ?? null, key: index => [...values.keys()][index] ?? null,
    setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); },
  };
}
const subject = 'c'.repeat(64);
const result = { localName: `glue:${subject}`, secret: 'vault-secret', identity: { personId: subject } } as any;

describe('Fotos Glue session', () => {
  let url: URL;
  beforeEach(() => {
    vi.stubGlobal('localStorage', storage());
    vi.stubGlobal('sessionStorage', storage());
    url = new URL('https://fotos.one/');
    vi.stubGlobal('window', {
      get location() { return { href: url.href }; },
      history: { state: null, replaceState: (_state: unknown, _title: string, value: string) => { url = new URL(value); } },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('preserves the visitor account when verification fails', async () => {
    const local = resolveFotosBootCreds();
    const before = localStorage.getItem(ACCOUNTS_KEY);
    const auth = { login: vi.fn().mockRejectedValue(new Error('Invalid Glue signature')), resume: vi.fn() };
    const session = createFotosGlueLoginSession(auth, { read: vi.fn() });
    await expect(session.signIn()).rejects.toThrow('Invalid Glue signature');
    expect(localStorage.getItem(ACCOUNTS_KEY)).toBe(before);
    expect(localStorage.getItem(ACTIVE_ACCOUNT_KEY)).toBe(local.accountId);
  });

  it('does not switch after cancellation, and rejects a duplicate request while busy', async () => {
    const local = resolveFotosBootCreds();
    let finish!: (value: typeof result) => void;
    const auth = { login: vi.fn(() => new Promise<typeof result>(resolve => { finish = resolve; })), resume: vi.fn() };
    const session = createFotosGlueLoginSession(auth, { read: vi.fn() });
    const controller = new AbortController();
    const pending = session.signIn({ signal: controller.signal });
    await expect(session.signIn()).rejects.toThrow('already in progress');
    controller.abort();
    finish(result);
    await expect(pending).rejects.toThrow();
    expect(localStorage.getItem(ACTIVE_ACCOUNT_KEY)).toBe(local.accountId);
    expect(auth.login).toHaveBeenCalledTimes(1);
  });

  it('resumes a verified redirect before opening the subject account and consumes the selector', async () => {
    const local = resolveFotosBootCreds();
    url = new URL(`https://fotos.one/?one_token=assertion&fotosAccount=${local.accountId}`);
    sessionStorage.setItem('one_auth_token', 'old-unverified-token');
    const auth = {
      login: vi.fn(), resume: vi.fn(async () => {
        // auth.core owns verification and one-time removal of callback parameters.
        url.searchParams.delete('one_token');
        return result;
      }),
    };
    const vault = { read: vi.fn().mockResolvedValue('vault-secret') };
    const session = createFotosGlueLoginSession(auth, vault);
    const account = await session.resolveBoot();
    expect(auth.resume).toHaveBeenCalledTimes(1);
    expect(account.accountId).toBe(`glue-${subject}`);
    expect(account.creds).toMatchObject({ email: result.localName, secret: 'vault-secret' });
    expect(vault.read).toHaveBeenCalledWith('https://glue.one', subject);
    expect(url.search).toBe('');
    expect(sessionStorage.getItem('one_auth_token')).toBeNull();
    expect(sessionStorage.getItem(SESSION_ACTIVE_ACCOUNT_KEY)).toBe(account.accountId);
  });

  it('rejects an unsolicited callback before touching account selection or the vault', async () => {
    const local = resolveFotosBootCreds();
    const auth = { login: vi.fn(), resume: vi.fn().mockRejectedValue(new Error('Missing Glue login state')) };
    const vault = { read: vi.fn() };
    await expect(createFotosGlueLoginSession(auth, vault).resolveBoot()).rejects.toThrow('Missing Glue login state');
    expect(vault.read).not.toHaveBeenCalled();
    expect(localStorage.getItem(ACTIVE_ACCOUNT_KEY)).toBe(local.accountId);
  });
});
