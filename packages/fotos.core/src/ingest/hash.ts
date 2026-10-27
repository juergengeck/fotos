// hash.ts
import {sha256} from '@noble/hashes/sha256';
import {bytesToHex} from '@noble/hashes/utils';
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
    const bytes = data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return bytesToHex(sha256(bytes));
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
