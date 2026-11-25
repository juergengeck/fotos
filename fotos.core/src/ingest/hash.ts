// hash.ts
import { createHash } from 'node:crypto';
import {
    isJpeg,
    stripJpegMetadata,
    normalizeImageBytesForContentHash,
} from '../content-hash.js';

export {
    isJpeg,
    stripJpegMetadata,
    normalizeImageBytesForContentHash,
};

export async function sha256Hex(data: ArrayBuffer | ArrayBufferView): Promise<string> {
    const hash = createHash('sha256');
    const bytes = data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    hash.update(bytes);
    return hash.digest('hex');
}

export async function hashImageBytes(bytes: Uint8Array): Promise<string> {
    const data = normalizeImageBytesForContentHash(bytes);
    return sha256Hex(data);
}

/** Hash the same normalized media identity using bounded, exact byte ranges. */
export async function hashImageByteRanges(size: number,
    read: (position: number, length: number) => Promise<ArrayBuffer>, chunkSize = 1024 * 1024): Promise<string> {
    if (!Number.isSafeInteger(size) || size < 0 || !Number.isSafeInteger(chunkSize) || chunkSize < 4) {
        throw new RangeError('Invalid media hash range');
    }
    const hash = createHash('sha256');
    async function bytes(position: number, length: number): Promise<Uint8Array> {
        const result = new Uint8Array(await read(position, length));
        if (result.byteLength !== length) throw new Error('Fotos original was truncated during verification');
        return result;
    }
    async function append(start: number, end: number): Promise<void> {
        for (let position = start; position < end; position += chunkSize) {
            hash.update(await bytes(position, Math.min(chunkSize, end - position)));
        }
    }
    const header = await bytes(0, Math.min(2, size));
    if (!isJpeg(header)) {
        await append(0, size);
    } else {
        hash.update(header);
        // Keep the exact stripJpegMetadata rules, including malformed/trailing bytes.
        let position = 2;
        while (position < size - 1) {
            const markerBytes = await bytes(position, Math.min(4, size - position));
            if (markerBytes[0] !== 0xff) break;
            const marker = markerBytes[1];
            if (marker === 0xd9) { hash.update(markerBytes.subarray(0, 2)); break; }
            if (marker === 0xda) { await append(position, size); break; }
            if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
                hash.update(markerBytes.subarray(0, 2)); position += 2; continue;
            }
            if (markerBytes.length < 4) break;
            const end = position + 2 + (markerBytes[2] << 8 | markerBytes[3]);
            if (!((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe)) {
                await append(position, Math.min(size, end));
            }
            position = end;
        }
    }
    return hash.digest('hex');
}

export async function computeStreamId(
    contentHash: string,
    exifDate: string | undefined,
    mime: string
): Promise<string> {
    if (exifDate) {
        const encoder = new TextEncoder();
        return sha256Hex(encoder.encode(`browser:${exifDate}:${mime}`));
    }
    return contentHash;
}
