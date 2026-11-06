// exif.ts — Shared EXIF parser for ingest pipeline
import ExifReader from 'exifreader';
import type { ExifData } from './types.js';

/**
 * Extract EXIF metadata from raw image bytes.
 * Platform-agnostic — takes Uint8Array or ArrayBuffer instead of File.
 */
export async function extractExif(bytes: Uint8Array | ArrayBuffer): Promise<ExifData> {
    const buf = bytes instanceof ArrayBuffer
        ? bytes
        : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
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
