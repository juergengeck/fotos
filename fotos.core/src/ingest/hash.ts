// hash.ts
import { createHash } from 'node:crypto';

export function isJpeg(buf: Uint8Array): boolean {
    return buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8;
}

/**
 * Strip JPEG metadata segments (APPn, COM) so content hash is stable
 * across metadata edits.
 */
export function stripJpegMetadata(buf: Uint8Array): Uint8Array {
    const chunks: Uint8Array[] = [];
    chunks.push(buf.slice(0, 2)); // SOI

    let pos = 2;
    while (pos < buf.length - 1) {
        if (buf[pos] !== 0xff) break;
        const marker = buf[pos + 1];

        if (marker === 0xd9) { chunks.push(buf.slice(pos, pos + 2)); break; }
        if (marker === 0xda) { chunks.push(buf.slice(pos)); break; }
        if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
            chunks.push(buf.slice(pos, pos + 2));
            pos += 2;
            continue;
        }
        if (pos + 3 >= buf.length) break;
        const segLen = (buf[pos + 2] << 8) | buf[pos + 3];
        if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) {
            pos += 2 + segLen;
            continue;
        }
        chunks.push(buf.slice(pos, pos + 2 + segLen));
        pos += 2 + segLen;
    }

    let total = 0;
    for (const c of chunks) total += c.length;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { out.set(c, offset); offset += c.length; }
    return out;
}

export async function sha256Hex(data: BufferSource): Promise<string> {
    const hash = createHash('sha256');
    if (data instanceof ArrayBuffer) {
        hash.update(Buffer.from(data));
    } else {
        const view = data as Uint8Array;
        hash.update(Buffer.from(view.buffer, view.byteOffset, view.byteLength));
    }
    return hash.digest('hex');
}

export async function hashImageBytes(bytes: Uint8Array): Promise<string> {
    const data = isJpeg(bytes) ? stripJpegMetadata(bytes) : bytes;
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
