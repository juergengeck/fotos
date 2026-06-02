import { describe, expect, it } from 'vitest';

import {
  FOTOS_SHARE_INVITE_PARAM,
  createFotosShareInvite,
  decodeFotosShareInvitePayload,
  encodeFotosShareInvitePayload,
  parseFotosShareInviteUrl,
  verifyFotosShareInvitePin,
} from './fotosShareInvite';

const pairingInvitation = {
  token: 'pair-token-1',
  publicKey: 'ab'.repeat(32),
  url: 'wss://api.glue.one/comm',
} as const;

describe('fotosShareInvite', () => {
  it('creates an invite URL without putting the PIN in the URL', async () => {
    const invite = await createFotosShareInvite({
      baseUrl: 'https://fotos.one/',
      pairingInvitation: pairingInvitation as any,
      senderPersonId: 'sender-person-id',
      galleryName: 'Family',
    });

    expect(invite.pin).toMatch(/^\d{4}$/);
    expect(invite.url).toContain(`${FOTOS_SHARE_INVITE_PARAM}=`);
    expect(invite.url).not.toContain('fotosAccount=new');
    expect(invite.url).not.toContain(invite.pin);
    await expect(verifyFotosShareInvitePin(invite.payload, invite.pin)).resolves.toBe(true);
    await expect(verifyFotosShareInvitePin(invite.payload, '0000')).resolves.toBe(invite.pin === '0000');
  });

  it('can opt into opening the invite under a new tab account', async () => {
    const invite = await createFotosShareInvite({
      baseUrl: 'https://fotos.one/',
      pairingInvitation: pairingInvitation as any,
      senderPersonId: 'sender-person-id',
      openInNewAccount: true,
    });

    expect(invite.url).toContain('fotosAccount=new');
  });

  it('round-trips encoded payloads', async () => {
    const invite = await createFotosShareInvite({
      baseUrl: 'https://fotos.one/app',
      pairingInvitation: pairingInvitation as any,
      senderPersonId: 'sender-person-id',
    });

    const encoded = encodeFotosShareInvitePayload(invite.payload);
    expect(decodeFotosShareInvitePayload(encoded)).toEqual(invite.payload);
    expect(parseFotosShareInviteUrl(invite.url)).toEqual(invite.payload);
  });

  it('rejects expired invites during PIN verification', async () => {
    const invite = await createFotosShareInvite({
      baseUrl: 'https://fotos.one/',
      pairingInvitation: pairingInvitation as any,
      senderPersonId: 'sender-person-id',
      expiresInMs: 1,
    });

    await expect(
      verifyFotosShareInvitePin(
        invite.payload,
        invite.pin,
        new Date(Date.parse(invite.payload.expiresAt) + 1),
      ),
    ).resolves.toBe(false);
  });
});
