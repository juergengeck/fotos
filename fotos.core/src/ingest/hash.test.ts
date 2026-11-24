// hash.test.ts
import { afterEach, describe, it, expect, vi } from 'vitest';
import { isJpeg, stripJpegMetadata, sha256Hex, hashImageBytes, computeStreamId } from './hash.js';

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

describe('portable byte hashing without global Buffer', () => {
    const helloHash = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
    afterEach(() => vi.unstubAllGlobals());

    it('hashes standalone ArrayBuffer and Uint8Array inputs when Buffer is absent', async () => {
        const bytes = new TextEncoder().encode('hello');
        vi.stubGlobal('Buffer', undefined);
        expect(await sha256Hex(bytes.buffer)).toBe(helloHash);
        expect(await sha256Hex(bytes)).toBe(helloHash);
    });

    it('hashes only the selected nonzero-offset Uint8Array bytes', async () => {
        const backing = new Uint8Array([0xff, 0x00, ...new TextEncoder().encode('hello'), 0xee, 0xdd]);
        vi.stubGlobal('Buffer', undefined);
        expect(await sha256Hex(backing.subarray(2, 7))).toBe(helloHash);
    });

    it('hashes the exact bounded DataView instead of its entire backing buffer', async () => {
        const backing = new Uint8Array([0xff, 0x00, ...new TextEncoder().encode('hello'), 0xee, 0xdd]);
        vi.stubGlobal('Buffer', undefined);
        expect(await sha256Hex(new DataView(backing.buffer, 2, 5))).toBe(helloHash);
    });

    it('preserves the raw bytes of multibyte typed-array views', async () => {
        const backing = new Uint8Array([0xff, 0x00, ...new TextEncoder().encode('hello!'), 0xee, 0xdd]);
        vi.stubGlobal('Buffer', undefined);
        expect(await sha256Hex(new Uint16Array(backing.buffer, 2, 3)))
            .toBe('ce06092fb948d9ffac7d1a376e404b26b7575bcc11ee05a4615fef4fec3a308b');
    });

    it('respects an empty view even when the backing buffer contains bytes', async () => {
        const backing = new Uint8Array([0xff, 0x00, 0xee]);
        vi.stubGlobal('Buffer', undefined);
        expect(await sha256Hex(new DataView(backing.buffer, 1, 0)))
            .toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    it('preserves canonical JPEG content hashes after metadata normalization', async () => {
        const jpeg = new Uint8Array([
            0xff, 0xd8, 0xff, 0xe1, 0x00, 0x04, 0x11, 0x22,
            0xff, 0xda, 0x00, 0x04, 0x55, 0x66, 0x77, 0x88, 0xff, 0xd9,
        ]);
        vi.stubGlobal('Buffer', undefined);
        expect(await hashImageBytes(jpeg))
            .toBe('29e23f65903eb7504ced3090c5f3e156e45069cbc8bca8d8c9c189a8ebcf4d90');
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
