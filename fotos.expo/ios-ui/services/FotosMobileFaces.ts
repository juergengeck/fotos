import {
    decodeFotosFaceDetections, FACE_DETECTION_MODEL_ID, FACE_DETECTIONS_MIME, FOTOS_MAX_FACE_DETECTIONS_BYTES,
    type FotosEntry, type FotosFaceDetections,
} from '@refinio/fotos.core';
import {readBlobAsArrayBuffer} from '@refinio/one.core/lib/storage-blob.js';
import {getObjectWithType} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {calculateIdHashOfObj} from '@refinio/one.core/lib/util/object.js';

/** The caller supplies an exact entry from its admitted owner or verified share snapshot. */
export async function readFotosMobileFaceDetections(entry: FotosEntry): Promise<FotosFaceDetections | undefined> {
    if (!entry.faceCount || !entry.variants?.size) return;
    const family = await calculateIdHashOfObj({$type$: 'FotosEntry', contentHash: entry.contentHash});
    for (const hash of entry.variants) {
        try {
            const variant = await getObjectWithType(hash, 'FotosMediaVariant');
            if (variant.family !== family || variant.role !== 'analysis-output'
                || variant.label !== FACE_DETECTION_MODEL_ID || variant.mime !== FACE_DETECTIONS_MIME || !variant.blob) continue;
            if (variant.byteSize !== undefined && variant.byteSize > FOTOS_MAX_FACE_DETECTIONS_BYTES) {
                throw new Error('Face detections payload is too large.');
            }
            const detections = decodeFotosFaceDetections(await readBlobAsArrayBuffer(variant.blob), FACE_DETECTION_MODEL_ID);
            if (detections.faces.length !== entry.faceCount) throw new Error('Face detections disagree with the photo face count.');
            return detections;
        } catch (error) {
            if (!(error instanceof Error) || error.name !== 'FileNotFoundError') throw error;
        }
    }
}

export function getFotosFaceNames(detections: FotosFaceDetections | undefined): string[] {
    return [...new Set(detections?.faces.flatMap(face => face.name ? [face.name] : []) ?? [])];
}
