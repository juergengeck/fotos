/**
 * Content-hash normalization for media payloads.
 *
 * The canonical fotos identity is the hash of meaningful media bytes, not
 * transport/container metadata. For JPEG we strip APPn and COM segments so the
 * same image converges even when headers are rewritten.
 */

export function isJpeg(buf: Uint8Array): boolean {
    return buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8;
}

/**
 * Strip JPEG metadata segments (APPn, COM) so content hash is stable across
 * metadata edits.
 */
export function stripJpegMetadata(buf: Uint8Array): Uint8Array {
    const chunks: Uint8Array[] = [];
    chunks.push(buf.slice(0, 2)); // SOI

    let pos = 2;
    while (pos < buf.length - 1) {
        if (buf[pos] !== 0xff) {
            break;
        }

        const marker = buf[pos + 1];

        if (marker === 0xd9) {
            chunks.push(buf.slice(pos, pos + 2));
            break;
        }

        if (marker === 0xda) {
            chunks.push(buf.slice(pos));
            break;
        }

        if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
            chunks.push(buf.slice(pos, pos + 2));
            pos += 2;
            continue;
        }

        if (pos + 3 >= buf.length) {
            break;
        }

        const segLen = (buf[pos + 2] << 8) | buf[pos + 3];
        if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) {
            pos += 2 + segLen;
            continue;
        }

        chunks.push(buf.slice(pos, pos + 2 + segLen));
        pos += 2 + segLen;
    }

    let total = 0;
    for (const chunk of chunks) {
        total += chunk.length;
    }

    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }

    return out;
}

export function normalizeImageBytesForContentHash(bytes: Uint8Array): Uint8Array {
    return isJpeg(bytes) ? stripJpegMetadata(bytes) : bytes;
}
