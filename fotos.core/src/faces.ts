/**
 * Face detection and recognition — platform-agnostic logic.
 *
 * Models: InsightFace buffalo_l (ONNX)
 * - det_10g.onnx (RetinaFace) — face detection + 5-point landmarks
 * - w600k_r50.onnx (ArcFace) — 512-dim face recognition embeddings
 *
 * All image I/O and ONNX inference is delegated to FacePlatform.
 */

import type {
    BBox, FaceDetection, FaceResult, FaceAnalysisResult,
    FacePlatform, OnnxSession,
} from './types.js';

export const DET_INPUT_SIZE = 640;
export const REC_INPUT_SIZE = 112;
export const EMBEDDING_DIM = 512;

let platform: FacePlatform | null = null;
let detSession: OnnxSession | null = null;
let recSession: OnnxSession | null = null;

export function setPlatform(p: FacePlatform): void {
    platform = p;
}

function getPlatform(): FacePlatform {
    if (!platform) throw new Error('fotos.core: call setPlatform() before using face analysis');
    return platform;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function initFaceDetectionModel(
    modelDir: string,
    joinPath: (a: string, b: string) => string
): Promise<void> {
    if (detSession) return;

    const p = getPlatform();
    const detPath = joinPath(modelDir, 'det_10g.onnx');
    detSession = await p.onnx.createSession(detPath);
}

export async function initFaceRecognitionModel(
    modelDir: string,
    joinPath: (a: string, b: string) => string
): Promise<void> {
    if (recSession) return;

    const p = getPlatform();
    const recPath = joinPath(modelDir, 'w600k_r50.onnx');
    recSession = await p.onnx.createSession(recPath);
}

export async function initFaceModels(modelDir: string, joinPath: (a: string, b: string) => string): Promise<void> {
    await initFaceDetectionModel(modelDir, joinPath);
    await initFaceRecognitionModel(modelDir, joinPath);
}

export async function disposeFaceModels(): Promise<void> {
    if (detSession) { await detSession.release(); detSession = null; }
    if (recSession) { await recSession.release(); recSession = null; }
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Preprocess image for RetinaFace: resize to 640×640, HWC→CHW, normalize.
 * InsightFace normalization: (pixel - 127.5) / 128.0
 */
export function hwcToCHW_det(hwcPixels: Uint8Array, pixelCount: number): Float32Array {
    const float32 = new Float32Array(3 * pixelCount);
    for (let i = 0; i < pixelCount; i++) {
        float32[i]                  = (hwcPixels[i * 3]     - 127.5) / 128.0;
        float32[pixelCount + i]     = (hwcPixels[i * 3 + 1] - 127.5) / 128.0;
        float32[2 * pixelCount + i] = (hwcPixels[i * 3 + 2] - 127.5) / 128.0;
    }
    return float32;
}

/**
 * Preprocess cropped face for ArcFace: 112×112, HWC→CHW, normalize.
 * ArcFace normalization: (pixel - 127.5) / 127.5
 */
export function hwcToCHW_rec(hwcPixels: Uint8Array, pixelCount: number): Float32Array {
    const float32 = new Float32Array(3 * pixelCount);
    for (let i = 0; i < pixelCount; i++) {
        float32[i]                  = (hwcPixels[i * 3]     - 127.5) / 127.5;
        float32[pixelCount + i]     = (hwcPixels[i * 3 + 1] - 127.5) / 127.5;
        float32[2 * pixelCount + i] = (hwcPixels[i * 3 + 2] - 127.5) / 127.5;
    }
    return float32;
}

export async function detectFaces(imagePath: string, scoreThreshold = 0.6): Promise<FaceDetection[]> {
    if (!detSession) throw new Error('Face detection model not initialized');
    const p = getPlatform();

    const {data: hwcPixels, origWidth, origHeight} = await p.images.decodeAndResize(
        imagePath, DET_INPUT_SIZE, DET_INPUT_SIZE
    );
    const scaleX = origWidth / DET_INPUT_SIZE;
    const scaleY = origHeight / DET_INPUT_SIZE;

    const pixelCount = DET_INPUT_SIZE * DET_INPUT_SIZE;
    const chwData = hwcToCHW_det(hwcPixels, pixelCount);
    const tensor = p.onnx.createTensor('float32', chwData, [1, 3, DET_INPUT_SIZE, DET_INPUT_SIZE]);

    const inputName = detSession.inputNames[0];
    const results = await detSession.run({[inputName]: tensor});

    const faces: FaceDetection[] = [];
    const outputNames = detSession.outputNames;

    // SCRFD det_10g: 9 outputs grouped by type across 3 FPN levels (strides 8, 16, 32).
    //   outputs[0..2] = scores per FPN level
    //   outputs[3..5] = bbox distance offsets per FPN level
    //   outputs[6..8] = landmark offsets per FPN level
    // Bbox/landmark values are distance offsets from anchor centers, NOT pixel coords.
    const fmc = Math.floor(outputNames.length / 3);
    const strides = [8, 16, 32];
    const numAnchorsPerPos = 2;

    for (let level = 0; level < fmc; level++) {
        const scores = results[outputNames[level]];
        const bboxes = results[outputNames[level + fmc]];
        const kps = results[outputNames[level + fmc * 2]];
        if (!scores || !bboxes || !kps) continue;

        const stride = strides[level];
        const gridW = DET_INPUT_SIZE / stride;
        const scoreData = scores.data as Float32Array;
        const bboxData = bboxes.data as Float32Array;
        const kpsData = kps.data as Float32Array;
        const numAnchors = scoreData.length;

        for (let i = 0; i < numAnchors; i++) {
            const score = scoreData[i];
            if (score < scoreThreshold) continue;

            // Anchor center: each grid position has numAnchorsPerPos anchors
            const posIdx = Math.floor(i / numAnchorsPerPos);
            const anchorX = (posIdx % gridW) * stride;
            const anchorY = Math.floor(posIdx / gridW) * stride;

            // Decode bbox: distance from anchor, scaled by stride
            const x1 = (anchorX - bboxData[i * 4] * stride) * scaleX;
            const y1 = (anchorY - bboxData[i * 4 + 1] * stride) * scaleY;
            const x2 = (anchorX + bboxData[i * 4 + 2] * stride) * scaleX;
            const y2 = (anchorY + bboxData[i * 4 + 3] * stride) * scaleY;

            // Decode landmarks: offset from anchor, scaled by stride
            const landmarks: Array<[number, number]> = [];
            for (let j = 0; j < 5; j++) {
                landmarks.push([
                    (anchorX + kpsData[i * 10 + j * 2] * stride) * scaleX,
                    (anchorY + kpsData[i * 10 + j * 2 + 1] * stride) * scaleY,
                ]);
            }

            faces.push({bbox: [x1, y1, x2, y2], score, landmarks});
        }
    }

    return nms(faces, 0.4);
}

// ---------------------------------------------------------------------------
// Recognition
// ---------------------------------------------------------------------------

export async function computeEmbedding(imagePath: string, face: FaceDetection): Promise<number[]> {
    if (!recSession) throw new Error('Face recognition model not initialized');
    const p = getPlatform();

    const [x1, y1, x2, y2] = face.bbox;
    const w = x2 - x1;
    const h = y2 - y1;
    const margin = Math.max(w, h) * 0.3;

    const cropX = Math.max(0, Math.round(x1 - margin));
    const cropY = Math.max(0, Math.round(y1 - margin));
    const cropW = Math.round(w + margin * 2);
    const cropH = Math.round(h + margin * 2);

    const hwcPixels = await p.images.cropAndResize(
        imagePath, cropX, cropY, cropW, cropH, REC_INPUT_SIZE, REC_INPUT_SIZE
    );

    const pixelCount = REC_INPUT_SIZE * REC_INPUT_SIZE;
    const chwData = hwcToCHW_rec(hwcPixels, pixelCount);
    const tensor = p.onnx.createTensor('float32', chwData, [1, 3, REC_INPUT_SIZE, REC_INPUT_SIZE]);

    const inputName = recSession.inputNames[0];
    const output = await recSession.run({[inputName]: tensor});
    const embedding = output[recSession.outputNames[0]].data as Float32Array;

    return l2Normalize(embedding);
}

// ---------------------------------------------------------------------------
// Full pipeline
// ---------------------------------------------------------------------------

export async function analyzeImage(
    imagePath: string,
    facesDir: string,
    imageId: string
): Promise<FaceAnalysisResult> {
    const p = getPlatform();
    const detections = await detectFaces(imagePath);

    const faces: FaceResult[] = [];
    for (let i = 0; i < detections.length; i++) {
        const det = detections[i];
        const embedding = await computeEmbedding(imagePath, det);

        const cropName = `${imageId.slice(0, 8)}_${i}.jpg`;
        const cropPath = `${facesDir}/${cropName}`;
        const [bx1, by1, bx2, by2] = det.bbox;
        const margin = Math.max(bx2 - bx1, by2 - by1) * 0.15;
        await p.images.saveFaceCrop(
            imagePath,
            Math.max(0, Math.round(bx1 - margin)),
            Math.max(0, Math.round(by1 - margin)),
            Math.round((bx2 - bx1) + margin * 2),
            Math.round((by2 - by1) + margin * 2),
            cropPath,
            112
        );

        faces.push({
            detection: det,
            embedding,
            cropPath: `faces/${cropName}`,
        });
    }

    return {faces};
}

// ---------------------------------------------------------------------------
// Pure math utilities
// ---------------------------------------------------------------------------

export function iou(a: BBox, b: BBox): number {
    const x1 = Math.max(a[0], b[0]);
    const y1 = Math.max(a[1], b[1]);
    const x2 = Math.min(a[2], b[2]);
    const y2 = Math.min(a[3], b[3]);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const areaA = (a[2] - a[0]) * (a[3] - a[1]);
    const areaB = (b[2] - b[0]) * (b[3] - b[1]);
    return inter / (areaA + areaB - inter);
}

export function nms(faces: FaceDetection[], threshold: number): FaceDetection[] {
    faces.sort((a, b) => b.score - a.score);
    const keep: FaceDetection[] = [];
    const suppressed = new Set<number>();

    for (let i = 0; i < faces.length; i++) {
        if (suppressed.has(i)) continue;
        keep.push(faces[i]);
        for (let j = i + 1; j < faces.length; j++) {
            if (suppressed.has(j)) continue;
            if (iou(faces[i].bbox, faces[j].bbox) > threshold) {
                suppressed.add(j);
            }
        }
    }
    return keep;
}

export function l2Normalize(v: Float32Array): number[] {
    let norm = 0;
    for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
    norm = Math.sqrt(norm);
    const out = new Array<number>(v.length);
    for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
    return out;
}

/** Cosine similarity between two L2-normalized embeddings (= dot product) */
export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return dot;
}

// ---------------------------------------------------------------------------
// Data attribute encoding (for one/index.html storage)
// ---------------------------------------------------------------------------

export interface FaceClusterInfo {
    clusterId: string;
    personName?: string;
    qrPath?: string;
}

export interface FaceExportData {
    faces: FaceAnalysisResult;
    clusterInfo?: FaceClusterInfo[];
}

export function facesToDataAttrs(
    result: FaceAnalysisResult,
    clusterInfo?: FaceClusterInfo[]
): Record<string, string> {
    const data: Record<string, string> = {};
    data['face-count'] = String(result.faces.length);
    if (result.faces.length === 0) return data;

    data['face-bboxes'] = result.faces
        .map(f => f.detection.bbox.map(v => Math.round(v)).join(','))
        .join(';');

    data['face-scores'] = result.faces
        .map(f => f.detection.score.toFixed(3))
        .join(',');

    // Embeddings as base64-encoded Float32Array
    const allEmbeddings = new Float32Array(result.faces.length * EMBEDDING_DIM);
    for (let i = 0; i < result.faces.length; i++) {
        allEmbeddings.set(result.faces[i].embedding, i * EMBEDDING_DIM);
    }
    const bytes = new Uint8Array(allEmbeddings.buffer);
    data['face-embeddings'] = uint8ToBase64(bytes);

    if (result.faces.some(f => f.cropPath)) {
        data['face-crops'] = result.faces
            .map(f => f.cropPath ?? '')
            .join(';');
    }

    // Cluster attributes
    if (clusterInfo) {
        data['face-cluster-hashes'] = clusterInfo
            .map(c => c.clusterId)
            .join(';');
        data['face-names'] = clusterInfo
            .map(c => c.personName ?? 'Unknown')
            .join(';');
        if (clusterInfo.some(c => c.qrPath)) {
            data['face-qrcodes'] = clusterInfo
                .map(c => c.qrPath ?? '')
                .join(';');
        }
    }

    return data;
}

export function dataAttrsToFaces(data: Record<string, string>): FaceAnalysisResult {
    const count = parseInt(data['face-count'] ?? '0', 10);
    if (count === 0) return {faces: []};

    const bboxStrings = (data['face-bboxes'] ?? '').split(';');
    const scores = (data['face-scores'] ?? '').split(',').map(Number);
    const crops = data['face-crops']?.split(';');

    let embeddings: Float32Array | null = null;
    if (data['face-embeddings']) {
        const bytes = base64ToUint8(data['face-embeddings']);
        embeddings = new Float32Array(bytes.buffer);
    }

    const faces: FaceResult[] = [];
    for (let i = 0; i < count; i++) {
        const bboxParts = bboxStrings[i].split(',').map(Number);
        const bbox: BBox = [bboxParts[0], bboxParts[1], bboxParts[2], bboxParts[3]];

        const embedding = embeddings
            ? Array.from(embeddings.slice(i * EMBEDDING_DIM, (i + 1) * EMBEDDING_DIM))
            : new Array<number>(EMBEDDING_DIM).fill(0);

        faces.push({
            detection: {bbox, score: scores[i], landmarks: []},
            embedding,
            cropPath: crops?.[i],
        });
    }

    return {faces};
}

export function dataAttrsToFaceExport(data: Record<string, string>): FaceExportData {
    const faces = dataAttrsToFaces(data);

    let clusterInfo: FaceClusterInfo[] | undefined;
    if (data['face-cluster-hashes']) {
        const hashes = data['face-cluster-hashes'].split(';');
        const names = data['face-names']?.split(';');
        const qrPaths = data['face-qrcodes']?.split(';');
        clusterInfo = hashes.map((clusterId, i) => ({
            clusterId,
            personName: names?.[i] === 'Unknown' ? undefined : names?.[i],
            qrPath: qrPaths?.[i] || undefined,
        }));
    }

    return {faces, clusterInfo};
}

// ---------------------------------------------------------------------------
// Base64 helpers (platform-agnostic — no Buffer dependency)
// ---------------------------------------------------------------------------

function uint8ToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}
