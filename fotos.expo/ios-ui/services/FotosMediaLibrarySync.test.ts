import {readFileSync} from 'node:fs';
import {URL} from 'node:url';
import {createHash} from 'node:crypto';
import {normalizeImageBytesForContentHash} from '../../../fotos.core/src/content-hash.js';
import type {FotosPhotoKitAsset, FotosPhotoKitChange} from './FotosPhotoKit';
import {beforeEach, describe, expect, it, vi} from 'vitest';
const OWNER = 'a'.repeat(64);
const CONTENT = '9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a';
const fixtureDirectory = new URL('../../../fotos.core/test/fixtures/content-hash/', import.meta.url);
const JPEG = Uint8Array.from(readFileSync(new URL('with-exif.jpg', fixtureDirectory)));
const mocks = vi.hoisted(() => ({
    record: vi.fn<(params: any) => Promise<string>>(async () => 'observation-hash'),
    blob: vi.fn(async () => ({hash: 'stored-blob'})), batches: vi.fn(async (): Promise<any[]> => []),
    deleteBatch: vi.fn(), access: vi.fn(async () => []), objects: new Map<string, any>(),
    asset: vi.fn<(id: string) => Promise<FotosPhotoKitAsset>>(),
    inspect: vi.fn(), thumbnail: vi.fn(), originalFile: vi.fn(), listAssets: vi.fn(), releaseCursor: vi.fn(),
    permissions: vi.fn(),
    listAlbums: vi.fn(), listAlbumMembers: vi.fn(),
    read: vi.fn<(uri: string) => Promise<Uint8Array>>(), remove: vi.fn(), thumbnailDimensions: vi.fn(),
    nativeOriginal: vi.fn<() => Uint8Array>(), unsubscribe: vi.fn(),
    listener: undefined as undefined | ((change: FotosPhotoKitChange) => void),
}));
vi.mock('react-native', () => ({Platform: {OS: 'ios'}}));
vi.mock('expo-crypto', () => ({CryptoDigestAlgorithm: {SHA256: 'SHA256'}, digest: async (_algorithm: string, bytes: Uint8Array) =>
    Uint8Array.from((await import('node:crypto')).createHash('sha256').update(bytes).digest()).buffer}));
vi.mock('expo-file-system', () => ({
    File: class {
        readonly exists = true;
        constructor(private readonly uri: string) {}
        bytes() { return mocks.read(this.uri); }
        delete() { mocks.remove(this.uri); }
    },
}));
vi.mock('./FotosPhotoKit', () => ({getFotosPhotoKit: () => ({
    inspectOriginal: mocks.inspect, thumbnailFile: mocks.thumbnail, originalFile: mocks.originalFile,
    listAssets: mocks.listAssets, listAlbums: mocks.listAlbums, listAlbumMembers: mocks.listAlbumMembers,
    releaseCursor: mocks.releaseCursor,
    addListener: (_name: string, listener: (change: FotosPhotoKitChange) => void) => {
        mocks.listener = listener;
        return {remove: mocks.unsubscribe};
    },
})}));
vi.mock('expo-media-library', () => ({getPermissionsAsync: mocks.permissions}));
vi.mock('@refinio/one.core/lib/storage-blob.js', () => ({storeArrayBufferAsBlob: mocks.blob}));
vi.mock('@refinio/one.core/lib/storage-unversioned-objects.js', () => ({getObject: async (hash: string) => mocks.objects.get(hash)}));
vi.mock('@refinio/one.core/lib/access.js', () => ({createAccess: mocks.access}));
vi.mock('@refinio/one.core/lib/storage-base-common.js', () => ({SET_ACCESS_MODE: {ADD: 'add'}}));
vi.mock('@refinio/fotos.core', async () => ({
    ...await import('../../../fotos.core/src/content-hash.js'),
    ...await import('../../../fotos.core/src/fotos-collection.js'),
    getOwnedFotosManifestId: (owner: string) => `fotos:${owner}`,
    makeFotosDeviceBookId: (deviceId: string) => `fotos-device-book:${deviceId}`,
    recordFotosAcquisition: mocks.record,
    createFotosMediaVariant: (params: object) => ({$type$: 'FotosMediaVariant', ...params}),
    createFotosMediaLocator: (params: object) => ({$type$: 'FotosMediaLocator', ...params}),
    appendFotosDeviceBookContent: async (deps: any, params: any) => {
        const id = `fotos-device-book:${params.deviceId}`;
        const idHash = await deps.calculateIdHashOfObj({$type$: 'FotosDeviceBook', id});
        let current: any;
        try {current = (await deps.getObjectByIdHash(idHash)).obj;} catch {current = {};}
        await deps.storeVersionedObject({$type$: 'FotosDeviceBook', id, deviceId: params.deviceId,
            entries: new Set([...(current.entries ?? []), ...params.entries]),
            locators: new Set([...(current.locators ?? []), ...params.locators])});
    },
}));
vi.mock('@refinio/fotos.core/filesystem', () => ({FOTOS_THUMBNAIL_MAX_EDGE: 512,
    readFotosThumbnailDimensions: mocks.thumbnailDimensions}));
vi.mock('@refinio/source.media', () => ({
    createMediaSource: (params: object) => ({$type$: 'Source', id: 'source', ...params}),
    createMediaSourceEntry: (params: object) => ({$type$: 'SourceEntry', sourceRef: 'source-ref', ...params}),
    appendMediaBookContent: async () => undefined,
}));
vi.mock('./FotosShareInbox', () => ({readFotosShareInboxBatches: mocks.batches, deleteFotosShareInboxBatch: mocks.deleteBatch, getFotosShareInboxStatus: async () => ({})}));
import {FotosMediaLibrarySync, type FotosIntakeMode} from './FotosMediaLibrarySync';
function idOf(obj: any): string {
    if (obj.$type$ === 'FotosEntry') return `entry:${obj.contentHash}`;
    if (obj.$type$ === 'FotosMediaVariant') return `variant:${obj.contentHash}:${obj.role}`;
    if (obj.$type$ === 'FotosMediaLocator') return `locator:${obj.variant}:${obj.locator}`;
    return `${obj.$type$}:${obj.id ?? obj.locator ?? ''}`;
}
function fixture(owner: string | undefined = OWNER, mode: FotosIntakeMode = 'reference') {
    const stored = new Map<string, any>(), writes: any[] = [];
    const deps = {
        calculateIdHashOfObj: async (obj: any) => idOf(obj),
        getObjectByIdHash: async (id: string) => {
            if (!stored.has(id)) throw Object.assign(new Error('not found'), {name: 'FileNotFoundError'});
            return {obj: stored.get(id)};
        },
        storeVersionedObject: async (obj: any) => {
            const idHash = idOf(obj), hash = `hash:${writes.length}:${idHash}`;
            writes.push(obj); stored.set(idHash, obj); mocks.objects.set(hash, obj);
            return {hash, idHash};
        },
        getOwnerId: (): string | undefined => owner, getInstanceId: () => 'device-1', getIntakeMode: async () => mode,
    };
    return {writes, stored, deps, service: new FotosMediaLibrarySync(deps)};
}
function asset(id: string, details: Partial<FotosPhotoKitAsset> = {}): FotosPhotoKitAsset {
    return {id, filename: 'photo.jpg', creationTime: 1000, modificationTime: 2000,
        width: 2, height: 2, duration: 0, mediaType: 'photo', mediaSubtypes: [], favorite: false,
        exif: {Make: 'Reported', Model: 'Camera'}, ...details};
}

beforeEach(() => {
    vi.resetAllMocks();
    mocks.objects.clear();
    mocks.listener = undefined;
    mocks.record.mockResolvedValue('observation-hash');
    mocks.blob.mockResolvedValue({hash: 'stored-blob'});
    mocks.batches.mockResolvedValue([]);
    mocks.asset.mockImplementation(async id => asset(id));
    mocks.nativeOriginal.mockImplementation(() => Uint8Array.of(1, 2, 3, 4));
    mocks.permissions.mockResolvedValue({granted: true, accessPrivileges: 'all'});
    mocks.inspect.mockImplementation(async id => {
        const bytes = mocks.nativeOriginal();
        return {asset: await mocks.asset(id), status: 'available', byteSize: bytes.length,
            contentHash: createHash('sha256').update(normalizeImageBytesForContentHash(bytes)).digest('hex')};
    });
    mocks.read.mockImplementation(async uri => uri === 'file:///thumbnail.jpg' ? JPEG : Uint8Array.of(1, 2, 3, 4));
    mocks.thumbnail.mockResolvedValue('file:///thumbnail.jpg');
    mocks.originalFile.mockResolvedValue('file:///temporary-original.jpg');
    mocks.thumbnailDimensions.mockReturnValue({width: 1, height: 1});
    mocks.listAssets.mockResolvedValue({assets: []});
    mocks.listAlbums.mockResolvedValue({albums: []});
    mocks.listAlbumMembers.mockResolvedValue({assetIds: []});
});
describe('Expo reference-first media acquisition', () => {
    it('stores only a bounded thumbnail BLOB and grants the owner-scoped root', async () => {
        const {service, writes} = fixture();
        expect(await service.syncAssetIds(['asset-1'])).toMatchObject({syncedCount: 1, skippedCount: 0});
        expect(mocks.blob).toHaveBeenCalledExactlyOnceWith(JPEG);
        expect(writes.find(obj => obj.role === 'original')).not.toHaveProperty('blob');
        expect(writes.find(obj => obj.role === 'thumbnail')).toMatchObject({blob: 'stored-blob', width: 1, height: 1, mime: 'image/jpeg'});
        expect(writes.find(obj => obj.$type$ === 'FotosEntry')).toMatchObject({thumb: 'stored-blob'});
        expect(writes.find(obj => obj.$type$ === 'FotosMediaLocator')).toMatchObject({kind: 'phasset', scope: 'device-local', locator: 'asset-1', deviceId: 'device-1'});
        expect(writes.at(-1)).toMatchObject({$type$: 'FotosManifest', id: `fotos:${OWNER}`, entries: expect.any(Set)});
        expect(mocks.access).toHaveBeenCalledWith([{id: `FotosManifest:fotos:${OWNER}`, person: [OWNER], hashGroup: [], mode: 'add'}]);
        expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({observer: OWNER,
            context: expect.objectContaining({surface: 'mobile-library', source: 'asset-1', reportedCaptureTime: '1970-01-01T00:00:01.000Z'})}));
        expect(mocks.remove).toHaveBeenCalledWith('file:///thumbnail.jpg');
        expect(mocks.originalFile).not.toHaveBeenCalled();
        expect(mocks.read).toHaveBeenCalledExactlyOnceWith('file:///thumbnail.jpg');
    });
    it('keeps ingest available explicitly for gallery assets', async () => {
        const {service, writes} = fixture(OWNER, 'ingest');
        expect(await service.syncAssetIds(['asset-1'])).toMatchObject({syncedCount: 1});
        expect(mocks.blob).toHaveBeenCalledWith(new Uint8Array([1, 2, 3, 4]));
        expect(writes.find(obj => obj.role === 'original')).toHaveProperty('blob', 'stored-blob');
    });
    it('resyncs Expo metadata using the same content-derived entry identity', async () => {
        const {service, writes} = fixture(); await service.syncAssetIds(['asset-1']);
        mocks.asset.mockResolvedValue(asset('asset-1', {filename: 'renamed.jpg',
            creationTime: 3000, modificationTime: 4000, width: 4096, height: 2048, duration: 2,
            favorite: true, mediaSubtypes: ['live-photo', 'hdr', 'depth', 'cinematic'],
            location: {latitude: 53, longitude: 13}, exif: {Orientation: 6, GPSAltitude: 42, LensModel: 'Lens', FNumber: 2, ISO: 100}}));
        await service.syncAssetIds(['asset-1']);
        const entries = writes.filter(obj => obj.$type$ === 'FotosEntry');
        expect(entries).toHaveLength(2); expect(idOf(entries[0])).toBe(idOf(entries[1]));
        expect(entries[1]).toMatchObject({contentHash: CONTENT, originalFilename: 'renamed.jpg', duration: 2, favorite: true,
            orientation: 6, exifGpsLat: 53, exifGpsLon: 13, exifGpsAlt: 42, exifLens: 'Lens', mediaSubtypes: new Set(['live-photo', 'hdr', 'depth', 'cinematic'])});
        expect(entries[1].variants.size).toBeGreaterThanOrEqual(entries[0].variants.size);
        expect(mocks.thumbnail).toHaveBeenLastCalledWith('asset-1', 512, false);
    });
    it('retains one media identity and both exact versions when embedded PNG metadata changes', async () => {
        const {service, stored, writes} = fixture();
        mocks.asset.mockResolvedValue(asset('asset-1', {filename: 'photo.png'}));
        mocks.nativeOriginal
            .mockReturnValueOnce(Uint8Array.from(readFileSync(new URL('plain.png', fixtureDirectory))))
            .mockReturnValueOnce(Uint8Array.from(readFileSync(new URL('with-exif-and-text.png', fixtureDirectory))));
        await service.syncAssetIds(['asset-1']);
        mocks.asset.mockResolvedValue(asset('asset-1', {filename: 'photo.png',
            exif: {Make: 'Corrected', Model: 'Camera', GPSLatitude: 52}}));
        await service.syncAssetIds(['asset-1']);
        const entries = writes.filter(obj => obj.$type$ === 'FotosEntry');
        expect(entries).toHaveLength(2);
        expect(idOf(entries[0])).toBe(idOf(entries[1]));
        expect(entries[0].contentHash).toBe(entries[1].contentHash);
        expect(entries[0].size).not.toBe(entries[1].size);
        expect(entries[1]).toMatchObject({exifCamera: 'Corrected Camera', exifGpsLat: 52});
        expect(stored.get(`FotosManifest:fotos:${OWNER}`).entries.size).toBe(2);
    });
    it('maps native ImageIO EXIF namespaces and signed GPS values', async () => {
        mocks.asset.mockResolvedValue(asset('asset-1', {width: 2, height: 2,
            exif: {'{TIFF}': {Make: 'Reported', Model: 'Camera', Orientation: 3},
                '{ExifAux}': {LensModel: 'Lens'},
                '{Exif}': {DateTimeOriginal: '2026:11:22 12:34:56', ISOSpeedRatings: [100], FNumber: 2},
                '{GPS}': {Latitude: 20, LatitudeRef: 'S', Longitude: 30, LongitudeRef: 'W', Altitude: 10, AltitudeRef: 1}}}));
        const {service, writes} = fixture();
        expect(await service.syncAssetIds(['asset-1'])).toMatchObject({syncedCount: 1});
        expect(writes.find(obj => obj.$type$ === 'FotosEntry')).toMatchObject({exifCamera: 'Reported Camera', exifLens: 'Lens',
            exifIso: 100, orientation: 3, exifGpsLat: -20, exifGpsLon: -30, exifGpsAlt: -10, exifDate: '2026-11-22T12:34:56'});
    });
    it('rejects an invalid native JPEG thumbnail and deletes its temporary file', async () => {
        mocks.thumbnailDimensions.mockImplementationOnce(() => { throw new Error('Invalid JPEG frame'); });
        const {service, writes} = fixture();
        expect(await service.syncAssetIds(['asset-1'])).toMatchObject({syncedCount: 0, skippedCount: 1});
        expect(writes.some(obj => obj.$type$ === 'FotosEntry' || obj.$type$ === 'FotosManifest')).toBe(false);
        expect(mocks.remove).toHaveBeenCalledOnce();
    });
    it('resolves bytes through stored device locators after service restart', async () => {
        const {service, deps, stored} = fixture(); await service.syncAssetIds(['asset-1']);
        expect(new Uint8Array(await new FotosMediaLibrarySync(deps).resolveOriginal(stored.get(`entry:${CONTENT}`)))).toEqual(new Uint8Array([1, 2, 3, 4]));
        expect(mocks.originalFile).toHaveBeenLastCalledWith('asset-1', false);
        expect(mocks.remove).toHaveBeenCalledWith('file:///temporary-original.jpg');
        expect(mocks.blob).toHaveBeenCalledTimes(1);
    });
    it('refuses a stored locator whose bytes no longer match the content identity', async () => {
        const {service, deps, stored} = fixture(); await service.syncAssetIds(['asset-1']);
        mocks.read.mockResolvedValue(Uint8Array.of(5, 6, 7, 8));
        await expect(new FotosMediaLibrarySync(deps).resolveOriginal(stored.get(`entry:${CONTENT}`))).rejects.toThrow('No verified Photos original');
    });
    it('reports iCloud-only assets without inventing a canonical identity', async () => {
        mocks.inspect.mockResolvedValueOnce({asset: asset('cloud', {filename: 'cloud.heic'}), status: 'icloud-deferred'});
        const {service, writes} = fixture();
        expect(await service.syncAssetIds(['cloud'])).toMatchObject({syncedCount: 0, skippedCount: 0,
            deferredAssets: [{asset: {id: 'cloud'}, status: 'icloud-deferred', thumbnailUri: 'file:///thumbnail.jpg'}]});
        expect(mocks.inspect).toHaveBeenLastCalledWith('cloud', false);
        expect(writes).toEqual([]);
        expect(mocks.blob).not.toHaveBeenCalled();
        expect(await service.syncAssetIds(['cloud'], true)).toMatchObject({syncedCount: 1, deferredAssets: []});
        expect(mocks.inspect).toHaveBeenLastCalledWith('cloud', true);
        expect(mocks.thumbnail).toHaveBeenLastCalledWith('cloud', 512, true);
    });
    it('publishes user album membership using the synced content hash', async () => {
        const {service, stored, writes} = fixture();
        mocks.listAlbums.mockResolvedValue({albums: [
            {id: 'user-album', name: 'Trip', kind: 'user'},
            {id: 'smart-album', name: 'Favorites', kind: 'smart'},
        ]});
        mocks.listAlbumMembers.mockResolvedValue({assetIds: ['asset-1', 'unsynced']});
        expect(await service.syncAssetIds(['asset-1'])).toMatchObject({syncedCount: 1});
        const collection = writes.find(obj => obj.$type$ === 'FotosCollection');
        expect(collection).toMatchObject({name: 'Trip', photoHashes: new Set([CONTENT])});
        expect(stored.get(`FotosManifest:fotos:${OWNER}`).collections.size).toBe(1);
        expect(mocks.listAlbumMembers).toHaveBeenCalledExactlyOnceWith('user-album', 0, 100, undefined);
    });
    it('releases the native asset snapshot after taking the requested recent items', async () => {
        const {service} = fixture();
        mocks.listAssets.mockResolvedValueOnce({assets: [asset('asset-1')], nextOffset: 1, cursor: 'recent-cursor'});
        expect(await service.syncRecentAssets(1)).toMatchObject({syncedCount: 1});
        expect(mocks.listAssets).toHaveBeenCalledExactlyOnceWith(0, 1, undefined);
        expect(mocks.releaseCursor).toHaveBeenCalledExactlyOnceWith('recent-cursor');
    });
    it('reports album failures alongside successful media publication', async () => {
        const {service, writes} = fixture();
        mocks.listAlbums.mockRejectedValueOnce(new Error('Photos albums unavailable'));
        expect(await service.syncAssetIds(['asset-1'])).toMatchObject({
            syncedCount: 1, albumSyncError: 'Photos albums unavailable',
        });
        expect(writes.some(obj => obj.$type$ === 'FotosManifest')).toBe(true);
    });
    it('preserves the owned album references when full access is narrowed during reconciliation', async () => {
        const {service, stored, writes} = fixture();
        const deviceLibrary = createHash('sha256').update('device-1').digest('hex');
        const id = `fotos-album:v1:${OWNER}:${deviceLibrary}:album`;
        const manifest = {$type$: 'FotosManifest', id: `fotos:${OWNER}`, entries: new Set(), collections: new Set(['album-ref'])};
        stored.set(`FotosManifest:fotos:${OWNER}`, manifest);
        mocks.objects.set('album-ref', {$type$: 'FotosCollection', id, name: 'Trip', photoHashes: new Set([CONTENT])});
        mocks.permissions
            .mockResolvedValueOnce({granted: true, accessPrivileges: 'all'})
            .mockResolvedValueOnce({granted: true, accessPrivileges: 'limited'});
        expect(await service.syncAssetIds([])).toMatchObject({
            albumSyncError: 'Photos access changed during album reconciliation',
        });
        expect(stored.get(`FotosManifest:fotos:${OWNER}`)).toBe(manifest);
        expect(writes).toEqual([]);
    });
    it('applies incremental PhotoKit changes and drops removed local locators', async () => {
        const {service, stored} = fixture();
        await service.syncAssetIds(['removed']);
        mocks.listener?.({inserted: ['inserted'], changed: [], removed: ['removed'],
            albumsChanged: true, requiresReload: false});
        await service.syncAssetIds([]);
        expect(mocks.inspect).toHaveBeenLastCalledWith('inserted', false);
        await service.resolveOriginal(stored.get(`entry:${CONTENT}`));
        expect(mocks.originalFile).toHaveBeenCalledExactlyOnceWith('inserted', false);
        await service.dispose();
        expect(mocks.unsubscribe).toHaveBeenCalledOnce();
    });
    it('serializes concurrent service and inbox publication, preserving manifest extensions', async () => {
        const {service, deps, stored} = fixture();
        mocks.record.mockImplementation(async params => `observation:${params.context.source}`);
        stored.set(`FotosManifest:fotos:${OWNER}`, {$type$: 'FotosManifest', id: `fotos:${OWNER}`, entries: new Set(['old-entry']), collections: new Set(['album'])});
        mocks.objects.set('album', {id: 'fotos-album:v1:' + OWNER + ':' + 'b'.repeat(64) + ':album', name: 'Other device', photoHashes: new Set()});
        mocks.batches.mockResolvedValue([{items: [{batchId: 'batch', fileUri: 'file:///shared.png', originalName: 'shared.png'}]}]);
        await Promise.all([service.syncAssetIds(['asset-1']), new FotosMediaLibrarySync(deps).syncAssetIds(['asset-2']), service.importPendingSharedInbox()]);
        const manifest = stored.get(`FotosManifest:fotos:${OWNER}`);
        expect(manifest.entries.size).toBe(4); expect(manifest.collections).toEqual(new Set(['album']));
        expect(stored.get(`entry:${CONTENT}`).acquisitionObservations).toEqual(new Set(['observation:asset-1', 'observation:asset-2', 'observation:file:///shared.png']));
        expect(stored.get(`entry:${CONTENT}`).variants.size).toBe(5);
    });
    it('preserves the legacy global root without claiming entries of unknown ownership', async () => {
        const {service, stored} = fixture();
        const legacy = {$type$: 'FotosManifest', id: 'fotos', entries: new Set(['unknown-owner-entry'])};
        stored.set('FotosManifest:fotos', legacy); await service.syncAssetIds(['asset-1']);
        expect(stored.get('FotosManifest:fotos')).toBe(legacy);
        expect(stored.get(`FotosManifest:fotos:${OWNER}`).entries).not.toContain('unknown-owner-entry');
    });
    it('keeps Share Inbox ingest and arrival provenance, deleting only successful batches', async () => {
        mocks.batches.mockResolvedValue([{items: [{batchId: 'batch', fileUri: 'file:///shared.png', originalName: 'shared.png', createdAt: '2026-10-21T12:00:00Z'}]}]);
        const {service, writes} = fixture(); expect(await service.importPendingSharedInbox()).toMatchObject({syncedCount: 1, skippedCount: 0});
        expect(mocks.record.mock.calls[0][0].context).toMatchObject({surface: 'shared-file', source: 'file:///shared.png'});
        expect(mocks.record.mock.calls[0][0].context).not.toHaveProperty('reportedCaptureTime');
        expect(writes.find(obj => obj.role === 'original').blob).toBe('stored-blob');
        expect(writes.find(obj => obj.$type$ === 'FotosEntry')).not.toHaveProperty('capturedAt');
        expect(mocks.deleteBatch).toHaveBeenCalledOnce();
    });
    it('leaves publication roots unpublished on provenance failure', async () => {
        mocks.record.mockRejectedValueOnce(new Error('evidence unavailable'));
        const {service, writes} = fixture(); const result = await service.syncAssetIds(['asset-1']);
        expect(result).toMatchObject({syncedCount: 0, skippedCount: 1}); expect(result.issues[0].reason).toContain('evidence unavailable');
        expect(writes.some(obj => obj.$type$ === 'FotosEntry' || obj.$type$ === 'FotosManifest')).toBe(false);
    });
    it('does not publish a root when its owner access grant fails', async () => {
        mocks.access.mockRejectedValueOnce(new Error('access offline'));
        const {service, writes} = fixture();
        expect(await service.syncAssetIds(['asset-1'])).toMatchObject({syncedCount: 0, skippedCount: 1});
        expect(writes.some(obj => obj.$type$ === 'FotosManifest')).toBe(false);
    });
    it('requires an owner before writing any reference or BLOB', async () => {
        const {service, writes, deps} = fixture(); deps.getOwnerId = () => undefined;
        expect(await service.syncAssetIds(['asset-1'])).toMatchObject({syncedCount: 0, skippedCount: 1});
        expect(writes).toEqual([]); expect(mocks.blob).not.toHaveBeenCalled();
    });
    it('does not overwrite prior evidence after an operational read failure', async () => {
        const {service, writes, deps} = fixture(); deps.getObjectByIdHash = async () => {throw new Error('storage offline');};
        expect(await service.syncAssetIds(['asset-1'])).toMatchObject({syncedCount: 0, skippedCount: 1});
        expect(writes).toEqual([]); expect(mocks.record).not.toHaveBeenCalled();
    });
});
