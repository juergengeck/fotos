import {describe, expect, it} from 'vitest';
import type {FotosEntry} from './recipes/FotosRecipes.js';
import {applyGalleryDelta} from './fotos-gallery-delta.js';

const entry: FotosEntry = {
    $type$: 'FotosEntry', contentHash: 'a'.repeat(64), streamId: 'archive',
    mime: 'image/heic', size: 24, sourcePath: 'Archive/original.heic', folderPath: 'Archive',
    originalFilename: 'original.heic', capturedAt: '2026-11-22T15:00:00Z',
    favorite: true, exifGpsLat: 52, exifGpsLon: 13, exifCamera: 'Camera',
    tags: new Set(['Trip']), faceCount: 2,
    variants: new Set(), acquisitionObservations: new Set(),
};

describe('Fotos gallery delta', () => {
    it('learns gallery changes and preserves the existing library organization and enrichment', () => {
        const observed = {
            ...entry, streamId: 'phone', sourcePath: 'Photo Library/renamed.heic', folderPath: 'Photo Library',
            originalFilename: 'renamed.heic', capturedAt: '2026-11-23T08:00:00Z', size: 48,
            exifGpsLat: 53, exifGpsLon: 14, favorite: false, tags: new Set(['OS label']), faceCount: 0,
        };
        expect(applyGalleryDelta(entry, {observed})).toEqual({
            ...entry, originalFilename: observed.originalFilename, capturedAt: observed.capturedAt,
            size: 48, exifGpsLat: 53, exifGpsLon: 14, favorite: false,
        });
    });

    it('retains unknown fields and clears only explicitly removed gallery values', () => {
        const observed = {contentHash: entry.contentHash, streamId: 'phone', mime: entry.mime, size: entry.size};
        const updated = applyGalleryDelta(entry, {observed, cleared: ['exifGpsLat', 'exifGpsLon']});
        expect(updated.exifCamera).toBe('Camera');
        expect(updated).not.toHaveProperty('exifGpsLat');
        expect(updated).not.toHaveProperty('exifGpsLon');
        expect(entry.exifGpsLat).toBe(52);
    });

    it('cannot update a different content identity', () => {
        expect(() => applyGalleryDelta(entry, {observed: {...entry, contentHash: 'b'.repeat(64)}}))
            .toThrow('same Fotos content hash');
    });
});
