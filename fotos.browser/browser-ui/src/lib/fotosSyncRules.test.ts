import { describe, expect, it } from 'vitest';
import type { TrustLevel } from '@refinio/trust.core/types/trust-types.js';

import {
    canImportFotosAuthenticityAttestation,
    canImportFotosEntry,
    canImportFotosManifest,
    canImportFotosMediaVariant,
    fotosContentRules,
} from './fotosSyncRules.js';

const LOW_TRUST_CONTEXT = {
    peerTrustLevel: 'low' as TrustLevel,
};

describe('fotosSyncRules', () => {
    it('admits the fotos manifest singleton for low-trust peers', () => {
        expect(canImportFotosManifest(LOW_TRUST_CONTEXT, {
            $type$: 'FotosManifest',
            id: 'fotos',
            entries: new Set(['entry-a', 'entry-b']),
            authenticityAttestations: new Set(['attestation-a']),
        })).toBe(true);
    });

    it('rejects fotos manifests with the wrong singleton id', () => {
        expect(canImportFotosManifest(LOW_TRUST_CONTEXT, {
            $type$: 'FotosManifest',
            id: 'not-fotos',
            entries: new Set(['entry-a']),
        })).toBe(false);
    });

    it('admits fotos entries with photo metadata and blob references', () => {
        expect(canImportFotosEntry(LOW_TRUST_CONTEXT, {
            $type$: 'FotosEntry',
            contentHash: 'photo-hash',
            streamId: 'photo-hash',
            mime: 'image/jpeg',
            size: 1_048_576,
            capturedAt: '2024-10-30T09:10:11.000Z',
            updatedAt: '2024-10-30T09:10:11.000Z',
            sourcePath: 'vacation/rose-detail.png',
            folderPath: 'vacation',
            exifDate: '2024:10:30 09:10:11',
            exifCamera: 'Pixel',
            exifLens: 'Wide',
            exifFocalLength: '24mm',
            exifAperture: 'f/1.8',
            exifShutter: '1/250',
            exifIso: 100,
            exifGpsLat: 52.52,
            exifGpsLon: 13.405,
            exifWidth: 3024,
            exifHeight: 4032,
            thumb: 'thumb-hash',
            variants: new Set(['variant-a', 'variant-b']),
            faceCount: 2,
            faceEmbeddings: 'embedding-hash',
            faceCrops: 'crops-hash',
        })).toBe(true);
    });

    it('admits fotos media variants with bounded metadata and derivative references', () => {
        expect(canImportFotosMediaVariant(LOW_TRUST_CONTEXT, {
            $type$: 'FotosMediaVariant',
            contentHash: 'variant-hash',
            family: 'entry-id-hash',
            role: 'thumbnail',
            mime: 'image/jpeg',
            byteSize: 12_345,
            width: 640,
            height: 480,
            blob: 'thumb-blob-hash',
            derivedFrom: 'original-variant-id-hash',
            createdAt: '2024-10-30T09:10:11.000Z',
            label: 'thumb',
        })).toBe(true);
    });

    it('admits fotos authenticity attestations that carry a detached signature and optional cert reference', () => {
        expect(canImportFotosAuthenticityAttestation(LOW_TRUST_CONTEXT, {
            $type$: 'FotosAuthenticityAttestation',
            id: 'fotos-authenticity-v1:person-1:photo-hash',
            contentHash: 'photo-hash',
            signer: 'person-1',
            signerPublicKey: 'abcd1234',
            signatureScheme: 'fotos-authenticity-v1',
            signature: 'deadbeef',
            subscriptionCertificate: 'cert-hash',
        })).toBe(true);
    });

    it('rejects fotos entries from peers below the content trust floor', () => {
        expect(canImportFotosEntry({
            peerTrustLevel: 'unknown' as TrustLevel,
        }, {
            $type$: 'FotosEntry',
            contentHash: 'photo-hash',
            streamId: 'photo-hash',
            mime: 'image/jpeg',
            size: 1,
        })).toBe(false);
    });

    it('extends the shared content rules with fotos-specific types', () => {
        expect(fotosContentRules.has('GlueShareManifest')).toBe(true);
        expect(fotosContentRules.has('FotosManifest')).toBe(true);
        expect(fotosContentRules.has('FotosEntry')).toBe(true);
        expect(fotosContentRules.has('FotosMediaVariant')).toBe(true);
        expect(fotosContentRules.has('FotosAuthenticityAttestation')).toBe(true);
    });
});
