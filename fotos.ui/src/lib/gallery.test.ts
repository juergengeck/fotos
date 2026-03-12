import {describe, expect, it} from 'vitest';
import type {PhotoEntry} from '../types/fotos.js';
import {
    collectTagCounts,
    filterGalleryPhotos,
    groupPhotosByDay,
    photoDate,
} from './gallery.js';

function makePhoto(
    hash: string,
    addedAt: string,
    overrides: Partial<PhotoEntry> = {}
): PhotoEntry {
    return {
        hash,
        name: `${hash}.jpg`,
        managed: 'metadata',
        tags: [],
        addedAt,
        size: 1000,
        ...overrides,
    };
}

describe('gallery helpers', () => {
    it('counts tags and groups by canonical date', () => {
        const photos = [
            makePhoto('a', '2026-03-10T10:00:00.000Z', {tags: ['travel'], capturedAt: '2026-03-10T08:00:00.000Z'}),
            makePhoto('b', '2026-03-10T12:00:00.000Z', {tags: ['travel', 'favorites'], capturedAt: '2026-03-10T09:00:00.000Z'}),
            makePhoto('c', '2026-03-08T12:00:00.000Z', {tags: ['family'], capturedAt: '2026-03-08T09:00:00.000Z'}),
        ];

        expect(photoDate(photos[0])).toBe('2026-03-10');
        expect(collectTagCounts(photos)).toEqual([
            ['travel', 2],
            ['favorites', 1],
            ['family', 1],
        ]);
        expect(groupPhotosByDay(photos)).toEqual([
            {date: '2026-03-10', photos: [photos[0], photos[1]]},
            {date: '2026-03-08', photos: [photos[2]]},
        ]);
    });

    it('filters with cluster-first face matching and text fallback', () => {
        const searchFace = new Float32Array(512);
        searchFace[0] = 1;

        const matchingEmbeddings = new Float32Array(1024);
        matchingEmbeddings[0] = 1;
        matchingEmbeddings[512] = 0.2;

        const otherEmbeddings = new Float32Array(512);
        otherEmbeddings[0] = 0.1;

        const photos = [
            makePhoto('a', '2026-03-10T10:00:00.000Z', {
                name: 'alice.jpg',
                tags: ['people'],
                faces: {
                    count: 2,
                    bboxes: [],
                    scores: [],
                    embeddings: matchingEmbeddings,
                    crops: [],
                    clusterIds: ['cluster-a', 'cluster-b'],
                },
            }),
            makePhoto('b', '2026-03-09T10:00:00.000Z', {
                name: 'alice-2.jpg',
                tags: ['people'],
                faces: {
                    count: 1,
                    bboxes: [],
                    scores: [],
                    embeddings: otherEmbeddings,
                    crops: [],
                    clusterIds: ['cluster-a'],
                },
            }),
            makePhoto('c', '2026-03-08T10:00:00.000Z', {
                name: 'berlin.jpg',
                tags: ['travel'],
            }),
        ];

        expect(filterGalleryPhotos(photos, {searchFace}).map(photo => photo.hash)).toEqual(['a', 'b']);
        expect(filterGalleryPhotos(photos, {activeTag: 'travel', searchQuery: 'ber'}).map(photo => photo.hash)).toEqual(['c']);
    });
});
