// pipeline.ts — Shared ingest pipeline. Orchestrates per-folder ingestion on Node.js.
import fs from 'node:fs';
import path from 'node:path';
import type { FsEntry, FolderMetadata, IngestProgress } from './types.js';
import { ONE_DIR, THUMBS_DIR } from './types.js';
import { hashImageBytes, computeStreamId } from './hash.js';
import { extractExif } from './exif.js';
import { renderIndexHtml, parseIndexHtml, parseFolderMeta, parseFolderIndex, type ParsedPhotoEntry } from './index-html.js';
import { listImages, readImageBytes, generateThumbnail, writeBytes } from './platform-node.js';

export interface IngestFolderResult {
    meta: FolderMetadata;
    entries: ParsedPhotoEntry[];
    photosProcessed: number;
}

/**
 * Ingest a single folder: scan images, extract EXIF, generate thumbnails,
 * write .one/index.html. Returns parsed entries for trie insertion.
 *
 * @param folderPath - Absolute path to the folder
 * @param relPath - Relative path from library root ('' for root)
 * @param onProgress - Progress callback
 * @param signal - AbortSignal for pause/cancel support
 */
export async function ingestFolder(
    folderPath: string,
    relPath: string,
    onProgress?: (p: IngestProgress) => void,
    signal?: { aborted: boolean },
): Promise<IngestFolderResult> {
    const images = listImages(folderPath);
    const folderName = relPath ? path.basename(relPath) : path.basename(folderPath) || 'root';

    if (images.length === 0) {
        const emptyMeta: FolderMetadata = {
            path: relPath,
            name: folderName,
            photoCount: 0,
            localCount: 0,
            childCount: 0,
        };
        return { meta: emptyMeta, entries: [], photosProcessed: 0 };
    }

    const oneDir = path.join(folderPath, ONE_DIR);
    const thumbsDir = path.join(oneDir, THUMBS_DIR);

    // Load preserved attrs from existing index.html (face data, semantic data)
    const preservedAttrs = loadPreservedAttrs(path.join(oneDir, 'index.html'));

    const fsEntries: FsEntry[] = [];
    let processed = 0;

    for (const img of images) {
        if (signal?.aborted) break;

        onProgress?.({
            phase: 'processing',
            current: ++processed,
            total: images.length,
            fileName: img.name,
        });

        const bytes = readImageBytes(img.absPath);
        const data: Record<string, string> = {};

        // Content hash
        const contentHash = await hashImageBytes(bytes);
        data['content-hash'] = contentHash;

        // EXIF
        const exif = await extractExif(bytes);
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

        // Preserve face/semantic data from prior ingestion
        const preserved = preservedAttrs.get(contentHash);
        if (preserved) Object.assign(data, preserved);

        // Thumbnail
        try {
            const thumbBytes = await generateThumbnail(img.absPath);
            const thumbName = `${streamId.slice(0, 8)}.jpg`;
            writeBytes(path.join(thumbsDir, thumbName), thumbBytes);
            data['thumb'] = `${THUMBS_DIR}/${thumbName}`;
        } catch (err) {
            console.warn(`Thumbnail failed for ${img.name}:`, err);
        }

        fsEntries.push({
            name: img.name,
            size: img.size,
            mtime: img.mtime,
            mime: img.mime,
            contentHash,
            path: relPath ? `${relPath}/${img.name}` : img.name,
            data,
        });
    }

    // If signal aborted before any entries were processed, return early
    if (fsEntries.length === 0) {
        const abortedMeta: FolderMetadata = {
            path: relPath,
            name: folderName,
            photoCount: 0,
            localCount: 0,
            childCount: 0,
        };
        return { meta: abortedMeta, entries: [], photosProcessed: 0 };
    }

    // Discover child folder metadata from existing child one/index.html files
    const childrenMeta: FolderMetadata[] = discoverChildFolderMeta(folderPath, relPath);

    // Write .one/index.html
    const html = renderIndexHtml(relPath || '.', fsEntries, childrenMeta, Date.now());
    writeBytes(path.join(oneDir, 'index.html'), html);

    onProgress?.({ phase: 'done', current: processed, total: images.length });

    // Parse back for trie insertion (reuse our own parser to stay consistent)
    const parsed = parseIndexHtml(html, relPath);

    // Compute FolderMetadata for this folder
    const meta = computeFolderMeta(relPath, folderName, fsEntries, childrenMeta);

    return { meta, entries: parsed, photosProcessed: processed };
}

/**
 * Load preserved face/semantic attributes from an existing .one/index.html.
 * Returns Map<contentHash, Record<attrName, value>>
 */
function loadPreservedAttrs(indexPath: string): Map<string, Record<string, string>> {
    const preserved = new Map<string, Record<string, string>>();
    if (!fs.existsSync(indexPath)) return preserved;

    const html = fs.readFileSync(indexPath, 'utf-8');
    const rowRegex = /<tr\s+class="fs-entry"([^>]*)>/g;
    let match;

    while ((match = rowRegex.exec(html)) !== null) {
        const attrs = match[1];
        const hashMatch = attrs.match(/data-(?:content-hash|hash)="([^"]*)"/i);
        if (!hashMatch) continue;

        const hash = hashMatch[1];
        const attrData: Record<string, string> = {};
        const attrRegex = /data-(face-[^=]+|semantic-[^=]+)="([^"]*)"/gi;
        let attrMatch;
        while ((attrMatch = attrRegex.exec(attrs)) !== null) {
            attrData[attrMatch[1]] = attrMatch[2];
        }

        if (Object.keys(attrData).length > 0) {
            preserved.set(hash, attrData);
        }
    }

    return preserved;
}

/**
 * Discover child directories and extract their FolderMetadata from existing one/index.html files.
 * For child dirs without an index, synthesize minimal metadata.
 */
function discoverChildFolderMeta(folderPath: string, parentRelPath: string): FolderMetadata[] {
    const children: FolderMetadata[] = [];
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(folderPath, { withFileTypes: true });
    } catch {
        return children;
    }

    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === ONE_DIR) continue;

        const childDir = path.join(folderPath, entry.name);
        const childRelPath = parentRelPath ? `${parentRelPath}/${entry.name}` : entry.name;
        const childIndexPath = path.join(childDir, ONE_DIR, 'index.html');

        if (fs.existsSync(childIndexPath)) {
            // Extract metadata from existing child index
            const html = fs.readFileSync(childIndexPath, 'utf-8');
            const meta = parseFolderMeta(html);
            // Ensure the path matches our expectation (the child index may have been written with a different relPath)
            children.push({ ...meta, path: childRelPath, name: entry.name });
        } else {
            // Check if child has images — if so, create minimal metadata
            const childImages = listImages(childDir);
            if (childImages.length > 0) {
                children.push({
                    path: childRelPath,
                    name: entry.name,
                    photoCount: childImages.length,
                    localCount: childImages.length,
                    childCount: 0,
                });
            }
        }
    }

    return children;
}

/**
 * Compute FolderMetadata for this folder from its entries and child metadata.
 */
function computeFolderMeta(
    relPath: string,
    name: string,
    entries: FsEntry[],
    children: FolderMetadata[],
): FolderMetadata {
    const localCount = entries.length;
    const childPhotoSum = children.reduce((s, c) => s + c.photoCount, 0);
    const photoCount = localCount + childPhotoSum;

    // Collect all dates: entry exif dates + child date ranges
    const dates: string[] = [];
    for (const e of entries) {
        const d = e.data?.['exif-date'];
        if (d) dates.push(d);
    }
    for (const c of children) {
        if (c.dateRangeStart) dates.push(c.dateRangeStart);
        if (c.dateRangeEnd) dates.push(c.dateRangeEnd);
    }
    dates.sort();

    return {
        path: relPath,
        name,
        photoCount,
        localCount,
        dateRangeStart: dates.length > 0 ? dates[0] : undefined,
        dateRangeEnd: dates.length > 0 ? dates[dates.length - 1] : undefined,
        childCount: children.length,
    };
}

/**
 * Update (or create) a parent folder's one/index.html with a child's FolderMetadata.
 * If the parent already has an index, replaces the matching child entry (by path) or adds a new one.
 * If the parent has no index, creates one with just the child reference (no photo entries).
 *
 * @param parentPath - Absolute path to the parent folder
 * @param childMeta - The child folder's FolderMetadata to insert/update
 * @param parentRelPath - Relative path of the parent from the library root
 */
export function updateParentIndex(
    parentPath: string,
    childMeta: FolderMetadata,
    parentRelPath: string,
): void {
    const parentOneDir = path.join(parentPath, ONE_DIR);
    const parentIndexPath = path.join(parentOneDir, 'index.html');

    if (fs.existsSync(parentIndexPath)) {
        // Parse existing parent index
        const html = fs.readFileSync(parentIndexPath, 'utf-8');
        const parsed = parseFolderIndex(html, parentRelPath);

        // Replace matching child (by path) or add new one
        const existingIdx = parsed.children.findIndex(c => c.path === childMeta.path);
        if (existingIdx >= 0) {
            parsed.children[existingIdx] = childMeta;
        } else {
            parsed.children.push(childMeta);
        }

        // Reconstruct FsEntries from parsed photo entries for re-rendering
        const fsEntries = parsedEntriesToFsEntries(parsed.entries, parentRelPath);

        // Re-render with updated children
        const newHtml = renderIndexHtml(
            parentRelPath || '.',
            fsEntries,
            parsed.children,
            Date.now(),
        );
        writeBytes(parentIndexPath, newHtml);
    } else {
        // Create a new parent index with just the child reference, no photo entries
        const html = renderIndexHtml(
            parentRelPath || '.',
            [],
            [childMeta],
            Date.now(),
        );
        writeBytes(parentIndexPath, html);
    }
}

/**
 * Convert ParsedPhotoEntry[] back to FsEntry[] for re-rendering.
 * This is needed when updating a parent index that already has photo entries.
 */
function parsedEntriesToFsEntries(entries: ParsedPhotoEntry[], relPath: string): FsEntry[] {
    return entries.map(e => {
        const data: Record<string, string> = {};

        if (e.contentHash) data['content-hash'] = e.contentHash;
        if (e.streamId) data['stream-id'] = e.streamId;

        // EXIF
        if (e.exif) {
            if (e.exif.date) data['exif-date'] = e.exif.date;
            if (e.exif.camera) data['exif-camera'] = e.exif.camera;
            if (e.exif.lens) data['exif-lens'] = e.exif.lens;
            if (e.exif.focalLength) data['exif-focal'] = e.exif.focalLength;
            if (e.exif.aperture) data['exif-aperture'] = e.exif.aperture;
            if (e.exif.shutter) data['exif-shutter'] = e.exif.shutter;
            if (e.exif.iso !== undefined) data['exif-iso'] = String(e.exif.iso);
            if (e.exif.gps) data['exif-gps'] = `${e.exif.gps.lat},${e.exif.gps.lon}`;
            if (e.exif.width !== undefined) data['exif-width'] = String(e.exif.width);
            if (e.exif.height !== undefined) data['exif-height'] = String(e.exif.height);
        }

        // Face data
        if (e.faceData) Object.assign(data, e.faceData);

        // Thumb — strip relPath prefix from thumb path to get the one-relative path
        if (e.thumb) {
            const prefix = relPath ? `${relPath}/.one/` : '.one/';
            data['thumb'] = e.thumb.startsWith(prefix) ? e.thumb.slice(prefix.length) : e.thumb;
        }

        return {
            name: e.name,
            size: e.size,
            mtime: 0, // mtime is not preserved in parsed entries, use 0
            mime: e.mime,
            contentHash: e.contentHash,
            path: e.sourcePath,
            data,
        };
    });
}
