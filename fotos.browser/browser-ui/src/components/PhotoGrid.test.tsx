// @vitest-environment jsdom
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {PhotoGrid} from './PhotoGrid.js';
import type {PhotoEntry} from '@/types/fotos';

const photo: PhotoEntry = {
    hash: 'one', name: 'group.jpg', managed: 'reference', tags: [], addedAt: '2026-10-01', size: 1,
    exif: {width: 1200, height: 800},
    faces: {count: 2, bboxes: [[100, 200, 200, 350], [600, 100, 700, 250]], scores: [1, 1], embeddings: null, crops: []},
};

describe('PhotoGrid sparse results and face highlights', () => {
    let container: HTMLDivElement;
    let root: Root;
    beforeEach(() => {
        (globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        Object.defineProperty(container, 'clientHeight', {value: 700});
        document.body.append(container);
        root = createRoot(container);
        vi.stubGlobal('ResizeObserver', class {observe() {} disconnect() {}});
        vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1300);
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });
    it('enlarges a lone photo and outlines only the selected face in original coordinates', async () => {
        const onPhotoClick = vi.fn();
        await act(async () => root.render(<PhotoGrid
            dayGroups={[{date: '2026-10-01', photos: [photo]}]} photos={[photo]} thumbScale={160}
            getThumbUrl={async () => 'thumb.jpg'} onPhotoClick={onPhotoClick}
            getHighlightedFaceIndices={() => [1]}
        />));
        expect((container.querySelector('[data-photo-grid]') as HTMLElement).style.gridTemplateColumns).toContain('668px');
        const image = container.querySelector('img')!;
        expect(image.className).toContain('object-contain');
        act(() => image.dispatchEvent(new Event('load')));
        const overlay = container.querySelector('svg')!;
        expect(overlay.getAttribute('viewBox')).toBe('0 0 1200 800');
        const boxes = overlay.querySelectorAll('rect');
        expect(boxes).toHaveLength(1);
        expect(boxes[0].getAttribute('data-face-index')).toBe('1');
        expect(boxes[0].getAttribute('x')).toBe('600');
        expect(boxes[0].getAttribute('width')).toBe('100');
        expect(boxes[0].getAttribute('height')).toBe('150');
        act(() => container.querySelector<HTMLButtonElement>('[data-photo-index]')!.click());
        expect(onPhotoClick).toHaveBeenCalledWith(0);
    });
    it('keeps normal thumbnail sizing for larger result sets without face selection', async () => {
        const photos = Array.from({length: 9}, (_, i) => ({...photo, hash: String(i)}));
        await act(async () => root.render(<PhotoGrid
            dayGroups={[{date: '2026-10-01', photos}]} photos={photos} thumbScale={160}
            getThumbUrl={async () => 'thumb.jpg'} onPhotoClick={vi.fn()}
        />));
        expect((container.querySelector('[data-photo-grid]') as HTMLElement).style.gridTemplateColumns).toContain('160px');
        expect(container.querySelector('img')!.className).toContain('object-cover');
        expect(container.querySelector('svg')).toBeNull();
    });
});
