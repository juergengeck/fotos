import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, TextInput, View, useColorScheme } from 'react-native';
import { useModel } from '../../ios-ui';
import { useAuth } from '../../ios-ui/hooks/useAuth';
import { useFotosRuntime } from '../../src/hooks/use-fotos-runtime';
import {
  borderColor,
  cardBackground,
  mutedCardBackground,
  mutedTextColor,
  palette,
  screenBackground,
  textColor,
} from '../../src/theme';

export default function SettingsScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const model = useModel();
  const { logout, isLoading: authLoading } = useAuth();
  const { snapshot } = useFotosRuntime();
  const [displayName, setDisplayName] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadDisplayName() {
      try {
        const section = await model.settingsPlan?.getSection({ moduleId: 'device' });
        const nextName = typeof section?.values?.displayName === 'string'
          ? section.values.displayName
          : '';
        if (!cancelled) {
          setDisplayName(nextName);
        }
      } catch {
        if (!cancelled) {
          setDisplayName('');
        }
      }
    }

    void loadDisplayName();
    return () => {
      cancelled = true;
    };
  }, [model.settingsPlan]);

  const updateDiscovery = async (enabled: boolean) => {
    await model.settingsPlan?.updateSection({
      moduleId: 'device',
      values: { discoveryEnabled: enabled },
    });
  };

  const updateDisplayName = async () => {
    await model.settingsPlan?.updateSection({
      moduleId: 'device',
      values: { displayName },
    });
  };

  const handleLogout = () => {
    Alert.alert('Log out', 'Shut down the local ONE runtime and return to the sign-in screen?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: () => void logout(),
      },
    ]);
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: screenBackground(isDark) }}
      contentContainerStyle={{ padding: 16, gap: 16 }}
    >
      <View
        style={{
          backgroundColor: cardBackground(isDark),
          borderRadius: 20,
          borderWidth: 1,
          borderColor: borderColor(isDark),
          padding: 18,
          gap: 12,
        }}
      >
        <Text style={{ color: textColor(isDark), fontSize: 17, fontWeight: '700' }}>
          Identity
        </Text>
        <Text selectable style={{ color: mutedTextColor(isDark), fontSize: 14, lineHeight: 20 }}>
          Owner: {snapshot.ownerId ?? 'not available'}
        </Text>
        <Text selectable style={{ color: mutedTextColor(isDark), fontSize: 14, lineHeight: 20 }}>
          Publication: {snapshot.publicationIdentity ?? 'not configured'}
        </Text>
      </View>

      <View
        style={{
          backgroundColor: cardBackground(isDark),
          borderRadius: 20,
          borderWidth: 1,
          borderColor: borderColor(isDark),
          padding: 18,
          gap: 14,
        }}
      >
        <Text style={{ color: textColor(isDark), fontSize: 17, fontWeight: '700' }}>
          Device
        </Text>

        <View style={{ gap: 8 }}>
          <Text style={{ color: mutedTextColor(isDark), fontSize: 13, fontWeight: '600' }}>
            Display name
          </Text>
          <TextInput
            value={displayName}
            onChangeText={setDisplayName}
            onEndEditing={() => void updateDisplayName()}
            style={{
              borderRadius: 14,
              borderWidth: 1,
              borderColor: borderColor(isDark),
              backgroundColor: mutedCardBackground(isDark),
              color: textColor(isDark),
              paddingHorizontal: 14,
              paddingVertical: 12,
              fontSize: 15,
            }}
          />
        </View>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: textColor(isDark), fontSize: 15, fontWeight: '600' }}>
              Local network discovery
            </Text>
            <Text style={{ color: mutedTextColor(isDark), fontSize: 13, marginTop: 4 }}>
              Drives the mDNS/Bonjour side of peer discovery for QUICVC and CHUM handoff.
            </Text>
          </View>
          <Switch
            value={snapshot.discoveryEnabled}
            onValueChange={(enabled) => void updateDiscovery(enabled)}
            trackColor={{ false: '#cfd5cf', true: palette.accent }}
            thumbColor="#ffffff"
          />
        </View>
      </View>

      <View
        style={{
          backgroundColor: cardBackground(isDark),
          borderRadius: 20,
          borderWidth: 1,
          borderColor: borderColor(isDark),
          padding: 18,
          gap: 12,
        }}
      >
        <Text style={{ color: textColor(isDark), fontSize: 17, fontWeight: '700' }}>
          Glue / Sync
        </Text>
        {Object.entries(snapshot.glueSection).length === 0 ? (
          <Text style={{ color: mutedTextColor(isDark), fontSize: 14, lineHeight: 20 }}>
            Glue settings will appear here once the identity and sync section is configured.
          </Text>
        ) : (
          Object.entries(snapshot.glueSection).map(([key, value]) => (
            <View
              key={key}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                gap: 16,
                paddingVertical: 6,
              }}
            >
              <Text style={{ color: mutedTextColor(isDark), fontSize: 13, fontWeight: '600' }}>
                {key}
              </Text>
              <Text selectable style={{ color: textColor(isDark), fontSize: 13, flexShrink: 1, textAlign: 'right' }}>
                {typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
                  ? String(value)
                  : JSON.stringify(value)}
              </Text>
            </View>
          ))
        )}
      </View>

      <Pressable
        onPress={handleLogout}
        disabled={authLoading}
        style={{
          borderRadius: 18,
          backgroundColor: palette.danger,
          minHeight: 52,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '700' }}>
          {authLoading ? 'Signing out...' : 'Log Out'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}
