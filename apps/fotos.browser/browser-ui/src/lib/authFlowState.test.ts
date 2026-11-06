import { describe, expect, it } from 'vitest';

import {
    clearPendingAuthenticationContinuation,
    hasPendingAuthenticationContinuation,
    queueAuthenticationContinuation,
    readStoredSidebarTab,
    writeStoredSidebarTab,
} from './authFlowState.js';

class MemoryStorage {
    private readonly values = new Map<string, string>();

    getItem(key: string): string | null {
        return this.values.get(key) ?? null;
    }

    setItem(key: string, value: string): void {
        this.values.set(key, value);
    }

    removeItem(key: string): void {
        this.values.delete(key);
    }
}

describe('authFlowState', () => {
    it('stores and restores a valid sidebar tab', () => {
        const storage = new MemoryStorage();

        writeStoredSidebarTab('settings', storage);

        expect(readStoredSidebarTab(storage)).toBe('settings');
    });

    it('ignores invalid sidebar tab values', () => {
        const storage = new MemoryStorage();
        storage.setItem('fotos.sidebar.tab', 'invalid');

        expect(readStoredSidebarTab(storage)).toBeNull();
    });

    it('queues authentication continuation in settings', () => {
        const storage = new MemoryStorage();

        queueAuthenticationContinuation(storage);

        expect(readStoredSidebarTab(storage)).toBe('settings');
        expect(hasPendingAuthenticationContinuation(storage)).toBe(true);
    });

    it('clears the pending authentication continuation flag', () => {
        const storage = new MemoryStorage();

        queueAuthenticationContinuation(storage);
        clearPendingAuthenticationContinuation(storage);

        expect(hasPendingAuthenticationContinuation(storage)).toBe(false);
        expect(readStoredSidebarTab(storage)).toBe('settings');
    });
});
