// pipeline.ts — Shared ingest pipeline. Orchestrates per-folder ingestion on Node.js.
import fs from 'node:fs';
import path from 'node:path';
import type { FsEntry, IngestProgress } from './types.js';
import { THUMBS_DIR } from './types.js';
import { hashImageBytes, computeStreamId } from './hash.js';
import { extractExif } from './exif.js';
import { renderIndexHtml, parseIndexHtml, type ParsedPhotoEntry } from './index-html.js';
import { listImages, readImageBytes, generateThumbnail, writeBytes } from './platform-node.js';

export interface IngestFolderResult {
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
    if (images.length === 0) return { entries: [], photosProcessed: 0 };

    const oneDir = path.join(folderPath, 'one');
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
        return { entries: [], photosProcessed: 0 };
    }

    // Discover child directories that also have images (for the HTML child links)
    const children: string[] = [];
    try {
        for (const entry of fs.readdirSync(folderPath, { withFileTypes: true })) {
            if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'one') continue;
            const childImages = listImages(path.join(folderPath, entry.name));
            if (childImages.length > 0) children.push(entry.name);
        }
    } catch { /* ignore */ }

    // Write .one/index.html
    const html = renderIndexHtml(relPath || '.', fsEntries, children, Date.now());
    writeBytes(path.join(oneDir, 'index.html'), html);

    onProgress?.({ phase: 'done', current: processed, total: images.length });

    // Parse back for trie insertion (reuse our own parser to stay consistent)
    const parsed = parseIndexHtml(html, relPath);

    return { entries: parsed, photosProcessed: processed };
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
