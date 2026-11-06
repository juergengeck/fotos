import { useCallback, useEffect, useState } from 'react';
import {
    DEFAULT_SETTINGS_STORAGE_KEY,
    loadFotosSettings,
    saveFotosSettings,
    type AnalysisSettings,
    type DisplaySettings,
    type FotosSettings,
    type StorageSettings,
} from '@refinio/fotos.ui';
import type { FotosModel } from '@/lib/onecore-boot';
import {
    DEFAULT_FOTOS_SECTION_VALUES,
    FOTOS_SETTINGS_MODULE_ID,
    deserializeFotosSettings,
    isFotosSectionAtDefaults,
    resolveAcceptSharingPreference,
    serializeFotosSettings,
    type FotosSettingsSectionValues,
} from '@/lib/fotosSettings';

function persistLocalSettings(settings: FotosSettings, storageKey: string): void {
    saveFotosSettings(settings, globalThis.localStorage, storageKey);
}

export function useSettings(model: FotosModel | null, storageKey = DEFAULT_SETTINGS_STORAGE_KEY) {
    const [settings, setSettingsState] = useState<FotosSettings>(() =>
        loadFotosSettings(globalThis.localStorage, storageKey),
    );
    const [acceptSharing, setAcceptSharingState] = useState<boolean>(
        DEFAULT_FOTOS_SECTION_VALUES.acceptSharing,
    );

    useEffect(() => {
        if (!model?.settingsPlan) {
            return;
        }

        let cancelled = false;

        const applySection = (
            nextSettings: FotosSettings,
            nextAcceptSharing: boolean,
        ) => {
            if (cancelled) {
                return;
            }
            persistLocalSettings(nextSettings, storageKey);
            setSettingsState(nextSettings);
            setAcceptSharingState(nextAcceptSharing);
        };

        const syncSettings = async () => {
            try {
                const { values } = await model.settingsPlan.getSection({
                    moduleId: FOTOS_SETTINGS_MODULE_ID,
                });
                const remoteSettings = deserializeFotosSettings(values);
                const remoteAcceptSharing = resolveAcceptSharingPreference(values);
                const localSettingsRaw = globalThis.localStorage?.getItem(storageKey);

                if (localSettingsRaw && isFotosSectionAtDefaults(values)) {
                    const localSettings = loadFotosSettings(globalThis.localStorage, storageKey);
                    await model.settingsPlan.updateSection({
                        moduleId: FOTOS_SETTINGS_MODULE_ID,
                        values: serializeFotosSettings(localSettings, {
                            acceptSharing: remoteAcceptSharing,
                        }),
                    });
                    applySection(localSettings, remoteAcceptSharing);
                    return;
                }

                applySection(remoteSettings, remoteAcceptSharing);
            } catch (error) {
                console.warn('[fotos.settings] Failed to load settings from SettingsPlan:', error);
            }
        };

        void syncSettings();

        const unsubscribe = model.settingsPlan.subscribe((allSettings: Record<string, unknown>) => {
            const section = (allSettings[FOTOS_SETTINGS_MODULE_ID] as Partial<FotosSettingsSectionValues> | undefined)
                ?? DEFAULT_FOTOS_SECTION_VALUES;
            applySection(
                deserializeFotosSettings(section),
                resolveAcceptSharingPreference(section),
            );
        });

        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, [model?.settingsPlan, storageKey]);

    const persist = useCallback((next: FotosSettings) => {
        persistLocalSettings(next, storageKey);

        if (model?.settingsPlan) {
            void model.settingsPlan.updateSection({
                moduleId: FOTOS_SETTINGS_MODULE_ID,
                values: serializeFotosSettings(next, { acceptSharing }),
            }).catch((error: unknown) => {
                console.warn('[fotos.settings] Failed to persist settings via SettingsPlan:', error);
            });
        }

        return next;
    }, [acceptSharing, model?.settingsPlan, storageKey]);

    const updateStorage = useCallback((updates: Partial<StorageSettings>) => {
        setSettingsState((prev: FotosSettings) => persist({
            ...prev,
            storage: { ...prev.storage, ...updates },
        }));
    }, [persist]);

    const updateDisplay = useCallback((updates: Partial<DisplaySettings>) => {
        setSettingsState((prev: FotosSettings) => persist({
            ...prev,
            display: { ...prev.display, ...updates },
        }));
    }, [persist]);

    const updateDeviceName = useCallback((name: string) => {
        setSettingsState((prev: FotosSettings) => persist({
            ...prev,
            device: { ...prev.device, name },
        }));
    }, [persist]);

    const updateAnalysis = useCallback((updates: Partial<AnalysisSettings>) => {
        setSettingsState((prev: FotosSettings) => persist({
            ...prev,
            analysis: { ...prev.analysis, ...updates },
        }));
    }, [persist]);

    const updateAcceptSharing = useCallback((enabled: boolean) => {
        setAcceptSharingState(enabled);

        if (model?.settingsPlan) {
            void model.settingsPlan.updateSection({
                moduleId: FOTOS_SETTINGS_MODULE_ID,
                values: { acceptSharing: enabled },
            }).catch((error: unknown) => {
                console.warn('[fotos.settings] Failed to persist acceptSharing via SettingsPlan:', error);
            });
        }
    }, [model?.settingsPlan]);

    return {
        settings,
        acceptSharing,
        updateStorage,
        updateDisplay,
        updateDeviceName,
        updateAnalysis,
        updateAcceptSharing,
    };
}
