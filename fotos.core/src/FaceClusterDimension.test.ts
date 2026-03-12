import {describe, it, expect} from 'vitest';
import {FaceClusterDimension} from './FaceClusterDimension.js';

const DIM = 512;

/** Create a unit vector with a 1 at position `seed % DIM` */
function makeEmbedding(seed: number): number[] {
    const emb = new Array<number>(DIM).fill(0);
    emb[seed % DIM] = 1;
    return emb;
}

/** Create an embedding similar to `base` with small random noise */
function makeSimilar(base: number[], noise = 0.05): number[] {
    const emb = base.map(v => v + (Math.random() - 0.5) * noise);
    let norm = 0;
    for (const v of emb) norm += v * v;
    norm = Math.sqrt(norm);
    return emb.map(v => v / norm);
}

describe('FaceClusterDimension', () => {
    it('creates a new cluster for a novel face', () => {
        const dim = new FaceClusterDimension();
        const emb = makeEmbedding(0);
        const clusterId = dim.assign(emb, 'photo1', 0);

        expect(dim.getClusterCount()).toBe(1);
        const cluster = dim.getCluster(clusterId);
        expect(cluster).toBeDefined();
        expect(cluster!.members).toHaveLength(1);
        expect(cluster!.members[0]).toEqual({photoHash: 'photo1', faceIndex: 0});
    });

    it('merges similar faces into the same cluster', () => {
        const dim = new FaceClusterDimension();
        const base = makeEmbedding(42);
        const similar = makeSimilar(base, 0.01);

        const id1 = dim.assign(base, 'photo1', 0);
        const id2 = dim.assign(similar, 'photo2', 0);

        expect(id1).toBe(id2);
        expect(dim.getClusterCount()).toBe(1);
        const cluster = dim.getCluster(id1);
        expect(cluster!.members).toHaveLength(2);
    });

    it('creates separate clusters for distinct faces', () => {
        const dim = new FaceClusterDimension();
        const emb1 = makeEmbedding(0);
        const emb2 = makeEmbedding(100);

        const id1 = dim.assign(emb1, 'photo1', 0);
        const id2 = dim.assign(emb2, 'photo2', 0);

        expect(id1).not.toBe(id2);
        expect(dim.getClusterCount()).toBe(2);
    });

    it('names a cluster', () => {
        const dim = new FaceClusterDimension();
        const emb = makeEmbedding(7);
        const clusterId = dim.assign(emb, 'photo1', 0);

        dim.nameCluster(clusterId, 'Alice');
        const cluster = dim.getCluster(clusterId);
        expect(cluster!.personName).toBe('Alice');
    });

    it('merges two clusters', () => {
        const dim = new FaceClusterDimension();
        const emb1 = makeEmbedding(0);
        const emb2 = makeEmbedding(200);

        const id1 = dim.assign(emb1, 'photo1', 0);
        const id2 = dim.assign(emb2, 'photo2', 0);
        expect(dim.getClusterCount()).toBe(2);

        dim.merge(id1, id2);
        expect(dim.getClusterCount()).toBe(1);

        const merged = dim.getCluster(id1);
        expect(merged!.members).toHaveLength(2);
        expect(merged!.members).toContainEqual({photoHash: 'photo1', faceIndex: 0});
        expect(merged!.members).toContainEqual({photoHash: 'photo2', faceIndex: 0});
    });

    it('serializes and deserializes', () => {
        const dim = new FaceClusterDimension(0.62);
        const emb1 = makeEmbedding(0);
        const emb2 = makeEmbedding(100);

        dim.assign(emb1, 'photo1', 0);
        dim.assign(emb2, 'photo2', 0);
        dim.nameCluster('photo1:0', 'Alice');
        dim.nameCluster('photo2:0', 'Bob');

        const json = dim.serialize();
        const restored = FaceClusterDimension.deserialize(json);

        expect(restored.getClusterCount()).toBe(2);
        expect(restored.getThreshold()).toBe(0.62);
        expect(restored.getCluster('photo1:0')!.personName).toBe('Alice');
        expect(restored.getCluster('photo2:0')!.personName).toBe('Bob');

        // findNearest works on the restored index
        const matches = restored.findNearest(emb1, 2);
        expect(matches).toHaveLength(2);
        expect(matches[0].clusterId).toBe('photo1:0');
    });

    it('allows overriding the serialized threshold', () => {
        const dim = new FaceClusterDimension(0.72);
        dim.assign(makeEmbedding(0), 'photo1', 0);

        const restored = FaceClusterDimension.deserialize(dim.serialize(), 0.41);

        expect(restored.getThreshold()).toBe(0.41);
    });

    it('findNearest returns sorted matches', () => {
        const dim = new FaceClusterDimension();
        const emb1 = makeEmbedding(0);
        const emb2 = makeEmbedding(1);
        const emb3 = makeEmbedding(200);

        dim.assign(emb1, 'photo1', 0);
        dim.assign(emb2, 'photo2', 0);
        dim.assign(emb3, 'photo3', 0);

        // Query with emb1 — should match cluster 1 best (exact), then 2 (adjacent), then 3 (far)
        const matches = dim.findNearest(emb1, 3);
        expect(matches).toHaveLength(3);
        // Results should be sorted by descending similarity
        expect(matches[0].similarity).toBeGreaterThanOrEqual(matches[1].similarity);
        expect(matches[1].similarity).toBeGreaterThanOrEqual(matches[2].similarity);
        // Exact match should be first
        expect(matches[0].clusterId).toBe('photo1:0');
    });
});
