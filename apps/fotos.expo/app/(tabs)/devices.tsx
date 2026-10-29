import { type ReactNode, useMemo } from 'react';
import {
  ActionSheetIOS,
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import { useDevices, type TrustLevel } from '../../ios-ui/hooks/useDevices';
import { useInstances } from '../../ios-ui/hooks/useInstances';
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

function truncate(value: string | null | undefined, size = 14): string {
  if (!value) {
    return 'not available';
  }

  if (value.length <= size * 2) {
    return value;
  }

  return `${value.slice(0, size)}...${value.slice(-size)}`;
}

function countTransportMatches(
  items: Array<{ transports?: string[]; capabilities?: string[] }>,
  transport: string,
): number {
  const needle = transport.toLowerCase();

  return items.filter((item) => {
    const values = Array.isArray(item.transports)
      ? item.transports
      : Array.isArray(item.capabilities)
        ? item.capabilities
        : [];
    return values.some((value) => value.toLowerCase() === needle);
  }).length;
}

function SectionCard({
  children,
  isDark,
}: {
  children: ReactNode;
  isDark: boolean;
}) {
  return (
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
      {children}
    </View>
  );
}

function StatRow({
  label,
  value,
  isDark,
}: {
  label: string;
  value: string;
  isDark: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 16,
        paddingVertical: 6,
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
          textAlign: 'right',
          flexShrink: 1,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function EmptyState({
  title,
  detail,
  isDark,
}: {
  title: string;
  detail: string;
  isDark: boolean;
}) {
  return (
    <View
      style={{
        borderRadius: 18,
        borderWidth: 1,
        borderColor: borderColor(isDark),
        backgroundColor: mutedCardBackground(isDark),
        padding: 16,
        gap: 6,
      }}
    >
      <Text style={{ color: textColor(isDark), fontSize: 15, fontWeight: '700' }}>
        {title}
      </Text>
      <Text style={{ color: mutedTextColor(isDark), fontSize: 14, lineHeight: 20 }}>
        {detail}
      </Text>
    </View>
  );
}

export default function DevicesScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const { snapshot } = useFotosRuntime();
  const { platformCapabilities } = snapshot;
  const supportsDiscovery = platformCapabilities.supportsLocalNetworkDiscovery;
  const supportsCollection = platformCapabilities.supportsVerifiedPeerCollection;
  const supportsPairing = platformCapabilities.supportsPeerPairing;
  const {
    discoveredDevices,
    collectedPeers,
    isScanning,
    isCollectionActive,
    startDiscovery,
    stopDiscovery,
    pairWithDevice,
    ignoreDevice,
    setDiscoveryCollectionActive,
  } = useDevices();
  const {
    localInstance,
    myInstances,
    contactInstances,
    isLoading: instancesLoading,
    refresh: refreshInstances,
  } = useInstances();

  const contactInstanceCount = useMemo(
    () => Array.from(contactInstances.values()).reduce((total, entries) => total + entries.length, 0),
    [contactInstances],
  );
  const discoveredQuicvc = useMemo(
    () => countTransportMatches(discoveredDevices, 'quicvc'),
    [discoveredDevices],
  );
  const verifiedQuicvc = useMemo(
    () => countTransportMatches(collectedPeers as Array<{ capabilities?: string[] }>, 'quicvc'),
    [collectedPeers],
  );

  const handleRefresh = async () => {
    if (snapshot.discoveryEnabled) {
      await startDiscovery();
    }
    await refreshInstances();
  };

  const presentTrustSelection = (deviceId: string, deviceName: string) => {
    const trustLevels: TrustLevel[] = ['me', 'trusted', 'low', 'unknown'];
    const options = ['Me', 'Trusted', 'Low trust', 'Unknown'];

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: `Pair with ${deviceName}`,
          message: 'Select how this person should be trusted after the handshake completes.',
          options: ['Cancel', ...options],
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex > 0) {
            void pairWithDevice(deviceId, trustLevels[buttonIndex - 1]);
          }
        },
      );
      return;
    }

    Alert.alert(
      `Pair with ${deviceName}`,
      'Select how this person should be trusted after the handshake completes.',
      [
        { text: 'Cancel', style: 'cancel' },
        ...options.map((label, index) => ({
          text: label,
          onPress: () => void pairWithDevice(deviceId, trustLevels[index]),
        })),
      ],
    );
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: screenBackground(isDark) }}
      contentContainerStyle={{ padding: 16, gap: 16 }}
      refreshControl={
        <RefreshControl
          refreshing={isScanning || instancesLoading}
          onRefresh={() => void handleRefresh()}
        />
      }
    >
      <SectionCard isDark={isDark}>
        <Text style={{ color: textColor(isDark), fontSize: 22, fontWeight: '700' }}>
          Discovery backbone
        </Text>
        <Text style={{ color: mutedTextColor(isDark), fontSize: 14, lineHeight: 20 }}>
          This screen tracks the same spine the user asked us to preserve: local identity through
          `MultiUser`, mDNS reachability, QUICVC transport capability, verified peer collection,
          and the trust surface that decides who can participate in later CHUM exchange.
        </Text>
        <StatRow
          label="mDNS discovery"
          value={
            supportsDiscovery
              ? (snapshot.discoveryEnabled ? (isScanning ? 'running' : 'enabled') : 'disabled')
              : 'gated on this platform'
          }
          isDark={isDark}
        />
        <StatRow
          label="QUICVC peers"
          value={
            supportsPairing
              ? `${discoveredQuicvc} discovered / ${verifiedQuicvc} verified`
              : 'pairing transport not wired yet'
          }
          isDark={isDark}
        />
        <StatRow
          label="Platform"
          value={platformCapabilities.platformLabel}
          isDark={isDark}
        />
        <StatRow
          label="Trusted devices"
          value={String(snapshot.trustedDeviceCount)}
          isDark={isDark}
        />
        <StatRow
          label="Verified peers"
          value={String(collectedPeers.length)}
          isDark={isDark}
        />
      </SectionCard>

      {!supportsDiscovery || !supportsPairing ? (
        <EmptyState
          title={`${platformCapabilities.platformLabel} parity slice`}
          detail="This build boots the shared runtime and identity surface, but local peer discovery and QUICVC pairing stay gated until the Android networking path is finished."
          isDark={isDark}
        />
      ) : null}

      <SectionCard isDark={isDark}>
        <Text style={{ color: textColor(isDark), fontSize: 17, fontWeight: '700' }}>
          User / instance surface
        </Text>
        <StatRow label="Owner" value={truncate(snapshot.ownerId)} isDark={isDark} />
        <StatRow label="Local instance" value={localInstance?.name ?? truncate(snapshot.instanceId)} isDark={isDark} />
        <StatRow label="My instances" value={String(myInstances.length)} isDark={isDark} />
        <StatRow label="Contact instances" value={String(contactInstanceCount)} isDark={isDark} />
        <StatRow
          label="Publication identity"
          value={truncate(snapshot.publicationIdentity)}
          isDark={isDark}
        />
      </SectionCard>

      <SectionCard isDark={isDark}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: textColor(isDark), fontSize: 17, fontWeight: '700' }}>
              Verified peer collection
            </Text>
            <Text style={{ color: mutedTextColor(isDark), fontSize: 13, lineHeight: 19 }}>
              After mDNS finds a peer, collection performs the handshake that lets us attach a
              person identity and graduate that device toward CHUM-eligible sync.
            </Text>
          </View>
          <Switch
            value={supportsCollection ? isCollectionActive : false}
            onValueChange={setDiscoveryCollectionActive}
            disabled={!supportsCollection}
            trackColor={{ false: '#cfd5cf', true: palette.accent }}
            thumbColor="#ffffff"
          />
        </View>

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable
            disabled={!supportsDiscovery}
            onPress={() => void (isScanning ? stopDiscovery() : startDiscovery())}
            style={{
              flex: 1,
              minHeight: 46,
              borderRadius: 16,
              backgroundColor: palette.accent,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 14,
              opacity: supportsDiscovery ? 1 : 0.55,
            }}
          >
            <Text style={{ color: '#ffffff', fontSize: 14, fontWeight: '700' }}>
              {supportsDiscovery ? (isScanning ? 'Stop discovery' : 'Start discovery') : 'Discovery pending'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => void handleRefresh()}
            style={{
              flex: 1,
              minHeight: 46,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: borderColor(isDark),
              backgroundColor: mutedCardBackground(isDark),
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 14,
            }}
          >
            <Text style={{ color: textColor(isDark), fontSize: 14, fontWeight: '700' }}>
              Refresh state
            </Text>
          </Pressable>
        </View>
      </SectionCard>

      <SectionCard isDark={isDark}>
        <Text style={{ color: textColor(isDark), fontSize: 17, fontWeight: '700' }}>
          Discovered devices
        </Text>
        {discoveredDevices.length === 0 ? (
          <EmptyState
            title="Nothing discovered yet"
            detail={
              supportsDiscovery
                ? 'Once local discovery is enabled, peers announced over mDNS will appear here with their transport claims and pairing actions.'
                : 'Discovery remains gated on this platform in the current Android slice, so peers will not appear here yet.'
            }
            isDark={isDark}
          />
        ) : (
          discoveredDevices.map((device) => (
            <View
              key={device.deviceId}
              style={{
                borderRadius: 18,
                borderWidth: 1,
                borderColor: borderColor(isDark),
                backgroundColor: mutedCardBackground(isDark),
                padding: 16,
                gap: 10,
              }}
            >
              <View style={{ gap: 4 }}>
                <Text style={{ color: textColor(isDark), fontSize: 16, fontWeight: '700' }}>
                  {device.name}
                </Text>
                <Text selectable style={{ color: mutedTextColor(isDark), fontSize: 13 }}>
                  {device.address}:{device.port}
                </Text>
              </View>
              <StatRow label="Device" value={truncate(device.deviceId)} isDark={isDark} />
              <StatRow label="PubKey" value={truncate(device.pubKey)} isDark={isDark} />
              <StatRow
                label="Transports"
                value={device.transports.length > 0 ? device.transports.join(', ') : 'none advertised'}
                isDark={isDark}
              />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Pressable
                  disabled={!supportsPairing}
                  onPress={() => presentTrustSelection(device.deviceId, device.name)}
                  style={{
                    flex: 1,
                    minHeight: 42,
                    borderRadius: 14,
                    backgroundColor: palette.accentSoft,
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: 12,
                    opacity: supportsPairing ? 1 : 0.55,
                  }}
                >
                  <Text style={{ color: palette.accentStrong, fontSize: 14, fontWeight: '700' }}>
                    {supportsPairing ? 'Pair' : 'Pairing pending'}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => void ignoreDevice(device.deviceId)}
                  style={{
                    flex: 1,
                    minHeight: 42,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: borderColor(isDark),
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: 12,
                  }}
                >
                  <Text style={{ color: textColor(isDark), fontSize: 14, fontWeight: '700' }}>
                    Ignore
                  </Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
      </SectionCard>

      <SectionCard isDark={isDark}>
        <Text style={{ color: textColor(isDark), fontSize: 17, fontWeight: '700' }}>
          Verified peers
        </Text>
        {collectedPeers.length === 0 ? (
          <EmptyState
            title="No verified peers yet"
            detail={
              supportsCollection
                ? 'Paired devices will move here after the handshake yields a known or provisional person identity.'
                : 'Verified peer collection is still gated on this platform while the Android handshake transport is being wired.'
            }
            isDark={isDark}
          />
        ) : (
          collectedPeers.map((peer) => (
            <View
              key={peer.id}
              style={{
                borderRadius: 18,
                borderWidth: 1,
                borderColor: borderColor(isDark),
                backgroundColor: mutedCardBackground(isDark),
                padding: 16,
                gap: 10,
              }}
            >
              <Text style={{ color: textColor(isDark), fontSize: 16, fontWeight: '700' }}>
                {peer.name || peer.email || truncate(peer.personId) || 'Verified peer'}
              </Text>
              <StatRow label="Peer" value={truncate(peer.id)} isDark={isDark} />
              <StatRow label="Person" value={truncate(peer.personId)} isDark={isDark} />
              <StatRow label="Email" value={peer.email ?? 'not available'} isDark={isDark} />
              <StatRow
                label="Transports"
                value={peer.capabilities?.length ? peer.capabilities.join(', ') : 'not reported'}
                isDark={isDark}
              />
            </View>
          ))
        )}
      </SectionCard>
    </ScrollView>
  );
}
