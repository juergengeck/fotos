import type {Invitation} from '@refinio/one.models/lib/misc/ConnectionEstablishment/PairingManager.js';

export interface FotosQaGalleryItem {
    hash: string;
    name: string;
}

export interface FotosQaCollectionSnapshot {
    id: string;
    name: string;
    photoHashes: string[];
    personIds: string[];
}

export interface FotosQaReceivedShareSnapshot {
    issuer: string;
    scope: {
        kind: 'gallery' | 'collection' | 'person';
        id: string;
    };
    status: 'active' | 'revoked' | 'invalid';
    verified: boolean;
    photoHashes: string[];
    photoNames: string[];
    issuedAt: string | null;
    revokedAt: string | null;
    revocationReason: string | null;
}

export interface FotosQaAppSnapshot {
    stateRevision: number;
    initialized: boolean;
    ownerId: string | null;
    publicationIdentity: string | null;
    gallery: {
        isOpen: boolean;
        folderName: string | null;
        items: FotosQaGalleryItem[];
    };
    collections: FotosQaCollectionSnapshot[];
    receivedShares: FotosQaReceivedShareSnapshot[];
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
    if (left.length !== right.length) {
        return false;
    }
    const sortedRight = [...right].sort();
    return [...left].sort().every((value, index) => value === sortedRight[index]);
}

export function getSettledCollectionMembers(
    snapshot: FotosQaAppSnapshot,
    collectionId: string,
    requestedPhotoHashes: readonly string[],
): {id: string; photoHashes: string[]} | null {
    const collection = snapshot.collections.find(candidate => candidate.id === collectionId);
    if (!collection || !sameStringSet(collection.photoHashes, requestedPhotoHashes)) {
        return null;
    }
    return {id: collection.id, photoHashes: collection.photoHashes};
}

export function getSettledCollectionRecipients(
    snapshot: FotosQaAppSnapshot,
    collectionId: string,
    requestedPersonIds: readonly string[],
): {
    scope: 'collection';
    id: string;
    personIds: string[];
    transitions: [];
} | null {
    const collection = snapshot.collections.find(candidate => candidate.id === collectionId);
    if (!collection || !sameStringSet(collection.personIds, requestedPersonIds)) {
        return null;
    }
    return {
        scope: 'collection',
        id: collection.id,
        personIds: collection.personIds,
        transitions: [],
    };
}

export interface FotosQaIdentitySnapshot {
    ownerId: string | null;
    publicationIdentity: string | null;
    glueDisplayName: string | null;
    syncEnabled: boolean;
    headlessConnected: boolean;
    publicationPublicSignKey: string | null;
    deviceInstanceId: string | null;
    devicePublicEncryptionKey: string | null;
    pairingInstanceId: string | null;
    pairingPublicEncryptionKey: string | null;
}

export interface FotosQaOperationSnapshot extends FotosQaAppSnapshot {
    revision: number;
    lastOperation: {
        kind: string;
        completedAt: string;
        result: Record<string, unknown>;
    } | null;
}

export interface FotosQaOperationHandlers {
    getIdentity(): Promise<FotosQaIdentitySnapshot>;
    getDiagnostics(params: {traceLimit: number}): Promise<Record<string, unknown>>;
    prepareIdentity(params: {displayName: string}): Promise<{
        personId: string;
        created: boolean;
        syncEnabled: boolean;
        reloadRequired: boolean;
    }>;
    registerPreparedIdentity(params: {displayName?: string}): Promise<{
        personId: string;
        identity: string;
        cert: Record<string, unknown> | null;
    }>;
    reloadPreparedIdentity(params: {expectedPersonId: string}): Promise<{
        personId: string;
        ready: true;
    }>;
    importPhotoFixture(params: {
        name: string;
        mimeType: string;
        bytesBase64: string;
        lastModified?: number;
    }): Promise<{hash: string; name: string}>;
    createCollection(params: {name: string; photoHashes: string[]}): Promise<{
        id: string;
        name: string;
        photoHashes: string[];
    }>;
    setCollectionMembers(params: {collectionId: string; photoHashes: string[]}): Promise<{
        id: string;
        photoHashes: string[];
    }>;
    setCollectionRecipients(params: {collectionId: string; personIds: string[]}): Promise<{
        scope: 'collection';
        id: string;
        personIds: string[];
        transitions: Array<{personId: string; status: 'active' | 'revoked'}>;
    }>;
    createPairingInvitation(): Promise<Invitation>;
    acceptPairingInvitation(params: {invitation: Invitation}): Promise<{
        accepted: true;
        publicationIdentity: string;
    }>;
}

const EMPTY_APP_SNAPSHOT: FotosQaAppSnapshot = {
    stateRevision: 0,
    initialized: false,
    ownerId: null,
    publicationIdentity: null,
    gallery: {
        isOpen: false,
        folderName: null,
        items: [],
    },
    collections: [],
    receivedShares: [],
};

interface StateWaitOptions {
    afterStateRevision: number;
    timeoutMs?: number;
    signal?: AbortSignal;
}

function boundedTimeout(timeoutMs: number | undefined): number {
    const resolved = timeoutMs ?? 30_000;
    if (!Number.isFinite(resolved) || resolved <= 0 || resolved > 120_000) {
        throw new Error('timeoutMs must be between 1 and 120000');
    }
    return resolved;
}

class FotosQaAppStateObserver {
    private snapshot: FotosQaAppSnapshot = EMPTY_APP_SNAPSHOT;
    private serialized = JSON.stringify(EMPTY_APP_SNAPSHOT);
    private listeners = new Set<(snapshot: FotosQaAppSnapshot) => void>();

    getSnapshot(): FotosQaAppSnapshot {
        return this.snapshot;
    }

    update(next: Omit<FotosQaAppSnapshot, 'stateRevision'>): FotosQaAppSnapshot {
        const comparable = JSON.stringify(next);
        if (comparable === this.serialized) {
            return this.snapshot;
        }

        this.serialized = comparable;
        this.snapshot = {
            ...next,
            stateRevision: this.snapshot.stateRevision + 1,
        };
        for (const listener of this.listeners) {
            listener(this.snapshot);
        }
        return this.snapshot;
    }

    waitFor(
        predicate: (snapshot: FotosQaAppSnapshot) => boolean,
        options: StateWaitOptions,
    ): Promise<FotosQaAppSnapshot> {
        if (this.snapshot.stateRevision > options.afterStateRevision && predicate(this.snapshot)) {
            return Promise.resolve(this.snapshot);
        }

        const timeoutMs = boundedTimeout(options.timeoutMs);
        return new Promise<FotosQaAppSnapshot>((resolve, reject) => {
            const cleanup = () => {
                clearTimeout(timer);
                this.listeners.delete(onState);
                options.signal?.removeEventListener('abort', onAbort);
            };
            const onState = (snapshot: FotosQaAppSnapshot) => {
                if (snapshot.stateRevision <= options.afterStateRevision || !predicate(snapshot)) {
                    return;
                }
                cleanup();
                resolve(snapshot);
            };
            const onAbort = () => {
                cleanup();
                reject(options.signal?.reason ?? new Error('Fotos QA state wait cancelled'));
            };
            const timer = setTimeout(() => {
                cleanup();
                reject(new Error(`Timed out waiting for Fotos app state after ${timeoutMs}ms`));
            }, timeoutMs);

            this.listeners.add(onState);
            options.signal?.addEventListener('abort', onAbort, {once: true});
            if (options.signal?.aborted) {
                onAbort();
            }
        });
    }
}

interface OperationWaiter {
    afterRevision: number;
    resolve: (snapshot: FotosQaOperationSnapshot) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

export const fotosQaAppState = new FotosQaAppStateObserver();

/**
 * Browser-owned QA operation surface. The operation delegates every mutation to
 * handlers installed by App, while keeping waits event-backed and target-local.
 */
export class FotosQaOperation {
    private handlers: FotosQaOperationHandlers | null = null;
    private revision = 0;
    private lastOperation: FotosQaOperationSnapshot['lastOperation'] = null;
    private waiters = new Map<string, OperationWaiter>();

    _attach(handlers: FotosQaOperationHandlers): void {
        this.handlers = handlers;
    }

    _detach(handlers: FotosQaOperationHandlers): void {
        if (this.handlers !== handlers) {
            return;
        }
        this.handlers = null;
        for (const [waitId, waiter] of this.waiters) {
            clearTimeout(waiter.timer);
            waiter.reject(new Error(`Fotos QA app detached while waiting (${waitId})`));
        }
        this.waiters.clear();
    }

    private _requireHandlers(): FotosQaOperationHandlers {
        if (!this.handlers) {
            throw new Error('Fotos QA app handlers are not attached');
        }
        return this.handlers;
    }

    private _snapshot(): FotosQaOperationSnapshot {
        return {
            ...fotosQaAppState.getSnapshot(),
            revision: this.revision,
            lastOperation: this.lastOperation,
        };
    }

    private _publish(kind: string, result: Record<string, unknown>): FotosQaOperationSnapshot {
        this.revision += 1;
        this.lastOperation = {
            kind,
            completedAt: new Date().toISOString(),
            result,
        };
        const snapshot = this._snapshot();
        for (const [waitId, waiter] of this.waiters) {
            if (snapshot.revision <= waiter.afterRevision) {
                continue;
            }
            clearTimeout(waiter.timer);
            this.waiters.delete(waitId);
            waiter.resolve(snapshot);
        }
        return snapshot;
    }

    private async _run<T extends Record<string, unknown>>(
        kind: string,
        operation: () => Promise<T>,
    ): Promise<T & {revision: number}> {
        const result = await operation();
        const snapshot = this._publish(kind, result);
        return {...result, revision: snapshot.revision};
    }

    async getIdentity(_params: Record<string, never> = {}): Promise<FotosQaIdentitySnapshot> {
        return await this._requireHandlers().getIdentity();
    }

    async getDiagnostics(params: {traceLimit?: number} = {}): Promise<Record<string, unknown>> {
        const traceLimit = params.traceLimit ?? 200;
        if (!Number.isInteger(traceLimit) || traceLimit < 1 || traceLimit > 500) {
            throw new Error('traceLimit must be an integer between 1 and 500');
        }
        return await this._requireHandlers().getDiagnostics({traceLimit});
    }

    async prepareIdentity(params: {displayName: string}) {
        return await this._run('prepareIdentity', () => this._requireHandlers().prepareIdentity(params));
    }

    async registerPreparedIdentity(params: {displayName?: string} = {}) {
        return await this._run(
            'registerPreparedIdentity',
            () => this._requireHandlers().registerPreparedIdentity(params),
        );
    }

    async reloadPreparedIdentity(params: {expectedPersonId: string}) {
        return await this._run(
            'reloadPreparedIdentity',
            () => this._requireHandlers().reloadPreparedIdentity(params),
        );
    }

    async importPhotoFixture(params: {
        name: string;
        mimeType: string;
        bytesBase64: string;
        lastModified?: number;
    }) {
        return await this._run('importPhotoFixture', () => this._requireHandlers().importPhotoFixture(params));
    }

    async createCollection(params: {name: string; photoHashes: string[]}) {
        return await this._run('createCollection', () => this._requireHandlers().createCollection(params));
    }

    async setCollectionMembers(params: {collectionId: string; photoHashes: string[]}) {
        return await this._run(
            'setCollectionMembers',
            () => this._requireHandlers().setCollectionMembers(params),
        );
    }

    async setCollectionRecipients(params: {collectionId: string; personIds: string[]}) {
        return await this._run(
            'setCollectionRecipients',
            () => this._requireHandlers().setCollectionRecipients(params),
        );
    }

    async revokeRecipient(params: {collectionId: string; personId: string}) {
        const collection = fotosQaAppState.getSnapshot().collections
            .find(candidate => candidate.id === params.collectionId);
        if (!collection) {
            throw new Error(`Unknown Fotos collection ${params.collectionId}`);
        }
        const personIds = collection.personIds.filter(personId => personId !== params.personId);
        return await this._run(
            'revokeRecipient',
            () => this._requireHandlers().setCollectionRecipients({
                collectionId: params.collectionId,
                personIds,
            }),
        );
    }

    async createPairingInvitation(_params: Record<string, never> = {}) {
        return await this._run('createPairingInvitation', async () => {
            const invitation = await this._requireHandlers().createPairingInvitation();
            return {invitation};
        });
    }

    async acceptPairingInvitation(params: {invitation: Invitation}) {
        return await this._run(
            'acceptPairingInvitation',
            () => this._requireHandlers().acceptPairingInvitation(params),
        );
    }

    async getOperationSnapshot(_params: Record<string, never> = {}): Promise<FotosQaOperationSnapshot> {
        return this._snapshot();
    }

    async waitForAppReady(params: {timeoutMs?: number} = {}): Promise<FotosQaOperationSnapshot> {
        const current = fotosQaAppState.getSnapshot();
        if (!current.initialized) {
            await fotosQaAppState.waitFor(snapshot => snapshot.initialized, {
                afterStateRevision: current.stateRevision,
                timeoutMs: params.timeoutMs,
            });
        }
        this._requireHandlers();
        return this._snapshot();
    }

    async getReceivedShareSnapshot(params: {ownerPersonId?: string} = {}) {
        const ownerPersonId = params.ownerPersonId?.trim() ?? '';
        return {
            stateRevision: fotosQaAppState.getSnapshot().stateRevision,
            shares: fotosQaAppState.getSnapshot().receivedShares.filter(share => (
                !ownerPersonId || share.issuer === ownerPersonId
            )),
        };
    }

    async waitForReceivedShare(params: {
        ownerPersonId: string;
        collectionId: string;
        photoHashes?: string[];
        absent?: boolean;
        timeoutMs?: number;
    }) {
        const ownerPersonId = params.ownerPersonId.trim();
        const collectionId = params.collectionId.trim();
        if (!ownerPersonId || !collectionId) {
            throw new Error('ownerPersonId and collectionId are required');
        }
        const expectedHashes = new Set((params.photoHashes ?? []).map(hash => hash.trim()).filter(Boolean));
        const match = (snapshot: FotosQaAppSnapshot) => {
            const scope = snapshot.receivedShares.find(share => (
                share.issuer === ownerPersonId
                && share.scope.kind === 'collection'
                && share.scope.id === collectionId
            ));
            const active = scope?.verified === true && scope.status === 'active';
            if (params.absent) {
                return !active;
            }
            return active && Array.from(expectedHashes).every(hash => scope.photoHashes.includes(hash));
        };
        const current = fotosQaAppState.getSnapshot();
        const settled = match(current)
            ? current
            : await fotosQaAppState.waitFor(match, {
                afterStateRevision: current.stateRevision,
                timeoutMs: params.timeoutMs,
            });
        return {
            stateRevision: settled.stateRevision,
            shares: settled.receivedShares.filter(share => share.issuer === ownerPersonId),
        };
    }

    async waitForOperation(params: {
        afterRevision: number;
        timeoutMs?: number;
        waitId?: string;
    }): Promise<FotosQaOperationSnapshot> {
        if (!Number.isInteger(params.afterRevision) || params.afterRevision < 0) {
            throw new Error('afterRevision must be a non-negative integer');
        }
        const current = this._snapshot();
        if (current.revision > params.afterRevision) {
            return current;
        }

        const timeoutMs = boundedTimeout(params.timeoutMs);
        const waitId = params.waitId?.trim() || crypto.randomUUID();
        if (this.waiters.has(waitId)) {
            throw new Error(`Fotos QA wait ${waitId} already exists`);
        }

        return await new Promise<FotosQaOperationSnapshot>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.waiters.delete(waitId);
                reject(new Error(`Timed out waiting for Fotos operation after ${timeoutMs}ms`));
            }, timeoutMs);
            this.waiters.set(waitId, {afterRevision: params.afterRevision, resolve, reject, timer});
        });
    }

    async cancelOperationWait(params: {waitId: string; reason?: string}): Promise<{cancelled: boolean}> {
        const waitId = params.waitId.trim();
        const waiter = this.waiters.get(waitId);
        if (!waiter) {
            return {cancelled: false};
        }
        clearTimeout(waiter.timer);
        this.waiters.delete(waitId);
        waiter.reject(new Error(params.reason?.trim() || `Fotos QA wait ${waitId} cancelled`));
        return {cancelled: true};
    }
}

export const fotosQaOperation = new FotosQaOperation();
