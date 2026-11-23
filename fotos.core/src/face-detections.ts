export const FACE_DETECTIONS_MIME = 'application/vnd.fotos.face-detections+json';
export const FOTOS_MAX_FACE_DETECTIONS_BYTES = 1024 * 1024;

export type FotosFaceDetection = {
    bbox: [number, number, number, number];
    score: number;
    name?: string;
};

export type FotosFaceDetections = {modelId: string; faces: FotosFaceDetection[]};

export function normalizeFotosFaceName(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const name = value.normalize('NFC').trim().replace(/\s+/g, ' ');
    if (!name || name.length > 160 || name.toLowerCase() === 'unknown') return undefined;
    return name;
}

/** Decode the original detection payload and its optional desktop labels. */
export function decodeFotosFaceDetections(bytes: ArrayBuffer, modelId: string): FotosFaceDetections {
    if (bytes.byteLength > FOTOS_MAX_FACE_DETECTIONS_BYTES) throw new Error('Face detections payload is too large.');
    const document = JSON.parse(new TextDecoder().decode(bytes)) as Partial<FotosFaceDetections> | null;
    if (document?.modelId !== modelId || !Array.isArray(document.faces)) {
        throw new Error(`Face detections are malformed (model ${document?.modelId}, label ${modelId}).`);
    }
    const faces = document.faces.map(face => {
        if (!Array.isArray(face?.bbox) || face.bbox.length !== 4 || !face.bbox.every(Number.isFinite)
            || !Number.isFinite(face.score) || face.score < 0 || face.score > 1) {
            throw new Error('Face detections contain an invalid box or score.');
        }
        const name = normalizeFotosFaceName(face.name);
        return {bbox: face.bbox, score: face.score, ...(name ? {name} : {})};
    });
    return {modelId, faces};
}
