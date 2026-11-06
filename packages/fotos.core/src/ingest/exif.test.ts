// exif.test.ts
import { describe, it, expect } from 'vitest';
import { extractExif } from './exif.js';

describe('extractExif', () => {
    it('returns empty object for non-image data', async () => {
        const bytes = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
        const result = await extractExif(bytes);
        expect(result).toEqual({});
    });

    it('accepts ArrayBuffer input', async () => {
        const buf = new ArrayBuffer(4);
        const view = new Uint8Array(buf);
        view.set([0x00, 0x01, 0x02, 0x03]);
        const result = await extractExif(buf);
        expect(result).toEqual({});
    });

    it('returns empty object for truncated JPEG', async () => {
        // Just JPEG SOI marker, nothing else
        const bytes = new Uint8Array([0xff, 0xd8]);
        const result = await extractExif(bytes);
        expect(result).toEqual({});
    });
});
