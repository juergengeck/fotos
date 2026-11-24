import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, Text, View, useColorScheme } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useModel } from '..';
import type {
  FotosPhotoLibrarySyncIssue,
  FotosPhotoLibrarySyncProgress,
  FotosPhotoLibrarySyncSummary,
} from '../services/FotosMediaLibrarySync';
import type { FotosSharedFileImportSummary } from '../services/FotosMediaLibrarySync';
import type { FotosShareInboxStatus } from '../services/FotosShareInbox';
import type { FotosLibraryAutoSyncSnapshot } from '../services/FotosLibraryAutoSync';
import { useFotosLibraryAutoSyncStatus } from '../hooks/useFotosLibraryAutoSync';
import { useFotosShareInboxAutoDrainStatus } from '../hooks/useFotosShareInboxAutoDrain';
import { useFotosRuntime } from '../../src/hooks/use-fotos-runtime';
import {
  borderColor,
  cardBackground,
  mutedCardBackground,
  mutedTextColor,
  palette,
  textColor,
} from '../../src/theme';


function Row({ label, value, isDark }: { label: string; value: string; isDark: boolean }) {
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

export interface PhotoLibraryDisplayStatus {
  access: string;
  synced: string;
  skipped: string;
  deferredCount: number;
}

export function derivePhotoLibraryDisplayStatus({
  isLibraryBusy,
  manualProgress,
  lastSync,
  librarySync,
}: {
  isLibraryBusy: boolean;
  manualProgress: FotosPhotoLibrarySyncProgress | null;
  lastSync: FotosPhotoLibrarySyncSummary | null;
  librarySync: FotosLibraryAutoSyncSnapshot;
}): PhotoLibraryDisplayStatus | null {
  const effectiveSync = lastSync ?? librarySync.lastSummary;
  const activeProgress = manualProgress ?? (librarySync.running ? librarySync : null);

  if (
    !isLibraryBusy
    && !effectiveSync
    && librarySync.discoveredCount === 0
    && librarySync.permissionGranted === null
  ) {
    return null;
  }

  const access = effectiveSync?.accessPrivileges
    ?? (effectiveSync
      ? (effectiveSync.permissionGranted ? 'granted' : 'denied')
      : librarySync.permissionGranted === false
        ? 'denied'
        : 'granted');

  if (activeProgress) {
    const syncedCount = Math.max(
      0,
      activeProgress.processedCount - activeProgress.deferredCount - activeProgress.skippedCount,
    );
    return {
      access,
      synced: activeProgress.discoveredCount > 0
        ? `${syncedCount} of ${activeProgress.discoveredCount}`
        : `${syncedCount}`,
      skipped: String(activeProgress.skippedCount),
      deferredCount: activeProgress.deferredCount,
    };
  }

  if (lastSync) {
    return {
      access,
      synced: `${lastSync.syncedCount} of ${lastSync.requestedCount}`,
      skipped: String(lastSync.skippedCount),
      deferredCount: lastSync.deferredAssets.length,
    };
  }

  if (isLibraryBusy && !effectiveSync) {
    return {
      access,
      synced: 'Starting...',
      skipped: '0',
      deferredCount: 0,
    };
  }

  const total = Math.max(librarySync.discoveredCount, librarySync.lastSummary?.requestedCount ?? 0);
  const syncedCount = librarySync.processedCount > 0
    ? Math.max(0, librarySync.processedCount - librarySync.deferredCount - librarySync.skippedCount)
    : (librarySync.lastSummary?.syncedCount ?? librarySync.syncedCount);
  const skippedCount = librarySync.lastSummary?.skippedCount ?? librarySync.skippedCount;
  const deferredCount = librarySync.lastSummary?.deferredAssets.length ?? librarySync.deferredCount;

  return {
    access,
    synced: `${syncedCount} of ${total}`,
    skipped: String(skippedCount),
    deferredCount,
  };
}

export function FotosSyncControls() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const model = useModel();
  const inboxDrain = useFotosShareInboxAutoDrainStatus(model);
  const librarySync = useFotosLibraryAutoSyncStatus(model);
  const { snapshot } = useFotosRuntime();
  const { platformCapabilities } = snapshot;
  const supportsPhotoLibrarySync = platformCapabilities.supportsPhotoLibrarySync;
  const usesApplePhotos = platformCapabilities.currentPlatform === 'ios';
  const supportsShareInbox = platformCapabilities.supportsShareInbox;
  const [syncing, setSyncing] = useState(false);
  const [manualProgress, setManualProgress] = useState<FotosPhotoLibrarySyncProgress | null>(null);
  const [lastSync, setLastSync] = useState<FotosPhotoLibrarySyncSummary | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [shareImporting, setShareImporting] = useState(false);
  const [shareInboxStatus, setShareInboxStatus] = useState<FotosShareInboxStatus | null>(null);
  const [lastShareImport, setLastShareImport] = useState<FotosSharedFileImportSummary | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const isLibraryBusy = syncing || librarySync.running;
  const effectiveSync = lastSync ?? librarySync.lastSummary;
  const effectiveSyncError = syncError ?? librarySync.lastError;
  const libraryDisplayStatus = derivePhotoLibraryDisplayStatus({
    isLibraryBusy,
    manualProgress,
    lastSync,
    librarySync,
  });

  useEffect(() => {
    if (librarySync.running) {
      setLastSync(null);
    }
  }, [librarySync.running]);

  const refreshShareInboxStatus = useCallback(async () => {
    try {
      const status = await model.getPendingSharedInboxStatus();
      setShareInboxStatus(status);
    } catch (error) {
      setShareError(error instanceof Error ? error.message : String(error));
    }
  }, [model]);

  useEffect(() => {
    void refreshShareInboxStatus();
  }, [inboxDrain.lastFinishedAt, refreshShareInboxStatus]);

  useEffect(() => {
    if (inboxDrain.lastSummary?.requestedCount) setLastShareImport(inboxDrain.lastSummary);
    setShareError(inboxDrain.lastError);
  }, [inboxDrain.lastSummary, inboxDrain.lastError]);

  const syncFullLibrary = useCallback(async () => {
    setSyncError(null);
    setManualProgress(null);
    setSyncing(true);
    try {
      const result = await model.syncPhotoLibrary({
        requestPermission: true,
        onProgress: setManualProgress,
      });
      setLastSync(result);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : String(error));
    } finally {
      setManualProgress(null);
      setSyncing(false);
    }
  }, [model]);

  const pickAndSyncPhotos = useCallback(async () => {
    setSyncError(null);
    setSyncing(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images',
        allowsMultipleSelection: true,
        selectionLimit: 12,
        orderedSelection: true,
        quality: 1,
      });

      if (result.canceled) {
        return;
      }

      const assetIds = [...new Set(
        result.assets
          .map((asset) => asset.assetId ?? null)
          .filter((assetId): assetId is string => typeof assetId === 'string' && assetId.length > 0),
      )];

      const missingIdIssues: FotosPhotoLibrarySyncIssue[] = result.assets
        .filter((asset) => !asset.assetId)
        .map((asset) => ({
          assetId: asset.uri,
          filename: asset.fileName ?? asset.uri.split('/').pop() ?? 'selected-photo',
          reason: 'The picker did not expose a stable media-library asset id for this selection.',
        }));

      if (assetIds.length === 0) {
        setLastSync({
          permissionGranted: true,
          accessPrivileges: null,
          requestedCount: result.assets.length,
          syncedCount: 0,
          skippedCount: missingIdIssues.length,
          syncedEntries: [],
          deferredAssets: [],
          issues: missingIdIssues,
        });
        return;
      }

      const syncResult = await model.syncPhotoLibraryAssetsById(assetIds);
      setLastSync({
        ...syncResult,
        requestedCount: result.assets.length,
        skippedCount: syncResult.skippedCount + missingIdIssues.length,
        issues: [...syncResult.issues, ...missingIdIssues],
      });
      await refreshShareInboxStatus();
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : String(error));
    } finally {
      setSyncing(false);
    }
  }, [model, refreshShareInboxStatus]);

  const syncDeferredPhotos = useCallback(async (assetIds: string[]) => {
    setSyncError(null);
    setSyncing(true);
    try {
      setLastSync(await model.syncPhotoLibraryAssetsById(assetIds, true));
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : String(error));
    } finally {
      setSyncing(false);
    }
  }, [model]);

  const importPendingSharedInbox = useCallback(async () => {
    setShareError(null);
    setShareImporting(true);
    try {
      const result = await model.importPendingSharedInbox();
      setLastShareImport(result);
      await refreshShareInboxStatus();
    } catch (error) {
      setShareError(error instanceof Error ? error.message : String(error));
    } finally {
      setShareImporting(false);
    }
  }, [model, refreshShareInboxStatus]);

  return (
    <>
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
        <View style={{ gap: 6 }}>
          <Text style={{ color: textColor(isDark), fontSize: 17, fontWeight: '700' }}>
            Photo Library
          </Text>
          <Text style={{ color: mutedTextColor(isDark), fontSize: 14, lineHeight: 20 }}>
            Sync previews and albums from {usesApplePhotos ? 'Apple Photos' : 'your device gallery'}.
            Reference mode keeps originals in the gallery.
          </Text>
        </View>

        {!supportsPhotoLibrarySync ? (
          <View
            style={{
              borderRadius: 16,
              backgroundColor: mutedCardBackground(isDark),
              padding: 14,
            }}
          >
            <Text style={{ color: mutedTextColor(isDark), fontSize: 13, lineHeight: 18 }}>
              Photo library access requires iOS or Android.
            </Text>
          </View>
        ) : null}

        {supportsPhotoLibrarySync && !isLibraryBusy ? (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {usesApplePhotos ? (
              <Pressable
                onPress={() => void pickAndSyncPhotos()}
                style={{
                  flex: 1,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 14,
                  backgroundColor: palette.accent,
                  paddingVertical: 12,
                }}
              >
                <Text style={{ color: '#ffffff', fontSize: 14, fontWeight: '700' }}>
                  Pick Photos
                </Text>
              </Pressable>
            ) : null}

            <Pressable
              onPress={() => void syncFullLibrary()}
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 14,
                borderWidth: 1,
                borderColor: borderColor(isDark),
                backgroundColor: mutedCardBackground(isDark),
                paddingVertical: 12,
              }}
            >
              <Text style={{ color: textColor(isDark), fontSize: 14, fontWeight: '700' }}>
                Sync Library
              </Text>
            </Pressable>
          </View>
        ) : null}

        {libraryDisplayStatus ? (
          <View
            style={{
              borderRadius: 16,
              backgroundColor: mutedCardBackground(isDark),
              padding: 14,
              gap: 4,
            }}
          >
            <Row label="Access" value={libraryDisplayStatus.access} isDark={isDark} />
            <Row label="Synced" value={libraryDisplayStatus.synced} isDark={isDark} />
            <Row label="Skipped" value={libraryDisplayStatus.skipped} isDark={isDark} />
            {isLibraryBusy && libraryDisplayStatus.deferredCount > 0 ? (
              <Row label="Waiting for iCloud" value={String(libraryDisplayStatus.deferredCount)} isDark={isDark} />
            ) : null}
            {!isLibraryBusy && effectiveSync?.deferredAssets.length ? (
              <View style={{ gap: 8, paddingVertical: 8 }}>
                <Row label="Waiting for iCloud" value={String(effectiveSync.deferredAssets.length)} isDark={isDark} />
                {effectiveSync.deferredAssets.slice(0, 3).map(({ asset, thumbnailUri }) => (
                  <View key={asset.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    {thumbnailUri ? <Image source={{ uri: thumbnailUri }} style={{ width: 40, height: 40, borderRadius: 6 }} /> : null}
                    <Text numberOfLines={1} style={{ color: textColor(isDark), flex: 1 }}>{asset.filename}</Text>
                  </View>
                ))}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void syncDeferredPhotos(effectiveSync.deferredAssets.map(({ asset }) => asset.id))}
                  style={{ backgroundColor: palette.accent, borderRadius: 10, padding: 10 }}
                >
                  <Text style={{ color: '#ffffff', textAlign: 'center', fontWeight: '600' }}>Download from iCloud</Text>
                </Pressable>
              </View>
            ) : null}
            {!isLibraryBusy && effectiveSync?.albumSyncError ? (
              <Text style={{ color: palette.danger, fontSize: 13 }}>Gallery albums could not sync. {effectiveSync.albumSyncError}</Text>
            ) : null}
            {!isLibraryBusy ? effectiveSync?.issues.slice(0, 3).map((issue) => (
              <Text
                key={`${issue.assetId}:${issue.reason}`}
                style={{ color: mutedTextColor(isDark), fontSize: 13, lineHeight: 18 }}
              >
                {issue.filename}: {issue.reason}
              </Text>
            )) : null}
          </View>
        ) : null}

        {effectiveSyncError ? (
          <Text style={{ color: palette.danger, fontSize: 13, lineHeight: 18 }}>
            {effectiveSyncError}
          </Text>
        ) : null}
      </View>

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
        <View style={{ gap: 6 }}>
          <Text style={{ color: textColor(isDark), fontSize: 17, fontWeight: '700' }}>
            Share Inbox
          </Text>
          <Text style={{ color: mutedTextColor(isDark), fontSize: 14, lineHeight: 20 }}>
            The share extension deposits files into an App Group inbox. Importing them here feeds
            the same fotos sync service and media model used by photo-library ingest.
          </Text>
        </View>

        {!supportsShareInbox ? (
          <View
            style={{
              borderRadius: 16,
              backgroundColor: mutedCardBackground(isDark),
              padding: 14,
            }}
          >
            <Text style={{ color: mutedTextColor(isDark), fontSize: 13, lineHeight: 18 }}>
              Share-to-app import is currently iOS-only. Android intent ingestion will need its own
              inbox and import path before this section becomes active.
            </Text>
          </View>
        ) : null}

        <View
          style={{
            borderRadius: 16,
            backgroundColor: mutedCardBackground(isDark),
            padding: 14,
            gap: 4,
          }}
        >
          <Row
            label="Pending batches"
            value={String(shareInboxStatus?.batchCount ?? 0)}
            isDark={isDark}
          />
          <Row
            label="Pending items"
            value={String(shareInboxStatus?.itemCount ?? 0)}
            isDark={isDark}
          />
        </View>

        <Pressable
          disabled={!supportsShareInbox || shareImporting || (shareInboxStatus?.itemCount ?? 0) === 0}
          onPress={() => void importPendingSharedInbox()}
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 14,
            backgroundColor:
              !supportsShareInbox || shareImporting || (shareInboxStatus?.itemCount ?? 0) === 0
                ? palette.accentSoft
                : palette.accent,
            paddingVertical: 12,
            opacity: !supportsShareInbox || shareImporting || (shareInboxStatus?.itemCount ?? 0) === 0 ? 0.75 : 1,
          }}
        >
          <Text
            style={{
              color:
                !supportsShareInbox || shareImporting || (shareInboxStatus?.itemCount ?? 0) === 0
                  ? palette.accentStrong
                  : '#ffffff',
              fontSize: 14,
              fontWeight: '700',
            }}
          >
            {shareImporting
              ? 'Importing shared items...'
              : supportsShareInbox
                ? 'Import Pending Shared Items'
                : 'Share inbox pending'}
          </Text>
        </Pressable>

        {lastShareImport ? (
          <View
            style={{
              borderRadius: 16,
              backgroundColor: mutedCardBackground(isDark),
              padding: 14,
              gap: 4,
            }}
          >
            <Row label="Imported" value={`${lastShareImport.syncedCount} of ${lastShareImport.requestedCount}`} isDark={isDark} />
            <Row label="Skipped" value={String(lastShareImport.skippedCount)} isDark={isDark} />
            {lastShareImport.issues.slice(0, 3).map((issue) => (
              <Text
                key={`${issue.locator}:${issue.reason}`}
                style={{ color: mutedTextColor(isDark), fontSize: 13, lineHeight: 18 }}
              >
                {issue.filename}: {issue.reason}
              </Text>
            ))}
          </View>
        ) : null}

        {shareError ? (
          <Text style={{ color: palette.danger, fontSize: 13, lineHeight: 18 }}>
            {shareError}
          </Text>
        ) : null}
      </View>
    </>
  );
}
