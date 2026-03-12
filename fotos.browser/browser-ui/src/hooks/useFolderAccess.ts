import { useState, useCallback, useRef, useEffect } from 'react';
import { fromByteArray as toBase64, toByteArray as fromBase64 } from 'base64-js';
import type { PhotoEntry, ExifData, FaceInfo, SemanticInfo } from '@/types/fotos';
import {
    dataAttrsToFaces,
    facesToDataAttrs,
    EMBEDDING_DIM,
    FaceClusterDimension,
    getGallerySurfaceProfile,
    planGalleryIntake,
} from '@refinio/fotos.core';
import type {
    FaceAnalysisResult,
    FaceClusterInfo,
    GalleryIntakePlan,
    GallerySurface,
    GallerySurfaceProfile,
} from '@refinio/fotos.core';
import { ingestDirectory, ingestFiles, type IngestProgress, type FaceWorkerHandle } from '@/lib/browserIngest';
import { createFaceWorker } from '@/lib/faceWorkerClient';
import { createSemanticWorker } from '@/lib/semanticWorkerClient';
import { isMobile } from '@/lib/platform';
import {
    syncPhotosToOneCore,
    listenForFotosUpdates,
    extractFaceDataFromEntry,
    writeFaceCropsToFilesystem,
} from '@/lib/fotos-sync';
import { traceHang } from '@/lib/hangTrace';
import type { FaceWorkerProgress } from '@/lib/faceWorkerClient';
import faceWorkerUrl from '@/workers/face.worker.ts?worker&url';
import semanticWorkerUrl from '@/workers/semantic.worker.ts?worker&url';

type IndexHtmlNamespace = 'face' | 'semantic';

let indexHtmlWriteChain = Promise.resolve();

function queueIndexHtmlWrite<T>(operation: () => Promise<T>): Promise<T> {
    const next = indexHtmlWriteChain.then(operation, operation);
    indexHtmlWriteChain = next.then(() => undefined, () => undefined);
    return next;
}

function encodeFloat32Base64(values: Float32Array): string {
    return toBase64(new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
}

function decodeFloat32Base64(value: string): Float32Array {
    const bytes = fromBase64(value);
    if (bytes.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
        throw new Error('Invalid Float32 embedding payload');
    }

    return new Float32Array(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
}

function semanticToDataAttrs(semantic: SemanticInfo): Record<string, string> {
    return {
        'semantic-model-id': semantic.modelId,
        'semantic-embedding': encodeFloat32Base64(semantic.embedding),
    };
}

function dataAttrsToSemanticInfo(dataAttrs: Record<string, string>): SemanticInfo | null {
    const modelId = dataAttrs['semantic-model-id'];
    const embedding = dataAttrs['semantic-embedding'];
    if (!modelId || !embedding) {
        return null;
    }

    return {
        modelId,
        embedding: decodeFloat32Base64(embedding),
    };
}

/**
 * Update a one/index.html file to add data-* attributes for a specific photo.
 */
async function updateIndexHtmlData(
    rootHandle: FileSystemDirectoryHandle,
    photo: PhotoEntry,
    namespace: IndexHtmlNamespace,
    dataAttrs: Record<string, string>,
): Promise<void> {
    await queueIndexHtmlWrite(async () => {
        const segments = (photo.sourcePath ?? '').split('/').filter(Boolean);
        let dirHandle = rootHandle;
        for (let i = 0; i < segments.length - 1; i++) {
            dirHandle = await dirHandle.getDirectoryHandle(segments[i]);
        }

        const oneDir = await dirHandle.getDirectoryHandle('one');
        const indexHandle = await oneDir.getFileHandle('index.html');
        const file = await indexHandle.getFile();
        const html = await file.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const photoName = segments[segments.length - 1];

        const rows = Array.from(doc.querySelectorAll<HTMLTableRowElement>('tr.fs-entry'));
        const row = rows.find(candidate => {
            const streamId = candidate.getAttribute('data-stream-id');
            const contentHash = candidate.getAttribute('data-content-hash') ?? candidate.getAttribute('data-hash');
            if (photo.hash && (streamId === photo.hash || contentHash === photo.hash)) {
                return true;
            }

            const linkName = candidate.querySelector('.fs-name a:last-of-type')?.textContent?.trim();
            return linkName === photoName;
        });

        if (!row) {
            console.warn(`[fotos-${namespace}-meta] write-miss`, {
                photo: photo.sourcePath ?? photo.name,
                hash: photo.hash,
            });
            if (namespace === 'face') {
                traceHang('face-metadata-write-miss', {
                    photo: photo.sourcePath ?? photo.name,
                    hash: photo.hash,
                    faceCount: dataAttrs['face-count'] ?? null,
                });
            }
            return;
        }

        for (const attr of [...row.getAttributeNames()]) {
            if (attr.startsWith(`data-${namespace}-`)) {
                row.removeAttribute(attr);
            }
        }

        for (const [key, value] of Object.entries(dataAttrs)) {
            row.setAttribute(`data-${key}`, value);
        }

        const nextHtml = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;

        if (namespace === 'face') {
            console.log('[fotos-face-meta] write', {
                photo: photo.sourcePath ?? photo.name,
                hash: photo.hash,
                faceCount: dataAttrs['face-count'] ?? null,
                clusterCount: dataAttrs['face-cluster-hashes']?.split(';').filter(Boolean).length ?? 0,
                cleared: Object.keys(dataAttrs).length === 0,
            });
            traceHang('face-metadata-write', {
                photo: photo.sourcePath ?? photo.name,
                hash: photo.hash,
                faceCount: dataAttrs['face-count'] ?? null,
                clusterCount: dataAttrs['face-cluster-hashes']?.split(';').filter(Boolean).length ?? 0,
                cleared: Object.keys(dataAttrs).length === 0,
            });
        }

        const writable = await indexHandle.createWritable();
        await writable.write(nextHtml);
        await writable.close();
    });
}

async function updateIndexHtmlFaceData(
    rootHandle: FileSystemDirectoryHandle,
    photo: PhotoEntry,
    dataAttrs: Record<string, string>,
): Promise<void> {
    await updateIndexHtmlData(rootHandle, photo, 'face', dataAttrs);
}

async function updateIndexHtmlSemanticData(
    rootHandle: FileSystemDirectoryHandle,
    photo: PhotoEntry,
    dataAttrs: Record<string, string>,
): Promise<void> {
    await updateIndexHtmlData(rootHandle, photo, 'semantic', dataAttrs);
}

/**
 * Parse a one/index.html DOM to extract photo entries from data-* attributes.
 */
function parseOneIndex(html: string, relPath: string): PhotoEntry[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const rows = doc.querySelectorAll('tr.fs-entry');
    const entries: PhotoEntry[] = [];
    let faceMetaRows = 0;
    let zeroFaceRows = 0;
    let clusteredRows = 0;

    for (const row of rows) {
        const mime = row.getAttribute('data-mime') ?? '';
        if (!mime.startsWith('image/') && !mime.startsWith('video/')) continue;

        const name = row.querySelector('.fs-name')?.textContent?.trim() ?? '';
        const streamId = row.getAttribute('data-stream-id') ?? '';
        const contentHash = row.getAttribute('data-content-hash') ?? row.getAttribute('data-hash') ?? '';
        const thumb = row.getAttribute('data-thumb');
        const sizeText = row.querySelector('.fs-size')?.textContent?.trim() ?? '0';

        const exif: ExifData = {};
        const exifDate = row.getAttribute('data-exif-date');
        if (exifDate) exif.date = exifDate;
        const camera = row.getAttribute('data-exif-camera');
        if (camera) exif.camera = camera;
        const lens = row.getAttribute('data-exif-lens');
        if (lens) exif.lens = lens;
        const focal = row.getAttribute('data-exif-focal');
        if (focal) exif.focalLength = focal;
        const aperture = row.getAttribute('data-exif-aperture');
        if (aperture) exif.aperture = aperture;
        const shutter = row.getAttribute('data-exif-shutter');
        if (shutter) exif.shutter = shutter;
        const iso = row.getAttribute('data-exif-iso');
        if (iso) exif.iso = Number(iso);
        const gps = row.getAttribute('data-exif-gps');
        if (gps) {
            const [lat, lon] = gps.split(',').map(Number);
            if (!isNaN(lat) && !isNaN(lon)) exif.gps = { lat, lon };
        }
        const w = row.getAttribute('data-exif-width');
        if (w) exif.width = Number(w);
        const h = row.getAttribute('data-exif-height');
        if (h) exif.height = Number(h);

        // Parse face data
        let faces: FaceInfo | undefined;
        let semantic: SemanticInfo | null | undefined;
        const faceCount = row.getAttribute('data-face-count');
        if (faceCount !== null) {
            const parsedCount = parseInt(faceCount, 10);
            if (!Number.isNaN(parsedCount) && parsedCount >= 0) {
                faceMetaRows += 1;
                if (parsedCount === 0) {
                    zeroFaceRows += 1;
                    faces = { count: 0, bboxes: [], scores: [], embeddings: null, crops: [] };
                } else {
                    const dataMap: Record<string, string> = {};
                    dataMap['face-count'] = faceCount;
                    const bboxes = row.getAttribute('data-face-bboxes');
                    if (bboxes) dataMap['face-bboxes'] = bboxes;
                    const scores = row.getAttribute('data-face-scores');
                    if (scores) dataMap['face-scores'] = scores;
                    const embeddings = row.getAttribute('data-face-embeddings');
                    if (embeddings) dataMap['face-embeddings'] = embeddings;
                    const crops = row.getAttribute('data-face-crops');
                    if (crops) dataMap['face-crops'] = crops;

                    const result = dataAttrsToFaces(dataMap);
                    const count = result.faces.length;
                    const clusterHashes = row.getAttribute('data-face-cluster-hashes');
                    const faceNames = row.getAttribute('data-face-names');
                    faces = {
                        count,
                        bboxes: result.faces.map(f => f.detection.bbox),
                        scores: result.faces.map(f => f.detection.score),
                        embeddings: count > 0 ? (() => {
                            const flat = new Float32Array(count * EMBEDDING_DIM);
                            for (let i = 0; i < count; i++) {
                                flat.set(result.faces[i].embedding, i * EMBEDDING_DIM);
                            }
                            return flat;
                        })() : null,
                        crops: result.faces.map(f => f.cropPath ?? ''),
                        clusterIds: clusterHashes ? clusterHashes.split(';') : undefined,
                        names: faceNames ? faceNames.split(';') : undefined,
                    };
                    if ((faces.clusterIds?.length ?? 0) > 0) {
                        clusteredRows += 1;
                    }
                }
            }
        }

        if (mime.startsWith('image/')) {
            try {
                const semanticInfo = dataAttrsToSemanticInfo({
                    'semantic-model-id': row.getAttribute('data-semantic-model-id') ?? '',
                    'semantic-embedding': row.getAttribute('data-semantic-embedding') ?? '',
                });
                if (semanticInfo) {
                    semantic = semanticInfo;
                }
            } catch (error) {
                console.warn('[fotos-semantic-meta] failed to parse semantic embedding', {
                    photo: relPath ? `${relPath}/${name}` : name,
                    error,
                });
            }
        } else {
            semantic = null;
        }

        // Parse size from display text (e.g., "4.2 MB")
        let size = 0;
        const sizeMatch = sizeText.match(/([\d.]+)\s*(B|KB|MB|GB|TB)/i);
        if (sizeMatch) {
            const val = parseFloat(sizeMatch[1]);
            const unit = sizeMatch[2].toUpperCase();
            const multipliers: Record<string, number> = { B: 1, KB: 1024, MB: 1048576, GB: 1073741824, TB: 1099511627776 };
            size = Math.round(val * (multipliers[unit] ?? 1));
        }

        const scannedAt = doc.querySelector('.fs-node')?.getAttribute('data-scanned') ?? new Date().toISOString();

        // Prefix face crop paths with folder context
        if (faces) {
            const prefix = relPath ? `${relPath}/one/` : 'one/';
            faces.crops = faces.crops.map(c => c ? `${prefix}${c}` : '');
        }

        entries.push({
            hash: streamId || contentHash,
            name,
            managed: 'metadata',
            sourcePath: relPath ? `${relPath}/${name}` : name,
            folderPath: relPath || undefined,
            mimeType: mime || undefined,
            thumb: thumb ? (relPath ? `${relPath}/one/${thumb}` : `one/${thumb}`) : undefined,
            tags: relPath ? [relPath.split('/')[0]] : [],
            capturedAt: exif.date ?? scannedAt,
            updatedAt: scannedAt,
            exif: Object.keys(exif).length > 0 ? exif : undefined,
            addedAt: exif.date ?? scannedAt,
            size,
            faces,
            semantic,
        });
    }

    console.log('[fotos-face-meta] load', {
        folder: relPath || '.',
        entries: entries.length,
        faceMetaRows,
        zeroFaceRows,
        clusteredRows,
    });
    traceHang('face-metadata-load', {
        folder: relPath || '.',
        entries: entries.length,
        faceMetaRows,
        zeroFaceRows,
        clusteredRows,
    });

    return entries;
}

/**
 * Recursively walk a directory handle looking for one/index.html files.
 * Returns all photo entries found.
 */
async function walkForOneIndices(
    dirHandle: FileSystemDirectoryHandle,
    rootHandle: FileSystemDirectoryHandle,
    relPath: string,
    entries: PhotoEntry[]
): Promise<void> {
    // Check for one/index.html in this directory
    try {
        const oneDir = await dirHandle.getDirectoryHandle('one');
        const indexFile = await oneDir.getFileHandle('index.html');
        const file = await indexFile.getFile();
        const html = await file.text();
        const parsed = parseOneIndex(html, relPath);
        entries.push(...parsed);
    } catch {
        // No one/ here, that's fine
    }

    // Recurse into subdirectories
    for await (const [name, handle] of (dirHandle as any).entries()) {
        if (handle.kind !== 'directory') continue;
        if (name === 'one' || name === '.git' || name === 'node_modules') continue;
        if (name.startsWith('.')) continue;

        const childPath = relPath ? `${relPath}/${name}` : name;
        await walkForOneIndices(handle, rootHandle, childPath, entries);
    }
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

    // Navigate to parent directory
    for (let i = 0; i < segments.length - 1; i++) {
        dirHandle = await dirHandle.getDirectoryHandle(segments[i]);
    }

    const fileHandle = await dirHandle.getFileHandle(segments[segments.length - 1]);
    return fileHandle.getFile();
}

interface LoadedClusterState {
    dim: FaceClusterDimension;
    threshold: number;
}

async function loadClusterState(dirHandle: FileSystemDirectoryHandle): Promise<LoadedClusterState | null> {
    try {
        const oneDir = await dirHandle.getDirectoryHandle('one');
        const file = await (await oneDir.getFileHandle('clusters.json')).getFile();
        const json = await file.text();
        const parsed = JSON.parse(json) as {threshold?: number};
        return {
            dim: FaceClusterDimension.deserialize(json),
            threshold: parsed.threshold ?? 0.55,
        };
    } catch {
        return null;
    }
}

async function saveClusterState(dirHandle: FileSystemDirectoryHandle, dim: FaceClusterDimension): Promise<void> {
    const oneDir = await dirHandle.getDirectoryHandle('one', { create: true });
    const fh = await oneDir.getFileHandle('clusters.json', { create: true });
    const wr = await fh.createWritable();
    await wr.write(dim.serialize());
    await wr.close();
}

async function clearClusterState(dirHandle: FileSystemDirectoryHandle): Promise<void> {
    try {
        const oneDir = await dirHandle.getDirectoryHandle('one');
        await oneDir.removeEntry('clusters.json');
    } catch {
        // Ignore missing cluster state.
    }
}

const DEFAULT_CLUSTER_SENSITIVITY = 50;
const CLUSTER_THRESHOLD_MIN = 0.35;
const CLUSTER_THRESHOLD_MAX = 0.75;
const CLUSTER_THRESHOLD_EPSILON = 1e-6;

function clusterSensitivityToThreshold(sensitivity: number): number {
    const clamped = Math.max(0, Math.min(100, Number.isFinite(sensitivity) ? sensitivity : DEFAULT_CLUSTER_SENSITIVITY));
    return CLUSTER_THRESHOLD_MIN + (clamped / 100) * (CLUSTER_THRESHOLD_MAX - CLUSTER_THRESHOLD_MIN);
}

function isSameThreshold(left: number, right: number): boolean {
    return Math.abs(left - right) < CLUSTER_THRESHOLD_EPSILON;
}

function normalizeClusterName(name: string | null | undefined): string | undefined {
    const trimmed = name?.trim();
    if (!trimmed || trimmed === 'Unknown') {
        return undefined;
    }
    return trimmed;
}

function stripStoredFaceCropPath(photo: PhotoEntry, cropPath: string | undefined): string | undefined {
    if (!cropPath) {
        return undefined;
    }

    const relPath = photo.sourcePath?.includes('/')
        ? photo.sourcePath.split('/').slice(0, -1).join('/')
        : '';
    const prefix = relPath ? `${relPath}/one/` : 'one/';
    return cropPath.startsWith(prefix) ? cropPath.slice(prefix.length) : cropPath;
}

function buildFaceAnalysisResultFromEntry(photo: PhotoEntry): FaceAnalysisResult | null {
    const faces = photo.faces;
    if (!faces || faces.count <= 0 || !faces.embeddings) {
        return null;
    }

    const resultFaces = Array.from({length: faces.count}, (_, index) => ({
        detection: {
            bbox: faces.bboxes[index],
            score: faces.scores[index] ?? 0,
            landmarks: [],
        },
        embedding: Array.from(
            faces.embeddings!.slice(index * EMBEDDING_DIM, (index + 1) * EMBEDDING_DIM)
        ),
        cropPath: stripStoredFaceCropPath(photo, faces.crops[index]),
    }));

    return {faces: resultFaces};
}

function isSameStringArray(left: string[] | undefined, right: string[]): boolean {
    if (!left) {
        return right.length === 0;
    }
    if (left.length !== right.length) {
        return false;
    }
    for (let index = 0; index < left.length; index++) {
        if (left[index] !== right[index]) {
            return false;
        }
    }
    return true;
}

interface ClusterRebuildResult {
    dim: FaceClusterDimension;
    entries: PhotoEntry[];
}

export interface FolderAccess {
    /** Whether a folder is currently open */
    isOpen: boolean;
    /** Current product surface */
    surface: GallerySurface;
    /** Shared capabilities for the active surface */
    surfaceProfile: GallerySurfaceProfile;
    /** Default intake plan for the active surface */
    defaultIntakePlan: GalleryIntakePlan;
    /** Share-target intake plan for the active surface */
    shareIntakePlan: GalleryIntakePlan;
    /** Name of the open folder */
    folderName: string | null;
    /** All photo entries from one/ folders */
    entries: PhotoEntry[];
    /** Loading state */
    loading: boolean;
    /** Ingestion progress (null when not ingesting) */
    ingestProgress: IngestProgress | null;
    /** Whether running in mobile/PWA lightweight mode */
    mobile: boolean;
    /** Trigger the primary intake action for this surface. */
    openFolder: () => Promise<void>;
    /** Rescan the current folder */
    rescan: () => Promise<void>;
    /** Force rerun of enabled analysis for the current folder */
    reanalyzeFaces: () => Promise<void>;
    /** Ensure photo-level semantic embeddings exist for the current folder */
    ensureSemanticEmbeddings: () => Promise<void>;
    /** Get an object URL for a file (for display). Caller must revoke. */
    getFileUrl: (relativePath: string) => Promise<string>;
    /** Get an object URL for a thumbnail */
    getThumbUrl: (entry: PhotoEntry) => Promise<string | null>;
    /** Get the raw File object for a relative path (for sharing) */
    readFile: (relativePath: string) => Promise<File>;
    /** Assign a display name to a face cluster */
    renameFace: (clusterId: string, name: string) => Promise<void>;
    /** Remove a face cluster from the current gallery state */
    deleteFace: (clusterId: string) => Promise<void>;
}

// ── Persist last-opened folder handle via IndexedDB ──────────────────
const IDB_NAME = 'fotos-prefs';
const IDB_STORE = 'handles';
const IDB_KEY = 'lastFolder';

function openPrefsDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = () => {
            req.result.createObjectStore(IDB_STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function saveLastFolder(handle: FileSystemDirectoryHandle): Promise<void> {
    const db = await openPrefsDB();
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(handle, IDB_KEY);
    db.close();
}

async function loadLastFolder(): Promise<FileSystemDirectoryHandle | null> {
    const db = await openPrefsDB();
    return new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
        db.close();
    });
}

/**
 * Retrieve files stashed by the service worker from a Web Share Target POST.
 * Returns null if no shared files are pending.
 */
async function consumeSharedFiles(): Promise<File[] | null> {
    if (!('caches' in window)) return null;
    // Only check if we arrived via share
    const params = new URLSearchParams(window.location.search);
    if (!params.has('share')) return null;
    // Clean up the URL
    window.history.replaceState({}, '', '/');

    try {
        const cache = await caches.open('fotos-share');
        const countResp = await cache.match('/_shared/count');
        if (!countResp) return null;
        const count = parseInt(await countResp.text(), 10);
        if (!count || count <= 0) return null;

        const files: File[] = [];
        for (let i = 0; i < count; i++) {
            const resp = await cache.match(`/_shared/${i}`);
            if (!resp) continue;
            const blob = await resp.blob();
            const name = resp.headers.get('X-Filename') || `shared-${i}.jpg`;
            files.push(new File([blob], name, { type: blob.type }));
        }
        // Clear the share cache
        await caches.delete('fotos-share');
        return files.length > 0 ? files : null;
    } catch {
        return null;
    }
}

function faceWorkerStatusLabel(progress: FaceWorkerProgress): string | null {
    switch (progress.stage) {
        case 'init-start':
            return 'Starting face analytics...';
        case 'device-selected':
            return progress.detail?.device === 'webgpu'
                ? 'Preparing face analytics on WebGPU...'
                : 'Preparing face analytics...';
        case 'detection-init-start':
            return 'Loading face detector...';
        case 'detection-init-complete':
            return 'Face detector ready.';
        case 'warmup-start':
            return progress.detail?.scope === 'detection'
                ? 'Warming up face detector...'
                : 'Warming up face analytics...';
        case 'warmup-detection-start':
            return 'Warming up face detector...';
        case 'warmup-detection-complete':
            return 'Face detector warmed up.';
        case 'warmup-fallback-wasm':
            return 'WebGPU stalled, switching to WASM...';
        case 'models-reinit-start':
            return 'Restarting face analytics on WASM...';
        case 'models-reinit-complete':
            return 'Face analytics ready.';
        case 'recognition-init-start':
            return 'Loading face recognition...';
        case 'recognition-init-complete':
            return 'Face recognition ready.';
        case 'face-worker-ready':
            return 'Face analytics ready.';
        default:
            return null;
    }
}

export interface UseFolderAccessOptions {
    clusterSensitivity?: number;
    faceAnalyticsEnabled?: boolean;
    semanticSearchEnabled?: boolean;
}

export function useFolderAccess(options: UseFolderAccessOptions = {}): FolderAccess {
    const clusterSensitivity = options.clusterSensitivity ?? DEFAULT_CLUSTER_SENSITIVITY;
    const faceAnalyticsEnabled = options.faceAnalyticsEnabled ?? false;
    const semanticSearchEnabled = options.semanticSearchEnabled ?? false;
    const clusterThreshold = clusterSensitivityToThreshold(clusterSensitivity);
    const [isOpen, setIsOpen] = useState(false);
    const [folderName, setFolderName] = useState<string | null>(null);
    const [entries, setEntries] = useState<PhotoEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [ingestProgress, setIngestProgress] = useState<IngestProgress | null>(null);
    const rootHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
    const mobile = isMobile();
    const surface: GallerySurface = mobile ? 'fotos-browser-mobile' : 'fotos-browser-desktop';
    const surfaceProfile = getGallerySurfaceProfile(surface);
    const defaultIntakePlan = planGalleryIntake(surface, surfaceProfile.defaultSource);
    const shareIntakePlan = planGalleryIntake(surface, 'shared-files');
    const allowsLocalFaceEnrichment = faceAnalyticsEnabled && defaultIntakePlan.faceEnrichment === 'local';
    const usesWritableLibraryAttach = defaultIntakePlan.mode === 'attach-library';
    // Cache object URLs to avoid re-reading files
    const urlCacheRef = useRef<Map<string, string>>(new Map());
    // Face worker — initialized lazily, persists across ingests
    const faceWorkerRef = useRef<{ handle: FaceWorkerHandle; terminate: () => void } | null>(null);
    const facePassProgressRef = useRef<{ total: number; current: number; fileName?: string } | null>(null);
    const semanticWorkerRef = useRef<ReturnType<typeof createSemanticWorker> | null>(null);
    const semanticPassPromiseRef = useRef<Promise<void> | null>(null);
    // Face cluster dimension — loaded lazily, persists across face passes
    const clusterDimRef = useRef<FaceClusterDimension | null>(null);
    const clusterThresholdRef = useRef<number | null>(null);
    const previousAllowsLocalFaceEnrichmentRef = useRef(allowsLocalFaceEnrichment);

    useEffect(() => {
        return () => {
            faceWorkerRef.current?.terminate();
            semanticWorkerRef.current?.terminate();
        };
    }, []);

    useEffect(() => {
        const pendingFaces = entries.filter(entry => entry.faces === undefined).length;
        traceHang('folder-state', {
            isOpen,
            folderName,
            entryCount: entries.length,
            loading,
            pendingFaces,
            ingestProgress: ingestProgress
                ? {
                    phase: ingestProgress.phase,
                    current: ingestProgress.current,
                    total: ingestProgress.total,
                    fileName: ingestProgress.fileName,
                }
                : null,
        });
    }, [
        isOpen,
        folderName,
        entries.length,
        loading,
        ingestProgress?.phase,
        ingestProgress?.current,
        ingestProgress?.total,
        ingestProgress?.fileName,
    ]);

    // Listen for FotosEntry objects arriving via CHUM sync from remote peers.
    // When a remote peer enriches a photo with face data, extract full face data
    // from BLOBs, write to one/index.html + one/faces/, and update in-memory state.
    useEffect(() => {
        const unsub = listenForFotosUpdates((entry) => {
            // Only interested in entries that carry face enrichment
            if (!entry.faceCount || entry.faceCount <= 0) return;

            // Extract face data from BLOBs and write to filesystem (async, fire-and-forget)
            void (async () => {
                const rootHandle = rootHandleRef.current;

                // Extract full face data from ONE.core BLOBs
                const faceData = await extractFaceDataFromEntry(entry);

                setEntries(prev => {
                    // Find matching local photo by contentHash
                    const idx = prev.findIndex(p => p.hash === entry.contentHash);
                    if (idx < 0) return prev;

                    const photo = prev[idx];

                    // Skip if local photo already has face data
                    if (photo.faces && photo.faces.count > 0) return prev;

                    // Build face info from extracted data or fall back to count-only
                    const relPath = (photo.sourcePath ?? '').includes('/')
                        ? (photo.sourcePath ?? '').split('/').slice(0, -1).join('/')
                        : '';
                    const prefix = relPath ? `${relPath}/one/` : 'one/';

                    let faceInfo: FaceInfo;
                    if (faceData) {
                        const faces = faceData.faces.faces;
                        faceInfo = {
                            count: faces.length,
                            bboxes: faces.map(f => f.detection.bbox),
                            scores: faces.map(f => f.detection.score),
                            embeddings: faces.some(f => f.embedding.some(v => v !== 0))
                                ? (() => {
                                    const flat = new Float32Array(faces.length * EMBEDDING_DIM);
                                    for (let i = 0; i < faces.length; i++) {
                                        flat.set(faces[i].embedding, i * EMBEDDING_DIM);
                                    }
                                    return flat;
                                })()
                                : null,
                            crops: faces.map(f => f.cropPath ? `${prefix}${f.cropPath}` : ''),
                        };
                    } else {
                        faceInfo = {
                            count: entry.faceCount!,
                            bboxes: [],
                            scores: [],
                            embeddings: null,
                            crops: [],
                        };
                    }

                    const updated = [...prev];
                    updated[idx] = {...photo, faces: faceInfo};

                    console.log(
                        `[fotos-sync] Remote enrichment: ${photo.name} → ${entry.faceCount} faces`
                        + (faceData ? ` (${faceData.cropBlobs.length} crops)` : ' (count only)'),
                    );

                    // Write to filesystem in the background (non-blocking)
                    if (rootHandle && faceData) {
                        void (async () => {
                            try {
                                // Write face data attributes to one/index.html
                                await updateIndexHtmlFaceData(rootHandle, photo, faceData.dataAttrs);

                                // Write face crops to one/faces/
                                await writeFaceCropsToFilesystem(
                                    rootHandle,
                                    photo,
                                    entry.contentHash,
                                    faceData.cropBlobs,
                                );

                                console.log(
                                    `[fotos-sync] Wrote face data to filesystem for ${photo.name}`,
                                );
                            } catch (err) {
                                console.warn(
                                    `[fotos-sync] Failed to write face data for ${photo.name}:`,
                                    err,
                                );
                            }
                        })();
                    }

                    return updated;
                });
            })();
        });

        return unsub;
    }, []);

    const updateFacePreparationProgress = useCallback((progress: FaceWorkerProgress) => {
        const activePass = facePassProgressRef.current;
        if (!activePass) return;

        const statusLabel = faceWorkerStatusLabel(progress);
        if (!statusLabel) return;

        setIngestProgress(prev => {
            if (prev && prev.phase !== 'preparing-faces' && prev.phase !== 'faces') {
                return prev;
            }
            return {
                phase: 'preparing-faces',
                current: activePass.current,
                total: activePass.total,
                fileName: activePass.fileName,
                statusLabel,
            };
        });
    }, []);

    const getFaceWorker = useCallback(async (): Promise<FaceWorkerHandle> => {
        if (faceWorkerRef.current) return faceWorkerRef.current.handle;
        const fw = createFaceWorker(faceWorkerUrl, {
            onProgress: updateFacePreparationProgress,
        });
        await fw.ready;
        faceWorkerRef.current = { handle: fw.handle, terminate: fw.terminate };
        return fw.handle;
    }, [updateFacePreparationProgress]);

    const getSemanticWorker = useCallback(async () => {
        if (semanticWorkerRef.current) {
            return semanticWorkerRef.current.handle;
        }

        const worker = createSemanticWorker(semanticWorkerUrl);
        await worker.ready;
        semanticWorkerRef.current = worker;
        return worker.handle;
    }, []);

    const rebuildClustersFromEntries = useCallback(async (
        handle: FileSystemDirectoryHandle,
        photos: PhotoEntry[],
        threshold: number,
    ): Promise<ClusterRebuildResult> => {
        const dim = new FaceClusterDimension(threshold);
        const preferredNames = new Map<string, string>();

        for (const photo of photos) {
            const faces = photo.faces;
            if (!faces?.clusterIds?.length) {
                continue;
            }

            for (let faceIndex = 0; faceIndex < faces.clusterIds.length; faceIndex++) {
                const clusterId = faces.clusterIds[faceIndex];
                const personName = normalizeClusterName(faces.names?.[faceIndex]);
                if (clusterId && personName && !preferredNames.has(clusterId)) {
                    preferredNames.set(clusterId, personName);
                }
            }
        }

        const nextEntries = [...photos];

        for (let photoIndex = 0; photoIndex < photos.length; photoIndex++) {
            const photo = photos[photoIndex];
            const faceResult = buildFaceAnalysisResultFromEntry(photo);
            if (!faceResult || faceResult.faces.length === 0) {
                continue;
            }

            const clusterInfo: FaceClusterInfo[] = [];
            for (let faceIndex = 0; faceIndex < faceResult.faces.length; faceIndex++) {
                const oldClusterId = photo.faces?.clusterIds?.[faceIndex];
                const preferredName = normalizeClusterName(photo.faces?.names?.[faceIndex])
                    ?? (oldClusterId ? preferredNames.get(oldClusterId) : undefined);
                const clusterId = dim.assign(faceResult.faces[faceIndex].embedding, photo.hash, faceIndex);
                const cluster = dim.getCluster(clusterId);
                if (preferredName && cluster && !cluster.personName) {
                    dim.nameCluster(clusterId, preferredName);
                }
                clusterInfo.push({
                    clusterId,
                    personName: dim.getCluster(clusterId)?.personName,
                });
            }

            const nextClusterIds = clusterInfo.map(info => info.clusterId);
            const nextNames = clusterInfo.map(info => info.personName ?? 'Unknown');
            const changed = !isSameStringArray(photo.faces?.clusterIds, nextClusterIds)
                || !isSameStringArray(photo.faces?.names, nextNames);

            if (!changed) {
                continue;
            }

            await updateIndexHtmlFaceData(handle, photo, facesToDataAttrs(faceResult, clusterInfo));
            nextEntries[photoIndex] = {
                ...photo,
                faces: {
                    ...photo.faces!,
                    clusterIds: nextClusterIds,
                    names: nextNames,
                },
            };
        }

        if (dim.getClusterCount() > 0) {
            await saveClusterState(handle, dim);
        }

        return {dim, entries: nextEntries};
    }, []);

    const ensureClusterDimension = useCallback(async (
        handle: FileSystemDirectoryHandle,
        photos: PhotoEntry[],
        threshold: number,
    ): Promise<ClusterRebuildResult> => {
        const stored = await loadClusterState(handle);
        const hasClusterableFaces = photos.some(photo => {
            const faces = photo.faces;
            return Boolean(faces && faces.count > 0 && faces.embeddings);
        });

        if (stored && isSameThreshold(stored.threshold, threshold)) {
            clusterDimRef.current = stored.dim;
            clusterThresholdRef.current = threshold;
            return {dim: stored.dim, entries: photos};
        }

        if (!hasClusterableFaces) {
            const dim = new FaceClusterDimension(threshold);
            clusterDimRef.current = dim;
            clusterThresholdRef.current = threshold;
            return {dim, entries: photos};
        }

        const rebuilt = await rebuildClustersFromEntries(handle, photos, threshold);
        clusterDimRef.current = rebuilt.dim;
        clusterThresholdRef.current = threshold;
        return rebuilt;
    }, [rebuildClustersFromEntries]);

    const scan = useCallback(async (handle: FileSystemDirectoryHandle) => {
        setLoading(true);
        traceHang('scan-start', { folderName: handle.name });
        const found: PhotoEntry[] = [];
        await walkForOneIndices(handle, handle, '', found);
        setEntries(found);
        setLoading(false);
        traceHang('scan-complete', {
            folderName: handle.name,
            entryCount: found.length,
            analyzedCount: found.filter(entry => entry.faces !== undefined).length,
        });
        return found;
    }, []);

    /**
     * Background face pass: for photos missing face data, run face detection
     * and update one/index.html + in-memory entries as each completes.
     */
    const runBackgroundFacePass = useCallback(async (
        handle: FileSystemDirectoryHandle,
        photos: PhotoEntry[]
    ) => {
        // Trust any face metadata already materialized in one/index.html and
        // only enrich entries that are still missing face results.
        const missing = photos.filter(p => p.faces === undefined);
        if (missing.length === 0) return;

        traceHang('face-pass-start', {
            folderName: handle.name,
            total: missing.length,
            alreadyAnalyzed: photos.length - missing.length,
        });
        facePassProgressRef.current = { total: missing.length, current: 0 };
        setIngestProgress({
            phase: 'preparing-faces',
            current: 0,
            total: missing.length,
            statusLabel: 'Starting face analytics...',
        });

        let faceHandle: FaceWorkerHandle | undefined;
        try {
            faceHandle = await getFaceWorker();
        } catch (err) {
            console.warn('Face detection unavailable:', err);
            traceHang('face-pass-unavailable', { message: String(err) });
            setIngestProgress(null);
            return;
        }

        // Load or create cluster dimension
        if (!clusterDimRef.current) {
            clusterDimRef.current = (await ensureClusterDimension(handle, photos, clusterThreshold)).dim;
        }
        const dim = clusterDimRef.current;

        console.log(`[FacePass] Running face detection on ${missing.length} photos...`);

        try {
            for (let i = 0; i < missing.length; i++) {
                const photo = missing[i];
                facePassProgressRef.current = {
                    total: missing.length,
                    current: i,
                    fileName: photo.name,
                };
                if (!photo.sourcePath) {
                    setIngestProgress({ phase: 'faces', current: i + 1, total: missing.length, fileName: photo.name });
                    continue;
                }

                setIngestProgress({ phase: 'faces', current: i, total: missing.length, fileName: photo.name });

                try {
                // Read the image file
                    const file = await readFileFromHandle(handle, photo.sourcePath);
                    const imageId = photo.hash.slice(0, 16);

                // Run face detection
                    const result = await faceHandle.analyze(file, imageId);
                    const faceCount = parseInt(result.dataAttrs['face-count'] ?? '0', 10);

                // Write face crops to one/faces/ directory
                    if (result.cropBlobs.length > 0) {
                    // Find the .one dir for this photo's parent folder
                        const segments = (photo.sourcePath).split('/').filter(Boolean);
                        let dirHandle = handle;
                        for (let s = 0; s < segments.length - 1; s++) {
                            dirHandle = await dirHandle.getDirectoryHandle(segments[s]);
                        }
                        const oneDir = await dirHandle.getDirectoryHandle('one', { create: true });
                        const facesDir = await oneDir.getDirectoryHandle('faces', { create: true });
                        for (const crop of result.cropBlobs) {
                            const cropName = crop.name.split('/').pop()!;
                            const fh = await facesDir.getFileHandle(cropName, { create: true });
                            const wr = await fh.createWritable();
                            await wr.write(crop.blob);
                            await wr.close();
                        }
                    }

                // Parse face data and cluster each detected face
                    const parsed = dataAttrsToFaces(result.dataAttrs);
                    const clusterInfos: FaceClusterInfo[] = [];
                    if (parsed.faces.length > 0) {
                        for (let fi = 0; fi < parsed.faces.length; fi++) {
                            const face = parsed.faces[fi];
                            const clusterId = dim.assign(face.embedding, photo.hash, fi);
                            const cluster = dim.getCluster(clusterId);
                            clusterInfos.push({
                                clusterId,
                                personName: cluster?.personName,
                            });
                        }
                    }

                // Re-generate data attrs with cluster info
                    const enrichedAttrs = facesToDataAttrs(parsed, clusterInfos.length > 0 ? clusterInfos : undefined);

                // Update one/index.html with face + cluster data attributes
                    await updateIndexHtmlFaceData(handle, photo, enrichedAttrs);

                // Update in-memory entry
                    if (faceCount > 0) {
                        const relPath = photo.sourcePath.includes('/')
                            ? photo.sourcePath.split('/').slice(0, -1).join('/')
                            : '';
                        const prefix = relPath ? `${relPath}/one/` : 'one/';

                        const faceInfo: FaceInfo = {
                            count: parsed.faces.length,
                            bboxes: parsed.faces.map(f => f.detection.bbox),
                            scores: parsed.faces.map(f => f.detection.score),
                            embeddings: (() => {
                                const flat = new Float32Array(parsed.faces.length * EMBEDDING_DIM);
                                for (let j = 0; j < parsed.faces.length; j++) {
                                    flat.set(parsed.faces[j].embedding, j * EMBEDDING_DIM);
                                }
                                return flat;
                            })(),
                            crops: parsed.faces.map(f => f.cropPath ? `${prefix}${f.cropPath}` : ''),
                            clusterIds: clusterInfos.map(c => c.clusterId),
                            names: clusterInfos.map(c => c.personName ?? 'Unknown'),
                        };
                        photo.faces = faceInfo;
                    } else {
                        photo.faces = { count: 0, bboxes: [], scores: [], embeddings: null, crops: [] };
                    }

                    // Trigger re-render with updated entries
                    setEntries(prev => [...prev]);
                    traceHang('face-pass-photo-complete', {
                        name: photo.name,
                        index: i + 1,
                        total: missing.length,
                        faceCount,
                    });

                    console.log(`[FacePass] ${i + 1}/${missing.length} ${photo.name}: ${faceCount} faces`);
                } catch (err) {
                    console.warn(`[FacePass] Failed for ${photo.name}:`, err);
                    traceHang('face-pass-photo-failed', {
                        name: photo.name,
                        index: i + 1,
                        total: missing.length,
                        message: String(err),
                    });
                } finally {
                    facePassProgressRef.current = {
                        total: missing.length,
                        current: i + 1,
                        fileName: photo.name,
                    };
                    setIngestProgress({ phase: 'faces', current: i + 1, total: missing.length, fileName: photo.name });
                }
            }

        // Save cluster state after processing all photos
            if (dim.getClusterCount() > 0) {
                try {
                    await saveClusterState(handle, dim);
                    console.log(`[FacePass] Saved ${dim.getClusterCount()} clusters`);
                } catch (err) {
                    console.warn('[FacePass] Failed to save cluster state:', err);
                }
            }

            console.log('[FacePass] Complete.');
        } finally {
            facePassProgressRef.current = null;
            traceHang('face-pass-complete', {
                folderName: handle.name,
                total: missing.length,
            });
            setIngestProgress(null);
        }
    }, [clusterThreshold, ensureClusterDimension, getFaceWorker]);

    const runBackgroundSemanticPass = useCallback(async (
        handle: FileSystemDirectoryHandle,
        photos: PhotoEntry[],
    ) => {
        const pending = photos.filter(photo => photo.semantic === undefined);
        if (pending.length === 0) {
            return;
        }

        traceHang('semantic-pass-start', {
            folderName: handle.name,
            total: pending.length,
            alreadyEmbedded: photos.length - pending.length,
        });
        setIngestProgress({
            phase: 'preparing-semantic',
            current: 0,
            total: pending.length,
            statusLabel: 'Loading semantic search model...',
        });

        let semanticHandle;
        try {
            semanticHandle = await getSemanticWorker();
        } catch (error) {
            console.warn('[SemanticPass] Semantic search unavailable:', error);
            traceHang('semantic-pass-unavailable', { message: String(error) });
            setIngestProgress(null);
            return;
        }

        console.log(`[SemanticPass] Running semantic embeddings on ${pending.length} photos...`);

        try {
            for (let index = 0; index < pending.length; index++) {
                const photo = pending[index];
                let semantic: SemanticInfo | null = null;

                setIngestProgress({
                    phase: 'semantic',
                    current: index,
                    total: pending.length,
                    fileName: photo.name,
                    statusLabel: 'Embedding images for semantic search...',
                });

                try {
                    const isEmbeddable = !photo.mimeType || photo.mimeType.startsWith('image/');
                    if (photo.sourcePath && isEmbeddable) {
                        const file = await readFileFromHandle(handle, photo.sourcePath);
                        const result = await semanticHandle.embedImage(file);
                        semantic = {
                            modelId: result.modelId,
                            embedding: result.embedding,
                        };
                        await updateIndexHtmlSemanticData(handle, photo, semanticToDataAttrs(semantic));
                    }
                } catch (error) {
                    console.warn(`[SemanticPass] Failed for ${photo.name}:`, error);
                    traceHang('semantic-pass-photo-failed', {
                        name: photo.name,
                        index: index + 1,
                        total: pending.length,
                        message: String(error),
                    });
                }

                setEntries(prev => prev.map(entry => {
                    if (entry.hash !== photo.hash) {
                        return entry;
                    }
                    return {
                        ...entry,
                        semantic,
                    };
                }));

                traceHang('semantic-pass-photo-complete', {
                    name: photo.name,
                    index: index + 1,
                    total: pending.length,
                    embedded: Boolean(semantic),
                });
                console.log(`[SemanticPass] ${index + 1}/${pending.length} ${photo.name}${semantic ? '' : ' (skipped)'}`);

                setIngestProgress({
                    phase: 'semantic',
                    current: index + 1,
                    total: pending.length,
                    fileName: photo.name,
                    statusLabel: 'Embedding images for semantic search...',
                });
            }
            console.log('[SemanticPass] Complete.');
        } finally {
            traceHang('semantic-pass-complete', {
                folderName: handle.name,
                total: pending.length,
            });
            setIngestProgress(null);
        }
    }, [getSemanticWorker]);

    const ensureSemanticEmbeddings = useCallback(async () => {
        const handle = rootHandleRef.current;
        if (!handle) {
            return;
        }

        const hasPending = entries.some(photo => photo.semantic === undefined);
        if (!hasPending) {
            return;
        }

        if (semanticPassPromiseRef.current) {
            return semanticPassPromiseRef.current;
        }

        const promise = runBackgroundSemanticPass(handle, entries)
            .finally(() => {
                semanticPassPromiseRef.current = null;
            });
        semanticPassPromiseRef.current = promise;
        return promise;
    }, [entries, runBackgroundSemanticPass]);

    const clearUrlCache = useCallback(() => {
        for (const url of urlCacheRef.current.values()) {
            URL.revokeObjectURL(url);
        }
        urlCacheRef.current.clear();
    }, []);

    /** Open a directory handle: scan, ingest if needed, background face pass, sync */
    const openFromHandle = useCallback(async (handle: FileSystemDirectoryHandle) => {
        traceHang('open-folder-start', { folderName: handle.name });
        rootHandleRef.current = handle;
        clusterDimRef.current = null;
        clusterThresholdRef.current = null;
        semanticPassPromiseRef.current = null;
        setFolderName(handle.name);
        setIsOpen(true);
        clearUrlCache();

        const found = await scan(handle);

        if (found.length === 0) {
            traceHang('open-folder-ingest', { folderName: handle.name });
            setIngestProgress({ phase: 'scanning', current: 0, total: 0 });
            let faceHandle: FaceWorkerHandle | undefined;
            if (allowsLocalFaceEnrichment) {
                try {
                    faceHandle = await getFaceWorker();
                } catch (err) {
                    console.warn('Face detection unavailable:', err);
                }
            }
            await ingestDirectory(handle, setIngestProgress, faceHandle);
            setIngestProgress(null);
            let ingested = await scan(handle);
            if (allowsLocalFaceEnrichment) {
                const ensured = await ensureClusterDimension(handle, ingested, clusterThreshold);
                ingested = ensured.entries;
                setEntries(ingested);
                void runBackgroundFacePass(handle, ingested);
            }
            syncPhotosToOneCore(ingested, handle).catch(err =>
                console.warn('[fotos-sync]', err));
        } else {
            traceHang('open-folder-existing-gallery', {
                folderName: handle.name,
                entryCount: found.length,
            });
            let currentEntries = found;
            if (allowsLocalFaceEnrichment) {
                const ensured = await ensureClusterDimension(handle, currentEntries, clusterThreshold);
                currentEntries = ensured.entries;
                setEntries(currentEntries);
                void runBackgroundFacePass(handle, currentEntries);
            }
            syncPhotosToOneCore(currentEntries, handle).catch(err =>
                console.warn('[fotos-sync]', err));
        }
    }, [
        allowsLocalFaceEnrichment,
        clearUrlCache,
        clusterThreshold,
        ensureClusterDimension,
        getFaceWorker,
        runBackgroundFacePass,
        scan,
    ]);

    // Restore last-opened folder on mount (desktop only, runs once)
    const restoredRef = useRef(false);
    useEffect(() => {
        if (restoredRef.current) return;
        if (!usesWritableLibraryAttach) return;
        if (!('showDirectoryPicker' in window)) return;
        restoredRef.current = true;
        loadLastFolder().then(async (handle) => {
            if (!handle) return;
            const perm = await (handle as any).queryPermission({ mode: 'readwrite' });
            if (perm === 'granted') {
                await openFromHandle(handle);
            }
        }).catch(() => {});
    }, [openFromHandle, usesWritableLibraryAttach]);

    // Handle incoming Web Share Target files (runs once on mount)
    const shareHandledRef = useRef(false);
    useEffect(() => {
        if (shareHandledRef.current) return;
        shareHandledRef.current = true;
        if (!shareIntakePlan.supported) return;
        consumeSharedFiles().then(async (files) => {
            if (!files) return;
            rootHandleRef.current = null;
            clusterDimRef.current = null;
            clusterThresholdRef.current = null;
            semanticPassPromiseRef.current = null;
            clearUrlCache();
            setFolderName('shared');
            setIsOpen(true);
            setIngestProgress({ phase: 'scanning', current: 0, total: files.length });
            // Build a FileList-like for ingestFiles
            const dt = new DataTransfer();
            for (const f of files) dt.items.add(f);
            const mobileEntries = await ingestFiles(dt.files, setIngestProgress);
            setIngestProgress(null);
            const photoEntries: PhotoEntry[] = mobileEntries.map(m => {
                if (m.objectUrl) urlCacheRef.current.set(m.sourcePath, m.objectUrl);
                if (m.thumb) urlCacheRef.current.set(`thumb:${m.hash}`, m.thumb);
                return {
                    hash: m.hash,
                    name: m.name,
                    managed: m.managed,
                    sourcePath: m.sourcePath,
                    folderPath: m.folderPath,
                    mimeType: m.mimeType,
                    thumb: m.thumb ? `thumb:${m.hash}` : undefined,
                    tags: m.tags,
                    capturedAt: m.capturedAt,
                    updatedAt: m.updatedAt,
                    exif: m.exif,
                    addedAt: m.addedAt,
                    size: m.size,
                };
            });
            setEntries(photoEntries);
            syncPhotosToOneCore(photoEntries, null).catch(err =>
                console.warn('[fotos-sync]', err));
            console.log(`[share-target] Imported ${files.length} shared photos`);
        }).catch(err => console.warn('[share-target]', err));
    }, [clearUrlCache, shareIntakePlan.supported]);

    const openFolder = useCallback(async () => {
        if (usesWritableLibraryAttach && 'showDirectoryPicker' in window) {
            const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
            saveLastFolder(handle).catch(() => {});
            await openFromHandle(handle);
            return;
        }

        // Selection capture fallback: pick photos from the system library.
        // Attach to DOM so the element survives GC while the native picker is open
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = 'image/*';
        input.style.display = 'none';
        document.body.appendChild(input);

        input.onchange = async () => {
            document.body.removeChild(input);
            const files = input.files;
            if (!files || files.length === 0) return;

            rootHandleRef.current = null;
            clusterDimRef.current = null;
            clusterThresholdRef.current = null;
            semanticPassPromiseRef.current = null;
            clearUrlCache();

            setFolderName('photos');
            setIsOpen(true);

            // Ingest files directly (no one/ write on mobile — read-only)
            setIngestProgress({ phase: 'scanning', current: 0, total: files.length });
            const mobileEntries = await ingestFiles(files, setIngestProgress);
            setIngestProgress(null);

            // Convert to PhotoEntry and cache object URLs
            const photoEntries: PhotoEntry[] = mobileEntries.map(m => {
                if (m.objectUrl) urlCacheRef.current.set(m.sourcePath, m.objectUrl);
                if (m.thumb) urlCacheRef.current.set(`thumb:${m.hash}`, m.thumb);
                return {
                    hash: m.hash,
                    name: m.name,
                    managed: m.managed,
                    sourcePath: m.sourcePath,
                    folderPath: m.folderPath,
                    mimeType: m.mimeType,
                    thumb: m.thumb ? `thumb:${m.hash}` : undefined,
                    tags: m.tags,
                    capturedAt: m.capturedAt,
                    updatedAt: m.updatedAt,
                    exif: m.exif,
                    addedAt: m.addedAt,
                    size: m.size,
                };
            });
            setEntries(photoEntries);
            // Fire-and-forget ONE.core sync (no rootHandle on mobile — no thumbnails)
            syncPhotosToOneCore(photoEntries, null).catch(err =>
                console.warn('[fotos-sync]', err));
        };

        input.click();
    }, [openFromHandle, usesWritableLibraryAttach]);

    const rescan = useCallback(async () => {
        if (!rootHandleRef.current) return;
        const handle = rootHandleRef.current;
        semanticPassPromiseRef.current = null;
        clearUrlCache();
        try {
            await ingestDirectory(handle, setIngestProgress);
            let found = await scan(handle);
            if (allowsLocalFaceEnrichment) {
                const ensured = await ensureClusterDimension(handle, found, clusterThreshold);
                found = ensured.entries;
                setEntries(found);
                void runBackgroundFacePass(handle, found);
            }
            syncPhotosToOneCore(found, handle).catch(err =>
                console.warn('[fotos-sync]', err));
        } finally {
            setIngestProgress(null);
        }
    }, [
        allowsLocalFaceEnrichment,
        clearUrlCache,
        clusterThreshold,
        ensureClusterDimension,
        runBackgroundFacePass,
        scan,
    ]);

    const reanalyzeFaces = useCallback(async () => {
        if (!rootHandleRef.current) {
            return;
        }

        const handle = rootHandleRef.current;
        const shouldReanalyzeFaces = allowsLocalFaceEnrichment;
        const shouldReanalyzeSemantic = semanticSearchEnabled;
        if (!shouldReanalyzeFaces && !shouldReanalyzeSemantic) {
            return;
        }

        semanticPassPromiseRef.current = null;
        traceHang('analysis-reanalyze-start', {
            folderName,
            entries: entries.length,
            faces: shouldReanalyzeFaces,
            semantic: shouldReanalyzeSemantic,
        });
        console.log('[fotos-analysis] reanalyze-start', {
            folder: folderName,
            entries: entries.length,
            faces: shouldReanalyzeFaces,
            semantic: shouldReanalyzeSemantic,
        });

        try {
            for (let index = 0; index < entries.length; index++) {
                const photo = entries[index];
                setIngestProgress({
                    phase: shouldReanalyzeFaces ? 'preparing-faces' : 'preparing-semantic',
                    current: index,
                    total: entries.length,
                    fileName: photo.name,
                    statusLabel: 'Clearing saved analysis...',
                });
                if (shouldReanalyzeFaces) {
                    await updateIndexHtmlFaceData(handle, photo, {});
                }
                if (shouldReanalyzeSemantic) {
                    await updateIndexHtmlSemanticData(handle, photo, {});
                }
            }

            if (entries.length > 0) {
                setIngestProgress({
                    phase: shouldReanalyzeFaces ? 'preparing-faces' : 'preparing-semantic',
                    current: entries.length,
                    total: entries.length,
                    statusLabel: 'Saved analysis cleared.',
                });
            }

            if (shouldReanalyzeFaces) {
                await clearClusterState(handle);
                clusterDimRef.current = null;
                clusterThresholdRef.current = null;
            }

            const cleared = entries.map(photo => ({
                ...photo,
                faces: shouldReanalyzeFaces ? undefined : photo.faces,
                semantic: shouldReanalyzeSemantic ? undefined : photo.semantic,
            }));
            setEntries(cleared);

            if (cleared.length === 0) {
                setIngestProgress(null);
                return;
            }

            if (shouldReanalyzeFaces) {
                await runBackgroundFacePass(handle, cleared);
            }
            if (shouldReanalyzeSemantic) {
                let semanticPass: Promise<void>;
                semanticPass = runBackgroundSemanticPass(handle, cleared)
                    .finally(() => {
                        if (semanticPassPromiseRef.current === semanticPass) {
                            semanticPassPromiseRef.current = null;
                        }
                    });
                semanticPassPromiseRef.current = semanticPass;
                await semanticPass;
            }
        } finally {
            traceHang('analysis-reanalyze-complete', {
                folderName,
                entries: entries.length,
                faces: shouldReanalyzeFaces,
                semantic: shouldReanalyzeSemantic,
            });
        }
    }, [
        allowsLocalFaceEnrichment,
        entries,
        folderName,
        runBackgroundFacePass,
        runBackgroundSemanticPass,
        semanticSearchEnabled,
    ]);

    useEffect(() => {
        const handle = rootHandleRef.current;
        const currentDim = clusterDimRef.current;
        if (!allowsLocalFaceEnrichment || !handle || !isOpen || !currentDim) {
            return;
        }
        if (facePassProgressRef.current) {
            return;
        }
        if (clusterThresholdRef.current !== null && isSameThreshold(clusterThresholdRef.current, clusterThreshold)) {
            return;
        }

        void ensureClusterDimension(handle, entries, clusterThreshold)
            .then(result => {
                if (result.entries !== entries) {
                    setEntries(result.entries);
                }
            })
            .catch(err => {
                console.warn('[FacePass] Failed to rebuild clusters for new sensitivity:', err);
            });
    }, [allowsLocalFaceEnrichment, clusterThreshold, entries, ensureClusterDimension, isOpen]);

    useEffect(() => {
        const handle = rootHandleRef.current;
        const wasEnabled = previousAllowsLocalFaceEnrichmentRef.current;
        previousAllowsLocalFaceEnrichmentRef.current = allowsLocalFaceEnrichment;

        if (!allowsLocalFaceEnrichment || wasEnabled || !handle || !isOpen) {
            return;
        }
        if (facePassProgressRef.current) {
            return;
        }
        if (!entries.some(entry => entry.faces === undefined)) {
            return;
        }

        void ensureClusterDimension(handle, entries, clusterThreshold)
            .then(result => {
                if (result.entries !== entries) {
                    setEntries(result.entries);
                }
                return runBackgroundFacePass(handle, result.entries);
            })
            .catch(error => {
                console.warn('[FacePass] Failed to start after enabling face analytics:', error);
            });
    }, [
        allowsLocalFaceEnrichment,
        clusterThreshold,
        entries,
        ensureClusterDimension,
        isOpen,
        runBackgroundFacePass,
    ]);

    const getFileUrl = useCallback(async (relativePath: string): Promise<string> => {
        const cached = urlCacheRef.current.get(relativePath);
        if (cached) return cached;

        if (!rootHandleRef.current) throw new Error('No folder open');
        const file = await readFileFromHandle(rootHandleRef.current, relativePath);
        const url = URL.createObjectURL(file);
        urlCacheRef.current.set(relativePath, url);
        return url;
    }, []);

    const getThumbUrl = useCallback(async (entry: PhotoEntry): Promise<string | null> => {
        if (!entry.thumb) return null;

        const cached = urlCacheRef.current.get(entry.thumb);
        if (cached) return cached;

        if (!rootHandleRef.current) return null;

        try {
            const file = await readFileFromHandle(rootHandleRef.current, entry.thumb);
            const url = URL.createObjectURL(file);
            urlCacheRef.current.set(entry.thumb, url);
            return url;
        } catch {
            return null;
        }
    }, []);

    const readFile = useCallback(async (relativePath: string): Promise<File> => {
        if (!rootHandleRef.current) throw new Error('No folder open');
        return readFileFromHandle(rootHandleRef.current, relativePath);
    }, []);

    const renameFace = useCallback(async (clusterId: string, name: string) => {
        const dim = clusterDimRef.current;
        if (!dim || !rootHandleRef.current) throw new Error('No cluster state');
        dim.nameCluster(clusterId, name);
        await saveClusterState(rootHandleRef.current, dim);
        setEntries(prev => prev.map(entry => {
            if (!entry.faces?.clusterIds) return entry;
            const idx = entry.faces.clusterIds.indexOf(clusterId);
            if (idx < 0) return entry;
            const names = [...(entry.faces.names ?? entry.faces.clusterIds.map(() => 'Unknown'))];
            names[idx] = name;
            return { ...entry, faces: { ...entry.faces, names } };
        }));
    }, []);

    const deleteFace = useCallback(async (clusterId: string) => {
        const dim = clusterDimRef.current;
        if (!dim || !rootHandleRef.current) throw new Error('No cluster state');
        (dim as FaceClusterDimension & { removeCluster(id: string): void }).removeCluster(clusterId);
        await saveClusterState(rootHandleRef.current, dim);
        setEntries(prev => prev.map(entry => {
            if (!entry.faces?.clusterIds) return entry;
            const idx = entry.faces.clusterIds.indexOf(clusterId);
            if (idx < 0) return entry;
            const clusterIds = entry.faces.clusterIds.filter((_, i) => i !== idx);
            const names = (entry.faces.names ?? []).filter((_, i) => i !== idx);
            const bboxes = entry.faces.bboxes.filter((_, i) => i !== idx);
            const scores = entry.faces.scores.filter((_, i) => i !== idx);
            const crops = entry.faces.crops.filter((_, i) => i !== idx);
            return {
                ...entry,
                faces: {
                    ...entry.faces,
                    count: clusterIds.length,
                    clusterIds,
                    names,
                    bboxes,
                    scores,
                    crops,
                },
            };
        }));
    }, []);

    return {
        isOpen,
        surface,
        surfaceProfile,
        defaultIntakePlan,
        shareIntakePlan,
        folderName,
        entries,
        loading,
        ingestProgress,
        mobile,
        openFolder,
        rescan,
        reanalyzeFaces,
        ensureSemanticEmbeddings,
        getFileUrl,
        getThumbUrl,
        readFile,
        renameFace,
        deleteFace,
    };
}
