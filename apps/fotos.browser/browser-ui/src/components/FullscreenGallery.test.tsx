// @vitest-environment jsdom
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {FullscreenGallery, FullscreenGalleryExit, GallerySurfaceSwitcher} from './FullscreenGallery.js';
import type {PhotoEntry} from '@/types/fotos';

const photo = (hash: string, name = `${hash}.jpg`): PhotoEntry => ({hash, name, sourcePath: `media/${name}`, managed: 'reference', tags: [], addedAt: '2026-10-01T12:00:00Z', size: 12});

describe('FullscreenGallery', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        (globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.unstubAllGlobals();
        (globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = false;
    });

    it('keeps day anchors and opens the flat photo index across days', async () => {
        const onPhotoClick = vi.fn();
        await act(async () => root.render(<FullscreenGallery
            dayGroups={[{date: '2026-10-01', photos: [photo('one')]}, {date: '2026-09-30', photos: [photo('two')]}]}
            scrollRef={{current: container}}
            getThumbUrl={async entry => `thumb:${entry.hash}`}
            getFileUrl={async path => `file:${path}`}
            onPhotoClick={onPhotoClick}
        />));
        expect(container.querySelector('[data-fullscreen-gallery="true"]')).not.toBeNull();
        expect(container.querySelector('[data-date="2026-09-30"][data-gallery-day="2026-09-30"]')).not.toBeNull();
        const buttons = container.querySelectorAll<HTMLButtonElement>('button[data-photo-index]');
        act(() => buttons[1].click());
        expect(onPhotoClick).toHaveBeenCalledWith(1);
        expect(container.querySelector('img')?.getAttribute('src')).toBe('file:media/one.jpg');
        expect(container.querySelector('img')?.className).toContain('object-contain');
    });

    it('only opens originals near the viewport and keeps video as a clickable preview', async () => {
        const observers: Array<{callback: IntersectionObserverCallback; target?: Element}> = [];
        const disconnect = vi.fn();
        vi.stubGlobal('IntersectionObserver', class {
            item: (typeof observers)[number];
            constructor(callback: IntersectionObserverCallback) {
                this.item = {callback};
                observers.push(this.item);
            }
            observe(target: Element) { this.item.target = target; }
            disconnect = disconnect;
        });
        const getFileUrl = vi.fn(async path => `file:${path}`);
        await act(async () => root.render(<FullscreenGallery
            dayGroups={[{date: '2026-10-01', photos: [photo('one'), photo('video', 'clip.mp4')]}]}
            scrollRef={{current: container}}
            getThumbUrl={async entry => `thumb:${entry.hash}`}
            getFileUrl={getFileUrl}
            onPhotoClick={vi.fn()}
        />));
        expect(getFileUrl).not.toHaveBeenCalled();
        expect(container.querySelector('img')?.getAttribute('src')).toBe('thumb:one');
        await act(async () => {
            for (const observer of observers) observer.callback([{isIntersecting: true, target: observer.target!} as IntersectionObserverEntry], {} as IntersectionObserver);
        });
        expect(getFileUrl).toHaveBeenCalledExactlyOnceWith('media/one.jpg');
        expect(container.querySelectorAll('img')[1].getAttribute('src')).toBe('thumb:video');
        expect(disconnect).toHaveBeenCalledTimes(2);
    });

    it('exposes an explicit fullscreen choice and focused exit', () => {
        const onChange = vi.fn();
        const onExit = vi.fn();
        act(() => root.render(<><GallerySurfaceSwitcher fullscreen={false} onChange={onChange} /><FullscreenGalleryExit onExit={onExit} /></>));
        const enter = container.querySelector<HTMLButtonElement>('[aria-label="Show images fullscreen"]')!;
        expect(enter.getAttribute('aria-pressed')).toBe('false');
        act(() => enter.click());
        expect(onChange).toHaveBeenCalledWith(true);
        const exit = container.querySelector<HTMLButtonElement>('[aria-label="Exit fullscreen images"]')!;
        expect(document.activeElement).toBe(exit);
        act(() => exit.click());
        expect(onExit).toHaveBeenCalledOnce();
    });

    it('keeps a loaded image visible when its original and refreshed metadata use the same URL', async () => {
        let resolveOriginal!: (url: string) => void;
        const original = new Promise<string>(resolve => { resolveOriginal = resolve; });
        await act(async () => root.render(<FullscreenGallery
            dayGroups={[{date: '2026-10-01', photos: [photo('one')]}]}
            scrollRef={{current: container}}
            getThumbUrl={async () => 'shared-url'}
            getFileUrl={() => original}
            onPhotoClick={vi.fn()}
        />));
        const img = container.querySelector('img')!;
        act(() => img.dispatchEvent(new Event('load')));
        expect(img.className).toContain('opacity-100');
        await act(async () => resolveOriginal('shared-url'));
        expect(container.querySelector('img')).toBe(img);
        expect(img.className).toContain('opacity-100');
        await act(async () => root.render(<FullscreenGallery
            dayGroups={[{date: '2026-10-01', photos: [{...photo('one'), tags: ['updated']}]}]}
            scrollRef={{current: container}}
            getThumbUrl={async () => 'shared-url'}
            getFileUrl={() => original}
            onPhotoClick={vi.fn()}
        />));
        expect(container.querySelector('img')?.className).toContain('opacity-100');
    });
});
