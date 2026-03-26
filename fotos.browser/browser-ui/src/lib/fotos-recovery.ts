import { ensurePublicSignKey, ensureSecretSignKey, sign, signatureVerify } from '@refinio/one.core/lib/crypto/sign.js';
import { uint8arrayToHexString } from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';
import { fromByteArray as toBase64, toByteArray as fromBase64 } from 'base64-js';

import { API_BASE } from '../config.js';

import type { DerivedKeyResult } from './photo-key-derivation.js';

const RECOVERY_PROBE_MESSAGE = new TextEncoder().encode('fotos.one recovery probe');

function uint8ArraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function serializeRecoveryPrivateKey(secretKey: Uint8Array): string {
  return toBase64(secretKey);
}

export function assertSerializedRecoveryKey(
  privateKeyBase64: string,
  expectedPublicKey: Uint8Array,
): void {
  const decodedSecretKey = ensureSecretSignKey(fromBase64(privateKeyBase64));
  const embeddedPublicKey = ensurePublicSignKey(decodedSecretKey.slice(32));

  if (!uint8ArraysEqual(embeddedPublicKey, expectedPublicKey)) {
    throw new Error('Derived recovery key does not match its public key');
  }

  const signature = sign(RECOVERY_PROBE_MESSAGE, decodedSecretKey);
  if (!signatureVerify(RECOVERY_PROBE_MESSAGE, signature, ensurePublicSignKey(expectedPublicKey))) {
    throw new Error('Derived recovery key failed local signature verification');
  }
}

export async function verifyRecoveryKeyWithRegistrar(
  identity: string,
  privateKeyBase64: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const beginRes = await fetchImpl(`${API_BASE}/api/registration/recoverWithKey/begin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: identity }),
  });

  const beginBody = await beginRes.json().catch(() => ({ error: 'Recovery verification failed' }));
  if (!beginRes.ok || !beginBody?.success || typeof beginBody?.data?.challenge !== 'string') {
    throw new Error(beginBody?.error || `Recovery verification failed: ${beginRes.status}`);
  }

  const secretKey = ensureSecretSignKey(fromBase64(privateKeyBase64));
  const signatureBytes = sign(new TextEncoder().encode(beginBody.data.challenge), secretKey);
  const verifyRes = await fetchImpl(`${API_BASE}/api/registration/recoverWithKey`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: identity,
      signature: uint8arrayToHexString(signatureBytes),
    }),
  });

  const verifyBody = await verifyRes.json().catch(() => ({ error: 'Recovery verification failed' }));
  if (!verifyRes.ok || !verifyBody?.success) {
    throw new Error(verifyBody?.error || `Recovery verification failed: ${verifyRes.status}`);
  }
}

export async function selectRegistrarVerifiedRecoveryCandidate(
  identity: string,
  recoveryCandidates: DerivedKeyResult[],
  fetchImpl: typeof fetch = fetch,
): Promise<{ privateKey: string; publicKey: string }> {
  const recoveryErrors: string[] = [];

  for (const candidate of recoveryCandidates) {
    const privateKeyBase64 = serializeRecoveryPrivateKey(candidate.secretKey);
    try {
      assertSerializedRecoveryKey(privateKeyBase64, candidate.publicKey);
      await verifyRecoveryKeyWithRegistrar(identity, privateKeyBase64, fetchImpl);
      return {
        privateKey: privateKeyBase64,
        publicKey: uint8arrayToHexString(candidate.publicKey),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Recovery verification failed';
      recoveryErrors.push(message);
    }
  }

  throw new Error(recoveryErrors[0] || 'Identity recovery failed');
}
