import type {GifAnimation} from '@refinio/media.core/gif';

/** Transfer original bytes to an isolated decoder. Aborting terminates active work. */
export function decodeGifInWorker(bytes: ArrayBuffer, signal?: AbortSignal): Promise<GifAnimation> {
    if (signal?.aborted) return Promise.reject(new DOMException('GIF decoding cancelled', 'AbortError'));
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('../workers/gif.worker.ts', import.meta.url), {type: 'module'});
        const cleanup = () => {
            signal?.removeEventListener('abort', abort);
            worker.terminate();
        };
        const abort = () => {
            cleanup();
            reject(new DOMException('GIF decoding cancelled', 'AbortError'));
        };
        signal?.addEventListener('abort', abort, {once: true});
        worker.onmessage = (event: MessageEvent<{animation?: GifAnimation; error?: string}>) => {
            cleanup();
            if (event.data.animation) resolve(event.data.animation);
            else reject(new Error(event.data.error ?? 'GIF decoder returned no frames'));
        };
        worker.onerror = event => {
            event.preventDefault();
            cleanup();
            reject(new Error(event.message || 'GIF decoder failed'));
        };
        worker.onmessageerror = () => {
            cleanup();
            reject(new Error('Cannot read GIF decoder output'));
        };
        try {
            worker.postMessage(bytes, [bytes]);
        } catch (error) {
            cleanup();
            reject(error);
        }
    });
}
