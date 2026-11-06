import { getMediaPlaybackKind } from '@refinio/media.core/media-types';
import {decodeGifInWorker} from './gifDecoder.js';

function thumbnailCanvas(width: number, height: number, maxSize: number): OffscreenCanvas {
    if (!width || !height) throw new Error('Media has no displayable dimensions');
    const scale = Math.min(1, maxSize / Math.max(width, height));
    return new OffscreenCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
}

async function videoThumbnail(file: File, maxSize: number, quality: number): Promise<Blob> {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    try {
        await new Promise<void>((resolve, reject) => {
            const cleanup = () => {
                clearTimeout(timeout);
                video.removeEventListener('loadeddata', loaded);
                video.removeEventListener('error', failed);
            };
            const loaded = () => { cleanup(); resolve(); };
            const failed = () => { cleanup(); reject(new Error('This browser cannot decode the video thumbnail')); };
            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error('Video thumbnail loading timed out'));
            }, 15_000);
            video.addEventListener('loadeddata', loaded);
            video.addEventListener('error', failed);
            video.src = url;
            video.load();
        });
        const canvas = thumbnailCanvas(video.videoWidth, video.videoHeight, maxSize);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Cannot create video thumbnail canvas');
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        return await canvas.convertToBlob({type: 'image/jpeg', quality});
    } finally {
        video.pause();
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(url);
    }
}

/** Static posters keep animations still in the grid; playback uses original bytes. */
export async function generateMediaThumbnail(file: File, maxSize = 400, quality = 0.8): Promise<Blob> {
    const kind = getMediaPlaybackKind(file.name, file.type);
    if (kind === 'video') return videoThumbnail(file, maxSize, quality);
    if (kind === 'gif') {
        const animation = await decodeGifInWorker(await file.arrayBuffer());
        const frame = new OffscreenCanvas(animation.width, animation.height);
        const frameContext = frame.getContext('2d');
        if (!frameContext) throw new Error('Cannot create GIF thumbnail canvas');
        const pixels = frameContext.createImageData(animation.width, animation.height);
        pixels.data.set(animation.frames[0].rgba);
        frameContext.putImageData(pixels, 0, 0);
        const canvas = thumbnailCanvas(animation.width, animation.height, maxSize);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Cannot create GIF thumbnail canvas');
        context.drawImage(frame, 0, 0, canvas.width, canvas.height);
        return canvas.convertToBlob({type: 'image/jpeg', quality});
    }
    const bitmap = await createImageBitmap(file, {imageOrientation: 'from-image'});
    try {
        const canvas = thumbnailCanvas(bitmap.width, bitmap.height, maxSize);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Cannot create image thumbnail canvas');
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        return await canvas.convertToBlob({type: 'image/jpeg', quality});
    } finally {
        bitmap.close();
    }
}
