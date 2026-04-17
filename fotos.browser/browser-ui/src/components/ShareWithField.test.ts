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
    it('keeps quick-add contact tags collapsed by default', () => {
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

        expect(html).toContain('Show 2 contact tags');
        expect(html).not.toContain('Hide contact tags');
    });
});
