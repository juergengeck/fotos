/**
 * FotosPlan — PlanRegistry-registered face detection + image analytics.
 *
 * Wraps the face worker so all operations are callable via:
 *   window.__api('fotos', 'analyzeImage', { ... })
 *   curl POST /api/fotos/analyzeImage  (via HMR bridge in dev)
 */

import { createFaceWorker } from './faceWorkerClient';
import { dataAttrsToFaces, EMBEDDING_DIM } from '@refinio/fotos.core';
import type { FaceWorkerHandle } from './browserIngest';
import type { FaceInfo } from '@/types/fotos';
import faceWorkerUrl from '@/workers/face.worker.ts?worker&url';
import { getFotosRuntimeSnapshot } from './runtimeDiagnostics';
import { clearTraceEntries, getTraceEntries } from './traceStore';

export class FotosPlan {
    private workerHandle: FaceWorkerHandle | null = null;
    private workerTerminate: (() => void) | null = null;
    private readyPromise: Promise<{ device: 'webgpu' | 'wasm' }> | null = null;
    private device: 'webgpu' | 'wasm' | null = null;

    /**
     * Initialize the face detection worker. Idempotent.
     * Returns the execution provider device (webgpu or wasm).
     */
    async init(): Promise<{ device: string }> {
        if (this.workerHandle && this.device) {
            return { device: this.device };
        }
        if (this.readyPromise) {
            const { device } = await this.readyPromise;
            this.device = device;
            return { device };
        }

        const fw = createFaceWorker(faceWorkerUrl);
        this.readyPromise = fw.ready;
        this.workerHandle = fw.handle;
        this.workerTerminate = fw.terminate;

        const { device } = await fw.ready;
        this.device = device;
        console.log(`[FotosPlan] Worker ready, device: ${device}`);
        return { device };
    }

    /**
     * Get the current face worker handle, initializing if needed.
     */
    async getWorker(): Promise<FaceWorkerHandle> {
        if (!this.workerHandle) await this.init();
        return this.workerHandle!;
    }

    /**
     * Status: returns worker state and device info.
     */
    async status(): Promise<{ initialized: boolean; device: string | null }> {
        return {
            initialized: this.workerHandle !== null,
            device: this.device,
        };
    }

    async runtimeState() {
        return getFotosRuntimeSnapshot();
    }

    async trace(params?: { clear?: boolean }) {
        const entries = getTraceEntries();
        if (params?.clear) {
            clearTraceEntries();
        }
        return {
            count: entries.length,
            entries,
        };
    }

    /**
     * Analyze a single image blob for faces.
     * Returns face count, bounding boxes, scores, and crop blobs.
     */
    async analyzeImage(params: {
        imageBlob: Blob;
        imageId: string;
    }): Promise<{
        faceCount: number;
        dataAttrs: Record<string, string>;
        cropBlobs: Array<{ name: string; blob: Blob }>;
    }> {
        const worker = await this.getWorker();
        const result = await worker.analyze(params.imageBlob, params.imageId);
        const faceCount = parseInt(result.dataAttrs['face-count'] ?? '0', 10);
        return { faceCount, ...result };
    }

    /**
     * Parse face data attributes (from one/index.html) into FaceInfo.
     * Pure function — no worker needed.
     */
    async parseFaceData(params: {
        dataAttrs: Record<string, string>;
        relPath?: string;
    }): Promise<FaceInfo | null> {
        const count = parseInt(params.dataAttrs['face-count'] ?? '0', 10);
        if (count === 0) return null;

        const result = dataAttrsToFaces(params.dataAttrs);
        const prefix = params.relPath ? `${params.relPath}/one/` : 'one/';

        return {
            count: result.faces.length,
            bboxes: result.faces.map(f => f.detection.bbox),
            scores: result.faces.map(f => f.detection.score),
            embeddings: (() => {
                const flat = new Float32Array(result.faces.length * EMBEDDING_DIM);
                for (let i = 0; i < result.faces.length; i++) {
                    flat.set(result.faces[i].embedding, i * EMBEDDING_DIM);
                }
                return flat;
            })(),
            crops: result.faces.map(f => f.cropPath ? `${prefix}${f.cropPath}` : ''),
        };
    }

    /**
     * Terminate the face worker. Frees GPU/WASM resources.
     */
    async terminate(): Promise<void> {
        this.workerTerminate?.();
        this.workerHandle = null;
        this.workerTerminate = null;
        this.device = null;
        this.readyPromise = null;
    }
}
