// fotos.core/src/ingest/types.ts

export const IMAGE_EXTS = new Set([
    '.jpg', '.jpeg', '.png', '.webp', '.gif', '.tiff', '.tif', '.avif', '.heic', '.heif',
]);
export const THUMB_MAX = 400;
export const THUMB_QUALITY = 0.8;
export const ONE_DIR = 'one';
export const THUMBS_DIR = 'thumbs';

export interface ExifData {
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

export interface FsEntry {
    name: string;
    size: number;
    mtime: number;
    mime: string;
    contentHash?: string;
    path: string;
    data?: Record<string, string>;
}

export interface IngestProgress {
    phase: 'scanning' | 'processing' | 'writing' | 'done' | 'error';
    current: number;
    total: number;
    fileName?: string;
    statusLabel?: string;
}
