// @vitest-environment jsdom
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {decodeGifInWorker} from '@/lib/gifDecoder';
import type {PhotoEntry} from '@/types/fotos';
import {PhotoGrid} from './PhotoGrid.js';
import {FullscreenGallery} from './FullscreenGallery.js';

vi.mock('@/lib/gifDecoder', () => ({decodeGifInWorker: vi.fn()}));
const photo = (name: string): PhotoEntry => ({hash: name, name, sourcePath: name, managed: 'reference', tags: [], addedAt: '2026-10-01', size: 12});
const photos = [photo('clip.mp4'), photo('animation.gif')];
const dayGroups = [{date: '2026-10-01', photos}];
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

describe.each(['grid', 'fullscreen'] as const)('%s inline playback', surface => {
    let container: HTMLDivElement;
    let root: Root;
    let observers: Array<{callback: IntersectionObserverCallback; target?: Element; disconnected: boolean}>;
    const onOpen = vi.fn();
    const onSelect = vi.fn();
    const getFileUrl = vi.fn(async path => `blob:${path}`);
    const getThumbUrl = vi.fn(async (entry: PhotoEntry) => `thumb:${entry.hash}`);
    function render(selectionActive = false) {
        return surface === 'grid'
            ? <PhotoGrid dayGroups={dayGroups} photos={photos} thumbScale={200} getThumbUrl={getThumbUrl} getFileUrl={getFileUrl}
                onPhotoClick={onOpen} selectionActive={selectionActive} onPhotoToggleSelection={onSelect} />
            : <FullscreenGallery dayGroups={dayGroups} scrollRef={{current: container}} getThumbUrl={getThumbUrl}
                getFileUrl={getFileUrl} onPhotoClick={onOpen} />;
    }
    function button(label: string) { return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!; }
    beforeEach(() => {
        (globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        observers = [];
        HTMLElement.prototype.scrollIntoView = vi.fn();
        vi.stubGlobal('ResizeObserver', class {observe() {} disconnect() {}});
        vi.stubGlobal('IntersectionObserver', class {
            item: (typeof observers)[number];
            constructor(callback: IntersectionObserverCallback) { this.item = {callback, disconnected: false}; observers.push(this.item); }
            observe(target: Element) { this.item.target = target; }
            disconnect() { this.item.disconnected = true; }
        });
        vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, arrayBuffer: async () => new ArrayBuffer(3)})));
        vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
        vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
        vi.spyOn(HTMLCanvasElement.prototype as {
            getContext(contextId: '2d'): CanvasRenderingContext2D | null;
        }, 'getContext').mockReturnValue({
            createImageData: () => ({data: new Uint8ClampedArray(4)}), putImageData: vi.fn(),
        } as unknown as CanvasRenderingContext2D);
        vi.mocked(decodeGifInWorker).mockResolvedValue({width: 1, height: 1, loopCount: 0, durationMs: 200,
            frames: [0, 100].map(startMs => ({rgba: new Uint8ClampedArray(4), durationMs: 100, startMs}))});
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
        vi.restoreAllMocks();
        vi.clearAllMocks();
        vi.unstubAllGlobals();
    });

    it('keeps idle cards on posters and starts video only on explicit play', async () => {
        await act(async () => root.render(render()));
        expect(getFileUrl).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
        expect(container.querySelector('video, canvas')).toBeNull();
        expect(container.querySelector('button button, button input, button video')).toBeNull();
        const card = container.querySelector('[data-photo-index]');
        act(() => window.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight'})));
        const play = button('Play clip.mp4');
        play.focus();
        act(() => play.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true})));
        expect(onOpen).not.toHaveBeenCalled();
        await act(async () => play.click());
        expect(container.querySelector('[data-photo-index]')).toBe(card);
        expect(getFileUrl).toHaveBeenCalledExactlyOnceWith('clip.mp4');
        const video = container.querySelector('video')!;
        expect(video.controls).toBe(true);
        expect(video.autoplay).toBe(true);
        act(() => video.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true})));
        act(() => video.dispatchEvent(new KeyboardEvent('keydown', {key: ' ', bubbles: true})));
        expect(onOpen).not.toHaveBeenCalled();
        expect(onSelect).not.toHaveBeenCalled();
        act(() => button('Open viewer: clip.mp4').click());
        expect(onOpen).toHaveBeenCalledExactlyOnceWith(0);
        expect(container.querySelector('video')).toBeNull();
        expect(video.pause).toHaveBeenCalled();
        expect(video.getAttribute('src')).toBeNull();
        expect(video.load).toHaveBeenCalled();
    });

    it('allows one active card, plays GIF controls, and releases work offscreen', async () => {
        await act(async () => root.render(render()));
        await act(async () => button('Play clip.mp4').click());
        const video = container.querySelector('video')!;
        await act(async () => button('Play animation.gif').click());
        expect(container.querySelector('video')).toBeNull();
        expect(video.pause).toHaveBeenCalled();
        expect(decodeGifInWorker).toHaveBeenCalledOnce();
        expect(container.querySelector('canvas')).not.toBeNull();
        const signal = vi.mocked(decodeGifInWorker).mock.calls[0][1]!;
        act(() => button('Pause animated image').click());
        expect(button('Play animated image')).not.toBeNull();
        const seek = container.querySelector<HTMLInputElement>('input[aria-label="Animated image position"]')!;
        act(() => seek.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true})));
        expect(onOpen).not.toHaveBeenCalled();
        expect(onSelect).not.toHaveBeenCalled();
        const activeObserver = observers.at(-1)!;
        act(() => activeObserver.callback([{isIntersecting: false, target: activeObserver.target} as IntersectionObserverEntry], {} as IntersectionObserver));
        expect(container.querySelector('canvas')).toBeNull();
        expect(signal.aborted).toBe(true);
        expect(cancelAnimationFrame).toHaveBeenCalled();
        expect(activeObserver.disconnected).toBe(true);
    });

    it('lets Escape reach the gallery while reserving native fullscreen Escape for the browser', async () => {
        await act(async () => root.render(render()));
        await act(async () => button('Play clip.mp4').click());
        const video = container.querySelector('video')!;
        const onGalleryKey = vi.fn();
        window.addEventListener('keydown', onGalleryKey);
        const fullscreenDescriptor = Object.getOwnPropertyDescriptor(document, 'fullscreenElement');
        try {
            act(() => video.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true})));
            act(() => video.dispatchEvent(new KeyboardEvent('keydown', {key: ' ', bubbles: true})));
            expect(onGalleryKey).not.toHaveBeenCalled();
            act(() => video.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})));
            expect(onGalleryKey).toHaveBeenCalledOnce();
            onGalleryKey.mockClear();

            Object.defineProperty(document, 'fullscreenElement', {configurable: true, value: video});
            const nativeEscape = new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true});
            act(() => video.dispatchEvent(nativeEscape));
            expect(onGalleryKey).not.toHaveBeenCalled();
            expect(nativeEscape.defaultPrevented).toBe(false);

            Object.defineProperty(document, 'fullscreenElement', {configurable: true, value: null});
            Object.defineProperty(video, 'webkitDisplayingFullscreen', {configurable: true, value: true});
            act(() => video.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})));
            expect(onGalleryKey).not.toHaveBeenCalled();
            Object.defineProperty(video, 'webkitDisplayingFullscreen', {configurable: true, value: false});
            act(() => button('Stop clip.mp4').dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})));
            expect(onGalleryKey).toHaveBeenCalledOnce();
            onGalleryKey.mockClear();

            await act(async () => button('Play animation.gif').click());
            act(() => button('Pause animated image').dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})));
            expect(onGalleryKey).toHaveBeenCalledOnce();
        } finally {
            window.removeEventListener('keydown', onGalleryKey);
            if (fullscreenDescriptor) Object.defineProperty(document, 'fullscreenElement', fullscreenDescriptor);
            else Reflect.deleteProperty(document, 'fullscreenElement');
        }
    });

    if (surface === 'grid') it('keeps selection clicks and keyboard separate from playback', async () => {
        await act(async () => root.render(render()));
        await act(async () => button('Play clip.mp4').click());
        await act(async () => root.render(render(true)));
        expect(container.querySelector('video')).toBeNull();
        expect(button('Play clip.mp4')).toBeNull();
        act(() => container.querySelector<HTMLButtonElement>('[data-photo-index]')!.click());
        expect(onSelect).toHaveBeenCalledOnce();
        expect(onOpen).not.toHaveBeenCalled();
        act(() => window.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight'})));
        act(() => window.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter'})));
        expect(onSelect).toHaveBeenCalledTimes(2);
        expect(onOpen).not.toHaveBeenCalled();
    });
});
