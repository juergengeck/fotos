import type {FirePhoto, FireTvAppProps} from '../ui/types';
import {DEVICE_NAME} from './identity';
import type {FireTvChange} from './changes';

export type FireTvSnapshot = Omit<FireTvAppProps, 'onPair' | 'onClosePairing' | 'onRetry'>;

/** The backend owns native ONE resources; this controller owns their UI lifecycle. */
export interface FireTvBackend {
  open(): Promise<void>;
  close(): Promise<void>;
  projectPhotos(): Promise<FirePhoto[]>;
  subscribeChanges(listener: (change: FireTvChange) => void): () => void;
  createPairingInvitation(): Promise<string>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class RuntimeController {
  private snapshot: FireTvSnapshot = {
    status: 'starting', photos: [], deviceName: DEVICE_NAME, pairingBusy: false,
  };
  private readonly listeners = new Set<(snapshot: FireTvSnapshot) => void>();
  private opening?: Promise<void>;
  private retrying?: Promise<void>;
  private disposing?: Promise<void>;
  private projection?: Promise<void>;
  private unsubscribe?: () => void;
  private dirty = false;
  private disposed = false;
  private pairingGeneration = 0;

  constructor(private readonly backend: FireTvBackend) {}

  getSnapshot = (): FireTvSnapshot => this.snapshot;

  subscribe = (listener: (snapshot: FireTvSnapshot) => void): (() => void) => {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => { this.listeners.delete(listener); };
  };

  private publish(patch: Partial<FireTvSnapshot>): void {
    if (this.disposed) return;
    this.snapshot = {...this.snapshot, ...patch};
    for (const listener of this.listeners) listener(this.snapshot);
  }

  start = (): Promise<void> => {
    if (this.disposed || this.snapshot.status === 'ready') return Promise.resolve();
    if (this.opening) return this.opening;
    this.publish({status: 'starting', error: undefined});
    const opening = this.open().finally(() => {
      if (this.opening === opening) this.opening = undefined;
    });
    this.opening = opening;
    return opening;
  };

  private async open(): Promise<void> {
    try {
      await this.backend.open();
      if (this.disposed) return;
      this.unsubscribe = this.backend.subscribeChanges(change => {
        if (change === 'authorization') {
          // Retire fullscreen and gallery content synchronously. Materializing
          // the next verified projection may take much longer than revocation.
          this.publish({status: 'starting', photos: [], error: undefined});
        }
        void this.refresh();
      });
      await this.refresh();
    } catch (error) {
      this.publish({status: 'error', error: errorMessage(error), photos: []});
    }
  }

  private refresh(): Promise<void> {
    this.dirty = true;
    if (this.projection) return this.projection;
    const projection = this.reconcile().finally(() => {
      if (this.projection === projection) this.projection = undefined;
    });
    this.projection = projection;
    return projection;
  }

  private async reconcile(): Promise<void> {
    // Each additional pass is caused by an actual arrival while the previous
    // projection ran. No timer, fetch retry, or missing-prerequisite loop exists.
    while (this.dirty && !this.disposed) {
      this.dirty = false;
      try {
        const photos = await this.backend.projectPhotos();
        if (!this.dirty) this.publish({status: 'ready', photos, error: undefined});
      } catch (error) {
        if (!this.dirty) this.publish({status: 'error', error: errorMessage(error), photos: []});
      }
    }
  }

  createPairingInvitation = async (): Promise<void> => {
    if (this.disposed || this.snapshot.status !== 'ready' || this.snapshot.pairingBusy) return;
    const generation = ++this.pairingGeneration;
    this.publish({pairingBusy: true, pairingUrl: undefined, pairingError: undefined});
    try {
      const pairingUrl = await this.backend.createPairingInvitation();
      if (generation === this.pairingGeneration) this.publish({pairingBusy: false, pairingUrl});
    } catch (error) {
      if (generation === this.pairingGeneration) {
        this.publish({pairingBusy: false, pairingError: errorMessage(error)});
      }
    }
  };

  closePairing = (): void => {
    ++this.pairingGeneration;
    this.publish({pairingUrl: undefined, pairingBusy: false, pairingError: undefined});
  };

  retry = (): Promise<void> => {
    if (this.disposed) return Promise.resolve();
    if (this.retrying) return this.retrying;
    this.closePairing();
    const retrying = this.restart().finally(() => {
      if (this.retrying === retrying) this.retrying = undefined;
    });
    this.retrying = retrying;
    return retrying;
  };

  private async restart(): Promise<void> {
    await this.opening;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    await this.projection;
    try {
      await this.backend.close();
      this.publish({status: 'starting', photos: [], error: undefined});
      await this.start();
    } catch (error) {
      this.publish({status: 'error', error: errorMessage(error), photos: []});
    }
  }

  dispose = (): Promise<void> => {
    if (this.disposing) return this.disposing;
    this.disposed = true;
    ++this.pairingGeneration;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.listeners.clear();
    this.disposing = this.close();
    return this.disposing;
  };

  private async close(): Promise<void> {
    await this.retrying;
    await this.opening;
    await this.projection;
    await this.backend.close();
  }
}
