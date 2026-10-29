import {describe, expect, it} from 'vitest';
import {
    DEFAULT_SETTINGS_STORAGE_KEY,
    loadFotosSettings,
    mergeFotosSettings,
    saveFotosSettings,
    type SettingsStorage,
} from './settings.js';

class MemoryStorage implements SettingsStorage {
    private readonly values = new Map<string, string>();

    getItem(key: string): string | null {
        return this.values.get(key) ?? null;
    }

    setItem(key: string, value: string): void {
        this.values.set(key, value);
    }
}

describe('mergeFotosSettings', () => {
    it('merges nested settings without dropping defaults', () => {
        expect(mergeFotosSettings({
            storage: {
                quotaMb: 512,
            },
            display: {
                thumbScale: 240,
            },
        })).toMatchObject({
            storage: {
                defaultMode: 'metadata',
                quotaMb: 512,
            },
            device: {
                name: 'browser',
            },
            display: {
                gridSize: 'small',
                thumbScale: 240,
            },
        });
    });
});

describe('settings storage helpers', () => {
    it('round-trips settings through storage', () => {
        const storage = new MemoryStorage();
        const settings = mergeFotosSettings({
            device: {name: 'server'},
            display: {sortOrder: 'asc'},
        });

        saveFotosSettings(settings, storage);

        expect(loadFotosSettings(storage)).toEqual(settings);
        expect(storage.getItem(DEFAULT_SETTINGS_STORAGE_KEY)).not.toBeNull();
    });
});
