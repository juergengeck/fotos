import {beforeEach, describe, expect, it, vi} from 'vitest';

const {blobs, objects, storeVersionedObjectMock, storeArrayBufferAsBlobMock, readBlobAsArrayBufferMock, getObjectWithTypeMock} = vi.hoisted(() => {
    const blobs = new Map<string, ArrayBuffer>();
    const objects = new Map<string, Record<string, unknown>>();
    return {
        blobs,
        objects,
        storeVersionedObjectMock: vi.fn(async (obj: Record<string, unknown>) => {
            const hash = `variant:${String(obj.contentHash)}`;
            objects.set(hash, obj);
            return {hash, idHash: `variant-id:${String(obj.contentHash)}`};
        }),
        storeArrayBufferAsBlobMock: vi.fn(async (buffer: ArrayBuffer) => {
            const hash = `blob:${blobs.size}`;
            blobs.set(hash, buffer);
            return {hash};
        }),
        readBlobAsArrayBufferMock: vi.fn(async (hash: string) => {
            const buffer = blobs.get(hash);
            if (!buffer) throw new Error(`blob ${hash} not found`);
            return buffer;
        }),
        getObjectWithTypeMock: vi.fn(async (hash: string) => {
            const obj = objects.get(hash);
            if (!obj) {
                const error = new Error('not found');
                error.name = 'FileNotFoundError';
                throw error;
            }
            return obj;
        }),
    };
});

vi.mock('@refinio/one.core/lib/storage-versioned-objects.js', () => ({storeVersionedObject: storeVersionedObjectMock}));
vi.mock('@refinio/one.core/lib/storage-blob.js', () => ({
    storeArrayBufferAsBlob: storeArrayBufferAsBlobMock,
    readBlobAsArrayBuffer: readBlobAsArrayBufferMock,
}));
vi.mock('@refinio/one.core/lib/storage-unversioned-objects.js', () => ({getObjectWithType: getObjectWithTypeMock}));

import {EMBEDDING_DIM, FACE_DETECTION_MODEL_ID, FACE_EMBEDDING_MODEL_ID, SEMANTIC_EMBEDDING_MODEL_ID} from '@refinio/fotos.core';
import type {PhotoEntry} from '@/types/fotos';
import {buildAnalysisPayloads, extractRemoteAnalysis, hasCurrentAnalysisVariants, storeAnalysisVariants} from './analysis-variants';

const FAMILY = 'entry-id-hash' as any;
const ORIGINAL = 'original-variant-id-hash' as any;

function unit(dimensions: number, hot: number): Float32Array {
    const v = new Float32Array(dimensions);
    v[hot] = 1;
    return v;
}

function analysedPhoto(): PhotoEntry {
    const embeddings = new Float32Array(2 * EMBEDDING_DIM);
    embeddings.set(unit(EMBEDDING_DIM, 0), 0);
    embeddings.set(unit(EMBEDDING_DIM, 1), EMBEDDING_DIM);
    return {
        hash: 'photo-hash',
        name: 'photo.jpg',
        managed: 'metadata',
        tags: [],
        addedAt: '2026-11-08T00:00:00.000Z',
        size: 10,
        faces: {count: 2, bboxes: [[1, 2, 3, 4], [5, 6, 7, 8]], scores: [0.9, 0.8], embeddings, crops: []},
        semantic: {modelId: SEMANTIC_EMBEDDING_MODEL_ID, embedding: unit(4, 2)},
    };
}

beforeEach(() => {
    blobs.clear();
    objects.clear();
    vi.clearAllMocks();
});

describe('buildAnalysisPayloads', () => {
    it('produces face embeddings, face detections and semantic payloads with deterministic digests', async () => {
        const first = await buildAnalysisPayloads(analysedPhoto());
        const second = await buildAnalysisPayloads(analysedPhoto());
        expect(first.map(p => p.modelId)).toEqual([FACE_EMBEDDING_MODEL_ID, FACE_DETECTION_MODEL_ID, SEMANTIC_EMBEDDING_MODEL_ID]);
        expect(first.map(p => p.digest)).toEqual(second.map(p => p.digest));
        expect(first[0].digest).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces nothing for an unanalysed photo', async () => {
        const {faces: _faces, semantic: _semantic, ...photo} = analysedPhoto();
        expect(await buildAnalysisPayloads(photo)).toEqual([]);
    });

    it('rejects face data whose embeddings, boxes or scores disagree with the face count', async () => {
        const photo = analysedPhoto();
        await expect(buildAnalysisPayloads({...photo, faces: {...photo.faces!, count: 3}})).rejects.toThrow('photo.jpg');
        await expect(buildAnalysisPayloads({...photo, faces: {...photo.faces!, scores: [0.9]}})).rejects.toThrow('photo.jpg');
    });
});

describe('storeAnalysisVariants', () => {
    it('stores analysis-output variants derived from the original, labelled with the model id', async () => {
        const stored = await storeAnalysisVariants(analysedPhoto(), FAMILY, ORIGINAL);
        const variants = storeVersionedObjectMock.mock.calls.map(([obj]) => obj);
        const payloads = await buildAnalysisPayloads(analysedPhoto());

        expect(stored).toHaveLength(3);
        expect(variants).toEqual(payloads.map(payload => expect.objectContaining({
            $type$: 'FotosMediaVariant',
            contentHash: payload.digest,
            family: FAMILY,
            role: 'analysis-output',
            mime: payload.mime,
            byteSize: payload.bytes.byteLength,
            derivedFrom: ORIGINAL,
            label: payload.modelId,
        })));
        expect(variants.every(variant => !('createdAt' in variant))).toBe(true);
    });
});

describe('hasCurrentAnalysisVariants', () => {
    it('is true when the entry carries the current payloads and false after re-analysis', async () => {
        const stored = await storeAnalysisVariants(analysedPhoto(), FAMILY, ORIGINAL);
        const entry = {$type$: 'FotosEntry', contentHash: 'photo-hash', faceCount: 2, variants: new Set(stored.map(s => s.hash))} as any;

        expect(await hasCurrentAnalysisVariants(entry, FAMILY, analysedPhoto())).toBe(true);

        const reanalysed = {...analysedPhoto(), semantic: {modelId: SEMANTIC_EMBEDDING_MODEL_ID, embedding: unit(4, 3)}};
        expect(await hasCurrentAnalysisVariants(entry, FAMILY, reanalysed)).toBe(false);
    });
});

describe('extractRemoteAnalysis', () => {
    async function publishedEntry(photo = analysedPhoto()) {
        const stored = await storeAnalysisVariants(photo, FAMILY, ORIGINAL);
        return {$type$: 'FotosEntry', contentHash: 'photo-hash', faceCount: 2, variants: new Set(stored.map(s => s.hash))} as any;
    }

    it('round-trips faces and semantic embedding from published variants', async () => {
        const analysis = await extractRemoteAnalysis(await publishedEntry(), FAMILY);
        const photo = analysedPhoto();

        expect(analysis.faces?.count).toBe(2);
        expect(analysis.faces?.bboxes).toEqual([[1, 2, 3, 4], [5, 6, 7, 8]]);
        expect(analysis.faces?.scores).toEqual([0.9, 0.8]);
        expect(Array.from(analysis.faces!.embeddings)).toEqual(Array.from(photo.faces!.embeddings!));
        expect(analysis.faces?.dataAttrs['face-count']).toBe('2');
        expect(analysis.semantic?.modelId).toBe(SEMANTIC_EMBEDDING_MODEL_ID);
        expect(Array.from(analysis.semantic!.embedding)).toEqual([0, 0, 1, 0]);
    });

    it('leaves faces pending while one of the two face variants has not arrived', async () => {
        const entry = await publishedEntry();
        const detectionsHash = [...entry.variants].find((hash: string) => objects.get(hash)?.label === FACE_DETECTION_MODEL_ID);
        objects.delete(detectionsHash);

        const analysis = await extractRemoteAnalysis(entry, FAMILY);
        expect(analysis.faces).toBeUndefined();
        expect(analysis.semantic).toBeDefined();
    });

    it('throws when a payload was produced by a different model than its label claims', async () => {
        const entry = await publishedEntry();
        const semanticHash = [...entry.variants].find((hash: string) => objects.get(hash)?.label === SEMANTIC_EMBEDDING_MODEL_ID);
        objects.set(semanticHash, {...objects.get(semanticHash)!, label: 'other-model'});

        await expect(extractRemoteAnalysis(entry, FAMILY)).rejects.toThrow('other-model');
    });

    it('throws when the face embedding count disagrees with the entry face count', async () => {
        const entry = {...await publishedEntry(), faceCount: 3};
        await expect(extractRemoteAnalysis(entry, FAMILY)).rejects.toThrow('faceCount 3');
    });

    it('propagates blob read failures instead of substituting zeros', async () => {
        const entry = await publishedEntry();
        blobs.clear();
        await expect(extractRemoteAnalysis(entry, FAMILY)).rejects.toThrow('not found');
    });
});
