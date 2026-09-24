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
    readMediaBookMock,
    storeArrayBufferAsBlobMock,
    hashImageFileMock,
    getObjectWithTypeMock,
    readFotosManifestSnapshotMock,
    existsMock,
} = vi.hoisted(() => ({
    storeVersionedObjectMock: vi.fn(async (obj: Record<string, unknown>) => ({
        hash: `${String(obj.$type$)}-hash`,
        idHash: `${String(obj.$type$)}-id-hash`,
        status: 'stored',
    })),
    getObjectByIdHashMock: vi.fn<(...args: any[]) => Promise<any>>(async () => {
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
    calculateIdHashOfObjMock: vi.fn<(...args: any[]) => Promise<any>>(async obj =>
        `${String(obj.$type$)}-id-hash`,
    ),
    getInstanceIdHashMock: vi.fn(() => 'instance-id-hash'),
    getInstanceOwnerIdHashMock: vi.fn(() => 'owner-hash'),
    appendMediaBookContentMock: vi.fn(async () => undefined),
    readMediaBookMock: vi.fn(),
    storeArrayBufferAsBlobMock: vi.fn(async () => ({hash: 'original-blob-hash'})),
    hashImageFileMock: vi.fn(async () => 'photo-hash'),
    getObjectWithTypeMock: vi.fn(),
    readFotosManifestSnapshotMock: vi.fn<(...args: any[]) => Promise<any>>(async () => ({
        entryHashes: [],
        resolvedAttestations: [],
    })),
    existsMock: vi.fn(async () => true),
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

vi.mock('@refinio/one.core/lib/system/storage-base.js', () => ({
    exists: existsMock,
}));

vi.mock('@refinio/one.core/lib/storage-unversioned-objects.js', () => ({
    getObjectWithType: getObjectWithTypeMock,
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
    readFotosManifestSnapshot: readFotosManifestSnapshotMock,
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
        sourceId: params.sourceIdHash,
        kind: params.entryKind,
        locator: params.locator,
        sourceRef: params.sourceIdHash,
        title: params.title,
        summary: params.summary,
        contentHash: params.contentHash,
    })),
    appendMediaBookContent: appendMediaBookContentMock,
    readMediaBook: readMediaBookMock,
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
    function mockPersistedPhoto(photo: Record<string, any>, overrides: Record<string, any> = {}): void {
        readFotosManifestSnapshotMock.mockResolvedValue({
            entryHashes: ['entry-hash'],
            resolvedAttestations: [],
        });
        const sourceId = `source:instance-id-hash:${photo.folderPath || 'browser-gallery'}`;
        const sourceEntryId = `entry:${sourceId}:${photo.sourcePath || photo.name}`;
        const locatorValues = [photo.sourcePath, ...(photo.copies ?? [])]
            .filter(value => typeof value === 'string' && value.length > 0 && !value.startsWith('blob:') && !value.startsWith('data:'));
        getObjectByIdHashMock.mockImplementation(async idHash => {
            switch (idHash) {
                case 'FotosEntry-id-hash':
                    return {
                        hash: 'entry-hash',
                        obj: {
                            $type$: 'FotosEntry',
                            contentHash: photo.hash,
                            streamId: photo.hash,
                            mime: photo.mimeType,
                            size: photo.size,
                            sourcePath: photo.sourcePath,
                            capturedAt: photo.capturedAt,
                            updatedAt: photo.updatedAt,
                            variants: new Set(['original-variant-hash']),
                            ...overrides,
                        },
                    };
                case 'Source-id-hash':
                    return {hash: 'source-hash', obj: {$type$: 'Source', id: sourceId}};
                case 'SourceEntry-id-hash':
                    return {
                        hash: 'source-entry-hash',
                        obj: {
                            $type$: 'SourceEntry',
                            id: sourceEntryId,
                            sourceId: 'Source-id-hash',
                            kind: 'file',
                            locator: photo.sourcePath || photo.name,
                            sourceRef: 'Source-id-hash',
                            contentHash: photo.hash,
                        },
                    };
                case 'FotosMediaLocator-id-hash':
                    return {
                        hash: 'original-locator-hash',
                        obj: {
                            $type$: 'FotosMediaLocator',
                            id: [
                                'fotos-locator',
                                'browser',
                                'relative-path',
                                'device-local',
                                'instance-id-hash',
                                encodeURIComponent('FotosMediaVariant-id-hash'),
                                encodeURIComponent(locatorValues[0]),
                            ].join(':'),
                            variant: 'FotosMediaVariant-id-hash',
                            platform: 'browser',
                            kind: 'relative-path',
                            scope: 'device-local',
                            locator: locatorValues[0],
                            deviceId: 'instance-id-hash',
                            lastVerifiedAt: photo.updatedAt ?? photo.addedAt ?? photo.capturedAt,
                        },
                    };
                case 'FotosDeviceBook-id-hash':
                    return {
                        hash: 'device-book-hash',
                        obj: {
                            $type$: 'FotosDeviceBook',
                            id: 'fotos-device-book:instance-id-hash',
                            deviceId: 'instance-id-hash',
                            title: 'Fotos Device Book (instance-id-hash)',
                            role: 'browser',
                            entries: new Set(['entry-hash']),
                            sourceIdHashes: new Set(['Source-id-hash']),
                            entryIdHashes: new Set(['SourceEntry-id-hash']),
                            variants: new Set(['original-variant-hash']),
                            ...(locatorValues.length > 0
                                ? {locators: new Set(['original-locator-hash'])}
                                : {}),
                            createdAt: 1,
                            updatedAt: 1,
                        },
                    };
                default: {
                    const error = new Error('not found');
                    error.name = 'FileNotFoundError';
                    throw error;
                }
            }
        });
        getObjectWithTypeMock.mockResolvedValue({
            $type$: 'FotosMediaVariant',
            contentHash: photo.hash,
            family: 'FotosEntry-id-hash',
            role: 'original',
            mime: photo.mimeType,
            byteSize: photo.size,
            blob: 'raw-original-blob-hash',
        });
        readMediaBookMock.mockResolvedValue({
            hash: 'media-book-hash',
            idHash: 'Book-id-hash',
            obj: {
                $type$: 'Book',
                sourceIdHashes: ['Source-id-hash'],
                entryIdHashes: ['SourceEntry-id-hash'],
                sourceRefs: ['Source-id-hash'],
                artifactIdHashes: [
                    'FotosEntry-id-hash',
                    'FotosMediaVariant-id-hash',
                    ...(locatorValues.length > 0 ? ['FotosMediaLocator-id-hash'] : []),
                ],
            },
        });
    }

    beforeEach(() => {
        storeVersionedObjectMock.mockClear();
        getObjectByIdHashMock.mockReset().mockImplementation(async () => {
            const error = new Error('not found');
            error.name = 'FileNotFoundError';
            throw error;
        });
        addEntryToManifestMock.mockClear();
        addAuthenticityAttestationToManifestMock.mockClear();
        resolveFotosAuthenticityContextMock.mockReset().mockResolvedValue({
            signerPersonId: 'person-1',
            signerPublicKey: 'public-key',
            signingSecretKey: new Uint8Array([1, 2, 3]),
            subscriptionCertificateHash: null,
        });
        createFotosAuthenticityAttestationMock.mockClear();
        calculateIdHashOfObjMock.mockReset().mockImplementation(async obj =>
            `${String(obj.$type$)}-id-hash`,
        );
        getInstanceIdHashMock.mockReset().mockReturnValue('instance-id-hash');
        getInstanceOwnerIdHashMock.mockReset().mockReturnValue('owner-hash');
        appendMediaBookContentMock.mockClear();
        readMediaBookMock.mockReset().mockResolvedValue(undefined);
        storeArrayBufferAsBlobMock.mockClear().mockResolvedValue({hash: 'original-blob-hash'});
        hashImageFileMock.mockClear().mockResolvedValue('photo-hash');
        getObjectWithTypeMock.mockReset();
        readFotosManifestSnapshotMock.mockReset().mockResolvedValue({
            entryHashes: [],
            resolvedAttestations: [],
        });
        existsMock.mockReset().mockResolvedValue(true);
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

    it('publishes current-device source and books when another device already published the global media', async () => {
        const photo = {
            hash: 'photo-hash',
            name: 'photo.jpg',
            sourcePath: 'remote:photo.jpg',
            mimeType: 'image/jpeg',
            size: 123,
            managed: 'metadata' as const,
            tags: [],
            capturedAt: '2026-09-11T00:00:00.000Z',
            updatedAt: '2026-09-11T00:00:01.000Z',
            addedAt: '2026-09-11T00:00:02.000Z',
        };
        mockPersistedPhoto(photo);
        getObjectByIdHashMock.mockImplementation(async idHash => {
            if (idHash === 'FotosEntry-id-hash') {
                return {
                    hash: 'entry-hash',
                    obj: {
                        $type$: 'FotosEntry',
                        contentHash: photo.hash,
                        streamId: photo.hash,
                        mime: photo.mimeType,
                        size: photo.size,
                        sourcePath: photo.sourcePath,
                        capturedAt: photo.capturedAt,
                        updatedAt: photo.updatedAt,
                        variants: new Set(['original-variant-hash']),
                    },
                };
            }
            const error = new Error('not found');
            error.name = 'FileNotFoundError';
            throw error;
        });
        readMediaBookMock.mockResolvedValue(undefined);

        await syncPhotosToOneCore([photo], null, {claimAuthorship: false});

        // Missing device books make the photo dirty before any per-photo reads;
        // publication then reuses the other device's verified original BLOB.
        expect(getObjectWithTypeMock).toHaveBeenCalledWith('original-variant-hash', 'FotosMediaVariant');
        expect(existsMock).toHaveBeenCalledWith('raw-original-blob-hash');
        expect(storeVersionedObjectMock.mock.calls
            .map(([object]) => object)
            .find(object => object.$type$ === 'FotosMediaVariant' && object.role === 'original'))
            .toMatchObject({blob: 'raw-original-blob-hash'});
        expect(storeVersionedObjectMock).toHaveBeenCalled();
        expect(appendMediaBookContentMock).toHaveBeenCalledOnce();
        expect(addEntryToManifestMock).toHaveBeenCalledWith('FotosEntry-hash');
    });

    it('skips media only when the current device source and both books are complete', async () => {
        const photo = {
            hash: 'photo-hash', name: 'photo.jpg', sourcePath: 'remote:photo.jpg',
            mimeType: 'image/jpeg', size: 123, managed: 'metadata' as const,
            tags: [], addedAt: '2026-09-11T00:00:00.000Z',
        };
        mockPersistedPhoto(photo);

        await syncPhotosToOneCore([photo], null, {claimAuthorship: false});

        expect(storeVersionedObjectMock).not.toHaveBeenCalled();
        expect(appendMediaBookContentMock).not.toHaveBeenCalled();
        expect(addEntryToManifestMock).not.toHaveBeenCalled();
    });

    it('repairs an older interrupted publication with manifest membership but no media book record', async () => {
        const photo = {
            hash: 'photo-hash', name: 'photo.jpg', sourcePath: 'remote:photo.jpg',
            mimeType: 'image/jpeg', size: 123, managed: 'metadata' as const,
            tags: [], addedAt: '2026-09-11T00:00:00.000Z',
        };
        mockPersistedPhoto(photo);
        readMediaBookMock.mockResolvedValue(undefined);

        await syncPhotosToOneCore([photo], null, {claimAuthorship: false});

        expect(appendMediaBookContentMock).toHaveBeenCalledOnce();
        expect(addEntryToManifestMock).toHaveBeenCalledWith('FotosEntry-hash');
    });

    it('does not let another signer attestation suppress requested current-signer authorship', async () => {
        const photo = {
            hash: 'photo-hash',
            name: 'photo.jpg',
            sourcePath: 'remote:photo.jpg',
            mimeType: 'image/jpeg',
            size: 123,
            managed: 'metadata' as const,
            tags: [],
            capturedAt: '2026-09-11T00:00:00.000Z',
            updatedAt: '2026-09-11T00:00:01.000Z',
            addedAt: '2026-09-11T00:00:02.000Z',
        };
        mockPersistedPhoto(photo);
        readFotosManifestSnapshotMock.mockResolvedValue({
            entryHashes: ['entry-hash'],
            resolvedAttestations: [{
                attestationHash: 'other-attestation-hash',
                contentHash: photo.hash,
                signerPersonId: 'other-person',
            }],
        });
        const readPersisted = getObjectByIdHashMock.getMockImplementation()!;
        getObjectByIdHashMock.mockImplementation(async idHash => {
            const stored = await readPersisted(idHash);
            if (idHash === 'FotosDeviceBook-id-hash') {
                stored.obj.authenticityAttestations = new Set(['other-attestation-hash']);
            }
            return stored;
        });

        await syncPhotosToOneCore([photo], null, {
            claimAuthorship: true,
            requireOriginalBlob: true,
        });

        expect(createFotosAuthenticityAttestationMock).toHaveBeenCalledWith(photo.hash, expect.any(Object));
        expect(addAuthenticityAttestationToManifestMock).toHaveBeenCalledOnce();
    });

    it('rebuilds an entry whose original BLOB is no longer available', async () => {
        const photo = {
            hash: 'photo-hash', name: 'photo.jpg', sourcePath: 'photo.jpg',
            mimeType: 'image/jpeg', size: 123, managed: 'metadata' as const,
            tags: [], addedAt: '2026-09-11T00:00:00.000Z',
        };
        mockPersistedPhoto(photo);
        existsMock.mockResolvedValue(false);
        const file = {
            size: 123,
            arrayBuffer: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer),
        } as unknown as File;
        const rootHandle = {
            getFileHandle: vi.fn(async () => ({getFile: vi.fn(async () => file)})),
        } as unknown as FileSystemDirectoryHandle;

        await syncPhotosToOneCore([photo], rootHandle, {
            claimAuthorship: false,
            requireOriginalBlob: true,
        });

        expect(storeVersionedObjectMock).toHaveBeenCalled();
        expect(addEntryToManifestMock).toHaveBeenCalledOnce();
    });

    it('propagates operational storage errors while checking durable media', async () => {
        const photo = {
            hash: 'photo-hash', name: 'photo.jpg', sourcePath: 'remote:photo.jpg',
            mimeType: 'image/jpeg', size: 123, managed: 'metadata' as const,
            tags: [], addedAt: '2026-09-11T00:00:00.000Z',
        };
        mockPersistedPhoto(photo);
        getObjectWithTypeMock.mockRejectedValue(new Error('indexeddb unavailable'));

        await expect(syncPhotosToOneCore([photo], null, {claimAuthorship: false}))
            .rejects.toThrow('indexeddb unavailable');
        expect(storeVersionedObjectMock).not.toHaveBeenCalled();
    });

    it('rebuilds an entry when its persisted thumbnail bytes no longer match', async () => {
        const photo = {
            hash: 'photo-hash', name: 'photo.jpg', sourcePath: 'photo.jpg', thumb: 'thumb.jpg',
            mimeType: 'image/jpeg', size: 123, managed: 'metadata' as const,
            tags: [], addedAt: '2026-09-11T00:00:00.000Z',
        };
        mockPersistedPhoto(photo, {thumb: 'old-thumb-blob-hash'});
        const file = {
            size: 123,
            arrayBuffer: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer),
        } as unknown as File;
        const rootHandle = {
            getFileHandle: vi.fn(async () => ({getFile: vi.fn(async () => file)})),
            getDirectoryHandle: vi.fn(),
        } as unknown as FileSystemDirectoryHandle;
        storeArrayBufferAsBlobMock.mockResolvedValue({hash: 'new-thumb-blob-hash'});

        await syncPhotosToOneCore([photo], rootHandle, {
            claimAuthorship: false,
            requireOriginalBlob: true,
        });

        expect(storeVersionedObjectMock).toHaveBeenCalled();
        expect(addEntryToManifestMock).toHaveBeenCalledOnce();
    });

    it('keeps a photo with an unreadable thumbnail complete instead of republishing it every batch', async () => {
        const photo = {
            hash: 'photo-hash', name: 'photo.jpg', sourcePath: 'remote:photo.jpg', thumb: 'thumbs/missing.jpg',
            mimeType: 'image/jpeg', size: 123, managed: 'metadata' as const,
            tags: [], addedAt: '2026-09-11T00:00:00.000Z',
        };
        // The earlier publication could not read the thumbnail either, so it has none.
        mockPersistedPhoto(photo);
        const unreadable = new Error('thumbnail missing');
        unreadable.name = 'NotFoundError';
        const rootHandle = {
            getFileHandle: vi.fn(async () => { throw unreadable; }),
            getDirectoryHandle: vi.fn(async () => { throw unreadable; }),
        } as unknown as FileSystemDirectoryHandle;

        await syncPhotosToOneCore([photo], rootHandle, {claimAuthorship: false});

        expect(storeVersionedObjectMock).not.toHaveBeenCalled();
        expect(addEntryToManifestMock).not.toHaveBeenCalled();
    });

    it('reads this device\'s publication books once per batch', async () => {
        const photo = {
            hash: 'photo-hash', name: 'photo.jpg', sourcePath: 'remote:photo.jpg',
            mimeType: 'image/jpeg', size: 123, managed: 'metadata' as const,
            tags: [], addedAt: '2026-09-11T00:00:00.000Z',
        };
        mockPersistedPhoto(photo);

        await syncPhotosToOneCore([photo, {...photo}, {...photo}], null, {claimAuthorship: false});

        expect(storeVersionedObjectMock).not.toHaveBeenCalled();
        expect(readMediaBookMock).toHaveBeenCalledOnce();
        expect(getObjectByIdHashMock.mock.calls
            .filter(([idHash]) => idHash === 'FotosDeviceBook-id-hash')).toHaveLength(1);
    });

    it('rebuilds a persisted entry when source media identity changes', async () => {
        readFotosManifestSnapshotMock.mockResolvedValue({
            entryHashes: ['old-entry-hash'],
            resolvedAttestations: [],
        });

        await syncPhotosToOneCore([{
            hash: 'new-photo-hash',
            name: 'photo.jpg',
            sourcePath: 'photo.jpg',
            size: 456,
            managed: 'metadata',
            tags: [],
            addedAt: '2026-09-11T00:00:00.000Z',
        }], null, {claimAuthorship: false});

        expect(storeVersionedObjectMock).toHaveBeenCalled();
        expect(addEntryToManifestMock).toHaveBeenCalledOnce();
    });

    it('leaves a failed publication dirty so a later call retries it', async () => {
        const photo = {
            hash: 'photo-hash',
            name: 'photo.jpg',
            sourcePath: 'remote:photo.jpg',
            size: 123,
            managed: 'metadata' as const,
            tags: [],
            addedAt: '2026-09-11T00:00:00.000Z',
        };
        appendMediaBookContentMock.mockRejectedValueOnce(new Error('media book failed'));

        await expect(syncPhotosToOneCore([photo], null, {
            claimAuthorship: false,
            requireOriginalBlob: true,
        })).rejects.toThrow('media book failed');
        expect(addEntryToManifestMock).not.toHaveBeenCalled();

        await expect(syncPhotosToOneCore([photo], null, {
            claimAuthorship: false,
            requireOriginalBlob: true,
        })).resolves.toBeUndefined();
        expect(appendMediaBookContentMock).toHaveBeenCalledTimes(2);
        expect(addEntryToManifestMock).toHaveBeenCalledOnce();
    });

    it('serializes overlapping batches and rechecks persistence in call order', async () => {
        let releaseFirst!: () => void;
        const firstHeld = new Promise<void>(resolve => { releaseFirst = resolve; });
        const starts: string[] = [];
        storeVersionedObjectMock.mockImplementation(async (obj: Record<string, unknown>) => {
            if (obj.$type$ === 'FotosMediaVariant' && obj.role === 'original') {
                starts.push(String(obj.contentHash));
                if (obj.contentHash === 'first-hash') await firstHeld;
            }
            return {
                hash: `${String(obj.$type$)}-${String(obj.contentHash ?? 'hash')}`,
                idHash: `${String(obj.$type$)}-id-hash`,
                status: 'stored',
            };
        });
        const makePhoto = (hash: string) => ({
            hash,
            name: `${hash}.jpg`,
            size: 123,
            managed: 'metadata' as const,
            tags: [],
            addedAt: '2026-09-11T00:00:00.000Z',
        });

        const first = syncPhotosToOneCore([makePhoto('first-hash')], null, {claimAuthorship: false});
        const second = syncPhotosToOneCore([makePhoto('second-hash')], null, {claimAuthorship: false});
        await vi.waitFor(() => expect(starts).toEqual(['first-hash']));
        releaseFirst();

        await Promise.all([first, second]);
        expect(starts).toEqual(['first-hash', 'second-hash']);
        expect(readFotosManifestSnapshotMock).toHaveBeenCalledTimes(2);
    });
});
