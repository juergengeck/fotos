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

import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {BLOB} from '@refinio/one.core/lib/recipes.js';
import {
    storeVersionedObject,
    onVersionedObj,
} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {storeArrayBufferAsBlob, readBlobAsArrayBuffer} from '@refinio/one.core/lib/storage-blob.js';
import {getInstanceIdHash, getInstanceOwnerIdHash} from '@refinio/one.core/lib/instance.js';
import {calculateIdHashOfObj} from '@refinio/one.core/lib/util/object.js';
import {
    addAuthenticityAttestationToManifest,
    addEntryToManifest,
} from './fotos-manifest.js';
import {EMBEDDING_DIM, facesToDataAttrs} from '@refinio/fotos.core';
import type {
    FaceResult,
    FaceAnalysisResult,
    FotosEntry,
} from '@refinio/fotos.core';
import type {PhotoEntry} from '@/types/fotos';
import {
    createFotosAuthenticityAttestation,
    resolveFotosAuthenticityContext,
    type FotosAuthenticityContext,
} from './fotos-authenticity.js';
import type { FotosAuthenticityAttestation } from '../../../../fotos.core/src/recipes/FotosRecipes.js';
import type {FotosMediaVariant} from '../../../../fotos.core/src/recipes/FotosMediaRecipes.js';
import {
    createFotosMediaLocator,
    createFotosMediaVariant,
} from '../../../../fotos.core/src/media-model.js';

export interface SyncPhotosToOneCoreOptions {
    claimAuthorship?: boolean;
}

export function shouldClaimFotosAuthorship(
    options: SyncPhotosToOneCoreOptions = {},
): boolean {
    return options.claimAuthorship !== false;
}

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

async function storeEphemeralThumbnailBlob(
    thumbUrl: string,
): Promise<SHA256Hash<BLOB> | undefined> {
    try {
        const response = await fetch(thumbUrl);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const buffer = await response.arrayBuffer();
        const result = await storeArrayBufferAsBlob(buffer);
        return result.hash;
    } catch (err) {
        console.warn(`[fotos-sync] Failed to store ephemeral thumbnail ${thumbUrl}:`, err);
        return undefined;
    }
}

function isPersistentBrowserLocator(locator: string | undefined): locator is string {
    if (!locator) {
        return false;
    }

    const trimmed = locator.trim();
    return trimmed.length > 0 && !trimmed.startsWith('blob:') && !trimmed.startsWith('data:');
}

function collectOriginalVariantLocators(photo: PhotoEntry): string[] {
    const values = new Set<string>();

    if (isPersistentBrowserLocator(photo.sourcePath)) {
        values.add(photo.sourcePath);
    }

    for (const copyPath of photo.copies ?? []) {
        if (isPersistentBrowserLocator(copyPath)) {
            values.add(copyPath);
        }
    }

    return [...values];
}

async function storeBrowserLocator(params: {
    variant: SHA256IdHash<FotosMediaVariant>;
    locator: string;
    kind: 'relative-path' | 'filesystem-path';
    lastVerifiedAt?: string;
}): Promise<void> {
    const instanceId = getInstanceIdHash();
    const locator = createFotosMediaLocator({
        variant: params.variant,
        platform: 'browser',
        kind: params.kind,
        scope: 'device-local',
        locator: params.locator,
        ...(instanceId ? {deviceId: String(instanceId)} : {}),
        ...(params.lastVerifiedAt ? {lastVerifiedAt: params.lastVerifiedAt} : {}),
    });

    await storeVersionedObject(locator as any);
}

async function storeFotosMediaState(
    photo: PhotoEntry,
    entryIdHash: SHA256IdHash<FotosEntry>,
    mime: string,
    thumbBlobHash?: SHA256Hash<BLOB>,
): Promise<Set<SHA256Hash<FotosMediaVariant>>> {
    const variants = new Set<SHA256Hash<FotosMediaVariant>>();

    const originalVariant = createFotosMediaVariant({
        contentHash: photo.hash,
        family: entryIdHash,
        role: 'original',
        mime,
        byteSize: photo.size,
        width: photo.exif?.width,
        height: photo.exif?.height,
        createdAt: photo.capturedAt ?? photo.addedAt ?? photo.updatedAt,
        label: photo.name,
    });
    const originalVariantResult = await storeVersionedObject(originalVariant as any);
    variants.add(originalVariantResult.hash as SHA256Hash<FotosMediaVariant>);

    const locatorTimestamp = photo.updatedAt ?? photo.addedAt ?? photo.capturedAt;
    for (const relativePath of collectOriginalVariantLocators(photo)) {
        await storeBrowserLocator({
            variant: originalVariantResult.idHash as SHA256IdHash<FotosMediaVariant>,
            locator: relativePath,
            kind: 'relative-path',
            ...(locatorTimestamp ? {lastVerifiedAt: locatorTimestamp} : {}),
        });
    }

    if (!thumbBlobHash) {
        return variants;
    }

    const thumbVariant = createFotosMediaVariant({
        contentHash: String(thumbBlobHash),
        family: entryIdHash,
        role: 'thumbnail',
        mime: 'image/jpeg',
        blob: thumbBlobHash,
        derivedFrom: originalVariantResult.idHash as SHA256IdHash<FotosMediaVariant>,
        createdAt: photo.updatedAt ?? photo.addedAt ?? photo.capturedAt,
        label: 'thumb',
    });
    const thumbVariantResult = await storeVersionedObject(thumbVariant as any);
    variants.add(thumbVariantResult.hash as SHA256Hash<FotosMediaVariant>);

    if (isPersistentBrowserLocator(photo.thumb)) {
        await storeBrowserLocator({
            variant: thumbVariantResult.idHash as SHA256IdHash<FotosMediaVariant>,
            locator: photo.thumb,
            kind: 'relative-path',
            ...(locatorTimestamp ? {lastVerifiedAt: locatorTimestamp} : {}),
        });
    }

    return variants;
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

export async function extractThumbUrlFromEntry(entry: FotosEntry): Promise<string | null> {
    if (!entry.thumb) {
        return null;
    }

    try {
        const buffer = await readBlobAsArrayBuffer(entry.thumb);
        return URL.createObjectURL(new Blob([buffer], {
            type: entry.mime || 'application/octet-stream',
        }));
    } catch (err) {
        console.warn('[fotos-sync] Failed to read thumb BLOB:', err);
        return null;
    }
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
    rootHandle: FileSystemDirectoryHandle | null,
    authenticityContext: FotosAuthenticityContext | null = null,
): Promise<void> {
    // Build the FotosEntry
    const mime = mimeFromName(photo.name);
    const entry: FotosEntry = {
        $type$: 'FotosEntry',
        contentHash: photo.hash,
        streamId: photo.hash,
        mime,
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
    let thumbHash: SHA256Hash<BLOB> | undefined;
    if (photo.thumb) {
        thumbHash = rootHandle
            ? await storeThumbnailBlob(rootHandle, photo.thumb)
            : (photo.thumb.startsWith('blob:') || photo.thumb.startsWith('data:'))
                ? await storeEphemeralThumbnailBlob(photo.thumb)
                : undefined;
        if (thumbHash) {
            entry.thumb = thumbHash;
        }
    }

    // Map face data
    if (photo.faces && photo.faces.count > 0) {
        entry.faceCount = photo.faces.count;
    }

    const entryIdHash = await calculateIdHashOfObj(entry as any) as SHA256IdHash<FotosEntry>;
    const variants = await storeFotosMediaState(photo, entryIdHash, mime, thumbHash);
    if (variants.size > 0) {
        entry.variants = variants;
    }

    // Store the versioned object (idempotent — same contentHash isId = same object)
    const result = await storeVersionedObject(entry as unknown as FotosEntry);

    // Add to manifest
    await addEntryToManifest(result.hash as SHA256Hash<FotosEntry>);

    if (!authenticityContext) {
        return;
    }

    try {
        const attestation = createFotosAuthenticityAttestation(photo.hash, authenticityContext);
        const attestationResult = await storeVersionedObject(
            attestation as unknown as FotosAuthenticityAttestation,
        );
        await addAuthenticityAttestationToManifest(
            attestationResult.hash as SHA256Hash<FotosAuthenticityAttestation>,
        );
    } catch (err) {
        console.warn(`[fotos-sync] Failed to create authenticity attestation for ${photo.name}:`, err);
    }
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
    rootHandle: FileSystemDirectoryHandle | null,
    options: SyncPhotosToOneCoreOptions = {},
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
    const authenticityContext = shouldClaimFotosAuthorship(options)
        ? await resolveFotosAuthenticityContext().catch(err => {
            console.warn('[fotos-sync] Authenticity signing unavailable:', err);
            return null;
        })
        : null;

    for (const photo of photos) {
        try {
            await syncPhotoToOneCore(photo, rootHandle, authenticityContext);
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
 * @param onEntryReceived - Called with the full FotosEntry and its version hash when a new version arrives
 * @returns Unsubscribe function for cleanup
 */
export function listenForFotosUpdates(
    onEntryReceived: (
        entry: FotosEntry,
        metadata: { versionHash: string | null },
    ) => void,
): () => void {
    return onVersionedObj.addListener(result => {
        // Only process newly stored objects, not re-reads of existing ones
        if (result.status === 'exists') return;

        // Filter to FotosEntry type only
        if ((result.obj as { $type$: string }).$type$ !== 'FotosEntry') return;

        const entry = result.obj as unknown as FotosEntry;
        onEntryReceived(entry, {
            versionHash: typeof result.hash === 'string' ? result.hash : null,
        });
    });
}
