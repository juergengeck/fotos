import {describe, expect, it, vi} from 'vitest';
import {hashImageBytes, hashImageByteRanges} from './ingest/hash.js';

const storage = vi.hoisted(() => ({bytes: new Uint8Array(), read: vi.fn()}));
vi.mock('@refinio/one.core/lib/system/storage-base.js', () => ({fileSize: async () => storage.bytes.length}));
vi.mock('@refinio/one.core/lib/storage-blob.js', () => ({readBlobRange: storage.read}));
import {readVerifiedOriginalRange} from './original-ranges.js';
import type {BLOB} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';

describe('bounded Fotos originals', () => {
    it('preserves JPEG normalization for metadata, scan data and truncated segments', async () => {
        const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0, 4, 11, 22,
            0xff, 0xfe, 0, 4, 33, 44, 0xff, 0xdb, 0, 4, 55, 66,
            0xff, 0xda, 0, 4, 77, 88, 99, 0xff, 0xd9]);
        const fixtures = [jpeg, Uint8Array.from([0xff, 0xd8, 0xff, 0xd0, 0xff, 0x01, 0xff, 0xd9, 5])];
        for (const fixture of fixtures) for (let size = 0; size <= fixture.length; size++) {
            const bytes = fixture.slice(0, size);
            expect(await hashImageByteRanges(size, async (offset, length) => {
                expect(length).toBeLessThanOrEqual(4);
                return bytes.slice(offset, offset + length).buffer;
            }, 4)).toBe(await hashImageBytes(bytes));
        }
    });

    it('verifies in bounded pieces, retains only a verification result, and seeks for warm reads', async () => {
        storage.bytes = new Uint8Array(3 * 1024 ** 2 + 19).fill(73);
        storage.read.mockImplementation(async (_blob, position, length) => {
            expect(length).toBeLessThanOrEqual(1024 ** 2);
            return storage.bytes.slice(position, position + length).buffer;
        });
        const hash = await hashImageBytes(storage.bytes);
        const blob = hash as SHA256Hash<BLOB>;
        await Promise.all([readVerifiedOriginalRange(blob, hash, storage.bytes.length, 1024 ** 2 - 3, 12),
            readVerifiedOriginalRange(blob, hash, storage.bytes.length, 2 * 1024 ** 2, 12)]);
        // One shared verification: header + four chunks, followed by two range reads.
        expect(storage.read).toHaveBeenCalledTimes(7);
        storage.read.mockClear();
        expect(new Uint8Array(await readVerifiedOriginalRange(blob, hash, storage.bytes.length, 7, 12)))
            .toEqual(storage.bytes.slice(7, 19));
        expect(storage.read.mock.calls).toEqual([[blob, 7, 12]]);
        expect((await readVerifiedOriginalRange(blob, hash, storage.bytes.length, storage.bytes.length - 2, 12)).byteLength).toBe(2);
        await expect(readVerifiedOriginalRange(blob, hash, storage.bytes.length, 0, 1024 ** 2 + 1)).rejects.toThrow('chunk size');
        await expect(readVerifiedOriginalRange(blob, hash, storage.bytes.length, Number.MAX_SAFE_INTEGER, 1)).rejects.toThrow('range');
        await expect(readVerifiedOriginalRange(blob, hash, 2, 0, 1)).rejects.toThrow('size mismatch');
        await expect(readVerifiedOriginalRange(blob, 'incorrect', storage.bytes.length, 0, 1)).rejects.toThrow('hash mismatch');
    });
});
