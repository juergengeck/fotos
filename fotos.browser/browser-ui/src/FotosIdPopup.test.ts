import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const stateSetters = vi.hoisted(() => [] as Array<ReturnType<typeof vi.fn>>);
const effectCallbacks = vi.hoisted(() => [] as Array<() => void | (() => void)>);
const mockUseState = vi.hoisted(() => vi.fn());
const mockUseEffect = vi.hoisted(() => vi.fn());
const mockUseRef = vi.hoisted(() => vi.fn((initial: unknown) => ({ current: initial })));
const mockUseCallback = vi.hoisted(() => vi.fn((callback: unknown) => callback));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: mockUseState,
    useEffect: mockUseEffect,
    useRef: mockUseRef,
    useCallback: mockUseCallback,
  };
});

vi.mock('@/lib/photo-key-derivation.js', () => ({
  deriveKeyFromPhotos: vi.fn(),
  deriveRecoveryKeyCandidatesFromPhotos: vi.fn(),
}));

vi.mock('@/lib/fotos-recovery.js', () => ({
  selectExpectedRecoveryCandidate: vi.fn(),
  signRecoveryPayload: vi.fn(),
}));

vi.mock('@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js', () => ({
  uint8arrayToHexString: vi.fn(),
}));

vi.mock('@/config.js', () => ({
  API_BASE: 'https://api.fotos.one',
}));

import { FotosIdPopup } from './FotosIdPopup.tsx';

type MessageHandler = (event: { origin: string; source: unknown; data?: any }) => void;

function createWindowHarness() {
  const handlers = new Set<MessageHandler>();
  const opener = {
    postMessage: vi.fn(),
  };
  const windowMock = {
    opener,
    close: vi.fn(),
    location: { search: '' },
    addEventListener: vi.fn((type: string, handler: MessageHandler) => {
      if (type === 'message') {
        handlers.add(handler);
      }
    }),
    removeEventListener: vi.fn((type: string, handler: MessageHandler) => {
      if (type === 'message') {
        handlers.delete(handler);
      }
    }),
  };

  return {
    opener,
    windowMock,
    dispatch(origin: string, data: any, source: unknown = opener) {
      for (const handler of handlers) {
        handler({ origin, source, data });
      }
    },
  };
}

function mountPopup() {
  FotosIdPopup();
  const effect = effectCallbacks.at(-1);
  if (!effect) {
    throw new Error('FotosIdPopup did not register the popup handshake effect');
  }
  return effect();
}

describe('FotosIdPopup', () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    stateSetters.length = 0;
    effectCallbacks.length = 0;
    vi.clearAllMocks();

    mockUseState.mockImplementation((initialValue: unknown) => {
      const setter = vi.fn();
      stateSetters.push(setter);
      const resolvedInitialValue = typeof initialValue === 'function'
        ? (initialValue as () => unknown)()
        : initialValue;
      return [resolvedInitialValue, setter];
    });
    mockUseEffect.mockImplementation((callback: () => void | (() => void)) => {
      effectCallbacks.push(callback);
    });
  });

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as any).window;
    } else {
      globalThis.window = originalWindow;
    }
  });

  it('announces readiness and ignores requests from disallowed origins', () => {
    const harness = createWindowHarness();
    globalThis.window = harness.windowMock as any;

    mountPopup();

    expect(harness.opener.postMessage).toHaveBeenCalledWith({ type: 'fotos-id-ready' }, '*');

    harness.dispatch('https://evil.example', {
      type: 'fotos-id-request',
      requestId: 'request-1',
      mode: 'recover',
      displayName: 'Mallory',
    });

    expect(stateSetters[1]).not.toHaveBeenCalled();
    expect(stateSetters[2]).not.toHaveBeenCalled();
    expect(stateSetters[0]).not.toHaveBeenCalledWith('setup');
  });

  it('accepts the first allowed opener request and keeps later duplicates out', () => {
    const harness = createWindowHarness();
    globalThis.window = harness.windowMock as any;

    mountPopup();

    harness.dispatch('http://localhost:5173', {
      type: 'fotos-id-request',
      requestId: 'request-1',
      mode: 'recover',
      displayName: 'Alice',
      personId: 'person-1',
      personPublicKey: 'glue-key-1',
      challengeId: 'challenge-id-1',
      challenge: 'challenge-1',
      expectedFotosPublicKey: 'fotos-key-1',
    });

    expect(stateSetters[1]).toHaveBeenCalledWith('recover');
    expect(stateSetters[2]).toHaveBeenCalledWith('Alice');
    expect(stateSetters[0]).toHaveBeenCalledWith('setup');

    harness.dispatch('http://localhost:5173', {
      type: 'fotos-id-request',
      requestId: 'request-2',
      mode: 'create',
      displayName: 'Bob',
    });

    expect(stateSetters[1]).toHaveBeenCalledTimes(1);
    expect(stateSetters[2]).toHaveBeenCalledTimes(1);
    expect(stateSetters[0]).toHaveBeenCalledTimes(1);
  });
});
