import { describe, expect, it } from 'vitest';

import type { SharePeerOption } from '@/components/ShareWithField';

import { resolveShareGrantPersonIds } from './shareGrantTargets.js';

function createPeer(overrides: Partial<SharePeerOption> & Pick<SharePeerOption, 'personId'>): SharePeerOption {
    return {
        personId: overrides.personId,
        displayName: overrides.displayName ?? null,
        glueIdentity: overrides.glueIdentity ?? null,
        online: overrides.online ?? false,
        hasVerifiedIdentity: overrides.hasVerifiedIdentity ?? false,
        persistent: overrides.persistent ?? false,
    };
}

describe('resolveShareGrantPersonIds', () => {
    it('grants both the live publication peer and the persistent owner contact for the same glue identity', () => {
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

        expect(resolveShareGrantPersonIds('publication-peer-person', peers)).toEqual([
            'publication-peer-person',
            'owner-contact-person',
        ]);
    });

    it('falls back to the selected person id when there is no matching related peer', () => {
        const peers: SharePeerOption[] = [
            createPeer({
                personId: 'publication-peer-person',
                displayName: 'Fotos Alice Example',
                online: true,
                hasVerifiedIdentity: true,
            }),
        ];

        expect(resolveShareGrantPersonIds('publication-peer-person', peers)).toEqual([
            'publication-peer-person',
        ]);
    });
});
