import '@refinio/one.core/lib/system/load-nodejs.js';
import { describe, expect, it, vi } from 'vitest';

import {
    resolveGlueIdentityForPeer,
    resolveTokenToPersonId,
    type SharePeerOption,
} from '@/components/ShareWithField';

function createPeer(overrides: Partial<SharePeerOption> & Pick<SharePeerOption, 'personId'>): SharePeerOption {
    return {
        personId: overrides.personId,
        displayName: overrides.displayName ?? null,
        online: overrides.online ?? false,
        hasVerifiedIdentity: overrides.hasVerifiedIdentity ?? false,
        persistent: overrides.persistent ?? false,
        glueIdentity: overrides.glueIdentity,
    };
}

describe('resolveGlueIdentityForPeer', () => {
    it('derives a glue identity from the peer display name', () => {
        expect(resolveGlueIdentityForPeer(createPeer({
            personId: 'person-alice',
            displayName: 'Alice Doe',
        }))).toBe('alicedoe@glue.one');
    });
});

describe('resolveTokenToPersonId', () => {
    it('prefers persistent glue contacts for plain names without an @', async () => {
        const peers: SharePeerOption[] = [
            createPeer({
                personId: 'person-online',
                displayName: 'Alice Archive',
                online: true,
            }),
            createPeer({
                personId: 'person-contact',
                displayName: 'Alice',
                persistent: true,
            }),
        ];

        await expect(resolveTokenToPersonId('alice', peers)).resolves.toBe('person-contact');
    });

    it('resolves explicit glue handles against persistent contacts', async () => {
        const peers: SharePeerOption[] = [
            createPeer({
                personId: 'person-contact',
                displayName: 'Alice',
                persistent: true,
            }),
        ];

        await expect(resolveTokenToPersonId('@alice', peers)).resolves.toBe('person-contact');
        await expect(resolveTokenToPersonId('alice@glue.one', peers)).resolves.toBe('person-contact');
    });

    it('resolves a human display name against a peer that only exposes a glue identity', async () => {
        const peers: SharePeerOption[] = [
            createPeer({
                personId: 'person-contact',
                displayName: null,
                glueIdentity: 'fotosbobf46536b6@glue.one',
                persistent: true,
            }),
        ];

        await expect(resolveTokenToPersonId('Fotos Bob f46536b6', peers)).resolves.toBe('person-contact');
    });

    it('prefers a live publication peer over a persistent owner contact for matching names', async () => {
        const peers: SharePeerOption[] = [
            createPeer({
                personId: 'owner-contact-person',
                displayName: 'Fotos Alice Example',
                glueIdentity: 'fotosaliceexample@glue.one',
                persistent: true,
            }),
            createPeer({
                personId: 'publication-peer-person',
                displayName: 'Fotos Alice Example',
                online: true,
                hasVerifiedIdentity: true,
            }),
        ];

        await expect(resolveTokenToPersonId('Fotos Alice Example', peers)).resolves.toBe(
            'publication-peer-person',
        );
        await expect(resolveTokenToPersonId('@fotosaliceexample', peers)).resolves.toBe(
            'publication-peer-person',
        );
    });

    it('resolves explicit glue identities via registration when no peer is known yet', async () => {
        const fetchImpl = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                success: true,
                data: {
                    cert: {
                        subject: 'registered-person-id',
                    },
                },
            }),
        });

        const fullIdentityPersonId = await resolveTokenToPersonId('fu@glue.one', [], { fetchImpl });
        const shorthandPersonId = await resolveTokenToPersonId('@fu', [], { fetchImpl });
        const bareNamePersonId = await resolveTokenToPersonId('fu', [], { fetchImpl });

        expect(fullIdentityPersonId).toBe('registered-person-id');
        expect(shorthandPersonId).toBe(fullIdentityPersonId);
        expect(bareNamePersonId).toBe(fullIdentityPersonId);
        expect(fetchImpl).toHaveBeenNthCalledWith(
            1,
            expect.stringContaining('/api/registration/cert/fu%40glue.one'),
        );
    });

    it('resolves a registered display name through the authoritative certificate lookup', async () => {
        const fetchImpl = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                success: true,
                data: {
                    cert: {
                        subject: 'registered-display-name-person',
                    },
                },
            }),
        });

        await expect(resolveTokenToPersonId('Fotos Alice Example', [], { fetchImpl })).resolves.toBe(
            'registered-display-name-person',
        );
        expect(fetchImpl).toHaveBeenCalledWith(
            expect.stringContaining('/api/registration/cert/fotosaliceexample%40glue.one'),
        );
    });

    it('returns null when an unknown registration name has no peer or certificate match', async () => {
        const fetchImpl = vi.fn().mockResolvedValue({
            ok: false,
            status: 404,
            json: async () => ({
                success: false,
            }),
        });

        await expect(resolveTokenToPersonId('unknown person', [], { fetchImpl })).resolves.toBeNull();
    });

    it('still accepts direct person id input', async () => {
        const peers: SharePeerOption[] = [
            createPeer({
                personId: '0123456789abcdef0123456789abcdef',
                displayName: 'Alice',
                persistent: true,
            }),
        ];

        await expect(resolveTokenToPersonId('0123456789abcdef0123456789abcdef', peers)).resolves.toBe(
            '0123456789abcdef0123456789abcdef',
        );
    });

    it('resolves short person id prefixes against known contacts', async () => {
        const peers: SharePeerOption[] = [
            createPeer({
                personId: '531a3e1b89abcdef0123456789abcdef',
                displayName: 'Contact 531a3e1b',
                persistent: true,
            }),
        ];

        await expect(resolveTokenToPersonId('531a3e1b', peers)).resolves.toBe(
            '531a3e1b89abcdef0123456789abcdef',
        );
    });

    it('does not derive glue identities from unresolved short hex prefixes', async () => {
        await expect(resolveTokenToPersonId('531a3e1b', [])).resolves.toBeNull();
    });

    it('still resolves contacts whose display names look like hex', async () => {
        const peers: SharePeerOption[] = [
            createPeer({
                personId: 'person-contact',
                displayName: '531a3e1b',
                persistent: true,
            }),
        ];

        await expect(resolveTokenToPersonId('531a3e1b', peers)).resolves.toBe('person-contact');
    });
});
