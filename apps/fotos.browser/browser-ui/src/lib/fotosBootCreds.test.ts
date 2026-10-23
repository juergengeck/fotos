import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserCredentialVault, type BrowserCredentialRecord, type BrowserCredentialStore } from '@glueone/auth.core';
import {
  ACCOUNTS_KEY, ACTIVE_ACCOUNT_KEY, DEFAULT_VISITOR_INSTANCE_NAME, LEGACY_ACCOUNT_ID,
  PERSISTENT_KEY, SESSION_ACTIVE_ACCOUNT_KEY, SESSION_PENDING_ACCOUNT_KEY, SESSION_KEY, FOTOS_CREDENTIAL_ISSUER,
  resolveFotosBootCreds, resolveFotosBootAccount, selectFotosGlueAccount,
} from './fotosBootCreds';

function storage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; }, clear: () => values.clear(),
    getItem: key => values.get(key) ?? null, key: index => [...values.keys()][index] ?? null,
    setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); },
  };
}
const legacyCreds = { email: 'alice@fotos.one', secret: 'old arbitrary secret 🔑', instanceName: 'fotos-alice' };
function publicStorage() {
  return [localStorage, sessionStorage].flatMap(store => Array.from({ length: store.length }, (_, i) => store.getItem(store.key(i)!))).join('');
}

describe('sealed Fotos boot credentials', () => {
  let records: Map<string, BrowserCredentialRecord>;
  let store: BrowserCredentialStore;
  let vault: ReturnType<typeof createBrowserCredentialVault>;
  beforeEach(() => {
    let accountQueue = Promise.resolve();
    vi.stubGlobal('navigator', { locks: { request: (_name: string, options: { signal?: AbortSignal }, callback: () => Promise<unknown>) => {
      const operation = accountQueue.then(() => { options.signal?.throwIfAborted(); return callback(); });
      accountQueue = operation.then(() => undefined, () => undefined);
      return operation;
    } } });
    vi.stubGlobal('localStorage', storage());
    vi.stubGlobal('sessionStorage', storage());
    records = new Map();
    store = {
      get: async id => records.get(id),
      insert: async (id, record) => { if (!records.has(id)) records.set(id, record); return records.get(id)!; },
    };
    vault = createBrowserCredentialVault(store, webcrypto as unknown as Crypto);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  const accountIndex = () => JSON.parse(localStorage.getItem(ACCOUNTS_KEY)!);

  it('seals new visitor credentials and reopens the exact identity with a fresh vault', async () => {
    const first = await resolveFotosBootCreds({ vault });
    expect(first).toMatchObject({ accountId: LEGACY_ACCOUNT_ID, persistent: true, sessionScoped: false, source: 'visitor-created', storageDirectory: 'fotos.one.storage' });
    expect(first.creds.email).toMatch(/^fotos-visitor-[0-9a-f]{10}@fotos\.one$/);
    expect(first.creds.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(publicStorage()).not.toContain(first.creds.secret);
    expect(publicStorage()).not.toContain('"secret"');
    expect(localStorage.getItem(PERSISTENT_KEY)).toBeNull();
    const record = [...records.values()][0];
    expect(record.key.extractable).toBe(false);
    expect(new TextDecoder().decode(record.ciphertext)).not.toContain(first.creds.secret);
    const reopened = await resolveFotosBootAccount({ vault: createBrowserCredentialVault(store, webcrypto as unknown as Crypto) });
    expect(reopened).toEqual({ ...first, source: 'persistent' });
  });

  it('seals persistent and session legacy credentials, preferring the persistent identity', async () => {
    localStorage.setItem(PERSISTENT_KEY, JSON.stringify(legacyCreds));
    const sessionCreds = { email: 'visitor@fotos.one', secret: 'session-secret' };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessionCreds));
    const result = await resolveFotosBootCreds({ vault });
    expect(result.creds).toEqual(legacyCreds);
    expect(result.accountId).toBe(LEGACY_ACCOUNT_ID);
    expect(result.storageDirectory).toBe('fotos.one.storage');
    expect(localStorage.getItem(PERSISTENT_KEY)).toBeNull();
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    expect(publicStorage()).not.toContain(legacyCreds.secret);
    expect(publicStorage()).not.toContain(sessionCreds.secret);
    const session = await resolveFotosBootAccount({ vault, accountSelector: 'legacy-session' });
    expect(session.creds).toEqual({ ...sessionCreds, instanceName: DEFAULT_VISITOR_INSTANCE_NAME });
    expect(session.storageDirectory).toBe('fotos.one.storage');
  });

  it('migrates session credentials without changing their secret or default storage directory', async () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ email: legacyCreds.email, secret: legacyCreds.secret }));
    const result = await resolveFotosBootCreds({ vault });
    expect(result).toMatchObject({ creds: { ...legacyCreds, instanceName: DEFAULT_VISITOR_INSTANCE_NAME }, accountId: LEGACY_ACCOUNT_ID, source: 'migrated-session', storageDirectory: 'fotos.one.storage' });
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    expect((await resolveFotosBootAccount({ vault })).creds).toEqual(result.creds);
  });

  it('seals every indexed account and duplicate legacy key, preserving IDs, directories, and tab selection', async () => {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify({ version: 1, accounts: [
      { id: 'legacy', creds: legacyCreds, storageDirectory: 'custom-legacy', createdAt: 'before', updatedAt: 'before' },
      { id: 'second', creds: { ...legacyCreds, secret: 'second-secret' }, storageDirectory: 'custom-second', createdAt: 'before', updatedAt: 'before' },
    ] }));
    localStorage.setItem(PERSISTENT_KEY, JSON.stringify(legacyCreds));
    localStorage.setItem(ACTIVE_ACCOUNT_KEY, 'legacy');
    sessionStorage.setItem(SESSION_ACTIVE_ACCOUNT_KEY, 'second');
    const second = await resolveFotosBootAccount({ vault });
    expect(second).toMatchObject({ accountId: 'second', storageDirectory: 'custom-second', sessionScoped: true, creds: { secret: 'second-secret' } });
    expect(accountIndex().accounts.map((account: { id: string }) => account.id)).toEqual(['legacy', 'second']);
    expect(accountIndex().accounts[0]).toMatchObject({ createdAt: 'before', updatedAt: 'before' });
    expect(publicStorage()).not.toContain('"secret"');
    expect(records.size).toBe(2);
    const first = await resolveFotosBootCreds({ vault, accountSelector: 'legacy' });
    expect(first.creds).toEqual(legacyCreds);
    expect(first.storageDirectory).toBe('custom-legacy');
  });

  it('creates and reselects separate accounts while a Glue account is active', async () => {
    const glueSubject = 'a'.repeat(64);
    await vault.getOrCreate('https://glue.one', glueSubject);
    const glueId = await selectFotosGlueAccount(glueSubject, vault);
    const created = await resolveFotosBootAccount({ vault, accountSelector: 'new' });
    expect(created.accountId).toMatch(/^acct-[a-f0-9]{12}$/);
    expect(created.storageDirectory).toBe(`fotos.one.storage.${created.accountId}`);
    expect(created.sessionScoped).toBe(true);
    expect(localStorage.getItem(ACTIVE_ACCOUNT_KEY)).toBe(glueId);
    expect((await resolveFotosBootAccount({ vault })).creds).toEqual(created.creds);
    sessionStorage.clear();
    expect((await resolveFotosBootAccount({ vault })).accountId).toBe(glueId);
    expect((await resolveFotosBootAccount({ vault, accountSelector: created.accountId })).creds).toEqual(created.creds);
    expect(publicStorage()).not.toContain(created.creds.secret);
  });

  it('fails closed on missing or corrupt local credentials without minting a replacement', async () => {
    const first = await resolveFotosBootAccount({ vault });
    const before = publicStorage();
    const record = records.get(JSON.stringify([FOTOS_CREDENTIAL_ISSUER, first.accountId]))!;
    records.clear();
    await expect(resolveFotosBootAccount({ vault })).rejects.toThrow('saved Fotos account credential');
    expect(records.size).toBe(0);
    expect(publicStorage()).toBe(before);
    new Uint8Array(record.ciphertext)[0] ^= 1;
    records.set(JSON.stringify([FOTOS_CREDENTIAL_ISSUER, first.accountId]), record);
    await expect(resolveFotosBootAccount({ vault })).rejects.toThrow('Unable to decrypt');
    expect(records.size).toBe(1);
  });

  it('fails closed on missing Glue credentials and preserves selection after a failed unlock', async () => {
    const local = await resolveFotosBootAccount({ vault });
    const id = await selectFotosGlueAccount('b'.repeat(64), vault);
    await resolveFotosBootAccount({ vault, accountSelector: local.accountId });
    const before = publicStorage();
    await expect(resolveFotosBootAccount({ vault, accountSelector: id })).rejects.toThrow('saved Glue account credential');
    expect(publicStorage()).toBe(before);
    expect((await resolveFotosBootAccount({ vault })).creds).toEqual(local.creds);
  });

  it('retains legacy credentials and rejects startup if sealing fails', async () => {
    localStorage.setItem(PERSISTENT_KEY, JSON.stringify(legacyCreds));
    const failedVault = createBrowserCredentialVault({ get: async () => undefined, insert: async () => { throw new Error('Vault quota'); } }, webcrypto as unknown as Crypto);
    await expect(resolveFotosBootCreds({ vault: failedVault })).rejects.toThrow('Vault quota');
    expect(localStorage.getItem(PERSISTENT_KEY)).toBe(JSON.stringify(legacyCreds));
    expect(localStorage.getItem(ACCOUNTS_KEY)).toBeNull();
    expect(localStorage.getItem(ACTIVE_ACCOUNT_KEY)).toBeNull();
    expect((await resolveFotosBootCreds({ vault })).creds).toEqual(legacyCreds);
  });

  it('retains plaintext on metadata write failure and retries the identical seal', async () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(legacyCreds));
    const saved = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('Storage full'); });
    await expect(resolveFotosBootCreds({ vault })).rejects.toThrow('Storage full');
    expect(sessionStorage.getItem(SESSION_KEY)).toBe(JSON.stringify(legacyCreds));
    expect(records.size).toBe(1);
    saved.mockRestore();
    expect((await resolveFotosBootCreds({ vault })).creds).toEqual(legacyCreds);
    expect(records.size).toBe(1);
    expect(publicStorage()).not.toContain(legacyCreds.secret);
  });

  it('surfaces legacy removal failures before opening the account', async () => {
    localStorage.setItem(PERSISTENT_KEY, JSON.stringify(legacyCreds));
    const remove = vi.spyOn(localStorage, 'removeItem').mockImplementation(() => { throw new Error('Storage denied'); });
    await expect(resolveFotosBootCreds({ vault })).rejects.toThrow('Storage denied');
    expect(localStorage.getItem(ACTIVE_ACCOUNT_KEY)).toBeNull();
    remove.mockRestore();
    expect((await resolveFotosBootCreds({ vault })).creds).toEqual(legacyCreds);
  });

  it('rejects immutable migration conflicts without overwriting or removing legacy credentials', async () => {
    await vault.import(FOTOS_CREDENTIAL_ISSUER, LEGACY_ACCOUNT_ID, 'already-sealed');
    localStorage.setItem(PERSISTENT_KEY, JSON.stringify(legacyCreds));
    await expect(resolveFotosBootCreds({ vault })).rejects.toThrow('conflicts');
    expect(await vault.read(FOTOS_CREDENTIAL_ISSUER, LEGACY_ACCOUNT_ID)).toBe('already-sealed');
    expect(localStorage.getItem(PERSISTENT_KEY)).toBe(JSON.stringify(legacyCreds));
  });

  it.each(['invalid-json', '{"version":1,"accounts":[{"id":"lost"}]}'])('does not reset malformed saved account metadata: %s', async raw => {
    localStorage.setItem(ACCOUNTS_KEY, raw);
    await expect(resolveFotosBootCreds({ vault })).rejects.toThrow();
    expect(records.size).toBe(0);
    expect(localStorage.getItem(ACCOUNTS_KEY)).toBe(raw);
  });

  it('surfaces Web Storage reads and selection failures without returning unpersisted credentials', async () => {
    const read = vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('Storage denied'); });
    await expect(resolveFotosBootCreds({ vault })).rejects.toThrow('Storage denied');
    expect(records.size).toBe(0);
    read.mockRestore();
    const write = vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => { throw new Error('Session denied'); });
    await expect(resolveFotosBootCreds({ vault, accountSelector: 'new' })).rejects.toThrow('Session denied');
    write.mockRestore();
  });

  it.each([
    [undefined, 'journal'], [undefined, 'selection'], [undefined, 'ready'],
    ['new', 'journal'], ['new', 'selection'], ['new', 'ready'],
  ] as const)('recovers %s account creation after a one-time %s commit failure', async (selector, stage) => {
    // New-account retries must also preserve an already opened default library.
    const existing = selector === 'new' ? await resolveFotosBootAccount({ vault }) : undefined;
    const baselineRecords = records.size;
    const selectStorage = selector === 'new' ? sessionStorage : localStorage;
    const selectionKey = selector === 'new' ? SESSION_ACTIVE_ACCOUNT_KEY : ACTIVE_ACCOUNT_KEY;
    const localWrite = localStorage.setItem.bind(localStorage);
    const selectionWrite = selectStorage.setItem.bind(selectStorage);
    let attemptedJournal: any;
    let failed = false;
    const fail = () => { failed = true; throw new Error('One-time creation commit failure'); };
    vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (key === ACCOUNTS_KEY) {
        const parsed = JSON.parse(value);
        const pending = parsed.accounts.find((account: any) => account.pendingCreation);
        if (pending) attemptedJournal = pending;
        if (!failed && ((stage === 'journal' && pending) || (stage === 'ready' && !pending))) fail();
      }
      if (selectStorage === localStorage && key === selectionKey && stage === 'selection' && !failed) fail();
      localWrite(key, value);
    });
    if (selectStorage !== localStorage) vi.spyOn(selectStorage, 'setItem').mockImplementation((key, value) => {
      if (key === selectionKey && stage === 'selection' && !failed) fail();
      selectionWrite(key, value);
    });
    await expect(resolveFotosBootAccount({ vault, accountSelector: selector })).rejects.toThrow('One-time creation commit failure');
    expect(failed).toBe(true);
    const sealedSecret = attemptedJournal && await vault.read(FOTOS_CREDENTIAL_ISSUER, attemptedJournal.id);
    if (stage === 'journal') {
      expect(records.size).toBe(baselineRecords);
      expect(sealedSecret).toBeUndefined();
    } else {
      expect(records.size).toBe(baselineRecords + 1);
      expect(accountIndex().accounts.find((account: any) => account.id === attemptedJournal.id)).toEqual(attemptedJournal);
      expect(publicStorage()).not.toContain(sealedSecret!);
    }
    // Reconstructing the vault ensures recovery uses only durable state.
    const reopenedVault = createBrowserCredentialVault(store, webcrypto as unknown as Crypto);
    const recovered = await resolveFotosBootAccount({ vault: reopenedVault, accountSelector: selector });
    if (stage !== 'journal' || selector === 'new') {
      expect(recovered.accountId).toBe(attemptedJournal.id);
      expect(recovered.creds).toMatchObject(attemptedJournal.localIdentity);
      if (sealedSecret) expect(recovered.creds.secret).toBe(sealedSecret);
      expect(recovered.storageDirectory).toBe(attemptedJournal.storageDirectory);
    }
    expect(records.size).toBe(baselineRecords + 1);
    expect(accountIndex().accounts.every((account: any) => !account.pendingCreation)).toBe(true);
    expect(publicStorage()).not.toContain(recovered.creds.secret);
    if (existing) expect((await resolveFotosBootAccount({ vault: reopenedVault, accountSelector: existing.accountId })).creds).toEqual(existing.creds);
  });

  it('resumes pending creation after a consumed new-account selector and a vault write failure', async () => {
    const failedVault = createBrowserCredentialVault({ ...store, insert: async () => { throw new Error('Vault quota'); } }, webcrypto as unknown as Crypto);
    await expect(resolveFotosBootAccount({ vault: failedVault, accountSelector: 'new' })).rejects.toThrow('Vault quota');
    const pending = accountIndex().accounts[0];
    expect(records.size).toBe(0);
    expect(pending.pendingCreation).toBe('session');
    const recovered = await resolveFotosBootAccount({ vault });
    expect(recovered.accountId).toBe(pending.id);
    expect(recovered.creds).toMatchObject(pending.localIdentity);
    expect(recovered.sessionScoped).toBe(true);
    expect(records.size).toBe(1);
  });

  it.each(['local', 'Glue'])('keeps another tab on its selected %s account while a session creation is pending', async kind => {
    const local = await resolveFotosBootAccount({ vault });
    let selectedId = local.accountId;
    if (kind === 'Glue') {
      const subject = 'd'.repeat(64);
      await vault.getOrCreate('https://glue.one', subject);
      selectedId = await selectFotosGlueAccount(subject, vault);
    }
    const tabBSession = sessionStorage;
    tabBSession.setItem(SESSION_ACTIVE_ACCOUNT_KEY, selectedId);
    const tabASession = storage();
    vi.stubGlobal('sessionStorage', tabASession);
    const failedVault = createBrowserCredentialVault({ ...store, insert: async () => { throw new Error('Vault quota'); } }, webcrypto as unknown as Crypto);
    await expect(resolveFotosBootAccount({ vault: failedVault, accountSelector: 'new' })).rejects.toThrow('Vault quota');
    const pending = JSON.parse(tabASession.getItem(SESSION_PENDING_ACCOUNT_KEY)!);
    vi.stubGlobal('sessionStorage', tabBSession);
    expect((await resolveFotosBootAccount({ vault })).accountId).toBe(selectedId);
    expect(sessionStorage.getItem(SESSION_ACTIVE_ACCOUNT_KEY)).toBe(selectedId);
    expect(accountIndex().accounts.find((account: any) => account.id === pending.id).pendingCreation).toBe('session');
    vi.stubGlobal('sessionStorage', tabASession);
    expect((await resolveFotosBootAccount({ vault })).accountId).toBe(pending.id);
  });

  it.each(['local', 'Glue'])('honors an explicit %s selection after this tab interrupted new-account creation', async kind => {
    const local = await resolveFotosBootAccount({ vault });
    const failedVault = createBrowserCredentialVault({ ...store, insert: async () => { throw new Error('Vault quota'); } }, webcrypto as unknown as Crypto);
    await expect(resolveFotosBootAccount({ vault: failedVault, accountSelector: 'new' })).rejects.toThrow('Vault quota');
    let selectedId = local.accountId;
    if (kind === 'Glue') {
      const subject = 'c'.repeat(64);
      await vault.getOrCreate('https://glue.one', subject);
      selectedId = await selectFotosGlueAccount(subject, vault);
    } else {
      await resolveFotosBootAccount({ vault, accountSelector: selectedId });
    }
    expect(sessionStorage.getItem(SESSION_PENDING_ACCOUNT_KEY)).toBeNull();
    expect((await resolveFotosBootAccount({ vault })).accountId).toBe(selectedId);
  });

  it('recovers a failed per-tab journal cleanup without resetting the pending identity', async () => {
    const remove = sessionStorage.removeItem.bind(sessionStorage);
    let failed = false;
    vi.spyOn(sessionStorage, 'removeItem').mockImplementation(key => {
      if (key === SESSION_PENDING_ACCOUNT_KEY && !failed) { failed = true; throw new Error('Session cleanup denied'); }
      remove(key);
    });
    await expect(resolveFotosBootAccount({ vault, accountSelector: 'new' })).rejects.toThrow('Session cleanup denied');
    const pending = accountIndex().accounts[0];
    const secret = await vault.read(FOTOS_CREDENTIAL_ISSUER, pending.id);
    const recovered = await resolveFotosBootAccount({ vault });
    expect(recovered).toMatchObject({ accountId: pending.id, creds: { ...pending.localIdentity, secret } });
    expect(records.size).toBe(1);
    expect(sessionStorage.getItem(SESSION_PENDING_ACCOUNT_KEY)).toBeNull();
  });

  it('serializes concurrent new accounts across independent vaults without losing either index entry', async () => {
    const secondVault = createBrowserCredentialVault(store, webcrypto as unknown as Crypto);
    const [first, second] = await Promise.all([
      resolveFotosBootAccount({ vault, accountSelector: 'new' }),
      resolveFotosBootAccount({ vault: secondVault, accountSelector: 'new' }),
    ]);
    expect(first.accountId).not.toBe(second.accountId);
    expect(accountIndex().accounts).toHaveLength(2);
    expect(records.size).toBe(2);
    expect((await resolveFotosBootAccount({ vault: secondVault, accountSelector: first.accountId })).creds).toEqual(first.creds);
    expect((await resolveFotosBootAccount({ vault, accountSelector: second.accountId })).creds).toEqual(second.creds);
  });

  it('serializes migration and Glue selection with concurrent creation, preserving all metadata', async () => {
    localStorage.setItem(PERSISTENT_KEY, JSON.stringify(legacyCreds));
    const secondVault = createBrowserCredentialVault(store, webcrypto as unknown as Crypto);
    const subject = 'f'.repeat(64);
    const [created, glueId] = await Promise.all([
      resolveFotosBootAccount({ vault, accountSelector: 'new' }),
      selectFotosGlueAccount(subject, secondVault),
    ]);
    expect(accountIndex().accounts.map((account: any) => account.id).sort()).toEqual([LEGACY_ACCOUNT_ID, created.accountId, glueId].sort());
    expect((await resolveFotosBootAccount({ vault: secondVault, accountSelector: LEGACY_ACCOUNT_ID })).creds).toEqual(legacyCreds);
    expect((await resolveFotosBootAccount({ vault, accountSelector: created.accountId })).creds).toEqual(created.creds);
    expect(localStorage.getItem(PERSISTENT_KEY)).toBeNull();
    expect(publicStorage()).not.toContain('"secret"');
  });

  it('fails visibly without origin-wide Web Locks before touching account storage', async () => {
    vi.stubGlobal('navigator', {});
    await expect(resolveFotosBootAccount({ vault })).rejects.toThrow('requires browser Web Locks');
    await expect(selectFotosGlueAccount('a'.repeat(64), vault)).rejects.toThrow('requires browser Web Locks');
    expect(records.size).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it('rolls back Glue selection if saving the active account fails', async () => {
    const local = await resolveFotosBootCreds({ vault });
    const before = publicStorage();
    const setItem = localStorage.setItem.bind(localStorage);
    vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (key === ACTIVE_ACCOUNT_KEY && value !== local.accountId) throw new Error('Storage full');
      setItem(key, value);
    });
    await expect(selectFotosGlueAccount('d'.repeat(64), vault)).rejects.toThrow('Storage full');
    expect(publicStorage()).toBe(before);
  });
});
