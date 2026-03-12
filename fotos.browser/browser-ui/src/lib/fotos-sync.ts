/**
 * fotos-sync -- sync filesystem PhotoEntry objects to ONE.core FotosEntry objects.
 *
 * Converts in-memory PhotoEntry data (from one/index.html parsing) to versioned
 * FotosEntry objects stored in ONE.core. Thumbnails are stored as BLOBs and
 * referenced from the FotosEntry.
 *
 * Designed to run fire-and-forget after folder scan completes.
 * Idempotent: re-storing an identical FotosEntry (same contentHash isId) is a no-op.
 */

import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';
import type {BLOB} from '@refinio/one.core/lib/recipes.js';
import {
    storeVersionedObject,
    onVersionedObj,
} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {storeArrayBufferAsBlob, readBlobAsArrayBuffer} from '@refinio/one.core/lib/storage-blob.js';
import {getInstanceOwnerIdHash} from '@refinio/one.core/lib/instance.js';
import {addEntryToManifest} from './fotos-manifest.js';
import {EMBEDDING_DIM, facesToDataAttrs} from '@refinio/fotos.core';
import type {FaceResult, FaceAnalysisResult, FotosEntry} from '@refinio/fotos.core';
import type {PhotoEntry} from '@/types/fotos';

/**
 * Infer MIME type from file extension.
 */
function mimeFromName(name: string): string {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    const map: Record<string, string> = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        webp: 'image/webp',
        avif: 'image/avif',
        heic: 'image/heic',
        heif: 'image/heif',
        tiff: 'image/tiff',
        tif: 'image/tiff',
        bmp: 'image/bmp',
        svg: 'image/svg+xml',
        mp4: 'video/mp4',
        mov: 'video/quicktime',
        avi: 'video/x-msvideo',
        mkv: 'video/x-matroska',
        webm: 'video/webm',
    };
    return map[ext] ?? 'application/octet-stream';
}

/**
 * Read a file from the directory handle tree by relative path.
 */
async function readFileFromHandle(
    rootHandle: FileSystemDirectoryHandle,
    relativePath: string
): Promise<File> {
    const segments = relativePath.split('/').filter(Boolean);
    let dirHandle = rootHandle;
    for (let i = 0; i < segments.length - 1; i++) {
        dirHandle = await dirHandle.getDirectoryHandle(segments[i]);
    }
    const fileHandle = await dirHandle.getFileHandle(segments[segments.length - 1]);
    return fileHandle.getFile();
}

/**
 * Store a thumbnail file as a ONE.core BLOB.
 *
 * @param rootHandle - The root directory handle for file access
 * @param thumbPath - Relative path to the thumbnail file
 * @returns The BLOB hash, or undefined if the thumbnail cannot be read
 */
async function storeThumbnailBlob(
    rootHandle: FileSystemDirectoryHandle,
    thumbPath: string
): Promise<SHA256Hash<BLOB> | undefined> {
    try {
        const file = await readFileFromHandle(rootHandle, thumbPath);
        const buffer = await file.arrayBuffer();
        const result = await storeArrayBufferAsBlob(buffer);
        return result.hash;
    } catch (err) {
        console.warn(`[fotos-sync] Failed to store thumbnail ${thumbPath}:`, err);
        return undefined;
    }
}

// ---------------------------------------------------------------------------
// Face data extraction from CHUM-synced FotosEntry BLOBs
// ---------------------------------------------------------------------------

export interface ExtractedFaceData {
    /** Face analysis result with bboxes, embeddings, crop paths */
    faces: FaceAnalysisResult;
    /** Data attributes ready for one/index.html writing */
    dataAttrs: Record<string, string>;
    /** Raw crop image data (array of JPEG blobs), one per face */
    cropBlobs: ArrayBuffer[];
}

/**
 * Extract face data from a CHUM-synced FotosEntry.
 *
 * Reads faceEmbeddings and faceCrops BLOBs from ONE.core storage, deserializes
 * them, and returns a structure ready for writing to one/index.html and one/faces/.
 *
 * The embeddings BLOB contains a raw Float32Array (512 floats per face, concatenated).
 * The crops BLOB contains concatenated JPEGs separated by a 4-byte length prefix
 * per image: [uint32 length][jpeg bytes][uint32 length][jpeg bytes]...
 *
 * If only faceCount is available (no BLOBs), returns minimal face data with count only.
 */
export async function extractFaceDataFromEntry(entry: FotosEntry): Promise<ExtractedFaceData | null> {
    if (!entry.faceCount || entry.faceCount <= 0) return null;

    const faceCount = entry.faceCount;
    const faceResults: FaceResult[] = [];
    const cropBlobs: ArrayBuffer[] = [];

    // Load embeddings BLOB if present
    let embeddings: Float32Array | null = null;
    if (entry.faceEmbeddings) {
        try {
            const buffer = await readBlobAsArrayBuffer(entry.faceEmbeddings);
            embeddings = new Float32Array(buffer);
        } catch (err) {
            console.warn('[fotos-sync] Failed to read faceEmbeddings BLOB:', err);
        }
    }

    // Load face crops BLOB if present
    // Format: [uint32 length][jpeg bytes][uint32 length][jpeg bytes]...
    if (entry.faceCrops) {
        try {
            const buffer = await readBlobAsArrayBuffer(entry.faceCrops);
            const view = new DataView(buffer);
            let offset = 0;
            while (offset + 4 <= buffer.byteLength) {
                const len = view.getUint32(offset, true); // little-endian
                offset += 4;
                if (offset + len > buffer.byteLength) break;
                cropBlobs.push(buffer.slice(offset, offset + len));
                offset += len;
            }
        } catch (err) {
            console.warn('[fotos-sync] Failed to read faceCrops BLOB:', err);
        }
    }

    // Build FaceResult array
    for (let i = 0; i < faceCount; i++) {
        const embedding = embeddings
            ? Array.from(embeddings.slice(i * EMBEDDING_DIM, (i + 1) * EMBEDDING_DIM))
            : new Array<number>(EMBEDDING_DIM).fill(0);

        const cropPath = cropBlobs.length > i
            ? `faces/${entry.contentHash}-face-${i}.jpg`
            : undefined;

        faceResults.push({
            detection: {bbox: [0, 0, 0, 0], score: 0, landmarks: []},
            embedding,
            cropPath,
        });
    }

    const faces: FaceAnalysisResult = {faces: faceResults};
    const dataAttrs = facesToDataAttrs(faces);

    return {faces, dataAttrs, cropBlobs};
}

/**
 * Write face crop images to one/faces/ directory via File System Access API.
 *
 * Each crop is written as {contentHash}-face-{index}.jpg.
 */
export async function writeFaceCropsToFilesystem(
    rootHandle: FileSystemDirectoryHandle,
    photo: PhotoEntry,
    contentHash: string,
    cropBlobs: ArrayBuffer[]
): Promise<void> {
    if (cropBlobs.length === 0) return;

    // Navigate to photo's parent directory
    const segments = (photo.sourcePath ?? '').split('/').filter(Boolean);
    let dirHandle = rootHandle;
    for (let i = 0; i < segments.length - 1; i++) {
        dirHandle = await dirHandle.getDirectoryHandle(segments[i]);
    }

    const oneDir = await dirHandle.getDirectoryHandle('one', {create: true});
    const facesDir = await oneDir.getDirectoryHandle('faces', {create: true});

    for (let i = 0; i < cropBlobs.length; i++) {
        const cropName = `${contentHash}-face-${i}.jpg`;
        const fh = await facesDir.getFileHandle(cropName, {create: true});
        const wr = await fh.createWritable();
        await wr.write(cropBlobs[i]);
        await wr.close();
    }
}

/**
 * Sync a single PhotoEntry to a ONE.core FotosEntry.
 *
 * Builds a FotosEntry from the PhotoEntry fields, optionally stores thumbnail
 * as a BLOB, stores the versioned object, and adds it to the manifest.
 *
 * @param photo - The PhotoEntry from filesystem scanning
 * @param rootHandle - The root directory handle (for reading thumbnail files)
 */
export async function syncPhotoToOneCore(
    photo: PhotoEntry,
    rootHandle: FileSystemDirectoryHandle | null
): Promise<void> {
    // Build the FotosEntry
    const entry: Record<string, unknown> = {
        $type$: 'FotosEntry',
        contentHash: photo.hash,
        streamId: photo.hash,
        mime: mimeFromName(photo.name),
        size: photo.size,
    };

    if (photo.capturedAt) entry.capturedAt = photo.capturedAt;
    if (photo.updatedAt) entry.updatedAt = photo.updatedAt;
    if (photo.sourcePath) entry.sourcePath = photo.sourcePath;
    if (photo.folderPath) entry.folderPath = photo.folderPath;

    // Map EXIF fields
    const exif = photo.exif;
    if (exif) {
        if (exif.date) entry.exifDate = exif.date;
        if (exif.camera) entry.exifCamera = exif.camera;
        if (exif.lens) entry.exifLens = exif.lens;
        if (exif.focalLength) entry.exifFocalLength = exif.focalLength;
        if (exif.aperture) entry.exifAperture = exif.aperture;
        if (exif.shutter) entry.exifShutter = exif.shutter;
        if (exif.iso !== undefined) entry.exifIso = exif.iso;
        if (exif.gps) {
            entry.exifGpsLat = exif.gps.lat;
            entry.exifGpsLon = exif.gps.lon;
        }
        if (exif.width !== undefined) entry.exifWidth = exif.width;
        if (exif.height !== undefined) entry.exifHeight = exif.height;
    }

    // Store thumbnail as BLOB if available
    if (photo.thumb && rootHandle) {
        const thumbHash = await storeThumbnailBlob(rootHandle, photo.thumb);
        if (thumbHash) {
            entry.thumb = thumbHash;
        }
    }

    // Map face data
    if (photo.faces && photo.faces.count > 0) {
        entry.faceCount = photo.faces.count;
    }

    // Store the versioned object (idempotent — same contentHash isId = same object)
    const result = await storeVersionedObject(entry as unknown as FotosEntry);

    // Add to manifest
    await addEntryToManifest(result.hash as SHA256Hash<FotosEntry>);
}

/**
 * Sync all PhotoEntry objects to ONE.core.
 *
 * Runs sequentially to avoid overwhelming IndexedDB with concurrent writes.
 * Logs progress to console.
 *
 * @param photos - The PhotoEntry array from folder scanning
 * @param rootHandle - The root directory handle (for reading thumbnail files)
 */
export async function syncPhotosToOneCore(
    photos: PhotoEntry[],
    rootHandle: FileSystemDirectoryHandle | null
): Promise<void> {
    // Guard: only run if ONE.core is booted
    if (!getInstanceOwnerIdHash()) {
        console.warn('[fotos-sync] ONE.core not initialized, skipping sync');
        return;
    }

    if (photos.length === 0) return;

    console.log(`[fotos-sync] Syncing ${photos.length} photos to ONE.core...`);

    let synced = 0;
    let errors = 0;

    for (const photo of photos) {
        try {
            await syncPhotoToOneCore(photo, rootHandle);
            synced++;
        } catch (err) {
            errors++;
            console.warn(`[fotos-sync] Failed to sync ${photo.name}:`, err);
        }
    }

    console.log(`[fotos-sync] Complete: ${synced} synced, ${errors} errors`);
}

/**
 * Listen for FotosEntry objects arriving via CHUM sync from remote peers.
 *
 * When a peer enriches a FotosEntry with face data (faceCount, faceEmbeddings,
 * faceCrops), the updated version propagates via CHUM. This listener detects
 * those incoming versions and calls the callback so the UI can merge the
 * enrichment into in-memory PhotoEntry state.
 *
 * Skips entries with status 'exists' (already in storage) to avoid processing
 * objects we just stored ourselves.
 *
 * @param onEntryReceived - Called with the full FotosEntry when a new version arrives
 * @returns Unsubscribe function for cleanup
 */
export function listenForFotosUpdates(
    onEntryReceived: (entry: FotosEntry) => void,
): () => void {
    return onVersionedObj.addListener(result => {
        // Only process newly stored objects, not re-reads of existing ones
        if (result.status === 'exists') return;

        // Filter to FotosEntry type only
        if ((result.obj as { $type$: string }).$type$ !== 'FotosEntry') return;

        const entry = result.obj as unknown as FotosEntry;
        onEntryReceived(entry);
    });
}
