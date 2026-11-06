import {useCallback, useState} from 'react';
import type {AnalysisSettings, DisplaySettings, FotosSettings, StorageSettings} from '../types/fotos.js';
import {
    DEFAULT_SETTINGS_STORAGE_KEY,
    loadFotosSettings,
    saveFotosSettings,
    type SettingsStorage,
} from '../lib/settings.js';

export interface UseFotosSettingsOptions {
    storage?: SettingsStorage | null;
    storageKey?: string;
}

export function useFotosSettings(options: UseFotosSettingsOptions = {}) {
    const storage = options.storage ?? globalThis.localStorage;
    const storageKey = options.storageKey ?? DEFAULT_SETTINGS_STORAGE_KEY;
    const [settings, setSettingsState] = useState<FotosSettings>(() => loadFotosSettings(storage, storageKey));

    const persist = useCallback((next: FotosSettings) => {
        saveFotosSettings(next, storage, storageKey);
        return next;
    }, [storage, storageKey]);

    const updateStorage = useCallback((updates: Partial<StorageSettings>) => {
        setSettingsState((prev: FotosSettings) => persist({
            ...prev,
            storage: {...prev.storage, ...updates},
        }));
    }, [persist]);

    const updateDisplay = useCallback((updates: Partial<DisplaySettings>) => {
        setSettingsState((prev: FotosSettings) => persist({
            ...prev,
            display: {...prev.display, ...updates},
        }));
    }, [persist]);

    const updateDeviceName = useCallback((name: string) => {
        setSettingsState((prev: FotosSettings) => persist({
            ...prev,
            device: {...prev.device, name},
        }));
    }, [persist]);

    const updateAnalysis = useCallback((updates: Partial<AnalysisSettings>) => {
        setSettingsState((prev: FotosSettings) => persist({
            ...prev,
            analysis: {...prev.analysis, ...updates},
        }));
    }, [persist]);

    return {settings, updateStorage, updateDisplay, updateDeviceName, updateAnalysis};
}
