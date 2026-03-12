/**
 * Browser-side media ingestion using File System Access API.
 *
 * Walks a directory tree, extracts EXIF, generates thumbnails via canvas,
 * computes content hashes via crypto.subtle, and writes one/index.html
 * per directory using the same format as one.fotos CLI.
 */

import ExifReader from 'exifreader';

// ── Constants ──────────────────────────────────────────────────────────

const IMAGE_EXTS = new Set([
    '.jpg', '.jpeg', '.png', '.webp', '.gif', '.tiff', '.tif', '.avif',
]);
const THUMB_MAX = 400;
const THUMB_QUALITY = 0.8;
const ONE_DIR = 'one';
const THUMBS_DIR = 'thumbs';

// ── Types ──────────────────────────────────────────────────────────────

interface ExifData {
    date?: string;
    camera?: string;
    lens?: string;
    focalLength?: string;
    aperture?: string;
    shutter?: string;
    iso?: number;
    gps?: { lat: number; lon: number };
    width?: number;
    height?: number;
}

interface ImageFile {
    name: string;
    file: File;
    handle: FileSystemFileHandle;
    relPath: string;
    mime: string;
}

interface FsEntry {
    name: string;
    size: number;
    mtime: number;
    mime: string;
    contentHash?: string;
    path: string;
    data?: Record<string, string>;
}

interface DirBucket {
    dirHandle: FileSystemDirectoryHandle;
    relPath: string;
    images: ImageFile[];
    children: string[];
}

type PreservedAttrsByHash = Map<string, Record<string, string>>;

// ── MIME helpers ───────────────────────────────────────────────────────

function extOf(name: string): string {
    const i = name.lastIndexOf('.');
    return i >= 0 ? name.slice(i).toLowerCase() : '';
}

function mimeFromName(name: string): string {
    const ext = extOf(name);
    const map: Record<string, string> = {
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.png': 'image/png', '.gif': 'image/gif',
        '.webp': 'image/webp', '.tiff': 'image/tiff', '.tif': 'image/tiff',
        '.avif': 'image/avif', '.heic': 'image/heic', '.heif': 'image/heic',
    };
    return map[ext] ?? 'application/octet-stream';
}

// ── Crypto ─────────────────────────────────────────────────────────────

async function sha256(data: BufferSource): Promise<string> {
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

function isJpeg(buf: Uint8Array): boolean {
    return buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8;
}

/**
 * Strip JPEG metadata segments (APPn, COM) so content hash is stable
 * across metadata edits. Same logic as one.fotos/hash.ts.
 */
function stripJpegMetadata(buf: Uint8Array): Uint8Array {
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

async function hashImageFile(file: File): Promise<string> {
    const buf = new Uint8Array(await file.arrayBuffer());
    const data = isJpeg(buf) ? stripJpegMetadata(buf) : buf;
    return sha256(data.slice());
}

async function computeStreamId(
    contentHash: string,
    exifDate: string | undefined,
    mime: string
): Promise<string> {
    // Use exifDate + mime for deterministic identity when available
    if (exifDate) {
        const encoder = new TextEncoder();
        return sha256(encoder.encode(`browser:${exifDate}:${mime}`));
    }
    return contentHash;
}

// ── EXIF ───────────────────────────────────────────────────────────────

async function extractExif(file: File): Promise<ExifData> {
    const buf = await file.arrayBuffer();
    let tags;
    try {
        tags = ExifReader.load(buf, { expanded: true });
    } catch {
        return {};
    }

    const exif: ExifData = {};

    const dateTag = tags.exif?.DateTimeOriginal ?? tags.exif?.DateTime;
    if (dateTag?.description) {
        exif.date = dateTag.description.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
    }

    const make = tags.exif?.Make?.description;
    const model = tags.exif?.Model?.description;
    if (make || model) {
        const m = model ?? '';
        exif.camera = make && !m.startsWith(make) ? `${make} ${m}` : m;
    }

    if (tags.exif?.LensModel?.description) exif.lens = tags.exif.LensModel.description;
    if (tags.exif?.FocalLength?.description) exif.focalLength = tags.exif.FocalLength.description;
    if (tags.exif?.FNumber?.description) {
        const fNum = tags.exif.FNumber.description;
        exif.aperture = fNum.startsWith('f/') ? fNum : `f/${fNum}`;
    }
    if (tags.exif?.ExposureTime?.description) exif.shutter = tags.exif.ExposureTime.description;

    const iso = tags.exif?.ISOSpeedRatings?.description;
    if (iso) exif.iso = Number(iso);

    const lat = tags.gps?.Latitude;
    const lon = tags.gps?.Longitude;
    if (lat !== undefined && lon !== undefined) exif.gps = { lat, lon };

    const w = tags.file?.['Image Width']?.value ?? tags.exif?.PixelXDimension?.value;
    const h = tags.file?.['Image Height']?.value ?? tags.exif?.PixelYDimension?.value;
    if (w) exif.width = Number(w);
    if (h) exif.height = Number(h);

    return exif;
}

// ── Thumbnail via Canvas ───────────────────────────────────────────────

async function generateThumbBlob(file: File): Promise<Blob> {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const { width, height } = bitmap;

    // Scale to fit within THUMB_MAX
    const scale = Math.min(1, THUMB_MAX / Math.max(width, height));
    const tw = Math.round(width * scale);
    const th = Math.round(height * scale);

    const canvas = new OffscreenCanvas(tw, th);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0, tw, th);
    bitmap.close();

    return canvas.convertToBlob({ type: 'image/jpeg', quality: THUMB_QUALITY });
}

// ── Directory scanning ─────────────────────────────────────────────────

async function scanDirectory(
    dirHandle: FileSystemDirectoryHandle,
    relPath: string,
    buckets: DirBucket[]
): Promise<void> {
    const images: ImageFile[] = [];
    const children: string[] = [];

    for await (const [name, handle] of (dirHandle as any).entries()) {
        if (name.startsWith('.')) continue;

        if (handle.kind === 'file' && IMAGE_EXTS.has(extOf(name))) {
            const file = await (handle as FileSystemFileHandle).getFile();
            images.push({
                name,
                file,
                handle: handle as FileSystemFileHandle,
                relPath: relPath ? `${relPath}/${name}` : name,
                mime: mimeFromName(name),
            });
        } else if (handle.kind === 'directory' && name !== 'node_modules' && name !== 'one') {
            children.push(name);
        }
    }

    if (images.length > 0) {
        buckets.push({ dirHandle, relPath, images, children });
    }

    // Recurse into subdirectories
    for (const childName of children) {
        const childHandle = await dirHandle.getDirectoryHandle(childName);
        const childPath = relPath ? `${relPath}/${childName}` : childName;
        await scanDirectory(childHandle, childPath, buckets);
    }
}

// ── HTML renderer (inline, matching sync.core/fs/renderer.ts format) ──

function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const val = bytes / Math.pow(1024, i);
    return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${units[i]}`;
}

function formatDate(mtime: number): string {
    return new Date(mtime).toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric'
    });
}

function renderIndexHtml(
    dirPath: string,
    entries: FsEntry[],
    children: string[],
    scannedAt: number
): string {
    const title = dirPath || 'root';
    const scanned = new Date(scannedAt).toISOString();

    const childRows = children.map(c =>
        `        <tr class="fs-child">
            <td class="fs-icon">\u{1F4C1}</td>
            <td class="fs-name"><a href="${escapeHtml(c)}/one/index.html">${escapeHtml(c)}/</a></td>
            <td class="fs-size"></td><td class="fs-date"></td><td class="fs-path"></td>
        </tr>`
    ).join('\n');

    const entryRows = entries.map(e => {
        let attrs = ` data-mime="${escapeHtml(e.mime)}"`;
        if (e.contentHash) attrs += ` data-hash="${escapeHtml(e.contentHash)}"`;
        if (e.data) {
            for (const [key, value] of Object.entries(e.data)) {
                attrs += ` data-${escapeHtml(key)}="${escapeHtml(value)}"`;
            }
        }
        const thumbSrc = e.data?.thumb;
        const imgLink = `<a href="../${escapeHtml(e.name)}" target="_blank">`;
        const nameContent = thumbSrc
            ? `${imgLink}<img class="fs-thumb" src="${escapeHtml(thumbSrc)}" loading="lazy" alt=""></a>${imgLink}${escapeHtml(e.name)}</a>`
            : `${imgLink}${escapeHtml(e.name)}</a>`;

        return `        <tr class="fs-entry"${attrs}>
            <td class="fs-icon">\u{1F5BC}</td>
            <td class="fs-name">${nameContent}</td>
            <td class="fs-size">${formatSize(e.size)}</td>
            <td class="fs-date">${formatDate(e.mtime)}</td>
            <td class="fs-path">${escapeHtml(e.path)}</td>
        </tr>`;
    }).join('\n');

    const summary = `${entries.length} files, ${children.length} folders`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="generator" content="fotos.one browser-ingest">
<title>${escapeHtml(title)}</title>
<style>
:root{--fs-bg:#0e0e0e;--fs-fg:#d4d4d4;--fs-muted:#666;--fs-border:#222;--fs-accent:#4a9eff;--fs-row-hover:rgba(255,255,255,0.03)}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--fs-bg);color:var(--fs-fg);line-height:1.5}
.fs-node{max-width:960px;margin:0 auto;padding:24px 20px}
.fs-header{margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid var(--fs-border)}
.fs-title{font-size:1.4em;font-weight:600}
.fs-meta{display:flex;gap:16px;margin-top:6px;font-size:0.85em;color:var(--fs-muted)}
.fs-table{width:100%;border-collapse:collapse;font-size:0.9em}
.fs-table th{text-align:left;padding:8px 12px;font-size:0.75em;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--fs-muted);border-bottom:1px solid var(--fs-border)}
.fs-table td{padding:6px 12px;border-bottom:1px solid var(--fs-border);white-space:nowrap}
.fs-table tr:hover td{background:var(--fs-row-hover)}
.fs-icon{width:28px;text-align:center}.fs-name{font-weight:500;white-space:normal}
.fs-thumb{width:40px;height:40px;object-fit:cover;border-radius:3px;vertical-align:middle;margin-right:8px}
.fs-name a{color:var(--fs-accent);text-decoration:none}.fs-name a:hover{text-decoration:underline}.fs-thumb:hover{opacity:0.8}
.fs-size{text-align:right;color:var(--fs-muted);font-variant-numeric:tabular-nums;width:80px}
.fs-date{color:var(--fs-muted);width:100px}
.fs-path{color:var(--fs-muted);font-family:ui-monospace,monospace;font-size:0.85em;max-width:300px;overflow:hidden;text-overflow:ellipsis}
.fs-footer{max-width:960px;margin:24px auto 0;padding:16px 20px;border-top:1px solid var(--fs-border);text-align:right}
.fs-footer a{color:var(--fs-muted);text-decoration:none;font-size:0.75em;display:inline-flex;align-items:center;gap:4px}
.fs-footer a:hover{color:var(--fs-fg)}
.fotos-icon{width:14px;height:14px}
@media(max-width:640px){.fs-path{display:none}.fs-date{display:none}}
</style>
</head>
<body>
<article class="fs-node" data-path="${escapeHtml(dirPath)}" data-scanned="${scanned}">
    <header class="fs-header">
        <h1 class="fs-title">${escapeHtml(title)}</h1>
        <div class="fs-meta"><span class="fs-summary">${summary}</span></div>
    </header>
    <table class="fs-table">
        <thead><tr><th></th><th>Name</th><th>Size</th><th>Modified</th><th>Path</th></tr></thead>
        <tbody>
${childRows}${entryRows}
        </tbody>
    </table>
</article>
<footer class="fs-footer">
    <a href="https://fotos.one" target="_blank" rel="noopener">fotos.one</a>
</footer>
</body>
</html>`;
}

// ── File System Access write helpers ───────────────────────────────────

async function getOrCreateDir(
    parent: FileSystemDirectoryHandle,
    name: string
): Promise<FileSystemDirectoryHandle> {
    return parent.getDirectoryHandle(name, { create: true });
}

async function writeFile(
    dirHandle: FileSystemDirectoryHandle,
    name: string,
    data: Blob | string
): Promise<void> {
    const fileHandle = await dirHandle.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(data);
    await writable.close();
}

async function loadPreservedIndexAttrs(
    oneDir: FileSystemDirectoryHandle,
): Promise<PreservedAttrsByHash> {
    try {
        const indexHandle = await oneDir.getFileHandle('index.html');
        const file = await indexHandle.getFile();
        const html = await file.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const preserved = new Map<string, Record<string, string>>();

        for (const row of doc.querySelectorAll<HTMLTableRowElement>('tr.fs-entry')) {
            const contentHash = row.getAttribute('data-content-hash') ?? row.getAttribute('data-hash');
            if (!contentHash) {
                continue;
            }

            const attrs: Record<string, string> = {};
            for (const attrName of row.getAttributeNames()) {
                if (!attrName.startsWith('data-face-') && !attrName.startsWith('data-semantic-')) {
                    continue;
                }

                const value = row.getAttribute(attrName);
                if (value !== null) {
                    attrs[attrName.slice('data-'.length)] = value;
                }
            }

            if (Object.keys(attrs).length > 0) {
                preserved.set(contentHash, attrs);
            }
        }

        return preserved;
    } catch {
        return new Map();
    }
}

// ── Main ingest ────────────────────────────────────────────────────────

const FACES_DIR = 'faces';

export interface IngestProgress {
    phase: 'scanning' | 'processing' | 'preparing-faces' | 'faces' | 'preparing-semantic' | 'semantic' | 'writing' | 'done';
    current: number;
    total: number;
    fileName?: string;
    statusLabel?: string;
}

export interface FaceWorkerHandle {
    analyze(imageBlob: Blob, imageId: string): Promise<{
        dataAttrs: Record<string, string>;
        cropBlobs: Array<{ name: string; blob: Blob }>;
    }>;
}

/**
 * Ingest a directory: scan for images, extract metadata, generate thumbnails,
 * write one/index.html per directory.
 *
 * Requires the directory to be opened with `mode: 'readwrite'`.
 */
export async function ingestDirectory(
    rootHandle: FileSystemDirectoryHandle,
    onProgress?: (p: IngestProgress) => void,
    faceWorker?: FaceWorkerHandle,
): Promise<number> {
    // Phase 1: Scan
    onProgress?.({ phase: 'scanning', current: 0, total: 0 });
    const buckets: DirBucket[] = [];
    await scanDirectory(rootHandle, '', buckets);

    const totalImages = buckets.reduce((n, b) => n + b.images.length, 0);
    if (totalImages === 0) return 0;

    // Phase 2: Process each directory bucket
    let processed = 0;

    for (const bucket of buckets) {
        const oneDir = await getOrCreateDir(bucket.dirHandle, ONE_DIR);
        const thumbsDir = await getOrCreateDir(oneDir, THUMBS_DIR);
        const preservedIndexAttrs = await loadPreservedIndexAttrs(oneDir);

        const entries: FsEntry[] = [];

        for (const img of bucket.images) {
            onProgress?.({
                phase: 'processing',
                current: ++processed,
                total: totalImages,
                fileName: img.name,
            });

            const data: Record<string, string> = {};

            // Content hash
            const contentHash = await hashImageFile(img.file);
            data['content-hash'] = contentHash;

            // EXIF
            const exif = await extractExif(img.file);
            if (exif.date) data['exif-date'] = exif.date;
            if (exif.camera) data['exif-camera'] = exif.camera;
            if (exif.lens) data['exif-lens'] = exif.lens;
            if (exif.focalLength) data['exif-focal'] = exif.focalLength;
            if (exif.aperture) data['exif-aperture'] = exif.aperture;
            if (exif.shutter) data['exif-shutter'] = exif.shutter;
            if (exif.iso) data['exif-iso'] = String(exif.iso);
            if (exif.gps) data['exif-gps'] = `${exif.gps.lat},${exif.gps.lon}`;
            if (exif.width) data['exif-width'] = String(exif.width);
            if (exif.height) data['exif-height'] = String(exif.height);

            // Stream ID
            const streamId = await computeStreamId(contentHash, exif.date, img.mime);
            data['stream-id'] = streamId;

            const preserved = preservedIndexAttrs.get(contentHash);
            if (preserved) {
                Object.assign(data, preserved);
            }

            // Thumbnail
            try {
                const thumbBlob = await generateThumbBlob(img.file);
                const thumbName = `${streamId.slice(0, 8)}.jpg`;
                await writeFile(thumbsDir, thumbName, thumbBlob);
                data['thumb'] = `${THUMBS_DIR}/${thumbName}`;
            } catch (err) {
                console.warn(`Thumbnail failed for ${img.name}:`, err);
            }

            // Face detection + recognition
            if (faceWorker) {
                onProgress?.({
                    phase: 'faces',
                    current: processed,
                    total: totalImages,
                    fileName: img.name,
                });
                try {
                    const facesDir = await getOrCreateDir(oneDir, FACES_DIR);
                    const result = await faceWorker.analyze(img.file, streamId);
                    // Merge face data attributes
                    for (const [key, value] of Object.entries(result.dataAttrs)) {
                        data[key] = value;
                    }
                    // Write crop blobs
                    for (const crop of result.cropBlobs) {
                        const cropName = crop.name.split('/').pop()!;
                        await writeFile(facesDir, cropName, crop.blob);
                    }
                } catch (err) {
                    console.warn(`Face detection failed for ${img.name}:`, err);
                }
            }

            entries.push({
                name: img.name,
                size: img.file.size,
                mtime: img.file.lastModified,
                mime: img.mime,
                contentHash,
                path: img.relPath,
                data,
            });
        }

        // Phase 3: Write one/index.html
        onProgress?.({
            phase: 'writing',
            current: processed,
            total: totalImages,
        });

        const html = renderIndexHtml(
            bucket.relPath || '.',
            entries,
            bucket.children.filter(c => buckets.some(b =>
                b.relPath === (bucket.relPath ? `${bucket.relPath}/${c}` : c)
            )),
            Date.now()
        );

        await writeFile(oneDir, 'index.html', html);
    }

    onProgress?.({ phase: 'done', current: totalImages, total: totalImages });
    return totalImages;
}

// ── Mobile ingest (in-memory, no one/ write) ──────────────────────────

export interface MobilePhotoEntry {
    hash: string;
    name: string;
    managed: 'metadata';
    sourcePath: string;
    folderPath?: string;
    mimeType?: string;
    /** Object URL for thumbnail */
    thumb?: string;
    /** Object URL for full image */
    objectUrl: string;
    tags: string[];
    capturedAt?: string;
    updatedAt?: string;
    exif?: ExifData;
    addedAt: string;
    size: number;
}

/**
 * Ingest a FileList (from <input type="file">) in-memory.
 * Returns PhotoEntry-compatible objects with object URLs for display.
 * No filesystem writes — works on mobile browsers without FSA API.
 */
export async function ingestFiles(
    fileList: FileList,
    onProgress?: (p: IngestProgress) => void
): Promise<MobilePhotoEntry[]> {
    const files: File[] = [];
    for (let i = 0; i < fileList.length; i++) {
        const f = fileList[i];
        if (f.type.startsWith('image/') || IMAGE_EXTS.has(extOf(f.name))) {
            files.push(f);
        }
    }

    if (files.length === 0) return [];

    const entries: MobilePhotoEntry[] = [];

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        onProgress?.({
            phase: 'processing',
            current: i + 1,
            total: files.length,
            fileName: file.name,
        });

        const contentHash = await hashImageFile(file);
        const exif = await extractExif(file);
        const relPath = (file as any).webkitRelativePath || file.name;
        const folder = relPath.includes('/') ? relPath.split('/').slice(1, -1).join('/') : '';

        // Generate thumbnail as object URL
        let thumb: string | undefined;
        try {
            const thumbBlob = await generateThumbBlob(file);
            thumb = URL.createObjectURL(thumbBlob);
        } catch { /* skip */ }

        entries.push({
            hash: contentHash,
            name: file.name,
            managed: 'metadata',
            sourcePath: relPath,
            folderPath: folder || undefined,
            mimeType: file.type || mimeFromName(file.name),
            thumb,
            objectUrl: URL.createObjectURL(file),
            tags: folder ? [folder.split('/')[0]] : [],
            capturedAt: exif.date ?? new Date(file.lastModified).toISOString(),
            updatedAt: new Date(file.lastModified).toISOString(),
            exif: Object.keys(exif).length > 0 ? exif : undefined,
            addedAt: exif.date ?? new Date(file.lastModified).toISOString(),
            size: file.size,
        });
    }

    onProgress?.({ phase: 'done', current: files.length, total: files.length });
    return entries;
}
