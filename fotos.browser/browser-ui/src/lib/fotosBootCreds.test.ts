import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ACCOUNTS_KEY,
  ACTIVE_ACCOUNT_KEY,
  DEFAULT_VISITOR_INSTANCE_NAME,
  LEGACY_ACCOUNT_ID,
  PERSISTENT_KEY,
  SESSION_ACTIVE_ACCOUNT_KEY,
  SESSION_KEY,
  resolveFotosBootCreds,
} from './fotosBootCreds';

function createStorageMock(seed: Record<string, string> = {}): Storage {
  const state = new Map(Object.entries(seed));

  return {
    get length() {
      return state.size;
    },
    clear() {
      state.clear();
    },
    getItem(key: string) {
      return state.has(key) ? state.get(key)! : null;
    },
    key(index: number) {
      return Array.from(state.keys())[index] ?? null;
    },
    removeItem(key: string) {
      state.delete(key);
    },
    setItem(key: string, value: string) {
      state.set(key, value);
    },
  };
}

describe('fotosBootCreds', () => {
  const originalLocalStorage = globalThis.localStorage;
  const originalSessionStorage = globalThis.sessionStorage;

  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: createStorageMock(),
    });
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: createStorageMock(),
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: originalLocalStorage,
    });
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: originalSessionStorage,
    });
  });

  it('prefers already persisted credentials', () => {
    const persistedCreds = {
      email: 'alice@fotos.one',
      secret: 'secret-1',
      instanceName: 'fotos-alice',
    };
    localStorage.setItem(PERSISTENT_KEY, JSON.stringify(persistedCreds));
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      email: 'fotos-visitor-old@fotos.one',
      secret: 'secret-old',
    }));

    expect(resolveFotosBootCreds()).toEqual({
      creds: persistedCreds,
      accountId: LEGACY_ACCOUNT_ID,
      persistent: true,
      sessionScoped: false,
      source: 'persistent',
      storageDirectory: 'fotos.one.storage',
    });
    expect(sessionStorage.getItem(SESSION_KEY)).not.toBeNull();
    expect(localStorage.getItem(ACTIVE_ACCOUNT_KEY)).toBe(LEGACY_ACCOUNT_ID);
  });

  it('migrates session credentials into persistent storage', () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      email: 'fotos-visitor-123@fotos.one',
      secret: 'secret-123',
    }));

    const result = resolveFotosBootCreds();

    expect(result).toEqual({
      creds: {
        email: 'fotos-visitor-123@fotos.one',
        secret: 'secret-123',
        instanceName: DEFAULT_VISITOR_INSTANCE_NAME,
      },
      accountId: LEGACY_ACCOUNT_ID,
      persistent: true,
      sessionScoped: false,
      source: 'migrated-session',
      storageDirectory: 'fotos.one.storage',
    });
    expect(localStorage.getItem(PERSISTENT_KEY)).toBe(JSON.stringify(result.creds));
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('creates and persists a visitor identity when nothing is stored yet', () => {
    const result = resolveFotosBootCreds();

    expect(result.persistent).toBe(true);
    expect(result.accountId).toBe(LEGACY_ACCOUNT_ID);
    expect(result.sessionScoped).toBe(false);
    expect(result.source).toBe('visitor-created');
    expect(result.storageDirectory).toBe('fotos.one.storage');
    expect(result.creds.instanceName).toBe(DEFAULT_VISITOR_INSTANCE_NAME);
    expect(result.creds.email).toMatch(/^fotos-visitor-[0-9a-f]{10}@fotos\.one$/);
    expect(result.creds.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(localStorage.getItem(PERSISTENT_KEY)).toBe(JSON.stringify(result.creds));
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('creates a session-scoped account for a new-account selector', () => {
    const result = resolveFotosBootCreds({ accountSelector: 'new' });

    expect(result.source).toBe('visitor-created');
    expect(result.sessionScoped).toBe(true);
    expect(result.accountId).toMatch(/^acct-[0-9a-f]{12}$/);
    expect(result.storageDirectory).toBe(`fotos.one.storage.${result.accountId}`);
    expect(sessionStorage.getItem(SESSION_ACTIVE_ACCOUNT_KEY)).toBe(result.accountId);
    expect(localStorage.getItem(ACTIVE_ACCOUNT_KEY)).toBeNull();

    const storedAccounts = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) ?? '{}');
    expect(storedAccounts.accounts).toEqual([
      expect.objectContaining({
        id: result.accountId,
        creds: result.creds,
        storageDirectory: result.storageDirectory,
      }),
    ]);
  });

  it('keeps a tab on its session-scoped account after the selector is consumed', () => {
    const created = resolveFotosBootCreds({ accountSelector: 'new' });
    const reopened = resolveFotosBootCreds();

    expect(reopened).toEqual({
      creds: created.creds,
      accountId: created.accountId,
      persistent: true,
      sessionScoped: true,
      source: 'persistent',
      storageDirectory: created.storageDirectory,
    });
  });

  it('opens a known account selector in the current tab session', () => {
    const created = resolveFotosBootCreds({ accountSelector: 'new' });
    sessionStorage.clear();

    const selected = resolveFotosBootCreds({ accountSelector: created.accountId });

    expect(selected.creds).toEqual(created.creds);
    expect(selected.accountId).toBe(created.accountId);
    expect(selected.sessionScoped).toBe(true);
    expect(sessionStorage.getItem(SESSION_ACTIVE_ACCOUNT_KEY)).toBe(created.accountId);
  });
});
