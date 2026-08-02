import {describe, expect, it, vi} from 'vitest';
import {SET_ACCESS_MODE} from '@refinio/one.core/lib/storage-base-common.js';
import {commitFotosShareScope, type FotosShareCertificateDeps} from './fotosShareCertificates.js';

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
            obj: {$type$: 'FotosShareManifest', entries: new Set(['entry-a'])},
            hash: 'current-manifest-hash',
            idHash: 'manifest-id',
        } as any)),
        storeVersioned,
        signVersion: vi.fn(async (_hash, _issuer) => {
            calls.push('sign-certificate');
            return 'signature-hash' as any;
        }),
        setAccess,
    };
    return {calls, deps, setAccess, storeVersioned};
}

describe('commitFotosShareScope', () => {
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
            expect.objectContaining({personId: 'anna', status: 'revoked'}),
        ]);
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
            object.$type$ === 'FotosShareCertificate' ? 'certificate-id' : 'manifest-id'
        ));
        (deps.getByIdHash as ReturnType<typeof vi.fn>).mockImplementation(async (idHash: string) => (
            idHash === 'certificate-id'
                ? {
                    obj: {$type$: 'FotosShareCertificate', status: 'active'},
                    hash: 'active-certificate-hash',
                    idHash,
                }
                : {
                    obj: {$type$: 'FotosShareManifest', entries: new Set(['entry-a'])},
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
});
