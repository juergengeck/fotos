/**
 * Content-hash normalization for media payloads.
 *
 * The canonical fotos identity is the hash of meaningful media bytes, not
 * transport/container metadata. For JPEG we strip APPn and COM segments so the
 * same image converges even when headers are rewritten. For PNG, retain the
 * image data, sample format, palette, and transparency.
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

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_IMAGE_CHUNKS = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND', 'acTL', 'fcTL', 'fdAT']);
const PNG_CRC_TABLE = Uint32Array.from({length: 256}, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit++) {
        value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    }
    return value;
});

export function isPng(bytes: Uint8Array): boolean {
    return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

function validPngCrc(bytes: Uint8Array, start: number, end: number, expected: number): boolean {
    let crc = 0xffffffff;
    for (let index = start; index < end; index++) {
        crc = (crc >>> 8) ^ PNG_CRC_TABLE[(crc ^ bytes[index]) & 0xff];
    }
    return ((crc ^ 0xffffffff) >>> 0) === expected;
}

function stripPngMetadata(bytes: Uint8Array): Uint8Array {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const chunks = [bytes.subarray(0, PNG_SIGNATURE.length)];
    let offset = PNG_SIGNATURE.length;
    let size = offset;
    let previous = '';
    let sawData = false;
    let sawPalette = false;
    let sawTransparency = false;
    let colorType = 0;

    while (offset + 12 <= bytes.length) {
        const length = view.getUint32(offset);
        const data = offset + 8;
        const crcOffset = data + length;
        const end = crcOffset + 4;
        if (length > 0x7fffffff || end > bytes.length) return bytes;
        const type = String.fromCharCode(...bytes.subarray(offset + 4, data));
        if (!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type)
            || !validPngCrc(bytes, offset + 4, crcOffset, view.getUint32(crcOffset))) return bytes;
        // Fall back for PNG extensions whose image data we cannot normalize.
        if (!PNG_IMAGE_CHUNKS.has(type) && type[0] === type[0].toUpperCase()) return bytes;

        switch (type) {
            case 'IHDR':
                if (previous || length !== 13 || !view.getUint32(data) || !view.getUint32(data + 4)) return bytes;
                colorType = bytes[data + 9];
                break;
            case 'PLTE':
                if (sawData || sawPalette || sawTransparency || length === 0 || length > 768 || length % 3 !== 0) return bytes;
                sawPalette = true;
                break;
            case 'tRNS':
                if (sawData || sawTransparency || (colorType === 3 && !sawPalette)) return bytes;
                sawTransparency = true;
                break;
            case 'IDAT':
                if ((sawData && previous !== 'IDAT') || (colorType === 3 && !sawPalette)) return bytes;
                sawData = true;
                break;
            case 'IEND':
                if (!sawData || length !== 0 || end !== bytes.length) return bytes;
                break;
        }
        if (!previous && type !== 'IHDR') return bytes;
        if (PNG_IMAGE_CHUNKS.has(type)) {
            chunks.push(bytes.subarray(offset, end));
            size += end - offset;
        }
        previous = type;
        offset = end;
    }
    if (previous !== 'IEND' || size === bytes.length) return bytes;

    const normalized = new Uint8Array(size);
    let position = 0;
    for (const chunk of chunks) {
        normalized.set(chunk, position);
        position += chunk.length;
    }
    return normalized;
}

export function normalizeImageBytesForContentHash(bytes: Uint8Array): Uint8Array {
    if (isJpeg(bytes)) return stripJpegMetadata(bytes);
    return isPng(bytes) ? stripPngMetadata(bytes) : bytes;
}

/** Verify a canonical hash, or the exact bytes of an existing pre-normalization PNG. */
export async function matchesImageContentHash(
    bytes: Uint8Array,
    expected: string,
    digest: (bytes: Uint8Array) => Promise<string>,
): Promise<boolean> {
    const normalized = normalizeImageBytesForContentHash(bytes);
    if (await digest(normalized) === expected) return true;
    return normalized !== bytes && isPng(bytes) && await digest(bytes) === expected;
}
