import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    storeVersionedObjectMock,
    addEntryToManifestMock,
    addAuthenticityAttestationToManifestMock,
    resolveFotosAuthenticityContextMock,
    createFotosAuthenticityAttestationMock,
    calculateIdHashOfObjMock,
    getInstanceIdHashMock,
    getInstanceOwnerIdHashMock,
} = vi.hoisted(() => ({
    storeVersionedObjectMock: vi.fn(async (obj: Record<string, unknown>) => ({
        hash: `${String(obj.$type$)}-hash`,
        idHash: `${String(obj.$type$)}-id-hash`,
        status: 'stored',
    })),
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
}));

vi.mock('@refinio/one.core/lib/storage-versioned-objects.js', () => ({
    storeVersionedObject: storeVersionedObjectMock,
    onVersionedObj: {
        addListener: vi.fn(() => () => undefined),
    },
}));

vi.mock('@refinio/one.core/lib/storage-blob.js', () => ({
    storeArrayBufferAsBlob: vi.fn(),
    readBlobAsArrayBuffer: vi.fn(),
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

vi.mock('./fotos-authenticity.js', () => ({
    resolveFotosAuthenticityContext: resolveFotosAuthenticityContextMock,
    createFotosAuthenticityAttestation: createFotosAuthenticityAttestationMock,
}));

import { shouldClaimFotosAuthorship, syncPhotosToOneCore } from './fotos-sync.js';

describe('fotos sync authorship toggle', () => {
    beforeEach(() => {
        storeVersionedObjectMock.mockClear();
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
    });

    it('claims authorship by default', () => {
        expect(shouldClaimFotosAuthorship()).toBe(true);
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
        expect(storeVersionedObjectMock).toHaveBeenCalledTimes(2);
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
        expect(storeVersionedObjectMock).toHaveBeenCalledTimes(3);
    });
});
