import {describe, expect, it, vi} from 'vitest';
import type {FotosPhotoLibrarySyncOptions, FotosPhotoLibrarySyncSummary} from './FotosMediaLibrarySync';
import {FotosLibraryAutoSyncController, type FotosLibraryAutoSyncRuntime} from './FotosLibraryAutoSync';

function makeSummary(overrides: Partial<FotosPhotoLibrarySyncSummary> = {}): FotosPhotoLibrarySyncSummary {
    return {
        permissionGranted: true,
        accessPrivileges: 'all',
        requestedCount: 2,
        syncedCount: 2,
        skippedCount: 0,
        syncedEntries: [
            {assetId: 'asset-1', contentHash: 'a'.repeat(64)},
            {assetId: 'asset-2', contentHash: 'b'.repeat(64)},
        ],
        deferredAssets: [],
        issues: [],
        ...overrides,
    };
}

function makeRuntime(
    syncPhotoLibrary: (options?: FotosPhotoLibrarySyncOptions) => Promise<FotosPhotoLibrarySyncSummary>,
    overrides: Partial<FotosLibraryAutoSyncRuntime> = {},
): FotosLibraryAutoSyncRuntime {
    return {
        initialized: true,
        ownerId: 'a'.repeat(64),
        platformCapabilities: {supportsPhotoLibrarySync: true},
        syncPhotoLibrary,
        ...overrides,
    };
}

describe('FotosLibraryAutoSyncController', () => {
    it('starts a non-prompting sync on foreground activation and streams progress', async () => {
        const snapshots: Array<{running: boolean; processedCount: number; discoveredCount: number}> = [];
        const syncPhotoLibrary = vi.fn(async (options?: FotosPhotoLibrarySyncOptions) => {
            expect(options?.requestPermission).toBe(false);
            options?.onProgress?.({discoveredCount: 2, processedCount: 0, syncedCount: 0, deferredCount: 0, skippedCount: 0});
            options?.onProgress?.({discoveredCount: 2, processedCount: 1, syncedCount: 1, deferredCount: 0, skippedCount: 0});
            options?.onProgress?.({discoveredCount: 2, processedCount: 2, syncedCount: 2, deferredCount: 0, skippedCount: 0});
            return makeSummary();
        });
        const controller = new FotosLibraryAutoSyncController(makeRuntime(syncPhotoLibrary));
        controller.subscribe(() => {
            const snap = controller.getSnapshot();
            snapshots.push({running: snap.running, processedCount: snap.processedCount, discoveredCount: snap.discoveredCount});
        });

        await controller.activate('active');

        expect(syncPhotoLibrary).toHaveBeenCalledOnce();
        expect(snapshots.some(s => s.running && s.processedCount === 1 && s.discoveredCount === 2)).toBe(true);
        expect(controller.getSnapshot()).toMatchObject({
            enabled: true,
            running: false,
            permissionGranted: true,
            discoveredCount: 2,
            processedCount: 2,
            syncedCount: 2,
            lastError: null,
        });
    });

    it('runs immediately when trigger() is called after granting permission', async () => {
        const syncPhotoLibrary = vi.fn<NonNullable<FotosLibraryAutoSyncRuntime['syncPhotoLibrary']>>()
            .mockResolvedValueOnce(makeSummary({permissionGranted: false, accessPrivileges: 'none', requestedCount: 0, syncedCount: 0, syncedEntries: []}))
            .mockResolvedValueOnce(makeSummary());
        const controller = new FotosLibraryAutoSyncController(makeRuntime(syncPhotoLibrary));

        await controller.activate('active');
        expect(controller.getSnapshot()).toMatchObject({permissionGranted: false, lastError: null, syncedCount: 0});

        await controller.trigger();
        expect(syncPhotoLibrary).toHaveBeenCalledTimes(2);
        expect(controller.getSnapshot()).toMatchObject({permissionGranted: true, syncedCount: 2, lastError: null});
    });

    it('cancels an active pass when backgrounded and resumes on returning to active', async () => {
        let releaseFirst!: () => void;
        let firstCancelled = false;
        const syncPhotoLibrary = vi.fn<NonNullable<FotosLibraryAutoSyncRuntime['syncPhotoLibrary']>>()
            .mockImplementationOnce(async options => {
                await new Promise<void>(resolve => { releaseFirst = resolve; });
                firstCancelled = Boolean(options?.isCancelled?.());
                return makeSummary({syncedCount: 1, syncedEntries: [{assetId: 'asset-1', contentHash: 'a'.repeat(64)}], cancelled: firstCancelled});
            })
            .mockResolvedValueOnce(makeSummary({requestedCount: 1, syncedCount: 1, syncedEntries: [{assetId: 'asset-2', contentHash: 'b'.repeat(64)}]}));

        const controller = new FotosLibraryAutoSyncController(makeRuntime(syncPhotoLibrary));
        const pending = controller.activate('active');
        await Promise.resolve();
        void controller.handleAppState('background');
        releaseFirst();
        await pending;

        expect(firstCancelled).toBe(true);
        await controller.handleAppState('active');
        expect(syncPhotoLibrary).toHaveBeenCalledTimes(2);
        expect(controller.getSnapshot()).toMatchObject({running: false, syncedCount: 1, lastError: null});
    });

    it('clears state and ignores stale completions on deactivate', async () => {
        let release!: () => void;
        const syncPhotoLibrary = vi.fn(async () => {
            await new Promise<void>(resolve => { release = resolve; });
            return makeSummary();
        });
        const controller = new FotosLibraryAutoSyncController(makeRuntime(syncPhotoLibrary));
        const pending = controller.activate('active');
        await Promise.resolve();
        controller.deactivate();
        release();
        await pending;

        expect(controller.getSnapshot()).toMatchObject({
            enabled: false,
            running: false,
            permissionGranted: null,
            lastSummary: null,
            lastError: null,
        });
    });

    it('does not restart indexing on repeated activate calls (re-renders) or transient inactive overlays', async () => {
        let release!: () => void;
        let wasCancelled = false;
        const syncPhotoLibrary = vi.fn(async (options?: FotosPhotoLibrarySyncOptions) => {
            expect(options?.mode).toBe('auto');
            options?.onProgress?.({discoveredCount: 10, processedCount: 1, syncedCount: 1, deferredCount: 0, skippedCount: 0});
            await new Promise<void>(resolve => { release = resolve; });
            wasCancelled = Boolean(options?.isCancelled?.());
            return makeSummary();
        });
        const controller = new FotosLibraryAutoSyncController(makeRuntime(syncPhotoLibrary));

        const pending = controller.activate('active');
        await Promise.resolve();
        const repeated = controller.activate('active');
        expect(repeated).toBe(pending);
        void controller.handleAppState('inactive');
        void controller.handleAppState('active');
        release();
        await pending;

        expect(wasCancelled).toBe(false);
        expect(syncPhotoLibrary).toHaveBeenCalledOnce();

        // After completion, returning from background or re-activating should not restart a full pass.
        await controller.handleAppState('background');
        await controller.handleAppState('active');
        await controller.activate('active');
        expect(syncPhotoLibrary).toHaveBeenCalledOnce();
    });
});
