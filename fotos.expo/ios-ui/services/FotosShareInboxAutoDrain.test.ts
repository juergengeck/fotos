import {describe, expect, it, vi} from 'vitest';
import type {FotosSharedFileImportSummary} from './FotosMediaLibrarySync';
import {getFotosShareInboxAutoDrain} from './FotosShareInboxAutoDrain';

function summary(syncedCount = 1): FotosSharedFileImportSummary {
    return {batchCount: 1, requestedCount: syncedCount, syncedCount, skippedCount: 0, syncedEntries: [], issues: []};
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return {promise, resolve, reject};
}
function harness() {
    const runtime = {initialized: true, ownerId: 'owner' as string | undefined,
        platformCapabilities: {supportsShareInbox: true},
        importPendingSharedInbox: vi.fn(async () => summary())};
    return {runtime, controller: getFotosShareInboxAutoDrain(runtime)};
}

describe('Share Extension foreground auto-drain', () => {
    it('drains an authenticated active cold start once and keeps stable snapshots between changes', async () => {
        const {runtime, controller} = harness();
        const before = controller.getSnapshot();
        expect(controller.getSnapshot()).toBe(before);
        await controller.activate('active');
        expect(runtime.importPendingSharedInbox).toHaveBeenCalledTimes(1);
        expect(controller.getSnapshot()).toMatchObject({enabled: true, running: false, pending: false,
            lastSummary: summary(), lastError: null, lastStartedAt: expect.any(Number), lastFinishedAt: expect.any(Number)});
        await controller.handleAppState('active');
        await controller.activate('active');
        expect(runtime.importPendingSharedInbox).toHaveBeenCalledTimes(1);
    });

    it('gates on runtime initialization, owner identity and Share Inbox platform support', async () => {
        const {runtime, controller} = harness();
        runtime.initialized = false;
        await controller.activate('active');
        runtime.initialized = true;
        runtime.platformCapabilities.supportsShareInbox = false;
        await controller.activate('active');
        runtime.platformCapabilities.supportsShareInbox = true;
        runtime.ownerId = undefined;
        await controller.activate('active');
        expect(runtime.importPendingSharedInbox).not.toHaveBeenCalled();
        expect(controller.getSnapshot().enabled).toBe(false);
        runtime.ownerId = 'ready-owner';
        await controller.activate('active');
        expect(runtime.importPendingSharedInbox).toHaveBeenCalledTimes(1);
    });

    it('waits for a foreground event when authentication finishes in the background or state is unknown', async () => {
        const {runtime, controller} = harness();
        await controller.activate(null);
        await controller.handleAppState('background');
        expect(runtime.importPendingSharedInbox).not.toHaveBeenCalled();
        await controller.handleAppState('active');
        expect(runtime.importPendingSharedInbox).toHaveBeenCalledTimes(1);
    });

    it('coalesces overlapping foreground transitions into one serialized follow-up', async () => {
        const {runtime, controller} = harness();
        const first = deferred<FotosSharedFileImportSummary>();
        const second = deferred<FotosSharedFileImportSummary>();
        runtime.importPendingSharedInbox.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        const complete = controller.activate('active');
        await Promise.resolve();
        for (let index = 0; index < 3; index++) {
            void controller.handleAppState('background');
            void controller.handleAppState('active');
        }
        expect(runtime.importPendingSharedInbox).toHaveBeenCalledTimes(1);
        expect(controller.getSnapshot()).toMatchObject({running: true, pending: true});
        first.resolve(summary(2));
        await Promise.resolve();
        expect(runtime.importPendingSharedInbox).toHaveBeenCalledTimes(2);
        expect(controller.getSnapshot()).toMatchObject({running: true, pending: false});
        second.resolve(summary(3));
        await complete;
        expect(runtime.importPendingSharedInbox).toHaveBeenCalledTimes(2);
        expect(controller.getSnapshot()).toMatchObject({running: false, pending: false, lastSummary: summary(3)});
    });

    it('does not run a queued follow-up in the background', async () => {
        const {runtime, controller} = harness();
        const first = deferred<FotosSharedFileImportSummary>();
        runtime.importPendingSharedInbox.mockReturnValueOnce(first.promise);
        const complete = controller.activate('active');
        await Promise.resolve();
        void controller.handleAppState('background');
        void controller.handleAppState('active');
        void controller.handleAppState('background');
        first.resolve(summary());
        await complete;
        expect(runtime.importPendingSharedInbox).toHaveBeenCalledTimes(1);
        await controller.handleAppState('active');
        expect(runtime.importPendingSharedInbox).toHaveBeenCalledTimes(2);
    });

    it('records thrown failures and retries only on a later foreground transition', async () => {
        const {runtime, controller} = harness();
        runtime.importPendingSharedInbox.mockRejectedValueOnce(new Error('Storage unavailable'));
        await expect(controller.activate('active')).resolves.toBeUndefined();
        expect(controller.getSnapshot()).toMatchObject({running: false, lastError: 'Storage unavailable', lastSummary: null});
        await controller.handleAppState('active');
        expect(runtime.importPendingSharedInbox).toHaveBeenCalledTimes(1);
        await controller.handleAppState('background');
        await controller.handleAppState('active');
        expect(runtime.importPendingSharedInbox).toHaveBeenCalledTimes(2);
        expect(controller.getSnapshot()).toMatchObject({lastError: null, lastSummary: summary()});
    });

    it('reports partial import issues without treating retained batches as successfully drained', async () => {
        const {runtime, controller} = harness();
        const partial = {...summary(), requestedCount: 2, skippedCount: 1,
            issues: [{locator: 'queue/file', filename: 'photo.jpg', reason: 'File unreadable'}]};
        runtime.importPendingSharedInbox.mockResolvedValue(partial);
        await controller.activate('active');
        expect(controller.getSnapshot()).toMatchObject({lastError: 'File unreadable', lastSummary: partial});
        expect(runtime.importPendingSharedInbox).toHaveBeenCalledTimes(1);
    });

    it('cancels queued work on logout and ignores results from the previous session', async () => {
        const {runtime, controller} = harness();
        const first = deferred<FotosSharedFileImportSummary>();
        runtime.importPendingSharedInbox.mockReturnValueOnce(first.promise);
        const complete = controller.activate('active');
        await Promise.resolve();
        void controller.handleAppState('background');
        void controller.handleAppState('active');
        controller.deactivate();
        first.resolve(summary(4));
        await complete;
        expect(runtime.importPendingSharedInbox).toHaveBeenCalledTimes(1);
        expect(controller.getSnapshot()).toMatchObject({enabled: false, pending: false, lastSummary: null, lastError: null});
    });

    it('keeps one importer across remounts and serializes the new session behind an old in-flight import', async () => {
        const {runtime, controller} = harness();
        expect(getFotosShareInboxAutoDrain(runtime)).toBe(controller);
        const first = deferred<FotosSharedFileImportSummary>();
        runtime.importPendingSharedInbox.mockReturnValueOnce(first.promise);
        const complete = controller.activate('active');
        await Promise.resolve();
        controller.deactivate();
        runtime.ownerId = 'another-owner';
        const restored = getFotosShareInboxAutoDrain(runtime).activate('active');
        expect(runtime.importPendingSharedInbox).toHaveBeenCalledTimes(1);
        first.resolve(summary(4));
        await Promise.all([complete, restored]);
        expect(runtime.importPendingSharedInbox).toHaveBeenCalledTimes(2);
        expect(controller.getSnapshot().lastSummary).toEqual(summary());
    });

    it('notifies diagnostics subscribers and removes them cleanly', async () => {
        const {controller} = harness();
        const listener = vi.fn();
        const unsubscribe = controller.subscribe(listener);
        await controller.activate('active');
        expect(listener).toHaveBeenCalled();
        const notifications = listener.mock.calls.length;
        unsubscribe();
        controller.deactivate();
        expect(listener).toHaveBeenCalledTimes(notifications);
    });
});
