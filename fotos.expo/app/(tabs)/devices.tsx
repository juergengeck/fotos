import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';
import {
  ChevronDown,
  ChevronUp,
  Globe,
  Laptop,
  Monitor,
  Plus,
  QrCode,
  Server,
  Smartphone,
  Trash2,
  Tv,
} from 'lucide-react-native';
import type { ManagedDeviceSummary } from '@refinio/ui.core/types/devices';
import { SettingsRegistry } from '@refinio/settings.core';
import { useModel } from '../../ios-ui';
import { useDevices, type TrustLevel } from '../../ios-ui/hooks/useDevices';
import { useInstances } from '../../ios-ui/hooks/useInstances';
import {
  buildIomDeviceList,
  isIomDeviceExpanded,
  toggleIomDeviceExpanded,
  type IomDeviceListItem,
} from '../../ios-ui/services/FotosIomDevicesModel';
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

function DevicePlatformIcon({
  platform,
  color,
  size = 18,
}: {
  platform: string;
  color: string;
  size?: number;
}) {
  const normalized = platform.toLowerCase();
  if (normalized === 'fire' || normalized.includes('tv')) return <Tv size={size} color={color} />;
  if (normalized === 'browser' || normalized === 'html') return <Globe size={size} color={color} />;
  if (normalized === 'headless' || normalized === 'server') return <Server size={size} color={color} />;
  if (normalized === 'desktop' || normalized === 'cube') return <Laptop size={size} color={color} />;
  if (normalized === 'ios' || normalized === 'expo' || normalized === 'mobile' || normalized.includes('android')) {
    return <Smartphone size={size} color={color} />;
  }
  return <Monitor size={size} color={color} />;
}

function formatPlatformLabel(platform: string): string {
  switch (platform.toLowerCase()) {
    case 'ios':
      return 'iOS';
    case 'expo':
    case 'mobile':
      return 'Mobile';
    case 'browser':
    case 'html':
      return 'Browser';
    case 'desktop':
    case 'cube':
      return 'Desktop';
    case 'fire':
      return 'Fire TV';
    case 'headless':
      return 'Server';
    case 'unknown':
    case '':
      return 'Device';
    default:
      return platform;
  }
}

function formatLastSeen(timestamp: number | undefined): string | null {
  if (timestamp === undefined) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatSharingSummary(device: IomDeviceListItem): string | null {
  if (device.setup.length === 0) return null;
  const parts: string[] = [];
  for (const setup of device.setup) {
    if (setup.status === 'rejected') {
      parts.push(`${setup.moduleId}: not applied`);
      continue;
    }
    if (setup.moduleId === 'iom') {
      const enabled = [
        setup.values.shareDiscoveredDevices === true ? 'devices' : null,
        setup.values.shareAiPersonas === true ? 'personas' : null,
        setup.values.shareChats === true ? 'chats' : null,
      ].filter(Boolean);
      parts.push(enabled.length > 0 ? `Sharing ${enabled.join(', ')}` : 'IoM sharing off');
      continue;
    }
    const section = SettingsRegistry.getSection(setup.moduleId);
    if (section) parts.push(section.name);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
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
          textAlign: 'right',
          flexShrink: 1,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function StatusBadge({
  device,
  isDark,
}: {
  device: IomDeviceListItem;
  isDark: boolean;
}) {
  if (device.isCurrentDevice) {
    return (
      <View style={[styles.pill, { backgroundColor: palette.accentSoft }]}>
        <Text style={{ color: palette.accentStrong, fontSize: 11, fontWeight: '700' }}>
          This device
        </Text>
      </View>
    );
  }
  if (device.iomStatus === 'approval-required') {
    return (
      <View style={[styles.pill, { backgroundColor: '#f5ead6' }]}>
        <Text style={{ color: palette.warning, fontSize: 11, fontWeight: '700' }}>
          Approval needed
        </Text>
      </View>
    );
  }
  if (device.status === 'online' || device.status === 'syncing') {
    return (
      <View style={[styles.pill, { backgroundColor: palette.accentSoft }]}>
        <Text style={{ color: palette.accentStrong, fontSize: 11, fontWeight: '700' }}>
          {device.status === 'syncing' ? 'Syncing' : 'Online'}
        </Text>
      </View>
    );
  }
  if (device.status === 'offline') {
    return (
      <View style={[styles.pill, { backgroundColor: mutedCardBackground(isDark) }]}>
        <Text style={{ color: mutedTextColor(isDark), fontSize: 11, fontWeight: '600' }}>
          Offline
        </Text>
      </View>
    );
  }
  return null;
}

export default function DevicesScreen() {
  const isDark = useColorScheme() === 'dark';
  const model = useModel();
  const { snapshot } = useFotosRuntime();
  const supportsPairing = snapshot.platformCapabilities.supportsPeerPairing;
  const {
    discoveredDevices,
    isScanning,
    startDiscovery,
    pairWithDevice,
    ignoreDevice,
  } = useDevices();
  const {
    localInstance,
    myInstances,
    isLoading: instancesLoading,
    refresh: refreshInstances,
  } = useInstances();

  const [registeredDevices, setRegisteredDevices] = useState<ManagedDeviceSummary[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(Boolean(model.devicesPlan));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [expandedOverrides, setExpandedOverrides] = useState<Record<string, boolean>>({});
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [invitationUrl, setInvitationUrl] = useState('');
  const generationRef = useRef(0);

  const loadDevices = useCallback(async () => {
    const devicesPlan = model.devicesPlan;
    if (!devicesPlan) {
      setRegisteredDevices([]);
      setDevicesLoading(false);
      return;
    }
    const generation = ++generationRef.current;
    setDevicesLoading(true);
    try {
      const next = await devicesPlan.listDevices();
      if (generation === generationRef.current) {
        setRegisteredDevices(next);
        setError(null);
      }
    } catch (cause) {
      if (generation === generationRef.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (generation === generationRef.current) {
        setDevicesLoading(false);
      }
    }
  }, [model.devicesPlan]);

  useEffect(() => {
    const devicesPlan = model.devicesPlan;
    if (!devicesPlan) {
      setRegisteredDevices([]);
      setDevicesLoading(false);
      return;
    }
    const dispose = devicesPlan.subscribe?.(() => {
      void loadDevices();
    });
    void loadDevices();
    return () => {
      generationRef.current += 1;
      dispose?.();
    };
  }, [model.devicesPlan, loadDevices]);

  const iomDevices = useMemo(
    () => buildIomDeviceList(registeredDevices, myInstances, localInstance),
    [registeredDevices, myInstances, localInstance],
  );

  const handleRefresh = useCallback(async () => {
    const tasks: Array<Promise<unknown>> = [loadDevices(), refreshInstances()];
    if (snapshot.discoveryEnabled && snapshot.platformCapabilities.supportsLocalNetworkDiscovery) {
      tasks.push(startDiscovery());
    }
    await Promise.allSettled(tasks);
  }, [
    loadDevices,
    refreshInstances,
    snapshot.discoveryEnabled,
    snapshot.platformCapabilities.supportsLocalNetworkDiscovery,
    startDiscovery,
  ]);

  const runAction = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await Promise.allSettled([loadDevices(), refreshInstances()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const handleAddDevice = () => {
    const connectionPlan = model.connectionPlan;
    if (!connectionPlan) return;
    void runAction(async () => {
      const result = await connectionPlan.createPairingInvitation({ mode: 'IoM' });
      if (!result.success || !result.invitation?.url) {
        throw new Error(result.error || 'Could not create device invitation');
      }
      await Share.share({ message: result.invitation.url });
    });
  };

  const handlePairInvitation = () => {
    const connectionPlan = model.connectionPlan;
    const trimmed = invitationUrl.trim();
    if (!connectionPlan?.acceptPairingInvitation || !trimmed) return;
    void runAction(async () => {
      const result = await connectionPlan.acceptPairingInvitation!({ invitationUrl: trimmed });
      if (!result.success) {
        throw new Error(result.error || 'Device pairing failed');
      }
      setInvitationUrl('');
      setShowInviteForm(false);
    });
  };

  const handleSaveRename = (deviceId: string) => {
    const trimmed = draftName.trim();
    if (!model.devicesPlan || !trimmed) return;
    void runAction(async () => {
      await model.devicesPlan!.renameDevice({ deviceId: deviceId as any, displayName: trimmed });
      setEditingDeviceId(null);
      setDraftName('');
    });
  };

  const handleConnectDevice = (device: IomDeviceListItem) => {
    if (!model.devicesPlan?.connectDevice || !device.deviceId) return;
    const instanceId = device.instanceIds[0];
    if (!instanceId) return;
    void runAction(async () => {
      await model.devicesPlan!.connectDevice!({ deviceId: device.deviceId!, instanceId });
    });
  };

  const handleApproveSync = (device: IomDeviceListItem) => {
    if (!model.devicesPlan?.confirmDevice || !device.deviceId) return;
    void runAction(async () => {
      await model.devicesPlan!.confirmDevice!({ deviceId: device.deviceId! });
    });
  };

  const handleForgetDevice = (device: IomDeviceListItem) => {
    if (!model.devicesPlan || !device.deviceId) return;
    Alert.alert(
      `Forget ${device.name}?`,
      'Removes this device from your list. It does not revoke access, erase data, or sign it out.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Forget',
          style: 'destructive',
          onPress: () => {
            void runAction(async () => {
              await model.devicesPlan!.removeDevice({ deviceId: device.deviceId as any });
            });
          },
        },
      ],
    );
  };

  const presentTrustSelection = (deviceId: string, deviceName: string) => {
    const trustLevels: TrustLevel[] = ['me', 'trusted', 'low', 'unknown'];
    const options = ['My device (IoM)', 'Trusted', 'Low trust', 'Unknown'];

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: `Pair with ${deviceName}`,
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

    Alert.alert(`Pair with ${deviceName}`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      ...options.map((label, index) => ({
        text: label,
        onPress: () => void pairWithDevice(deviceId, trustLevels[index]),
      })),
    ]);
  };

  const isLoading = devicesLoading || instancesLoading;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: screenBackground(isDark) }}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={isScanning || isLoading}
          onRefresh={() => void handleRefresh()}
        />
      }
    >
      {error ? (
        <View
          style={[
            styles.card,
            { backgroundColor: cardBackground(isDark), borderColor: palette.danger },
          ]}
        >
          <Text accessibilityRole="alert" style={{ color: palette.danger, fontSize: 13, lineHeight: 18 }}>
            {error}
          </Text>
        </View>
      ) : null}

      {isLoading && iomDevices.length === 0 ? (
        <View style={styles.loadingState}>
          <ActivityIndicator color={palette.accent} />
          <Text style={{ color: mutedTextColor(isDark), fontSize: 14 }}>Loading your devices…</Text>
        </View>
      ) : iomDevices.length === 0 ? (
        <View
          style={[
            styles.card,
            { backgroundColor: cardBackground(isDark), borderColor: borderColor(isDark) },
          ]}
        >
          <Text style={{ color: textColor(isDark), fontSize: 16, fontWeight: '700' }}>
            No devices yet
          </Text>
          <Text style={{ color: mutedTextColor(isDark), fontSize: 14, lineHeight: 20 }}>
            Add another device to sync your photo library directly across your Internet of Me.
          </Text>
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          {iomDevices.map((device) => {
            const expanded = isIomDeviceExpanded(device, expandedOverrides);
            const isEditing = editingDeviceId === device.id;
            const lastSeen = formatLastSeen(device.lastSeenAt);
            const sharingSummary = formatSharingSummary(device);
            const subtitle = [
              formatPlatformLabel(device.platform),
              !device.isCurrentDevice && lastSeen ? `Seen ${lastSeen}` : null,
            ].filter(Boolean).join(' · ');

            return (
              <View
                key={device.id}
                testID={`iom-device-${device.id}`}
                style={[
                  styles.deviceCard,
                  {
                    backgroundColor: cardBackground(isDark),
                    borderColor: device.isCurrentDevice ? palette.accent : borderColor(isDark),
                  },
                ]}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  onPress={() => {
                    if (isEditing) return;
                    setExpandedOverrides((current) => toggleIomDeviceExpanded(device, current));
                  }}
                  style={styles.deviceHeader}
                >
                  <View style={[styles.deviceIcon, { backgroundColor: mutedCardBackground(isDark) }]}>
                    <DevicePlatformIcon platform={device.platform} color={palette.accent} />
                  </View>

                  <View style={{ flex: 1, gap: 3 }}>
                    <View style={styles.titleRow}>
                      <Text
                        numberOfLines={1}
                        style={{ color: textColor(isDark), fontSize: 16, fontWeight: '700', flexShrink: 1 }}
                      >
                        {device.name}
                      </Text>
                      <StatusBadge device={device} isDark={isDark} />
                    </View>
                    <Text numberOfLines={1} style={{ color: mutedTextColor(isDark), fontSize: 13 }}>
                      {subtitle}
                    </Text>
                  </View>

                  {expanded ? (
                    <ChevronUp size={18} color={mutedTextColor(isDark)} />
                  ) : (
                    <ChevronDown size={18} color={mutedTextColor(isDark)} />
                  )}
                </Pressable>

                {expanded ? (
                  <View style={[styles.deviceBody, { borderTopColor: borderColor(isDark) }]}>
                    <View style={[styles.detailBox, { backgroundColor: mutedCardBackground(isDark) }]}>
                      <DetailRow
                        label="Status"
                        value={
                          device.isCurrentDevice
                            ? 'Active on this device'
                            : device.status === 'syncing'
                              ? 'Syncing'
                              : device.status === 'online'
                                ? 'Connected'
                                : device.status === 'offline'
                                  ? 'Disconnected'
                                  : 'Registered'
                        }
                        isDark={isDark}
                      />
                      <DetailRow
                        label="Platform"
                        value={formatPlatformLabel(device.platform)}
                        isDark={isDark}
                      />
                      {lastSeen ? (
                        <DetailRow label="Last seen" value={lastSeen} isDark={isDark} />
                      ) : null}
                      {device.transports.length > 0 ? (
                        <DetailRow
                          label="Transports"
                          value={device.transports.join(', ')}
                          isDark={isDark}
                        />
                      ) : null}
                      {sharingSummary ? (
                        <DetailRow label="Sharing" value={sharingSummary} isDark={isDark} />
                      ) : null}
                    </View>

                    {!device.isCurrentDevice && device.iomStatus === 'approved' ? (
                      <Text style={{ color: mutedTextColor(isDark), fontSize: 13 }}>
                        Sync approved on this device.
                      </Text>
                    ) : null}

                    {isEditing && device.deviceId ? (
                      <View style={{ gap: 8 }}>
                        <TextInput
                          value={draftName}
                          onChangeText={setDraftName}
                          placeholder="Device name"
                          placeholderTextColor={mutedTextColor(isDark)}
                          maxLength={120}
                          autoFocus
                          returnKeyType="done"
                          onSubmitEditing={() => handleSaveRename(device.deviceId!)}
                          style={[
                            styles.input,
                            {
                              backgroundColor: mutedCardBackground(isDark),
                              borderColor: borderColor(isDark),
                              color: textColor(isDark),
                            },
                          ]}
                        />
                        <View style={styles.inlineActions}>
                          <Pressable
                            accessibilityRole="button"
                            disabled={busy || !draftName.trim()}
                            onPress={() => handleSaveRename(device.deviceId!)}
                            style={[
                              styles.smallButton,
                              {
                                backgroundColor: palette.accent,
                                opacity: busy || !draftName.trim() ? 0.55 : 1,
                              },
                            ]}
                          >
                            <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '700' }}>
                              Save
                            </Text>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            onPress={() => {
                              setEditingDeviceId(null);
                              setDraftName('');
                            }}
                            style={[
                              styles.smallButton,
                              {
                                backgroundColor: mutedCardBackground(isDark),
                                borderWidth: 1,
                                borderColor: borderColor(isDark),
                              },
                            ]}
                          >
                            <Text style={{ color: textColor(isDark), fontSize: 13, fontWeight: '600' }}>
                              Cancel
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    ) : (
                      <View style={styles.inlineActions}>
                        {!device.isCurrentDevice
                          && device.status !== 'online'
                          && device.status !== 'syncing'
                          && device.deviceId
                          && device.instanceIds.length > 0
                          && model.devicesPlan?.connectDevice ? (
                            <Pressable
                              accessibilityRole="button"
                              disabled={busy}
                              onPress={() => handleConnectDevice(device)}
                              style={[
                                styles.smallButton,
                                { backgroundColor: palette.accent, opacity: busy ? 0.6 : 1 },
                              ]}
                            >
                              <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '700' }}>
                                Connect
                              </Text>
                            </Pressable>
                          ) : null}

                        {!device.isCurrentDevice
                          && device.iomStatus === 'approval-required'
                          && device.deviceId
                          && model.devicesPlan?.confirmDevice ? (
                            <Pressable
                              accessibilityRole="button"
                              disabled={busy}
                              onPress={() => handleApproveSync(device)}
                              style={[
                                styles.smallButton,
                                { backgroundColor: palette.accent, opacity: busy ? 0.6 : 1 },
                              ]}
                            >
                              <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '700' }}>
                                Allow sync
                              </Text>
                            </Pressable>
                          ) : null}

                        {device.canRename && device.deviceId ? (
                          <Pressable
                            accessibilityRole="button"
                            disabled={busy}
                            onPress={() => {
                              setEditingDeviceId(device.id);
                              setDraftName(device.name);
                            }}
                            style={[
                              styles.smallButton,
                              {
                                backgroundColor: mutedCardBackground(isDark),
                                borderWidth: 1,
                                borderColor: borderColor(isDark),
                              },
                            ]}
                          >
                            <Text style={{ color: textColor(isDark), fontSize: 13, fontWeight: '600' }}>
                              Rename
                            </Text>
                          </Pressable>
                        ) : null}

                        {device.canForget && device.deviceId ? (
                          <Pressable
                            accessibilityRole="button"
                            disabled={busy}
                            onPress={() => handleForgetDevice(device)}
                            style={[
                              styles.smallButton,
                              {
                                backgroundColor: mutedCardBackground(isDark),
                                borderWidth: 1,
                                borderColor: borderColor(isDark),
                                flexDirection: 'row',
                                gap: 5,
                              },
                            ]}
                          >
                            <Trash2 size={13} color={palette.danger} />
                            <Text style={{ color: palette.danger, fontSize: 13, fontWeight: '600' }}>
                              Forget
                            </Text>
                          </Pressable>
                        ) : null}
                      </View>
                    )}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      )}

      {model.connectionPlan ? (
        <View style={{ gap: 10 }}>
          <View style={styles.actionRow}>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={handleAddDevice}
              style={[
                styles.primaryButton,
                { backgroundColor: palette.accent, opacity: busy ? 0.6 : 1 },
              ]}
            >
              <Plus size={16} color="#ffffff" />
              <Text style={{ color: '#ffffff', fontSize: 15, fontWeight: '700' }}>
                Add device
              </Text>
            </Pressable>

            {model.connectionPlan.acceptPairingInvitation ? (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => setShowInviteForm((current) => !current)}
                style={[
                  styles.secondaryButton,
                  {
                    backgroundColor: cardBackground(isDark),
                    borderColor: borderColor(isDark),
                  },
                ]}
              >
                <QrCode size={16} color={textColor(isDark)} />
                <Text style={{ color: textColor(isDark), fontSize: 15, fontWeight: '600' }}>
                  {showInviteForm ? 'Close' : 'Pair invite'}
                </Text>
              </Pressable>
            ) : null}
          </View>

          {showInviteForm && model.connectionPlan.acceptPairingInvitation ? (
            <View
              style={[
                styles.card,
                { backgroundColor: cardBackground(isDark), borderColor: borderColor(isDark) },
              ]}
            >
              <Text style={{ color: mutedTextColor(isDark), fontSize: 13, fontWeight: '600' }}>
                Paste invitation link from your other device
              </Text>
              <TextInput
                accessibilityLabel="Invitation from your other device"
                placeholder="https://fotos.one/..."
                placeholderTextColor={mutedTextColor(isDark)}
                value={invitationUrl}
                onChangeText={setInvitationUrl}
                autoCapitalize="none"
                autoCorrect={false}
                style={[
                  styles.input,
                  {
                    backgroundColor: mutedCardBackground(isDark),
                    borderColor: borderColor(isDark),
                    color: textColor(isDark),
                  },
                ]}
              />
              <Pressable
                accessibilityRole="button"
                disabled={busy || !invitationUrl.trim()}
                onPress={handlePairInvitation}
                style={[
                  styles.primaryButton,
                  {
                    backgroundColor: palette.accent,
                    opacity: busy || !invitationUrl.trim() ? 0.5 : 1,
                  },
                ]}
              >
                <Text style={{ color: '#ffffff', fontSize: 15, fontWeight: '700' }}>
                  {busy ? 'Pairing…' : 'Pair this device'}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}

      {discoveredDevices.length > 0 ? (
        <View style={{ gap: 10 }}>
          <Text style={[styles.sectionHeader, { color: mutedTextColor(isDark) }]}>
            NEARBY ({discoveredDevices.length})
          </Text>
          {discoveredDevices.map((device) => (
            <View
              key={device.deviceId}
              style={[
                styles.card,
                { backgroundColor: cardBackground(isDark), borderColor: borderColor(isDark) },
              ]}
            >
              <View style={{ gap: 2 }}>
                <Text style={{ color: textColor(isDark), fontSize: 15, fontWeight: '700' }}>
                  {device.name}
                </Text>
                <Text style={{ color: mutedTextColor(isDark), fontSize: 13 }}>
                  {device.address}:{device.port}
                </Text>
              </View>
              <View style={styles.inlineActions}>
                <Pressable
                  accessibilityRole="button"
                  disabled={!supportsPairing}
                  onPress={() => presentTrustSelection(device.deviceId, device.name)}
                  style={[
                    styles.smallButton,
                    {
                      backgroundColor: palette.accentSoft,
                      opacity: supportsPairing ? 1 : 0.55,
                    },
                  ]}
                >
                  <Text style={{ color: palette.accentStrong, fontSize: 13, fontWeight: '700' }}>
                    Pair
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void ignoreDevice(device.deviceId)}
                  style={[
                    styles.smallButton,
                    {
                      backgroundColor: mutedCardBackground(isDark),
                      borderWidth: 1,
                      borderColor: borderColor(isDark),
                    },
                  ]}
                >
                  <Text style={{ color: textColor(isDark), fontSize: 13, fontWeight: '600' }}>
                    Ignore
                  </Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 16,
    gap: 16,
    paddingBottom: 28,
  },
  loadingState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    gap: 10,
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  deviceCard: {
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
  },
  deviceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  deviceIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  pill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  deviceBody: {
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 16,
    paddingTop: 14,
    gap: 12,
  },
  detailBox: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 6,
  },
  inlineActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  smallButton: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  primaryButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 14,
  },
  secondaryButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 14,
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    paddingHorizontal: 4,
  },
});
