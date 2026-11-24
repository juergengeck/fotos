import { describe, expect, it, vi } from 'vitest';
import type { FotosLibraryAutoSyncSnapshot } from '../services/FotosLibraryAutoSync';
import type { FotosPhotoLibrarySyncSummary } from '../services/FotosMediaLibrarySync';

vi.mock('react-native', () => ({
  Image: 'Image',
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light',
}));
vi.mock('expo-image-picker', () => ({ launchImageLibraryAsync: vi.fn() }));
vi.mock('..', () => ({ useModel: vi.fn() }));
vi.mock('../hooks/useFotosLibraryAutoSync', () => ({ useFotosLibraryAutoSyncStatus: vi.fn() }));
vi.mock('../hooks/useFotosShareInboxAutoDrain', () => ({ useFotosShareInboxAutoDrainStatus: vi.fn() }));
vi.mock('../../src/hooks/use-fotos-runtime', () => ({ useFotosRuntime: vi.fn() }));

import { derivePhotoLibraryDisplayStatus } from './FotosSyncControls';

const idleAutoSync: FotosLibraryAutoSyncSnapshot = {
  enabled: true,
  running: false,
  pending: false,
  permissionGranted: null,
  discoveredCount: 0,
  processedCount: 0,
  syncedCount: 0,
  deferredCount: 0,
  skippedCount: 0,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastSummary: null,
  lastError: null,
};

function makeSummary(overrides: Partial<FotosPhotoLibrarySyncSummary> = {}): FotosPhotoLibrarySyncSummary {
  return {
    permissionGranted: true,
    accessPrivileges: 'all',
    requestedCount: 4394,
    syncedCount: 1,
    skippedCount: 0,
    syncedEntries: [],
    deferredAssets: [],
    issues: [],
    ...overrides,
  };
}

describe('derivePhotoLibraryDisplayStatus', () => {
  it('increments the Synced field live during auto-sync instead of sticking on lastSummary', () => {
    const status = derivePhotoLibraryDisplayStatus({
      isLibraryBusy: true,
      manualProgress: null,
      lastSync: null,
      librarySync: {
        ...idleAutoSync,
        running: true,
        permissionGranted: true,
        discoveredCount: 4394,
        processedCount: 31,
        syncedCount: 30,
        deferredCount: 0,
        skippedCount: 0,
        lastSummary: makeSummary({ syncedCount: 1, requestedCount: 4394 }),
      },
    });

    expect(status).toEqual({
      access: 'all',
      synced: '31 of 4394',
      skipped: '0',
      deferredCount: 0,
    });
  });

  it('uses live manual progress when Sync Library runs manually', () => {
    const status = derivePhotoLibraryDisplayStatus({
      isLibraryBusy: true,
      manualProgress: {
        discoveredCount: 120,
        processedCount: 45,
        syncedCount: 42,
        deferredCount: 2,
        skippedCount: 1,
      },
      lastSync: null,
      librarySync: { ...idleAutoSync, permissionGranted: true },
    });

    expect(status).toEqual({
      access: 'granted',
      synced: '42 of 120',
      skipped: '1',
      deferredCount: 2,
    });
  });

  it('keeps cumulative synced totals after a resumed auto-sync finishes', () => {
    const status = derivePhotoLibraryDisplayStatus({
      isLibraryBusy: false,
      manualProgress: null,
      lastSync: null,
      librarySync: {
        ...idleAutoSync,
        running: false,
        permissionGranted: true,
        discoveredCount: 4394,
        processedCount: 4394,
        syncedCount: 4393,
        deferredCount: 0,
        skippedCount: 0,
        lastSummary: makeSummary({ syncedCount: 4393, requestedCount: 4393 }),
      },
    });

    expect(status).toEqual({
      access: 'all',
      synced: '4394 of 4394',
      skipped: '0',
      deferredCount: 0,
    });
  });

  it('returns null before any sync has run or reported permission state', () => {
    expect(
      derivePhotoLibraryDisplayStatus({
        isLibraryBusy: false,
        manualProgress: null,
        lastSync: null,
        librarySync: idleAutoSync,
      }),
    ).toBeNull();
  });
});
