import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const stateSetters = vi.hoisted(() => [] as Array<ReturnType<typeof vi.fn>>);
const mockUseState = vi.hoisted(() => vi.fn());
const mockUseEffect = vi.hoisted(() => vi.fn());
const mockUseRef = vi.hoisted(() => vi.fn());
const mockUseCallback = vi.hoisted(() => vi.fn((callback: unknown) => callback));

const mockQueueAuthenticationContinuation = vi.hoisted(() => vi.fn());
const mockClearPendingAuthenticationContinuation = vi.hoisted(() => vi.fn());
const mockHasPendingAuthenticationContinuation = vi.hoisted(() => vi.fn(() => false));
const mockEnsureConfiguredGlueIdentity = vi.hoisted(() => vi.fn());
const mockClassifyGlueFailure = vi.hoisted(() => vi.fn());
const mockRunFotosRecoveryFlow = vi.hoisted(() => vi.fn());
const mockCertifyViaPopup = vi.hoisted(() => vi.fn());
const mockRecoverWithPrivateKeyViaPopup = vi.hoisted(() => vi.fn());
const mockRegisterPasskeyViaPopup = vi.hoisted(() => vi.fn());
const mockSignOwnershipProof = vi.hoisted(() => vi.fn());

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

vi.mock('@/lib/authFlowState', () => ({
  queueAuthenticationContinuation: mockQueueAuthenticationContinuation,
  clearPendingAuthenticationContinuation: mockClearPendingAuthenticationContinuation,
  hasPendingAuthenticationContinuation: mockHasPendingAuthenticationContinuation,
}));

vi.mock('@/lib/glueIdentity', () => ({
  ensureConfiguredGlueIdentity: mockEnsureConfiguredGlueIdentity,
}));

vi.mock('@/lib/glueIdentityState', () => ({
  resolveGlueIdentityState: vi.fn(),
}));

vi.mock('@/lib/glueCertification', () => ({
  resolveGlueCertificationState: vi.fn(),
}));

vi.mock('@/lib/authLoginBridge', () => ({
  classifyGlueFailure: mockClassifyGlueFailure,
  toGlueHandle: (displayName: string | null | undefined) =>
    (displayName ?? '').toLowerCase().replace(/[^a-z0-9]/g, ''),
}));

vi.mock('@/lib/fotosIdRecovery', () => ({
  runFotosRecoveryFlow: mockRunFotosRecoveryFlow,
}));

vi.mock('@glueone/auth.core', () => ({
  certifyViaPopup: mockCertifyViaPopup,
  recoverWithPrivateKeyViaPopup: mockRecoverWithPrivateKeyViaPopup,
  registerPasskeyViaPopup: mockRegisterPasskeyViaPopup,
}));

vi.mock('@glueone/glue.core', () => ({
  signOwnershipProof: mockSignOwnershipProof,
}));

vi.mock('../config.js', () => ({
  API_BASE: 'https://api.fotos.one',
}));

import { FotosSettings } from './FotosSettings.tsx';

const REACT_FRAGMENT = Symbol.for('react.fragment');

type RenderNode =
  | { type: '#text'; text: string; props: Record<string, never>; children: RenderNode[] }
  | { type: any; props: any; children: RenderNode[] };

function renderNodes(node: any): RenderNode[] {
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
  const children = renderNodes(node?.props?.children);
  return [{ type: node?.type, props: node?.props ?? {}, children }];
}

function textContent(node: RenderNode): string {
  if ('text' in node) return node.text;
  return node.children.map(textContent).join('');
}

function findHostNode(
  nodes: RenderNode[],
  predicate: (node: RenderNode) => boolean,
): RenderNode | undefined {
  for (const node of nodes) {
    if (predicate(node)) return node;
    const child = findHostNode(node.children, predicate);
    if (child) return child;
  }
  return undefined;
}

function findButtonByText(nodes: RenderNode[], text: string): RenderNode {
  const node = findHostNode(
    nodes,
    candidate => candidate.type === 'button' && textContent(candidate).includes(text),
  );
  if (!node) {
    throw new Error(`Could not find button containing "${text}"`);
  }
  return node;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await vi.dynamicImportSettled();
  await Promise.resolve();
  await Promise.resolve();
}

function setupHookState(options: {
  stateValues: unknown[];
  refValues?: unknown[];
}) {
  stateSetters.length = 0;
  let stateIndex = 0;
  let refIndex = 0;
  const currentStates: unknown[] = [];

  mockUseState.mockImplementation((initialValue: unknown) => {
    const idx = stateIndex;
    const setter = vi.fn((next: unknown) => {
      const prev = currentStates[idx];
      currentStates[idx] =
        typeof next === 'function' ? (next as (value: unknown) => unknown)(prev) : next;
    });
    stateSetters.push(setter);
    const resolvedInitial =
      idx < options.stateValues.length
        ? options.stateValues[idx]
        : (typeof initialValue === 'function' ? (initialValue as () => unknown)() : initialValue);
    currentStates[idx] = resolvedInitial;
    stateIndex += 1;
    return [resolvedInitial, setter];
  });

  mockUseEffect.mockImplementation(() => {});
  mockUseRef.mockImplementation((initialValue: unknown) => {
    const ref = options.refValues?.[refIndex];
    refIndex += 1;
    return ref ?? { current: initialValue };
  });
}

function renderSettings(stateValues: unknown[], overrides?: {
  model?: any;
  acceptSharing?: boolean;
  onAcceptSharingChange?: ReturnType<typeof vi.fn>;
  refValues?: unknown[];
}) {
  setupHookState({ stateValues, refValues: overrides?.refValues });
  const tree = renderNodes(
    FotosSettings({
      model: overrides?.model ?? {
        publicationIdentity: 'person-1',
        ownerId: 'owner-1',
        leuteModel: {},
        settingsPlan: {
          updateSection: vi.fn().mockResolvedValue(undefined),
          getSection: vi.fn(),
        },
      },
      acceptSharing: overrides?.acceptSharing ?? false,
      onAcceptSharingChange: overrides?.onAcceptSharingChange ?? vi.fn(),
    }),
  );
  return {
    tree,
    model: overrides?.model,
  };
}

describe('FotosSettings identity flows', () => {
  const originalFetch = globalThis.fetch;
  const originalNavigator = globalThis.navigator;
  const originalLocalStorage = (globalThis as any).localStorage;
  const originalWindow = globalThis.window;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCallback.mockImplementation((callback: unknown) => callback);
    mockQueueAuthenticationContinuation.mockReset();
    mockClearPendingAuthenticationContinuation.mockReset();
    mockHasPendingAuthenticationContinuation.mockReturnValue(false);
    mockEnsureConfiguredGlueIdentity.mockReset();
    mockClassifyGlueFailure.mockReturnValue({
      code: 'glue_name_taken',
      title: 'Already registered',
      message: 'This name is already taken.',
    });
    mockRunFotosRecoveryFlow.mockReset();
    mockCertifyViaPopup.mockReset();
    mockRecoverWithPrivateKeyViaPopup.mockReset();
    mockRegisterPasskeyViaPopup.mockReset();
    mockSignOwnershipProof.mockResolvedValue({
      identity: 'alice@glue.one',
      publicKey: 'public-key-1',
      signature: 'signature-1',
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        success: true,
        data: { passkeys: [] },
      }),
    }) as any;

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        login: {
          setStatus: vi.fn(),
        },
      },
    });

    (globalThis as any).localStorage = {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
    };

    globalThis.window = {
      location: {
        reload: vi.fn(),
      },
    } as any;
  });

  afterEach(() => {
    if (originalFetch === undefined) {
      delete (globalThis as any).fetch;
    } else {
      globalThis.fetch = originalFetch;
    }

    if (originalNavigator === undefined) {
      delete (globalThis as any).navigator;
    } else {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: originalNavigator,
      });
    }

    if (originalLocalStorage === undefined) {
      delete (globalThis as any).localStorage;
    } else {
      (globalThis as any).localStorage = originalLocalStorage;
    }

    if (originalWindow === undefined) {
      delete (globalThis as any).window;
    } else {
      globalThis.window = originalWindow;
    }
  });

  it('prepares the identity, queues continuation, and reloads before first authentication', async () => {
    const model = {
      publicationIdentity: null,
      ownerId: 'owner-1',
      leuteModel: {},
      settingsPlan: {
        updateSection: vi.fn().mockResolvedValue(undefined),
        getSection: vi.fn(),
      },
    };
    mockEnsureConfiguredGlueIdentity.mockResolvedValue({ personId: 'person-1' });

    const { tree } = renderSettings([
      false,
      null,
      'Alice',
      null,
      'ephemeral',
      null,
      null,
      false,
      null,
      null,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    ], { model });

    const button = findButtonByText(tree, 'Prepare authentication');
    await button.props.onClick();
    await flushPromises();

    expect(mockEnsureConfiguredGlueIdentity).toHaveBeenCalledWith(
      model.settingsPlan,
      model.leuteModel,
      'Alice',
      model.ownerId,
    );
    expect(mockQueueAuthenticationContinuation).toHaveBeenCalledTimes(1);
    expect(model.settingsPlan.updateSection).toHaveBeenCalledWith({
      moduleId: 'glue',
      values: { syncEnabled: true },
    });
    expect(globalThis.window.location.reload).toHaveBeenCalledTimes(1);
    expect(mockCertifyViaPopup).not.toHaveBeenCalled();
  });

  it('authenticates an existing prepared identity and prompts to save a passkey when none exist', async () => {
    mockCertifyViaPopup.mockResolvedValue({
      success: true,
      data: { cert: { validUntil: '2026-05-01T00:00:00.000Z' } },
    });

    const { tree } = renderSettings([
      true,
      'Alice',
      'Alice',
      'person-1',
      'ephemeral',
      null,
      null,
      false,
      null,
      null,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    ]);

    const button = findButtonByText(tree, 'Authenticate');
    await button.props.onClick();
    await flushPromises();

    expect(mockCertifyViaPopup).toHaveBeenCalledWith('person-1', 'Alice');
    expect(mockSignOwnershipProof).toHaveBeenCalledWith(
      'person-1',
      'Alice',
      'passkey-list:{identity}',
    );
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.fotos.one/api/registration/passkey/list',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: 'alice@glue.one',
          publicKey: 'public-key-1',
          signature: 'signature-1',
        }),
      }),
    );
    expect(stateSetters[4]).toHaveBeenCalledWith('certified');
    expect(stateSetters[1]).toHaveBeenCalledWith('Alice');
    expect(stateSetters[2]).toHaveBeenCalledWith('Alice');
    expect(stateSetters[11]).toHaveBeenCalledWith(true);
    expect(mockClearPendingAuthenticationContinuation).toHaveBeenCalled();
  });

  it('recovers the identity with fotos proof from the warning actions', async () => {
    mockRunFotosRecoveryFlow.mockResolvedValue({
      personId: 'person-1',
      cert: { validUntil: '2026-05-01T00:00:00.000Z' },
    });
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        success: true,
        data: { passkeys: [{ credentialId: 'cred-1' }] },
      }),
    });

    const { tree } = renderSettings([
      true,
      'Alice',
      'Alice',
      'person-1',
      'ephemeral',
      null,
      null,
      false,
      null,
      {
        code: 'glue_name_taken',
        title: 'Already registered',
        message: 'This name is already taken.',
      },
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    ]);

    const button = findButtonByText(tree, 'Recover with fotos proof');
    await button.props.onClick();
    await flushPromises();

    expect(mockRunFotosRecoveryFlow).toHaveBeenCalledWith(expect.objectContaining({
      requestedDisplayName: 'Alice',
      requestedIdentity: 'alice@glue.one',
      getFotosRecoveryTarget: expect.any(Function),
      signClaimWithGlueKey: expect.any(Function),
    }));
    expect(stateSetters[4]).toHaveBeenCalledWith('certified');
    expect(stateSetters[1]).toHaveBeenCalledWith('Alice');
    expect(stateSetters[2]).toHaveBeenCalledWith('Alice');
  });

  it('recovers the identity with the exported recovery key from the warning actions', async () => {
    mockRecoverWithPrivateKeyViaPopup.mockResolvedValue({
      success: true,
      data: { cert: { validUntil: '2026-05-01T00:00:00.000Z' } },
    });
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        success: true,
        data: { passkeys: [{ credentialId: 'cred-1' }] },
      }),
    });

    const { tree } = renderSettings([
      true,
      'Alice',
      'Alice',
      'person-1',
      'ephemeral',
      null,
      null,
      false,
      null,
      {
        code: 'glue_name_taken',
        title: 'Already registered',
        message: 'This name is already taken.',
      },
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    ]);

    const button = findButtonByText(tree, 'Recover with recovery key');
    await button.props.onClick();
    await flushPromises();

    expect(mockRecoverWithPrivateKeyViaPopup).toHaveBeenCalledWith('person-1', 'Alice');
    expect(stateSetters[4]).toHaveBeenCalledWith('certified');
    expect(stateSetters[1]).toHaveBeenCalledWith('Alice');
    expect(stateSetters[2]).toHaveBeenCalledWith('Alice');
  });

  it('changes the user ID while keeping the current local identity', async () => {
    mockCertifyViaPopup.mockResolvedValue({
      success: true,
      data: { cert: { validUntil: '2026-05-01T00:00:00.000Z' } },
    });
    mockEnsureConfiguredGlueIdentity.mockResolvedValue({ personId: 'person-1' });
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        success: true,
        data: { passkeys: [{ credentialId: 'cred-1' }] },
      }),
    });

    const model = {
      publicationIdentity: 'person-1',
      ownerId: 'owner-1',
      leuteModel: {},
      settingsPlan: {
        updateSection: vi.fn().mockResolvedValue(undefined),
        getSection: vi.fn(),
      },
    };

    const { tree } = renderSettings([
      true,
      'Alice',
      'Bob',
      'person-1',
      'certified',
      null,
      1,
      false,
      null,
      null,
      true,
      false,
      false,
      false,
      false,
      false,
      true,
      true,
      false,
    ], { model });

    const button = findButtonByText(tree, 'Change user ID');
    await button.props.onClick();
    await flushPromises();

    expect(mockCertifyViaPopup).toHaveBeenCalledWith('person-1', 'Bob');
    expect(mockEnsureConfiguredGlueIdentity).toHaveBeenCalledWith(
      model.settingsPlan,
      model.leuteModel,
      'Bob',
      model.ownerId,
    );
    expect(stateSetters[1]).toHaveBeenCalledWith('Bob');
    expect(stateSetters[2]).toHaveBeenCalledWith('Bob');
    expect(stateSetters[16]).toHaveBeenCalledWith(false);
  });
});
