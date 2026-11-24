import { describe, expect, it } from 'vitest';
import type { ManagedDeviceSummary } from '@refinio/ui.core/types/devices';
import type { InstanceEntry } from '../hooks/useInstances';
import {
  buildIomDeviceList,
  isIomDeviceExpanded,
  toggleIomDeviceExpanded,
} from './FotosIomDevicesModel';

function makeDevice(overrides: Partial<ManagedDeviceSummary> & { deviceId: string; name: string }): ManagedDeviceSummary {
  return {
    platform: 'mobile',
    isCurrentDevice: false,
    ...overrides,
  };
}

function makeInstance(overrides: Partial<Omit<InstanceEntry, 'instanceId'>> & { instanceId: string; name: string }): InstanceEntry {
  return {
    personId: 'person-1' as any,
    platform: 'ios',
    trustLevel: 'me',
    status: 'online',
    lastSeen: 1000,
    capabilities: ['quicvc'],
    isLocal: false,
    ...overrides,
    instanceId: overrides.instanceId as any,
  };
}

describe('FotosIomDevicesModel', () => {
  it('orders current device first, then online devices, and defaults only own device to expanded', () => {
    const devices = buildIomDeviceList(
      [
        makeDevice({ deviceId: 'dev-mac', name: 'MacBook', platform: 'desktop', lastSeenAt: 2000, connectionState: 'disconnected' }),
        makeDevice({ deviceId: 'dev-phone', name: 'iPhone', platform: 'mobile', isCurrentDevice: true, instanceIds: ['inst-phone'] }),
        makeDevice({ deviceId: 'dev-tv', name: 'Fire TV', platform: 'fire', instanceIds: ['inst-tv'], lastSeenAt: 1500 }),
      ],
      [
        makeInstance({ instanceId: 'inst-phone', name: 'iPhone', isLocal: true, status: 'online' }),
        makeInstance({ instanceId: 'inst-tv', name: 'Fire TV', platform: 'unknown', status: 'online', lastSeen: 3000 }),
      ],
      null,
    );

    expect(devices.map((d) => d.id)).toEqual(['dev-phone', 'dev-tv', 'dev-mac']);
    expect(devices[0].status).toBe('online');
    expect(devices[1].status).toBe('online');
    expect(devices[1].lastSeenAt).toBe(3000);
    expect(devices[2].status).toBe('offline');

    const overrides: Record<string, boolean> = {};
    expect(isIomDeviceExpanded(devices[0], overrides)).toBe(true);
    expect(isIomDeviceExpanded(devices[1], overrides)).toBe(false);
    expect(isIomDeviceExpanded(devices[2], overrides)).toBe(false);

    const toggled = toggleIomDeviceExpanded(devices[1], toggleIomDeviceExpanded(devices[0], overrides));
    expect(isIomDeviceExpanded(devices[0], toggled)).toBe(false);
    expect(isIomDeviceExpanded(devices[1], toggled)).toBe(true);
    expect(isIomDeviceExpanded(devices[2], toggled)).toBe(false);
  });

  it('includes live IoM instances not yet registered in DevicesPlan', () => {
    const devices = buildIomDeviceList(
      [],
      [
        makeInstance({ instanceId: 'inst-browser', name: 'fotos.one web', platform: 'browser', status: 'online', lastSeen: 5000 }),
      ],
      makeInstance({ instanceId: 'inst-local', name: 'This iPhone', platform: 'ios', isLocal: true, status: 'online', lastSeen: 4000 }),
    );

    expect(devices.map((d) => d.name)).toEqual(['This iPhone', 'fotos.one web']);
    expect(isIomDeviceExpanded(devices[0], {})).toBe(true);
    expect(isIomDeviceExpanded(devices[1], {})).toBe(false);
  });
});
