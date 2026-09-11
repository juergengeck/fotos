import {describe, expect, it, vi} from 'vitest';

import {
    FotosQaOperation,
    fotosQaAppState,
    getSettledCollectionMembers,
    getSettledCollectionRecipients,
    type FotosQaAppSnapshot,
    type FotosQaOperationHandlers,
} from './fotosQaOperation.js';

function makeHandlers(): FotosQaOperationHandlers {
    return {
        getIdentity: vi.fn(async () => ({
            ownerId: 'owner',
            publicationIdentity: 'publication',
            glueDisplayName: 'Alice',
            syncEnabled: true,
            headlessConnected: true,
            publicationPublicSignKey: 'sign-key',
            deviceInstanceId: 'device-instance',
            devicePublicEncryptionKey: 'device-key',
            pairingInstanceId: 'pairing-instance',
            pairingPublicEncryptionKey: 'pairing-key',
        })),
        getDiagnostics: vi.fn(async ({traceLimit}) => ({traceLimit, activeExporters: []})),
        prepareIdentity: vi.fn(async () => ({
            personId: 'publication',
            created: true,
            syncEnabled: true,
            reloadRequired: true,
        })),
        registerPreparedIdentity: vi.fn(async () => ({
            personId: 'publication',
            identity: 'alice@glue.one',
            cert: null,
        })),
        reloadPreparedIdentity: vi.fn(async ({expectedPersonId}: {expectedPersonId: string}) => ({
            personId: expectedPersonId,
            ready: true as const,
        })),
        importPhotoFixture: vi.fn(async () => ({hash: 'photo-1', name: 'photo.jpg'})),
        createCollection: vi.fn(async () => ({id: 'summer', name: 'Summer', photoHashes: ['photo-1']})),
        setCollectionMembers: vi.fn(async () => ({id: 'summer', photoHashes: ['photo-1']})),
        setCollectionRecipients: vi.fn(async () => ({
            scope: 'collection' as const,
            id: 'summer',
            personIds: ['bob'],
            transitions: [{personId: 'bob', status: 'active' as const}],
        })),
        createPairingInvitation: vi.fn(async () => ({
            token: 'token',
            publicKey: 'a'.repeat(64) as any,
            url: 'wss://example.test',
            pairingProtocolVersion: 2,
        })),
        acceptPairingInvitation: vi.fn(async () => ({
            accepted: true as const,
            publicationIdentity: 'publication',
        })),
    };
}

describe('FotosQaOperation', () => {
    it('recognizes already-settled member and recipient assignments', () => {
        const snapshot: FotosQaAppSnapshot = {
            stateRevision: 7,
            initialized: true,
            ownerId: 'alice',
            publicationIdentity: 'alice',
            gallery: {isOpen: true, folderName: 'photos', items: []},
            collections: [{
                id: 'summer',
                name: 'Summer',
                photoHashes: ['photo-2', 'photo-1'],
                personIds: ['charlie', 'bob'],
            }],
            receivedShares: [],
        };

        expect(getSettledCollectionMembers(snapshot, 'summer', ['photo-1', 'photo-2']))
            .toEqual({id: 'summer', photoHashes: ['photo-2', 'photo-1']});
        expect(getSettledCollectionRecipients(snapshot, 'summer', ['bob', 'charlie']))
            .toEqual({
                scope: 'collection',
                id: 'summer',
                personIds: ['charlie', 'bob'],
                transitions: [],
            });
        expect(getSettledCollectionMembers(snapshot, 'summer', ['photo-1'])).toBeNull();
        expect(getSettledCollectionRecipients(snapshot, 'missing', ['bob'])).toBeNull();
    });

    it('returns bounded runtime diagnostics without publishing an operation revision', async () => {
        const operation = new FotosQaOperation();
        const handlers = makeHandlers();
        operation._attach(handlers);

        await expect(operation.getDiagnostics({traceLimit: 200})).resolves.toEqual({
            traceLimit: 200,
            activeExporters: [],
        });
        await expect(operation.getDiagnostics({traceLimit: 501}))
            .rejects.toThrow('between 1 and 500');
        expect((await operation.getOperationSnapshot()).revision).toBe(0);
        operation._detach(handlers);
    });

    it('resolves an event-backed operation wait established before the mutation', async () => {
        const operation = new FotosQaOperation();
        const handlers = makeHandlers();
        operation._attach(handlers);
        const before = await operation.getOperationSnapshot();
        const waiting = operation.waitForOperation({
            afterRevision: before.revision,
            waitId: 'prepare-wait',
            timeoutMs: 1_000,
        });

        const prepared = await operation.prepareIdentity({displayName: 'Alice'});
        const observed = await waiting;

        expect(prepared).toMatchObject({personId: 'publication', revision: 1});
        expect(observed).toMatchObject({
            revision: 1,
            lastOperation: {kind: 'prepareIdentity'},
        });
        operation._detach(handlers);
    });

    it('cancels a named wait without leaving it registered', async () => {
        const operation = new FotosQaOperation();
        const handlers = makeHandlers();
        operation._attach(handlers);
        const waiting = operation.waitForOperation({
            afterRevision: 0,
            waitId: 'cancel-me',
            timeoutMs: 1_000,
        });
        const rejected = expect(waiting).rejects.toThrow('caller stopped');

        const result = await operation.cancelOperationWait({
            waitId: 'cancel-me',
            reason: 'caller stopped',
        });
        expect(result).toEqual({cancelled: true});
        await rejected;
        await expect(operation.cancelOperationWait({waitId: 'cancel-me'}))
            .resolves.toEqual({cancelled: false});
        operation._detach(handlers);
    });

    it('waits for a received active scope and observes its later revocation', async () => {
        const operation = new FotosQaOperation();
        const base = {
            initialized: true,
            ownerId: 'bob',
            publicationIdentity: 'bob',
            gallery: {isOpen: true, folderName: 'photos', items: []},
            collections: [],
        };
        fotosQaAppState.update({...base, receivedShares: []});
        const activeWait = operation.waitForReceivedShare({
            ownerPersonId: 'alice',
            collectionId: 'summer',
            photoHashes: ['photo-1'],
            timeoutMs: 1_000,
        });
        fotosQaAppState.update({...base, receivedShares: [{
            issuer: 'alice',
            scope: {kind: 'collection', id: 'summer'},
            status: 'active',
            verified: true,
            photoHashes: ['photo-1'],
            photoNames: ['photo.jpg'],
            issuedAt: '2026-09-11T10:00:00.000Z',
            revokedAt: null,
            revocationReason: null,
        }]});
        await expect(activeWait).resolves.toMatchObject({
            shares: [{status: 'active', photoHashes: ['photo-1']}],
        });

        const revokedWait = operation.waitForReceivedShare({
            ownerPersonId: 'alice',
            collectionId: 'summer',
            absent: true,
            timeoutMs: 1_000,
        });
        fotosQaAppState.update({...base, receivedShares: [{
            issuer: 'alice',
            scope: {kind: 'collection', id: 'summer'},
            status: 'revoked',
            verified: true,
            photoHashes: [],
            photoNames: [],
            issuedAt: '2026-09-11T10:01:00.000Z',
            revokedAt: '2026-09-11T10:01:00.000Z',
            revocationReason: 'Recipient removed',
        }]});
        await expect(revokedWait).resolves.toMatchObject({
            shares: [{status: 'revoked', revocationReason: 'Recipient removed'}],
        });
    });
});
