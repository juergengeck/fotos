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

const REACT_FRAGMENT = Symbol.for('react.fragment');

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

function renderNodes(node: any): any[] {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (Array.isArray(node)) return node.flatMap(renderNodes);
  if (typeof node === 'string' || typeof node === 'number') {
    return [{ type: '#text', text: String(node), props: {}, children: [] }];
  }
  if (typeof node?.type === 'function') {
    return renderNodes(node.type(node.props));
  }
  if (node?.type === REACT_FRAGMENT) {
    return renderNodes(node.props?.children);
  }
  return [{
    type: node?.type,
    props: node?.props ?? {},
    children: renderNodes(node?.props?.children),
  }];
}

function textContent(node: any): string {
  if (node.type === '#text') return node.text;
  return node.children.map(textContent).join('');
}

function findButtonByTextOrUndefined(nodes: any[], text: string): any {
  for (const node of nodes) {
    if (node.type === 'button' && textContent(node).includes(text)) {
      return node;
    }
    const child = findButtonByTextOrUndefined(node.children, text);
    if (child) return child;
  }
  return undefined;
}

function findButtonByText(nodes: any[], text: string): any {
  const node = findButtonByTextOrUndefined(nodes, text);
  if (node) return node;
  throw new Error(`Could not find button containing "${text}"`);
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await vi.dynamicImportSettled();
  await Promise.resolve();
  await Promise.resolve();
}

describe('FotosIdPopup', () => {
  const originalWindow = globalThis.window;
  const originalUrl = globalThis.URL;

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
    if (originalUrl === undefined) {
      delete (globalThis as any).URL;
    } else {
      globalThis.URL = originalUrl;
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

  it('creates a fotos id proof from the derived key and returns it to the opener', async () => {
    const opener = { postMessage: vi.fn() };
    globalThis.window = {
      opener,
      close: vi.fn(),
      location: { search: '' },
    } as any;
    globalThis.URL = {
      revokeObjectURL: vi.fn(),
    } as any;

    const mockFile = {
      name: 'photo-1.jpg',
      arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
    };
    const stateValues = [
      'setup',
      'create',
      'Alice',
      null,
      'photos',
      'Alice',
      'idle',
      null,
      [{ file: mockFile, thumbnailUrl: 'blob:photo-1' }],
      'secret-passphrase',
      '',
      null,
    ];
    let stateIndex = 0;
    mockUseState.mockImplementation((initialValue: unknown) => {
      const setter = vi.fn();
      stateSetters.push(setter);
      const resolvedValue = stateValues[stateIndex]
        ?? (typeof initialValue === 'function' ? (initialValue as () => unknown)() : initialValue);
      stateIndex += 1;
      return [resolvedValue, setter];
    });
    let refIndex = 0;
    mockUseRef.mockImplementation((initialValue: unknown) => {
      refIndex += 1;
      if (refIndex === 1) {
        return {
          current: {
            requestId: 'request-create',
            mode: 'create',
            displayName: 'Alice',
            personId: 'person-1',
            personPublicKey: 'glue-public-key-1',
            challengeId: 'challenge-id-1',
            challenge: 'challenge-1',
          },
        };
      }
      if (refIndex === 2) return { current: 'https://glue.one' };
      if (refIndex === 3) return { current: true };
      return { current: initialValue };
    });
    mockUseEffect.mockImplementation(() => {});

    const { deriveKeyFromPhotos } = await import('@/lib/photo-key-derivation.js');
    const { signRecoveryPayload } = await import('@/lib/fotos-recovery.js');
    const { uint8arrayToHexString } = await import('@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js');
    vi.mocked(deriveKeyFromPhotos).mockResolvedValue({
      publicKey: new Uint8Array([9, 9, 9]),
      secretKey: new Uint8Array(64),
      seed: new Uint8Array(32),
    });
    vi.mocked(uint8arrayToHexString).mockReturnValue('fotos-public-key-1' as any);
    vi.mocked(signRecoveryPayload).mockReturnValue('claim-signature-1');

    const tree = renderNodes(FotosIdPopup());
    const button = findButtonByText(tree, 'Create fotos id');
    await button.props.onClick();
    await flushPromises();

    expect(deriveKeyFromPhotos).toHaveBeenCalledWith({
      images: [new Uint8Array([1, 2, 3])],
      passphrase: 'secret-passphrase',
    });
    expect(signRecoveryPayload).toHaveBeenCalledWith(
      expect.stringContaining('"action":"register"'),
      expect.objectContaining({ publicKey: new Uint8Array([9, 9, 9]) }),
    );
    expect(opener.postMessage).toHaveBeenCalledWith(
      {
        type: 'fotos-id-result',
        requestId: 'request-create',
        success: true,
        data: {
          mode: 'create',
          identity: 'alice@glue.one',
          displayName: 'Alice',
          publicKey: 'fotos-public-key-1',
          claimPayload: expect.stringContaining('"identity":"alice@glue.one"'),
          signature: 'claim-signature-1',
        },
      },
      'https://glue.one',
    );
  });

  it('re-derives the fotos recovery key and signs the recovery claim for the opener', async () => {
    const opener = { postMessage: vi.fn() };
    globalThis.window = {
      opener,
      close: vi.fn(),
      location: { search: '' },
    } as any;
    globalThis.URL = {
      revokeObjectURL: vi.fn(),
    } as any;

    const mockFile = {
      name: 'photo-1.jpg',
      arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([4, 5, 6]).buffer),
    };
    const stateValues = [
      'setup',
      'recover',
      'Alice',
      null,
      'photos',
      'Alice',
      'idle',
      null,
      [{ file: mockFile, thumbnailUrl: 'blob:photo-1' }],
      'secret-passphrase',
      '',
      null,
    ];
    let stateIndex = 0;
    mockUseState.mockImplementation((initialValue: unknown) => {
      const setter = vi.fn();
      stateSetters.push(setter);
      const resolvedValue = stateValues[stateIndex]
        ?? (typeof initialValue === 'function' ? (initialValue as () => unknown)() : initialValue);
      stateIndex += 1;
      return [resolvedValue, setter];
    });
    let refIndex = 0;
    mockUseRef.mockImplementation((initialValue: unknown) => {
      refIndex += 1;
      if (refIndex === 1) {
        return {
          current: {
            requestId: 'request-recover',
            mode: 'recover',
            displayName: 'Alice',
            personId: 'person-1',
            personPublicKey: 'glue-public-key-1',
            challengeId: 'challenge-id-1',
            challenge: 'challenge-1',
            expectedFotosPublicKey: 'expected-fotos-key-1',
          },
        };
      }
      if (refIndex === 2) return { current: 'https://glue.one' };
      if (refIndex === 3) return { current: true };
      return { current: initialValue };
    });
    mockUseEffect.mockImplementation(() => {});

    const { deriveRecoveryKeyCandidatesFromPhotos } = await import('@/lib/photo-key-derivation.js');
    const { selectExpectedRecoveryCandidate, signRecoveryPayload } = await import('@/lib/fotos-recovery.js');
    vi.mocked(deriveRecoveryKeyCandidatesFromPhotos).mockResolvedValue([
      {
        publicKey: new Uint8Array([7, 7, 7]),
        secretKey: new Uint8Array(64),
        seed: new Uint8Array(32),
      },
    ]);
    vi.mocked(selectExpectedRecoveryCandidate).mockReturnValue({
      candidate: {
        publicKey: new Uint8Array([7, 7, 7]),
        secretKey: new Uint8Array(64),
        seed: new Uint8Array(32),
      },
      publicKey: 'expected-fotos-key-1',
    });
    vi.mocked(signRecoveryPayload).mockReturnValue('claim-signature-2');

    const tree = renderNodes(FotosIdPopup());
    const button = findButtonByText(tree, 'Recover fotos id');
    await button.props.onClick();
    await flushPromises();

    expect(deriveRecoveryKeyCandidatesFromPhotos).toHaveBeenCalledWith({
      images: [new Uint8Array([4, 5, 6])],
      passphrase: 'secret-passphrase',
    });
    expect(selectExpectedRecoveryCandidate).toHaveBeenCalledWith(
      'expected-fotos-key-1',
      expect.any(Array),
    );
    expect(signRecoveryPayload).toHaveBeenCalledWith(
      expect.stringContaining('"action":"recover"'),
      expect.objectContaining({
        publicKey: new Uint8Array([7, 7, 7]),
      }),
    );
    expect(opener.postMessage).toHaveBeenCalledWith(
      {
        type: 'fotos-id-result',
        requestId: 'request-recover',
        success: true,
        data: {
          mode: 'recover',
          identity: 'alice@glue.one',
          displayName: 'Alice',
          publicKey: 'expected-fotos-key-1',
          claimPayload: expect.stringContaining('"challengeId":"challenge-id-1"'),
          signature: 'claim-signature-2',
        },
      },
      'https://glue.one',
    );
  });
});
