import {
  SettingsRegistry,
  defineField,
  defineSection,
  type SectionValues,
} from '@refinio/settings.core';

export const FOTOS_SETTINGS_MODULE_ID = 'fotos';

export interface FotosSettingsSectionValues extends SectionValues {
  acceptSharing: boolean;
  faceAnalyticsEnabled: boolean;
  semanticSearchEnabled: boolean;
  defaultMode: 'reference' | 'metadata' | 'ingest';
  preferredSource: 'photo-library' | 'shared-files' | 'remote-manifest';
  runMode: 'foreground' | 'background';
}

export const DEFAULT_FOTOS_SECTION_VALUES: FotosSettingsSectionValues = {
  acceptSharing: false,
  faceAnalyticsEnabled: false,
  semanticSearchEnabled: false,
  defaultMode: 'metadata',
  preferredSource: 'photo-library',
  runMode: 'foreground',
};

export const FotosSettingsSection = defineSection({
  id: FOTOS_SETTINGS_MODULE_ID,
  name: 'Fotos',
  module: 'fotos.expo',
  order: 50,
  fields: [
    defineField({
      key: 'acceptSharing',
      type: 'boolean',
      label: 'Accept Sharing',
      description: 'Allow trusted peers to offer fotos content to this device.',
      default: DEFAULT_FOTOS_SECTION_VALUES.acceptSharing,
    }),
    defineField({
      key: 'faceAnalyticsEnabled',
      type: 'boolean',
      label: 'Face Analytics',
      description: 'Enable local face-analysis flows when the native pipeline is available.',
      default: DEFAULT_FOTOS_SECTION_VALUES.faceAnalyticsEnabled,
    }),
    defineField({
      key: 'semanticSearchEnabled',
      type: 'boolean',
      label: 'Semantic Search',
      description: 'Enable semantic indexing for local library search when the native pipeline is available.',
      default: DEFAULT_FOTOS_SECTION_VALUES.semanticSearchEnabled,
    }),
    defineField({
      key: 'defaultMode',
      type: 'select',
      label: 'Default Intake Mode',
      default: DEFAULT_FOTOS_SECTION_VALUES.defaultMode,
      options: [
        { value: 'reference', label: 'Reference' },
        { value: 'metadata', label: 'Metadata' },
        { value: 'ingest', label: 'Ingest' },
      ],
    }),
    defineField({
      key: 'preferredSource',
      type: 'select',
      label: 'Preferred Source',
      default: DEFAULT_FOTOS_SECTION_VALUES.preferredSource,
      options: [
        { value: 'photo-library', label: 'Photo library' },
        { value: 'shared-files', label: 'Shared files' },
        { value: 'remote-manifest', label: 'Remote manifest' },
      ],
    }),
    defineField({
      key: 'runMode',
      type: 'select',
      label: 'Run Mode',
      default: DEFAULT_FOTOS_SECTION_VALUES.runMode,
      options: [
        { value: 'foreground', label: 'Foreground' },
        { value: 'background', label: 'Background' },
      ],
    }),
  ],
});

export function registerFotosSettings(): void {
  if (!SettingsRegistry.hasSection(FOTOS_SETTINGS_MODULE_ID)) {
    SettingsRegistry.registerSection(FotosSettingsSection);
  }
}

export function normalizeFotosSettingsSection(
  value: Partial<FotosSettingsSectionValues> | null | undefined,
): FotosSettingsSectionValues {
  return {
    ...DEFAULT_FOTOS_SECTION_VALUES,
    ...(value ?? {}),
  };
}
