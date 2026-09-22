import { describe, expect, it } from 'vitest';

import {
  FOTOS_SHARE_INVITE_PARAM,
  createFotosShareInvite,
  decodeFotosShareInvitePayload,
  encodeFotosShareInvitePayload,
  isFotosShareInviteExpired,
  parseFotosShareInviteUrl,
} from './fotosShareInvite';

const pairingInvitation = {
  token: 'pair-token-1',
  publicKey: 'ab'.repeat(32),
  url: 'wss://api.glue.one/comm',
  pairingProtocolVersion: 2,
  pairingMode: 'standard',
  identityRelation: 'distinct-person',
} as const;

function inFifteenMinutes(): Date {
  return new Date(Date.now() + 15 * 60 * 1000);
}

describe('fotosShareInvite', () => {
  it('keeps every trace of the PIN out of the URL and payload', async () => {
    const invite = await createFotosShareInvite({
      baseUrl: 'https://fotos.one/',
      pairingInvitation: pairingInvitation as any,
      senderPersonId: 'sender-person-id',
      galleryName: 'Family',
      expiresAt: inFifteenMinutes(),
    });

    expect(invite.pin).toMatch(/^\d{4}$/);
    expect(invite.url).toContain(`${FOTOS_SHARE_INVITE_PARAM}=`);
    expect(invite.url).not.toContain('fotosAccount=new');
    expect(invite.url).not.toContain(invite.pin);
    expect(invite.payload).not.toHaveProperty('pinSalt');
    expect(invite.payload).not.toHaveProperty('pinDigest');
    expect(invite.payload).not.toHaveProperty('pin');
    for (const value of Object.values(invite.payload)) {
      if (typeof value === 'string') expect(value).not.toBe(invite.pin);
    }
    expect(encodeFotosShareInvitePayload(invite.payload)).not.toContain(invite.pin);
    expect(new URL(invite.url).search).not.toContain(invite.pin);
  });

  it('can opt into opening the invite under a new tab account', async () => {
    const invite = await createFotosShareInvite({
      baseUrl: 'https://fotos.one/',
      pairingInvitation: pairingInvitation as any,
      senderPersonId: 'sender-person-id',
      expiresAt: inFifteenMinutes(),
      openInNewAccount: true,
    });

    expect(invite.url).toContain('fotosAccount=new');
  });

  it('round-trips encoded payloads', async () => {
    const invite = await createFotosShareInvite({
      baseUrl: 'https://fotos.one/app',
      pairingInvitation: pairingInvitation as any,
      senderPersonId: 'sender-person-id',
      expiresAt: inFifteenMinutes(),
    });

    const encoded = encodeFotosShareInvitePayload(invite.payload);
    expect(decodeFotosShareInvitePayload(encoded)).toEqual(invite.payload);
    expect(parseFotosShareInviteUrl(invite.url)).toEqual(invite.payload);
  });

  it('reports expired invites', async () => {
    const invite = await createFotosShareInvite({
      baseUrl: 'https://fotos.one/',
      pairingInvitation: pairingInvitation as any,
      senderPersonId: 'sender-person-id',
      expiresAt: new Date(Date.now() + 1_000),
    });

    expect(isFotosShareInviteExpired(invite.payload)).toBe(false);
    expect(
      isFotosShareInviteExpired(
        invite.payload,
        new Date(Date.parse(invite.payload.expiresAt) + 1),
      ),
    ).toBe(true);
  });

  it('advertises exactly the pairing expiry it was given', async () => {
    const expiresAt = inFifteenMinutes();
    const invite = await createFotosShareInvite({
      baseUrl: 'https://fotos.one/',
      pairingInvitation: pairingInvitation as any,
      senderPersonId: 'sender-person-id',
      expiresAt,
    });

    expect(invite.payload.expiresAt).toBe(expiresAt.toISOString());
  });

  it('refuses to create an invite whose pairing has already expired', async () => {
    await expect(createFotosShareInvite({
      baseUrl: 'https://fotos.one/',
      pairingInvitation: pairingInvitation as any,
      senderPersonId: 'sender-person-id',
      expiresAt: new Date(Date.now() - 1),
    })).rejects.toThrow('future pairing expiry');
  });
});
