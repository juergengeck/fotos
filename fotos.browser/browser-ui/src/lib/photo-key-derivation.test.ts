import { describe, test, expect } from 'vitest';
import { deriveKeyFromPhotos, deriveRecoveryKeyCandidatesFromPhotos } from './photo-key-derivation.js';
import { ensurePublicSignKey, ensureSecretSignKey, sign, signatureVerify } from '@refinio/one.core/lib/crypto/sign.js';
import { fromByteArray as toBase64, toByteArray as fromBase64 } from 'base64-js';

// Tiny deterministic test images (1x1 pixel PNGs with known byte content)
const IMG_A = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const IMG_B = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x02]);
const IMG_C = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x03]);

const PIN = '19450508';

// Use fast Argon2 params for testing (low memory + iterations)
const FAST_PARAMS = { memoryCost: 1024, timeCost: 1, parallelism: 1 };

describe('deriveKeyFromPhotos', () => {
    test('same inputs in same order produce same key (deterministic)', async () => {
        const result1 = await deriveKeyFromPhotos({
            images: [IMG_A, IMG_B],
            pin: PIN,
            ...FAST_PARAMS,
        });
        const result2 = await deriveKeyFromPhotos({
            images: [IMG_A, IMG_B],
            pin: PIN,
            ...FAST_PARAMS,
        });

        expect(result1.seed).toEqual(result2.seed);
        expect(result1.publicKey).toEqual(result2.publicKey);
        expect(result1.secretKey).toEqual(result2.secretKey);
    });

    test('recovery candidates include the current derivation and legacy fallback when they differ', async () => {
        const current = await deriveKeyFromPhotos({
            images: [IMG_A, IMG_B],
            pin: PIN,
            ...FAST_PARAMS,
        });
        const candidates = await deriveRecoveryKeyCandidatesFromPhotos({
            images: [IMG_A, IMG_B],
            pin: PIN,
            ...FAST_PARAMS,
        });

        expect(candidates[0]!.publicKey).toEqual(current.publicKey);
        expect(candidates.length).toBeGreaterThan(1);
        expect(candidates[1]!.publicKey).not.toEqual(current.publicKey);
    });

    test('same images in different order produce different key', async () => {
        const resultAB = await deriveKeyFromPhotos({
            images: [IMG_A, IMG_B],
            pin: PIN,
            ...FAST_PARAMS,
        });
        const resultBA = await deriveKeyFromPhotos({
            images: [IMG_B, IMG_A],
            pin: PIN,
            ...FAST_PARAMS,
        });

        expect(resultAB.seed).not.toEqual(resultBA.seed);
    });

    test('same images, different PIN produce different key', async () => {
        const result1 = await deriveKeyFromPhotos({
            images: [IMG_A, IMG_B],
            pin: '19450508',
            ...FAST_PARAMS,
        });
        const result2 = await deriveKeyFromPhotos({
            images: [IMG_A, IMG_B],
            pin: '08051945',
            ...FAST_PARAMS,
        });

        expect(result1.seed).not.toEqual(result2.seed);
    });

    test('additional image appended produces different key', async () => {
        const result2 = await deriveKeyFromPhotos({
            images: [IMG_A, IMG_B],
            pin: PIN,
            ...FAST_PARAMS,
        });
        const result3 = await deriveKeyFromPhotos({
            images: [IMG_A, IMG_B, IMG_C],
            pin: PIN,
            ...FAST_PARAMS,
        });

        expect(result2.seed).not.toEqual(result3.seed);
    });

    test('derived public key is valid Ed25519 (32 bytes)', async () => {
        const result = await deriveKeyFromPhotos({
            images: [IMG_A],
            pin: PIN,
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
            pin: PIN,
            ...FAST_PARAMS,
        });

        const privateKeyBase64 = toBase64(result.secretKey);
        const decodedSecretKey = ensureSecretSignKey(fromBase64(privateKeyBase64));
        expect(decodedSecretKey.slice(32)).toEqual(result.publicKey);

        const message = new TextEncoder().encode('fotos recovery serialization probe');
        const signature = sign(message, decodedSecretKey);
        expect(signatureVerify(message, signature, ensurePublicSignKey(result.publicKey))).toBe(true);
    });

    test('rejects PIN that is not exactly 8 digits', async () => {
        await expect(
            deriveKeyFromPhotos({ images: [IMG_A], pin: '1234567', ...FAST_PARAMS }),
        ).rejects.toThrow();

        await expect(
            deriveKeyFromPhotos({ images: [IMG_A], pin: '123456789', ...FAST_PARAMS }),
        ).rejects.toThrow();

        await expect(
            deriveKeyFromPhotos({ images: [IMG_A], pin: '1234abcd', ...FAST_PARAMS }),
        ).rejects.toThrow();
    });

    test('rejects empty images array', async () => {
        await expect(
            deriveKeyFromPhotos({ images: [], pin: PIN, ...FAST_PARAMS }),
        ).rejects.toThrow();
    });

    test('rejects empty image entry', async () => {
        await expect(
            deriveKeyFromPhotos({ images: [new Uint8Array(0)], pin: PIN, ...FAST_PARAMS }),
        ).rejects.toThrow();
    });
});
