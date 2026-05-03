// platform-node.ts — Node.js platform functions for photo ingestion
import fs from 'node:fs';
import path from 'node:path';
import { IMAGE_EXTS } from './types.js';

export interface ThumbnailGeneratorOptions {
    maxSize: number;
    quality: number;
}

export type ThumbnailGenerator = (
    filePath: string,
    options: ThumbnailGeneratorOptions,
) => Promise<Uint8Array>;

let thumbnailGenerator: ThumbnailGenerator | null = null;

export function setThumbnailGenerator(generator: ThumbnailGenerator | null): void {
    thumbnailGenerator = generator;
}

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

export interface FolderInfo {
    name: string;
    absPath: string;
    relPath: string;
}

export interface ImageInfo {
    name: string;
    absPath: string;
    mime: string;
    size: number;
    mtime: number;
}

/**
 * Discover all folders in the photo library that contain images (recursive).
 * Skips hidden directories, `one`, and `node_modules`.
 * Returns root first (if it has images), then subdirectories depth-first.
 */
export function discoverFolders(rootDir: string): FolderInfo[] {
    const folders: FolderInfo[] = [];
    walkFolders(rootDir, rootDir, folders);
    return folders;
}

function walkFolders(dir: string, rootDir: string, folders: FolderInfo[]): void {
    const images = listImages(dir);
    const relPath = path.relative(rootDir, dir);
    const name = relPath === '' ? path.basename(rootDir) : path.basename(dir);

    if (images.length > 0) {
        folders.push({ name, absPath: dir, relPath });
    }

    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.') || entry.name === 'one' || entry.name === 'node_modules') continue;
        walkFolders(path.join(dir, entry.name), rootDir, folders);
    }
}

/**
 * List image files in a single directory (non-recursive).
 * Skips hidden files and non-image extensions.
 */
export function listImages(dir: string): ImageInfo[] {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return [];
    }

    const images: ImageInfo[] = [];
    for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (entry.name.startsWith('.')) continue;
        if (!IMAGE_EXTS.has(extOf(entry.name))) continue;

        const absPath = path.join(dir, entry.name);
        const stat = fs.statSync(absPath);
        images.push({
            name: entry.name,
            absPath,
            mime: mimeFromName(entry.name),
            size: stat.size,
            mtime: stat.mtimeMs,
        });
    }
    return images;
}

/**
 * Read image file as Uint8Array.
 */
export function readImageBytes(filePath: string): Uint8Array {
    return new Uint8Array(fs.readFileSync(filePath));
}

/**
 * Generate thumbnail using the configured platform thumbnail generator.
 * The core package stays free of Node.js-only image libraries by requiring
 * callers to inject a platform-specific implementation.
 */
export async function generateThumbnail(
    filePath: string,
    maxSize: number = 400,
    quality: number = 80,
): Promise<Uint8Array> {
    if (!thumbnailGenerator) {
        throw new Error(
            'No thumbnail generator configured. Inject a platform-specific implementation with setThumbnailGenerator() before using Node ingest helpers.',
        );
    }

    return thumbnailGenerator(filePath, { maxSize, quality });
}

/**
 * Write bytes to a file, creating parent directories as needed.
 */
export function writeBytes(filePath: string, data: Uint8Array | string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, data);
}
