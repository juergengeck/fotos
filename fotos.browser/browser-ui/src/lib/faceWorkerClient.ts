/**
 * Client wrapper for the face detection Web Worker.
 * Provides a promise-based API matching FaceWorkerHandle.
 */

import type { FaceWorkerHandle } from './browserIngest';

interface PendingRequest {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
}

export interface FaceWorkerProgress {
    stage: string;
    detail?: Record<string, unknown>;
}

export function createFaceWorker(
    workerUrl: string,
    options?: { onProgress?: (progress: FaceWorkerProgress) => void }
): {
    handle: FaceWorkerHandle;
    ready: Promise<{ device: 'webgpu' | 'wasm' }>;
    terminate: () => void;
} {
    const worker = new Worker(workerUrl, { type: 'module' });
    const pending = new Map<string, PendingRequest>();
    let idCounter = 0;

    let readyResolve: (v: { device: 'webgpu' | 'wasm' }) => void;
    let readyReject: (e: Error) => void;
    const ready = new Promise<{ device: 'webgpu' | 'wasm' }>((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
    });

    worker.onmessage = (e: MessageEvent) => {
        const msg = e.data;
        if (msg.type === 'progress') {
            options?.onProgress?.({
                stage: msg.stage,
                detail: msg.detail,
            });
            return;
        }
        if (msg.type === 'ready') {
            readyResolve({ device: msg.device });
            return;
        }
        if (msg.type === 'result') {
            const req = pending.get(msg.id);
            if (req) {
                pending.delete(msg.id);
                req.resolve({ dataAttrs: msg.dataAttrs, cropBlobs: msg.cropBlobs });
            }
            return;
        }
        if (msg.type === 'error') {
            if (msg.id) {
                const req = pending.get(msg.id);
                if (req) {
                    pending.delete(msg.id);
                    req.reject(new Error(msg.error));
                }
            } else {
                readyReject(new Error(msg.error));
            }
        }
    };

    worker.onerror = (e) => {
        readyReject(new Error(e.message));
    };

    // Start initialization
    worker.postMessage({ type: 'init' });

    const handle: FaceWorkerHandle = {
        async analyze(imageBlob: Blob, imageId: string) {
            const id = String(++idCounter);
            return new Promise((resolve, reject) => {
                pending.set(id, { resolve, reject });
                worker.postMessage({ type: 'analyze', id, imageBlob, imageId });
            });
        },
    };

    return {
        handle,
        ready,
        terminate: () => worker.terminate(),
    };
}
