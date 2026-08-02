// @vitest-environment jsdom

import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {AppHeader} from './AppHeader.js';

describe('AppHeader', () => {
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

    it('keeps primary navigation, scoped search, identity, and status accessible', () => {
        const onModeChange = vi.fn();
        act(() => root.render(<AppHeader
            folderName="Summer"
            mode="images"
            query="rose"
            resultCount={3}
            totalCount={12}
            identityReady
            backgroundStatus="Analyzing faces · 2/12"
            facetsOpen={false}
            onModeChange={onModeChange}
            onQueryChange={vi.fn()}
            onToggleFacets={vi.fn()}
            onOpenSharing={vi.fn()}
            onOpenSettings={vi.fn()}
        />));

        expect(container.querySelector<HTMLInputElement>('input[type="search"]')?.getAttribute('aria-label')).toBe('Search photos');
        expect(container.textContent).toContain('3/12');
        expect(container.textContent).toContain('Sync ready');
        expect(container.querySelector('[role="status"]')?.textContent).toContain('2/12');
        const people = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'People');
        act(() => people?.click());
        expect(onModeChange).toHaveBeenCalledWith('clusters');
    });
});
