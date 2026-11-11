import {describe, expect, it} from 'vitest';
import {decodeEmbeddingSet, embeddingSetCount, encodeEmbeddingSet} from './embedding-set.js';

const sample = {
    modelId: 'clip-vit-base-patch32',
    dimensions: 3,
    values: new Float32Array([0.1, 0.2, 0.3, -1, 0, 1]),
};

describe('embedding set codec', () => {
    it('round-trips model id, dimensions and values', () => {
        const decoded = decodeEmbeddingSet(encodeEmbeddingSet(sample));
        expect(decoded.modelId).toBe(sample.modelId);
        expect(decoded.dimensions).toBe(3);
        expect(Array.from(decoded.values)).toEqual(Array.from(sample.values));
        expect(embeddingSetCount(decoded)).toBe(2);
    });

    it('decodes from an ArrayBuffer and from an offset Uint8Array view', () => {
        const encoded = encodeEmbeddingSet(sample);
        const padded = new Uint8Array(encoded.byteLength + 3);
        padded.set(encoded, 3);
        expect(decodeEmbeddingSet(encoded.slice().buffer).modelId).toBe(sample.modelId);
        expect(decodeEmbeddingSet(padded.subarray(3)).modelId).toBe(sample.modelId);
    });

    it('is deterministic', () => {
        expect(encodeEmbeddingSet(sample)).toEqual(encodeEmbeddingSet(sample));
    });

    it('rejects values that are not a whole number of rows', () => {
        expect(() => encodeEmbeddingSet({...sample, values: new Float32Array(4)})).toThrow('whole number of 3-dim rows');
    });

    it('rejects an empty set and an empty model id', () => {
        expect(() => encodeEmbeddingSet({...sample, values: new Float32Array(0)})).toThrow('empty');
        expect(() => encodeEmbeddingSet({...sample, modelId: ''})).toThrow('model id');
    });

    it('rejects bad magic, unknown version and truncated payloads', () => {
        const encoded = encodeEmbeddingSet(sample);
        const badMagic = encoded.slice(); badMagic[0] = 0;
        const badVersion = encoded.slice(); badVersion[4] = 2;
        expect(() => decodeEmbeddingSet(badMagic)).toThrow('not an embedding set');
        expect(() => decodeEmbeddingSet(badVersion)).toThrow('version 2');
        expect(() => decodeEmbeddingSet(encoded.subarray(0, encoded.byteLength - 1))).toThrow('length');
    });
});
