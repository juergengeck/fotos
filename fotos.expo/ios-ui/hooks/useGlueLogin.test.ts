import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const harness = vi.hoisted(() => ({
  setters: [] as Array<ReturnType<typeof vi.fn>>, cleanup: undefined as undefined | (() => void),
  ref: {current: null as AbortController | null},
  login: vi.fn(), remember: vi.fn(), prepare: vi.fn(),
}));
vi.mock('react', () => ({
  useRef: () => harness.ref,
  useState: (initial: unknown) => {const setter = vi.fn(); harness.setters.push(setter); return [initial, setter];},
  useEffect: (effect: () => void | (() => void)) => {harness.cleanup = effect() || undefined;},
  useCallback: (callback: unknown) => callback,
}));
vi.mock('../services/glue-login', () => ({loginWithGlue: harness.login, prepareGlueSession: harness.prepare}));
import {useGlueLogin} from './useGlueLogin';

beforeEach(() => {harness.ref.current = null; harness.setters.length = 0; harness.cleanup = undefined; harness.login.mockReset(); harness.remember.mockReset(); harness.prepare.mockReset(); harness.prepare.mockReturnValue(harness.remember);});
afterEach(() => {harness.cleanup?.();});
describe('Expo Glue login UI state', () => {
  it('shows progress and logs in using only verified subject credentials', async () => {
    const onLogin = vi.fn(async () => {});
    harness.login.mockResolvedValue({localName: 'glue:verified-subject', secret: 'random-local-secret', identity: {personId: 'verified-subject'}});
    const hook = useGlueLogin(onLogin);
    await hook.signIn('untrusted prefill');
    expect(harness.login).toHaveBeenCalledWith({loginHint: 'untrusted prefill', signal: expect.any(AbortSignal)});
    expect(onLogin).toHaveBeenCalledWith('glue:verified-subject', 'random-local-secret');
    expect(harness.remember).toHaveBeenCalledWith('verified-subject');
    expect(harness.setters[0]!.mock.calls).toEqual([[true], [false]]);
    expect(harness.setters[1]!.mock.calls).toEqual([[null]]);
  });
  it('shows verification failures and leaves the local model untouched', async () => {
    const onLogin = vi.fn(); harness.login.mockRejectedValue(new Error('Glue nonce mismatch'));
    await useGlueLogin(onLogin).signIn('name');
    expect(onLogin).not.toHaveBeenCalled(); expect(harness.remember).not.toHaveBeenCalled();
    expect(harness.setters[1]).toHaveBeenLastCalledWith('Glue nonce mismatch');
    expect(harness.setters[0]).toHaveBeenLastCalledWith(false);
  });
  it('cancels the actual pending session and never provisions after cancellation', async () => {
    const onLogin = vi.fn(); let finish!: (value: unknown) => void;
    harness.login.mockImplementation(() => new Promise(resolve => {finish = resolve;}));
    const hook = useGlueLogin(onLogin); const pending = hook.signIn('name');
    await hook.signIn('duplicate'); expect(harness.login).toHaveBeenCalledTimes(1);
    const signal = harness.login.mock.calls[0]![0].signal as AbortSignal;
    hook.cancel(); expect(signal.aborted).toBe(true);
    finish({localName: 'glue:verified-subject', secret: 'secret'}); await pending;
    expect(onLogin).not.toHaveBeenCalled(); expect(harness.remember).not.toHaveBeenCalled(); expect(harness.setters[0]).toHaveBeenLastCalledWith(false);
  });
  it('settles browser cancellation without an error or local account change', async () => {
    const onLogin = vi.fn(); harness.login.mockResolvedValue(null);
    await useGlueLogin(onLogin).signIn('name');
    expect(onLogin).not.toHaveBeenCalled(); expect(harness.remember).not.toHaveBeenCalled(); expect(harness.setters[1]!.mock.calls).toEqual([[null]]);
    expect(harness.setters[0]).toHaveBeenLastCalledWith(false);
  });
  it('aborts the pending session when the login screen unmounts', async () => {
    harness.login.mockImplementation(({signal}: {signal: AbortSignal}) => new Promise(resolve => signal.addEventListener('abort', () => resolve(null))));
    const pending = useGlueLogin(vi.fn()).signIn('name');
    const signal = harness.login.mock.calls[0]![0].signal as AbortSignal;
    harness.cleanup?.(); expect(signal.aborted).toBe(true); await pending;
  });
  it('captures session ownership before the local model can expose authenticated UI', async () => {
    const order: string[] = [];
    harness.login.mockResolvedValue({localName: 'glue:verified-subject', secret: 'secret', identity: {personId: 'verified-subject'}});
    harness.prepare.mockImplementation(() => {order.push('prepare'); return harness.remember;});
    harness.remember.mockImplementation(async () => {order.push('remember');});
    await useGlueLogin(async () => {order.push('local-login');}).signIn('name');
    expect(order).toEqual(['prepare', 'local-login', 'remember']);
  });

});
