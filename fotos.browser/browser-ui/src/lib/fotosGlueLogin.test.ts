import { webcrypto } from 'node:crypto';
import { createBrowserCredentialVault, type BrowserCredentialRecord } from '@glueone/auth.core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@glueone/auth.core', async importOriginal => ({
  ...await importOriginal<typeof import('@glueone/auth.core')>(), createBrowserGlueEnrollment: vi.fn(),
}));
import { createFotosEnrollmentFixture } from './fotosGlueEnrollment.test-fixture.js';
import { createFotosGlueLoginSession } from './fotosGlueLogin';
import {
  ACCOUNTS_KEY, ACTIVE_ACCOUNT_KEY, SESSION_ACTIVE_ACCOUNT_KEY, PERSISTENT_KEY,
  resolveFotosBootCreds, selectFotosGlueAccount, markFotosNativeGlueEnrollmentInstalled,
} from './fotosBootCreds';

function storage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; }, clear: () => values.clear(),
    getItem: key => values.get(key) ?? null, key: index => [...values.keys()][index] ?? null,
    setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); },
  };
}
let result: Awaited<ReturnType<typeof createFotosEnrollmentFixture>>;

describe('Fotos Glue session', () => {
  let url: URL;
  let localVault: ReturnType<typeof createBrowserCredentialVault>;
  beforeEach(async () => {
    result = await createFotosEnrollmentFixture();
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

  it('enrolls the original native Person in a distinct store and reopens exact encrypted custody offline', async () => {
    const visitor = await resolveFotosBootCreds({ vault: localVault });
    const oldSubject = 'c'.repeat(64);
    await localVault.import('https://glue.one', oldSubject, 'previous-external-secret');
    await selectFotosGlueAccount(oldSubject, localVault);
    const enroll = vi.fn().mockResolvedValue(result);
    const session = createFotosGlueLoginSession(enroll, localVault);
    await session.signIn({ loginHint: 'gecko@glue.one' });
    const account = await session.resolveBoot();
    expect(account.accountId).toBe(`glue-native-${result.instanceId}`);
    expect(account.creds).toEqual(result.creds);
    expect(account.nativeEnrollment).toEqual(result);
    expect(account.nativeEnrollment?.person.email).toBe('gecko@glue.one');
    expect(account.nativeEnrollment?.personId).toBe(result.personId);
    expect(account.nativeEnrollmentPendingInstall).toBe(true);
    await markFotosNativeGlueEnrollmentInstalled(account.accountId, result, localVault);
    const publicIndex = JSON.parse(localStorage.getItem(ACCOUNTS_KEY)!);
    publicIndex.accounts.find((entry: { id: string }) => entry.id === account.accountId).nativeEnrollmentInstalled = false;
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(publicIndex));
    expect(await session.resolveBoot()).toEqual({ ...account, nativeEnrollmentPendingInstall: false });
    expect(enroll).toHaveBeenCalledTimes(1);
    const publicState = localStorage.getItem(ACCOUNTS_KEY)!;
    for (const secret of [result.creds.secret, ...Object.values(result.keys)]) expect(publicState).not.toContain(secret);
    expect(JSON.parse(publicState).accounts.map((value: { id: string }) => value.id)).toEqual([
      visitor.accountId, `glue-${oldSubject}`, account.accountId,
    ]);
    const oldAccount = await resolveFotosBootCreds({ accountSelector: `glue-${oldSubject}`, vault: localVault });
    expect(oldAccount.creds).toEqual({email: `glue:${oldSubject}`, instanceName: 'fotos-glue', secret: 'previous-external-secret'});
  });

  it('keeps interrupted native admission pending when a public installed marker is forged', async () => {
    const session = createFotosGlueLoginSession(vi.fn().mockResolvedValue(result), localVault);
    await session.signIn({loginHint: 'gecko'});
    const index = JSON.parse(localStorage.getItem(ACCOUNTS_KEY)!);
    index.accounts[0].nativeEnrollmentInstalled = true;
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(index));
    expect((await session.resolveBoot()).nativeEnrollmentPendingInstall).toBe(true);
    index.accounts[0].nativeEnrollmentInstalled = false;
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(index));
    expect((await session.resolveBoot()).nativeEnrollmentPendingInstall).toBe(true);
  });

  it('rejects immutable admission evidence bound to another enrollment receipt', async () => {
    const session = createFotosGlueLoginSession(vi.fn().mockResolvedValue(result), localVault);
    await session.signIn({loginHint: 'gecko'});
    const accountId = `glue-native-${result.instanceId}`;
    await localVault.import('https://fotos.one', `${accountId}:admitted`, JSON.stringify({version: 1, enrollmentSha256: '0'.repeat(64)}));
    await expect(session.resolveBoot()).rejects.toThrow('admission does not match enrollment custody');
  });

  it('rejects receipt/private-key mismatch before changing account selection', async () => {
    const visitor = await resolveFotosBootCreds({ vault: localVault });
    const before = localStorage.getItem(ACCOUNTS_KEY);
    const other = await createFotosEnrollmentFixture();
    const enroll = vi.fn().mockResolvedValue({ ...result, keys: other.keys });
    await expect(createFotosGlueLoginSession(enroll, localVault).signIn({loginHint: 'gecko'})).rejects.toThrow('key mismatch');
    expect(localStorage.getItem(ACCOUNTS_KEY)).toBe(before);
    expect(localStorage.getItem(ACTIVE_ACCOUNT_KEY)).toBe(visitor.accountId);
  });

  it('fails if the saved native vault record is missing instead of creating new credentials', async () => {
    await createFotosGlueLoginSession(vi.fn().mockResolvedValue(result), localVault).signIn({loginHint: 'gecko'});
    const missingVault = { read: vi.fn().mockResolvedValue(undefined), import: vi.fn() };
    await expect(createFotosGlueLoginSession(vi.fn(), missingVault).resolveBoot()).rejects.toThrow('saved native Glue enrollment is unavailable');
    expect(missingVault.import).not.toHaveBeenCalled();
  });

  it('rejects saved public metadata that no longer matches encrypted native custody', async () => {
    await createFotosGlueLoginSession(vi.fn().mockResolvedValue(result), localVault).signIn({loginHint: 'gecko'});
    const index = JSON.parse(localStorage.getItem(ACCOUNTS_KEY)!);
    index.accounts[0].localIdentity.instanceName = 'different-instance';
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(index));
    await expect(createFotosGlueLoginSession(vi.fn(), localVault).resolveBoot()).rejects.toThrow('Saved native Glue enrollment identity mismatch');
  });

  it('requires the registered name before opening enrollment', async () => {
    const enroll = vi.fn();
    await expect(createFotosGlueLoginSession(enroll, localVault).signIn()).rejects.toThrow('Enter your registered');
    expect(enroll).not.toHaveBeenCalled();
  });

  it('preserves the visitor account when verification fails', async () => {
    const local = await resolveFotosBootCreds({ vault: localVault });
    const before = localStorage.getItem(ACCOUNTS_KEY);
    const auth = vi.fn().mockRejectedValue(new Error('Invalid Glue signature'));
    const session = createFotosGlueLoginSession(auth, { read: vi.fn(), import: localVault.import });
    await expect(session.signIn({loginHint: 'gecko'})).rejects.toThrow('Invalid Glue signature');
    expect(localStorage.getItem(ACCOUNTS_KEY)).toBe(before);
    expect(localStorage.getItem(ACTIVE_ACCOUNT_KEY)).toBe(local.accountId);
  });

  it('does not switch after cancellation, and rejects a duplicate request while busy', async () => {
    const local = await resolveFotosBootCreds({ vault: localVault });
    let finish!: (value: typeof result) => void;
    const auth = vi.fn(() => new Promise<typeof result>(resolve => { finish = resolve; }));
    const session = createFotosGlueLoginSession(auth, { read: vi.fn(), import: localVault.import });
    const controller = new AbortController();
    const pending = session.signIn({ loginHint: 'gecko', signal: controller.signal });
    await expect(session.signIn()).rejects.toThrow('already in progress');
    controller.abort();
    finish(result);
    await expect(pending).rejects.toThrow();
    expect(localStorage.getItem(ACTIVE_ACCOUNT_KEY)).toBe(local.accountId);
    expect(auth).toHaveBeenCalledTimes(1);
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
    const auth = vi.fn().mockResolvedValue(result);
    const controller = new AbortController();
    const signingIn = createFotosGlueLoginSession(auth, localVault).signIn({ loginHint: 'gecko', signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    release();
    await held;
    await expect(signingIn).rejects.toThrow();
    expect(localStorage.getItem(ACTIVE_ACCOUNT_KEY)).toBe(local.accountId);
    expect(sessionStorage.getItem(SESSION_ACTIVE_ACCOUNT_KEY)).toBeNull();
    expect(localStorage.getItem(ACCOUNTS_KEY)).not.toContain(`glue-native-${result.instanceId}`);
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
    const auth = vi.fn().mockResolvedValue(result);
    const controller = new AbortController();
    const signingIn = createFotosGlueLoginSession(auth, delayedVault).signIn({ loginHint: 'gecko', signal: controller.signal });
    await started;
    controller.abort();
    release();
    await expect(signingIn).rejects.toThrow();
    expect(localStorage.getItem(ACTIVE_ACCOUNT_KEY)).toBe(local.accountId);
    expect(sessionStorage.getItem(SESSION_ACTIVE_ACCOUNT_KEY)).toBeNull();
    expect(localStorage.getItem(ACCOUNTS_KEY)).not.toContain(`glue-native-${result.instanceId}`);
    expect((await resolveFotosBootCreds({ vault: localVault })).creds).toEqual(local.creds);
  });

  it('opens selected accounts without repeating a remote ceremony and consumes the selector', async () => {
    const local = await resolveFotosBootCreds({ vault: localVault });
    url = new URL(`https://fotos.one/?fotosAccount=${local.accountId}`);
    sessionStorage.setItem('one_auth_token', 'old-unverified-token');
    const enroll = vi.fn();
    const account = await createFotosGlueLoginSession(enroll, localVault).resolveBoot();
    expect(account.creds).toEqual(local.creds);
    expect(enroll).not.toHaveBeenCalled();
    expect(url.search).toBe('');
    expect(sessionStorage.getItem('one_auth_token')).toBeNull();
  });

  it('honors an explicit new visitor account selector', async () => {
    url = new URL('https://fotos.one/?fotosAccount=new');
    const account = await createFotosGlueLoginSession(vi.fn(), localVault).resolveBoot();
    expect(account.accountId).toMatch(/^acct-[a-f0-9]{12}$/);
    expect(account.creds.email).toContain('fotos-visitor-');
    expect(url.search).toBe('');
  });

  it('rejects and removes a legacy external-trust callback before touching the vault', async () => {
    const local = await resolveFotosBootCreds({ vault: localVault });
    url = new URL('https://fotos.one/?one_token=untrusted');
    const vault = { read: vi.fn(), import: localVault.import };
    await expect(createFotosGlueLoginSession(vi.fn(), vault).resolveBoot()).rejects.toThrow('Legacy Glue login callback');
    expect(vault.read).not.toHaveBeenCalled();
    expect(localStorage.getItem(ACTIVE_ACCOUNT_KEY)).toBe(local.accountId);
    expect(url.search).toBe('');
  });
});
