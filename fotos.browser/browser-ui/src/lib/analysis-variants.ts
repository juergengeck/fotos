/**
 * Per-photo analysis (face detections, face embeddings, CLIP embedding) as
 * `analysis-output` FotosMediaVariants derived from the original variant.
 *
 * Variant contentHash = SHA-256 of the payload bytes, and the variant has no
 * timestamp, so the same analysis always yields the same variant.
 */
import {readBlobAsArrayBuffer, storeArrayBufferAsBlob} from '@refinio/one.core/lib/storage-blob.js';
import {storeVersionedObject} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {getObjectWithType} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import {
    createFotosMediaVariant,
    decodeEmbeddingSet,
    EMBEDDING_DIM,
    encodeEmbeddingSet,
    FACE_DETECTION_MODEL_ID,
    FACE_EMBEDDING_MODEL_ID,
    facesToDataAttrs,
    FOTOS_EMBEDDING_SET_MIME,
} from '@refinio/fotos.core';
import type {EmbeddingSet, FotosEntry, FotosMediaVariant} from '@refinio/fotos.core';
import type {PhotoEntry, SemanticInfo} from '@/types/fotos';
import {isMissingVersionedObject} from './one-storage-errors.js';

export const FACE_DETECTIONS_MIME = 'application/vnd.fotos.face-detections+json';

export interface AnalysisPayload {
    modelId: string;
    mime: string;
    bytes: Uint8Array;
    digest: string;
}

export interface StoredVariantRef {
    hash: SHA256Hash<FotosMediaVariant>;
    idHash: SHA256IdHash<FotosMediaVariant>;
}

interface FaceDetectionsDocument {
    modelId: string;
    faces: Array<{bbox: [number, number, number, number]; score: number}>;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function payload(modelId: string, mime: string, bytes: Uint8Array): Promise<AnalysisPayload> {
    return {modelId, mime, bytes, digest: await sha256Hex(bytes)};
}

function embeddingPayload(set: EmbeddingSet): Promise<AnalysisPayload> {
    return payload(set.modelId, FOTOS_EMBEDDING_SET_MIME, encodeEmbeddingSet(set));
}

export async function buildAnalysisPayloads(photo: PhotoEntry): Promise<AnalysisPayload[]> {
    const payloads: AnalysisPayload[] = [];
    const faces = photo.faces;

    if (faces?.embeddings && faces.count > 0) {
        if (faces.embeddings.length !== faces.count * EMBEDDING_DIM
            || faces.bboxes.length !== faces.count
            || faces.scores.length !== faces.count) {
            throw new Error(
                `${photo.name}: face analysis is inconsistent (count ${faces.count}, `
                + `${faces.embeddings.length / EMBEDDING_DIM} embeddings, ${faces.bboxes.length} boxes, ${faces.scores.length} scores)`,
            );
        }
        payloads.push(await embeddingPayload({modelId: FACE_EMBEDDING_MODEL_ID, dimensions: EMBEDDING_DIM, values: faces.embeddings}));

        const detections: FaceDetectionsDocument = {
            modelId: FACE_DETECTION_MODEL_ID,
            faces: faces.bboxes.map((bbox, index) => ({bbox, score: faces.scores[index]})),
        };
        payloads.push(await payload(FACE_DETECTION_MODEL_ID, FACE_DETECTIONS_MIME, new TextEncoder().encode(JSON.stringify(detections))));
    }

    if (photo.semantic) {
        payloads.push(await embeddingPayload({
            modelId: photo.semantic.modelId,
            dimensions: photo.semantic.embedding.length,
            values: photo.semantic.embedding,
        }));
    }

    return payloads;
}

export async function storeAnalysisVariants(
    photo: PhotoEntry,
    family: SHA256IdHash<FotosEntry>,
    original: SHA256IdHash<FotosMediaVariant>,
): Promise<StoredVariantRef[]> {
    const stored: StoredVariantRef[] = [];
    for (const analysis of await buildAnalysisPayloads(photo)) {
        const blob = await storeArrayBufferAsBlob(analysis.bytes.slice().buffer);
        const variant = createFotosMediaVariant({
            contentHash: analysis.digest,
            family,
            role: 'analysis-output',
            mime: analysis.mime,
            byteSize: analysis.bytes.byteLength,
            blob: blob.hash,
            derivedFrom: original,
            label: analysis.modelId,
        });
        const result = await storeVersionedObject(variant as any);
        stored.push({
            hash: result.hash as SHA256Hash<FotosMediaVariant>,
            idHash: result.idHash as SHA256IdHash<FotosMediaVariant>,
        });
    }
    return stored;
}

/** Variants of an entry that have reached this instance; not-yet-arrived ones are skipped. */
export async function loadEntryVariants(entry: FotosEntry): Promise<FotosMediaVariant[]> {
    const variants: FotosMediaVariant[] = [];
    for (const hash of entry.variants ?? []) {
        try {
            variants.push(await getObjectWithType(hash, 'FotosMediaVariant') as FotosMediaVariant);
        } catch (error) {
            if (!isMissingVersionedObject(error)) throw error;
        }
    }
    return variants;
}

export async function hasCurrentAnalysisVariants(
    entry: FotosEntry,
    family: SHA256IdHash<FotosEntry>,
    photo: PhotoEntry,
): Promise<boolean> {
    const expected = (await buildAnalysisPayloads(photo)).map(analysis => analysis.digest);
    if (expected.length === 0) return true;

    const present = new Set(
        (await loadEntryVariants(entry))
            .filter(variant => variant.role === 'analysis-output' && String(variant.family) === String(family))
            .map(variant => variant.contentHash),
    );
    return expected.every(digest => present.has(digest));
}

export interface RemoteFaceAnalysis {
    count: number;
    bboxes: Array<[number, number, number, number]>;
    scores: number[];
    embeddings: Float32Array;
    /** Attributes for one/index.html, built from real detections only. */
    dataAttrs: Record<string, string>;
}

export interface RemoteAnalysis {
    faces?: RemoteFaceAnalysis;
    semantic?: SemanticInfo;
}

function requireSingle<T>(current: T | undefined, next: T, what: string, entry: FotosEntry): T {
    if (current !== undefined) {
        throw new Error(`FotosEntry ${entry.contentHash} carries more than one ${what} variant`);
    }
    return next;
}

export async function extractRemoteAnalysis(
    entry: FotosEntry,
    family: SHA256IdHash<FotosEntry>,
): Promise<RemoteAnalysis> {
    let faceEmbeddings: Float32Array | undefined;
    let detections: FaceDetectionsDocument | undefined;
    let semantic: SemanticInfo | undefined;

    for (const variant of await loadEntryVariants(entry)) {
        if (variant.role !== 'analysis-output' || String(variant.family) !== String(family)) continue;
        if (!variant.blob || !variant.label) {
            throw new Error(`Analysis variant ${variant.contentHash} has no blob or label`);
        }
        const bytes = await readBlobAsArrayBuffer(variant.blob);

        if (variant.mime === FACE_DETECTIONS_MIME) {
            const document = JSON.parse(new TextDecoder().decode(bytes)) as FaceDetectionsDocument;
            if (document.modelId !== variant.label || !Array.isArray(document.faces)) {
                throw new Error(`Face detections variant ${variant.contentHash} is malformed (model ${document.modelId}, label ${variant.label})`);
            }
            detections = requireSingle(detections, document, 'face detections', entry);
            continue;
        }

        if (variant.mime !== FOTOS_EMBEDDING_SET_MIME) {
            throw new Error(`Analysis variant ${variant.contentHash} has unknown mime ${variant.mime}`);
        }
        const set = decodeEmbeddingSet(bytes);
        if (set.modelId !== variant.label) {
            throw new Error(`Analysis variant ${variant.contentHash} is labelled ${variant.label} but contains ${set.modelId}`);
        }
        if (set.modelId === FACE_EMBEDDING_MODEL_ID) {
            if (set.dimensions !== EMBEDDING_DIM) {
                throw new Error(`Face embeddings for ${entry.contentHash} have ${set.dimensions} dimensions, expected ${EMBEDDING_DIM}`);
            }
            faceEmbeddings = requireSingle(faceEmbeddings, set.values, 'face embedding', entry);
        } else {
            semantic = requireSingle(semantic, {modelId: set.modelId, embedding: set.values}, 'semantic embedding', entry);
        }
    }

    const analysis: RemoteAnalysis = semantic ? {semantic} : {};
    if (!faceEmbeddings || !detections) {
        return analysis;
    }

    const count = faceEmbeddings.length / EMBEDDING_DIM;
    if (count !== entry.faceCount || detections.faces.length !== count) {
        throw new Error(
            `Face analysis for ${entry.contentHash} disagrees: faceCount ${entry.faceCount}, `
            + `${count} embeddings, ${detections.faces.length} detections`,
        );
    }

    const embeddings = faceEmbeddings;
    analysis.faces = {
        count,
        bboxes: detections.faces.map(face => face.bbox),
        scores: detections.faces.map(face => face.score),
        embeddings,
        dataAttrs: facesToDataAttrs({
            faces: detections.faces.map((face, index) => ({
                detection: {bbox: face.bbox, score: face.score, landmarks: []},
                embedding: Array.from(embeddings.subarray(index * EMBEDDING_DIM, (index + 1) * EMBEDDING_DIM)),
            })),
        }),
    };
    return analysis;
}
