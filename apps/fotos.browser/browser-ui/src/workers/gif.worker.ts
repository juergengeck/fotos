/// <reference lib="webworker" />

import {decodeGif} from '@refinio/media.core/gif';

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (event: MessageEvent<ArrayBuffer>) => {
    try {
        const animation = decodeGif(new Uint8Array(event.data));
        self.postMessage({animation}, animation.frames.map(frame => frame.rgba.buffer as ArrayBuffer));
    } catch (error) {
        self.postMessage({error: error instanceof Error ? error.message : String(error)});
    }
};
