// hash.test.ts
import { describe, it, expect } from 'vitest';
import { isJpeg, stripJpegMetadata, sha256Hex, computeStreamId } from './hash.js';

describe('isJpeg', () => {
    it('detects JPEG magic bytes', () => {
        expect(isJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    });
    it('rejects non-JPEG', () => {
        expect(isJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    });
    it('rejects too-short buffer', () => {
        expect(isJpeg(new Uint8Array([0xff]))).toBe(false);
    });
});

describe('stripJpegMetadata', () => {
    it('preserves SOI and strips APP0', () => {
        // SOI + APP0(4-byte segment) + SOS + pixel data
        const app0Len = 4; // segment length (includes the 2 length bytes)
        const input = new Uint8Array([
            0xff, 0xd8,                     // SOI
            0xff, 0xe0, 0x00, app0Len, 0x00, 0x00,  // APP0 segment
            0xff, 0xda, 0x01, 0x02, 0x03,   // SOS + data
        ]);
        const out = stripJpegMetadata(input);
        // Should have SOI + SOS+data, no APP0
        expect(out[0]).toBe(0xff);
        expect(out[1]).toBe(0xd8);
        expect(out[2]).toBe(0xff);
        expect(out[3]).toBe(0xda);
    });
});

describe('sha256Hex', () => {
    it('hashes to hex string', async () => {
        const data = new TextEncoder().encode('hello');
        const hash = await sha256Hex(data);
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
        expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    });
});

describe('computeStreamId', () => {
    it('uses exifDate+mime when available', async () => {
        const id = await computeStreamId('contenthash', '2024-03-15', 'image/jpeg');
        expect(id).toMatch(/^[0-9a-f]{64}$/);
        expect(id).not.toBe('contenthash');
    });
    it('falls back to contentHash when no exifDate', async () => {
        const id = await computeStreamId('contenthash', undefined, 'image/jpeg');
        expect(id).toBe('contenthash');
    });
});
