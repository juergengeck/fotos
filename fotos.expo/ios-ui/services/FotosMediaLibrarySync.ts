import * as Crypto from 'expo-crypto';
import { EncodingType, readAsStringAsync } from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { Platform } from 'react-native';
import {
    appendFotosDeviceBookContent,
    createFotosMediaLocator,
    createFotosMediaVariant,
    normalizeImageBytesForContentHash,
    type FotosEntry,
    type FotosManifest,
    type FotosMediaLocator,
    type FotosMediaVariant,
} from '@refinio/fotos.core';
import {
    appendMediaBookContent,
    createMediaSource,
    createMediaSourceEntry,
} from '../../../vger/packages/source.media/src/services/MediaSourceService.js';
import type { SHA256Hash, SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import {
    deleteFotosShareInboxBatch,
    getFotosShareInboxStatus,
    readFotosShareInboxBatches,
    type FotosShareInboxQueuedItem,
    type FotosShareInboxStatus,
} from './FotosShareInbox';

const DEFAULT_RECENT_LIMIT = 12;
const CURRENT_PLATFORM = Platform.OS;
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP = (() => {
    const table = new Int16Array(123).fill(-1);
    for (let index = 0; index < BASE64_ALPHABET.length; index += 1) {
        table[BASE64_ALPHABET.charCodeAt(index)] = index;
    }
    return table;
})();

interface VersionedObjectLookup {
    obj: unknown;
}

interface StoredVersionedObject {
    idHash: string;
    hash: string;
}

interface FotosMediaLibrarySyncDeps {
    calculateIdHashOfObj: (obj: object) => Promise<string>;
    getObjectByIdHash: (idHash: string) => Promise<VersionedObjectLookup>;
    storeVersionedObject: (obj: object) => Promise<StoredVersionedObject>;
    getInstanceId: () => string | undefined;
}

export interface FotosPhotoLibrarySyncIssue {
    assetId: string;
    filename: string;
    reason: string;
}

export interface FotosPhotoLibrarySyncSummary {
    permissionGranted: boolean;
    accessPrivileges: MediaLibrary.PermissionResponse['accessPrivileges'] | null;
    requestedCount: number;
    syncedCount: number;
    skippedCount: number;
    syncedEntries: Array<{
        assetId: string;
        contentHash: string;
    }>;
    issues: FotosPhotoLibrarySyncIssue[];
}

export interface FotosSharedFileImportIssue {
    locator: string;
    filename: string;
    reason: string;
}

export interface FotosSharedFileImportSummary {
    batchCount: number;
    requestedCount: number;
    syncedCount: number;
    skippedCount: number;
    syncedEntries: Array<{
        locator: string;
        contentHash: string;
    }>;
    issues: FotosSharedFileImportIssue[];
}

interface SyncedAssetResult {
    assetId: string;
    contentHash: string;
}

type AssetSyncOutcome =
    | { status: 'synced'; result: SyncedAssetResult }
    | { status: 'skipped'; issue: FotosPhotoLibrarySyncIssue };

function toHex(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let hex = '';
    for (const value of bytes) {
        hex += value.toString(16).padStart(2, '0');
    }
    return hex;
}

function decodeBase64(base64: string): Uint8Array {
    const sanitized = base64.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    const padding = sanitized.endsWith('==') ? 2 : sanitized.endsWith('=') ? 1 : 0;
    const outputLength = Math.max(0, Math.floor((sanitized.length * 3) / 4) - padding);
    const output = new Uint8Array(outputLength);

    let outIndex = 0;
    for (let index = 0; index < sanitized.length; index += 4) {
        const char1 = sanitized.charCodeAt(index);
        const char2 = sanitized.charCodeAt(index + 1);
        const char3 = sanitized.charAt(index + 2);
        const char4 = sanitized.charAt(index + 3);

        const value1 = BASE64_LOOKUP[char1] ?? -1;
        const value2 = BASE64_LOOKUP[char2] ?? -1;
        const value3 = char3 === '=' ? 0 : BASE64_LOOKUP[sanitized.charCodeAt(index + 2)] ?? -1;
        const value4 = char4 === '=' ? 0 : BASE64_LOOKUP[sanitized.charCodeAt(index + 3)] ?? -1;

        if (value1 < 0 || value2 < 0 || (char3 !== '=' && value3 < 0) || (char4 !== '=' && value4 < 0)) {
            throw new Error('Invalid base64 payload');
        }

        const chunk = (value1 << 18) | (value2 << 12) | (value3 << 6) | value4;
        output[outIndex++] = (chunk >> 16) & 0xff;
        if (char3 !== '=') {
            output[outIndex++] = (chunk >> 8) & 0xff;
        }
        if (char4 !== '=') {
            output[outIndex++] = chunk & 0xff;
        }
    }

    return output;
}

function toIsoTimestamp(value: number | undefined): string | undefined {
    if (!value) {
        return undefined;
    }
    return new Date(value).toISOString();
}

function getExifRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    return value as Record<string, unknown>;
}

function getExifString(exif: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
        const value = exif[key];
        if (typeof value === 'string' && value.trim().length > 0) {
            return value.trim();
        }
        if (typeof value === 'number' && Number.isFinite(value)) {
            return String(value);
        }
    }
    return undefined;
}

function getExifNumber(exif: Record<string, unknown>, keys: string[]): number | undefined {
    for (const key of keys) {
        const value = exif[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
        if (typeof value === 'string' && value.length > 0) {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) {
                return parsed;
            }
        }
    }
    return undefined;
}

function normalizeExifDate(value: string | undefined): string | undefined {
    if (!value) {
        return undefined;
    }

    const match = value.match(/^(\d{4}):(\d{2}):(\d{2})[ T](.+)$/);
    if (!match) {
        return value;
    }

    return `${match[1]}-${match[2]}-${match[3]}T${match[4]}`;
}

function mimeFromFilename(filename: string): string {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.heic') || lower.endsWith('.heif')) return 'image/heic';
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.gif')) return 'image/gif';
    if (lower.endsWith('.tif') || lower.endsWith('.tiff')) return 'image/tiff';
    return 'image/jpeg';
}

function timestampOrNow(value: string | undefined): string {
    return value ?? new Date().toISOString();
}

function createIssue(asset: MediaLibrary.Asset, reason: string): FotosPhotoLibrarySyncIssue {
    return {
        assetId: asset.id,
        filename: asset.filename,
        reason,
    };
}

function buildEntryFromAsset(params: {
    asset: MediaLibrary.Asset;
    assetInfo: MediaLibrary.AssetInfo;
    contentHash: string;
    byteSize: number;
}): FotosEntry {
    const { asset, assetInfo, contentHash, byteSize } = params;
    const exif = getExifRecord(assetInfo.exif);
    const cameraMake = getExifString(exif, ['Make']);
    const cameraModel = getExifString(exif, ['Model']);
    const camera = [cameraMake, cameraModel].filter(Boolean).join(' ').trim();
    const gpsLat = getExifNumber(exif, ['GPSLatitude', 'latitude']);
    const gpsLon = getExifNumber(exif, ['GPSLongitude', 'longitude']);

    const entry: FotosEntry = {
        $type$: 'FotosEntry',
        contentHash,
        streamId: contentHash,
        mime: mimeFromFilename(asset.filename),
        size: byteSize,
        ...(toIsoTimestamp(asset.creationTime) ? { capturedAt: toIsoTimestamp(asset.creationTime) } : {}),
        ...(toIsoTimestamp(asset.modificationTime) ? { updatedAt: toIsoTimestamp(asset.modificationTime) } : {}),
        ...(normalizeExifDate(getExifString(exif, ['DateTimeOriginal', 'DateTimeDigitized', 'DateTime']))
            ? { exifDate: normalizeExifDate(getExifString(exif, ['DateTimeOriginal', 'DateTimeDigitized', 'DateTime'])) }
            : {}),
        ...(camera ? { exifCamera: camera } : {}),
        ...(getExifString(exif, ['LensModel', 'LensMake']) ? { exifLens: getExifString(exif, ['LensModel', 'LensMake']) } : {}),
        ...(getExifString(exif, ['FocalLength']) ? { exifFocalLength: getExifString(exif, ['FocalLength']) } : {}),
        ...(getExifString(exif, ['FNumber', 'ApertureValue']) ? { exifAperture: getExifString(exif, ['FNumber', 'ApertureValue']) } : {}),
        ...(getExifString(exif, ['ExposureTime', 'ShutterSpeedValue']) ? { exifShutter: getExifString(exif, ['ExposureTime', 'ShutterSpeedValue']) } : {}),
        ...(getExifNumber(exif, ['ISOSpeedRatings', 'PhotographicSensitivity', 'ISO']) !== undefined
            ? { exifIso: getExifNumber(exif, ['ISOSpeedRatings', 'PhotographicSensitivity', 'ISO']) }
            : {}),
        ...(gpsLat !== undefined ? { exifGpsLat: gpsLat } : {}),
        ...(gpsLon !== undefined ? { exifGpsLon: gpsLon } : {}),
        ...(asset.width > 0 ? { exifWidth: asset.width } : {}),
        ...(asset.height > 0 ? { exifHeight: asset.height } : {}),
    };

    return entry;
}

export class FotosMediaLibrarySync {
    private manifestIdHash: SHA256IdHash<FotosManifest> | null = null;

    constructor(private readonly deps: FotosMediaLibrarySyncDeps) {}

    async syncRecentAssets(limit: number = DEFAULT_RECENT_LIMIT): Promise<FotosPhotoLibrarySyncSummary> {
        if (CURRENT_PLATFORM !== 'ios') {
            return {
                permissionGranted: false,
                accessPrivileges: null,
                requestedCount: 0,
                syncedCount: 0,
                skippedCount: 1,
                syncedEntries: [],
                issues: [{
                    assetId: 'platform',
                    filename: 'photo-library',
                    reason: `Photo-library sync is currently wired for iOS; current platform is ${CURRENT_PLATFORM}.`,
                }],
            };
        }

        const permission = await this.ensurePermission();
        if (!permission.granted) {
            return {
                permissionGranted: false,
                accessPrivileges: permission.accessPrivileges ?? null,
                requestedCount: 0,
                syncedCount: 0,
                skippedCount: 0,
                syncedEntries: [],
                issues: [],
            };
        }

        const page = await MediaLibrary.getAssetsAsync({
            first: limit,
            mediaType: MediaLibrary.MediaType.photo,
            sortBy: [['creationTime', false]],
        });

        return this.syncAssetRefs(page.assets, permission);
    }

    async syncAssetIds(assetIds: string[]): Promise<FotosPhotoLibrarySyncSummary> {
        if (CURRENT_PLATFORM !== 'ios') {
            return {
                permissionGranted: false,
                accessPrivileges: null,
                requestedCount: 0,
                syncedCount: 0,
                skippedCount: 1,
                syncedEntries: [],
                issues: [{
                    assetId: 'platform',
                    filename: 'photo-library',
                    reason: `Photo-library sync is currently wired for iOS; current platform is ${CURRENT_PLATFORM}.`,
                }],
            };
        }

        const permission = await this.ensurePermission();
        if (!permission.granted) {
            return {
                permissionGranted: false,
                accessPrivileges: permission.accessPrivileges ?? null,
                requestedCount: assetIds.length,
                syncedCount: 0,
                skippedCount: 0,
                syncedEntries: [],
                issues: [],
            };
        }

        const uniqueAssetIds = [...new Set(assetIds.filter((assetId) => assetId.length > 0))];
        return this.syncAssetRefs(uniqueAssetIds, permission);
    }

    async getShareInboxStatus(): Promise<FotosShareInboxStatus> {
        return getFotosShareInboxStatus();
    }

    async importPendingSharedInbox(): Promise<FotosSharedFileImportSummary> {
        const batches = await readFotosShareInboxBatches();
        if (batches.length === 0) {
            return {
                batchCount: 0,
                requestedCount: 0,
                syncedCount: 0,
                skippedCount: 0,
                syncedEntries: [],
                issues: [],
            };
        }

        const summary: FotosSharedFileImportSummary = {
            batchCount: batches.length,
            requestedCount: 0,
            syncedCount: 0,
            skippedCount: 0,
            syncedEntries: [],
            issues: [],
        };

        for (const batch of batches) {
            summary.requestedCount += batch.items.length;
            const result = await this.syncSharedFileItems(batch.items);
            summary.syncedCount += result.syncedCount;
            summary.skippedCount += result.skippedCount;
            summary.syncedEntries.push(...result.syncedEntries);
            summary.issues.push(...result.issues);

            if (result.skippedCount === 0) {
                deleteFotosShareInboxBatch(batch);
            }
        }

        return summary;
    }

    private async syncAssetRefs(
        assetRefs: MediaLibrary.AssetRef[],
        permission: MediaLibrary.PermissionResponse,
    ): Promise<FotosPhotoLibrarySyncSummary> {
        const syncedEntries: FotosPhotoLibrarySyncSummary['syncedEntries'] = [];
        const issues: FotosPhotoLibrarySyncIssue[] = [];

        for (const assetRef of assetRefs) {
            const outcome = await this.syncAsset(assetRef);
            if (outcome.status === 'synced') {
                syncedEntries.push(outcome.result);
            } else {
                issues.push(outcome.issue);
            }
        }

        return {
            permissionGranted: true,
            accessPrivileges: permission.accessPrivileges ?? null,
            requestedCount: assetRefs.length,
            syncedCount: syncedEntries.length,
            skippedCount: issues.length,
            syncedEntries,
            issues,
        };
    }

    private async ensurePermission(): Promise<MediaLibrary.PermissionResponse> {
        const existing = await MediaLibrary.getPermissionsAsync(false, ['photo']);
        if (existing.granted) {
            return existing;
        }
        return MediaLibrary.requestPermissionsAsync(false, ['photo']);
    }

    private async syncAsset(assetRef: MediaLibrary.AssetRef): Promise<AssetSyncOutcome> {
        let assetInfo: MediaLibrary.AssetInfo;
        try {
            assetInfo = await MediaLibrary.getAssetInfoAsync(assetRef, {
                shouldDownloadFromNetwork: false,
            });
        } catch (error) {
            const assetId = typeof assetRef === 'string' ? assetRef : assetRef.id;
            return {
                status: 'skipped',
                issue: {
                    assetId,
                    filename: typeof assetRef === 'string' ? assetRef : assetRef.filename,
                    reason: `Failed to resolve asset info: ${error instanceof Error ? error.message : String(error)}`,
                },
            };
        }
        const asset = assetInfo;

        if (assetInfo.isNetworkAsset && !assetInfo.localUri) {
            return {
                status: 'skipped',
                issue: createIssue(asset, 'Asset is only available in iCloud and has no local bytes yet.'),
            };
        }

        if (!assetInfo.localUri || !assetInfo.localUri.startsWith('file://')) {
            return {
                status: 'skipped',
                issue: createIssue(asset, 'Asset did not expose a readable local file URI.'),
            };
        }

        let bytes: Uint8Array;
        try {
            bytes = await this.readLocalBytes(assetInfo.localUri);
        } catch (error) {
            return {
                status: 'skipped',
                issue: createIssue(
                    asset,
                    `Failed to read asset bytes: ${error instanceof Error ? error.message : String(error)}`,
                ),
            };
        }

        let contentHash: string;
        try {
            contentHash = await this.computeContentHash(bytes);
        } catch (error) {
            return {
                status: 'skipped',
                issue: createIssue(
                    asset,
                    `Failed to compute content hash: ${error instanceof Error ? error.message : String(error)}`,
                ),
            };
        }

        try {
            const entry = buildEntryFromAsset({
                asset,
                assetInfo,
                contentHash,
                byteSize: bytes.byteLength,
            });
            const entryIdHash = await this.deps.calculateIdHashOfObj(entry as object) as SHA256IdHash<FotosEntry>;
            const existingEntry = await this.readVersionedObject<FotosEntry>(entryIdHash);

            const originalVariant = createFotosMediaVariant({
                contentHash,
                family: entryIdHash,
                role: 'original',
                mime: entry.mime,
                byteSize: entry.size,
                width: entry.exifWidth,
                height: entry.exifHeight,
                createdAt: entry.capturedAt ?? entry.updatedAt,
                label: asset.filename,
            });
            const variantResult = await this.deps.storeVersionedObject(originalVariant as object);
            const locatorResult = await this.storeLocalLocator(
                variantResult.idHash as SHA256IdHash<FotosMediaVariant>,
                asset.id,
                entry.updatedAt ?? entry.capturedAt,
            );
            const sourceState = await this.storeMobileLibrarySourceState({
                assetId: asset.id,
                filename: asset.filename,
                contentHash,
                updatedAt: entry.updatedAt ?? entry.capturedAt,
            });

            const mergedVariants = new Set(existingEntry?.variants ?? new Set<SHA256Hash<FotosMediaVariant>>());
            mergedVariants.add(variantResult.hash as SHA256Hash<FotosMediaVariant>);

            const mergedEntry: FotosEntry = {
                ...(existingEntry ?? {}),
                ...entry,
                streamId: existingEntry?.streamId ?? entry.streamId,
                variants: mergedVariants,
            };

            const entryResult = await this.deps.storeVersionedObject(mergedEntry as object);
            await this.addEntryToManifest(entryResult.hash as SHA256Hash<FotosEntry>);
            await appendFotosDeviceBookContent(this.deps, {
                deviceId: this.deps.getInstanceId() ?? 'ios',
                role: 'mobile',
                entries: [entryResult.hash as SHA256Hash<FotosEntry>],
                sourceIdHashes: [sourceState.sourceIdHash as any],
                entryIdHashes: [sourceState.entryIdHash as any],
                variants: [variantResult.hash as SHA256Hash<FotosMediaVariant>],
                locators: [locatorResult.hash],
            });
            await appendMediaBookContent(this.deps, {
                deviceId: this.deps.getInstanceId() ?? 'ios',
                sourceIdHashes: [sourceState.sourceIdHash],
                entryIdHashes: [sourceState.entryIdHash],
                sourceRefs: sourceState.sourceRef ? [sourceState.sourceRef] : undefined,
                artifactIdHashes: [
                    String(entryResult.idHash),
                    String(variantResult.idHash),
                    String(locatorResult.idHash),
                ],
            });

            return {
                status: 'synced',
                result: {
                    assetId: asset.id,
                    contentHash,
                },
            };
        } catch (error) {
            return {
                status: 'skipped',
                issue: createIssue(
                    asset,
                    `Failed to persist fotos objects: ${error instanceof Error ? error.message : String(error)}`,
                ),
            };
        }
    }

    private async syncSharedFileItems(items: FotosShareInboxQueuedItem[]): Promise<FotosSharedFileImportSummary> {
        const syncedEntries: FotosSharedFileImportSummary['syncedEntries'] = [];
        const issues: FotosSharedFileImportIssue[] = [];

        for (const item of items) {
            try {
                const bytes = await this.readLocalBytes(item.fileUri);
                const contentHash = await this.computeContentHash(bytes);
                const mime = item.mimeType ?? mimeFromFilename(item.originalName);
                const entry: FotosEntry = {
                    $type$: 'FotosEntry',
                    contentHash,
                    streamId: contentHash,
                    mime,
                    size: bytes.byteLength,
                    capturedAt: timestampOrNow(item.createdAt),
                    updatedAt: timestampOrNow(item.createdAt),
                };

                const entryIdHash = await this.deps.calculateIdHashOfObj(entry as object) as SHA256IdHash<FotosEntry>;
                const existingEntry = await this.readVersionedObject<FotosEntry>(entryIdHash);

                const originalVariant = createFotosMediaVariant({
                    contentHash,
                    family: entryIdHash,
                    role: 'original',
                    mime,
                    byteSize: entry.size,
                    createdAt: entry.capturedAt,
                    label: item.originalName,
                });
                const variantResult = await this.deps.storeVersionedObject(originalVariant as object);
                const deviceId = this.deps.getInstanceId();

                const locator = createFotosMediaLocator({
                    variant: variantResult.idHash as SHA256IdHash<FotosMediaVariant>,
                    platform: 'ios',
                    kind: 'filesystem-path',
                    scope: 'shared-cache',
                    locator: item.fileUri,
                    ...(deviceId ? { deviceId } : {}),
                    lastVerifiedAt: entry.updatedAt,
                });
                const locatorResult = await this.deps.storeVersionedObject(locator as object);
                const sourceState = await this.storeShareIntentSourceState({
                    locator: item.fileUri,
                    filename: item.originalName,
                    contentHash,
                    batchId: item.batchId,
                    updatedAt: entry.updatedAt,
                });

                const mergedVariants = new Set(existingEntry?.variants ?? new Set<SHA256Hash<FotosMediaVariant>>());
                mergedVariants.add(variantResult.hash as SHA256Hash<FotosMediaVariant>);

                const mergedEntry: FotosEntry = {
                    ...(existingEntry ?? {}),
                    ...entry,
                    streamId: existingEntry?.streamId ?? entry.streamId,
                    variants: mergedVariants,
                };

                const entryResult = await this.deps.storeVersionedObject(mergedEntry as object);
                await this.addEntryToManifest(entryResult.hash as SHA256Hash<FotosEntry>);
                await appendFotosDeviceBookContent(this.deps, {
                    deviceId: deviceId ?? 'ios',
                    role: 'mobile',
                    entries: [entryResult.hash as SHA256Hash<FotosEntry>],
                    sourceIdHashes: [sourceState.sourceIdHash as any],
                    entryIdHashes: [sourceState.entryIdHash as any],
                    variants: mergedVariants,
                    locators: [locatorResult.hash as SHA256Hash<FotosMediaLocator>],
                });
                await appendMediaBookContent(this.deps, {
                    deviceId: deviceId ?? 'ios',
                    sourceIdHashes: [sourceState.sourceIdHash],
                    entryIdHashes: [sourceState.entryIdHash],
                    sourceRefs: sourceState.sourceRef ? [sourceState.sourceRef] : undefined,
                    artifactIdHashes: [
                        String(entryResult.idHash),
                        String(variantResult.idHash),
                        String(locatorResult.idHash),
                    ],
                });

                syncedEntries.push({
                    locator: item.fileUri,
                    contentHash,
                });
            } catch (error) {
                issues.push({
                    locator: item.fileUri,
                    filename: item.originalName,
                    reason: error instanceof Error ? error.message : String(error),
                });
            }
        }

        return {
            batchCount: new Set(items.map((item) => item.batchId)).size,
            requestedCount: items.length,
            syncedCount: syncedEntries.length,
            skippedCount: issues.length,
            syncedEntries,
            issues,
        };
    }

    private async readLocalBytes(localUri: string): Promise<Uint8Array> {
        const encoded = await readAsStringAsync(localUri, {
            encoding: EncodingType.Base64,
        });
        return decodeBase64(encoded);
    }

    private async computeContentHash(bytes: Uint8Array): Promise<string> {
        const normalized = normalizeImageBytesForContentHash(bytes);
        const digestInputBuffer = new ArrayBuffer(normalized.byteLength);
        const digestInput = new Uint8Array(digestInputBuffer);
        digestInput.set(normalized);
        const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, digestInput);
        return toHex(digest);
    }

    private async storeLocalLocator(
        variant: SHA256IdHash<FotosMediaVariant>,
        phAssetId: string,
        lastVerifiedAt?: string,
    ): Promise<{ hash: SHA256Hash<FotosMediaLocator>; idHash: SHA256IdHash<FotosMediaLocator> }> {
        const deviceId = this.deps.getInstanceId();
        const locator = createFotosMediaLocator({
            variant,
            platform: 'ios',
            kind: 'phasset',
            scope: 'device-local',
            locator: phAssetId,
            ...(deviceId ? { deviceId } : {}),
            ...(lastVerifiedAt ? { lastVerifiedAt } : {}),
        });

        const stored = await this.deps.storeVersionedObject(locator as object);
        return {
            hash: stored.hash as SHA256Hash<FotosMediaLocator>,
            idHash: stored.idHash as SHA256IdHash<FotosMediaLocator>,
        };
    }

    private async storeMobileLibrarySourceState(params: {
        assetId: string;
        filename: string;
        contentHash: string;
        updatedAt?: string;
    }): Promise<{ sourceIdHash: string; entryIdHash: string; sourceRef: string }> {
        const deviceId = this.deps.getInstanceId() ?? CURRENT_PLATFORM;
        const source = createMediaSource({
            family: 'mobile-library',
            locator: 'expo-media-library',
            platform: CURRENT_PLATFORM,
            deviceId,
            title: `${CURRENT_PLATFORM} Photo Library`,
        });
        const storedSource = await this.deps.storeVersionedObject(source as object);
        const sourceEntry = createMediaSourceEntry({
            sourceId: source.id,
            sourceIdHash: storedSource.idHash,
            entryKind: 'mobile-asset',
            locator: params.assetId,
            title: params.filename,
            summary: `${CURRENT_PLATFORM} media library asset`,
            contentHash: params.contentHash,
            metadata: {
                platform: CURRENT_PLATFORM,
                updatedAt: params.updatedAt ?? null,
            },
            updatedAt: params.updatedAt ? Date.parse(params.updatedAt) || undefined : undefined,
        });
        const storedEntry = await this.deps.storeVersionedObject(sourceEntry as object);
        return {
            sourceIdHash: storedSource.idHash,
            entryIdHash: storedEntry.idHash,
            sourceRef: String(sourceEntry.sourceRef ?? ''),
        };
    }

    private async storeShareIntentSourceState(params: {
        locator: string;
        filename: string;
        contentHash: string;
        batchId: string;
        updatedAt?: string;
    }): Promise<{ sourceIdHash: string; entryIdHash: string; sourceRef: string }> {
        const deviceId = this.deps.getInstanceId() ?? CURRENT_PLATFORM;
        const source = createMediaSource({
            family: 'share-intent',
            locator: params.batchId,
            platform: CURRENT_PLATFORM,
            deviceId,
            title: `${CURRENT_PLATFORM} Share Intent`,
        });
        const storedSource = await this.deps.storeVersionedObject(source as object);
        const sourceEntry = createMediaSourceEntry({
            sourceId: source.id,
            sourceIdHash: storedSource.idHash,
            entryKind: 'shared-file',
            locator: params.locator,
            title: params.filename,
            summary: `${CURRENT_PLATFORM} shared import`,
            contentHash: params.contentHash,
            metadata: {
                batchId: params.batchId,
                platform: CURRENT_PLATFORM,
                updatedAt: params.updatedAt ?? null,
            },
            updatedAt: params.updatedAt ? Date.parse(params.updatedAt) || undefined : undefined,
        });
        const storedEntry = await this.deps.storeVersionedObject(sourceEntry as object);
        return {
            sourceIdHash: storedSource.idHash,
            entryIdHash: storedEntry.idHash,
            sourceRef: String(sourceEntry.sourceRef ?? ''),
        };
    }

    private async readVersionedObject<T>(idHash: string): Promise<T | null> {
        try {
            const existing = await this.deps.getObjectByIdHash(idHash);
            return existing.obj as T;
        } catch {
            return null;
        }
    }

    private async getManifestIdHash(): Promise<SHA256IdHash<FotosManifest>> {
        if (this.manifestIdHash) {
            return this.manifestIdHash;
        }

        this.manifestIdHash = await this.deps.calculateIdHashOfObj({
            $type$: 'FotosManifest',
            id: 'fotos',
            entries: new Set(),
            authenticityAttestations: new Set(),
        }) as SHA256IdHash<FotosManifest>;

        return this.manifestIdHash;
    }

    private async ensureFotosManifest(): Promise<SHA256IdHash<FotosManifest>> {
        const manifestIdHash = await this.getManifestIdHash();
        const existing = await this.readVersionedObject<FotosManifest>(manifestIdHash);
        if (existing) {
            return manifestIdHash;
        }

        await this.deps.storeVersionedObject({
            $type$: 'FotosManifest',
            id: 'fotos',
            entries: new Set(),
            authenticityAttestations: new Set(),
        });

        return manifestIdHash;
    }

    private async addEntryToManifest(entryHash: SHA256Hash<FotosEntry>): Promise<void> {
        const manifestIdHash = await this.ensureFotosManifest();
        const existingManifest = await this.readVersionedObject<FotosManifest>(manifestIdHash);
        const manifest = existingManifest ?? {
            $type$: 'FotosManifest' as const,
            id: 'fotos',
            entries: new Set<SHA256Hash<FotosEntry>>(),
            authenticityAttestations: new Set(),
        };

        const entries = new Set(manifest.entries);
        if (entries.has(entryHash)) {
            return;
        }

        entries.add(entryHash);

        await this.deps.storeVersionedObject({
            $type$: 'FotosManifest',
            id: 'fotos',
            entries,
            authenticityAttestations: new Set(manifest.authenticityAttestations ?? []),
        });
    }
}
