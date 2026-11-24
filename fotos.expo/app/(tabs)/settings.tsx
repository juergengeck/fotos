import { useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronDown, ChevronRight, ChevronUp } from 'lucide-react-native';
import { FotosDeviceSettingsSection } from '../../ios-ui/components/FotosDeviceSettingsSection';
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

const INTAKE_MODES = [
  {
    key: 'reference' as const,
    label: 'Reference',
    description: 'Keeps originals in Apple Photos and syncs thumbnails and metadata.',
  },
  {
    key: 'metadata' as const,
    label: 'Metadata',
    description: 'Indexes photo metadata and albums without storing copies locally.',
  },
  {
    key: 'ingest' as const,
    label: 'Ingest',
    description: 'Stores full photo copies inside your ONE gallery storage.',
  },
];

function truncateId(value: string | null | undefined, edge = 10): string {
  if (!value) return 'Not configured';
  if (value.length <= edge * 2 + 3) return value;
  return `${value.slice(0, edge)}…${value.slice(-edge)}`;
}

function DetailRow({
  label,
  value,
  isDark,
}: {
  label: string;
  value: string;
  isDark: boolean;
}) {
  return (
    <View style={styles.detailRow}>
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

export default function SettingsScreen() {
  const isDark = useColorScheme() === 'dark';
  const router = useRouter();
  const { logout, isLoading: authLoading } = useAuth();
  const { snapshot, updateFotosSettings } = useFotosRuntime();
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);

  const glueDisplayName =
    typeof snapshot.glueSection.displayName === 'string' && snapshot.glueSection.displayName.trim()
      ? snapshot.glueSection.displayName.trim()
      : null;
  const glueSyncEnabled = snapshot.glueSection.syncEnabled === true;
  const glueEntries = Object.entries(snapshot.glueSection);
  const selectedMode =
    INTAKE_MODES.find((mode) => mode.key === snapshot.fotosSettings.defaultMode) ?? INTAKE_MODES[0];

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

  const dividerStyle = { backgroundColor: borderColor(isDark) };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: screenBackground(isDark) }}
      contentContainerStyle={styles.content}
    >
      {/* Account & Identity */}
      <View
        style={[
          styles.card,
          { backgroundColor: cardBackground(isDark), borderColor: borderColor(isDark) },
        ]}
      >
        <View style={styles.headerRow}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[styles.sectionTitle, { color: textColor(isDark) }]}>
              {glueDisplayName ?? 'Identity'}
            </Text>
            <Text style={{ color: mutedTextColor(isDark), fontSize: 13 }}>
              {glueDisplayName ? 'ONE & glue.one identity' : 'Local ONE identity'}
            </Text>
          </View>
          <View
            style={[
              styles.pill,
              { backgroundColor: glueSyncEnabled ? palette.accentSoft : mutedCardBackground(isDark) },
            ]}
          >
            <Text
              style={{
                color: glueSyncEnabled ? palette.accentStrong : mutedTextColor(isDark),
                fontSize: 12,
                fontWeight: '700',
              }}
            >
              {glueSyncEnabled ? 'Sync on' : 'Local only'}
            </Text>
          </View>
        </View>

        <View style={[styles.detailBox, { backgroundColor: mutedCardBackground(isDark) }]}>
          <DetailRow label="Owner ID" value={truncateId(snapshot.ownerId)} isDark={isDark} />
          <DetailRow label="Publication" value={truncateId(snapshot.publicationIdentity)} isDark={isDark} />
        </View>

        {glueEntries.length > 0 ? (
          <View style={{ gap: 8 }}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setShowTechnicalDetails((open) => !open)}
              style={styles.disclosureRow}
            >
              <Text style={{ color: mutedTextColor(isDark), fontSize: 13, fontWeight: '600' }}>
                Glue sync details ({glueEntries.length})
              </Text>
              {showTechnicalDetails ? (
                <ChevronUp size={16} color={mutedTextColor(isDark)} />
              ) : (
                <ChevronDown size={16} color={mutedTextColor(isDark)} />
              )}
            </Pressable>

            {showTechnicalDetails ? (
              <View style={[styles.detailBox, { backgroundColor: mutedCardBackground(isDark) }]}>
                {glueEntries.map(([key, value]) => (
                  <DetailRow
                    key={key}
                    label={key}
                    value={
                      typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
                        ? String(value)
                        : JSON.stringify(value)
                    }
                    isDark={isDark}
                  />
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      {/* Library & Sharing */}
      <View
        style={[
          styles.card,
          { backgroundColor: cardBackground(isDark), borderColor: borderColor(isDark) },
        ]}
      >
        <Text style={[styles.sectionTitle, { color: textColor(isDark) }]}>
          Library &amp; Sharing
        </Text>

        {[
          {
            key: 'acceptSharing' as const,
            label: 'Accept trusted sharing',
            description: 'Allow trusted peers to share photo collections with this device.',
            value: snapshot.fotosSettings.acceptSharing,
          },
          {
            key: 'faceAnalyticsEnabled' as const,
            label: 'Face analytics',
            description: 'Group photos by people when on-device analysis is available.',
            value: snapshot.fotosSettings.faceAnalyticsEnabled,
          },
          {
            key: 'semanticSearchEnabled' as const,
            label: 'Semantic search',
            description: 'Index photos for meaning-based search on this device.',
            value: snapshot.fotosSettings.semanticSearchEnabled,
          },
        ].map((item, index) => (
          <View key={item.key} style={{ gap: 14 }}>
            {index > 0 ? <View style={[styles.divider, dividerStyle]} /> : null}
            <View style={styles.toggleRow}>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={[styles.toggleTitle, { color: textColor(isDark) }]}>{item.label}</Text>
                <Text style={{ color: mutedTextColor(isDark), fontSize: 13, lineHeight: 18 }}>
                  {item.description}
                </Text>
              </View>
              <Switch
                accessibilityLabel={item.label}
                value={item.value}
                onValueChange={(enabled) => void updateFotosSettings({ [item.key]: enabled })}
                trackColor={{ false: isDark ? '#444a44' : '#cfd5cf', true: palette.accent }}
                thumbColor="#ffffff"
              />
            </View>
          </View>
        ))}

        <View style={[styles.divider, dividerStyle]} />

        <View style={{ gap: 8 }}>
          <Text style={[styles.toggleTitle, { color: textColor(isDark) }]}>Intake mode</Text>
          <View style={styles.segmentedRow}>
            {INTAKE_MODES.map((mode) => {
              const selected = snapshot.fotosSettings.defaultMode === mode.key;
              return (
                <Pressable
                  key={mode.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => void updateFotosSettings({ defaultMode: mode.key })}
                  style={[
                    styles.segmentPill,
                    {
                      borderColor: selected ? palette.accent : borderColor(isDark),
                      backgroundColor: selected ? palette.accentSoft : mutedCardBackground(isDark),
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: selected ? palette.accentStrong : textColor(isDark),
                      fontSize: 13,
                      fontWeight: '700',
                    }}
                  >
                    {mode.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={{ color: mutedTextColor(isDark), fontSize: 13, lineHeight: 18 }}>
            {selectedMode.description}
          </Text>
        </View>

        <View style={[styles.divider, dividerStyle]} />

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/runtime')}
          style={[
            styles.linkRow,
            { backgroundColor: mutedCardBackground(isDark), borderColor: borderColor(isDark) },
          ]}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[styles.toggleTitle, { color: textColor(isDark) }]}>
              Photo library &amp; sync status
            </Text>
            <Text style={{ color: mutedTextColor(isDark), fontSize: 13 }}>
              Import photos, check iCloud queue, and inspect runtime
            </Text>
          </View>
          <ChevronRight size={18} color={mutedTextColor(isDark)} />
        </Pressable>
      </View>

      {/* Device & Sync settings */}
      <FotosDeviceSettingsSection />

      {/* Sign Out */}
      <Pressable
        accessibilityRole="button"
        onPress={handleLogout}
        disabled={authLoading}
        style={[styles.logoutButton, { backgroundColor: palette.danger, opacity: authLoading ? 0.65 : 1 }]}
      >
        <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '700' }}>
          {authLoading ? 'Signing out…' : 'Log Out'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 16,
    gap: 16,
    paddingBottom: 28,
  },
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
  pill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  detailBox: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 2,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 5,
  },
  disclosureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  },
  toggleTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  segmentedRow: {
    flexDirection: 'row',
    gap: 8,
  },
  segmentPill: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  logoutButton: {
    borderRadius: 18,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
