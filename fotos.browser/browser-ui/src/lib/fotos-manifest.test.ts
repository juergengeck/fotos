import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    createAccess: vi.fn(async () => undefined),
    notifyAllActiveExportersAboutNewAccessibleRoots: vi.fn(() => 1),
    notifyRemotePeerAboutNewAccessibleRoots: vi.fn(() => 1),
    getObjectByIdHash: vi.fn(async () => ({
        hash: 'manifest-version-hash',
        obj: {
            $type$: 'FotosManifest',
            id: 'fotos',
            entries: new Set(),
            authenticityAttestations: new Set(),
        },
    })),
    storeVersionedObject: vi.fn(async () => ({
        hash: 'stored-manifest-hash',
        status: 'stored',
    })),
    ensureVersionedIdObject: vi.fn(async () => true),
    calculateIdHashOfObj: vi.fn(async () => 'manifest-id-hash'),
}));

vi.mock('@refinio/one.core/lib/access.js', () => ({
    createAccess: mocks.createAccess,
}));

vi.mock('@refinio/one.core/lib/chum-sync.js', () => ({
    notifyAllActiveExportersAboutNewAccessibleRoots:
        mocks.notifyAllActiveExportersAboutNewAccessibleRoots,
    notifyRemotePeerAboutNewAccessibleRoots:
        mocks.notifyRemotePeerAboutNewAccessibleRoots,
}));

vi.mock('@refinio/one.core/lib/storage-base-common.js', () => ({
    SET_ACCESS_MODE: {
        ADD: 'ADD',
    },
}));

vi.mock('@refinio/one.core/lib/storage-versioned-objects.js', () => ({
    getObjectByIdHash: mocks.getObjectByIdHash,
    onVersionedObj: {
        addListener: vi.fn(() => () => undefined),
    },
    storeVersionedObject: mocks.storeVersionedObject,
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
    resetFotosManifestGrantStateForTests,
} from './fotos-manifest.js';

describe('grantFotosAccess', () => {
    beforeEach(() => {
        resetFotosManifestGrantStateForTests();
        mocks.createAccess.mockClear();
        mocks.notifyAllActiveExportersAboutNewAccessibleRoots.mockClear().mockReturnValue(1);
        mocks.notifyRemotePeerAboutNewAccessibleRoots.mockClear().mockReturnValue(1);
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
        mocks.calculateIdHashOfObj.mockClear().mockResolvedValue('manifest-id-hash');
    });

    it('notifies the targeted remote peer after granting manifest access', async () => {
        await grantFotosAccess('remote-person-id' as any);

        expect(mocks.createAccess).toHaveBeenCalledOnce();
        expect(mocks.notifyRemotePeerAboutNewAccessibleRoots).toHaveBeenCalledWith('remote-person-id');
        expect(mocks.notifyAllActiveExportersAboutNewAccessibleRoots).not.toHaveBeenCalled();
    });

    it('falls back to notifying all exporters when no direct exporter is active', async () => {
        mocks.notifyRemotePeerAboutNewAccessibleRoots.mockReturnValue(0);

        await grantFotosAccess('remote-person-id' as any);

        expect(mocks.notifyRemotePeerAboutNewAccessibleRoots).toHaveBeenCalledWith('remote-person-id');
        expect(mocks.notifyAllActiveExportersAboutNewAccessibleRoots).toHaveBeenCalledOnce();
    });

    it('re-notifies already granted peers when a new manifest entry is added later', async () => {
        await grantFotosAccess('remote-person-id' as any);
        mocks.notifyRemotePeerAboutNewAccessibleRoots.mockClear().mockReturnValue(1);
        mocks.notifyAllActiveExportersAboutNewAccessibleRoots.mockClear().mockReturnValue(1);

        await addEntryToManifest('entry-hash' as any);

        expect(mocks.storeVersionedObject).toHaveBeenCalledWith(expect.objectContaining({
            $type$: 'FotosManifest',
            id: 'fotos',
            entries: expect.any(Set),
        }));
        expect(mocks.notifyRemotePeerAboutNewAccessibleRoots).toHaveBeenCalledWith('remote-person-id');
        expect(mocks.notifyAllActiveExportersAboutNewAccessibleRoots).not.toHaveBeenCalled();
    });

    it('re-notifies already granted peers when a new authenticity attestation is added later', async () => {
        await grantFotosAccess('remote-person-id' as any);
        mocks.notifyRemotePeerAboutNewAccessibleRoots.mockClear().mockReturnValue(1);
        mocks.notifyAllActiveExportersAboutNewAccessibleRoots.mockClear().mockReturnValue(1);

        await addAuthenticityAttestationToManifest('auth-hash' as any);

        expect(mocks.storeVersionedObject).toHaveBeenCalledWith(expect.objectContaining({
            $type$: 'FotosManifest',
            id: 'fotos',
            authenticityAttestations: expect.any(Set),
        }));
        expect(mocks.notifyRemotePeerAboutNewAccessibleRoots).toHaveBeenCalledWith('remote-person-id');
        expect(mocks.notifyAllActiveExportersAboutNewAccessibleRoots).not.toHaveBeenCalled();
    });
});
