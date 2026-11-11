import {describe, expect, it} from 'vitest';
import {
    cosineSimilarity,
    embeddingAt,
    faceEmbeddingRows,
    l2Normalize,
    rankBySimilarity,
    SIMILARITY_THRESHOLDS,
} from './similarity.js';

describe('l2Normalize', () => {
    it('scales a vector to unit length', () => {
        expect(l2Normalize([3, 4])).toEqual([0.6, 0.8]);
    });

    it('rejects a zero vector instead of producing NaN', () => {
        expect(() => l2Normalize(new Float32Array(3))).toThrow('zero-length embedding');
    });
});

describe('cosineSimilarity', () => {
    it('is the dot product of normalized vectors', () => {
        expect(cosineSimilarity([1, 0], [0.6, 0.8])).toBeCloseTo(0.6);
    });

    it('rejects vectors of different dimensions', () => {
        expect(() => cosineSimilarity([1, 0], [1, 0, 0])).toThrow('different dimensions: 2 vs 3');
    });
});

describe('embeddingAt', () => {
    const flat = new Float32Array([1, 2, 3, 4, 5, 6]);

    it('returns the row without copying', () => {
        const row = embeddingAt(flat, 1, 3);
        expect(Array.from(row)).toEqual([4, 5, 6]);
        expect(row.buffer).toBe(flat.buffer);
    });

    it('rejects a row outside the buffer', () => {
        expect(() => embeddingAt(flat, 2, 3)).toThrow('outside');
        expect(() => embeddingAt(flat, -1, 3)).toThrow('outside');
    });
});

describe('faceEmbeddingRows', () => {
    it('yields one candidate per face, tagged with owner and index', () => {
        const rows = faceEmbeddingRows('photo-a', new Float32Array([1, 0, 0, 1]), 2, 2);
        expect(rows.map(row => row.item)).toEqual([
            {owner: 'photo-a', faceIndex: 0},
            {owner: 'photo-a', faceIndex: 1},
        ]);
        expect(Array.from(rows[1].embedding)).toEqual([0, 1]);
    });

    it('rejects a buffer whose length does not match the face count', () => {
        expect(() => faceEmbeddingRows('photo-a', new Float32Array(3), 2, 2)).toThrow('2 faces but 3 values');
    });
});

describe('rankBySimilarity', () => {
    it('keeps candidates strictly above the threshold, best first', () => {
        const ranked = rankBySimilarity([1, 0], [
            {item: 'low', embedding: [0.2, 0.98]},
            {item: 'high', embedding: [0.9, 0.44]},
            {item: 'edge', embedding: [0.5, 0.87]},
            {item: 'mid', embedding: [0.7, 0.71]},
        ], 0.5);
        expect(ranked.map(match => match.item)).toEqual(['high', 'mid']);
        expect(ranked[0].similarity).toBeCloseTo(0.9);
    });
});

describe('SIMILARITY_THRESHOLDS', () => {
    it('keeps the values that were inline before this refactor', () => {
        expect(SIMILARITY_THRESHOLDS).toEqual({
            faceClusterAssignment: 0.55,
            faceIdentity: 0.99,
            faceSearchPhoto: 0.3,
            faceSearchMatch: 0.35,
            semanticSearch: 0.18,
        });
    });
});
