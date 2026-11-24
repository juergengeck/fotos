import type {
    FotosPhotoLibrarySyncOptions,
    FotosPhotoLibrarySyncProgress,
    FotosPhotoLibrarySyncSummary,
} from './FotosMediaLibrarySync';

export interface FotosLibraryAutoSyncRuntime {
    readonly initialized: boolean;
    readonly ownerId: string | undefined;
    readonly platformCapabilities: {supportsPhotoLibrarySync: boolean};
    syncPhotoLibrary(options?: FotosPhotoLibrarySyncOptions): Promise<FotosPhotoLibrarySyncSummary>;
}

export interface FotosLibraryAutoSyncSnapshot {
    enabled: boolean;
    running: boolean;
    pending: boolean;
    permissionGranted: boolean | null;
    discoveredCount: number;
    processedCount: number;
    syncedCount: number;
    deferredCount: number;
    skippedCount: number;
    lastStartedAt: number | null;
    lastFinishedAt: number | null;
    lastSummary: FotosPhotoLibrarySyncSummary | null;
    lastError: string | null;
}

const INITIAL_SNAPSHOT: FotosLibraryAutoSyncSnapshot = {
    enabled: false,
    running: false,
    pending: false,
    permissionGranted: null,
    discoveredCount: 0,
    processedCount: 0,
    syncedCount: 0,
    deferredCount: 0,
    skippedCount: 0,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastSummary: null,
    lastError: null,
};

/** One controller per runtime keeps gallery reference indexing serialized across remounts. */
export class FotosLibraryAutoSyncController {
    private authenticated = false;
    private backgrounded = false;
    private requested = false;
    private activatedForOwner = false;
    private needsResume = false;
    private generation = 0;
    private ownerId?: string;
    private inFlight?: Promise<void>;
    private readonly listeners = new Set<() => void>();
    private snapshot: FotosLibraryAutoSyncSnapshot = {...INITIAL_SNAPSHOT};

    constructor(private readonly runtime: FotosLibraryAutoSyncRuntime) {}

    getSnapshot = (): FotosLibraryAutoSyncSnapshot => this.snapshot;

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };

    /** Called once the root has authenticated and finished runtime startup. Idempotent across re-renders. */
    activate(appState: string | null): Promise<void> {
        const ownerChanged = this.ownerId !== this.runtime.ownerId;
        if (ownerChanged) {
            this.generation++;
            this.ownerId = this.runtime.ownerId;
            this.activatedForOwner = false;
            this.needsResume = false;
            this.update({
                permissionGranted: null,
                discoveredCount: 0,
                processedCount: 0,
                syncedCount: 0,
                deferredCount: 0,
                skippedCount: 0,
                lastSummary: null,
                lastError: null,
                lastStartedAt: null,
                lastFinishedAt: null,
            });
        }
        this.authenticated = true;
        this.backgrounded = appState === 'background';
        const enabled = this.isEnabled();
        this.update({enabled});
        if (!enabled || this.backgrounded) {
            return this.inFlight ?? Promise.resolve();
        }
        // Only start once per owner session (or when resuming an interrupted pass).
        // Re-renders or remounts of the root hook must never restart or duplicate indexing.
        if (!this.activatedForOwner || this.needsResume) {
            this.activatedForOwner = true;
            this.needsResume = false;
            return this.requestSync();
        }
        return this.inFlight ?? Promise.resolve();
    }

    deactivate(): void {
        this.authenticated = false;
        this.requested = false;
        this.activatedForOwner = false;
        this.needsResume = false;
        this.generation++;
        this.update({...INITIAL_SNAPSHOT});
    }

    handleAppState(appState: string | null): Promise<void> {
        // iOS fires 'inactive' for transient overlays (Control Center, Face ID, screenshots, share sheets).
        // Only pause when the app genuinely enters 'background'.
        const wasBackgrounded = this.backgrounded;
        if (appState === 'background') {
            this.backgrounded = true;
            this.requested = false;
            if (this.inFlight) {
                this.needsResume = true;
            }
            this.update({pending: false});
            return this.inFlight ?? Promise.resolve();
        }
        if (appState === 'active') {
            this.backgrounded = false;
            if (wasBackgrounded && this.needsResume) {
                this.needsResume = false;
                return this.requestSync();
            }
            if (wasBackgrounded && !this.activatedForOwner && this.isEnabled()) {
                this.activatedForOwner = true;
                return this.requestSync();
            }
        }
        return this.inFlight ?? Promise.resolve();
    }

    /** Trigger an incremental sync pass (e.g. immediately after granting photo access). */
    trigger(): Promise<void> {
        this.activatedForOwner = true;
        this.needsResume = false;
        return this.requestSync();
    }

    private isEnabled(): boolean {
        return this.authenticated && this.runtime.initialized && Boolean(this.runtime.ownerId)
            && this.runtime.platformCapabilities.supportsPhotoLibrarySync;
    }

    private update(patch: Partial<FotosLibraryAutoSyncSnapshot>): void {
        if (Object.entries(patch).every(([key, value]) => this.snapshot[key as keyof FotosLibraryAutoSyncSnapshot] === value)) return;
        this.snapshot = {...this.snapshot, ...patch};
        for (const listener of this.listeners) listener();
    }

    private requestSync(): Promise<void> {
        if (!this.isEnabled() || this.backgrounded) return this.inFlight ?? Promise.resolve();
        this.requested = true;
        this.update({pending: Boolean(this.inFlight)});
        if (!this.inFlight) {
            this.inFlight = Promise.resolve().then(() => this.run()).finally(() => {
                this.inFlight = undefined;
                this.update({running: false, pending: false});
            });
        }
        return this.inFlight;
    }

    private async run(): Promise<void> {
        while (this.requested && this.isEnabled() && !this.backgrounded) {
            this.requested = false;
            const generation = this.generation;
            this.update({
                pending: false,
                lastStartedAt: Date.now(),
                lastError: null,
            });
            const isStale = () => generation !== this.generation || !this.isEnabled() || this.backgrounded;
            const onProgress = (progress: FotosPhotoLibrarySyncProgress) => {
                if (isStale()) return;
                this.update({
                    running: true,
                    permissionGranted: true,
                    discoveredCount: progress.discoveredCount,
                    processedCount: progress.processedCount,
                    syncedCount: progress.syncedCount,
                    deferredCount: progress.deferredCount,
                    skippedCount: progress.skippedCount,
                });
            };
            try {
                const summary = await this.runtime.syncPhotoLibrary({
                    mode: 'auto',
                    requestPermission: false,
                    isCancelled: isStale,
                    onProgress,
                });
                if (generation === this.generation && this.isEnabled()) {
                    if (summary.cancelled) {
                        this.needsResume = true;
                    }
                    const lastError = summary.albumSyncError
                        ?? summary.issues[0]?.reason
                        ?? (summary.skippedCount > 0 ? `${summary.skippedCount} gallery items could not be indexed` : null);
                    const totalProcessed = summary.syncedCount + summary.deferredAssets.length + summary.skippedCount;
                    this.update({
                        running: false,
                        permissionGranted: summary.permissionGranted,
                        ...(summary.requestedCount > 0 || !this.snapshot.discoveredCount ? {
                            discoveredCount: Math.max(this.snapshot.discoveredCount, summary.requestedCount),
                            processedCount: Math.max(this.snapshot.processedCount, totalProcessed),
                        } : {}),
                        syncedCount: summary.syncedCount,
                        deferredCount: summary.deferredAssets.length,
                        skippedCount: summary.skippedCount,
                        lastSummary: summary,
                        lastError: summary.permissionGranted ? lastError : null,
                        lastFinishedAt: Date.now(),
                    });
                }
            } catch (error) {
                if (generation === this.generation && this.isEnabled()) {
                    this.needsResume = true;
                    this.update({
                        running: false,
                        lastSummary: null,
                        lastError: error instanceof Error ? error.message : String(error),
                        lastFinishedAt: Date.now(),
                    });
                }
            }
        }
        this.requested = false;
    }
}

const controllers = new WeakMap<FotosLibraryAutoSyncRuntime, FotosLibraryAutoSyncController>();

export function getFotosLibraryAutoSync(runtime: FotosLibraryAutoSyncRuntime): FotosLibraryAutoSyncController {
    let controller = controllers.get(runtime);
    if (!controller) {
        controller = new FotosLibraryAutoSyncController(runtime);
        controllers.set(runtime, controller);
    }
    return controller;
}
