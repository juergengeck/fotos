import * as Crypto from 'expo-crypto';
import {File} from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { Platform } from 'react-native';
import {
    appendFotosDeviceBookContent,
    applyGalleryDelta,
    createFotosManualCollection,
    createFotosMediaLocator,
    createFotosMediaVariant,
    normalizeImageBytesForContentHash,
    matchesImageContentHash,
    getOwnedFotosManifestId,
    isFotosManualCollectionForOwner,
    MAX_FOTOS_COLLECTION_MEMBERS,
    MAX_FOTOS_ENTRY_TAGS,
    MAX_FOTOS_TAG_LENGTH,
    makeFotosDeviceBookId,
    projectFotosEntryReferences,
    type FotosDeviceBook,
    type FotosCollection,
    type FotosGalleryAlbumBinding,
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
} from '@refinio/source.media';
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
import {getFotosPhotoKit, type FotosPhotoKitAsset, type FotosPhotoKitChange, type FotosPhotoKitNative} from './FotosPhotoKit';
import {reconcileFotosPhotoKitAlbums} from './FotosPhotoKitAlbums';
import {visitFotosPhotoKitPages} from './FotosPhotoKitPaging';
import {shareFotosMobileCollection} from './FotosMobileCollectionShare';

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

export function isEditableFotosCollection(owner: string | undefined, id: string): boolean {
    return owner !== undefined && isFotosManualCollectionForOwner(id, owner);
}

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
    deferredAssets: FotosDeferredPhotoKitAsset[];
    issues: FotosPhotoLibrarySyncIssue[];
    albumSyncError?: string;
}

export interface FotosDeferredPhotoKitAsset {
    asset: FotosPhotoKitAsset;
    status: 'icloud-deferred';
    thumbnailUri?: string;
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
    | { status: 'icloud-deferred'; result: FotosDeferredPhotoKitAsset }
    | { status: 'skipped'; issue: FotosPhotoLibrarySyncIssue };

function toHex(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let hex = '';
    for (const value of bytes) {
        hex += value.toString(16).padStart(2, '0');
    }
    return hex;
}

function deleteTemporaryFile(uri: string): void {
    try {
        const file = new File(uri);
        if (file.exists) file.delete();
    } catch (error) {
        console.warn('[FotosPhotoKit] Temporary file cleanup failed', error);
    }
}

async function readTemporaryBytes(uri: string): Promise<Uint8Array> {
    try {
        return await new File(uri).bytes();
    } finally {
        deleteTemporaryFile(uri);
    }
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
    if (lower.endsWith('.heic')) return 'image/heic';
    if (lower.endsWith('.heif')) return 'image/heif';
    if (lower.endsWith('.avif')) return 'image/avif';
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.gif')) return 'image/gif';
    if (lower.endsWith('.tif') || lower.endsWith('.tiff')) return 'image/tiff';
    if (lower.endsWith('.dng')) return 'image/x-adobe-dng';
    if (lower.endsWith('.mov')) return 'video/quicktime';
    if (lower.endsWith('.mp4')) return 'video/mp4';
    if (lower.endsWith('.m4v')) return 'video/x-m4v';
    return 'image/jpeg';
}

function fileExtension(filename: string): string {
    return filename.match(/\.([a-z0-9]{1,10})$/i)?.[1].toLowerCase() ?? 'jpg';
}

function timestampOrNow(value: string | undefined): string {
    return value ?? new Date().toISOString();
}

function createIssue(asset: Pick<FotosPhotoKitAsset, 'id' | 'filename'>, reason: string): FotosPhotoLibrarySyncIssue {
    return {
        assetId: asset.id,
        filename: asset.filename,
        reason,
    };
}

export function buildEntryFromAsset(params: {
    asset: FotosPhotoKitAsset;
    contentHash: string;
    byteSize: number;
}): FotosEntry {
    const {asset, contentHash, byteSize} = params;
    const rawExif = getExifRecord(asset.exif);
    const exif = {...getExifRecord(rawExif['{TIFF}'] ?? rawExif.TIFF),
        ...getExifRecord(rawExif['{ExifAux}'] ?? rawExif.ExifAux),
        ...getExifRecord(rawExif['{Exif}'] ?? rawExif.Exif), ...rawExif};
    const gps = getExifRecord(rawExif['{GPS}'] ?? rawExif.GPS);
    const cameraMake = getExifString(exif, ['Make']);
    const cameraModel = getExifString(exif, ['Model']);
    const camera = [cameraMake, cameraModel].filter(Boolean).join(' ').trim();
    const reportedLat = getExifNumber(exif, ['GPSLatitude', 'latitude']) ?? getExifNumber(gps, ['Latitude']);
    const reportedLon = getExifNumber(exif, ['GPSLongitude', 'longitude']) ?? getExifNumber(gps, ['Longitude']);
    const gpsLat = asset.location?.latitude ?? (reportedLat === undefined ? undefined
        : getExifString(gps, ['LatitudeRef']) === 'S' ? -Math.abs(reportedLat) : reportedLat);
    const gpsLon = asset.location?.longitude ?? (reportedLon === undefined ? undefined
        : getExifString(gps, ['LongitudeRef']) === 'W' ? -Math.abs(reportedLon) : reportedLon);
    const mediaSubtypes = new Set(asset.mediaSubtypes);
    const reportedAltitude = getExifNumber(exif, ['GPSAltitude', 'altitude']) ?? getExifNumber(gps, ['Altitude']);
    const altitude = asset.location?.altitude ?? (reportedAltitude === undefined ? undefined
        : getExifNumber(gps, ['AltitudeRef']) === 1 ? -Math.abs(reportedAltitude) : reportedAltitude);
    const orientation = getExifNumber(exif, ['Orientation']);

    const entry: FotosEntry = {
        $type$: 'FotosEntry',
        contentHash,
        streamId: contentHash,
        mime: asset.mimeType ?? mimeFromFilename(asset.filename),
        size: byteSize,
        sourcePath: `Photo Library/${contentHash}.${fileExtension(asset.filename)}`,
        folderPath: 'Photo Library',
        originalFilename: asset.filename,
        ...(Number.isFinite(asset.duration) && asset.duration >= 0 ? {duration: asset.duration} : {}),
        favorite: asset.favorite,
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
    private readonly albumAssetHashes = new Map<string, string>();
    private readonly assetVerificationTimes = new Map<string, string>();
    private readonly deferredAssets = new Map<string, FotosDeferredPhotoKitAsset>();
    private localAssetLoad?: Promise<void>;
    private subscription?: {remove(): void};
    private pendingWork: Promise<void> = Promise.resolve();
    private closed = false;

    constructor(private readonly deps: FotosMediaLibrarySyncDeps) {}

    async syncRecentAssets(limit: number = DEFAULT_RECENT_LIMIT): Promise<FotosPhotoLibrarySyncSummary> {
        return this.syncAfterPermission(0, async native => {
            const count = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : DEFAULT_RECENT_LIMIT;
            if (!count) return [];
            const ids = new Set<string>();
            await visitFotosPhotoKitPages(
                (offset, cursor) => native.listAssets(offset, Math.min(200, count - ids.size), cursor),
                cursor => native.releaseCursor(cursor),
                page => {
                    if (!page.assets.length && page.nextOffset !== undefined) {
                        throw new Error('PhotoKit returned an empty continuing asset page');
                    }
                    for (const asset of page.assets) ids.add(asset.id);
                    return ids.size < count;
                },
            );
            return [...ids];
        });
    }

    async syncAssetIds(assetIds: string[], allowNetworkAccess = false): Promise<FotosPhotoLibrarySyncSummary> {
        const ids = [...new Set(assetIds.filter(assetId => assetId.length > 0))];
        return this.syncAfterPermission(ids.length, async () => ids, allowNetworkAccess);
    }

    private async syncAfterPermission(
        requestedCount: number,
        getIds: (native: FotosPhotoKitNative) => Promise<string[]>,
        allowNetworkAccess = false,
    ): Promise<FotosPhotoLibrarySyncSummary> {
        const empty = {permissionGranted: false, accessPrivileges: null, requestedCount, syncedCount: 0,
            skippedCount: 0, syncedEntries: [], deferredAssets: [], issues: []};
        if (CURRENT_PLATFORM !== 'ios') {
            return {...empty, skippedCount: 1, issues: [{
                assetId: 'platform', filename: 'photo-library', reason: 'Photo-library sync requires iOS.',
            }]};
        }
        const permission = await this.ensurePermission();
        if (!permission.granted) return {...empty, accessPrivileges: permission.accessPrivileges ?? null};
        const native = getFotosPhotoKit();
        if (this.closed) throw new Error('Photo-library sync has stopped');
        this.subscription ??= native.addListener('onLibraryChange', change => this.onLibraryChange(native, change));
        return this.enqueue(async () => this.syncAssetRefsSerially(native, await getIds(native), permission, allowNetworkAccess));
    }

    private enqueue<T>(work: () => Promise<T>): Promise<T> {
        const result = publishSerially(async () => {
            if (this.closed) throw new Error('Photo-library sync has stopped');
            return work();
        });
        this.pendingWork = result.then(() => undefined, () => undefined);
        return result;
    }

    async dispose(): Promise<void> {
        this.closed = true;
        this.subscription?.remove();
        this.subscription = undefined;
        await this.pendingWork;
        await this.localAssetLoad?.catch(() => undefined);
        for (const assetId of this.deferredAssets.keys()) this.clearDeferredAsset(assetId);
    }

    async getShareInboxStatus(): Promise<FotosShareInboxStatus> {
        return getFotosShareInboxStatus();
    }

    async importPendingSharedInbox(): Promise<FotosSharedFileImportSummary> {
        return this.enqueue(() => this.importSharedInbox());
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

    private async syncAssetRefsSerially(
        native: FotosPhotoKitNative,
        assetIds: string[],
        permission: MediaLibrary.PermissionResponse,
        allowNetworkAccess = false,
        refreshAlbums = true,
    ): Promise<FotosPhotoLibrarySyncSummary> {
        const syncedEntries: SyncedAssetResult[] = [];
        const deferredAssets: FotosDeferredPhotoKitAsset[] = [];
        const issues: FotosPhotoLibrarySyncIssue[] = [];
        try {
            await this.ensureLocalAssetIndex();
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            return {
                permissionGranted: true,
                accessPrivileges: permission.accessPrivileges ?? null,
                requestedCount: assetIds.length,
                syncedCount: 0,
                skippedCount: assetIds.length,
                syncedEntries,
                deferredAssets,
                issues: assetIds.map(assetId => ({assetId, filename: assetId, reason})),
                albumSyncError: reason,
            };
        }
        let albumBindingsChanged = false;

        for (const assetId of assetIds) {
            const previousHash = this.albumAssetHashes.get(assetId);
            const outcome = await this.syncAsset(native, assetId, allowNetworkAccess);
            if (outcome.status === 'synced') {
                albumBindingsChanged ||= previousHash !== outcome.result.contentHash;
                syncedEntries.push(outcome.result);
            }
            else if (outcome.status === 'icloud-deferred') deferredAssets.push(outcome.result);
            else issues.push(outcome.issue);
        }

        let albumSyncError: string | undefined;
        try {
            if (refreshAlbums || albumBindingsChanged) await this.syncAlbums(native, permission.accessPrivileges === 'all');
        } catch (error) {
            albumSyncError = error instanceof Error ? error.message : String(error);
        }
        return {
            permissionGranted: true,
            accessPrivileges: permission.accessPrivileges ?? null,
            requestedCount: assetIds.length,
            syncedCount: syncedEntries.length,
            skippedCount: issues.length,
            syncedEntries,
            deferredAssets,
            issues,
            ...(albumSyncError ? {albumSyncError} : {}),
        };
    }

    private async ensurePermission(): Promise<MediaLibrary.PermissionResponse> {
        const existing = await MediaLibrary.getPermissionsAsync(false, ['photo', 'video']);
        return existing.granted ? existing : MediaLibrary.requestPermissionsAsync(false, ['photo', 'video']);
    }

    private async syncAsset(native: FotosPhotoKitNative, assetId: string, allowNetworkAccess: boolean): Promise<AssetSyncOutcome> {
        let original;
        try {
            original = await native.inspectOriginal(assetId, allowNetworkAccess, FOTOS_THUMBNAIL_MAX_EDGE);
        } catch (error) {
            return {status: 'skipped', issue: createIssue({id: assetId, filename: assetId},
                'Failed to inspect Photos original: ' + (error instanceof Error ? error.message : String(error)))};
        }
        const {asset} = original;
        if (original.status === 'icloud-deferred') {
            return {status: 'icloud-deferred', result: await this.deferAsset(native, asset)};
        }

        const {contentHash, byteSize} = original;
        let unconsumedThumbnail = original.thumbnailUri;
        try {
            if (!/^[a-f0-9]{64}$/.test(contentHash) || !Number.isSafeInteger(byteSize) || byteSize <= 0) {
                throw new Error('PhotoKit returned invalid media identity');
            }
            const entry = buildEntryFromAsset({asset, contentHash, byteSize});
            const entryIdHash = await this.deps.calculateIdHashOfObj(entry as object) as SHA256IdHash<FotosEntry>;
            const existingEntry = await this.readVersionedObject<FotosEntry>(entryIdHash);

            const observer = this.requireOwner();
            const mode = await this.deps.getIntakeMode?.() ?? 'reference';
            const originalBlob = mode === 'ingest'
                ? await storeArrayBufferAsBlob(await this.readVerifiedOriginal(native, asset.id, entry, allowNetworkAccess))
                : undefined;
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
            const verifiedAt = this.albumAssetHashes.get(asset.id) === contentHash
                ? this.assetVerificationTimes.get(asset.id) : new Date().toISOString();
            const locatorResult = await this.storeLocalLocator(
                variantResult.idHash as SHA256IdHash<FotosMediaVariant>,
                asset.id,
                verifiedAt,
            );
            const sourceState = await this.storeMobileLibrarySourceState({
                assetId: asset.id,
                filename: asset.filename,
                contentHash,
                updatedAt: entry.updatedAt ?? entry.capturedAt,
            });

            const thumbnailUri = asset.mediaType === 'video'
                ? await native.thumbnailFile(asset.id, FOTOS_THUMBNAIL_MAX_EDGE, allowNetworkAccess)
                : unconsumedThumbnail;
            unconsumedThumbnail = undefined;
            const thumbnail = thumbnailUri
                ? await this.storeThumbnail(thumbnailUri, entryIdHash, variantResult.idHash as SHA256IdHash<FotosMediaVariant>)
                : undefined;
            const mergedVariants = new Set(existingEntry?.variants ?? new Set<SHA256Hash<FotosMediaVariant>>());
            mergedVariants.add(variantResult.hash as SHA256Hash<FotosMediaVariant>);
            if (thumbnail) mergedVariants.add(thumbnail.hash as SHA256Hash<FotosMediaVariant>);

            const mergedEntry: FotosEntry = {
                ...applyGalleryDelta(existingEntry ?? undefined, {observed: entry}),
                ...(thumbnail ? {thumb: thumbnail.blob} : {}),
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
            this.albumAssetHashes.set(asset.id, contentHash);
            if (verifiedAt) this.assetVerificationTimes.set(asset.id, verifiedAt);
            this.clearDeferredAsset(asset.id);
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
        } finally {
            if (unconsumedThumbnail) deleteTemporaryFile(unconsumedThumbnail);
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

    private readLocalBytes(localUri: string): Promise<Uint8Array> {
        return new File(localUri).bytes();
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

    private async ensureLocalAssetIndex(): Promise<void> {
        this.localAssetLoad ??= this.loadLocalAssetIndex().catch(error => {
            this.localAssetLoad = undefined;
            throw error;
        });
        await this.localAssetLoad;
    }

    private async loadLocalAssetIndex(): Promise<void> {
        const deviceId = this.deps.getInstanceId();
        if (!deviceId) throw new Error('PhotoKit requires the local device identity');
        const bookId = await this.deps.calculateIdHashOfObj({$type$: 'FotosDeviceBook', id: makeFotosDeviceBookId(deviceId)});
        const book = await this.readVersionedObject<FotosDeviceBook>(bookId);
        for (const hash of book?.locators ?? []) {
            const locator = await getObject(hash);
            if (locator.kind !== 'phasset' || locator.scope !== 'device-local' || locator.platform !== 'ios'
                || locator.deviceId !== deviceId) continue;
            const variant = await this.readVersionedObject<FotosMediaVariant>(locator.variant);
            if (variant?.role !== 'original') continue;
            this.rememberLocalAsset(variant.contentHash, locator.locator);

            const currentHash = this.albumAssetHashes.get(locator.locator);
            const currentTime = this.assetVerificationTimes.get(locator.locator) ?? '';
            const lastVerifiedAt = locator.lastVerifiedAt ?? '';
            if (!currentHash || lastVerifiedAt > currentTime || (lastVerifiedAt === currentTime && variant.contentHash < currentHash)) {
                this.albumAssetHashes.set(locator.locator, variant.contentHash);
                this.assetVerificationTimes.set(locator.locator, lastVerifiedAt);
            }
        }
    }

    async getLocalPhotoHashes(): Promise<ReadonlyMap<string, string>> {
        await this.ensureLocalAssetIndex();
        return new Map(this.albumAssetHashes);
    }

    async addPhotoTag(contentHash: string, value: string): Promise<void> {
        const tag = value.normalize('NFC').trim().replace(/\s+/g, ' ');
        if (!tag || tag.length > MAX_FOTOS_TAG_LENGTH) throw new Error(`Enter a tag of up to ${MAX_FOTOS_TAG_LENGTH} characters.`);
        return this.enqueue(async () => {
            const owner = this.requireOwner();
            const {manifest, manifestId} = await this.requireOwnedManifest(owner);
            const references = [];
            const tags = new Set<string>();
            for (const hash of manifest.entries) {
                const entry = await getObject(hash);
                if (entry.contentHash !== contentHash) continue;
                references.push({hash, entry});
                for (const label of entry.tags ?? []) tags.add(label);
            }
            const selected = projectFotosEntryReferences(references)[0];
            if (!selected) throw new Error('Only photos in your library can be tagged.');
            if ([...tags].some(label => label.toLowerCase() === tag.toLowerCase())) return;
            if (tags.size >= MAX_FOTOS_ENTRY_TAGS) throw new Error(`A photo can have up to ${MAX_FOTOS_ENTRY_TAGS} tags.`);
            const tagged: FotosEntry = {...selected.entry, tags: new Set([...tags, tag])};
            const stored = await this.deps.storeVersionedObject(tagged);
            await this.storeOwnedManifest(owner, manifestId, {
                ...manifest, entries: new Set([...manifest.entries, stored.hash as SHA256Hash<FotosEntry>]),
            });
        });
    }

    async shareCollectionWithPeer(collectionId: string, peerId: string, verifyPeer: () => Promise<void>): Promise<void> {
        return this.enqueue(async () => {
            const owner = this.requireOwner();
            if (!/^[a-f0-9]{64}$/.test(peerId) || peerId === owner) throw new Error('Choose a trusted peer.');
            await verifyPeer();
            if (this.requireOwner() !== owner) throw new Error('Your Fotos account changed.');
            const {manifest} = await this.requireOwnedManifest(owner);
            await shareFotosMobileCollection(owner as SHA256IdHash<Person>, manifest, collectionId, peerId as SHA256IdHash<Person>);
        });
    }

    async addPhotoToCollection(contentHash: string, target: {id: string} | {name: string}): Promise<void> {
        return this.enqueue(async () => {
            const owner = this.requireOwner();
            const {manifest, manifestId} = await this.requireOwnedManifest(owner);
            let ownsPhoto = false;
            for (const ref of manifest.entries) {
                if ((await getObject(ref)).contentHash === contentHash) {
                    ownsPhoto = true;
                    break;
                }
            }
            if (!ownsPhoto) throw new Error('Add a photo from your library to a Fotos collection.');

            const refs = new Set(manifest.collections ?? []);
            let collection: FotosCollection | undefined;
            if ('id' in target) {
                if (!isEditableFotosCollection(owner, target.id)) throw new Error('Choose an editable Fotos collection.');
                for (const ref of refs) {
                    const existing = await getObject(ref);
                    if (existing.id !== target.id) continue;
                    collection = existing;
                    refs.delete(ref);
                    break;
                }
                if (!collection) throw new Error('This Fotos collection is unavailable.');
                if (collection.photoHashes.has(contentHash)) return;
                if (collection.photoHashes.size >= MAX_FOTOS_COLLECTION_MEMBERS) throw new Error('This collection is full.');
            } else {
                const name = target.name.trim();
                if (!name) throw new Error('Enter a collection name.');
                collection = createFotosManualCollection({owner, uuid: Crypto.randomUUID(), name, photoHashes: []});
            }
            const next: FotosCollection = {
                $type$: 'FotosCollection', id: collection.id, name: collection.name,
                photoHashes: new Set([...collection.photoHashes, contentHash]),
            };
            const stored = await this.deps.storeVersionedObject(next);
            refs.add(stored.hash as SHA256Hash<FotosCollection>);
            await this.storeOwnedManifest(owner, manifestId, {...manifest, collections: refs});
        });
    }

    private async requireOwnedManifest(owner: string) {
        const id = getOwnedFotosManifestId(owner);
        const manifestId = await this.deps.calculateIdHashOfObj({$type$: 'FotosManifest', id}) as SHA256IdHash<FotosManifest>;
        const manifest = await this.readVersionedObject<FotosManifest>(manifestId);
        if (!manifest || manifest.$type$ !== 'FotosManifest' || manifest.id !== id) {
            throw new Error('Your Fotos library is unavailable.');
        }
        return {manifest, manifestId};
    }

    /** Resolve a verified original from any device-local locator, including legacy raw IDs. */
    async resolveOriginal(entry: FotosEntry, allowNetworkAccess = false): Promise<ArrayBuffer> {
        const native = getFotosPhotoKit();
        await this.ensureLocalAssetIndex();
        for (const id of this.localAssets.get(entry.contentHash) ?? []) {
            try {
                const bytes = await this.readVerifiedOriginal(native, id, entry, allowNetworkAccess);
                return Uint8Array.from(bytes).buffer;
            } catch {
                // Try the next locator for this exact content.
                continue;
            }
        }
        throw new Error('No verified Photos original is available for this contentHash');
    }

    private async readVerifiedOriginal(
        native: FotosPhotoKitNative, assetId: string, entry: FotosEntry, allowNetworkAccess: boolean,
    ): Promise<Uint8Array> {
        const bytes = await readTemporaryBytes(await native.originalFile(assetId, allowNetworkAccess));
        if (!await matchesImageContentHash(bytes, entry.contentHash, value => this.digestBytes(value))) {
            throw new Error('PhotoKit original no longer matches the expected content hash');
        }
        return bytes;
    }

    private async storeThumbnail(
        uri: string,
        family: SHA256IdHash<FotosEntry>,
        original: SHA256IdHash<FotosMediaVariant>,
    ): Promise<StoredVersionedObject & {blob: SHA256Hash<BLOB>}> {
        const bytes = await readTemporaryBytes(uri);
        const {width, height} = readFotosThumbnailDimensions(bytes);
        const blob = await storeArrayBufferAsBlob(bytes);
        const variant = await this.deps.storeVersionedObject(createFotosMediaVariant({
            contentHash: await this.digestBytes(bytes), family, role: 'thumbnail', mime: 'image/jpeg',
            byteSize: bytes.byteLength, width, height, blob: blob.hash, derivedFrom: original,
        }));
        return {...variant, blob: blob.hash};
    }

    private async deferAsset(native: FotosPhotoKitNative, asset: FotosPhotoKitAsset): Promise<FotosDeferredPhotoKitAsset> {
        const previous = this.deferredAssets.get(asset.id);
        const thumbnailUri = previous?.asset.modificationTime === asset.modificationTime && previous?.thumbnailUri
            || await native.thumbnailFile(asset.id, FOTOS_THUMBNAIL_MAX_EDGE, false).catch(() => null);
        if (previous?.thumbnailUri && previous.thumbnailUri !== thumbnailUri) deleteTemporaryFile(previous.thumbnailUri);
        const deferred: FotosDeferredPhotoKitAsset = {asset, status: 'icloud-deferred', ...(thumbnailUri ? {thumbnailUri} : {})};
        this.deferredAssets.set(asset.id, deferred);
        return deferred;
    }

    private clearDeferredAsset(assetId: string): void {
        const deferred = this.deferredAssets.get(assetId);
        if (deferred?.thumbnailUri) deleteTemporaryFile(deferred.thumbnailUri);
        this.deferredAssets.delete(assetId);
    }

    private onLibraryChange(native: FotosPhotoKitNative, change: FotosPhotoKitChange): void {
        if (this.closed) return;
        void this.enqueue(async () => {
            const permission = await MediaLibrary.getPermissionsAsync(false, ['photo', 'video']);
            if (!permission.granted) {
                for (const assetId of this.deferredAssets.keys()) this.clearDeferredAsset(assetId);
                return;
            }
            await this.ensureLocalAssetIndex();
            const removed = new Set(change.removed);
            if (removed.size && permission.accessPrivileges === 'all') {
                await this.retireLocalPhotoLocators(removed);
            }
            for (const assetId of removed) {
                this.albumAssetHashes.delete(assetId);
                this.assetVerificationTimes.delete(assetId);
                this.clearDeferredAsset(assetId);
            }
            if (removed.size) {
                for (const [hash, assets] of this.localAssets) {
                    for (const id of assets) if (removed.has(id)) assets.delete(id);
                    if (!assets.size) this.localAssets.delete(hash);
                }
            }
            const changed = new Set([...change.inserted, ...change.changed]);
            if (change.requiresReload) {
                for (const assetId of this.albumAssetHashes.keys()) changed.add(assetId);
                for (const assetId of this.deferredAssets.keys()) changed.add(assetId);
            }
            for (const assetId of removed) changed.delete(assetId);
            const refreshAlbums = change.albumsChanged || removed.size > 0 || change.requiresReload;
            const result = changed.size
                ? await this.syncAssetRefsSerially(native, [...changed], permission, false, refreshAlbums)
                : undefined;
            if (result?.skippedCount || result?.albumSyncError) console.warn('[FotosPhotoKit] Some changes could not be applied');
            if (!result && refreshAlbums) {
                await this.syncAlbums(native, permission.accessPrivileges === 'all');
            }
        }).catch(error => {
            if (!this.closed) console.warn('[FotosPhotoKit] Library change could not be applied', error);
        });
    }

    private async retireLocalPhotoLocators(removed: ReadonlySet<string>): Promise<void> {
        const deviceId = this.deps.getInstanceId();
        if (!deviceId) throw new Error('PhotoKit requires the local device identity');
        const idHash = await this.deps.calculateIdHashOfObj({$type$: 'FotosDeviceBook', id: makeFotosDeviceBookId(deviceId)});
        const book = await this.readVersionedObject<FotosDeviceBook>(idHash);
        if (!book?.locators?.size) return;
        const locators = new Set<SHA256Hash<FotosMediaLocator>>();
        for (const ref of book.locators) {
            const locator = await getObject(ref);
            if (locator.deviceId === deviceId && locator.kind === 'phasset' && locator.platform === 'ios'
                && locator.scope === 'device-local' && removed.has(locator.locator)) continue;
            locators.add(ref);
        }
        if (locators.size !== book.locators.size) {
            const access = await MediaLibrary.getPermissionsAsync(false, ['photo', 'video']);
            if (access.granted && access.accessPrivileges === 'all') {
                await this.deps.storeVersionedObject({...book, locators, updatedAt: Math.max(Date.now(), book.updatedAt)});
            }
        }
    }

    private async syncAlbums(native: FotosPhotoKitNative, fullAccess: boolean): Promise<void> {
        const owner = this.requireOwner();
        const deviceId = this.deps.getInstanceId();
        if (!deviceId) throw new Error('PhotoKit albums require the local device identity');
        const id = getOwnedFotosManifestId(owner);
        const manifestIdHash = await this.deps.calculateIdHashOfObj({$type$: 'FotosManifest', id}) as SHA256IdHash<FotosManifest>;
        const manifest = await this.readVersionedObject<FotosManifest>(manifestIdHash);
        const {collections, albumBindings, changed} = await reconcileFotosPhotoKitAlbums({
            native, ownerId: owner, libraryId: await this.digestBytes(new TextEncoder().encode(deviceId)),
            fullAccess, assetHashes: this.albumAssetHashes, existingRefs: manifest?.collections ?? new Set(),
            bindingRefs: manifest?.albumBindings ?? new Set(),
            allocateCollectionUuid: Crypto.randomUUID,
            calculateCollectionId: async collection => await this.deps.calculateIdHashOfObj(
                {$type$: 'FotosCollection', id: collection.id},
            ) as SHA256IdHash<FotosCollection>,
            readCollection: hash => getObject(hash),
            readBinding: hash => getObject(hash),
            storeCollection: async collection => (await this.deps.storeVersionedObject(collection)).hash as SHA256Hash<FotosCollection>,
            storeBinding: async binding => (await this.deps.storeVersionedObject(binding)).hash as SHA256Hash<FotosGalleryAlbumBinding>,
        });
        if (!changed) return;
        const currentAccess = await MediaLibrary.getPermissionsAsync(false, ['photo', 'video']);
        if (!currentAccess.granted || (fullAccess && currentAccess.accessPrivileges !== 'all')) {
            throw new Error('Photos access changed during album reconciliation');
        }
        await this.storeOwnedManifest(owner, manifestIdHash, {
            ...(manifest ?? {}), $type$: 'FotosManifest', id, entries: manifest?.entries ?? new Set(), collections, albumBindings,
        });
    }

    private async addEntryToManifest(entryHash: SHA256Hash<FotosEntry>): Promise<void> {
        const owner = this.requireOwner();
        const id = getOwnedFotosManifestId(owner);
        const manifestIdHash = await this.deps.calculateIdHashOfObj({$type$: 'FotosManifest', id}) as SHA256IdHash<FotosManifest>;
        const manifest = await this.readVersionedObject<FotosManifest>(manifestIdHash);
        // The legacy global root may contain peer-owned entries. Preserve it untouched;
        // never republish its contents under the current owner's authority without evidence.
        const entries = new Set(manifest?.entries ?? []);
        entries.add(entryHash);
        await this.storeOwnedManifest(owner, manifestIdHash, {
            ...(manifest ?? {}), $type$: 'FotosManifest', id, entries,
            authenticityAttestations: new Set(manifest?.authenticityAttestations ?? []),
        });
    }

    private async storeOwnedManifest(owner: string, idHash: SHA256IdHash<FotosManifest>, manifest: FotosManifest): Promise<void> {
        await createAccess([{id: idHash,
            person: [owner as SHA256IdHash<Person>], hashGroup: [], mode: SET_ACCESS_MODE.ADD}]);
        await this.deps.storeVersionedObject(manifest);
    }
}
