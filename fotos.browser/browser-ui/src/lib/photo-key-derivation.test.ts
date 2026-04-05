import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { deriveKeyFromPhotos, deriveRecoveryKeyCandidatesFromPhotos } from './photo-key-derivation.js';
import { ensurePublicSignKey, ensureSecretSignKey, sign, signatureVerify } from '@refinio/one.core/lib/crypto/sign.js';
import { fromByteArray as toBase64, toByteArray as fromBase64 } from 'base64-js';

// Deterministic photo fixtures generated from ImageMagick's built-in `rose:`
// sample so fotos-id derivation runs against real JPEG/PNG payloads.
function loadFixture(relativePath: string): Uint8Array {
    return new Uint8Array(readFileSync(new URL(relativePath, import.meta.url)));
}

const IMG_A = loadFixture('./__fixtures__/photos/rose-center.jpg');
const IMG_B = loadFixture('./__fixtures__/photos/rose-top-left.jpg');
const IMG_C = loadFixture('./__fixtures__/photos/rose-detail.png');

const PASSPHRASE = 'morning-lake-rail';

// Use fast Argon2 params for testing (low memory + iterations)
const FAST_PARAMS = { memoryCost: 1024, timeCost: 1, parallelism: 1 };

describe('deriveKeyFromPhotos', () => {
    test('same inputs in same order produce same key (deterministic)', async () => {
        const result1 = await deriveKeyFromPhotos({
            images: [IMG_A, IMG_B],
            passphrase: PASSPHRASE,
            ...FAST_PARAMS,
        });
        const result2 = await deriveKeyFromPhotos({
            images: [IMG_A, IMG_B],
            passphrase: PASSPHRASE,
            ...FAST_PARAMS,
        });

        expect(result1.seed).toEqual(result2.seed);
        expect(result1.publicKey).toEqual(result2.publicKey);
        expect(result1.secretKey).toEqual(result2.secretKey);
    });

    test('recovery candidates include the current derivation and legacy fallback when they differ', async () => {
        const current = await deriveKeyFromPhotos({
            images: [IMG_A, IMG_B],
            passphrase: PASSPHRASE,
            ...FAST_PARAMS,
        });
        const candidates = await deriveRecoveryKeyCandidatesFromPhotos({
            images: [IMG_A, IMG_B],
            passphrase: PASSPHRASE,
            ...FAST_PARAMS,
        });

        expect(candidates[0]!.publicKey).toEqual(current.publicKey);
        expect(candidates.length).toBeGreaterThan(1);
        expect(candidates[1]!.publicKey).not.toEqual(current.publicKey);
    });

    test('same images in different order produce different key', async () => {
        const resultAB = await deriveKeyFromPhotos({
            images: [IMG_A, IMG_B],
            passphrase: PASSPHRASE,
            ...FAST_PARAMS,
        });
        const resultBA = await deriveKeyFromPhotos({
            images: [IMG_B, IMG_A],
            passphrase: PASSPHRASE,
            ...FAST_PARAMS,
        });

        expect(resultAB.seed).not.toEqual(resultBA.seed);
    });

    test('same images, different passphrase produce different key', async () => {
        const result1 = await deriveKeyFromPhotos({
            images: [IMG_A, IMG_B],
            passphrase: 'morning-lake-rail',
            ...FAST_PARAMS,
        });
        const result2 = await deriveKeyFromPhotos({
            images: [IMG_A, IMG_B],
            passphrase: 'evening-storm-bridge',
            ...FAST_PARAMS,
        });

        expect(result1.seed).not.toEqual(result2.seed);
    });

    test('additional image appended produces different key', async () => {
        const result2 = await deriveKeyFromPhotos({
            images: [IMG_A, IMG_B],
            passphrase: PASSPHRASE,
            ...FAST_PARAMS,
        });
        const result3 = await deriveKeyFromPhotos({
            images: [IMG_A, IMG_B, IMG_C],
            passphrase: PASSPHRASE,
            ...FAST_PARAMS,
        });

        expect(result2.seed).not.toEqual(result3.seed);
    });

    test('derived public key is valid Ed25519 (32 bytes)', async () => {
        const result = await deriveKeyFromPhotos({
            images: [IMG_A],
            passphrase: PASSPHRASE,
            ...FAST_PARAMS,
        });

        expect(result.seed).toBeInstanceOf(Uint8Array);
        expect(result.seed.length).toBe(32);
        expect(result.publicKey).toBeInstanceOf(Uint8Array);
        expect(result.publicKey.length).toBe(32);
        expect(result.secretKey).toBeInstanceOf(Uint8Array);
        expect(result.secretKey.length).toBe(64);
    });

    test('derived secret key survives base64 serialization and still verifies against its public key', async () => {
        const result = await deriveKeyFromPhotos({
            images: [IMG_A, IMG_B],
            passphrase: PASSPHRASE,
            ...FAST_PARAMS,
        });

        const privateKeyBase64 = toBase64(result.secretKey);
        const decodedSecretKey = ensureSecretSignKey(fromBase64(privateKeyBase64));
        expect(decodedSecretKey.slice(32)).toEqual(result.publicKey);

        const message = new TextEncoder().encode('fotos recovery serialization probe');
        const signature = sign(message, decodedSecretKey);
        expect(signatureVerify(message, signature, ensurePublicSignKey(result.publicKey))).toBe(true);
    });

    test('rejects an empty passphrase', async () => {
        await expect(
            deriveKeyFromPhotos({ images: [IMG_A], passphrase: '', ...FAST_PARAMS }),
        ).rejects.toThrow();

        await expect(
            deriveKeyFromPhotos({ images: [IMG_A], passphrase: '   ', ...FAST_PARAMS }),
        ).rejects.toThrow();
    });

    test('rejects empty images array', async () => {
        await expect(
            deriveKeyFromPhotos({ images: [], passphrase: PASSPHRASE, ...FAST_PARAMS }),
        ).rejects.toThrow();
    });

    test('rejects empty image entry', async () => {
        await expect(
            deriveKeyFromPhotos({ images: [new Uint8Array(0)], passphrase: PASSPHRASE, ...FAST_PARAMS }),
        ).rejects.toThrow();
    });
});
