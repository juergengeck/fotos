import { useCallback, useEffect, useState } from 'react';
import { useModel } from '../../ios-ui';
import {
  DEFAULT_FOTOS_SECTION_VALUES,
  FOTOS_SETTINGS_MODULE_ID,
  normalizeFotosSettingsSection,
  type FotosSettingsSectionValues,
} from '../../ios-ui/fotos-settings';
import { readDiscoveryEnabledFromSettings } from '../../ios-ui/services/discovery-settings';

export interface FotosRuntimeSnapshot {
  ownerId: string | null;
  instanceId: string | null;
  publicationIdentity: string | null;
  discoveryEnabled: boolean;
  discoveryRunning: boolean;
  discoveryCollectionActive: boolean;
  trustedDeviceCount: number;
  fotosSettings: FotosSettingsSectionValues;
  glueSection: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

export function useFotosRuntime() {
  const model = useModel();
  const [snapshot, setSnapshot] = useState<FotosRuntimeSnapshot>({
    ownerId: model.ownerId ?? null,
    instanceId: model.instanceId ?? null,
    publicationIdentity: null,
    discoveryEnabled: false,
    discoveryRunning: Boolean(model.discoveryService?.isRunning?.()),
    discoveryCollectionActive: model.discoveryCollection?.isActive?.() ?? false,
    trustedDeviceCount: 0,
    fotosSettings: DEFAULT_FOTOS_SECTION_VALUES,
    glueSection: {},
  });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!model.settingsPlan) {
      setLoading(false);
      return;
    }

    try {
      const [fotosSection, deviceSection, glueSection, trustedDevices] = await Promise.all([
        model.settingsPlan.getSection({ moduleId: FOTOS_SETTINGS_MODULE_ID }).catch(() => ({ values: {} })),
        model.settingsPlan.getSection({ moduleId: 'device' }).catch(() => ({ values: {} })),
        model.settingsPlan.getSection({ moduleId: 'glue' }).catch(() => ({ values: {} })),
        model.devicesPlan?.listDevices?.().catch(() => [] as Array<unknown>) ?? Promise.resolve([] as Array<unknown>),
      ]);

      const glueValues = asRecord(glueSection.values);
      const publicationIdentity =
        typeof glueValues.publicationIdentity === 'string'
          ? glueValues.publicationIdentity
          : typeof glueValues.identity === 'string'
            ? glueValues.identity
            : null;

      setSnapshot({
        ownerId: model.ownerId ?? null,
        instanceId: model.instanceId ?? null,
        publicationIdentity,
        discoveryEnabled: readDiscoveryEnabledFromSettings({ device: asRecord(deviceSection.values) } as never),
        discoveryRunning: Boolean(model.discoveryService?.isRunning?.()),
        discoveryCollectionActive: model.discoveryCollection?.isActive?.() ?? false,
        trustedDeviceCount: Array.isArray(trustedDevices) ? trustedDevices.length : 0,
        fotosSettings: normalizeFotosSettingsSection(
          fotosSection.values as Partial<FotosSettingsSectionValues> | undefined,
        ),
        glueSection: glueValues,
      });
    } finally {
      setLoading(false);
    }
  }, [model]);

  useEffect(() => {
    void refresh();

    const unsubscribe = model.settingsPlan?.subscribe((allSettings: Record<string, unknown>) => {
      const glueSection = asRecord(allSettings.glue);
      setSnapshot((current) => ({
        ...current,
        ownerId: model.ownerId ?? null,
        instanceId: model.instanceId ?? null,
        publicationIdentity:
          typeof glueSection.publicationIdentity === 'string'
            ? glueSection.publicationIdentity
            : typeof glueSection.identity === 'string'
              ? glueSection.identity
              : current.publicationIdentity,
        discoveryEnabled: readDiscoveryEnabledFromSettings(allSettings as never),
        discoveryRunning: Boolean(model.discoveryService?.isRunning?.()),
        discoveryCollectionActive: model.discoveryCollection?.isActive?.() ?? false,
        fotosSettings: normalizeFotosSettingsSection(
          asRecord(allSettings[FOTOS_SETTINGS_MODULE_ID]) as Partial<FotosSettingsSectionValues>,
        ),
        glueSection,
      }));
    });

    return () => {
      unsubscribe?.();
    };
  }, [model, refresh]);

  const updateFotosSettings = useCallback(
    async (values: Partial<FotosSettingsSectionValues>) => {
      if (!model.settingsPlan) {
        return;
      }

      await model.settingsPlan.updateSection({
        moduleId: FOTOS_SETTINGS_MODULE_ID,
        values,
      });
      await refresh();
    },
    [model.settingsPlan, refresh],
  );

  return {
    loading,
    snapshot,
    refresh,
    updateFotosSettings,
  };
}
