import type { ManagedDevicePlatform, ManagedDeviceSetup, ManagedDeviceSummary } from '@refinio/ui.core/types/devices';
import type { InstanceEntry } from '../hooks/useInstances';

export interface IomDeviceListItem {
  id: string;
  deviceId?: string;
  name: string;
  platform: ManagedDevicePlatform | string;
  isCurrentDevice: boolean;
  status: 'online' | 'syncing' | 'offline' | 'unknown';
  lastSeenAt?: number;
  instanceIds: string[];
  transports: string[];
  iomStatus?: 'approval-required' | 'approved';
  setup: ManagedDeviceSetup[];
  canRename: boolean;
  canForget: boolean;
}

function resolveStatus(
  device: ManagedDeviceSummary,
  matchedInstances: InstanceEntry[],
): IomDeviceListItem['status'] {
  if (device.isCurrentDevice) return 'online';
  if (matchedInstances.some((entry) => entry.status === 'syncing')) return 'syncing';
  if (matchedInstances.some((entry) => entry.status === 'online') || device.connectionState === 'connected') {
    return 'online';
  }
  if (matchedInstances.some((entry) => entry.status === 'offline') || device.connectionState === 'disconnected') {
    return 'offline';
  }
  return 'unknown';
}

/**
 * Combine persistent registered IoM devices from DevicesPlan with live IoM
 * instances from InstanceRegistryPlan. Always puts the current device first.
 */
export function buildIomDeviceList(
  registeredDevices: ManagedDeviceSummary[],
  myInstances: InstanceEntry[],
  localInstance: InstanceEntry | null,
): IomDeviceListItem[] {
  const allInstances = [...myInstances];
  if (localInstance && !allInstances.some((entry) => entry.instanceId === localInstance.instanceId)) {
    allInstances.unshift(localInstance);
  }

  const matchedInstanceIds = new Set<string>();
  const items: IomDeviceListItem[] = registeredDevices.map((device) => {
    const knownIds = new Set(device.instanceIds ?? []);
    const matched = allInstances.filter((entry) =>
      knownIds.has(entry.instanceId) || (device.isCurrentDevice && entry.isLocal),
    );
    for (const entry of matched) matchedInstanceIds.add(entry.instanceId);

    const transports = [
      ...new Set([
        ...(device.transports ?? []),
        ...matched.flatMap((entry) => entry.capabilities ?? []),
      ]),
    ];
    const lastSeenCandidates = [
      device.lastSeenAt,
      ...matched.map((entry) => entry.lastSeen),
    ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);

    const platform = device.platform !== 'unknown'
      ? device.platform
      : (matched.find((entry) => entry.platform !== 'unknown')?.platform ?? 'unknown');

    return {
      id: device.deviceId,
      deviceId: device.deviceId,
      name: device.name,
      platform,
      isCurrentDevice: device.isCurrentDevice,
      status: resolveStatus(device, matched),
      lastSeenAt: lastSeenCandidates.length > 0 ? Math.max(...lastSeenCandidates) : undefined,
      instanceIds: [...new Set([...(device.instanceIds ?? []), ...matched.map((entry) => entry.instanceId)])],
      transports,
      iomStatus: device.iomStatus,
      setup: device.setup ?? [],
      canRename: true,
      canForget: !device.isCurrentDevice,
    };
  });

  // Include live IoM instances that are not yet backed by a registered Device record.
  for (const entry of allInstances) {
    if (matchedInstanceIds.has(entry.instanceId)) continue;
    items.push({
      id: `instance:${entry.instanceId}`,
      name: entry.name,
      platform: entry.platform,
      isCurrentDevice: entry.isLocal,
      status: entry.isLocal ? 'online' : entry.status,
      lastSeenAt: entry.lastSeen > 0 ? entry.lastSeen : undefined,
      instanceIds: [entry.instanceId],
      transports: [...new Set(entry.capabilities ?? [])],
      setup: [],
      canRename: false,
      canForget: false,
    });
  }

  return items.sort((left, right) => {
    if (left.isCurrentDevice !== right.isCurrentDevice) {
      return left.isCurrentDevice ? -1 : 1;
    }
    const leftOnline = left.status === 'online' || left.status === 'syncing' ? 0 : 1;
    const rightOnline = right.status === 'online' || right.status === 'syncing' ? 0 : 1;
    if (leftOnline !== rightOnline) {
      return leftOnline - rightOnline;
    }
    const leftSeen = left.lastSeenAt ?? 0;
    const rightSeen = right.lastSeenAt ?? 0;
    if (leftSeen !== rightSeen) {
      return rightSeen - leftSeen;
    }
    return left.name.localeCompare(right.name);
  });
}

/**
 * Own device is expanded by default; all other IoM devices start collapsed.
 * User toggles take precedence per device id.
 */
export function isIomDeviceExpanded(
  device: Pick<IomDeviceListItem, 'id' | 'isCurrentDevice'>,
  expandedOverrides: Readonly<Record<string, boolean>>,
): boolean {
  const override = expandedOverrides[device.id];
  return override !== undefined ? override : device.isCurrentDevice;
}

export function toggleIomDeviceExpanded(
  device: Pick<IomDeviceListItem, 'id' | 'isCurrentDevice'>,
  expandedOverrides: Readonly<Record<string, boolean>>,
): Record<string, boolean> {
  return {
    ...expandedOverrides,
    [device.id]: !isIomDeviceExpanded(device, expandedOverrides),
  };
}
