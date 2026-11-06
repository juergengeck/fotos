import {DEFAULT_SETTINGS, type FotosSettings} from '../types/fotos.js';

export interface SettingsStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

export const DEFAULT_SETTINGS_STORAGE_KEY = 'fotos_settings';

export function mergeFotosSettings(saved: Partial<FotosSettings> | null | undefined): FotosSettings {
    return {
        storage: {
            ...DEFAULT_SETTINGS.storage,
            ...(saved?.storage ?? {}),
        },
        device: {
            ...DEFAULT_SETTINGS.device,
            ...(saved?.device ?? {}),
        },
        display: {
            ...DEFAULT_SETTINGS.display,
            ...(saved?.display ?? {}),
        },
        analysis: {
            ...DEFAULT_SETTINGS.analysis,
            ...(saved?.analysis ?? {}),
        },
    };
}

export function loadFotosSettings(
    storage: SettingsStorage | null | undefined = globalThis.localStorage,
    storageKey = DEFAULT_SETTINGS_STORAGE_KEY
): FotosSettings {
    try {
        const raw = storage?.getItem(storageKey);
        if (raw) {
            return mergeFotosSettings(JSON.parse(raw) as Partial<FotosSettings>);
        }
    } catch {
        // Ignore malformed or unavailable local storage.
    }

    return mergeFotosSettings(null);
}

export function saveFotosSettings(
    settings: FotosSettings,
    storage: SettingsStorage | null | undefined = globalThis.localStorage,
    storageKey = DEFAULT_SETTINGS_STORAGE_KEY
): void {
    storage?.setItem(storageKey, JSON.stringify(settings));
}
