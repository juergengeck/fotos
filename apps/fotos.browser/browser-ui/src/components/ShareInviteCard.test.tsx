// @vitest-environment jsdom

import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ShareInviteCard} from './ShareInviteCard.js';

vi.mock('qrcode', () => ({default: {toDataURL: vi.fn(async () => 'data:image/png;base64,qr')}}));

describe('ShareInviteCard', () => {
    let container: HTMLDivElement;
    let root: Root;
    beforeEach(() => {
        (globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        (globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = false;
    });

    it('exposes the required PIN, scope, copy, and revoke actions', async () => {
        const onRevoke = vi.fn();
        await act(async () => root.render(<ShareInviteCard invite={{
            url: 'https://fotos.one/?invite=abc',
            pin: '0427',
            sharedCount: 18,
            payload: {expiresAt: new Date(Date.now() + 86_400_000).toISOString()},
        }} onRevoke={onRevoke} />));

        expect(container.textContent).toContain('0427');
        expect(container.textContent).toContain('Gallery · 18 photos');
        expect(container.querySelector('img')?.getAttribute('alt')).toContain('QR code');
        expect(Array.from(container.querySelectorAll('button')).map(button => button.textContent)).toContain('Copy link');
        const revoke = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Revoke link');
        act(() => revoke?.click());
        expect(onRevoke).toHaveBeenCalledOnce();
    });
});
