import type { Invitation } from '@refinio/one.models/lib/misc/ConnectionEstablishment/PairingManager.js';

export const FOTOS_SHARE_INVITE_PARAM = 'fotosShare';
export const FOTOS_SHARE_NEW_ACCOUNT_PARAM = 'fotosAccount';

/**
 * Gallery invite link payload. It carries only what pairing needs: the pairing
 * invitation, the sender's Person ID, a gallery label, and the expiry. The PIN
 * is a second factor told to the recipient over a different channel. It never
 * appears in the link — not in clear, not salted, not as a digest — so holding
 * the link alone reveals nothing about the PIN. After pairing, the recipient's
 * app sends proof of the PIN to the sender as a ONE object over CHUM, and the
 * sender grants only after verifying that proof.
 */
export interface FotosShareInvitePayload {
  version: 1;
  kind: 'fotos-gallery-share';
  scope: 'gallery';
  pairingInvitation: Invitation;
  senderPersonId: string;
  galleryName: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface CreatedFotosShareInvite {
  url: string;
  /** Four-digit PIN shown only on the sender's screen, never in the URL. */
  pin: string;
  payload: FotosShareInvitePayload;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export function createFourDigitPin(): string {
  const bytes = new Uint8Array(2);
  crypto.getRandomValues(bytes);
  const value = ((bytes[0]! << 8) | bytes[1]!) % 10_000;
  return value.toString().padStart(4, '0');
}

export function encodeFotosShareInvitePayload(payload: FotosShareInvitePayload): string {
  return bytesToBase64Url(encodeUtf8(JSON.stringify(payload)));
}

function normalizePayload(value: unknown): FotosShareInvitePayload | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<FotosShareInvitePayload>;
  const invitation = candidate.pairingInvitation as Partial<Invitation> | undefined;
  if (
    candidate.version !== 1
    || candidate.kind !== 'fotos-gallery-share'
    || candidate.scope !== 'gallery'
    || !invitation
    || typeof invitation.token !== 'string'
    || typeof invitation.publicKey !== 'string'
    || typeof invitation.url !== 'string'
    || typeof candidate.senderPersonId !== 'string'
    || typeof candidate.createdAt !== 'string'
    || typeof candidate.expiresAt !== 'string'
  ) {
    return null;
  }

  return {
    version: 1,
    kind: 'fotos-gallery-share',
    scope: 'gallery',
    pairingInvitation: {
      // Pairing owns this envelope, including its protocol version and relation.
      // Reconstructing only token/key/url loses fields required by the receiver.
      ...invitation,
      token: invitation.token,
      publicKey: invitation.publicKey as Invitation['publicKey'],
      url: invitation.url,
    },
    senderPersonId: candidate.senderPersonId,
    galleryName: typeof candidate.galleryName === 'string' ? candidate.galleryName : null,
    createdAt: candidate.createdAt,
    expiresAt: candidate.expiresAt,
  };
}

export function decodeFotosShareInvitePayload(encoded: string): FotosShareInvitePayload | null {
  try {
    return normalizePayload(JSON.parse(decodeUtf8(base64UrlToBytes(encoded))));
  } catch {
    return null;
  }
}

export function parseFotosShareInviteUrl(url: string): FotosShareInvitePayload | null {
  try {
    const parsed = new URL(url, globalThis.location?.href ?? 'https://fotos.one/');
    const encoded = parsed.searchParams.get(FOTOS_SHARE_INVITE_PARAM);
    return encoded ? decodeFotosShareInvitePayload(encoded) : null;
  } catch {
    return null;
  }
}

export function isFotosShareInviteExpired(
  payload: FotosShareInvitePayload,
  now = new Date(),
): boolean {
  return Number.isNaN(Date.parse(payload.expiresAt)) || now.getTime() > Date.parse(payload.expiresAt);
}

export async function createFotosShareInvite(options: {
  baseUrl: string;
  pairingInvitation: Invitation;
  senderPersonId: string;
  galleryName?: string | null;
  /** When the pairing invitation stops being accepted; the link must not outlive it. */
  expiresAt: Date;
  openInNewAccount?: boolean;
}): Promise<CreatedFotosShareInvite> {
  const pin = createFourDigitPin();
  const createdAt = new Date();
  const expiresAt = options.expiresAt;
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= createdAt.getTime()) {
    throw new Error('A fotos share invite requires a future pairing expiry.');
  }
  const payload: FotosShareInvitePayload = {
    version: 1,
    kind: 'fotos-gallery-share',
    scope: 'gallery',
    pairingInvitation: options.pairingInvitation,
    senderPersonId: options.senderPersonId,
    galleryName: options.galleryName?.trim() || null,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  const url = new URL(options.baseUrl);
  url.searchParams.set(FOTOS_SHARE_INVITE_PARAM, encodeFotosShareInvitePayload(payload));
  if (options.openInNewAccount) {
    url.searchParams.set(FOTOS_SHARE_NEW_ACCOUNT_PARAM, 'new');
  }

  return {
    url: url.toString(),
    pin,
    payload,
  };
}
