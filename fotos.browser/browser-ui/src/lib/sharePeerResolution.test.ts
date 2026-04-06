import '@refinio/one.core/lib/system/load-nodejs.js';
import { describe, expect, it } from 'vitest';

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

    it('derives a person id from an explicit glue identity when no peer is known yet', async () => {
        const fullIdentityPersonId = await resolveTokenToPersonId('fu@glue.one', []);
        const shorthandPersonId = await resolveTokenToPersonId('@fu', []);
        const bareNamePersonId = await resolveTokenToPersonId('fu', []);

        expect(fullIdentityPersonId).toMatch(/^[0-9a-f]{64}$/i);
        expect(shorthandPersonId).toBe(fullIdentityPersonId);
        expect(bareNamePersonId).toBe(fullIdentityPersonId);
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
});
