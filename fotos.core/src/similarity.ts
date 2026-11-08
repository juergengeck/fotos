/**
 * Similarity primitives shared by every fotos runtime.
 *
 * Embeddings are L2-normalized when they are created, so cosine similarity is a
 * dot product. Comparisons check dimensions and normalization rejects a zero
 * vector: a missing embedding must never be compared as if it existed.
 *
 * This module has no imports, so it is safe to load in web workers.
 */

export const FACE_EMBEDDING_MODEL_ID = 'arcface-w600k-r50';
export const FACE_DETECTION_MODEL_ID = 'retinaface-det-10g';
export const SEMANTIC_EMBEDDING_MODEL_ID = 'clip-vit-base-patch32';

export const SIMILARITY_THRESHOLDS = {
    /** FaceClusterDimension joins the nearest cluster at or above this. */
    faceClusterAssignment: 0.55,
    /** A search face this close to a clustered face is treated as that same face. */
    faceIdentity: 0.99,
    /** Gallery filter: the photo contains a face like the search face. */
    faceSearchPhoto: 0.3,
    /** Similar-faces list in the sidebar. */
    faceSearchMatch: 0.35,
    /** CLIP text-to-image search. */
    semanticSearch: 0.18,
} as const;

export interface SimilarityCandidate<T> {
    item: T;
    embedding: ArrayLike<number>;
}

export interface SimilarityMatch<T> {
    item: T;
    similarity: number;
}

export interface FaceRow<T> {
    owner: T;
    faceIndex: number;
}

export function l2Normalize(values: ArrayLike<number>): number[] {
    let norm = 0;
    for (let index = 0; index < values.length; index++) {
        norm += values[index] * values[index];
    }
    if (norm === 0) {
        throw new Error('Cannot normalize a zero-length embedding');
    }

    const scale = Math.sqrt(norm);
    const normalized = new Array<number>(values.length);
    for (let index = 0; index < values.length; index++) {
        normalized[index] = values[index] / scale;
    }
    return normalized;
}

/** Cosine similarity of two L2-normalized embeddings (= dot product). */
export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
    if (a.length !== b.length) {
        throw new Error(`Cannot compare embeddings of different dimensions: ${a.length} vs ${b.length}`);
    }
    let dot = 0;
    for (let index = 0; index < a.length; index++) {
        dot += a[index] * b[index];
    }
    return dot;
}

/** Row `index` of a flat row-major embedding buffer, as a view (no copy). */
export function embeddingAt(flat: Float32Array, index: number, dimensions: number): Float32Array {
    const start = index * dimensions;
    const end = start + dimensions;
    if (index < 0 || end > flat.length) {
        throw new Error(`Embedding ${index} is outside a ${flat.length}-value buffer of ${dimensions}-dim embeddings`);
    }
    return flat.subarray(start, end);
}

/** One similarity candidate per face in a flat per-photo embedding buffer. */
export function faceEmbeddingRows<T>(
    owner: T,
    flat: Float32Array,
    count: number,
    dimensions: number,
): SimilarityCandidate<FaceRow<T>>[] {
    if (flat.length !== count * dimensions) {
        throw new Error(`Embedding buffer has ${count} faces but ${flat.length} values (expected ${count * dimensions})`);
    }
    const rows: SimilarityCandidate<FaceRow<T>>[] = [];
    for (let faceIndex = 0; faceIndex < count; faceIndex++) {
        rows.push({item: {owner, faceIndex}, embedding: embeddingAt(flat, faceIndex, dimensions)});
    }
    return rows;
}

/** Candidates scoring strictly above `threshold`, highest similarity first. */
export function rankBySimilarity<T>(
    query: ArrayLike<number>,
    candidates: Iterable<SimilarityCandidate<T>>,
    threshold: number,
): SimilarityMatch<T>[] {
    const matches: SimilarityMatch<T>[] = [];
    for (const candidate of candidates) {
        const similarity = cosineSimilarity(query, candidate.embedding);
        if (similarity > threshold) {
            matches.push({item: candidate.item, similarity});
        }
    }
    matches.sort((left, right) => right.similarity - left.similarity);
    return matches;
}
