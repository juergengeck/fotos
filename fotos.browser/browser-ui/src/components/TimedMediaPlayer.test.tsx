// @vitest-environment jsdom

import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {decodeGifInWorker} from '@/lib/gifDecoder';
import type {PhotoEntry} from '@/types/fotos';
import {Lightbox} from './Lightbox.js';

vi.mock('@/lib/gifDecoder', () => ({decodeGifInWorker: vi.fn()}));

const decodedGif = {
    width: 2,
    height: 1,
    frames: [
        {rgba: new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255]), durationMs: 1_000, startMs: 0},
        {rgba: new Uint8ClampedArray([0, 0, 255, 255, 0, 0, 255, 255]), durationMs: 1_200, startMs: 1_000},
    ],
    durationMs: 2_200,
    loopCount: null,
};

function photo(name: string, mimeType?: string): PhotoEntry {
    return {
        hash: name,
        name,
        mimeType,
        managed: 'ingest',
        sourcePath: name,
        tags: [],
        addedAt: '2026-09-11T00:00:00.000Z',
        size: 42,
    };
}

describe('Lightbox timed media playback', () => {
    let container: HTMLDivElement;
    let root: Root;
    let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
    let originalRect: typeof HTMLElement.prototype.getBoundingClientRect;
    const putImageData = vi.fn();

    beforeEach(() => {
        (globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);

        vi.mocked(decodeGifInWorker).mockResolvedValue(decodedGif);
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true,
            arrayBuffer: async () => new Uint8Array([71, 73, 70]).buffer,
        })));
        vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());

        originalGetContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
            createImageData: (width: number, height: number) => ({
                data: new Uint8ClampedArray(width * height * 4),
            }),
            putImageData,
        })) as unknown as typeof HTMLCanvasElement.prototype.getContext;

        originalRect = HTMLElement.prototype.getBoundingClientRect;
        HTMLElement.prototype.getBoundingClientRect = vi.fn(() => ({
            bottom: 200,
            height: 200,
            left: 0,
            right: 300,
            top: 0,
            width: 300,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        }));
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        HTMLCanvasElement.prototype.getContext = originalGetContext;
        HTMLElement.prototype.getBoundingClientRect = originalRect;
        (globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = false;
        vi.clearAllMocks();
        vi.unstubAllGlobals();
    });

    it('renders composed GIF frames and keeps playback controls out of photo navigation', async () => {
        const onIndexChange = vi.fn();
        const onClose = vi.fn();
        const photos = [
            photo('before.jpg', 'image/jpeg'),
            photo('animation.gif', 'image/gif'),
            photo('after.jpg', 'image/jpeg'),
        ];

        await act(async () => {
            root.render(
                <Lightbox
                    photos={photos}
                    index={1}
                    onIndexChange={onIndexChange}
                    onClose={onClose}
                    getFileUrl={async path => `blob:${path}`}
                />,
            );
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(decodeGifInWorker).toHaveBeenCalledOnce();
        expect(putImageData).toHaveBeenCalled();
        expect(container.querySelector('canvas')?.getAttribute('aria-label')).toBe('Animated image: animation.gif');
        expect(container.textContent).toContain('0:00.00 / 0:02.20');

        const pause = container.querySelector<HTMLButtonElement>('button[aria-label="Pause animated image"]');
        expect(pause).not.toBeNull();
        act(() => pause?.dispatchEvent(new MouseEvent('click', {bubbles: true, clientX: 0})));
        expect(onIndexChange).not.toHaveBeenCalled();
        expect(container.querySelector('button[aria-label="Play animated image"]')).not.toBeNull();

        const seek = container.querySelector<HTMLInputElement>('input[aria-label="Animated image position"]');
        expect(seek).not.toBeNull();
        act(() => seek?.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true})));
        expect(onIndexChange).not.toHaveBeenCalled();

        const play = container.querySelector<HTMLButtonElement>('button[aria-label="Play animated image"]');
        play?.focus();
        act(() => play?.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})));
        expect(onClose).toHaveBeenCalledOnce();

        act(() => window.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight'})));
        expect(onIndexChange).toHaveBeenCalledWith(2);
    });

    it('uses the legacy filename fallback for native video without stealing control keys', async () => {
        const onIndexChange = vi.fn();
        const photos = [
            photo('before.jpg', 'image/jpeg'),
            photo('legacy-recording.mp4'),
            photo('after.jpg', 'image/jpeg'),
        ];

        await act(async () => {
            root.render(
                <Lightbox
                    photos={photos}
                    index={1}
                    onIndexChange={onIndexChange}
                    onClose={vi.fn()}
                    getFileUrl={async path => `blob:${path}`}
                />,
            );
            await Promise.resolve();
        });

        const video = container.querySelector<HTMLVideoElement>('video[controls]');
        expect(video?.getAttribute('aria-label')).toBe('Video: legacy-recording.mp4');
        act(() => video?.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true})));
        expect(onIndexChange).not.toHaveBeenCalled();

        act(() => window.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight'})));
        expect(onIndexChange).toHaveBeenCalledWith(2);
    });
});
