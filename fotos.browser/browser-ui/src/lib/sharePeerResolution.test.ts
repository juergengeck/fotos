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
    it('prefers persistent glue contacts for plain names without an @', () => {
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

        expect(resolveTokenToPersonId('alice', peers)).toBe('person-contact');
    });

    it('resolves explicit glue handles against persistent contacts', () => {
        const peers: SharePeerOption[] = [
            createPeer({
                personId: 'person-contact',
                displayName: 'Alice',
                persistent: true,
            }),
        ];

        expect(resolveTokenToPersonId('@alice', peers)).toBe('person-contact');
        expect(resolveTokenToPersonId('alice@glue.one', peers)).toBe('person-contact');
    });

    it('still accepts direct person id input', () => {
        const peers: SharePeerOption[] = [
            createPeer({
                personId: '0123456789abcdef0123456789abcdef',
                displayName: 'Alice',
                persistent: true,
            }),
        ];

        expect(resolveTokenToPersonId('0123456789abcdef0123456789abcdef', peers)).toBe(
            '0123456789abcdef0123456789abcdef',
        );
    });
});
