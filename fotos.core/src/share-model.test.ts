import {describe, expect, it} from 'vitest';
import {
    buildFotosShareCertificateId,
    createActiveFotosShareCertificate,
    createRevokedFotosShareCertificate,
    isActiveFotosShareCertificate,
} from './share-model.js';

const scope = {kind: 'collection' as const, id: 'summer-2026'};

describe('fotos share certificate lifecycle', () => {
    it('keeps one stable identity across active and revoked versions', () => {
        const active = createActiveFotosShareCertificate({
            issuer: 'issuer' as any,
            subject: 'recipient' as any,
            scope,
            issuedAt: '2026-08-02T10:00:00.000Z',
        });
        const revoked = createRevokedFotosShareCertificate({
            issuer: 'issuer' as any,
            subject: 'recipient' as any,
            scope,
            reason: 'Recipient removed',
            revokedAt: '2026-08-02T11:00:00.000Z',
        });

        expect(active.id).toBe(buildFotosShareCertificateId('issuer', 'recipient', scope));
        expect(revoked.id).toBe(active.id);
        expect(active.status).toBe('active');
        expect(revoked).toMatchObject({
            status: 'revoked',
            issuedAt: '2026-08-02T11:00:00.000Z',
            revokedAt: '2026-08-02T11:00:00.000Z',
            revocationReason: 'Recipient removed',
        });
        expect(isActiveFotosShareCertificate(active)).toBe(true);
        expect(isActiveFotosShareCertificate(revoked)).toBe(false);
    });

    it('uses independent identities for independent scopes', () => {
        const galleryId = buildFotosShareCertificateId('issuer', 'recipient', {kind: 'gallery', id: 'main'});
        const personId = buildFotosShareCertificateId('issuer', 'recipient', {kind: 'person', id: 'person-1'});
        expect(galleryId).not.toBe(personId);
    });
});
