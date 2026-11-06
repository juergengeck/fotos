import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View, useColorScheme } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useModel } from '../../ios-ui';
import type {
  FotosPhotoLibrarySyncIssue,
  FotosPhotoLibrarySyncSummary,
} from '../../ios-ui/services/FotosMediaLibrarySync';
import type { FotosSharedFileImportSummary } from '../../ios-ui/services/FotosMediaLibrarySync';
import type { FotosShareInboxStatus } from '../../ios-ui/services/FotosShareInbox';
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
import {
  getGallerySurfaceProfile,
  planGalleryIntake,
} from '@refinio/fotos.core';

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

export default function LibraryScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const model = useModel();
  const { snapshot, updateFotosSettings } = useFotosRuntime();
  const { platformCapabilities } = snapshot;
  const supportsPhotoLibrarySync = platformCapabilities.supportsPhotoLibrarySync;
  const supportsShareInbox = platformCapabilities.supportsShareInbox;
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<FotosPhotoLibrarySyncSummary | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [shareImporting, setShareImporting] = useState(false);
  const [shareInboxStatus, setShareInboxStatus] = useState<FotosShareInboxStatus | null>(null);
  const [lastShareImport, setLastShareImport] = useState<FotosSharedFileImportSummary | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);

  const intakeCards = useMemo(() => ([
    planGalleryIntake('fotos-browser-mobile', 'photo-library'),
    planGalleryIntake('fotos-browser-mobile', 'shared-files'),
    planGalleryIntake('lama-fire', 'remote-manifest'),
  ]), []);
  const profile = getGallerySurfaceProfile('fotos-browser-mobile');

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
  }, [refreshShareInboxStatus]);

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
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: screenBackground(isDark) }}
      contentContainerStyle={{ padding: 16, gap: 16 }}
    >
      <View
        style={{
          backgroundColor: cardBackground(isDark),
          borderRadius: 22,
          borderWidth: 1,
          borderColor: borderColor(isDark),
          padding: 18,
          gap: 10,
        }}
      >
        <Text style={{ color: textColor(isDark), fontSize: 24, fontWeight: '700' }}>
          fotos mobile authority surface
        </Text>
        <Text style={{ color: mutedTextColor(isDark), fontSize: 15, lineHeight: 21 }}>
          This package now boots through the same ONE runtime shape as `vger.expo`: MultiUser,
          recipes, reverse maps, settings/secrets/devices plans, mDNS discovery, handshake-backed
          collection, and the shared module graph. The actual photo-library and CHUM gallery flows
          can land on that base without a rewrite.
        </Text>
      </View>

      <View
        style={{
          backgroundColor: cardBackground(isDark),
          borderRadius: 20,
          borderWidth: 1,
          borderColor: borderColor(isDark),
          padding: 18,
        }}
      >
        <Text style={{ color: textColor(isDark), fontSize: 17, fontWeight: '700' }}>
          Surface Profile
        </Text>
        <Text style={{ marginTop: 6, color: mutedTextColor(isDark), fontSize: 14, lineHeight: 20 }}>
          {profile.summary}
        </Text>
        <View style={{ marginTop: 12 }}>
          <Row label="Primary action" value={profile.primaryActionLabel} isDark={isDark} />
          <Row label="Role" value={profile.role} isDark={isDark} />
          <Row label="Default source" value={profile.defaultSource} isDark={isDark} />
          <Row label="Live peers" value="See Devices tab" isDark={isDark} />
          <Row
            label="Trusted devices"
            value={String(snapshot.trustedDeviceCount)}
            isDark={isDark}
          />
        </View>
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
            Photo Library
          </Text>
          <Text style={{ color: mutedTextColor(isDark), fontSize: 14, lineHeight: 20 }}>
            Sync the most recent camera-roll items into the shared fotos model. This stores a
            canonical `FotosEntry`, an `original` variant, and a device-local asset locator without
            cloning the gallery UI.
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
              {platformCapabilities.platformLabel} still boots the shared runtime, but photo-library
              ingest is gated in this slice until the Android media path is verified end to end.
            </Text>
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable
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
          </Pressable>

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

      <View style={{ gap: 12 }}>
        {intakeCards.map((plan) => (
          <View
            key={`${plan.surface}:${plan.source}`}
            style={{
              backgroundColor: cardBackground(isDark),
              borderRadius: 18,
              borderWidth: 1,
              borderColor: borderColor(isDark),
              padding: 16,
              gap: 8,
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
              <Text style={{ color: textColor(isDark), fontSize: 16, fontWeight: '700' }}>
                {plan.source}
              </Text>
              <View
                style={{
                  borderRadius: 999,
                  backgroundColor: plan.supported ? palette.accentSoft : '#f3e7de',
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                }}
              >
                <Text
                  style={{
                    color: plan.supported ? palette.accentStrong : palette.danger,
                    fontSize: 12,
                    fontWeight: '700',
                  }}
                >
                  {plan.supported ? 'supported' : 'pending'}
                </Text>
              </View>
            </View>
            <Text style={{ color: mutedTextColor(isDark), fontSize: 14, lineHeight: 20 }}>
              {plan.summary}
            </Text>
            <Row label="Mode" value={plan.mode ?? 'n/a'} isDark={isDark} />
            <Row label="Face enrichment" value={plan.faceEnrichment} isDark={isDark} />
            <Row
              label="Writes sidecars"
              value={plan.writesSidecars ? 'yes' : 'not on mobile'}
              isDark={isDark}
            />
          </View>
        ))}
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
    </ScrollView>
  );
}
