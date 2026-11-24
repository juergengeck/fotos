import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
const lifecycle = vi.hoisted(() => ({
    state: 'active' as string | null,
    cleanup: undefined as undefined | (() => void),
    listener: undefined as undefined | ((state: string) => void),
    remove: vi.fn(), add: vi.fn(),
}));
vi.mock('react', () => ({
    useEffect: (effect: () => void | (() => void)) => { lifecycle.cleanup = effect() || undefined; },
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}));
vi.mock('react-native', () => ({AppState: {
    get currentState() { return lifecycle.state; },
    addEventListener: lifecycle.add,
}}));
import {useFotosShareInboxAutoDrain, useFotosShareInboxAutoDrainStatus} from './useFotosShareInboxAutoDrain';
import {getFotosShareInboxAutoDrain} from '../services/FotosShareInboxAutoDrain';

function runtime() {
    return {initialized: true, ownerId: 'owner', platformCapabilities: {supportsShareInbox: true},
        importPendingSharedInbox: vi.fn(async () => ({batchCount: 0, requestedCount: 0, syncedCount: 0,
            skippedCount: 0, syncedEntries: [], issues: []}))};
}
beforeEach(() => {
    lifecycle.state = 'active'; lifecycle.cleanup = undefined; lifecycle.listener = undefined;
    lifecycle.remove.mockReset(); lifecycle.add.mockReset();
    lifecycle.add.mockImplementation((_event, listener) => {
        lifecycle.listener = listener;
        return {remove: lifecycle.remove};
    });
});
afterEach(() => { lifecycle.cleanup?.(); });

describe('root Share Inbox lifecycle binding', () => {
    it('drains authenticated cold start and publishes that same controller to Runtime diagnostics', async () => {
        const model = runtime();
        useFotosShareInboxAutoDrain(model, true);
        await getFotosShareInboxAutoDrain(model).activate('active');
        expect(model.importPendingSharedInbox).toHaveBeenCalledTimes(1);
        expect(lifecycle.add).toHaveBeenCalledWith('change', expect.any(Function));
        expect(useFotosShareInboxAutoDrainStatus(model)).toMatchObject({enabled: true, running: false,
            lastError: null, lastSummary: {batchCount: 0}});
    });

    it.each(['unauthenticated', 'initializing', 'unsupported', 'no-model'])('does not bind imports for %s runtimes', async reason => {
        const model = runtime();
        if (reason === 'initializing') model.initialized = false;
        if (reason === 'unsupported') model.platformCapabilities.supportsShareInbox = false;
        useFotosShareInboxAutoDrain(reason === 'no-model' ? null : model, reason !== 'unauthenticated');
        await Promise.resolve();
        expect(model.importPendingSharedInbox).not.toHaveBeenCalled();
        expect(lifecycle.add).not.toHaveBeenCalled();
    });

    it('routes foreground transitions and deactivates the controller when its root binding unmounts', async () => {
        const model = runtime();
        lifecycle.state = 'background';
        useFotosShareInboxAutoDrain(model, true);
        await Promise.resolve();
        expect(model.importPendingSharedInbox).not.toHaveBeenCalled();
        lifecycle.listener?.('active');
        await getFotosShareInboxAutoDrain(model).activate('active');
        expect(model.importPendingSharedInbox).toHaveBeenCalledTimes(1);
        lifecycle.cleanup?.(); lifecycle.cleanup = undefined;
        expect(lifecycle.remove).toHaveBeenCalledTimes(1);
        expect(getFotosShareInboxAutoDrain(model).getSnapshot().enabled).toBe(false);
    });
});
