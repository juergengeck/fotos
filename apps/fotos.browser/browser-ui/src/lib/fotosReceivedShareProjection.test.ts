import {describe, expect, it, vi} from 'vitest';
import {
    createActiveFotosShareCertificate,
    createFotosShareCertificateChain,
    createFotosShareManifest,
    createRevokedFotosShareCertificate,
} from '@refinio/fotos.core';
import {
    projectReceivedFotosShares,
    type ReceivedFotosShareProjectionDeps,
} from '@refinio/fotos.core/received-shares';

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
    const chains = new Map([
        ['active-chain-hash', createFotosShareCertificateChain({
            issuer,
            subject,
            scope,
            certificate: 'active-hash' as any,
            signature: 'active-signature' as any,
        })],
        ['revoked-chain-hash', createFotosShareCertificateChain({
            issuer,
            subject,
            scope,
            certificate: 'revoked-hash' as any,
            signature: 'revoked-signature' as any,
        })],
    ]);
    return {
        listLatestCertificateChains: vi.fn(async () => [
            {hash: 'active-chain-hash', idHash: 'stable-chain-id', timestamp: 1},
            {hash: 'revoked-chain-hash', idHash: 'stable-chain-id', timestamp: 2},
        ]),
        getCertificateChain: vi.fn(async hash => chains.get(hash)!),
        getCertificate: vi.fn(async hash => certificates.get(hash)!),
        getEntry: vi.fn(async hash => ({$type$: 'FotosEntry', contentHash: `content-${hash}`, thumb: `thumb-${hash}`} as any)),
        getManifest: vi.fn(async () => {
            if (options?.missingManifest) throw new Error('missing');
            return createFotosShareManifest({issuer, scope, entries: ['entry-a', 'entry-b'] as any});
        }),
        certificateIdHash: vi.fn(async () => 'stable-id'),
        getCertificateSignature: vi.fn(async hash => ({
            $type$: 'Signature',
            data: hash === 'active-signature' ? 'active-hash' : 'revoked-hash',
            issuer,
            valid: !options?.badSignature,
        })),
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
        deps.listLatestCertificateChains = vi.fn(async () => [
            {hash: 'active-chain-hash', idHash: 'stable-chain-id', timestamp: 1},
        ]);
        const projection = await projectReceivedFotosShares(
            subject,
            async signature => (signature as {valid: boolean}).valid,
            deps,
        );
        expect(projection[0]).toMatchObject({status: 'active', verified: true, photoCount: 2});
        expect(projection[0]?.entries.map(entry => entry.contentHash)).toEqual(['content-entry-a', 'content-entry-b']);
        expect(deps.getEntry).toHaveBeenCalledTimes(2);
    });

    it('can restore entries from stored manifest references without an import event', async () => {
        const deps = depsFor();
        deps.listLatestCertificateChains = vi.fn(async () => [
            {hash: 'active-chain-hash', idHash: 'stable-chain-id', timestamp: 1},
        ]);
        const before = await projectReceivedFotosShares(subject, async () => true, deps);
        const reopened = await projectReceivedFotosShares(subject, async () => true, deps);
        expect(reopened[0]?.entries).toEqual(before[0]?.entries);
        expect(reopened[0]?.entries).toHaveLength(2);
    });

    it('never loads photo content through an unverified certificate', async () => {
        const deps = depsFor();
        await projectReceivedFotosShares(subject, async () => false, deps);
        expect(deps.getManifest).not.toHaveBeenCalled();
        expect(deps.getEntry).not.toHaveBeenCalled();
    });

    it('does not project outbound certificates indexed through the issuer reverse map', async () => {
        const outboundCertificate = createActiveFotosShareCertificate({
            issuer: subject,
            subject: 'other-recipient' as any,
            scope,
            issuedAt: '2026-08-01T11:00:00.000Z',
        });
        const deps = depsFor();
        const outbound = createFotosShareCertificateChain({
            issuer: subject,
            subject: 'other-recipient' as any,
            scope,
            certificate: 'outbound-certificate' as any,
            signature: 'outbound-signature' as any,
        });
        deps.listLatestCertificateChains = vi.fn(async () => [
            {hash: 'outbound-hash', idHash: 'outbound-id', timestamp: 3},
        ]);
        deps.getCertificateChain = vi.fn(async () => outbound);
        deps.getCertificate = vi.fn(async () => outboundCertificate);

        await expect(projectReceivedFotosShares(subject, async () => true, deps)).resolves.toEqual([]);
        expect(deps.getCertificateSignature).not.toHaveBeenCalled();
    });

    it('rejects a certificate whose scope does not match its transfer chain', async () => {
        const deps = depsFor();
        const otherScope = createActiveFotosShareCertificate({
            issuer,
            subject,
            scope: {kind: 'collection', id: 'winter'},
            issuedAt: '2026-08-03T10:00:00.000Z',
        });
        deps.listLatestCertificateChains = vi.fn(async () => [
            {hash: 'active-chain-hash', idHash: 'stable-chain-id', timestamp: 1},
        ]);
        deps.getCertificate = vi.fn(async () => otherScope);

        const projection = await projectReceivedFotosShares(subject, async () => true, deps);

        expect(projection).toHaveLength(1);
        expect(projection[0]).toMatchObject({status: 'invalid', verified: false, entries: []});
        expect(projection[0]?.invalidReason).toBe('Certificate identity binding is invalid');
        expect(deps.getCertificateSignature).not.toHaveBeenCalled();
        expect(deps.getManifest).not.toHaveBeenCalled();
    });

    it('rejects a revocation without its recorded time and reason', async () => {
        const deps = depsFor();
        const {revokedAt: _revokedAt, ...incomplete} = revoked;
        deps.listLatestCertificateChains = vi.fn(async () => [
            {hash: 'revoked-chain-hash', idHash: 'stable-chain-id', timestamp: 2},
        ]);
        deps.getCertificate = vi.fn(async () => incomplete as typeof revoked);

        const projection = await projectReceivedFotosShares(subject, async () => true, deps);

        expect(projection[0]).toMatchObject({status: 'invalid', verified: false});
        expect(projection[0]?.invalidReason).toBe('Revocation lifecycle fields are incomplete');
    });

    it('does not expose entries when an active scope manifest is unavailable', async () => {
        const deps = depsFor({missingManifest: true});
        deps.listLatestCertificateChains = vi.fn(async () => [
            {hash: 'active-chain-hash', idHash: 'stable-chain-id', timestamp: 1},
        ]);

        const projection = await projectReceivedFotosShares(subject, async () => true, deps);

        expect(projection[0]).toMatchObject({status: 'invalid', entries: [], photoCount: null});
        expect(projection[0]?.invalidReason).toBe('Active share manifest is unavailable');
        expect(deps.getEntry).not.toHaveBeenCalled();
    });
});
