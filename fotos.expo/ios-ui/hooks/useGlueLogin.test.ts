import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const harness = vi.hoisted(() => ({
  setters: [] as Array<ReturnType<typeof vi.fn>>, cleanup: undefined as undefined | (() => void),
  ref: {current: null as AbortController | null},
  signIn: vi.fn(), remember: vi.fn(), prepare: vi.fn(),
}));
vi.mock('react', () => ({
  useRef: () => harness.ref,
  useState: (initial: unknown) => {const setter = vi.fn(); harness.setters.push(setter); return [initial, setter];},
  useEffect: (effect: () => void | (() => void)) => {harness.cleanup = effect() || undefined;},
  useCallback: (callback: unknown) => callback,
}));
vi.mock('../services/glue-login', () => ({
  signInWithGlueCanonical: harness.signIn,
  prepareGlueSession: harness.prepare,
}));
import {useGlueLogin} from './useGlueLogin';

const canonical = {
  identity: 'gecko@glue.one',
  personId: 'ab'.repeat(32),
  instanceId: 'cd'.repeat(32),
  email: 'gecko@glue.one',
  instanceName: 'fotos-expo-12345678-1234-4123-8123-1234567890ab',
  secret: '98'.repeat(32),
};

const hasLocalInstance = vi.fn(async () => false);

beforeEach(() => {
  harness.ref.current = null;
  harness.setters.length = 0;
  harness.cleanup = undefined;
  harness.signIn.mockReset();
  harness.remember.mockReset();
  harness.prepare.mockReset();
  harness.prepare.mockReturnValue(harness.remember);
  hasLocalInstance.mockReset();
  hasLocalInstance.mockResolvedValue(false);
});
afterEach(() => {harness.cleanup?.();});

describe('Expo canonical Glue login UI state', () => {
  it('enrolls and remembers canonical Glue credentials', async () => {
    const onGlueAuth = vi.fn(async () => {});
    const outcome = {kind: 'enrolled' as const, credentials: canonical, receipt: {personId: canonical.personId} as any};
    harness.signIn.mockResolvedValue(outcome);
    const hook = useGlueLogin(onGlueAuth, hasLocalInstance);
    await hook.signIn('gecko');
    expect(harness.signIn).toHaveBeenCalledWith({
      loginHint: 'gecko',
      signal: expect.any(AbortSignal),
      hasLocalInstance,
    });
    expect(onGlueAuth).toHaveBeenCalledWith(outcome);
    expect(harness.remember).toHaveBeenCalledWith(canonical);
    expect(harness.setters[0]!.mock.calls).toEqual([[true], [false]]);
    expect(harness.setters[1]!.mock.calls).toEqual([[null]]);
  });

  it('shows verification failures and leaves the local model untouched', async () => {
    const onGlueAuth = vi.fn();
    harness.signIn.mockRejectedValue(new Error('Glue enrollment denied'));
    await useGlueLogin(onGlueAuth, hasLocalInstance).signIn('gecko');
    expect(onGlueAuth).not.toHaveBeenCalled();
    expect(harness.remember).not.toHaveBeenCalled();
    expect(harness.setters[1]).toHaveBeenLastCalledWith('Glue enrollment denied');
    expect(harness.setters[0]).toHaveBeenLastCalledWith(false);
  });

  it('cancels the actual pending session and never provisions after cancellation', async () => {
    const onGlueAuth = vi.fn();
    let finish!: (value: unknown) => void;
    harness.signIn.mockImplementation(() => new Promise(resolve => {finish = resolve;}));
    const hook = useGlueLogin(onGlueAuth, hasLocalInstance);
    const pending = hook.signIn('gecko');
    await hook.signIn('duplicate');
    expect(harness.signIn).toHaveBeenCalledTimes(1);
    const signal = harness.signIn.mock.calls[0]![0].signal as AbortSignal;
    hook.cancel();
    expect(signal.aborted).toBe(true);
    finish({kind: 'existing', credentials: canonical});
    await pending;
    expect(onGlueAuth).not.toHaveBeenCalled();
    expect(harness.remember).not.toHaveBeenCalled();
    expect(harness.setters[0]).toHaveBeenLastCalledWith(false);
  });

  it('settles browser cancellation without an error or local account change', async () => {
    const onGlueAuth = vi.fn();
    harness.signIn.mockResolvedValue(null);
    await useGlueLogin(onGlueAuth, hasLocalInstance).signIn('gecko');
    expect(onGlueAuth).not.toHaveBeenCalled();
    expect(harness.remember).not.toHaveBeenCalled();
    expect(harness.setters[1]!.mock.calls).toEqual([[null]]);
    expect(harness.setters[0]).toHaveBeenLastCalledWith(false);
  });

  it('aborts the pending session when the login screen unmounts', async () => {
    harness.signIn.mockImplementation(({signal}: {signal: AbortSignal}) => new Promise(resolve => signal.addEventListener('abort', () => resolve(null))));
    const pending = useGlueLogin(vi.fn(), hasLocalInstance).signIn('gecko');
    const signal = harness.signIn.mock.calls[0]![0].signal as AbortSignal;
    harness.cleanup?.();
    expect(signal.aborted).toBe(true);
    await pending;
  });

  it('captures session ownership before the local model can expose authenticated UI', async () => {
    const order: string[] = [];
    harness.signIn.mockResolvedValue({kind: 'existing', credentials: canonical});
    harness.prepare.mockImplementation(() => {order.push('prepare'); return harness.remember;});
    harness.remember.mockImplementation(async () => {order.push('remember');});
    await useGlueLogin(async () => {order.push('local-login');}, hasLocalInstance).signIn('gecko');
    expect(order).toEqual(['prepare', 'local-login', 'remember']);
  });
});
