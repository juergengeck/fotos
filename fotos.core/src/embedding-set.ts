/**
 * Self-describing binary container for a set of same-model embeddings.
 *
 * Used as the BLOB behind `analysis-output` FotosMediaVariants, so a receiver
 * can verify which model produced the vectors before comparing them.
 */

export const FOTOS_EMBEDDING_SET_MIME = 'application/vnd.fotos.embedding-set';

const MAGIC = [0x46, 0x45, 0x4d, 0x42]; // "FEMB"
const VERSION = 1;

export interface EmbeddingSet {
    modelId: string;
    dimensions: number;
    /** count × dimensions values, row-major */
    values: Float32Array;
}

export function embeddingSetCount(set: EmbeddingSet): number {
    return set.values.length / set.dimensions;
}

export function encodeEmbeddingSet(set: EmbeddingSet): Uint8Array {
    const modelId = new TextEncoder().encode(set.modelId);
    if (modelId.length === 0 || modelId.length > 255) {
        throw new Error(`Embedding set model id must be 1-255 bytes, got ${modelId.length}`);
    }
    if (!Number.isInteger(set.dimensions) || set.dimensions <= 0) {
        throw new Error(`Embedding set dimensions must be a positive integer, got ${set.dimensions}`);
    }
    if (set.values.length === 0) {
        throw new Error('Cannot encode an empty embedding set');
    }
    if (set.values.length % set.dimensions !== 0) {
        throw new Error(`Embedding set has ${set.values.length} values, not a whole number of ${set.dimensions}-dim rows`);
    }

    const count = set.values.length / set.dimensions;
    const headerLength = 4 + 1 + 1 + modelId.length + 4 + 4;
    const bytes = new Uint8Array(headerLength + set.values.length * 4);
    const view = new DataView(bytes.buffer);

    bytes.set(MAGIC, 0);
    view.setUint8(4, VERSION);
    view.setUint8(5, modelId.length);
    bytes.set(modelId, 6);
    let offset = 6 + modelId.length;
    view.setUint32(offset, set.dimensions, true);
    view.setUint32(offset + 4, count, true);
    offset += 8;
    for (let index = 0; index < set.values.length; index++) {
        view.setFloat32(offset + index * 4, set.values[index], true);
    }
    return bytes;
}

export function decodeEmbeddingSet(input: ArrayBuffer | Uint8Array): EmbeddingSet {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    if (bytes.byteLength < 6 || MAGIC.some((value, index) => bytes[index] !== value)) {
        throw new Error('Payload is not an embedding set');
    }
    const version = view.getUint8(4);
    if (version !== VERSION) {
        throw new Error(`Unsupported embedding set version ${version}`);
    }
    const modelIdLength = view.getUint8(5);
    const headerLength = 6 + modelIdLength + 8;
    if (bytes.byteLength < headerLength) {
        throw new Error(`Embedding set header truncated: length ${bytes.byteLength}`);
    }
    const modelId = new TextDecoder().decode(bytes.subarray(6, 6 + modelIdLength));
    const dimensions = view.getUint32(6 + modelIdLength, true);
    const count = view.getUint32(6 + modelIdLength + 4, true);
    const expectedLength = headerLength + dimensions * count * 4;
    if (bytes.byteLength !== expectedLength) {
        throw new Error(`Embedding set length ${bytes.byteLength} does not match header (expected ${expectedLength})`);
    }

    const values = new Float32Array(dimensions * count);
    for (let index = 0; index < values.length; index++) {
        values[index] = view.getFloat32(headerLength + index * 4, true);
    }
    return {modelId, dimensions, values};
}
