import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    createAccess: vi.fn(async () => undefined),
    versionedSubscribe: vi.fn<(listener: (value: any) => void) => () => void>(() => () => undefined),
    getObjectByIdHash: vi.fn(async (idHash?: string) => idHash === 'device-book-id-hash'
        ? {
            hash: 'device-book-version-hash',
            obj: {
                $type$: 'FotosDeviceBook',
                id: 'fotos-device-book:spark',
                deviceId: 'spark',
                title: 'Fotos Device Book (spark)',
                role: 'compute',
                entries: new Set(),
                variants: new Set(),
                locators: new Set(),
                authenticityAttestations: new Set(),
                createdAt: 1,
                updatedAt: 1,
            },
        }
        : idHash === 'media-book-id-hash'
            ? {
                hash: 'media-book-version-hash',
                obj: {
                    $type$: 'Book',
                    id: 'media-device-book:spark',
                    kind: 'media',
                    title: 'Media Device Book (spark)',
                    lifecycleStage: 'runtime',
                    status: 'available',
                    availabilityPayload: 'local',
                    createdAt: 1,
                    updatedAt: 1,
                },
            }
        : {
            hash: 'manifest-version-hash',
            obj: {
                $type$: 'FotosManifest',
                id: 'fotos',
                entries: new Set(),
                authenticityAttestations: new Set(),
            },
        }),
    storeVersionedObject: vi.fn(async (obj?: { $type$?: string; id?: string }) => ({
        obj,
        idHash: obj?.$type$ === 'FotosDeviceBook'
            ? 'device-book-id-hash'
            : obj?.$type$ === 'Book'
                ? 'media-book-id-hash'
                : 'manifest-id-hash',
        hash: obj?.$type$ === 'FotosDeviceBook'
            ? 'stored-device-book-hash'
            : obj?.$type$ === 'Book'
                ? 'stored-media-book-hash'
                : 'stored-manifest-hash',
        status: 'stored',
    })),
    ensureVersionedIdObject: vi.fn(async () => true),
    getInstanceOwnerIdHash: vi.fn(() => 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    calculateIdHashOfObj: vi.fn(async (obj?: { $type$?: string; id?: string }): Promise<string> =>
        obj?.$type$ === 'FotosDeviceBook'
            ? 'device-book-id-hash'
            : obj?.$type$ === 'Book'
                ? 'media-book-id-hash'
                : 'manifest-id-hash'),
    getObject: vi.fn(async (hash?: string) => ({
        $type$: 'FotosEntry',
        contentHash: hash === 'old-entry-hash' ? 'same-photo' : hash,
    })),
}));

vi.mock('@refinio/one.core/lib/access.js', () => ({
    createAccess: mocks.createAccess,
}));

vi.mock('@refinio/one.core/lib/storage-base-common.js', () => ({
    CREATION_STATUS: {
        NEW: 'new',
        EXISTS: 'exists',
    },
    SET_ACCESS_MODE: {
        ADD: 'add',
        REPLACE: 'replace',
    },
}));

vi.mock('@refinio/one.core/lib/storage-versioned-objects.js', () => ({
    getObjectByIdHash: mocks.getObjectByIdHash,
    onVersionedObj: {
        addListener: mocks.versionedSubscribe,
    },
    storeVersionedObject: mocks.storeVersionedObject,
}));

vi.mock('@refinio/one.core/lib/instance.js', () => ({
    getInstanceOwnerIdHash: mocks.getInstanceOwnerIdHash,
}));

vi.mock('@refinio/one.core/lib/storage-unversioned-objects.js', () => ({
    getObject: mocks.getObject,
}));

vi.mock('@refinio/one.core/lib/util/object.js', () => ({
    calculateIdHashOfObj: mocks.calculateIdHashOfObj,
    calculateHashOfObj: vi.fn(async () => 'a'.repeat(64)),
}));

vi.mock('@refinio/connection.core/helpers/ensure-versioned-id-object.js', () => ({
    ensureVersionedIdObject: mocks.ensureVersionedIdObject,
}));

import {
    addAuthenticityAttestationToManifest,
    addEntryToManifest,
    grantFotosAccess,
    grantFotosDeviceBookAccess,
    revokeLegacyFotosManifestAccess,
    readFotosManifestSnapshot,
    setFotosNativeOwnerContext,
    getFotosNativeOwnerContext,
    readNativeOwnedFotosEntries,
    ensureFotosManifest,
    listenForFotosManifestUpdates,
} from './fotos-manifest.js';

afterEach(() => {setFotosNativeOwnerContext(null);});

describe('grantFotosAccess', () => {
    beforeEach(() => {
        mocks.createAccess.mockClear();
        mocks.getObjectByIdHash.mockClear().mockResolvedValue({
            hash: 'manifest-version-hash',
            obj: {
                $type$: 'FotosManifest',
                id: 'fotos',
                entries: new Set(),
                authenticityAttestations: new Set(),
            },
        });
        mocks.storeVersionedObject.mockClear();
        mocks.ensureVersionedIdObject.mockClear().mockResolvedValue(true);
        mocks.getInstanceOwnerIdHash.mockReset().mockReturnValue(
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        );
        mocks.calculateIdHashOfObj.mockClear().mockImplementation(async (obj?: { $type$?: string }) =>
            obj?.$type$ === 'FotosDeviceBook'
                ? 'device-book-id-hash'
                : obj?.$type$ === 'Book'
                    ? 'media-book-id-hash'
                : 'manifest-id-hash');
        mocks.getObject.mockClear().mockImplementation(async (hash?: string) => ({
            $type$: 'FotosEntry',
            contentHash: hash === 'old-entry-hash' ? 'same-photo' : hash,
        }));
    });

    it('grants only the manifest identity and retires legacy current-snapshot access', async () => {
        await grantFotosAccess('remote-person-id' as any);

        expect(mocks.createAccess).toHaveBeenCalledExactlyOnceWith([
            {id: 'manifest-id-hash', person: ['remote-person-id'], hashGroup: [], mode: 'add'},
            {object: 'manifest-version-hash', person: [], hashGroup: [], mode: 'replace'},
        ]);
        expect(mocks.getObject).not.toHaveBeenCalled();
    });

    it('retires external recipients while retaining the owner IoM root grant', async () => {
        await revokeLegacyFotosManifestAccess();
        expect(mocks.createAccess).toHaveBeenCalledWith([
            expect.objectContaining({id: 'manifest-id-hash', person: ['a'.repeat(64)], mode: 'replace'}),
            expect.objectContaining({object: 'manifest-version-hash', person: [], mode: 'replace'}),
        ]);
    });

    it('grants a device-book root for machine-scoped fotos sharing', async () => {
        mocks.getObjectByIdHash.mockImplementation(async (idHash?: string) => idHash === 'device-book-id-hash'
            ? {
                hash: 'device-book-version-hash',
                obj: {
                    $type$: 'FotosDeviceBook',
                    id: 'fotos-device-book:spark',
                    deviceId: 'spark',
                    title: 'Fotos Device Book (spark)',
                    role: 'compute',
                    entries: new Set(),
                    variants: new Set(),
                    locators: new Set(),
                    authenticityAttestations: new Set(),
                    createdAt: 1,
                    updatedAt: 1,
                },
            }
            : idHash === 'media-book-id-hash'
                ? {
                    hash: 'media-book-version-hash',
                    obj: {
                        $type$: 'Book',
                        id: 'media-device-book:spark',
                        kind: 'media',
                        title: 'Media Device Book (spark)',
                        lifecycleStage: 'runtime',
                        status: 'available',
                        availabilityPayload: 'local',
                        createdAt: 1,
                        updatedAt: 1,
                    },
                }
            : {
                hash: 'manifest-version-hash',
                obj: {
                    $type$: 'FotosManifest',
                    id: 'fotos',
                    entries: new Set(),
                    authenticityAttestations: new Set(),
                },
            });

        await grantFotosDeviceBookAccess('remote-person-id' as any, {
            deviceId: 'spark',
            role: 'compute',
        });

        expect(mocks.createAccess).toHaveBeenCalledExactlyOnceWith([
            {id: 'device-book-id-hash', person: ['remote-person-id'], hashGroup: [], mode: 'add'},
            {object: 'device-book-version-hash', person: [], hashGroup: [], mode: 'replace'},
            {id: 'media-book-id-hash', person: ['remote-person-id'], hashGroup: [], mode: 'add'},
            {object: 'media-book-version-hash', person: [], hashGroup: [], mode: 'replace'},
        ]);
        expect(mocks.calculateIdHashOfObj).toHaveBeenCalledWith(expect.objectContaining({
            $type$: 'Book',
            author: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        }));
    });

    it('publishes later manifest entries through the granted identity without per-update access grants', async () => {
        await grantFotosAccess('remote-person-id' as any);
        mocks.createAccess.mockClear();

        await addEntryToManifest('entry-hash' as any);

        expect(mocks.createAccess).not.toHaveBeenCalled();
        expect(mocks.storeVersionedObject).toHaveBeenCalledWith(expect.objectContaining({
            $type$: 'FotosManifest',
            id: 'fotos',
            entries: expect.any(Set),
        }));
    });

    it('replaces an older concrete version of the same logical photo entry', async () => {
        mocks.getObjectByIdHash.mockResolvedValue({
            hash: 'manifest-version-hash',
            obj: {
                $type$: 'FotosManifest',
                id: 'fotos',
                entries: new Set(['old-entry-hash', 'other-entry-hash']),
                authenticityAttestations: new Set(),
            },
        });
        mocks.getObject.mockImplementation(async (hash?: string) => ({
            $type$: 'FotosEntry',
            contentHash: hash === 'old-entry-hash' || hash === 'new-entry-hash'
                ? 'same-photo'
                : 'other-photo',
        }));

        await addEntryToManifest('new-entry-hash' as any);

        expect(mocks.storeVersionedObject).toHaveBeenCalledWith(expect.objectContaining({
            entries: new Set(['other-entry-hash', 'new-entry-hash']),
        }));
    });

    it('publishes later authenticity references without per-update access grants', async () => {
        await grantFotosAccess('remote-person-id' as any);
        mocks.createAccess.mockClear();

        await addAuthenticityAttestationToManifest('auth-hash' as any);

        expect(mocks.createAccess).not.toHaveBeenCalled();
        expect(mocks.storeVersionedObject).toHaveBeenCalledWith(expect.objectContaining({
            $type$: 'FotosManifest',
            id: 'fotos',
            authenticityAttestations: expect.any(Set),
        }));
    });
});


it('exposes the persisted acquisition observation roots in the owning manifest query', async () => {
    mocks.getObjectByIdHash.mockResolvedValue({hash: 'manifest-version-hash', obj: {
        $type$: 'FotosManifest', id: 'fotos', entries: new Set(['entry-hash']), authenticityAttestations: new Set(),
    }} as any);
    mocks.getObject.mockResolvedValue({
        $type$: 'FotosEntry', contentHash: 'photo', sourcePath: 'photo.jpg',
        acquisitionObservations: new Set(['observation-b', 'observation-a']),
    } as any);
    expect((await readFotosManifestSnapshot()).resolvedEntries[0].acquisitionObservationHashes).toEqual(['observation-a', 'observation-b']);
});

describe('admitted native owned Fotos manifest reopening', () => {
    const owner = 'a'.repeat(64);
    const rootId = `fotos:${owner}`;
    const entryHash = 'c'.repeat(64);
    const entry = {$type$: 'FotosEntry', contentHash: 'd'.repeat(64), streamId: 'd'.repeat(64),
        mime: 'image/png', size: 7, sourcePath: 'native.png', thumb: 'e'.repeat(64)};
    beforeEach(() => {
        mocks.getInstanceOwnerIdHash.mockReturnValue(owner);
        mocks.calculateIdHashOfObj.mockClear().mockImplementation(async (obj?: {$type$?: string; id?: string}) => obj?.id ?? 'unknown');
        mocks.getObjectByIdHash.mockReset().mockResolvedValue({hash: 'native-manifest-version', obj: {
            $type$: 'FotosManifest', id: rootId, entries: new Set([entryHash]),
        }} as any);
        mocks.getObject.mockReset().mockResolvedValue(entry as any);
        mocks.storeVersionedObject.mockClear();
        mocks.createAccess.mockClear();
    });

    it('never infers native admission from matching owner identity', async () => {
        expect(getFotosNativeOwnerContext()).toBeNull();
        expect(await readNativeOwnedFotosEntries(owner)).toEqual([]);
        expect(mocks.getObjectByIdHash).not.toHaveBeenCalled();
        expect(mocks.getObject).not.toHaveBeenCalled();
    });

    it('restores exact immutable entry refs from the accepted owner root after reopening', async () => {
        setFotosNativeOwnerContext(owner);
        expect(await readNativeOwnedFotosEntries(owner)).toEqual([entry]);
        expect(mocks.getObjectByIdHash).toHaveBeenCalledWith(rootId);
        expect(mocks.getObject).toHaveBeenCalledWith(entryHash);
        expect(mocks.getObject).toHaveBeenCalledTimes(1);
        setFotosNativeOwnerContext(null);
        setFotosNativeOwnerContext(owner);
        expect(await readNativeOwnedFotosEntries(owner)).toEqual([entry]);
        expect(mocks.storeVersionedObject).not.toHaveBeenCalled();
        expect(mocks.createAccess).not.toHaveBeenCalled();
    });

    it('restores one deterministic exact representative for 100 metadata refs of one owned image', async () => {
        setFotosNativeOwnerContext(owner);
        const hashes = Array.from({length: 100}, (_, index) => index.toString(16).padStart(64, '0'));
        mocks.getObjectByIdHash.mockResolvedValue({hash: 'multi-version-root', obj: {
            $type$: 'FotosManifest', id: rootId, entries: new Set([...hashes].reverse()),
        }} as any);
        mocks.getObject.mockImplementation(async hash => ({...entry, faceCount: hashes.indexOf(hash!)}));
        expect(await readNativeOwnedFotosEntries(owner)).toEqual([{...entry, faceCount: 0}]);
        expect(mocks.getObject).toHaveBeenCalledTimes(100);
        expect(mocks.storeVersionedObject).not.toHaveBeenCalled();
        expect(mocks.createAccess).not.toHaveBeenCalled();
    });

    it('retains the legacy root after the native context is cleared', async () => {
        setFotosNativeOwnerContext(owner);
        await readNativeOwnedFotosEntries(owner);
        setFotosNativeOwnerContext(null);
        mocks.getObjectByIdHash.mockResolvedValue({hash: 'legacy-version', obj: {$type$: 'FotosManifest', id: 'fotos', entries: new Set()}} as any);
        const snapshot = await readFotosManifestSnapshot();
        expect(snapshot.idHash).toBe('fotos');
        expect(mocks.getObjectByIdHash).toHaveBeenLastCalledWith('fotos');
    });

    it('selects a different deterministic root on admitted owner context change', async () => {
        setFotosNativeOwnerContext(owner);
        await readNativeOwnedFotosEntries(owner);
        const nextOwner = 'b'.repeat(64);
        mocks.getInstanceOwnerIdHash.mockReturnValue(nextOwner);
        mocks.getObjectByIdHash.mockResolvedValue({hash: 'next-version', obj: {$type$: 'FotosManifest', id: `fotos:${nextOwner}`, entries: new Set()}} as any);
        setFotosNativeOwnerContext(nextOwner);
        expect(await readNativeOwnedFotosEntries(nextOwner)).toEqual([]);
        expect(mocks.getObjectByIdHash).toHaveBeenLastCalledWith(`fotos:${nextOwner}`);
    });

    it('keeps owner-root publication independent of browser grant history after reopening', async () => {
        setFotosNativeOwnerContext(owner);
        await grantFotosAccess(owner as any);
        expect(mocks.createAccess).toHaveBeenCalledExactlyOnceWith([
            {id: rootId, person: [owner], hashGroup: [], mode: 'add'},
            {object: 'native-manifest-version', person: [], hashGroup: [], mode: 'replace'},
        ]);
        mocks.createAccess.mockClear();
        setFotosNativeOwnerContext(owner);
        await addEntryToManifest('f'.repeat(64) as any);
        expect(mocks.createAccess).not.toHaveBeenCalled();
    });

    it('creates only the selected scoped root when that root is absent', async () => {
        setFotosNativeOwnerContext(owner);
        mocks.getObjectByIdHash.mockRejectedValueOnce(Object.assign(new Error('Absent'), {name: 'FileNotFoundError'}));
        expect(await ensureFotosManifest()).toBe(rootId);
        expect(mocks.storeVersionedObject).toHaveBeenCalledWith(expect.objectContaining({$type$: 'FotosManifest', id: rootId}));
    });

    it('feeds only the selected scoped manifest arrival to its owning projection', async () => {
        setFotosNativeOwnerContext(owner);
        let resolve!: (snapshot: {idHash: string; contentHashes: string[]}) => void;
        const received = new Promise<{idHash: string; contentHashes: string[]}>(done => {resolve = done;});
        const project = vi.fn(resolve);
        const stop = listenForFotosManifestUpdates(project);
        const listener = mocks.versionedSubscribe.mock.calls.at(-1)![0];
        listener({obj: {$type$: 'FotosManifest', id: 'fotos', entries: new Set([entryHash])}, hash: 'legacy'});
        listener({obj: {$type$: 'FotosManifest', id: `fotos:${'b'.repeat(64)}`, entries: new Set([entryHash])}, hash: 'other'});
        expect(project).not.toHaveBeenCalled();
        listener({obj: {$type$: 'FotosManifest', id: rootId, entries: new Set([entryHash])}, hash: 'selected'});
        expect(await received).toMatchObject({idHash: rootId, contentHashes: [entry.contentHash]});
        stop();
    });

    it('does not replace an unreadable native root with an empty manifest', async () => {
        setFotosNativeOwnerContext(owner);
        mocks.getObjectByIdHash.mockRejectedValueOnce(new Error('Corrupt native root'));
        await expect(ensureFotosManifest()).rejects.toThrow('Corrupt native root');
        expect(mocks.storeVersionedObject).not.toHaveBeenCalled();
    });

    it.each(['fotos', `fotos:${'b'.repeat(64)}`])('rejects root %s rather than exposing another namespace', async id => {
        setFotosNativeOwnerContext(owner);
        mocks.getObjectByIdHash.mockResolvedValue({hash: 'wrong-root', obj: {$type$: 'FotosManifest', id, entries: new Set([entryHash])}} as any);
        await expect(readNativeOwnedFotosEntries(owner)).rejects.toThrow('Malformed native owned Fotos manifest');
        expect(mocks.getObject).not.toHaveBeenCalled();
    });

    it('reports a missing entry without scanning, fetching, or manufacturing an empty manifest', async () => {
        setFotosNativeOwnerContext(owner);
        mocks.getObject.mockRejectedValueOnce(Object.assign(new Error('Exact entry is absent'), {name: 'FileNotFoundError'}));
        await expect(readNativeOwnedFotosEntries(owner)).rejects.toThrow('Exact entry is absent');
        expect(mocks.getObject).toHaveBeenCalledTimes(1);
        expect(mocks.storeVersionedObject).not.toHaveBeenCalled();
    });

    it('rejects malformed root references and a reader from another owner', async () => {
        setFotosNativeOwnerContext(owner);
        await expect(readNativeOwnedFotosEntries('b'.repeat(64))).rejects.toThrow('admitted owner');
        mocks.getObjectByIdHash.mockResolvedValue({hash: 'malformed', obj: {$type$: 'FotosManifest', id: rootId, entries: ['wrong-shape']}} as any);
        await expect(readNativeOwnedFotosEntries(owner)).rejects.toThrow('Malformed native owned Fotos manifest');
        expect(mocks.getObject).not.toHaveBeenCalled();
    });

    it('rejects context admission for a noncanonical or different active owner', () => {
        expect(() => setFotosNativeOwnerContext('visitor')).toThrow('canonical Person');
        expect(() => setFotosNativeOwnerContext('b'.repeat(64))).toThrow('active owner');
    });
});
