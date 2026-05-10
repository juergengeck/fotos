import { useMemo } from 'react';
import { Pressable, ScrollView, Switch, Text, View, useColorScheme } from 'react-native';
import { useDevices } from '../../ios-ui/hooks/useDevices';
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
import {
  getGallerySurfaceProfile,
  planGalleryIntake,
} from '@refinio/fotos.core';

function Row({ label, value, isDark }: { label: string; value: string; isDark: boolean }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 16,
        paddingVertical: 10,
      }}
    >
      <Text style={{ color: mutedTextColor(isDark), fontSize: 13, fontWeight: '600' }}>
        {label}
      </Text>
      <Text
        selectable
        style={{
          color: textColor(isDark),
          fontSize: 13,
          flexShrink: 1,
          textAlign: 'right',
        }}
      >
        {value}
      </Text>
    </View>
  );
}

export default function LibraryScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const { snapshot, updateFotosSettings } = useFotosRuntime();
  const { discoveredDevices, collectedPeers } = useDevices();

  const intakeCards = useMemo(() => ([
    planGalleryIntake('fotos-browser-mobile', 'photo-library'),
    planGalleryIntake('fotos-browser-mobile', 'shared-files'),
    planGalleryIntake('lama-fire', 'remote-manifest'),
  ]), []);
  const profile = getGallerySurfaceProfile('fotos-browser-mobile');

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: screenBackground(isDark) }}
      contentContainerStyle={{ padding: 16, gap: 16 }}
    >
      <View
        style={{
          backgroundColor: cardBackground(isDark),
          borderRadius: 22,
          borderWidth: 1,
          borderColor: borderColor(isDark),
          padding: 18,
          gap: 10,
        }}
      >
        <Text style={{ color: textColor(isDark), fontSize: 24, fontWeight: '700' }}>
          fotos mobile authority surface
        </Text>
        <Text style={{ color: mutedTextColor(isDark), fontSize: 15, lineHeight: 21 }}>
          This package now boots through the same ONE runtime shape as `vger.expo`: MultiUser,
          recipes, reverse maps, settings/secrets/devices plans, mDNS discovery, handshake-backed
          collection, and the shared module graph. The actual photo-library and CHUM gallery flows
          can land on that base without a rewrite.
        </Text>
      </View>

      <View
        style={{
          backgroundColor: cardBackground(isDark),
          borderRadius: 20,
          borderWidth: 1,
          borderColor: borderColor(isDark),
          padding: 18,
        }}
      >
        <Text style={{ color: textColor(isDark), fontSize: 17, fontWeight: '700' }}>
          Surface Profile
        </Text>
        <Text style={{ marginTop: 6, color: mutedTextColor(isDark), fontSize: 14, lineHeight: 20 }}>
          {profile.summary}
        </Text>
        <View style={{ marginTop: 12 }}>
          <Row label="Primary action" value={profile.primaryActionLabel} isDark={isDark} />
          <Row label="Role" value={profile.role} isDark={isDark} />
          <Row label="Default source" value={profile.defaultSource} isDark={isDark} />
          <Row
            label="Live peers"
            value={`${discoveredDevices.length} discovered / ${collectedPeers.length} verified`}
            isDark={isDark}
          />
          <Row
            label="Trusted devices"
            value={String(snapshot.trustedDeviceCount)}
            isDark={isDark}
          />
        </View>
      </View>

      <View style={{ gap: 12 }}>
        {intakeCards.map((plan) => (
          <View
            key={`${plan.surface}:${plan.source}`}
            style={{
              backgroundColor: cardBackground(isDark),
              borderRadius: 18,
              borderWidth: 1,
              borderColor: borderColor(isDark),
              padding: 16,
              gap: 8,
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
              <Text style={{ color: textColor(isDark), fontSize: 16, fontWeight: '700' }}>
                {plan.source}
              </Text>
              <View
                style={{
                  borderRadius: 999,
                  backgroundColor: plan.supported ? palette.accentSoft : '#f3e7de',
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                }}
              >
                <Text
                  style={{
                    color: plan.supported ? palette.accentStrong : palette.danger,
                    fontSize: 12,
                    fontWeight: '700',
                  }}
                >
                  {plan.supported ? 'supported' : 'pending'}
                </Text>
              </View>
            </View>
            <Text style={{ color: mutedTextColor(isDark), fontSize: 14, lineHeight: 20 }}>
              {plan.summary}
            </Text>
            <Row label="Mode" value={plan.mode ?? 'n/a'} isDark={isDark} />
            <Row label="Face enrichment" value={plan.faceEnrichment} isDark={isDark} />
            <Row
              label="Writes sidecars"
              value={plan.writesSidecars ? 'yes' : 'not on mobile'}
              isDark={isDark}
            />
          </View>
        ))}
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
          Fotos Section
        </Text>

        {[
          {
            label: 'Accept trusted sharing',
            value: snapshot.fotosSettings.acceptSharing,
            key: 'acceptSharing' as const,
          },
          {
            label: 'Face analytics',
            value: snapshot.fotosSettings.faceAnalyticsEnabled,
            key: 'faceAnalyticsEnabled' as const,
          },
          {
            label: 'Semantic search',
            value: snapshot.fotosSettings.semanticSearchEnabled,
            key: 'semanticSearchEnabled' as const,
          },
        ].map((item) => (
          <View
            key={item.key}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              paddingVertical: 4,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: textColor(isDark), fontSize: 15, fontWeight: '600' }}>
                {item.label}
              </Text>
            </View>
            <Switch
              value={item.value}
              onValueChange={(enabled) => void updateFotosSettings({ [item.key]: enabled })}
              trackColor={{ false: '#cfd5cf', true: palette.accent }}
              thumbColor="#ffffff"
            />
          </View>
        ))}

        <View
          style={{
            marginTop: 4,
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          {['reference', 'metadata', 'ingest'].map((mode) => {
            const selected = snapshot.fotosSettings.defaultMode === mode;
            return (
              <Pressable
                key={mode}
                onPress={() => void updateFotosSettings({ defaultMode: mode as never })}
                style={{
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: selected ? palette.accent : borderColor(isDark),
                  backgroundColor: selected ? palette.accentSoft : mutedCardBackground(isDark),
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                }}
              >
                <Text
                  style={{
                    color: selected ? palette.accentStrong : textColor(isDark),
                    fontSize: 13,
                    fontWeight: '700',
                    textTransform: 'capitalize',
                  }}
                >
                  {mode}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </ScrollView>
  );
}
