// @vitest-environment jsdom

import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ConfirmModal} from './ConfirmModal.js';

describe('ConfirmModal', () => {
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

    it('focuses the safe action, traps focus, closes on Escape, and restores focus', () => {
        const invokingButton = document.createElement('button');
        document.body.append(invokingButton);
        invokingButton.focus();
        const onCancel = vi.fn();

        act(() => {
            root.render(
                <ConfirmModal
                    open
                    title="Delete photo"
                    message="The original file will be deleted."
                    confirmLabel="Delete photo"
                    isDestructive
                    onConfirm={vi.fn()}
                    onCancel={onCancel}
                />,
            );
        });

        const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
        const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button'));
        expect(dialog?.getAttribute('aria-modal')).toBe('true');
        expect(document.activeElement).toBe(buttons[0]);

        buttons[1].focus();
        buttons[1].dispatchEvent(new KeyboardEvent('keydown', {key: 'Tab', bubbles: true}));
        expect(document.activeElement).toBe(buttons[0]);

        window.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
        expect(onCancel).toHaveBeenCalledOnce();

        act(() => {
            root.render(null);
        });
        expect(document.activeElement).toBe(invokingButton);
        invokingButton.remove();
    });
});
