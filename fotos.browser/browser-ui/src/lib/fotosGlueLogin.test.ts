import { webcrypto } from 'node:crypto';
import { createBrowserCredentialVault, type BrowserCredentialRecord } from '@glueone/auth.core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@glueone/auth.core', async importOriginal => ({
  ...await importOriginal<typeof import('@glueone/auth.core')>(), createBrowserGlueLogin: vi.fn(),
}));
import { createFotosGlueLoginSession } from './fotosGlueLogin';
import {
  ACCOUNTS_KEY, ACTIVE_ACCOUNT_KEY, SESSION_ACTIVE_ACCOUNT_KEY, PERSISTENT_KEY,
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
  let localVault: ReturnType<typeof createBrowserCredentialVault>;
  beforeEach(() => {
    let accountQueue = Promise.resolve();
    vi.stubGlobal('navigator', { locks: { request: (_name: string, options: { signal?: AbortSignal }, callback: () => Promise<unknown>) => {
      const operation = accountQueue.then(() => { options.signal?.throwIfAborted(); return callback(); });
      accountQueue = operation.then(() => undefined, () => undefined);
      return operation;
    } } });
    vi.stubGlobal('localStorage', storage());
    vi.stubGlobal('sessionStorage', storage());
    const records = new Map<string, BrowserCredentialRecord>();
    localVault = createBrowserCredentialVault({
      get: async id => records.get(id),
      insert: async (id, record) => { if (!records.has(id)) records.set(id, record); return records.get(id)!; },
    }, webcrypto as unknown as Crypto);
    url = new URL('https://fotos.one/');
    vi.stubGlobal('window', {
      get location() { return { href: url.href }; },
      history: { state: null, replaceState: (_state: unknown, _title: string, value: string) => { url = new URL(value); } },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('preserves the visitor account when verification fails', async () => {
    const local = await resolveFotosBootCreds({ vault: localVault });
    const before = localStorage.getItem(ACCOUNTS_KEY);
    const auth = { login: vi.fn().mockRejectedValue(new Error('Invalid Glue signature')), resume: vi.fn() };
    const session = createFotosGlueLoginSession(auth, { read: vi.fn(), import: localVault.import });
    await expect(session.signIn()).rejects.toThrow('Invalid Glue signature');
    expect(localStorage.getItem(ACCOUNTS_KEY)).toBe(before);
    expect(localStorage.getItem(ACTIVE_ACCOUNT_KEY)).toBe(local.accountId);
  });

  it('does not switch after cancellation, and rejects a duplicate request while busy', async () => {
    const local = await resolveFotosBootCreds({ vault: localVault });
    let finish!: (value: typeof result) => void;
    const auth = { login: vi.fn(() => new Promise<typeof result>(resolve => { finish = resolve; })), resume: vi.fn() };
    const session = createFotosGlueLoginSession(auth, { read: vi.fn(), import: localVault.import });
    const controller = new AbortController();
    const pending = session.signIn({ signal: controller.signal });
    await expect(session.signIn()).rejects.toThrow('already in progress');
    controller.abort();
    finish(result);
    await expect(pending).rejects.toThrow();
    expect(localStorage.getItem(ACTIVE_ACCOUNT_KEY)).toBe(local.accountId);
    expect(auth.login).toHaveBeenCalledTimes(1);
  });

  it('does not select Glue when cancellation arrives while waiting for the account lock', async () => {
    const local = await resolveFotosBootCreds({ vault: localVault });
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const held = navigator.locks.request('fotos.accounts', {}, async () => {
      entered();
      await new Promise<void>(resolve => { release = resolve; });
    });
    await started;
    const auth = { login: vi.fn().mockResolvedValue(result), resume: vi.fn() };
    const controller = new AbortController();
    const signingIn = createFotosGlueLoginSession(auth, localVault).signIn({ signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    release();
    await held;
    await expect(signingIn).rejects.toThrow();
    expect(localStorage.getItem(ACTIVE_ACCOUNT_KEY)).toBe(local.accountId);
    expect(sessionStorage.getItem(SESSION_ACTIVE_ACCOUNT_KEY)).toBeNull();
    expect(localStorage.getItem(ACCOUNTS_KEY)).not.toContain(`glue-${subject}`);
  });

  it('does not select Glue when cancellation arrives during credential migration', async () => {
    const local = await resolveFotosBootCreds({ vault: localVault });
    localStorage.setItem(PERSISTENT_KEY, JSON.stringify({ email: 'old@fotos.one', instanceName: 'old', secret: 'old-secret' }));
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const delayedVault = {
      read: localVault.read,
      import: async (issuer: string, id: string, secret: string) => {
        entered();
        await gate;
        return localVault.import(issuer, id, secret);
      },
    };
    const auth = { login: vi.fn().mockResolvedValue(result), resume: vi.fn() };
    const controller = new AbortController();
    const signingIn = createFotosGlueLoginSession(auth, delayedVault).signIn({ signal: controller.signal });
    await started;
    controller.abort();
    release();
    await expect(signingIn).rejects.toThrow();
    expect(localStorage.getItem(ACTIVE_ACCOUNT_KEY)).toBe(local.accountId);
    expect(sessionStorage.getItem(SESSION_ACTIVE_ACCOUNT_KEY)).toBeNull();
    expect(localStorage.getItem(ACCOUNTS_KEY)).not.toContain(`glue-${subject}`);
    expect((await resolveFotosBootCreds({ vault: localVault })).creds).toEqual(local.creds);
  });

  it('resumes a verified redirect before opening the subject account and consumes the selector', async () => {
    const local = await resolveFotosBootCreds({ vault: localVault });
    url = new URL(`https://fotos.one/?one_token=assertion&fotosAccount=${local.accountId}`);
    sessionStorage.setItem('one_auth_token', 'old-unverified-token');
    const auth = {
      login: vi.fn(), resume: vi.fn(async () => {
        // auth.core owns verification and one-time removal of callback parameters.
        url.searchParams.delete('one_token');
        return result;
      }),
    };
    const vault = { read: vi.fn().mockResolvedValue('vault-secret'), import: localVault.import };
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

  it('honors a new-account selector even when a Glue redirect resumes', async () => {
    url = new URL('https://fotos.one/?fotosAccount=new');
    const auth = { login: vi.fn(), resume: vi.fn().mockResolvedValue(result) };
    const account = await createFotosGlueLoginSession(auth, localVault).resolveBoot();
    expect(account.accountId).toMatch(/^acct-[a-f0-9]{12}$/);
    expect(account.creds.email).toContain('fotos-visitor-');
    expect(localStorage.getItem(ACTIVE_ACCOUNT_KEY)).toBe(`glue-${subject}`);
    expect(url.search).toBe('');
  });

  it('rejects an unsolicited callback before touching account selection or the vault', async () => {
    const local = await resolveFotosBootCreds({ vault: localVault });
    const auth = { login: vi.fn(), resume: vi.fn().mockRejectedValue(new Error('Missing Glue login state')) };
    const vault = { read: vi.fn(), import: localVault.import };
    await expect(createFotosGlueLoginSession(auth, vault).resolveBoot()).rejects.toThrow('Missing Glue login state');
    expect(vault.read).not.toHaveBeenCalled();
    expect(localStorage.getItem(ACTIVE_ACCOUNT_KEY)).toBe(local.accountId);
  });
});
