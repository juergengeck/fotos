import {beforeEach, describe, expect, it, vi} from 'vitest';
import {SET_ACCESS_MODE} from '@refinio/one.core/lib/storage-base-common.js';
import {commitFotosShareScope, type FotosShareCertificateDeps} from './fotosShareCertificates.js';
import {getFotosShareTraceSpans, resetFotosShareTraceForTests} from './fotosShareTrace.js';

function makeDeps() {
    const calls: string[] = [];
    const setAccess = vi.fn(async (entries: Array<Record<string, unknown>>) => {
        const mode = String(entries[0]?.mode);
        calls.push(mode === SET_ACCESS_MODE.REPLACE ? 'replace-scope-access' : 'publish-certificate');
    });
    const storeVersioned = vi.fn(async (object: any) => {
        calls.push(`store:${object.$type$}:${object.status ?? 'manifest'}`);
        return {
            obj: object,
            hash: `hash:${object.$type$}:${object.status ?? 'manifest'}`,
            idHash: `id:${object.id}`,
        } as any;
    });
    const deps: FotosShareCertificateDeps = {
        calculateIdHash: vi.fn(async () => 'manifest-id' as any),
        getByIdHash: vi.fn(async () => ({
            obj: {
                $type$: 'FotosShareManifest',
                entries: new Set(['entry-a']),
                snapshotObjects: new Set(['entry-a']),
                snapshotIds: new Set(['issuer']),
                snapshotOrder: ['object:entry-a', 'id:issuer'],
            },
            hash: 'current-manifest-hash',
            idHash: 'manifest-id',
        } as any)),
        storeVersioned,
        signVersion: vi.fn(async (_hash, _issuer) => {
            calls.push('sign-certificate');
            return 'signature-hash' as any;
        }),
        setAccess,
        resolveEntryChildren: vi.fn(async () => []),
    };
    return {calls, deps, setAccess, storeVersioned};
}

describe('commitFotosShareScope', () => {
    beforeEach(() => resetFotosShareTraceForTests());

    it('publishes a newer revocation before replacing photo-root access', async () => {
        const {calls, deps, setAccess, storeVersioned} = makeDeps();
        const result = await commitFotosShareScope({
            issuer: 'issuer' as any,
            scope: {kind: 'collection', id: 'summer'},
            previousPersonIds: ['anna', 'ben'],
            nextPersonIds: ['ben'],
            entryHashes: ['entry-a' as any],
        }, deps);

        expect(calls).toEqual([
            'store:FotosShareCertificate:revoked',
            'sign-certificate',
            'publish-certificate',
            'store:FotosShareCertificateChain:manifest',
            'replace-scope-access',
        ]);
        expect(storeVersioned.mock.calls[0]?.[0]).toMatchObject({
            status: 'revoked',
            subject: 'anna',
            revocationReason: 'Recipient removed from fotos share',
        });
        expect(setAccess.mock.calls[1]?.[0][0]).toMatchObject({
            id: 'manifest-id',
            person: ['ben'],
            mode: SET_ACCESS_MODE.REPLACE,
        });
        expect(result.transitions).toEqual([
            expect.objectContaining({
                personId: 'anna',
                status: 'revoked',
                chainHash: 'hash:FotosShareCertificateChain:manifest',
            }),
        ]);
        expect(getFotosShareTraceSpans().map(span => span.phase)).toEqual([
            'scope-closure',
            'scope-root-load-or-create',
            'certificate-status-check',
            'certificate-store',
            'certificate-sign',
            'certificate-chain-access',
            'certificate-chain-store',
            'manifest-access-replace',
            'manifest-store',
        ]);
        expect(getFotosShareTraceSpans()).toEqual(expect.arrayContaining([
            expect.objectContaining({
                scopeKind: 'collection',
                scopeId: 'summer',
                outcome: 'success',
            }),
        ]));
    });

    it('stores an active renewal under the same certificate identity when re-added', async () => {
        const {deps, storeVersioned} = makeDeps();
        await commitFotosShareScope({
            issuer: 'issuer' as any,
            scope: {kind: 'person', id: 'person-1'},
            previousPersonIds: [],
            nextPersonIds: ['anna'],
            entryHashes: ['entry-a' as any],
        }, deps);
        const active = storeVersioned.mock.calls[0]?.[0] as any;

        const {deps: revokeDeps, storeVersioned: revokeStore} = makeDeps();
        await commitFotosShareScope({
            issuer: 'issuer' as any,
            scope: {kind: 'person', id: 'person-1'},
            previousPersonIds: ['anna'],
            nextPersonIds: [],
            entryHashes: ['entry-a' as any],
        }, revokeDeps);
        const revoked = revokeStore.mock.calls[0]?.[0] as any;

        expect(active.status).toBe('active');
        expect(revoked.status).toBe('revoked');
        expect(active.id).toBe(revoked.id);
    });

    it('does not mint a new active version when reload migration finds one current', async () => {
        const {deps, storeVersioned, setAccess} = makeDeps();
        (deps.calculateIdHash as ReturnType<typeof vi.fn>).mockImplementation(async (object: any) => (
            object.$type$ === 'FotosShareCertificate'
                ? 'certificate-id'
                : object.$type$ === 'FotosShareCertificateChain'
                    ? 'chain-id'
                    : 'manifest-id'
        ));
        (deps.getByIdHash as ReturnType<typeof vi.fn>).mockImplementation(async (idHash: string) => (
            idHash === 'certificate-id'
                ? {
                    obj: {$type$: 'FotosShareCertificate', status: 'active'},
                    hash: 'active-certificate-hash',
                    idHash,
                }
                : idHash === 'chain-id'
                    ? {
                        obj: {
                            $type$: 'FotosShareCertificateChain',
                            issuer: 'issuer',
                            subject: 'anna',
                            scopeKind: 'gallery',
                            scopeId: 'main',
                            certificate: 'active-certificate-hash',
                        },
                        hash: 'active-chain-hash',
                        idHash,
                    }
                : {
                    obj: {
                        $type$: 'FotosShareManifest',
                        entries: new Set(['entry-a']),
                        snapshotObjects: new Set(['entry-a']),
                        snapshotIds: new Set(['issuer']),
                        snapshotOrder: ['object:entry-a', 'id:issuer'],
                    },
                    hash: 'current-manifest-hash',
                    idHash,
                }
        ));

        const result = await commitFotosShareScope({
            issuer: 'issuer' as any,
            scope: {kind: 'gallery', id: 'main'},
            previousPersonIds: [],
            nextPersonIds: ['anna'],
            entryHashes: ['entry-a' as any],
        }, deps);

        expect(result.transitions).toEqual([]);
        expect(storeVersioned).not.toHaveBeenCalled();
        expect(setAccess).toHaveBeenCalledTimes(1);
    });

    it('publishes a chain-backed version when reload migration finds only a legacy certificate', async () => {
        const {deps, storeVersioned} = makeDeps();
        (deps.calculateIdHash as ReturnType<typeof vi.fn>).mockImplementation(async (object: any) => (
            object.$type$ === 'FotosShareCertificate'
                ? 'certificate-id'
                : object.$type$ === 'FotosShareCertificateChain'
                    ? 'chain-id'
                    : 'manifest-id'
        ));
        (deps.getByIdHash as ReturnType<typeof vi.fn>).mockImplementation(async (idHash: string) => {
            if (idHash === 'certificate-id') {
                return {
                    obj: {$type$: 'FotosShareCertificate', status: 'active'},
                    hash: 'legacy-certificate-hash',
                    idHash,
                };
            }
            if (idHash === 'chain-id') throw new Error('File not found');
            return {
                obj: {
                    $type$: 'FotosShareManifest',
                    entries: new Set(['entry-a']),
                    snapshotObjects: new Set(['entry-a']),
                    snapshotIds: new Set(['issuer']),
                    snapshotOrder: ['object:entry-a', 'id:issuer'],
                },
                hash: 'current-manifest-hash',
                idHash,
            };
        });

        const result = await commitFotosShareScope({
            issuer: 'issuer' as any,
            scope: {kind: 'gallery', id: 'main'},
            previousPersonIds: [],
            nextPersonIds: ['anna'],
            entryHashes: ['entry-a' as any],
        }, deps);

        expect(result.transitions).toEqual([
            expect.objectContaining({personId: 'anna', status: 'active'}),
        ]);
        expect(storeVersioned.mock.calls.map(call => call[0].$type$)).toEqual([
            'FotosShareCertificate',
            'FotosShareCertificateChain',
        ]);
    });

    it('migrates an existing manifest when its entry set matches but its snapshot closure is stale', async () => {
        const {deps, storeVersioned} = makeDeps();
        (deps.getByIdHash as ReturnType<typeof vi.fn>).mockResolvedValue({
            obj: {$type$: 'FotosShareManifest', entries: new Set(['entry-a'])},
            hash: 'legacy-manifest-hash',
            idHash: 'manifest-id',
        });

        await commitFotosShareScope({
            issuer: 'issuer' as any,
            scope: {kind: 'gallery', id: 'main'},
            previousPersonIds: [],
            nextPersonIds: [],
            entryHashes: ['entry-a' as any],
        }, deps);

        expect(storeVersioned).toHaveBeenCalledTimes(1);
        expect(storeVersioned.mock.calls[0]?.[0]).toMatchObject({
            $type$: 'FotosShareManifest',
            snapshotOrder: ['object:entry-a', 'id:issuer'],
        });
    });

    it('leaves scope access unchanged when revocation evidence cannot be signed', async () => {
        const {calls, deps, setAccess, storeVersioned} = makeDeps();
        const failure = new Error('issuer key unavailable');
        deps.signVersion = vi.fn(async () => {
            throw failure;
        });

        await expect(commitFotosShareScope({
            issuer: 'issuer' as any,
            scope: {kind: 'collection', id: 'summer'},
            previousPersonIds: ['anna', 'ben'],
            nextPersonIds: ['ben'],
            entryHashes: ['entry-a' as any],
        }, deps)).rejects.toBe(failure);

        // D-03: the recipient is removed from derived access only after its
        // revocation is signed and published, so a failed signature keeps the
        // previous access set and publishes no new manifest version.
        expect(calls).toEqual(['store:FotosShareCertificate:revoked']);
        expect(setAccess).not.toHaveBeenCalled();
        expect(storeVersioned).toHaveBeenCalledTimes(1);
        expect(getFotosShareTraceSpans().map(span => [span.phase, span.outcome])).toEqual([
            ['scope-closure', 'success'],
            ['scope-root-load-or-create', 'success'],
            ['certificate-status-check', 'success'],
            ['certificate-store', 'success'],
            ['certificate-sign', 'error'],
        ]);
    });
});
