// @vitest-environment jsdom

import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {KeyboardShortcutsDialog} from './KeyboardShortcutsDialog.js';

describe('KeyboardShortcutsDialog', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        (globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            callback(0);
            return 1;
        });
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        (globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = false;
        vi.unstubAllGlobals();
    });

    it('documents the keyboard model and restores focus after Escape', () => {
        const invoker = document.createElement('button');
        document.body.append(invoker);
        invoker.focus();
        const onClose = vi.fn();

        act(() => root.render(<KeyboardShortcutsDialog open onClose={onClose} />));

        const dialog = container.querySelector('[role="dialog"]');
        expect(dialog?.getAttribute('aria-modal')).toBe('true');
        expect(container.textContent).toContain('Shift + F10');
        expect(container.textContent).toContain('Delete');
        expect(document.activeElement).toBe(container.querySelector('[aria-label="Close keyboard shortcuts"]'));

        window.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
        expect(onClose).toHaveBeenCalledOnce();

        act(() => root.render(null));
        expect(document.activeElement).toBe(invoker);
        invoker.remove();
    });
});
