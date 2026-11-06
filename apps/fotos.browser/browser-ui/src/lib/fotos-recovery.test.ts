import { describe, expect, test } from 'vitest';
import {
  createSignKeyPairFromSeed,
  ensurePublicSignKey,
  signatureVerify,
} from '@refinio/one.core/lib/crypto/sign.js';
import {
  hexToUint8ArrayWithCheck,
  uint8arrayToHexString,
} from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';

import {
  assertRecoveryCandidateIntegrity,
  selectExpectedRecoveryCandidate,
  signRecoveryPayload,
} from './fotos-recovery.js';

describe('fotos recovery helpers', () => {
  test('validates a derived recovery candidate against its embedded public key', () => {
    const keyPair = createSignKeyPairFromSeed(new Uint8Array(32).fill(7));

    expect(() => assertRecoveryCandidateIntegrity({
      seed: new Uint8Array(32).fill(7),
      publicKey: keyPair.publicKey,
      secretKey: keyPair.secretKey,
    })).not.toThrow();
    expect(() => assertRecoveryCandidateIntegrity({
      seed: new Uint8Array(32).fill(7),
      publicKey: createSignKeyPairFromSeed(new Uint8Array(32).fill(9)).publicKey,
      secretKey: keyPair.secretKey,
    })).toThrow(
      'Derived recovery key does not match its public key',
    );
  });

  test('selects the recovery candidate whose public key matches the registered signer', () => {
    const candidateA = createSignKeyPairFromSeed(new Uint8Array(32).fill(1));
    const candidateB = createSignKeyPairFromSeed(new Uint8Array(32).fill(2));

    const result = selectExpectedRecoveryCandidate(
      uint8arrayToHexString(candidateB.publicKey),
      [
        { seed: new Uint8Array(32), publicKey: candidateA.publicKey, secretKey: candidateA.secretKey },
        { seed: new Uint8Array(32), publicKey: candidateB.publicKey, secretKey: candidateB.secretKey },
      ],
    );

    expect(result.publicKey).toBe(uint8arrayToHexString(candidateB.publicKey));
    expect(result.candidate.publicKey).toEqual(candidateB.publicKey);
  });

  test('signs arbitrary recovery payloads with the selected recovery key', () => {
    const candidate = createSignKeyPairFromSeed(new Uint8Array(32).fill(8));
    const payload = JSON.stringify({
      id: 'fu@glue.one',
      issuerPublicKey: uint8arrayToHexString(candidate.publicKey),
    });

    const signature = signRecoveryPayload(payload, {
      seed: new Uint8Array(32).fill(8),
      publicKey: candidate.publicKey,
      secretKey: candidate.secretKey,
    });

    expect(signatureVerify(
      new TextEncoder().encode(payload),
      hexToUint8ArrayWithCheck(signature),
      ensurePublicSignKey(candidate.publicKey),
    )).toBe(true);
  });
});
