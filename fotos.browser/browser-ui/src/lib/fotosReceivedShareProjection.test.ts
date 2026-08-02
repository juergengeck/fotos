import {describe, expect, it, vi} from 'vitest';
import {
    createActiveFotosShareCertificate,
    createFotosShareManifest,
    createRevokedFotosShareCertificate,
} from '@refinio/fotos.core';
import {
    projectReceivedFotosShares,
    type ReceivedFotosShareProjectionDeps,
} from './fotosReceivedShareProjection.js';

const issuer = 'issuer-person' as any;
const subject = 'recipient-person' as any;
const scope = {kind: 'collection' as const, id: 'summer'};
const active = createActiveFotosShareCertificate({issuer, subject, scope, issuedAt: '2026-08-01T10:00:00.000Z'});
const revoked = createRevokedFotosShareCertificate({issuer, subject, scope, reason: 'Recipient removed', revokedAt: '2026-08-02T10:00:00.000Z'});

function depsFor(options?: {badSignature?: boolean; missingManifest?: boolean}): ReceivedFotosShareProjectionDeps {
    const certificates = new Map([
        ['active-hash', active],
        ['revoked-hash', revoked],
    ]);
    return {
        listLatestCertificates: vi.fn(async () => [
            {hash: 'active-hash', idHash: 'stable-id', timestamp: 1},
            {hash: 'revoked-hash', idHash: 'stable-id', timestamp: 2},
        ]),
        getCertificate: vi.fn(async hash => certificates.get(hash)!),
        getManifest: vi.fn(async () => {
            if (options?.missingManifest) throw new Error('missing');
            return createFotosShareManifest({issuer, scope, entries: ['entry-a', 'entry-b'] as any});
        }),
        certificateIdHash: vi.fn(async () => 'stable-id'),
        getCertificateSignatures: vi.fn(async () => options?.badSignature ? [{valid: false}] : [{valid: true}]),
    };
}

describe('projectReceivedFotosShares', () => {
    it('keeps the causally newer revocation when an older active version arrives later', async () => {
        const projection = await projectReceivedFotosShares(
            subject,
            async signature => (signature as {valid: boolean}).valid,
            depsFor(),
        );
        expect(projection).toHaveLength(1);
        expect(projection[0]).toMatchObject({status: 'revoked', verified: true, revocationReason: 'Recipient removed'});
    });

    it('rejects a current certificate whose issuer signature is not trusted', async () => {
        const projection = await projectReceivedFotosShares(subject, async () => false, depsFor({badSignature: true}));
        expect(projection[0]).toMatchObject({status: 'invalid', verified: false});
        expect(projection[0]?.invalidReason).toContain('signature');
    });

    it('binds an active certificate to its current scope manifest and measured count', async () => {
        const deps = depsFor();
        deps.listLatestCertificates = vi.fn(async () => [
            {hash: 'active-hash', idHash: 'stable-id', timestamp: 1},
        ]);
        const projection = await projectReceivedFotosShares(
            subject,
            async signature => (signature as {valid: boolean}).valid,
            deps,
        );
        expect(projection[0]).toMatchObject({status: 'active', verified: true, photoCount: 2});
    });
});
