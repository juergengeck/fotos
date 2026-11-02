// @vitest-environment jsdom
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ReceiveInvitation} from './ReceiveInvitation';
import {encodeFotosShareInvitePayload, type FotosShareInvitePayload} from '@/lib/fotosShareInvite';

const camera = vi.hoisted(() => ({value: '', error: ''}));
vi.mock('@vger/vger.ui/components/ui/qr-scanner', () => ({
    QrScanner: ({active, onScan, onError}: {active: boolean; onScan: (value: string) => void; onError: (message: string) => void}) => active
        ? <button type="button" data-camera onClick={() => camera.error ? onError(camera.error) : onScan(camera.value)}>Read camera</button>
        : null,
}));

describe('ReceiveInvitation', () => {
    let container: HTMLDivElement;
    let root: Root;
    const pairing = {acceptPairingInvitation: vi.fn()};
    const onOpenGalleryInvitation = vi.fn();
    const render = async (active = true) => {
        await act(async () => root.render(<ReceiveInvitation active={active} pairing={pairing} onOpenGalleryInvitation={onOpenGalleryInvitation} />));
    };
    const click = async (text: string) => {
        const button = [...container.querySelectorAll('button')].find(item => item.textContent === text);
        expect(button, text).toBeDefined();
        await act(async () => button!.click());
    };
    const scan = async (value: string) => {
        camera.value = value;
        await click('Scan invitation QR code');
        await click('Read camera');
    };
    beforeEach(() => {
        (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
        vi.clearAllMocks();
        pairing.acceptPairingInvitation.mockResolvedValue({success: true});
        camera.value = ''; camera.error = '';
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        (globalThis as any).IS_REACT_ACT_ENVIRONMENT = false;
    });

    it('stops scanning and preserves the full pairing link until confirmation', async () => {
        const url = 'https://fotos.one/invites/inviteDevice#token=secret&publicKey=abc&mode=IoP';
        await render();
        await scan(url);
        expect(container.querySelector('[data-camera]')).toBeNull();
        expect(container.querySelector('input')?.value).toBe(url);
        expect(pairing.acceptPairingInvitation).not.toHaveBeenCalled();
        await click('Accept invitation');
        expect(pairing.acceptPairingInvitation).toHaveBeenCalledWith({invitationUrl: url});
        expect(container.querySelector('[role=status]')?.textContent).toContain('Invitation accepted');
    });

    it('opens gallery invitations in the PIN flow instead of pairing directly', async () => {
        const payload = {
            version: 1, kind: 'fotos-gallery-share', scope: 'gallery',
            pairingInvitation: {token: 'secret', publicKey: 'abc' as FotosShareInvitePayload['pairingInvitation']['publicKey'], url: 'wss://api.glue.one/comm'},
            senderPersonId: 'sender', galleryName: 'Family',
            createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(),
        } as const;
        const url = `https://fotos.one/?fotosShare=${encodeFotosShareInvitePayload(payload)}`;
        await render();
        await scan(url);
        expect(onOpenGalleryInvitation).not.toHaveBeenCalled();
        await click('Open gallery invitation');
        expect(onOpenGalleryInvitation).toHaveBeenCalledWith(url);
        expect(pairing.acceptPairingInvitation).not.toHaveBeenCalled();
    });

    it('shows camera errors and allows a fresh scan', async () => {
        await render();
        camera.error = 'Camera permission denied';
        await click('Scan invitation QR code');
        await click('Read camera');
        expect(container.querySelector('[role=alert]')?.textContent).toContain(camera.error);
        expect(container.querySelector('[data-camera]')).toBeNull();
        camera.error = '';
        await scan('https://fotos.one/invites/inviteDevice#token=secret');
        expect(container.querySelector('[role=alert]')).toBeNull();
    });

    it('stops the camera when the panel becomes hidden and keeps it stopped on reopening', async () => {
        await render();
        await click('Scan invitation QR code');
        expect(container.querySelector('[data-camera]')).not.toBeNull();
        await render(false);
        expect(container.querySelector('[data-camera]')).toBeNull();
        await render(true);
        expect(container.querySelector('[data-camera]')).toBeNull();
    });

    it('reports rejected invitations and retains their link for correction', async () => {
        pairing.acceptPairingInvitation.mockResolvedValue({success: false, error: 'Invitation expired'});
        await render();
        await scan('https://fotos.one/invites/inviteDevice#token=expired');
        await click('Accept invitation');
        expect(container.querySelector('[role=alert]')?.textContent).toBe('Invitation expired');
        expect(container.querySelector('input')?.value).toContain('token=expired');
    });
});
