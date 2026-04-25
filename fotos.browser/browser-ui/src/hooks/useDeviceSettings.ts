import { useCallback, useEffect, useState } from 'react';
import {
    DEFAULT_DEVICE_SETTINGS,
    type DeviceSettings,
} from '@refinio/settings.core';
import type { FotosModel } from '@/lib/onecore-boot';

export const DEVICE_SETTINGS_MODULE_ID = 'device';

export type FotosDeviceSettings = DeviceSettings;

export function useDeviceSettings(model: FotosModel | null) {
    const [deviceSettings, setDeviceSettings] = useState<FotosDeviceSettings>({
        ...DEFAULT_DEVICE_SETTINGS,
        discoveryIdentity: DEFAULT_DEVICE_SETTINGS.discoveryIdentity
            ? { ...DEFAULT_DEVICE_SETTINGS.discoveryIdentity }
            : undefined,
    });

    useEffect(() => {
        if (!model?.settingsPlan) {
            return;
        }

        let cancelled = false;

        const applySection = (values: Partial<FotosDeviceSettings> | undefined) => {
            if (cancelled) {
                return;
            }
            setDeviceSettings({
                ...DEFAULT_DEVICE_SETTINGS,
                ...(values ?? {}),
            });
        };

        void model.settingsPlan.getSection({ moduleId: DEVICE_SETTINGS_MODULE_ID })
            .then(({ values }) => applySection(values as Partial<FotosDeviceSettings>))
            .catch((error: unknown) => {
                console.warn('[fotos.devices] Failed to load device settings:', error);
            });

        const unsubscribe = model.settingsPlan.subscribe((allSettings: Record<string, unknown>) => {
            applySection(allSettings[DEVICE_SETTINGS_MODULE_ID] as Partial<FotosDeviceSettings> | undefined);
        });

        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, [model?.settingsPlan]);

    const updateDeviceSettings = useCallback((updates: Partial<FotosDeviceSettings>) => {
        setDeviceSettings(prev => {
            const next = { ...prev, ...updates };

            if (model?.settingsPlan) {
                void model.settingsPlan.updateSection({
                    moduleId: DEVICE_SETTINGS_MODULE_ID,
                    values: updates,
                }).catch((error: unknown) => {
                    console.warn('[fotos.devices] Failed to persist device settings:', error);
                });
            }

            return next;
        });
    }, [model?.settingsPlan]);

    return {
        deviceSettings,
        updateDeviceSettings,
    };
}
