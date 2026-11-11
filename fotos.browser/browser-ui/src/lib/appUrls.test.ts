import { describe, expect, it } from 'vitest';
import { isDeviceInvitationPath } from './appUrls';
import { faceClusterUrl } from './qrcode';

describe('app URLs', () => {
    it('recognizes device invitations inside the app mount', () => {
        expect(isDeviceInvitationPath('/app/invites/inviteDevice')).toBe(true);
        expect(isDeviceInvitationPath('/app/invites/inviteDevice/')).toBe(true);
        expect(isDeviceInvitationPath('/invites/inviteDevice')).toBe(false);
    });
    it('places face QR destinations inside the app', () => {
        expect(faceClusterUrl('face/1')).toBe('https://fotos.one/app/faces/face%2F1');
    });
});
