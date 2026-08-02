import { describe, expect, it } from 'vitest';
import type { TrustLevel } from '@refinio/trust.core/types/trust-types.js';

import {
    canImportFotosAuthenticityAttestation,
    canImportFotosDeviceBook,
    canImportFotosEntry,
    canImportFotosManifest,
    canImportFotosShareCertificate,
    canImportFotosShareCertificateChain,
    canImportFotosShareManifest,
    canImportFotosMediaLocator,
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

    it('admits fotos media locators with bounded metadata', () => {
        expect(canImportFotosMediaLocator(LOW_TRUST_CONTEXT, {
            $type$: 'FotosMediaLocator',
            id: 'locator:variant:browser:path',
            variant: 'variant-id-hash',
            platform: 'browser',
            kind: 'relative-path',
            scope: 'device-local',
            locator: 'holiday/rose.jpg',
            deviceId: 'browser-device',
            lastVerifiedAt: '2024-10-30T09:10:11.000Z',
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

    it('admits device books that enumerate shareable Fotos objects for a device root', () => {
        expect(canImportFotosDeviceBook(LOW_TRUST_CONTEXT, {
            $type$: 'FotosDeviceBook',
            id: 'fotos-device-book:spark',
            deviceId: 'spark',
            title: 'Fotos Device Book (spark)',
            role: 'compute',
            entries: new Set(['entry-a', 'entry-b']),
            sourceIdHashes: new Set(['source-a']),
            entryIdHashes: new Set(['source-entry-a']),
            variants: new Set(['variant-a']),
            locators: new Set(['locator-a']),
            authenticityAttestations: new Set(['attestation-a']),
            createdAt: 10,
            updatedAt: 20,
        })).toBe(true);
    });

    it('admits structurally valid fotos entries from explicitly granted ad hoc peers', () => {
        expect(canImportFotosEntry({
            peerTrustLevel: 'unknown' as TrustLevel,
        }, {
            $type$: 'FotosEntry',
            contentHash: 'photo-hash',
            streamId: 'photo-hash',
            mime: 'image/jpeg',
            size: 1,
        })).toBe(true);
    });

    it('rejects fotos entries from ignored peers', () => {
        expect(canImportFotosEntry({
            peerTrustLevel: 'ignore' as TrustLevel,
        }, {
            $type$: 'FotosEntry',
            contentHash: 'photo-hash',
            streamId: 'photo-hash',
            mime: 'image/jpeg',
            size: 1,
        })).toBe(false);
    });

    it('admits Fotos id objects that CHUM fetches before full versioned objects', () => {
        expect(canImportFotosManifest(LOW_TRUST_CONTEXT, {
            $type$: 'FotosManifest',
            id: 'fotos',
        })).toBe(true);
        expect(canImportFotosEntry(LOW_TRUST_CONTEXT, {
            $type$: 'FotosEntry',
            contentHash: 'photo-hash',
        })).toBe(true);
        expect(canImportFotosMediaVariant(LOW_TRUST_CONTEXT, {
            $type$: 'FotosMediaVariant',
            contentHash: 'variant-hash',
        })).toBe(true);
        expect(canImportFotosMediaLocator(LOW_TRUST_CONTEXT, {
            $type$: 'FotosMediaLocator',
            id: 'locator-id',
        })).toBe(true);
        expect(canImportFotosAuthenticityAttestation(LOW_TRUST_CONTEXT, {
            $type$: 'FotosAuthenticityAttestation',
            id: 'fotos-authenticity-v1:person-1:photo-hash',
        })).toBe(true);
        expect(canImportFotosDeviceBook(LOW_TRUST_CONTEXT, {
            $type$: 'FotosDeviceBook',
            id: 'fotos-device-book:spark',
        })).toBe(true);
    });

    it('does not treat partial full fotos objects as id objects', () => {
        expect(canImportFotosEntry(LOW_TRUST_CONTEXT, {
            $type$: 'FotosEntry',
            contentHash: 'photo-hash',
            size: 1,
        })).toBe(false);
        expect(canImportFotosManifest(LOW_TRUST_CONTEXT, {
            $type$: 'FotosManifest',
            id: 'fotos',
            authenticityAttestations: new Set(['attestation-a']),
        })).toBe(false);
    });

    it('accepts consistent share lifecycle objects and rejects malformed revocations', () => {
        expect(canImportFotosShareManifest(LOW_TRUST_CONTEXT, {
            $type$: 'FotosShareManifest',
            id: 'fotos-share-manifest:v1:issuer:collection:summer',
            issuer: 'issuer',
            scopeKind: 'collection',
            scopeId: 'summer',
            entries: new Set(['entry-hash']),
            snapshotObjects: new Set(['entry-hash']),
            snapshotIds: new Set(['issuer']),
            snapshotOrder: ['object:entry-hash', 'id:issuer'],
        })).toBe(true);
        expect(canImportFotosShareCertificate(LOW_TRUST_CONTEXT, {
            $type$: 'FotosShareCertificate',
            $version$: 'v1',
            id: 'fotos-share-certificate:v1:issuer:anna:collection:summer',
            issuer: 'issuer',
            subject: 'anna',
            scopeKind: 'collection',
            scopeId: 'summer',
            status: 'revoked',
            issuedAt: '2026-08-02T11:00:00.000Z',
            revokedAt: '2026-08-02T11:00:00.000Z',
            revocationReason: 'Recipient removed',
        })).toBe(true);
        expect(canImportFotosShareCertificate(LOW_TRUST_CONTEXT, {
            $type$: 'FotosShareCertificate',
            $version$: 'v1',
            id: 'fotos-share-certificate:v1:issuer:anna:collection:summer',
            issuer: 'issuer',
            subject: 'anna',
            scopeKind: 'collection',
            scopeId: 'summer',
            status: 'revoked',
            issuedAt: '2026-08-02T11:00:00.000Z',
        })).toBe(false);
        expect(canImportFotosShareCertificateChain(LOW_TRUST_CONTEXT, {
            $type$: 'FotosShareCertificateChain',
            $version$: 'v1',
            id: 'fotos-share-certificate-chain:v1:issuer:anna:collection:summer',
            issuer: 'issuer',
            subject: 'anna',
            scopeKind: 'collection',
            scopeId: 'summer',
            certificate: 'certificate-hash',
            signature: 'signature-hash',
        })).toBe(true);
        expect(canImportFotosShareCertificate(LOW_TRUST_CONTEXT, {
            $type$: 'FotosShareCertificate',
            $version$: 'v1',
            id: 'fotos-share-certificate:v1:different:anna:collection:summer',
            issuer: 'issuer',
            subject: 'anna',
            scopeKind: 'collection',
            scopeId: 'summer',
            status: 'active',
            issuedAt: '2026-08-02T11:00:00.000Z',
        })).toBe(false);
    });

    it('extends the shared content rules with fotos-specific types', () => {
        expect(fotosContentRules.has('GlueShareManifest')).toBe(true);
        expect(fotosContentRules.has('FotosManifest')).toBe(true);
        expect(fotosContentRules.has('FotosEntry')).toBe(true);
        expect(fotosContentRules.has('FotosShareManifest')).toBe(true);
        expect(fotosContentRules.has('FotosShareCertificate')).toBe(true);
        expect(fotosContentRules.has('FotosShareCertificateChain')).toBe(true);
        expect(fotosContentRules.has('FotosMediaVariant')).toBe(true);
        expect(fotosContentRules.has('FotosMediaLocator')).toBe(true);
        expect(fotosContentRules.has('FotosAuthenticityAttestation')).toBe(true);
        expect(fotosContentRules.has('FotosDeviceBook')).toBe(true);
    });
});
