import type { AllSettings, SectionValues, SettingsPlan } from '@refinio/settings.core';

export interface DiscoverySettingsContext {
  settingsPlan?: SettingsPlan | null;
}

export interface DiscoveryCollectionSettings {
  autoTrustKnownPersonDevices: boolean;
  profileVisibility: 'minimal' | 'full';
}

function requireSettingsPlan(context: DiscoverySettingsContext): SettingsPlan {
  if (!context.settingsPlan) {
    throw new Error('SettingsPlan not initialized for discovery settings');
  }
  return context.settingsPlan;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} missing or invalid`);
  }
  return value as Record<string, unknown>;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} missing or invalid`);
  }
  return value;
}

function requireProfileVisibility(value: unknown): 'minimal' | 'full' {
  if (value !== 'minimal' && value !== 'full') {
    throw new Error('Device profileVisibility setting missing or invalid');
  }
  return value;
}

export function readDiscoveryEnabledFromSettings(settings: AllSettings): boolean {
  const device = requireRecord(settings.device, 'Device settings');
  return requireBoolean(device.discoveryEnabled, 'Device discoveryEnabled setting');
}

export function readDiscoveryCollectionSettingsFromSection(
  values: SectionValues,
): DiscoveryCollectionSettings {
  const device = requireRecord(values, 'Device settings');
  return {
    autoTrustKnownPersonDevices: requireBoolean(
      device.autoTrustKnownPersonDevices,
      'Device autoTrustKnownPersonDevices setting',
    ),
    profileVisibility: requireProfileVisibility(device.profileVisibility),
  };
}

export function readDiscoveryCollectionSettingsFromSettings(
  settings: AllSettings,
): DiscoveryCollectionSettings {
  const device = requireRecord(settings.device, 'Device settings');
  return readDiscoveryCollectionSettingsFromSection(device);
}

export async function getPersistedDiscoveryEnabled(
  context: DiscoverySettingsContext,
): Promise<boolean> {
  const response = await requireSettingsPlan(context).getSection({ moduleId: 'device' });
  return requireBoolean(response.values.discoveryEnabled, 'Device discoveryEnabled setting');
}

export async function getDiscoveryCollectionSettings(
  context: DiscoverySettingsContext,
): Promise<DiscoveryCollectionSettings> {
  const response = await requireSettingsPlan(context).getSection({ moduleId: 'device' });
  return readDiscoveryCollectionSettingsFromSection(response.values);
}

export async function setPersistedDiscoveryEnabled(
  context: DiscoverySettingsContext,
  enabled: boolean,
): Promise<void> {
  await requireSettingsPlan(context).updateSection({
    moduleId: 'device',
    values: {
      discoveryEnabled: enabled,
    },
  });
}
