/**
 * Face detection + recognition Web Worker.
 *
 * Uses onnxruntime-web (WebGPU → WASM fallback) with InsightFace buffalo_l models.
 * Implements FacePlatform from fotos.core using OffscreenCanvas for image ops.
 */

import * as ort from 'onnxruntime-web/webgpu';
import {
    setPlatform,
    initFaceDetectionModel,
    initFaceRecognitionModel,
    disposeFaceModels,
    detectFaces,
    computeEmbedding,
    facesToDataAttrs,
    type FacePlatform,
    type FaceAnalysisResult,
} from '@refinio/fotos.core';
import { getModelUrl } from '@refinio/local.core';

// ── Types ────────────────────────────────────────────────────────────

interface InitMessage {
    type: 'init';
}

interface AnalyzeMessage {
    type: 'analyze';
    id: string;
    imageBlob: Blob;
    imageId: string;
}

type WorkerInMessage = InitMessage | AnalyzeMessage;

interface ReadyResponse {
    type: 'ready';
    device: 'webgpu' | 'wasm';
}

interface ResultResponse {
    type: 'result';
    id: string;
    dataAttrs: Record<string, string>;
    cropBlobs: Array<{ name: string; blob: Blob }>;
}

interface ProgressResponse {
    type: 'progress';
    stage: string;
    detail?: Record<string, unknown>;
}

interface ErrorResponse {
    type: 'error';
    id?: string;
    error: string;
}

type WorkerOutMessage = ReadyResponse | ResultResponse | ProgressResponse | ErrorResponse;

// ── Model name → local.core registry mapping ────────────────────────

const FACE_MODEL_IDS = {
    'det_10g.onnx': 'insightface-det-10g',
    'w600k_r50.onnx': 'insightface-w600k-r50',
} as const;

type FaceModelId = (typeof FACE_MODEL_IDS)[keyof typeof FACE_MODEL_IDS];

// ── Image store (virtual filesystem for fotos.core) ──────────────────

const imageStore = new Map<string, Blob>();
const cropStore = new Map<string, Blob>();

// ── BrowserFacePlatform ──────────────────────────────────────────────

function createBrowserFacePlatform(): FacePlatform {
    return {
        images: {
            async decodeAndResize(path: string, width: number, height: number) {
                const blob = imageStore.get(path);
                if (!blob) throw new Error(`Image not found: ${path}`);

                const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
                const origWidth = bitmap.width;
                const origHeight = bitmap.height;

                const canvas = new OffscreenCanvas(width, height);
                const ctx = canvas.getContext('2d')!;
                ctx.drawImage(bitmap, 0, 0, width, height);
                bitmap.close();

                const imageData = ctx.getImageData(0, 0, width, height);
                // Convert RGBA → RGB
                const rgb = new Uint8Array(width * height * 3);
                for (let i = 0; i < width * height; i++) {
                    rgb[i * 3] = imageData.data[i * 4];
                    rgb[i * 3 + 1] = imageData.data[i * 4 + 1];
                    rgb[i * 3 + 2] = imageData.data[i * 4 + 2];
                }

                return { data: rgb, origWidth, origHeight };
            },

            async cropAndResize(
                path: string,
                x: number, y: number, w: number, h: number,
                targetWidth: number, targetHeight: number
            ) {
                const blob = imageStore.get(path);
                if (!blob) throw new Error(`Image not found: ${path}`);

                const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });

                // Clamp crop to image bounds
                const cx = Math.max(0, Math.min(x, bitmap.width));
                const cy = Math.max(0, Math.min(y, bitmap.height));
                const cw = Math.min(w, bitmap.width - cx);
                const ch = Math.min(h, bitmap.height - cy);

                const canvas = new OffscreenCanvas(targetWidth, targetHeight);
                const ctx = canvas.getContext('2d')!;
                ctx.drawImage(bitmap, cx, cy, cw, ch, 0, 0, targetWidth, targetHeight);
                bitmap.close();

                const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
                const rgb = new Uint8Array(targetWidth * targetHeight * 3);
                for (let i = 0; i < targetWidth * targetHeight; i++) {
                    rgb[i * 3] = imageData.data[i * 4];
                    rgb[i * 3 + 1] = imageData.data[i * 4 + 1];
                    rgb[i * 3 + 2] = imageData.data[i * 4 + 2];
                }
                return rgb;
            },

            async saveFaceCrop(
                path: string,
                x: number, y: number, w: number, h: number,
                outputPath: string,
                size: number
            ) {
                const blob = imageStore.get(path);
                if (!blob) throw new Error(`Image not found: ${path}`);

                const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });

                const cx = Math.max(0, Math.min(x, bitmap.width));
                const cy = Math.max(0, Math.min(y, bitmap.height));
                const cw = Math.min(w, bitmap.width - cx);
                const ch = Math.min(h, bitmap.height - cy);

                const canvas = new OffscreenCanvas(size, size);
                const ctx = canvas.getContext('2d')!;
                ctx.drawImage(bitmap, cx, cy, cw, ch, 0, 0, size, size);
                bitmap.close();

                const cropBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
                cropStore.set(outputPath, cropBlob);
            },

            async mkdirp() {
                // No-op in virtual filesystem
            },
        },

        onnx: {
            async createSession(modelPath: string) {
                const modelName = modelPath.split('/').pop()!;
                const registryId = FACE_MODEL_IDS[modelName];
                if (!registryId) throw new Error(`Unknown face model: ${modelName}`);
                const url = getModelUrl(registryId);
                reportProgress('model-fetch-start', { modelName, url });
                console.log(`[FaceWorker] Loading ${modelName} from ${url}`);
                const resp = await fetch(url);
                if (!resp.ok) throw new Error(`Failed to fetch ${modelName}: ${resp.status}`);
                const modelBuffer = await resp.arrayBuffer();
                reportProgress('model-fetch-complete', { modelName, bytes: modelBuffer.byteLength });

                // Prefer WebGPU, fall back to WASM
                const providers: string[] = device === 'webgpu'
                    ? ['webgpu', 'wasm']
                    : ['wasm'];

                let session: ort.InferenceSession;
                try {
                    session = await ort.InferenceSession.create(modelBuffer, {
                        executionProviders: providers,
                        graphOptimizationLevel: 'basic',
                    });
                } catch {
                    session = await ort.InferenceSession.create(modelBuffer, {
                        executionProviders: ['wasm'],
                    });
                if (device === 'webgpu') {
                    console.warn('[FaceWorker] WebGPU failed, fell back to WASM');
                    device = 'wasm';
                }
            }

                reportProgress('model-session-ready', {
                    modelName,
                    device,
                    inputs: session.inputNames,
                    outputs: session.outputNames,
                });
                console.log(`[FaceWorker] Session ${modelName}: inputs=[${session.inputNames}], outputs=[${session.outputNames}]`);
                let runCount = 0;

                return {
                    inputNames: session.inputNames,
                    outputNames: session.outputNames,
                    async run(feeds: Record<string, any>) {
                        // Guard against WebGPU inference hangs
                        const result = await Promise.race([
                            session.run(feeds),
                            new Promise<never>((_, reject) =>
                                setTimeout(() => reject(new Error('ONNX inference timeout (30s)')), 30000)
                            ),
                        ]);
                        if (runCount++ < 2) {
                            for (const name of session.outputNames) {
                                const t = (result as any)[name];
                                if (t) console.log(`[FaceWorker] ${modelName} output "${name}": dims=[${t.dims}], size=${t.size}`);
                            }
                        }
                        return result as any;
                    },
                    async release() {
                        await session.release();
                    },
                };
            },

            createTensor(type: 'float32', data: Float32Array, dims: number[]) {
                return new ort.Tensor(type, data, dims) as any;
            },
        },
    };
}

// ── Worker message handler ───────────────────────────────────────────

let initialized = false;
let recognitionInitialized = false;
let device: 'webgpu' | 'wasm' = 'wasm';
const joinModelPath = (a: string, b: string) => `${a}/${b}`;

function reportProgress(stage: string, detail?: Record<string, unknown>): void {
    (self as any).postMessage({
        type: 'progress',
        stage,
        detail,
    } satisfies ProgressResponse);
}

async function handleInit(): Promise<void> {
    if (initialized) return;
    reportProgress('init-start');

    // WASM runtime binaries from CDN (too large for Cloudflare Pages 25MB limit)
    ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.2/dist/';
    ort.env.wasm.numThreads = 1;

    // Detect WebGPU
    try {
        if ('gpu' in navigator) {
            const adapter = await (navigator as any).gpu.requestAdapter();
            if (adapter) device = 'webgpu';
        }
    } catch { /* WASM fallback */ }
    reportProgress('device-selected', { device });

    const platform = createBrowserFacePlatform();
    setPlatform(platform);

    reportProgress('detection-init-start', { device });
    await initFaceDetectionModel('', joinModelPath);
    reportProgress('detection-init-complete', { device });

    // Warm up detection only. Recognition loads lazily once a face is found.
    reportProgress('warmup-start', { device, scope: 'detection' });
    const warmupOk = await testDetectionInference();
    if (!warmupOk && device === 'webgpu') {
        console.warn('[FaceWorker] WebGPU inference hung — falling back to WASM');
        reportProgress('warmup-fallback-wasm', { scope: 'detection' });
        device = 'wasm';
        await disposeFaceModels();
        recognitionInitialized = false;
        const wasmPlatform = createBrowserFacePlatform();
        setPlatform(wasmPlatform);
        reportProgress('models-reinit-start', { device, scope: 'detection' });
        await initFaceDetectionModel('', joinModelPath);
        reportProgress('models-reinit-complete', { device, scope: 'detection' });
    }

    initialized = true;
    reportProgress('init-complete', { device, recognitionInitialized });
    console.log(`[FaceWorker] Detection model loaded, device: ${device}`);
}

/**
 * Run warmup inference on the detection model to verify the execution provider
 * actually works. Recognition loads lazily once the detector finds a face.
 */
async function testDetectionInference(): Promise<boolean> {
    const warmupPath = '__warmup__';
    try {
        // Create a small test image via OffscreenCanvas
        const canvas = new OffscreenCanvas(4, 4);
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#888';
        ctx.fillRect(0, 0, 4, 4);
        const blob = await canvas.convertToBlob({ type: 'image/png' });
        imageStore.set(warmupPath, blob);

        // Test detection model
        reportProgress('warmup-detection-start');
        console.log('[FaceWorker] Warmup: testing detection model...');
        const detOk = await Promise.race([
            detectFaces(warmupPath).then(() => true),
            new Promise<false>(resolve => setTimeout(() => resolve(false), 15000)),
        ]);
        if (!detOk) {
            console.warn('[FaceWorker] Warmup: detection model inference hung');
            reportProgress('warmup-detection-timeout');
            return false;
        }
        reportProgress('warmup-detection-complete');
        console.log('[FaceWorker] Warmup: detection model OK');
        return true;
    } catch (err) {
        console.warn('[FaceWorker] Warmup inference failed:', err);
        reportProgress('warmup-error', { message: String(err) });
        return false;
    } finally {
        imageStore.delete(warmupPath);
    }
}

async function ensureRecognitionReady(): Promise<void> {
    if (recognitionInitialized) return;

    reportProgress('recognition-init-start', { device });
    await initFaceRecognitionModel('', joinModelPath);
    recognitionInitialized = true;
    reportProgress('recognition-init-complete', { device });
}

async function handleAnalyze(msg: AnalyzeMessage): Promise<ResultResponse> {
    const virtualPath = `__input_${msg.id}`;
    imageStore.set(virtualPath, msg.imageBlob);
    cropStore.clear();

    console.log(`[FaceWorker] analyze: start ${msg.id}, blob size=${msg.imageBlob.size}`);

    let result: FaceAnalysisResult;
    try {
        // Step 1: detection
        console.log('[FaceWorker] analyze: running detectFaces...');
        const detections = await detectFaces(virtualPath);
        console.log(`[FaceWorker] analyze: detectFaces returned ${detections.length} faces`);

        if (detections.length > 0) {
            await ensureRecognitionReady();
        }

        // Step 2: recognition + crops (same as analyzeImage but with logging)
        const faces: FaceAnalysisResult['faces'] = [];
        for (let i = 0; i < detections.length; i++) {
            console.log(`[FaceWorker] analyze: computing embedding ${i + 1}/${detections.length}...`);
            const emb = await computeEmbedding(virtualPath, detections[i]);
            console.log(`[FaceWorker] analyze: embedding ${i + 1} done`);

            const det = detections[i];
            const cropName = `${msg.imageId.slice(0, 8)}_${i}.jpg`;
            const cropPath = `faces/${cropName}`;
            const [bx1, by1, bx2, by2] = det.bbox;
            const margin = Math.max(bx2 - bx1, by2 - by1) * 0.15;
            const p = createBrowserFacePlatform();
            await p.images.saveFaceCrop(
                virtualPath,
                Math.max(0, Math.round(bx1 - margin)),
                Math.max(0, Math.round(by1 - margin)),
                Math.round((bx2 - bx1) + margin * 2),
                Math.round((by2 - by1) + margin * 2),
                cropPath,
                112
            );

            faces.push({ detection: det, embedding: emb, cropPath });
        }
        result = { faces };
        console.log(`[FaceWorker] analyze: complete, ${faces.length} faces`);
    } finally {
        imageStore.delete(virtualPath);
    }

    const dataAttrs = facesToDataAttrs(result);

    // Collect crop blobs
    const cropBlobs: Array<{ name: string; blob: Blob }> = [];
    for (const [path, blob] of cropStore.entries()) {
        cropBlobs.push({ name: path, blob });
    }
    cropStore.clear();

    return { type: 'result', id: msg.id, dataAttrs, cropBlobs };
}

self.onmessage = async (e: MessageEvent<WorkerInMessage>) => {
    const msg = e.data;
    console.log(`[FaceWorker] onmessage: type=${msg.type}, initialized=${initialized}`);

    try {
        if (msg.type === 'init') {
            await handleInit();
            (self as any).postMessage({ type: 'ready', device } satisfies ReadyResponse);
        } else if (msg.type === 'analyze') {
            if (!initialized) {
                await handleInit();
                (self as any).postMessage({ type: 'ready', device } satisfies ReadyResponse);
            }
            const result = await handleAnalyze(msg);
            (self as any).postMessage(result);
        }
    } catch (err: any) {
        (self as any).postMessage({
            type: 'error',
            id: (msg as any).id,
            error: err.message ?? String(err),
        } satisfies ErrorResponse);
    }
};
