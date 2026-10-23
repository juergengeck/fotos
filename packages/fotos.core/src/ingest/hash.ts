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
    if (data instanceof ArrayBuffer) {
        hash.update(Buffer.from(data));
    } else {
        hash.update(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    }
    return hash.digest('hex');
}

export async function hashImageBytes(bytes: Uint8Array): Promise<string> {
    const data = normalizeImageBytesForContentHash(bytes);
    return sha256Hex(data);
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
