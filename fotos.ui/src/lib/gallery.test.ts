import {describe, expect, it} from 'vitest';
import {EMBEDDING_DIM} from '@refinio/fotos.core';
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

    it('ranks photos by their best-matching face and drops photos with no face above threshold', () => {
        const dim = EMBEDDING_DIM;
        const face = (hot: number, weight = 1) => {
            const v = new Float32Array(dim);
            v[0] = weight;
            v[hot] = Math.sqrt(1 - weight * weight);
            return v;
        };
        const flat = (...faces: Float32Array[]) => {
            const out = new Float32Array(faces.length * dim);
            faces.forEach((f, i) => out.set(f, i * dim));
            return out;
        };
        const faces = (embeddings: Float32Array, count: number) => ({
            count, bboxes: [], scores: [], embeddings, crops: [],
        });
        const photos = [
            makePhoto('weak', '2026-03-10T10:00:00.000Z', {faces: faces(flat(face(1, 0.4)), 1)}),
            makePhoto('strong', '2026-03-09T10:00:00.000Z', {faces: faces(flat(face(2, 0.1), face(3, 0.9)), 2)}),
            makePhoto('none', '2026-03-08T10:00:00.000Z', {faces: faces(flat(face(4, 0.2)), 1)}),
        ];
        const searchFace = face(5, 1);

        expect(filterGalleryPhotos(photos, {searchFace}).map(photo => photo.hash)).toEqual(['strong', 'weak']);
    });

    it('returns no photos when a semantic query matches nothing, even if the text would match', () => {
        const photos = [
            makePhoto('a', '2026-03-10T10:00:00.000Z', {
                name: 'schuhe.jpg',
                semantic: {modelId: 'clip-vit-base-patch32', embedding: new Float32Array([0, 1, 0])},
            }),
            makePhoto('b', '2026-03-09T10:00:00.000Z', {name: 'schuhe-2.jpg'}),
        ];

        expect(filterGalleryPhotos(photos, {
            searchQuery: 'schuhe',
            searchEmbedding: {modelId: 'clip-vit-base-patch32', embedding: new Float32Array([1, 0, 0])},
        })).toEqual([]);
    });

    it('prefers semantic matches for text search when embeddings are available', () => {
        const photos = [
            makePhoto('a', '2026-03-10T10:00:00.000Z', {
                name: 'shoe-rack.jpg',
                semantic: {
                    modelId: 'clip-vit-base-patch32',
                    embedding: new Float32Array([1, 0, 0]),
                },
            }),
            makePhoto('b', '2026-03-09T10:00:00.000Z', {
                name: 'street.jpg',
                semantic: {
                    modelId: 'clip-vit-base-patch32',
                    embedding: new Float32Array([0.1, 1, 0]),
                },
            }),
            makePhoto('c', '2026-03-08T10:00:00.000Z', {
                name: 'schuhe-notes.jpg',
            }),
        ];

        const searchEmbedding = {
            modelId: 'clip-vit-base-patch32',
            embedding: new Float32Array([1, 0, 0]),
        };

        expect(filterGalleryPhotos(photos, {
            searchQuery: 'schuhe',
            searchEmbedding,
        }).map(photo => photo.hash)).toEqual(['a']);
    });
});
