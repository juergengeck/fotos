import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ShareWithField, type SharePeerOption } from './ShareWithField';

function createPeer(overrides: Partial<SharePeerOption> & Pick<SharePeerOption, 'personId'>): SharePeerOption {
    return {
        personId: overrides.personId,
        displayName: overrides.displayName ?? null,
        online: overrides.online ?? false,
        hasVerifiedIdentity: overrides.hasVerifiedIdentity ?? false,
        persistent: overrides.persistent ?? false,
        glueIdentity: overrides.glueIdentity ?? null,
    };
}

describe('ShareWithField', () => {
    it('presents trusted contacts before the identity escape hatch', () => {
        const html = renderToStaticMarkup(createElement(ShareWithField, {
            value: [],
            peers: [
                createPeer({
                    personId: 'person-authority',
                    displayName: 'Authority',
                }),
                createPeer({
                    personId: 'person-contact',
                    displayName: 'Contact 619bda35',
                }),
            ],
            onChange: vi.fn(),
        }));

        expect(html.indexOf('Authority')).toBeLessThan(html.indexOf('Invite by identity or ID'));
        expect(html).toContain('Identity not verified');
        expect(html).toContain('Offline');
    });
});
