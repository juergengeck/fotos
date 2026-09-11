import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    storeVersionedObjectMock,
    getObjectByIdHashMock,
    addEntryToManifestMock,
    addAuthenticityAttestationToManifestMock,
    resolveFotosAuthenticityContextMock,
    createFotosAuthenticityAttestationMock,
    calculateIdHashOfObjMock,
    getInstanceIdHashMock,
    getInstanceOwnerIdHashMock,
    appendMediaBookContentMock,
    storeArrayBufferAsBlobMock,
    hashImageFileMock,
} = vi.hoisted(() => ({
    storeVersionedObjectMock: vi.fn(async (obj: Record<string, unknown>) => ({
        hash: `${String(obj.$type$)}-hash`,
        idHash: `${String(obj.$type$)}-id-hash`,
        status: 'stored',
    })),
    getObjectByIdHashMock: vi.fn(async () => {
        const error = new Error('not found');
        error.name = 'FileNotFoundError';
        throw error;
    }),
    addEntryToManifestMock: vi.fn(async () => undefined),
    addAuthenticityAttestationToManifestMock: vi.fn(async () => undefined),
    resolveFotosAuthenticityContextMock: vi.fn(),
    createFotosAuthenticityAttestationMock: vi.fn(() => ({
        $type$: 'FotosAuthenticityAttestation',
        id: 'attestation-id',
        contentHash: 'photo-hash',
        signer: 'person-1',
        signerPublicKey: 'public-key',
        signatureScheme: 'fotos-authenticity-v1',
        signature: 'signature',
    })),
    calculateIdHashOfObjMock: vi.fn(async () => 'FotosEntry-id-hash'),
    getInstanceIdHashMock: vi.fn(() => 'instance-id-hash'),
    getInstanceOwnerIdHashMock: vi.fn(() => 'owner-hash'),
    appendMediaBookContentMock: vi.fn(async () => undefined),
    storeArrayBufferAsBlobMock: vi.fn(async () => ({hash: 'original-blob-hash'})),
    hashImageFileMock: vi.fn(async () => 'photo-hash'),
}));

vi.mock('@refinio/one.core/lib/storage-versioned-objects.js', () => ({
    getObjectByIdHash: getObjectByIdHashMock,
    storeVersionedObject: storeVersionedObjectMock,
    onVersionedObj: {
        addListener: vi.fn(() => () => undefined),
    },
}));

vi.mock('@refinio/one.core/lib/storage-blob.js', () => ({
    storeArrayBufferAsBlob: storeArrayBufferAsBlobMock,
    readBlobAsArrayBuffer: vi.fn(),
}));

vi.mock('./browserIngest.js', () => ({
    hashImageFile: hashImageFileMock,
}));

vi.mock('@refinio/one.core/lib/instance.js', () => ({
    getInstanceIdHash: getInstanceIdHashMock,
    getInstanceOwnerIdHash: getInstanceOwnerIdHashMock,
}));

vi.mock('@refinio/one.core/lib/util/object.js', () => ({
    calculateIdHashOfObj: calculateIdHashOfObjMock,
}));

vi.mock('./fotos-manifest.js', () => ({
    addEntryToManifest: addEntryToManifestMock,
    addAuthenticityAttestationToManifest: addAuthenticityAttestationToManifestMock,
}));

vi.mock('@refinio/fotos.core', () => ({
    EMBEDDING_DIM: 512,
    facesToDataAttrs: vi.fn(() => ({})),
}));

vi.mock('@refinio/source.media/services', () => ({
    createMediaSource: vi.fn((params: any) => ({
        $type$: 'Source',
        id: `source:${params.deviceId}:${params.locator}`,
        ...params,
    })),
    createMediaSourceEntry: vi.fn((params: any) => ({
        $type$: 'SourceEntry',
        id: `entry:${params.sourceId}:${params.locator}`,
        sourceRef: params.sourceIdHash,
        ...params,
    })),
    appendMediaBookContent: appendMediaBookContentMock,
}));

vi.mock('./fotos-authenticity.js', () => ({
    resolveFotosAuthenticityContext: resolveFotosAuthenticityContextMock,
    createFotosAuthenticityAttestation: createFotosAuthenticityAttestationMock,
}));

import {
    getVersionedObjectIfPresent,
    shouldClaimFotosAuthorship,
    syncPhotosToOneCore,
} from './fotos-sync.js';

describe('fotos sync authorship toggle', () => {
    beforeEach(() => {
        storeVersionedObjectMock.mockClear();
        getObjectByIdHashMock.mockClear();
        addEntryToManifestMock.mockClear();
        addAuthenticityAttestationToManifestMock.mockClear();
        resolveFotosAuthenticityContextMock.mockReset().mockResolvedValue({
            signerPersonId: 'person-1',
            signerPublicKey: 'public-key',
            signingSecretKey: new Uint8Array([1, 2, 3]),
            subscriptionCertificateHash: null,
        });
        createFotosAuthenticityAttestationMock.mockClear();
        calculateIdHashOfObjMock.mockClear().mockResolvedValue('FotosEntry-id-hash');
        getInstanceIdHashMock.mockReset().mockReturnValue('instance-id-hash');
        getInstanceOwnerIdHashMock.mockReset().mockReturnValue('owner-hash');
        appendMediaBookContentMock.mockClear();
        storeArrayBufferAsBlobMock.mockClear().mockResolvedValue({hash: 'original-blob-hash'});
        hashImageFileMock.mockClear().mockResolvedValue('photo-hash');
    });

    it('claims authorship by default', () => {
        expect(shouldClaimFotosAuthorship()).toBe(true);
    });

    it('preserves declared GIF MIME in synced entries and original variants without a filename extension', async () => {
        await syncPhotosToOneCore([{
            hash: 'gif-hash',
            name: 'animation',
            mimeType: 'image/gif',
            size: 123,
            managed: 'metadata',
            tags: [],
            addedAt: '2026-09-11T00:00:00.000Z',
        }], null, {claimAuthorship: false});

        const objects = storeVersionedObjectMock.mock.calls.map(([object]) => object);
        expect(objects.find(object => object.$type$ === 'FotosEntry')).toMatchObject({
            contentHash: 'gif-hash', mime: 'image/gif',
        });
        expect(objects.find(object => object.$type$ === 'FotosMediaVariant' && object.role === 'original')).toMatchObject({
            contentHash: 'gif-hash', mime: 'image/gif',
        });
    });

    it('adapts a missing ONE.core version head to an optional source.media read', async () => {
        await expect(getVersionedObjectIfPresent('missing-id' as any)).resolves.toBeUndefined();
    });

    it('lets ingestion opt out of claiming authorship', async () => {
        await syncPhotosToOneCore([{
            hash: 'photo-hash',
            name: 'photo.jpg',
            size: 123,
            managed: 'metadata',
            tags: [],
            capturedAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
            addedAt: '2024-01-01T00:00:00.000Z',
        }], null, {
            claimAuthorship: false,
        });

        expect(resolveFotosAuthenticityContextMock).not.toHaveBeenCalled();
        expect(createFotosAuthenticityAttestationMock).not.toHaveBeenCalled();
        expect(addAuthenticityAttestationToManifestMock).not.toHaveBeenCalled();
        expect(storeVersionedObjectMock).toHaveBeenCalledTimes(5);
        expect(appendMediaBookContentMock).toHaveBeenCalledWith(
            expect.any(Object),
            expect.objectContaining({author: 'owner-hash'}),
        );
    });

    it('still resolves authenticity context when claiming authorship', async () => {
        await syncPhotosToOneCore([{
            hash: 'photo-hash',
            name: 'photo.jpg',
            size: 123,
            managed: 'metadata',
            tags: [],
            capturedAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
            addedAt: '2024-01-01T00:00:00.000Z',
        }], null, {
            claimAuthorship: true,
        });

        expect(resolveFotosAuthenticityContextMock).toHaveBeenCalledTimes(1);
        expect(createFotosAuthenticityAttestationMock).toHaveBeenCalledWith('photo-hash', expect.any(Object));
        expect(addAuthenticityAttestationToManifestMock).toHaveBeenCalledTimes(1);
        expect(storeVersionedObjectMock).toHaveBeenCalledTimes(6);
    });

    it('publishes verified local original bytes through the original media variant', async () => {
        const bytes = new Uint8Array([1, 2, 3, 4]);
        const file = {
            size: bytes.byteLength,
            arrayBuffer: vi.fn(async () => bytes.buffer),
        } as unknown as File;
        const rootHandle = {
            getFileHandle: vi.fn(async () => ({
                getFile: vi.fn(async () => file),
            })),
        } as unknown as FileSystemDirectoryHandle;

        await syncPhotosToOneCore([{
            hash: 'photo-hash',
            name: 'photo.png',
            sourcePath: 'photo.png',
            size: bytes.byteLength,
            managed: 'metadata',
            tags: [],
            addedAt: '2026-09-11T00:00:00.000Z',
        }], rootHandle, {
            claimAuthorship: false,
            requireOriginalBlob: true,
        });

        expect(hashImageFileMock).toHaveBeenCalledWith(file);
        expect(storeArrayBufferAsBlobMock).toHaveBeenCalledOnce();
        const originalVariant = storeVersionedObjectMock.mock.calls
            .map(([object]) => object)
            .find(object => object.$type$ === 'FotosMediaVariant' && object.role === 'original');
        expect(originalVariant).toMatchObject({
            contentHash: 'photo-hash',
            role: 'original',
            blob: 'original-blob-hash',
        });
    });

    it('rejects portable publication when source bytes no longer match the entry identity', async () => {
        const file = {
            size: 4,
            arrayBuffer: vi.fn(async () => new Uint8Array([1, 2, 3, 4]).buffer),
        } as unknown as File;
        const rootHandle = {
            getFileHandle: vi.fn(async () => ({
                getFile: vi.fn(async () => file),
            })),
        } as unknown as FileSystemDirectoryHandle;
        hashImageFileMock.mockResolvedValue('different-photo-hash');

        await expect(syncPhotosToOneCore([{
            hash: 'photo-hash',
            name: 'photo.png',
            sourcePath: 'photo.png',
            size: 4,
            managed: 'metadata',
            tags: [],
            addedAt: '2026-09-11T00:00:00.000Z',
        }], rootHandle, {
            claimAuthorship: false,
            requireOriginalBlob: true,
        })).rejects.toThrow('Original content changed');
        expect(storeArrayBufferAsBlobMock).not.toHaveBeenCalled();
    });
});
