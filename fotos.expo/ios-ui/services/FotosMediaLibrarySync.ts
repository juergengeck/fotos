import * as Crypto from 'expo-crypto';
import { EncodingType, readAsStringAsync, deleteAsync } from 'expo-file-system/legacy';
import {manipulateAsync, SaveFormat} from 'expo-image-manipulator';
import * as MediaLibrary from 'expo-media-library';
import { Platform } from 'react-native';
import {
    appendFotosDeviceBookContent,
    createFotosMediaLocator,
    createFotosMediaVariant,
    normalizeImageBytesForContentHash,
    matchesImageContentHash,
    getOwnedFotosManifestId,
    makeFotosDeviceBookId,
    type FotosDeviceBook,
    type FotosMediaSubtype,
    recordFotosAcquisition,
    type FotosEntry,
    type FotosManifest,
    type FotosMediaLocator,
    type FotosMediaVariant,
} from '@refinio/fotos.core';
import {FOTOS_THUMBNAIL_MAX_EDGE, readFotosThumbnailDimensions} from '@refinio/fotos.core/filesystem';
import {
    appendMediaBookContent,
    createMediaSource,
    createMediaSourceEntry,
} from '../../../../one/packages/source.media/src/services/MediaSourceService.js';
import {createAccess} from '@refinio/one.core/lib/access.js';
import {SET_ACCESS_MODE} from '@refinio/one.core/lib/storage-base-common.js';
import {getObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {storeArrayBufferAsBlob} from '@refinio/one.core/lib/storage-blob.js';
import type {BLOB, Person} from '@refinio/one.core/lib/recipes.js';
import type { SHA256Hash, SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import {
    deleteFotosShareInboxBatch,
    getFotosShareInboxStatus,
    readFotosShareInboxBatches,
    type FotosShareInboxQueuedItem,
    type FotosShareInboxStatus,
} from './FotosShareInbox';

const DEFAULT_RECENT_LIMIT = 12;
// Serialize the read/merge/write publication sequence across service instances.
let publications: Promise<void> = Promise.resolve();
function publishSerially<T>(work: () => Promise<T>): Promise<T> {
    const next = publications.then(work);
    publications = next.then(() => undefined, () => undefined);
    return next;
}
export type FotosIntakeMode = 'reference' | 'metadata' | 'ingest';
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
    getOwnerId: () => string | undefined;
    getIntakeMode?: () => FotosIntakeMode | Promise<FotosIntakeMode>;
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
    if (value === undefined || !Number.isFinite(value)) {
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
        const raw = exif[key];
        const value = Array.isArray(raw) ? raw[0] : raw;
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

function fileExtension(filename: string): string {
    return filename.match(/\.([a-z0-9]{1,10})$/i)?.[1].toLowerCase() ?? 'jpg';
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
    // iOS exposes ImageIO namespaces; Android/older Expo versions expose flat EXIF.
    const rawExif = getExifRecord(assetInfo.exif);
    const exif = {...getExifRecord(rawExif['{TIFF}'] ?? rawExif.TIFF),
        ...getExifRecord(rawExif['{ExifAux}'] ?? rawExif.ExifAux),
        ...getExifRecord(rawExif['{Exif}'] ?? rawExif.Exif), ...rawExif};
    const gps = getExifRecord(rawExif['{GPS}'] ?? rawExif.GPS);
    const cameraMake = getExifString(exif, ['Make']);
    const cameraModel = getExifString(exif, ['Model']);
    const camera = [cameraMake, cameraModel].filter(Boolean).join(' ').trim();
    const reportedLat = getExifNumber(exif, ['GPSLatitude', 'latitude']) ?? getExifNumber(gps, ['Latitude']);
    const reportedLon = getExifNumber(exif, ['GPSLongitude', 'longitude']) ?? getExifNumber(gps, ['Longitude']);
    const gpsLat = assetInfo.location?.latitude ?? (reportedLat === undefined ? undefined
        : getExifString(gps, ['LatitudeRef']) === 'S' ? -Math.abs(reportedLat) : reportedLat);
    const gpsLon = assetInfo.location?.longitude ?? (reportedLon === undefined ? undefined
        : getExifString(gps, ['LongitudeRef']) === 'W' ? -Math.abs(reportedLon) : reportedLon);
    const subtypeNames: Partial<Record<MediaLibrary.MediaSubtype, FotosMediaSubtype>> = {
        livePhoto: 'live-photo', hdr: 'hdr', panorama: 'panorama', screenshot: 'screenshot',
        depthEffect: 'depth', highFrameRate: 'high-frame-rate', videoCinematic: 'cinematic',
    };
    const mediaSubtypes = new Set((asset.mediaSubtypes ?? []).flatMap(value => subtypeNames[value] ? [subtypeNames[value]!] : []));
    const reportedAltitude = getExifNumber(exif, ['GPSAltitude', 'altitude']) ?? getExifNumber(gps, ['Altitude']);
    const altitude = reportedAltitude === undefined ? undefined
        : getExifNumber(gps, ['AltitudeRef']) === 1 ? -Math.abs(reportedAltitude) : reportedAltitude;
    const orientation = assetInfo.orientation ?? getExifNumber(exif, ['Orientation']);

    const entry: FotosEntry = {
        $type$: 'FotosEntry',
        contentHash,
        streamId: contentHash,
        mime: mimeFromFilename(asset.filename),
        size: byteSize,
        sourcePath: `Photo Library/${contentHash}.${fileExtension(asset.filename)}`,
        folderPath: 'Photo Library',
        originalFilename: asset.filename,
        ...(Number.isFinite(asset.duration) && asset.duration >= 0 ? {duration: asset.duration} : {}),
        ...(typeof assetInfo.isFavorite === 'boolean' ? {favorite: assetInfo.isFavorite} : {}),
        ...(mediaSubtypes.size ? {mediaSubtypes} : {}),
        ...(altitude !== undefined ? {exifGpsAlt: altitude} : {}),
        ...(orientation !== undefined ? {orientation} : {}),
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
    private readonly localAssets = new Map<string, Set<string>>();

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
        return publishSerially(() => this.importSharedInbox());
    }

    private async importSharedInbox(): Promise<FotosSharedFileImportSummary> {
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
                await deleteFotosShareInboxBatch(batch);
            }
        }

        return summary;
    }

    private async syncAssetRefs(
        assetRefs: MediaLibrary.AssetRef[],
        permission: MediaLibrary.PermissionResponse,
    ): Promise<FotosPhotoLibrarySyncSummary> {
        return publishSerially(() => this.syncAssetRefsSerially(assetRefs, permission));
    }

    private async syncAssetRefsSerially(
        assetRefs: MediaLibrary.AssetRef[], permission: MediaLibrary.PermissionResponse,
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

            const observer = this.requireOwner();
            const mode = await this.deps.getIntakeMode?.() ?? 'reference';
            const originalBlob = mode === 'ingest' ? await storeArrayBufferAsBlob(bytes) : undefined;
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
                ...(originalBlob ? {blob: originalBlob.hash} : {}),
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

            const thumbnail = await this.storeThumbnail(assetInfo.localUri, asset, entryIdHash,
                variantResult.idHash as SHA256IdHash<FotosMediaVariant>);
            const mergedVariants = new Set(existingEntry?.variants ?? new Set<SHA256Hash<FotosMediaVariant>>());
            mergedVariants.add(variantResult.hash as SHA256Hash<FotosMediaVariant>);
            mergedVariants.add(thumbnail.hash as SHA256Hash<FotosMediaVariant>);

            const mergedEntry: FotosEntry = {
                ...(existingEntry ?? {}),
                ...entry,
                streamId: existingEntry?.streamId ?? entry.streamId,
                thumb: thumbnail.blob,
                variants: mergedVariants,
            };

            mergedEntry.acquisitionObservations = new Set([
                ...(existingEntry?.acquisitionObservations ?? []),
                await recordFotosAcquisition({
                    observer: observer as SHA256IdHash<Person>,
                    originalVariant: variantResult.hash as SHA256Hash<FotosMediaVariant>,
                    context: {
                        acquiredAt: Date.now(), surface: 'mobile-library', source: asset.id,
                        ...(entry.capturedAt ? {reportedCaptureTime: entry.capturedAt} : {}),
                        ...(entry.exifCamera ? {reportedCamera: entry.exifCamera} : {}),
                        ...(entry.exifGpsLat !== undefined ? {reportedGpsLat: entry.exifGpsLat} : {}),
                        ...(entry.exifGpsLon !== undefined ? {reportedGpsLon: entry.exifGpsLon} : {}),
                    },
                }),
            ]);
            const entryResult = await this.deps.storeVersionedObject(mergedEntry as object);
            await appendFotosDeviceBookContent(this.deps, {
                deviceId: this.deps.getInstanceId() ?? 'ios',
                role: 'mobile',
                entries: [entryResult.hash as SHA256Hash<FotosEntry>],
                sourceIdHashes: [sourceState.sourceIdHash as any],
                entryIdHashes: [sourceState.entryIdHash as any],
                variants: mergedVariants,
                locators: [locatorResult.hash],
            });
            await appendMediaBookContent(this.deps, {
                author: observer as SHA256IdHash<Person>,
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

            await this.addEntryToManifest(entryResult.hash as SHA256Hash<FotosEntry>);
            this.rememberLocalAsset(contentHash, asset.id);
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
                this.requireOwner();
                const bytes = await this.readLocalBytes(item.fileUri);
                const contentHash = await this.computeContentHash(bytes);
                const mime = item.mimeType ?? mimeFromFilename(item.originalName);
                const entry: FotosEntry = {
                    $type$: 'FotosEntry',
                    contentHash,
                    streamId: contentHash,
                    mime,
                    size: bytes.byteLength,
                    updatedAt: timestampOrNow(item.createdAt),
                    sourcePath: `Shared Files/${contentHash}.${fileExtension(item.originalName)}`,
                    folderPath: 'Shared Files',
                    originalFilename: item.originalName,
                };

                const entryIdHash = await this.deps.calculateIdHashOfObj(entry as object) as SHA256IdHash<FotosEntry>;
                const existingEntry = await this.readVersionedObject<FotosEntry>(entryIdHash);

                const originalBlob = await storeArrayBufferAsBlob(bytes);
                const originalVariant = createFotosMediaVariant({
                    contentHash,
                    family: entryIdHash,
                    role: 'original',
                    mime,
                    byteSize: entry.size,
                    createdAt: entry.capturedAt,
                    label: item.originalName,
                    blob: originalBlob.hash,
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

                const observer = this.deps.getOwnerId();
                if (!observer) throw new Error('Fotos acquisition requires the local owner identity');
                mergedEntry.acquisitionObservations = new Set([
                    ...(existingEntry?.acquisitionObservations ?? []),
                    await recordFotosAcquisition({
                        observer: observer as SHA256IdHash<Person>,
                        originalVariant: variantResult.hash as SHA256Hash<FotosMediaVariant>,
                        context: {acquiredAt: Date.now(), surface: 'shared-file', source: item.fileUri},
                    }),
                ]);
                const entryResult = await this.deps.storeVersionedObject(mergedEntry as object);
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
                    author: observer as SHA256IdHash<Person>,
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

                await this.addEntryToManifest(entryResult.hash as SHA256Hash<FotosEntry>);
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
        return this.digestBytes(normalizeImageBytesForContentHash(bytes));
    }

    private async digestBytes(bytes: Uint8Array): Promise<string> {
        const digestInput = Uint8Array.from(bytes);
        return toHex(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, digestInput));
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
        } catch (error) {
            if (error instanceof Error && error.name === 'FileNotFoundError') return null;
            throw error;
        }
    }

    private requireOwner(): string {
        const owner = this.deps.getOwnerId();
        if (!owner) throw new Error('Fotos acquisition requires the local owner identity');
        getOwnedFotosManifestId(owner);
        return owner;
    }

    private rememberLocalAsset(contentHash: string, assetId: string): void {
        const ids = this.localAssets.get(contentHash) ?? new Set<string>();
        ids.add(assetId);
        this.localAssets.set(contentHash, ids);
    }

    /** Resolve Photos references after restart using the durable, device-local locator DAG.
     * Expo currently bridges whole files through base64; streaming requires the PhotoKit module.
     * Never download iCloud originals implicitly or trust a localIdentifier as content identity.
     */
    async resolveOriginal(entry: FotosEntry): Promise<ArrayBuffer> {
        const deviceId = this.deps.getInstanceId();
        if (!deviceId) throw new Error('Fotos original resolution requires the local device identity');
        if (!this.localAssets.has(entry.contentHash)) {
            const bookId = await this.deps.calculateIdHashOfObj({$type$: 'FotosDeviceBook', id: makeFotosDeviceBookId(deviceId)});
            const book = await this.readVersionedObject<FotosDeviceBook>(bookId);
            for (const hash of book?.locators ?? []) {
                const locator = await getObject(hash) as FotosMediaLocator;
                if (locator.kind !== 'phasset' || locator.scope !== 'device-local' || locator.platform !== 'ios'
                    || locator.deviceId !== deviceId) continue;
                const variant = await this.readVersionedObject<FotosMediaVariant>(locator.variant);
                if (variant?.role === 'original') this.rememberLocalAsset(variant.contentHash, locator.locator);
            }
        }
        for (const id of this.localAssets.get(entry.contentHash) ?? []) {
            try {
                const info = await MediaLibrary.getAssetInfoAsync(id, {shouldDownloadFromNetwork: false});
                if (!info.localUri?.startsWith('file://')) continue;
                const bytes = await this.readLocalBytes(info.localUri);
                if (!await matchesImageContentHash(bytes, entry.contentHash, value => this.digestBytes(value))) continue;
                return Uint8Array.from(bytes).buffer;
            } catch {
                // A removed/unavailable local copy must not hide another verified copy.
                continue;
            }
        }
        throw new Error('No verified local Photos original is available for this contentHash');
    }

    private async storeThumbnail(uri: string, asset: MediaLibrary.Asset,
        family: SHA256IdHash<FotosEntry>, original: SHA256IdHash<FotosMediaVariant>,
    ): Promise<StoredVersionedObject & {blob: SHA256Hash<BLOB>}> {
        if (asset.width <= 0 || asset.height <= 0) throw new Error('Cannot size Photos thumbnail without image dimensions');
        const maxEdge = Math.max(asset.width, asset.height);
        const resize = maxEdge > FOTOS_THUMBNAIL_MAX_EDGE
            ? [{resize: {width: Math.max(1, Math.round(asset.width * FOTOS_THUMBNAIL_MAX_EDGE / maxEdge)),
                height: Math.max(1, Math.round(asset.height * FOTOS_THUMBNAIL_MAX_EDGE / maxEdge))}}] : [];
        const result = await manipulateAsync(uri, resize, {format: SaveFormat.JPEG, compress: 0.75, base64: true});
        try {
            if (!result.base64 || result.width < 1 || result.height < 1 || result.width > FOTOS_THUMBNAIL_MAX_EDGE || result.height > FOTOS_THUMBNAIL_MAX_EDGE) {
                throw new Error('Image manipulator did not return a bounded thumbnail');
            }
            const bytes = decodeBase64(result.base64);
            const dimensions = readFotosThumbnailDimensions(bytes);
            if (dimensions.width !== result.width || dimensions.height !== result.height) {
                throw new Error('Thumbnail frame does not match native image dimensions');
            }
            const blob = await storeArrayBufferAsBlob(bytes);
            const variant = await this.deps.storeVersionedObject(createFotosMediaVariant({
                contentHash: await this.digestBytes(bytes), family, role: 'thumbnail', mime: 'image/jpeg',
                byteSize: bytes.byteLength, width: result.width, height: result.height, blob: blob.hash, derivedFrom: original,
            }));
            return {...variant, blob: blob.hash};
        } finally {
            if (result.uri !== uri) await deleteAsync(result.uri, {idempotent: true});
        }
    }

    private async addEntryToManifest(entryHash: SHA256Hash<FotosEntry>): Promise<void> {
        const owner = this.requireOwner();
        const id = getOwnedFotosManifestId(owner);
        const manifestIdHash = await this.deps.calculateIdHashOfObj({$type$: 'FotosManifest', id});
        const manifest = await this.readVersionedObject<FotosManifest>(manifestIdHash);
        // The legacy global root may contain peer-owned entries. Preserve it untouched;
        // never republish its contents under the current owner's authority without evidence.
        const entries = new Set(manifest?.entries ?? []);
        entries.add(entryHash);
        await createAccess([{id: manifestIdHash as SHA256IdHash<FotosManifest>,
            person: [owner as SHA256IdHash<Person>], hashGroup: [], mode: SET_ACCESS_MODE.ADD}]);
        await this.deps.storeVersionedObject({
            ...(manifest ?? {}), $type$: 'FotosManifest', id, entries,
            authenticityAttestations: new Set(manifest?.authenticityAttestations ?? []),
        });
    }
}
