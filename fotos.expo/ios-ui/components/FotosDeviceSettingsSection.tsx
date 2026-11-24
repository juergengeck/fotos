import { useEffect, useState } from 'react';
import {
  StyleSheet,
  Switch,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import { useModel } from '..';
import { useFotosRuntime } from '../../src/hooks/use-fotos-runtime';
import {
  borderColor,
  cardBackground,
  mutedCardBackground,
  mutedTextColor,
  palette,
  textColor,
} from '../../src/theme';

interface ConnectionInfoSyncState {
  syncIomConnectionInfo: boolean;
  syncAllConnectionInfo: boolean;
}

function readConnectionInfoSync(values: Record<string, unknown>): ConnectionInfoSyncState | null {
  if (
    typeof values.syncIomConnectionInfo !== 'boolean'
    || typeof values.syncAllConnectionInfo !== 'boolean'
  ) {
    return null;
  }
  return {
    syncIomConnectionInfo: values.syncIomConnectionInfo,
    syncAllConnectionInfo: values.syncAllConnectionInfo,
  };
}

function SettingToggleRow({
  title,
  description,
  value,
  disabled,
  onValueChange,
  isDark,
}: {
  title: string;
  description: string;
  value: boolean;
  disabled?: boolean;
  onValueChange: (enabled: boolean) => void;
  isDark: boolean;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleCopy}>
        <Text style={[styles.toggleTitle, { color: textColor(isDark) }]}>{title}</Text>
        <Text style={[styles.toggleDescription, { color: mutedTextColor(isDark) }]}>{description}</Text>
      </View>
      <Switch
        accessibilityLabel={title}
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
        trackColor={{ false: isDark ? '#444a44' : '#cfd5cf', true: palette.accent }}
        thumbColor="#ffffff"
      />
    </View>
  );
}

export function FotosDeviceSettingsSection() {
  const isDark = useColorScheme() === 'dark';
  const model = useModel();
  const { snapshot } = useFotosRuntime();
  const { platformCapabilities } = snapshot;

  const [connectionSync, setConnectionSync] = useState<ConnectionInfoSyncState | null>(null);
  const [savingConnectionSync, setSavingConnectionSync] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const settingsPlan = model.settingsPlan;
    if (!settingsPlan) return;
    let cancelled = false;
    const apply = (values: Record<string, unknown>) => {
      if (!cancelled) {
        setConnectionSync(readConnectionInfoSync(values));
      }
    };
    const unsubscribe = settingsPlan.subscribe?.((all: Record<string, unknown>) => {
      const device = all.device;
      if (device && typeof device === 'object' && !Array.isArray(device)) {
        apply(device as Record<string, unknown>);
      }
    });
    void settingsPlan
      .getSection({ moduleId: 'device' })
      .then((result) => apply((result?.values ?? {}) as Record<string, unknown>))
      .catch(() => {});
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [model.settingsPlan]);

  const updateDiscovery = async (enabled: boolean) => {
    await model.settingsPlan?.updateSection({
      moduleId: 'device',
      values: { discoveryEnabled: enabled },
    });
  };

  const updateConnectionSync = async (key: keyof ConnectionInfoSyncState, enabled: boolean) => {
    if (!model.settingsPlan || savingConnectionSync) return;
    setSavingConnectionSync(true);
    setError(null);
    try {
      const result = await model.settingsPlan.updateSection({
        moduleId: 'device',
        values: { [key]: enabled },
      });
      const next = readConnectionInfoSync((result?.settings?.device ?? {}) as Record<string, unknown>);
      if (next) setConnectionSync(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSavingConnectionSync(false);
    }
  };

  const divider = { backgroundColor: borderColor(isDark) };

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: cardBackground(isDark),
          borderColor: borderColor(isDark),
        },
      ]}
    >
      <View style={styles.headerRow}>
        <Text style={[styles.sectionTitle, { color: textColor(isDark) }]}>
          Device &amp; Sync
        </Text>
        <View style={[styles.badge, { backgroundColor: mutedCardBackground(isDark) }]}>
          <Text style={[styles.badgeText, { color: mutedTextColor(isDark) }]}>
            {platformCapabilities.platformLabel}
          </Text>
        </View>
      </View>

      <SettingToggleRow
        title="Local network discovery"
        description={
          platformCapabilities.supportsLocalNetworkDiscovery
            ? 'Find your nearby devices over mDNS/Bonjour for fast direct sync.'
            : 'Discovery is not yet enabled on this platform.'
        }
        value={platformCapabilities.supportsLocalNetworkDiscovery ? snapshot.discoveryEnabled : false}
        disabled={!platformCapabilities.supportsLocalNetworkDiscovery}
        onValueChange={(enabled) => void updateDiscovery(enabled)}
        isDark={isDark}
      />

      {connectionSync ? (
        <>
          <View style={[styles.divider, divider]} />
          <SettingToggleRow
            title="Sync own device addresses"
            description="Share connection info for your own devices so they reconnect automatically."
            value={connectionSync.syncIomConnectionInfo}
            disabled={savingConnectionSync}
            onValueChange={(enabled) => void updateConnectionSync('syncIomConnectionInfo', enabled)}
            isDark={isDark}
          />
          <View style={[styles.divider, divider]} />
          <SettingToggleRow
            title="Sync all peer addresses"
            description="Also replicate connection info for trusted contacts across your devices."
            value={connectionSync.syncAllConnectionInfo}
            disabled={savingConnectionSync}
            onValueChange={(enabled) => void updateConnectionSync('syncAllConnectionInfo', enabled)}
            isDark={isDark}
          />
        </>
      ) : null}

      {error ? (
        <Text accessibilityRole="alert" style={{ color: palette.danger, fontSize: 13, lineHeight: 18 }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
    gap: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  },
  toggleCopy: {
    flex: 1,
    gap: 3,
  },
  toggleTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  toggleDescription: {
    fontSize: 13,
    lineHeight: 18,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
});
