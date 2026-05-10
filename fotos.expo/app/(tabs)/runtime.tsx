import { ScrollView, Text, View, useColorScheme } from 'react-native';
import { useDevices } from '../../ios-ui/hooks/useDevices';
import { fotosFoundationPhases, fotosPlannedRuns } from '../../src/runtime-foundation';
import { useFotosRuntime } from '../../src/hooks/use-fotos-runtime';
import {
  borderColor,
  cardBackground,
  mutedTextColor,
  palette,
  screenBackground,
  textColor,
} from '../../src/theme';

function StatusRow({
  label,
  value,
  tone,
  isDark,
}: {
  label: string;
  value: string;
  tone?: 'good' | 'warn' | 'info';
  isDark: boolean;
}) {
  const color = tone === 'good'
    ? palette.accentStrong
    : tone === 'warn'
      ? palette.warning
      : tone === 'info'
        ? palette.info
        : textColor(isDark);

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
      <Text selectable style={{ color, fontSize: 13, textAlign: 'right', flexShrink: 1 }}>
        {value}
      </Text>
    </View>
  );
}

export default function RuntimeScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const { snapshot } = useFotosRuntime();
  const { isScanning, isCollectionActive, discoveredDevices, collectedPeers } = useDevices();

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
        }}
      >
        <Text style={{ color: textColor(isDark), fontSize: 17, fontWeight: '700' }}>
          ONE Runtime
        </Text>
        <View style={{ marginTop: 10 }}>
          <StatusRow
            label="Instance"
            value={snapshot.instanceId ?? 'not available'}
            tone={snapshot.instanceId ? 'good' : undefined}
            isDark={isDark}
          />
          <StatusRow
            label="Owner"
            value={snapshot.ownerId ?? 'not available'}
            tone={snapshot.ownerId ? 'good' : undefined}
            isDark={isDark}
          />
          <StatusRow
            label="Publication identity"
            value={snapshot.publicationIdentity ?? 'not configured'}
            tone={snapshot.publicationIdentity ? 'info' : 'warn'}
            isDark={isDark}
          />
          <StatusRow
            label="mDNS discovery"
            value={snapshot.discoveryRunning || isScanning ? 'running' : 'idle'}
            tone={snapshot.discoveryRunning || isScanning ? 'good' : 'warn'}
            isDark={isDark}
          />
          <StatusRow
            label="Discovery collection"
            value={snapshot.discoveryCollectionActive || isCollectionActive ? 'active' : 'idle'}
            tone={snapshot.discoveryCollectionActive || isCollectionActive ? 'good' : 'warn'}
            isDark={isDark}
          />
          <StatusRow
            label="Peer surface"
            value={`${discoveredDevices.length} discovered / ${collectedPeers.length} verified`}
            tone="info"
            isDark={isDark}
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
          gap: 10,
        }}
      >
        <Text style={{ color: textColor(isDark), fontSize: 17, fontWeight: '700' }}>
          Bootstrap phases
        </Text>
        {fotosFoundationPhases.map((phase) => (
          <View
            key={phase.key}
            style={{
              borderRadius: 16,
              borderWidth: 1,
              borderColor: borderColor(isDark),
              padding: 14,
              gap: 6,
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
              <Text style={{ color: textColor(isDark), fontSize: 15, fontWeight: '700', flex: 1 }}>
                {phase.title}
              </Text>
              <View
                style={{
                  borderRadius: 999,
                  backgroundColor: phase.status === 'wired' ? palette.accentSoft : '#f5ead6',
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                }}
              >
                <Text
                  style={{
                    color: phase.status === 'wired' ? palette.accentStrong : palette.warning,
                    fontSize: 12,
                    fontWeight: '700',
                  }}
                >
                  {phase.status}
                </Text>
              </View>
            </View>
            <Text style={{ color: mutedTextColor(isDark), fontSize: 14, lineHeight: 20 }}>
              {phase.summary}
            </Text>
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
          gap: 10,
        }}
      >
        <Text style={{ color: textColor(isDark), fontSize: 17, fontWeight: '700' }}>
          Planned fotos runs
        </Text>
        {fotosPlannedRuns.map((run) => (
          <View
            key={run.key}
            style={{
              borderRadius: 16,
              borderWidth: 1,
              borderColor: borderColor(isDark),
              padding: 14,
              gap: 6,
            }}
          >
            <Text style={{ color: textColor(isDark), fontSize: 15, fontWeight: '700' }}>
              {run.title}
            </Text>
            <Text style={{ color: mutedTextColor(isDark), fontSize: 14, lineHeight: 20 }}>
              {run.summary}
            </Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
