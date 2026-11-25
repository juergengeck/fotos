import type {BLOB} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';
import {fileSize} from '@refinio/one.core/lib/system/storage-base.js';
import {readBlobRange} from '@refinio/one.core/lib/storage-blob.js';
import {assertReadRange, FILER_READ_CHUNK_SIZE, ReadBudget} from '@refinio/filer.core/reads';
import {hashImageByteRanges} from './ingest/hash.js';

// Only verification results are retained, never original bytes. Admission is separate
// from the calling transport budget so a native read cannot wait on its own slot.
const verificationBudget = new ReadBudget();
const verified = new Map<string, {done: boolean; promise: Promise<void>}>();
const verificationLimit = 64;

/** Verify an immutable original once, then seek directly for subsequent ranges. */
export async function readVerifiedOriginalRange(blob: SHA256Hash<BLOB>, contentHash: string,
    size: number, position: number, length: number): Promise<ArrayBuffer> {
    assertReadRange(position, length);
    assertReadRange(0, size);
    if (length > FILER_READ_CHUNK_SIZE) throw Object.assign(new RangeError('Fotos range exceeds chunk size'), {code: -22});
    if (await fileSize(blob) !== size) throw new Error('Fotos original size mismatch');
    const key = JSON.stringify([blob, contentHash, size]);
    let verification = verified.get(key);
    if (!verification) {
        if (verified.size >= verificationLimit) {
            const oldest = [...verified].find(([, value]) => value.done);
            if (!oldest) throw Object.assign(new Error('Fotos verification queue is full'), {code: -16});
            verified.delete(oldest[0]);
        }
        verification = {done: false, promise: verificationBudget.run(async function () {
            const actual = await hashImageByteRanges(size, (offset, count) => readBlobRange(blob, offset, count), FILER_READ_CHUNK_SIZE);
            if (actual !== contentHash) throw new Error('Fotos original content hash mismatch');
        })};
        verified.set(key, verification);
    }
    try {
        await verification.promise;
        verification.done = true;
    } catch (error) {
        if (verified.get(key) === verification) verified.delete(key);
        throw error;
    }
    return readBlobRange(blob, position, length);
}
