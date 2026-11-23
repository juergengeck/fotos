import type {FotosSharedFileImportSummary} from './FotosMediaLibrarySync';

export interface FotosShareInboxAutoDrainRuntime {
    readonly initialized: boolean;
    readonly ownerId: string | undefined;
    readonly platformCapabilities: {supportsShareInbox: boolean};
    importPendingSharedInbox(): Promise<FotosSharedFileImportSummary>;
}

export interface FotosShareInboxAutoDrainSnapshot {
    enabled: boolean;
    running: boolean;
    pending: boolean;
    lastStartedAt: number | null;
    lastFinishedAt: number | null;
    lastSummary: FotosSharedFileImportSummary | null;
    lastError: string | null;
}

/** One controller per runtime keeps foreground imports serialized across React remounts. */
export class FotosShareInboxAutoDrainController {
    private authenticated = false;
    private foreground = false;
    private requested = false;
    private generation = 0;
    private ownerId?: string;
    private inFlight?: Promise<void>;
    private readonly listeners = new Set<() => void>();
    private snapshot: FotosShareInboxAutoDrainSnapshot = {
        enabled: false, running: false, pending: false,
        lastStartedAt: null, lastFinishedAt: null, lastSummary: null, lastError: null,
    };

    constructor(private readonly runtime: FotosShareInboxAutoDrainRuntime) {}

    getSnapshot = (): FotosShareInboxAutoDrainSnapshot => this.snapshot;

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };

    /** Called only once the root has authenticated and finished runtime startup. */
    activate(appState: string | null): Promise<void> {
        const wasEnabled = this.snapshot.enabled;
        const wasForeground = this.foreground;
        const ownerChanged = this.ownerId !== this.runtime.ownerId;
        if (ownerChanged) {
            this.generation++;
            this.ownerId = this.runtime.ownerId;
            this.update({lastSummary: null, lastError: null, lastStartedAt: null, lastFinishedAt: null});
        }
        this.authenticated = true;
        this.foreground = appState === 'active';
        this.update({enabled: this.isEnabled()});
        if ((ownerChanged || !wasEnabled || !wasForeground) && this.foreground) return this.requestDrain();
        return this.inFlight ?? Promise.resolve();
    }

    deactivate(): void {
        this.authenticated = false;
        this.requested = false;
        this.generation++;
        this.update({enabled: false, pending: false, lastSummary: null, lastError: null,
            lastStartedAt: null, lastFinishedAt: null});
    }

    handleAppState(appState: string | null): Promise<void> {
        const wasForeground = this.foreground;
        this.foreground = appState === 'active';
        if (!this.foreground) {
            this.requested = false;
            this.update({pending: false});
        } else if (!wasForeground) {
            return this.requestDrain();
        }
        return this.inFlight ?? Promise.resolve();
    }

    private isEnabled(): boolean {
        return this.authenticated && this.runtime.initialized && Boolean(this.runtime.ownerId)
            && this.runtime.platformCapabilities.supportsShareInbox;
    }

    private update(patch: Partial<FotosShareInboxAutoDrainSnapshot>): void {
        if (Object.entries(patch).every(([key, value]) => this.snapshot[key as keyof FotosShareInboxAutoDrainSnapshot] === value)) return;
        this.snapshot = {...this.snapshot, ...patch};
        for (const listener of this.listeners) listener();
    }

    private requestDrain(): Promise<void> {
        if (!this.isEnabled() || !this.foreground) return this.inFlight ?? Promise.resolve();
        this.requested = true;
        this.update({pending: Boolean(this.inFlight)});
        if (!this.inFlight) {
            // Schedule after assigning inFlight so synchronous foreground events and
            // React subscriptions cannot start a second importer reentrantly.
            this.inFlight = Promise.resolve().then(() => this.drain()).finally(() => {
                this.inFlight = undefined;
                this.update({running: false, pending: false});
            });
        }
        return this.inFlight;
    }

    private async drain(): Promise<void> {
        while (this.requested && this.isEnabled() && this.foreground) {
            this.requested = false;
            const generation = this.generation;
            this.update({running: true, pending: false, lastStartedAt: Date.now(), lastError: null});
            try {
                const summary = await this.runtime.importPendingSharedInbox();
                if (generation === this.generation && this.isEnabled()) {
                    const lastError = summary.issues[0]?.reason
                        ?? (summary.skippedCount > 0 ? `${summary.skippedCount} shared items remain queued` : null);
                    this.update({lastSummary: summary, lastError, lastFinishedAt: Date.now()});
                }
            } catch (error) {
                if (generation === this.generation && this.isEnabled()) {
                    this.update({lastSummary: null, lastError: error instanceof Error ? error.message : String(error),
                        lastFinishedAt: Date.now()});
                }
            }
        }
        this.requested = false;
    }
}

const controllers = new WeakMap<FotosShareInboxAutoDrainRuntime, FotosShareInboxAutoDrainController>();

export function getFotosShareInboxAutoDrain(runtime: FotosShareInboxAutoDrainRuntime): FotosShareInboxAutoDrainController {
    let controller = controllers.get(runtime);
    if (!controller) {
        controller = new FotosShareInboxAutoDrainController(runtime);
        controllers.set(runtime, controller);
    }
    return controller;
}
