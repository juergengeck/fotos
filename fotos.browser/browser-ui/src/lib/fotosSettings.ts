import {
  SettingsRegistry,
  defineField,
  defineSection,
  type SectionValues,
} from '@refinio/settings.core';
import {
  DEFAULT_SETTINGS,
  type FotosSettings,
  type StorageMode,
} from '@refinio/fotos.ui';

export const FOTOS_SETTINGS_MODULE_ID = 'fotos';

export interface FotosSettingsSectionValues extends SectionValues {
  defaultMode: StorageMode;
  blobDir: string;
  thumbDir: string;
  thumbSize: number;
  quotaMb: number;
  minCopies: number;
  deviceName: string;
  gridSize: 'small' | 'large';
  thumbScale: number;
  sortBy: 'date' | 'name' | 'added';
  sortOrder: 'asc' | 'desc';
  clusterSensitivity: number;
}

export const DEFAULT_FOTOS_SECTION_VALUES: FotosSettingsSectionValues = {
  defaultMode: DEFAULT_SETTINGS.storage.defaultMode,
  blobDir: DEFAULT_SETTINGS.storage.blobDir,
  thumbDir: DEFAULT_SETTINGS.storage.thumbDir,
  thumbSize: DEFAULT_SETTINGS.storage.thumbSize,
  quotaMb: DEFAULT_SETTINGS.storage.quotaMb,
  minCopies: DEFAULT_SETTINGS.storage.minCopies,
  deviceName: DEFAULT_SETTINGS.device.name,
  gridSize: DEFAULT_SETTINGS.display.gridSize,
  thumbScale: DEFAULT_SETTINGS.display.thumbScale,
  sortBy: DEFAULT_SETTINGS.display.sortBy,
  sortOrder: DEFAULT_SETTINGS.display.sortOrder,
  clusterSensitivity: DEFAULT_SETTINGS.analysis.clusterSensitivity,
};

const storageModeOptions: Array<{ value: StorageMode; label: string }> = [
  { value: 'reference', label: 'Reference' },
  { value: 'metadata', label: 'Metadata' },
  { value: 'ingest', label: 'Ingest' },
];

export const FotosSettingsSection = defineSection({
  id: FOTOS_SETTINGS_MODULE_ID,
  name: 'Fotos',
  module: 'fotos.browser',
  order: 40,
  fields: [
    defineField({
      key: 'defaultMode',
      type: 'select',
      label: 'Default Mode',
      description: 'How new photos should be attached by default.',
      default: DEFAULT_FOTOS_SECTION_VALUES.defaultMode,
      options: storageModeOptions,
    }),
    defineField({
      key: 'blobDir',
      type: 'string',
      label: 'Blob Directory',
      default: DEFAULT_FOTOS_SECTION_VALUES.blobDir,
    }),
    defineField({
      key: 'thumbDir',
      type: 'string',
      label: 'Thumbnail Directory',
      default: DEFAULT_FOTOS_SECTION_VALUES.thumbDir,
    }),
    defineField({
      key: 'thumbSize',
      type: 'number',
      label: 'Thumbnail Size',
      default: DEFAULT_FOTOS_SECTION_VALUES.thumbSize,
      min: 100,
      max: 1200,
      step: 100,
    }),
    defineField({
      key: 'quotaMb',
      type: 'number',
      label: 'Quota (MB)',
      default: DEFAULT_FOTOS_SECTION_VALUES.quotaMb,
      min: 0,
      step: 100,
    }),
    defineField({
      key: 'minCopies',
      type: 'number',
      label: 'Minimum Copies',
      default: DEFAULT_FOTOS_SECTION_VALUES.minCopies,
      min: 1,
      max: 10,
      step: 1,
    }),
    defineField({
      key: 'deviceName',
      type: 'string',
      label: 'Device Name',
      default: DEFAULT_FOTOS_SECTION_VALUES.deviceName,
    }),
    defineField({
      key: 'gridSize',
      type: 'select',
      label: 'Grid Size',
      default: DEFAULT_FOTOS_SECTION_VALUES.gridSize,
      options: [
        { value: 'small', label: 'Small' },
        { value: 'large', label: 'Large' },
      ],
    }),
    defineField({
      key: 'thumbScale',
      type: 'range',
      label: 'Thumbnail Scale',
      default: DEFAULT_FOTOS_SECTION_VALUES.thumbScale,
      min: 60,
      max: 400,
      step: 10,
    }),
    defineField({
      key: 'sortBy',
      type: 'select',
      label: 'Sort By',
      default: DEFAULT_FOTOS_SECTION_VALUES.sortBy,
      options: [
        { value: 'date', label: 'Date' },
        { value: 'name', label: 'Name' },
        { value: 'added', label: 'Added' },
      ],
    }),
    defineField({
      key: 'sortOrder',
      type: 'select',
      label: 'Sort Order',
      default: DEFAULT_FOTOS_SECTION_VALUES.sortOrder,
      options: [
        { value: 'asc', label: 'Ascending' },
        { value: 'desc', label: 'Descending' },
      ],
    }),
    defineField({
      key: 'clusterSensitivity',
      type: 'range',
      label: 'Cluster Sensitivity',
      description: 'Lower values merge more aggressively, higher values split more aggressively.',
      default: DEFAULT_FOTOS_SECTION_VALUES.clusterSensitivity,
      min: 0,
      max: 100,
      step: 1,
    }),
  ],
});

export function registerFotosSettings(): void {
  if (!SettingsRegistry.hasSection(FOTOS_SETTINGS_MODULE_ID)) {
    SettingsRegistry.registerSection(FotosSettingsSection);
  }
}

export function serializeFotosSettings(settings: FotosSettings): FotosSettingsSectionValues {
  return {
    defaultMode: settings.storage.defaultMode,
    blobDir: settings.storage.blobDir,
    thumbDir: settings.storage.thumbDir,
    thumbSize: settings.storage.thumbSize,
    quotaMb: settings.storage.quotaMb,
    minCopies: settings.storage.minCopies,
    deviceName: settings.device.name,
    gridSize: settings.display.gridSize,
    thumbScale: settings.display.thumbScale,
    sortBy: settings.display.sortBy,
    sortOrder: settings.display.sortOrder,
    clusterSensitivity: settings.analysis.clusterSensitivity,
  };
}

export function deserializeFotosSettings(
  values: Partial<FotosSettingsSectionValues> | null | undefined,
): FotosSettings {
  return {
    storage: {
      ...DEFAULT_SETTINGS.storage,
      ...(values?.defaultMode !== undefined ? { defaultMode: values.defaultMode } : {}),
      ...(values?.blobDir !== undefined ? { blobDir: values.blobDir } : {}),
      ...(values?.thumbDir !== undefined ? { thumbDir: values.thumbDir } : {}),
      ...(values?.thumbSize !== undefined ? { thumbSize: values.thumbSize } : {}),
      ...(values?.quotaMb !== undefined ? { quotaMb: values.quotaMb } : {}),
      ...(values?.minCopies !== undefined ? { minCopies: values.minCopies } : {}),
    },
    device: {
      ...DEFAULT_SETTINGS.device,
      ...(values?.deviceName !== undefined ? { name: values.deviceName } : {}),
    },
    display: {
      ...DEFAULT_SETTINGS.display,
      ...(values?.gridSize !== undefined ? { gridSize: values.gridSize } : {}),
      ...(values?.thumbScale !== undefined ? { thumbScale: values.thumbScale } : {}),
      ...(values?.sortBy !== undefined ? { sortBy: values.sortBy } : {}),
      ...(values?.sortOrder !== undefined ? { sortOrder: values.sortOrder } : {}),
    },
    analysis: {
      ...DEFAULT_SETTINGS.analysis,
      ...(values?.clusterSensitivity !== undefined
        ? { clusterSensitivity: values.clusterSensitivity }
        : {}),
    },
  };
}

export function isFotosSectionAtDefaults(
  values: Partial<FotosSettingsSectionValues> | null | undefined,
): boolean {
  const normalized = serializeFotosSettings(deserializeFotosSettings(values));
  return Object.entries(DEFAULT_FOTOS_SECTION_VALUES)
    .every(([key, value]) => normalized[key as keyof FotosSettingsSectionValues] === value);
}
