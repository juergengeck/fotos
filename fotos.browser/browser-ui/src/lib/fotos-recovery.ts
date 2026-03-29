import {
  ensurePublicSignKey,
  ensureSecretSignKey,
  sign,
  signatureVerify,
} from '@refinio/one.core/lib/crypto/sign.js';
import {
  uint8arrayToHexString,
} from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';

import type { DerivedKeyResult } from './photo-key-derivation.js';

const RECOVERY_PROBE_MESSAGE = new TextEncoder().encode('fotos.one recovery probe');

function uint8ArraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function assertRecoveryCandidateIntegrity(candidate: DerivedKeyResult): void {
  const secretKey = ensureSecretSignKey(candidate.secretKey);
  const expectedPublicKey = ensurePublicSignKey(candidate.publicKey);
  const embeddedPublicKey = ensurePublicSignKey(secretKey.slice(32));

  if (!uint8ArraysEqual(embeddedPublicKey, expectedPublicKey)) {
    throw new Error('Derived recovery key does not match its public key');
  }

  const signature = sign(RECOVERY_PROBE_MESSAGE, secretKey);
  if (!signatureVerify(RECOVERY_PROBE_MESSAGE, signature, expectedPublicKey)) {
    throw new Error('Derived recovery key failed local signature verification');
  }
}

export function selectExpectedRecoveryCandidate(
  expectedRecoveryPublicKeyHex: string,
  recoveryCandidates: DerivedKeyResult[],
): { candidate: DerivedKeyResult; publicKey: string } {
  for (const candidate of recoveryCandidates) {
    assertRecoveryCandidateIntegrity(candidate);
    const candidatePublicKeyHex = uint8arrayToHexString(candidate.publicKey);
    if (candidatePublicKeyHex === expectedRecoveryPublicKeyHex) {
      return {
        candidate,
        publicKey: candidatePublicKeyHex,
      };
    }
  }

  throw new Error('Derived recovery key does not match the registered recovery signer');
}
export function signRecoveryPayload(
  payload: string | Uint8Array,
  candidate: DerivedKeyResult,
): string {
  const secretKey = ensureSecretSignKey(candidate.secretKey);
  const payloadBytes =
    typeof payload === 'string'
      ? new TextEncoder().encode(payload)
      : payload;
  return uint8arrayToHexString(sign(payloadBytes, secretKey));
}
