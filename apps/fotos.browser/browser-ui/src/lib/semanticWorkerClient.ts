import type { SemanticInfo } from '@/types/fotos';

interface PendingRequest {
    resolve: (value: SemanticInfo) => void;
    reject: (reason: unknown) => void;
}

export interface SemanticWorkerHandle {
    embedText(text: string): Promise<SemanticInfo>;
    embedImage(imageBlob: Blob): Promise<SemanticInfo>;
}

export function createSemanticWorker(workerUrl: string): {
    handle: SemanticWorkerHandle;
    ready: Promise<void>;
    terminate: () => void;
} {
    const worker = new Worker(workerUrl, { type: 'module' });
    const pending = new Map<string, PendingRequest>();
    let idCounter = 0;

    let readyResolve!: () => void;
    let readyReject!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
    });

    worker.onmessage = (event: MessageEvent) => {
        const message = event.data;
        if (message.type === 'ready') {
            readyResolve();
            return;
        }

        if (message.type === 'result') {
            const request = pending.get(message.id);
            if (!request) {
                return;
            }

            pending.delete(message.id);
            request.resolve({
                modelId: message.modelId,
                embedding: new Float32Array(message.embedding),
            });
            return;
        }

        if (message.type === 'error') {
            if (!message.id) {
                readyReject(new Error(message.error));
                return;
            }

            const request = pending.get(message.id);
            if (!request) {
                return;
            }

            pending.delete(message.id);
            request.reject(new Error(message.error));
        }
    };

    worker.onerror = (event) => {
        readyReject(new Error(event.message));
    };

    worker.postMessage({ type: 'init' });

    function send(type: 'embed-text' | 'embed-image', payload: { text?: string; imageBlob?: Blob }) {
        const id = String(++idCounter);
        return new Promise<SemanticInfo>((resolve, reject) => {
            pending.set(id, { resolve, reject });
            worker.postMessage({ type, id, ...payload });
        });
    }

    return {
        handle: {
            embedText(text: string) {
                return send('embed-text', { text });
            },
            embedImage(imageBlob: Blob) {
                return send('embed-image', { imageBlob });
            },
        },
        ready,
        terminate: () => worker.terminate(),
    };
}
