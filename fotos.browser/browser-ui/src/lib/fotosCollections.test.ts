import { describe, expect, it } from 'vitest';

import type { PhotoEntry } from '@/types/fotos';

import {
    buildFotosCollectionFromSelection,
    buildFotosCollectionSummary,
    collectionMatchesPhoto,
    deserializeFotosLibraryState,
} from './fotosCollections';

function createPhoto(overrides: Partial<PhotoEntry> = {}): PhotoEntry {
    return {
        hash: overrides.hash ?? 'photo-hash',
        name: overrides.name ?? 'photo.jpg',
        managed: overrides.managed ?? 'metadata',
        tags: overrides.tags ?? [],
        capturedAt: overrides.capturedAt ?? '2024-01-01T00:00:00.000Z',
        updatedAt: overrides.updatedAt ?? '2024-01-01T00:00:00.000Z',
        addedAt: overrides.addedAt ?? '2024-01-01T00:00:00.000Z',
        size: overrides.size ?? 123,
        ...overrides,
    };
}

describe('deserializeFotosLibraryState', () => {
    it('normalizes persisted collection and share data', () => {
        expect(deserializeFotosLibraryState(JSON.stringify({
            collections: [{
                id: 'collection-1',
                name: ' Summer ',
                photoHashes: ['photo-1', 'photo-1', ''],
                clusterIds: ['cluster-a', 'cluster-a'],
                personIds: ['person-a', ''],
                createdAt: '2024-01-01T00:00:00.000Z',
                updatedAt: '2024-01-02T00:00:00.000Z',
            }],
            sharing: {
                galleryPersonIds: ['person-a', 'person-a', ''],
                collectionPersonIds: {
                    'collection-1': ['person-b', 'person-b'],
                },
                clusterPersonIds: {
                    'person:abc': ['person-c'],
                },
            },
        }))).toEqual({
            version: 1,
            collections: [{
                id: 'collection-1',
                name: 'Summer',
                photoHashes: ['photo-1'],
                clusterIds: ['cluster-a'],
                personIds: ['person-a'],
                createdAt: '2024-01-01T00:00:00.000Z',
                updatedAt: '2024-01-02T00:00:00.000Z',
            }],
            sharing: {
                galleryPersonIds: ['person-a'],
                collectionPersonIds: {
                    'collection-1': ['person-b'],
                },
                clusterPersonIds: {
                    'person:abc': ['person-c'],
                },
            },
        });
    });
});

describe('collectionMatchesPhoto', () => {
    it('matches direct photo selections, clusters, and people', () => {
        const photo = createPhoto({
            hash: 'photo-1',
            faces: {
                count: 1,
                bboxes: [[0, 0, 10, 10]],
                scores: [0.9],
                embeddings: null,
                crops: [],
                clusterIds: ['cluster-a'],
                personIds: ['person-a'],
                names: ['Alice'],
            },
        });

        expect(collectionMatchesPhoto({
            id: 'collection-1',
            name: 'Test',
            photoHashes: ['photo-1'],
            clusterIds: [],
            personIds: [],
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
        }, photo)).toBe(true);

        expect(collectionMatchesPhoto({
            id: 'collection-2',
            name: 'Clusters',
            photoHashes: [],
            clusterIds: ['cluster-a'],
            personIds: [],
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
        }, photo)).toBe(true);

        expect(collectionMatchesPhoto({
            id: 'collection-3',
            name: 'People',
            photoHashes: [],
            clusterIds: [],
            personIds: ['person-a'],
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
        }, photo)).toBe(true);
    });
});

describe('buildFotosCollectionSummary', () => {
    it('counts matched photos and faces across all collection sources', () => {
        const collection = {
            id: 'collection-1',
            name: 'Family',
            photoHashes: ['photo-1'],
            clusterIds: ['cluster-a'],
            personIds: ['person-b'],
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
        };

        const summary = buildFotosCollectionSummary(collection, [
            createPhoto({
                hash: 'photo-1',
                faces: {
                    count: 1,
                    bboxes: [[0, 0, 10, 10]],
                    scores: [0.9],
                    embeddings: null,
                    crops: [],
                    clusterIds: ['cluster-z'],
                },
            }),
            createPhoto({
                hash: 'photo-2',
                faces: {
                    count: 2,
                    bboxes: [[0, 0, 10, 10], [10, 10, 20, 20]],
                    scores: [0.9, 0.8],
                    embeddings: null,
                    crops: [],
                    clusterIds: ['cluster-a', 'cluster-a'],
                },
            }),
            createPhoto({
                hash: 'photo-3',
                faces: {
                    count: 1,
                    bboxes: [[0, 0, 10, 10]],
                    scores: [0.9],
                    embeddings: null,
                    crops: [],
                    personIds: ['person-b'],
                },
            }),
        ]);

        expect(summary.photoCount).toBe(3);
        expect(summary.faceCount).toBe(4);
        expect(summary.coverPhotoHash).toBe('photo-1');
        expect(summary.matchedPhotoHashes).toEqual(['photo-1', 'photo-2', 'photo-3']);
    });
});

describe('buildFotosCollectionFromSelection', () => {
    it('collects photo, cluster, and person ids from the current selection', () => {
        const collection = buildFotosCollectionFromSelection(
            'Family picks',
            [createPhoto({ hash: 'photo-1' }), createPhoto({ hash: 'photo-2' })],
            [{
                clusterId: 'person:alice',
                personId: 'alice',
                personName: 'Alice',
                label: 'Alice',
                faceCount: 3,
                photoCount: 2,
                photoHashes: ['photo-1', 'photo-3'],
                memberClusterIds: ['cluster-a', 'cluster-b'],
            }],
            0,
        );

        expect(collection.name).toBe('Family picks');
        expect(collection.photoHashes).toEqual(['photo-1', 'photo-2']);
        expect(collection.clusterIds).toEqual(['cluster-a', 'cluster-b']);
        expect(collection.personIds).toEqual(['alice']);
    });
});
