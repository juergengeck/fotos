import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, Switch, Text, View, useColorScheme } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useModel } from '..';
import type {
  FotosPhotoLibrarySyncIssue,
  FotosPhotoLibrarySyncSummary,
} from '../services/FotosMediaLibrarySync';
import type { FotosSharedFileImportSummary } from '../services/FotosMediaLibrarySync';
import type { FotosShareInboxStatus } from '../services/FotosShareInbox';
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

export function FotosSyncControls() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const model = useModel();
  const inboxDrain = useFotosShareInboxAutoDrainStatus(model);
  const { snapshot, updateFotosSettings } = useFotosRuntime();
  const { platformCapabilities } = snapshot;
  const supportsPhotoLibrarySync = platformCapabilities.supportsPhotoLibrarySync;
  const usesApplePhotos = platformCapabilities.currentPlatform === 'ios';
  const supportsShareInbox = platformCapabilities.supportsShareInbox;
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<FotosPhotoLibrarySyncSummary | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [shareImporting, setShareImporting] = useState(false);
  const [shareInboxStatus, setShareInboxStatus] = useState<FotosShareInboxStatus | null>(null);
  const [lastShareImport, setLastShareImport] = useState<FotosSharedFileImportSummary | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);

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

  const syncRecentPhotos = useCallback(async () => {
    setSyncError(null);
    setSyncing(true);
    try {
      const result = await model.syncRecentPhotoLibraryAssets(12);
      setLastSync(result);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : String(error));
    } finally {
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

        <View style={{ flexDirection: 'row', gap: 10 }}>
          {usesApplePhotos && <Pressable
            disabled={syncing || !supportsPhotoLibrarySync}
            onPress={() => void pickAndSyncPhotos()}
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 14,
              backgroundColor: syncing || !supportsPhotoLibrarySync ? palette.accentSoft : palette.accent,
              paddingVertical: 12,
              opacity: syncing || !supportsPhotoLibrarySync ? 0.75 : 1,
            }}
          >
            <Text style={{ color: syncing ? palette.accentStrong : '#ffffff', fontSize: 14, fontWeight: '700' }}>
              {syncing ? 'Working...' : supportsPhotoLibrarySync ? 'Pick Photos' : 'Photo sync pending'}
            </Text>
          </Pressable>}

          <Pressable
            disabled={syncing || !supportsPhotoLibrarySync}
            onPress={() => void syncRecentPhotos()}
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 14,
              borderWidth: 1,
              borderColor: borderColor(isDark),
              backgroundColor: mutedCardBackground(isDark),
              paddingVertical: 12,
              opacity: syncing || !supportsPhotoLibrarySync ? 0.75 : 1,
            }}
          >
            <Text style={{ color: textColor(isDark), fontSize: 14, fontWeight: '700' }}>
              {supportsPhotoLibrarySync ? 'Sync 12 Recent' : 'Recent sync pending'}
            </Text>
          </Pressable>
        </View>

        {lastSync ? (
          <View
            style={{
              borderRadius: 16,
              backgroundColor: mutedCardBackground(isDark),
              padding: 14,
              gap: 4,
            }}
          >
            <Row
              label="Access"
              value={lastSync.accessPrivileges ?? (lastSync.permissionGranted ? 'granted' : 'denied')}
              isDark={isDark}
            />
            <Row
              label="Synced"
              value={`${lastSync.syncedCount} of ${lastSync.requestedCount}`}
              isDark={isDark}
            />
            <Row label="Skipped" value={String(lastSync.skippedCount)} isDark={isDark} />
            {lastSync.deferredAssets.length ? (
              <View style={{ gap: 8, paddingVertical: 8 }}>
                <Row label="Waiting for iCloud" value={String(lastSync.deferredAssets.length)} isDark={isDark} />
                {lastSync.deferredAssets.slice(0, 3).map(({ asset, thumbnailUri }) => (
                  <View key={asset.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    {thumbnailUri ? <Image source={{ uri: thumbnailUri }} style={{ width: 40, height: 40, borderRadius: 6 }} /> : null}
                    <Text numberOfLines={1} style={{ color: textColor(isDark), flex: 1 }}>{asset.filename}</Text>
                  </View>
                ))}
                <Pressable
                  accessibilityRole="button"
                  disabled={syncing}
                  onPress={() => void syncDeferredPhotos(lastSync.deferredAssets.map(({ asset }) => asset.id))}
                  style={{ backgroundColor: palette.accent, borderRadius: 10, padding: 10, opacity: syncing ? 0.6 : 1 }}
                >
                  <Text style={{ color: '#ffffff', textAlign: 'center', fontWeight: '600' }}>Download from iCloud</Text>
                </Pressable>
              </View>
            ) : null}
            {lastSync.albumSyncError ? (
              <Text style={{ color: palette.danger, fontSize: 13 }}>Gallery albums could not sync. {lastSync.albumSyncError}</Text>
            ) : null}
            {lastSync.issues.slice(0, 3).map((issue) => (
              <Text
                key={`${issue.assetId}:${issue.reason}`}
                style={{ color: mutedTextColor(isDark), fontSize: 13, lineHeight: 18 }}
              >
                {issue.filename}: {issue.reason}
              </Text>
            ))}
          </View>
        ) : null}

        {syncError ? (
          <Text style={{ color: palette.danger, fontSize: 13, lineHeight: 18 }}>
            {syncError}
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

      <View
        style={{
          backgroundColor: cardBackground(isDark),
          borderRadius: 20,
          borderWidth: 1,
          borderColor: borderColor(isDark),
          padding: 18,
          gap: 14,
        }}
      >
        <Text style={{ color: textColor(isDark), fontSize: 17, fontWeight: '700' }}>
          Fotos Section
        </Text>

        {[
          {
            label: 'Accept trusted sharing',
            value: snapshot.fotosSettings.acceptSharing,
            key: 'acceptSharing' as const,
          },
          {
            label: 'Face analytics',
            value: snapshot.fotosSettings.faceAnalyticsEnabled,
            key: 'faceAnalyticsEnabled' as const,
          },
          {
            label: 'Semantic search',
            value: snapshot.fotosSettings.semanticSearchEnabled,
            key: 'semanticSearchEnabled' as const,
          },
        ].map((item) => (
          <View
            key={item.key}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              paddingVertical: 4,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: textColor(isDark), fontSize: 15, fontWeight: '600' }}>
                {item.label}
              </Text>
            </View>
            <Switch
              value={item.value}
              onValueChange={(enabled) => void updateFotosSettings({ [item.key]: enabled })}
              trackColor={{ false: '#cfd5cf', true: palette.accent }}
              thumbColor="#ffffff"
            />
          </View>
        ))}

        <View
          style={{
            marginTop: 4,
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          {['reference', 'metadata', 'ingest'].map((mode) => {
            const selected = snapshot.fotosSettings.defaultMode === mode;
            return (
              <Pressable
                key={mode}
                onPress={() => void updateFotosSettings({ defaultMode: mode as never })}
                style={{
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: selected ? palette.accent : borderColor(isDark),
                  backgroundColor: selected ? palette.accentSoft : mutedCardBackground(isDark),
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                }}
              >
                <Text
                  style={{
                    color: selected ? palette.accentStrong : textColor(isDark),
                    fontSize: 13,
                    fontWeight: '700',
                    textTransform: 'capitalize',
                  }}
                >
                  {mode}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </>
  );
}
