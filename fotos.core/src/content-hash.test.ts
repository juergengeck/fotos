import { describe, expect, it } from 'vitest';
import {readFileSync} from 'node:fs';
import {
    isJpeg,
    matchesImageContentHash,
    normalizeImageBytesForContentHash,
    stripJpegMetadata,
} from './content-hash.js';
import {hashImageBytes, sha256Hex} from './ingest/hash.js';

const fixtureDirectory = new URL('../test/fixtures/content-hash/', import.meta.url);
const fixtures: Array<{file: string; contentHash: string}> = JSON.parse(
    readFileSync(new URL('hashes.json', fixtureDirectory), 'utf8'),
);

describe('content-hash normalization', () => {
    it('detects jpeg headers', () => {
        expect(isJpeg(new Uint8Array([0xff, 0xd8, 0x00]))).toBe(true);
        expect(isJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    });

    it('strips APP and COM segments while preserving image payload markers', () => {
        const jpeg = new Uint8Array([
            0xff, 0xd8,
            0xff, 0xe1, 0x00, 0x04, 0x11, 0x22,
            0xff, 0xfe, 0x00, 0x04, 0x33, 0x44,
            0xff, 0xdb, 0x00, 0x04, 0xaa, 0xbb,
            0xff, 0xda, 0x00, 0x04, 0x55, 0x66, 0x77, 0x88, 0xff, 0xd9,
        ]);

        expect([...stripJpegMetadata(jpeg)]).toEqual([
            0xff, 0xd8,
            0xff, 0xdb, 0x00, 0x04, 0xaa, 0xbb,
            0xff, 0xda, 0x00, 0x04, 0x55, 0x66, 0x77, 0x88, 0xff, 0xd9,
        ]);
    });

    it('preserves bytes of unsupported and incomplete images', () => {
        const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
        expect(normalizeImageBytesForContentHash(png)).toBe(png);
    });

    it.each(fixtures)('matches the shared digest for $file', async ({file, contentHash}) => {
        const bytes = readFileSync(new URL(file, fixtureDirectory));
        expect(await hashImageBytes(bytes)).toBe(contentHash);
    });

    it('verifies repacked HEIC originals by content and preserves exact legacy references', async () => {
        const original = readFileSync(new URL('grid.heic', fixtureDirectory));
        const repacked = readFileSync(new URL('grid-metadata-repacked.heic', fixtureDirectory));
        const differentTile = readFileSync(new URL('grid-changed-tile.heic', fixtureDirectory));
        const canonical = await hashImageBytes(original);
        const legacy = await sha256Hex(original);
        expect(legacy).not.toBe(canonical);
        await expect(matchesImageContentHash(repacked, canonical, sha256Hex)).resolves.toBe(true);
        await expect(matchesImageContentHash(differentTile, canonical, sha256Hex)).resolves.toBe(false);
        await expect(matchesImageContentHash(original, legacy, sha256Hex)).resolves.toBe(true);
        await expect(matchesImageContentHash(repacked, legacy, sha256Hex)).resolves.toBe(false);
    });
});
