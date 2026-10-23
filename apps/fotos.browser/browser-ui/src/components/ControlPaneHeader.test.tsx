// @vitest-environment jsdom

import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {BrowseControls, ControlPaneHeader} from './ControlPaneHeader.js';

describe('ControlPaneHeader', () => {
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
        (globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = false;
    });

    it('keeps library, identity, sharing, status, and pane collapse in one surface', () => {
        act(() => root.render(<ControlPaneHeader
            folderName="Summer"
            identityReady
            backgroundStatus="Analyzing faces · 2/12"
            galleryShareCount={2}
            onOpenSharing={vi.fn()}
            onOpenShortcuts={vi.fn()}
            onClose={vi.fn()}
        />));

        expect(container.textContent).toContain('Summer');
        expect(container.textContent).toContain('Sync ready');
        expect(container.querySelector('[role="status"]')?.textContent).toContain('2/12');
        expect(container.querySelector('[aria-label*="gallery shared with 2 people"]')).not.toBeNull();
        expect(container.querySelector('[aria-label="Open keyboard shortcuts"]')).not.toBeNull();
        expect(container.querySelector('[aria-label="Close control pane"]')).not.toBeNull();
    });

    it('keeps primary view and scoped search at the top of Browse', () => {
        const onModeChange = vi.fn();
        act(() => root.render(<BrowseControls
            mode="images"
            query="rose"
            resultCount={3}
            totalCount={12}
            onModeChange={onModeChange}
            onQueryChange={vi.fn()}
        />));

        expect(container.querySelector<HTMLInputElement>('input[type="search"]')?.getAttribute('aria-label')).toBe('Search photos');
        expect(container.textContent).toContain('3/12');
        const people = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'People');
        act(() => people?.click());
        expect(onModeChange).toHaveBeenCalledWith('clusters');
    });
});
