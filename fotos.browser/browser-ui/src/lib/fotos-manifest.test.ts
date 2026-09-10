import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    createAccess: vi.fn(async () => undefined),
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
    calculateIdHashOfObj: vi.fn(async (obj?: { $type$?: string }) =>
        obj?.$type$ === 'FotosDeviceBook'
            ? 'device-book-id-hash'
            : obj?.$type$ === 'Book'
                ? 'media-book-id-hash'
                : 'manifest-id-hash'),
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
        addListener: vi.fn(() => () => undefined),
    },
    storeVersionedObject: mocks.storeVersionedObject,
}));

vi.mock('@refinio/one.core/lib/instance.js', () => ({
    getInstanceOwnerIdHash: mocks.getInstanceOwnerIdHash,
}));

vi.mock('@refinio/one.core/lib/storage-unversioned-objects.js', () => ({
    getObject: vi.fn(),
}));

vi.mock('@refinio/one.core/lib/util/object.js', () => ({
    calculateIdHashOfObj: mocks.calculateIdHashOfObj,
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
    resetFotosManifestGrantStateForTests,
} from './fotos-manifest.js';

describe('grantFotosAccess', () => {
    beforeEach(() => {
        resetFotosManifestGrantStateForTests();
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
    });

    it('grants manifest access through the access-manager feed-forward path', async () => {
        await grantFotosAccess('remote-person-id' as any);

        expect(mocks.createAccess).toHaveBeenCalledOnce();
    });

    it('replaces legacy manifest access with an empty recipient set', async () => {
        await revokeLegacyFotosManifestAccess();
        expect(mocks.createAccess).toHaveBeenCalledWith([
            expect.objectContaining({id: 'manifest-id-hash', person: [], mode: 'replace'}),
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

        expect(mocks.createAccess).toHaveBeenCalledOnce();
        expect(mocks.createAccess).toHaveBeenCalledWith(expect.arrayContaining([
            expect.objectContaining({ id: 'device-book-id-hash' }),
            expect.objectContaining({ id: 'media-book-id-hash' }),
        ]));
        expect(mocks.calculateIdHashOfObj).toHaveBeenCalledWith(expect.objectContaining({
            $type$: 'Book',
            author: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        }));
    });

    it('extends remembered peer access when a new manifest entry is added later', async () => {
        await grantFotosAccess('remote-person-id' as any);
        mocks.createAccess.mockClear();

        await addEntryToManifest('entry-hash' as any);

        expect(mocks.createAccess).toHaveBeenCalledWith(expect.arrayContaining([
            expect.objectContaining({ object: 'stored-manifest-hash' }),
            expect.objectContaining({ object: 'entry-hash' }),
        ]));
        expect(mocks.storeVersionedObject).toHaveBeenCalledWith(expect.objectContaining({
            $type$: 'FotosManifest',
            id: 'fotos',
            entries: expect.any(Set),
        }));
    });

    it('extends remembered peer access when a new authenticity attestation is added later', async () => {
        await grantFotosAccess('remote-person-id' as any);
        mocks.createAccess.mockClear();

        await addAuthenticityAttestationToManifest('auth-hash' as any);

        expect(mocks.createAccess).toHaveBeenCalledWith(expect.arrayContaining([
            expect.objectContaining({ object: 'stored-manifest-hash' }),
            expect.objectContaining({ object: 'auth-hash' }),
        ]));
        expect(mocks.storeVersionedObject).toHaveBeenCalledWith(expect.objectContaining({
            $type$: 'FotosManifest',
            id: 'fotos',
            authenticityAttestations: expect.any(Set),
        }));
    });
});
