import { describe, expect, test, vi } from 'vitest';
import { createSignKeyPairFromSeed, sign } from '@refinio/one.core/lib/crypto/sign.js';
import { uint8arrayToHexString } from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';

import { API_BASE } from '../config.js';
import {
  assertSerializedRecoveryKey,
  selectRegistrarVerifiedRecoveryCandidate,
  serializeRecoveryPrivateKey,
} from './fotos-recovery.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('fotos recovery helpers', () => {
  test('validates a serialized recovery key against its public key', () => {
    const keyPair = createSignKeyPairFromSeed(new Uint8Array(32).fill(7));
    const privateKeyBase64 = serializeRecoveryPrivateKey(keyPair.secretKey);

    expect(() => assertSerializedRecoveryKey(privateKeyBase64, keyPair.publicKey)).not.toThrow();
    expect(() => assertSerializedRecoveryKey(privateKeyBase64, createSignKeyPairFromSeed(new Uint8Array(32).fill(9)).publicKey)).toThrow(
      'Derived recovery key does not match its public key',
    );
  });

  test('selects the first recovery candidate that passes live registrar verification', async () => {
    const candidateA = createSignKeyPairFromSeed(new Uint8Array(32).fill(1));
    const candidateB = createSignKeyPairFromSeed(new Uint8Array(32).fill(2));
    const candidateBKey = serializeRecoveryPrivateKey(candidateB.secretKey);
    const challenge = 'recover-challenge';
    const expectedSignatureA = uint8arrayToHexString(sign(new TextEncoder().encode(challenge), candidateA.secretKey));
    const expectedSignatureB = uint8arrayToHexString(sign(new TextEncoder().encode(challenge), candidateB.secretKey));
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/recoverWithKey/begin')) {
        return jsonResponse({ success: true, data: { challenge } });
      }

      if (url.endsWith('/recoverWithKey')) {
        const body = JSON.parse(String(init?.body ?? '{}'));
        if (body.signature === expectedSignatureA) {
          return jsonResponse({ success: false, error: 'Signature does not match registered key' }, 400);
        }
        if (body.signature === expectedSignatureB) {
          return jsonResponse({ success: true, data: { cert: { id: 'fu@glue.one' } } });
        }
      }

      return jsonResponse({ success: false, error: `Unexpected request: ${url}` }, 500);
    });

    const result = await selectRegistrarVerifiedRecoveryCandidate(
      'fu@glue.one',
      [
        { seed: new Uint8Array(32), publicKey: candidateA.publicKey, secretKey: candidateA.secretKey },
        { seed: new Uint8Array(32), publicKey: candidateB.publicKey, secretKey: candidateB.secretKey },
      ],
      fetchMock,
    );

    expect(result).toEqual({
      privateKey: candidateBKey,
      publicKey: uint8arrayToHexString(candidateB.publicKey),
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `${API_BASE}/api/registration/recoverWithKey/begin`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'fu@glue.one' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `${API_BASE}/api/registration/recoverWithKey/begin`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'fu@glue.one' }),
      }),
    );
  });
});
