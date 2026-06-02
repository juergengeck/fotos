import type { Invitation } from '@refinio/one.models/lib/misc/ConnectionEstablishment/PairingManager.js';

export const FOTOS_SHARE_INVITE_PARAM = 'fotosShare';
export const FOTOS_SHARE_NEW_ACCOUNT_PARAM = 'fotosAccount';

export interface FotosShareInvitePayload {
  version: 1;
  kind: 'fotos-gallery-share';
  scope: 'gallery';
  pairingInvitation: Invitation;
  senderPersonId: string;
  galleryName: string | null;
  createdAt: string;
  expiresAt: string;
  pinSalt: string;
  pinDigest: string;
}

export interface CreatedFotosShareInvite {
  url: string;
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

function createRandomHex(byteCount: number): string {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function createFourDigitPin(): string {
  const bytes = new Uint8Array(2);
  crypto.getRandomValues(bytes);
  const value = ((bytes[0]! << 8) | bytes[1]!) % 10_000;
  return value.toString().padStart(4, '0');
}

export async function digestFotosSharePin(pin: string, salt: string, token: string): Promise<string> {
  const normalizedPin = pin.trim();
  if (!/^\d{4}$/.test(normalizedPin)) {
    throw new Error('Fotos share PIN must be exactly 4 digits.');
  }

  const digest = await crypto.subtle.digest(
    'SHA-256',
    encodeUtf8(`fotos-share-v1:${token}:${salt}:${normalizedPin}`) as BufferSource,
  );
  return bytesToBase64Url(new Uint8Array(digest));
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
    || typeof candidate.pinSalt !== 'string'
    || typeof candidate.pinDigest !== 'string'
  ) {
    return null;
  }

  return {
    version: 1,
    kind: 'fotos-gallery-share',
    scope: 'gallery',
    pairingInvitation: {
      token: invitation.token,
      publicKey: invitation.publicKey as Invitation['publicKey'],
      url: invitation.url,
    },
    senderPersonId: candidate.senderPersonId,
    galleryName: typeof candidate.galleryName === 'string' ? candidate.galleryName : null,
    createdAt: candidate.createdAt,
    expiresAt: candidate.expiresAt,
    pinSalt: candidate.pinSalt,
    pinDigest: candidate.pinDigest,
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

export async function verifyFotosShareInvitePin(
  payload: FotosShareInvitePayload,
  pin: string,
  now = new Date(),
): Promise<boolean> {
  if (Number.isNaN(Date.parse(payload.expiresAt)) || now.getTime() > Date.parse(payload.expiresAt)) {
    return false;
  }

  return await digestFotosSharePin(
    pin,
    payload.pinSalt,
    payload.pairingInvitation.token,
  ) === payload.pinDigest;
}

export async function createFotosShareInvite(options: {
  baseUrl: string;
  pairingInvitation: Invitation;
  senderPersonId: string;
  galleryName?: string | null;
  expiresInMs?: number;
  openInNewAccount?: boolean;
}): Promise<CreatedFotosShareInvite> {
  const pin = createFourDigitPin();
  const pinSalt = createRandomHex(16);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + (options.expiresInMs ?? 24 * 60 * 60 * 1000));
  const payload: FotosShareInvitePayload = {
    version: 1,
    kind: 'fotos-gallery-share',
    scope: 'gallery',
    pairingInvitation: options.pairingInvitation,
    senderPersonId: options.senderPersonId,
    galleryName: options.galleryName?.trim() || null,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    pinSalt,
    pinDigest: await digestFotosSharePin(pin, pinSalt, options.pairingInvitation.token),
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
