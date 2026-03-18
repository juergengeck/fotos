import { describe, test, expect } from 'vitest';
import { deriveKeyFromPhotos } from './photo-key-derivation.js';

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
