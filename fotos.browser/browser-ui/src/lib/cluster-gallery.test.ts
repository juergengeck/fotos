import { describe, expect, it } from 'vitest';

import { buildFaceClusterSummaries } from './cluster-gallery';
import type { PhotoEntry } from '@/types/fotos';

function createPhoto(
    hash: string,
    clusterId: string,
    name: string,
    personId?: string,
): PhotoEntry {
    return {
        hash,
        name: `${hash}.jpg`,
        managed: 'metadata',
        tags: [],
        addedAt: '2026-01-01T00:00:00.000Z',
        size: 1,
        faces: {
            count: 1,
            bboxes: [[0, 0, 10, 10]],
            scores: [0.99],
            embeddings: null,
            crops: [`faces/${hash}.jpg`],
            clusterIds: [clusterId],
            names: [name],
            personIds: [personId ?? ''],
        },
    };
}

describe('buildFaceClusterSummaries', () => {
    it('keeps same-name clusters separate until the user explicitly groups them', () => {
        const summaries = buildFaceClusterSummaries([
            createPhoto('photo-1', 'cluster-a', 'Konrad'),
            createPhoto('photo-2', 'cluster-b', 'Konrad'),
        ]);

        expect(summaries).toHaveLength(2);
        expect(summaries.map(summary => summary.clusterId).sort()).toEqual(['cluster-a', 'cluster-b']);
        expect(summaries.map(summary => summary.memberClusterIds)).toEqual([
            ['cluster-a'],
            ['cluster-b'],
        ]);
    });

    it('collapses explicit person groups into one managed person summary', () => {
        const summaries = buildFaceClusterSummaries([
            createPhoto('photo-1', 'cluster-a', 'Konrad', 'person-1'),
            createPhoto('photo-2', 'cluster-b', 'Konrad', 'person-1'),
        ]);

        expect(summaries).toHaveLength(1);
        expect(summaries[0]).toMatchObject({
            clusterId: 'person:person-1',
            personId: 'person-1',
            personName: 'Konrad',
            faceCount: 2,
            photoCount: 2,
        });
        expect(summaries[0].memberClusterIds.sort()).toEqual(['cluster-a', 'cluster-b']);
    });
});
