import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_VISITOR_INSTANCE_NAME,
  PERSISTENT_KEY,
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
      persistent: true,
      source: 'persistent',
    });
    expect(sessionStorage.getItem(SESSION_KEY)).not.toBeNull();
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
      persistent: true,
      source: 'migrated-session',
    });
    expect(localStorage.getItem(PERSISTENT_KEY)).toBe(JSON.stringify(result.creds));
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('creates and persists a visitor identity when nothing is stored yet', () => {
    const result = resolveFotosBootCreds();

    expect(result.persistent).toBe(true);
    expect(result.source).toBe('visitor-created');
    expect(result.creds.instanceName).toBe(DEFAULT_VISITOR_INSTANCE_NAME);
    expect(result.creds.email).toMatch(/^fotos-visitor-[0-9a-f]{10}@fotos\.one$/);
    expect(result.creds.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(localStorage.getItem(PERSISTENT_KEY)).toBe(JSON.stringify(result.creds));
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });
});
