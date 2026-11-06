import { describe, expect, it } from 'vitest';
import {
    isJpeg,
    normalizeImageBytesForContentHash,
    stripJpegMetadata,
} from './content-hash.js';

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

    it('only normalizes jpeg payloads', () => {
        const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
        expect(normalizeImageBytesForContentHash(png)).toBe(png);
    });
});
