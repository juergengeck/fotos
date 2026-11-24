import {readFileSync} from 'node:fs';
import {URL} from 'node:url';
import {createHash} from 'node:crypto';
import {normalizeImageBytesForContentHash} from '@refinio/fotos.core/content-hash';
import {buildFotosGalleryAlbumBindingId} from '@refinio/fotos.core';
import type {FotosPhotoKitAsset, FotosPhotoKitChange} from './FotosPhotoKit';
import {beforeEach, describe, expect, it, vi} from 'vitest';
const OWNER = 'a'.repeat(64);
const CONTENT = '9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a';
const fixtureDirectory = new URL('../../../../one/packages/media.core/test/fixtures/bitfield-hash/', import.meta.url);
const JPEG = Uint8Array.from(readFileSync(new URL('with-exif.jpg', fixtureDirectory)));
const mocks = vi.hoisted(() => ({
    platform: 'ios',
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
vi.mock('react-native', () => ({Platform: {get OS() { return mocks.platform; }}}));
vi.mock('expo-crypto', () => ({randomUUID: () => '22b699dd-136c-407b-83f4-48f2e47b2b18',
    CryptoDigestAlgorithm: {SHA256: 'SHA256'}, digest: async (_algorithm: string, bytes: Uint8Array) =>
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
vi.mock('@refinio/fotos.core', async importOriginal => ({
    ...await importOriginal<typeof import('@refinio/fotos.core')>(),
    MAX_FOTOS_ENTRY_TAGS: 64, MAX_FOTOS_TAG_LENGTH: 80,
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
        await deps.storeVersionedObject({$type$: 'FotosDeviceBook', id, deviceId: params.deviceId, updatedAt: Date.now(),
            entries: new Set([...(current.entries ?? []), ...params.entries]),
            locators: new Set([...(current.locators ?? []), ...params.locators])});
    },
}));
vi.mock('@refinio/fotos.core/filesystem', () => ({FOTOS_THUMBNAIL_MAX_EDGE: 512,
    readFotosThumbnailDimensions: mocks.thumbnailDimensions}));
// Exercise the real @refinio/source.media DAG functions (Source, SourceEntry, Book) against the fixture store.
vi.mock('./FotosShareInbox', () => ({readFotosShareInboxBatches: mocks.batches, deleteFotosShareInboxBatch: mocks.deleteBatch, getFotosShareInboxStatus: async () => ({})}));
vi.mock('./FotosMobileCollectionShare', () => ({shareFotosMobileCollection: vi.fn()}));
import {FotosMediaLibrarySync, type FotosIntakeMode} from './FotosMediaLibrarySync';
function idOf(obj: any): string {
    if (obj.$type$ === 'FotosEntry') return `entry:${obj.contentHash}`;
    if (obj.$type$ === 'FotosCollection') return createHash('sha256').update(`collection:${obj.id}`).digest('hex');
    if (obj.$type$ === 'FotosMediaVariant') return `variant:${obj.contentHash}:${obj.role}`;
    if (obj.$type$ === 'FotosMediaLocator') return `locator:${obj.variant}:${obj.locator}`;
    if (obj.$type$ === 'Book') return `Book:${obj.author}:${obj.name}`;
    return `${obj.$type$}:${obj.id ?? obj.locator ?? ''}`;
}
function fixture(owner: string | undefined = OWNER, mode: FotosIntakeMode = 'reference') {
    const stored = new Map<string, any>(), hashes = new Map<string, string>(), writes: any[] = [];
    const deps = {
        calculateIdHashOfObj: async (obj: any) => idOf(obj),
        getObjectByIdHash: async (id: string) => {
            if (!stored.has(id)) throw Object.assign(new Error('not found'), {name: 'FileNotFoundError'});
            return {obj: stored.get(id), hash: hashes.get(id)};
        },
        storeVersionedObject: async (obj: any) => {
            const idHash = idOf(obj), hash = `hash:${writes.length}:${idHash}`;
            writes.push(obj); stored.set(idHash, obj); hashes.set(idHash, hash); mocks.objects.set(hash, obj);
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
    mocks.platform = 'ios';
    mocks.objects.clear();
    mocks.listener = undefined;
    mocks.record.mockResolvedValue('observation-hash');
    mocks.blob.mockResolvedValue({hash: 'stored-blob'});
    mocks.batches.mockResolvedValue([]);
    mocks.asset.mockImplementation(async id => asset(id));
    mocks.nativeOriginal.mockImplementation(() => Uint8Array.of(1, 2, 3, 4));
    mocks.permissions.mockResolvedValue({granted: true, accessPrivileges: 'all'});
    mocks.inspect.mockImplementation(async (id, _allowNetworkAccess, previewMaxEdge) => {
        const bytes = mocks.nativeOriginal();
        const current = await mocks.asset(id);
        return {asset: current, status: 'available', byteSize: bytes.length,
            ...(previewMaxEdge && current.mediaType === 'photo' ? {thumbnailUri: 'file:///thumbnail.jpg'} : {}),
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
    it('syncs Android gallery metadata through device-local locators and portable albums', async () => {
        mocks.platform = 'android';
        const id = 'content://media/external_primary/images/media/123';
        const bucket = 'media-bucket:v1:external_primary:345';
        const {service, stored, writes, deps} = fixture();
        mocks.listAlbums.mockResolvedValue({albums: [{id: bucket, name: 'Camera', kind: 'user'}]});
        mocks.listAlbumMembers.mockResolvedValue({assetIds: [id]});
        mocks.asset.mockImplementation(async () => asset(id, {favorite: true}));

        expect(await service.syncAssetIds([id])).toMatchObject({syncedCount: 1, skippedCount: 0});
        expect(writes.find(obj => obj.$type$ === 'FotosMediaLocator')).toMatchObject({
            platform: 'android', kind: 'media-store', scope: 'device-local', locator: id,
        });
        const libraryId = createHash('sha256').update('device-1').digest('hex');
        expect(writes.find(obj => obj.$type$ === 'FotosGalleryAlbumBinding')).toMatchObject({
            id: buildFotosGalleryAlbumBindingId({owner: OWNER, platform: 'android', libraryId, albumId: bucket}),
        });
        expect(writes.find(obj => obj.$type$ === 'FotosCollection')).toMatchObject({name: 'Camera', photoHashes: new Set([CONTENT])});
        await service.dispose();

        const restarted = new FotosMediaLibrarySync(deps);
        expect(await restarted.getLocalPhotoHashes()).toEqual(new Map([[id, CONTENT]]));
        expect(mocks.listener).toBeTypeOf('function');
        mocks.asset.mockImplementation(async () => asset(id, {filename: 'renamed.jpg', favorite: undefined}));
        mocks.listener?.({inserted: [], changed: [id], removed: [], albumsChanged: false, requiresReload: false});
        await vi.waitFor(() => expect(stored.get(`entry:${CONTENT}`)).toMatchObject({
            contentHash: CONTENT, originalFilename: 'renamed.jpg', favorite: true,
        }));
        expect(new Uint8Array(await restarted.resolveOriginal(stored.get(`entry:${CONTENT}`)))).toEqual(Uint8Array.of(1, 2, 3, 4));
        await restarted.dispose();
    });

    it('learns Android additions and retires primary-volume locators after an ambiguous notification', async () => {
        mocks.platform = 'android';
        const removed = 'content://media/external_primary/images/media/1';
        const detached = 'content://media/1234-5678/images/media/2';
        const inserted = 'content://media/external_primary/images/media/3';
        mocks.listAssets.mockResolvedValue({assets: [asset(removed), asset(detached)]});
        const {service, stored} = fixture();
        expect(await service.syncAssetIds([removed, detached])).toMatchObject({syncedCount: 2});

        mocks.listAssets.mockResolvedValue({assets: [asset(inserted)]});
        mocks.nativeOriginal.mockReturnValue(Uint8Array.of(1, 2, 3, 5));
        mocks.listener?.({inserted: [], changed: [], removed: [], albumsChanged: true, requiresReload: true});
        await vi.waitFor(async () => {
            const index = await service.getLocalPhotoHashes();
            expect(index.has(inserted)).toBe(true);
            expect(index.has(removed)).toBe(false);
            expect(index.get(detached)).toBe(CONTENT);
        });
        expect(stored.get(`entry:${CONTENT}`)).toBeDefined();
        await service.dispose();
    });

    it('appends one exact tag version to the owner root and skips a normalized duplicate', async () => {
        const {service, stored, writes} = fixture();
        await service.syncAssetIds(['asset-1']);
        const originalRefs = new Set(stored.get(`FotosManifest:fotos:${OWNER}`).entries);
        await service.addPhotoTag(CONTENT, '  Family   trip ');
        const photo = stored.get(`entry:${CONTENT}`);
        expect(photo).toMatchObject({contentHash: CONTENT, tags: new Set(['Family trip'])});
        expect(stored.get(`FotosManifest:fotos:${OWNER}`).entries).toEqual(new Set([...originalRefs,
            `hash:${writes.length - 2}:entry:${CONTENT}`]));
        const count = writes.length;
        await service.addPhotoTag(CONTENT, 'family trip');
        expect(writes).toHaveLength(count);
        await expect(service.addPhotoTag('b'.repeat(64), 'Unowned')).rejects.toThrow('Only photos in your library');
        expect(writes).toHaveLength(count);
    });

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
        expect(mocks.thumbnail).not.toHaveBeenCalled();
        expect(mocks.inspect).toHaveBeenCalledExactlyOnceWith('asset-1', false, 512);
        expect(mocks.read).toHaveBeenCalledExactlyOnceWith('file:///thumbnail.jpg');
    });
    it('keeps ingest available explicitly for gallery assets', async () => {
        const {service, writes} = fixture(OWNER, 'ingest');
        expect(await service.syncAssetIds(['asset-1'])).toMatchObject({syncedCount: 1});
        expect(mocks.blob).toHaveBeenCalledWith(new Uint8Array([1, 2, 3, 4]));
        expect(writes.find(obj => obj.role === 'original')).toHaveProperty('blob', 'stored-blob');
    });
    it('publishes a video reference when Photos has no frame preview', async () => {
        const {service, writes} = fixture();
        mocks.asset.mockResolvedValue(asset('video-1', {filename: 'clip.mov', mediaType: 'video', mimeType: 'video/quicktime'}));
        mocks.thumbnail.mockResolvedValue(null);
        expect(await service.syncAssetIds(['video-1'])).toMatchObject({syncedCount: 1, skippedCount: 0});
        expect(mocks.thumbnail).toHaveBeenCalledExactlyOnceWith('video-1', 512, false);
        expect(mocks.blob).not.toHaveBeenCalled();
        expect(writes.find(obj => obj.$type$ === 'FotosEntry')).toMatchObject({mime: 'video/quicktime'});
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
        expect(mocks.inspect).toHaveBeenLastCalledWith('asset-1', false, 512);
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
        await expect(new FotosMediaLibrarySync(deps).resolveOriginal(stored.get(`entry:${CONTENT}`))).rejects.toThrow('No verified local gallery original');
    });
    it('reports iCloud-only assets without inventing a canonical identity', async () => {
        mocks.inspect.mockResolvedValueOnce({asset: asset('cloud', {filename: 'cloud.heic'}), status: 'icloud-deferred'});
        const {service, writes} = fixture();
        expect(await service.syncAssetIds(['cloud'])).toMatchObject({syncedCount: 0, skippedCount: 0,
            deferredAssets: [{asset: {id: 'cloud'}, status: 'icloud-deferred', thumbnailUri: 'file:///thumbnail.jpg'}]});
        expect(mocks.inspect).toHaveBeenLastCalledWith('cloud', false, 512);
        expect(writes.some(obj => ['FotosEntry', 'FotosMediaVariant', 'FotosMediaLocator', 'FotosManifest'].includes(obj.$type$))).toBe(false);
        expect(writes.find(obj => obj.$type$ === 'SourceEntry')).toMatchObject({locator: 'cloud', summary: 'icloud-deferred'});
        expect(writes.find(obj => obj.$type$ === 'SourceEntry')?.contentHash).toBeUndefined();
        expect(mocks.blob).not.toHaveBeenCalled();
        expect(await service.syncAssetIds(['cloud'], true)).toMatchObject({syncedCount: 1, deferredAssets: []});
        expect(mocks.inspect).toHaveBeenLastCalledWith('cloud', true, 512);
        expect(mocks.thumbnail).toHaveBeenCalledExactlyOnceWith('cloud', 512, false);
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
        expect(collection.id).toBe(`fotos-gallery-collection:v1:${OWNER}:22b699dd-136c-407b-83f4-48f2e47b2b18`);
        expect(writes.find(obj => obj.$type$ === 'FotosGalleryAlbumBinding')).toMatchObject({
            name: 'Trip', collection: idOf(collection), photoHashes: new Set([CONTENT]),
        });
        expect(stored.get(`FotosManifest:fotos:${OWNER}`).albumBindings.size).toBe(1);
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
            albumSyncError: 'Gallery access changed during album reconciliation',
        });
        expect(stored.get(`FotosManifest:fotos:${OWNER}`)).toBe(manifest);
        expect(writes).toEqual([]);
    });
    it('applies incremental PhotoKit changes and drops removed local locators', async () => {
        const {service, stored, deps} = fixture();
        await service.syncAssetIds(['removed']);
        mocks.listener?.({inserted: ['inserted'], changed: [], removed: ['removed'],
            albumsChanged: true, requiresReload: false});
        await service.syncAssetIds([]);
        expect(mocks.inspect).toHaveBeenLastCalledWith('inserted', false, 512);
        await service.resolveOriginal(stored.get(`entry:${CONTENT}`));
        expect(mocks.originalFile).toHaveBeenCalledExactlyOnceWith('inserted', false);
        const book = stored.get('FotosDeviceBook:fotos-device-book:device-1');
        expect([...book.locators].map(ref => mocks.objects.get(ref as string).locator)).toEqual(['inserted']);
        expect(await new FotosMediaLibrarySync(deps).getLocalPhotoHashes()).toEqual(new Map([['inserted', CONTENT]]));
        expect(stored.get(`entry:${CONTENT}`)).toMatchObject({contentHash: CONTENT});
        await service.dispose();
        expect(mocks.unsubscribe).toHaveBeenCalledOnce();
    });
    it('does not persist locator retirement for removals reported under limited Photos access', async () => {
        const {service, stored, deps} = fixture();
        await service.syncAssetIds(['still-owned']);
        const before = stored.get('FotosDeviceBook:fotos-device-book:device-1');
        mocks.permissions.mockResolvedValue({granted: true, accessPrivileges: 'limited'});
        mocks.listener?.({inserted: [], changed: [], removed: ['still-owned'], albumsChanged: false, requiresReload: false});
        await service.syncAssetIds([]);
        expect(await service.getLocalPhotoHashes()).toEqual(new Map());
        expect(stored.get('FotosDeviceBook:fotos-device-book:device-1')).toBe(before);
        expect(await new FotosMediaLibrarySync(deps).getLocalPhotoHashes()).toEqual(new Map([['still-owned', CONTENT]]));
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
    it('auto-syncs unsynced local library assets in batches without prompting when permission is denied', async () => {
        mocks.permissions.mockResolvedValueOnce({granted: false, accessPrivileges: 'none'});
        const {service} = fixture();
        const denied = await service.syncLibrary();
        expect(denied).toMatchObject({permissionGranted: false, requestedCount: 0, syncedCount: 0});
        expect(mocks.listAssets).not.toHaveBeenCalled();
    });
    it('indexes new library assets incrementally, reports progress, attaches the change observer, and skips already-indexed assets', async () => {
        const progress: Array<{discoveredCount: number; processedCount: number; syncedCount: number}> = [];
        mocks.listAssets.mockImplementation(async (offset: number) => offset === 0 ? {
            assets: [
                {id: 'asset-1', filename: 'first.jpg', width: 2, height: 2, mediaType: 'photo', mediaSubtypes: [], duration: 0, favorite: false},
                {id: 'asset-2', filename: 'second.jpg', width: 2, height: 2, mediaType: 'photo', mediaSubtypes: [], duration: 0, favorite: false},
            ],
            nextOffset: 2,
            cursor: 'cursor-1',
        } : {
            assets: [
                {id: 'asset-3', filename: 'third.jpg', width: 2, height: 2, mediaType: 'photo', mediaSubtypes: [], duration: 0, favorite: false},
            ],
            nextOffset: undefined,
        });
        mocks.listAlbums.mockResolvedValue({
            albums: [{id: 'album-1', name: 'Favorites', kind: 'user'}],
            nextOffset: undefined,
        });
        mocks.listAlbumMembers.mockResolvedValue({
            assetIds: ['asset-1'],
            nextOffset: undefined,
        });
        const {service} = fixture();
        const firstPass = await service.syncLibrary({
            batchSize: 2,
            onProgress: value => progress.push({
                discoveredCount: value.discoveredCount,
                processedCount: value.processedCount,
                syncedCount: value.syncedCount,
            }),
        });
        expect(firstPass).toMatchObject({permissionGranted: true, requestedCount: 3, syncedCount: 3, skippedCount: 0});
        expect(progress[0]).toEqual({discoveredCount: 3, processedCount: 0, syncedCount: 0});
        expect(progress.at(-1)).toEqual({discoveredCount: 3, processedCount: 3, syncedCount: 3});
        expect(mocks.listener).toBeDefined();
        expect(mocks.listAlbums).toHaveBeenCalled();

        mocks.inspect.mockClear();
        const secondPass = await service.syncLibrary({batchSize: 2});
        expect(secondPass).toMatchObject({permissionGranted: true, requestedCount: 0, syncedCount: 0, skippedCount: 0});
        expect(mocks.inspect).not.toHaveBeenCalled();
    });
    it('stops cleanly between assets when cancelled mid-batch and preserves already-indexed items', async () => {
        mocks.listAssets.mockResolvedValue({
            assets: [
                {id: 'asset-1', filename: 'first.jpg', width: 2, height: 2, mediaType: 'photo', mediaSubtypes: [], duration: 0, favorite: false},
                {id: 'asset-2', filename: 'second.jpg', width: 2, height: 2, mediaType: 'photo', mediaSubtypes: [], duration: 0, favorite: false},
            ],
            nextOffset: undefined,
        });
        let cancelled = false;
        const {service} = fixture();
        const result = await service.syncLibrary({
            batchSize: 2,
            isCancelled: () => cancelled,
            onProgress: value => {
                if (value.processedCount >= 1) cancelled = true;
            },
        });
        expect(result).toMatchObject({permissionGranted: true, requestedCount: 2, syncedCount: 1, cancelled: true});
        expect(await service.getLocalPhotoHashes()).toEqual(new Map([['asset-1', CONTENT]]));
    });
    it('persists Source.checkpoint and deferred SourceEntry in the ONE DAG across restarts without re-scanning', async () => {
        mocks.listAssets.mockImplementation(async (offset: number) => offset === 0 ? {
            assets: [
                {id: 'asset-1', filename: 'local.jpg', width: 2, height: 2, mediaType: 'photo', mediaSubtypes: [], duration: 0, favorite: false, creationTime: 3000, modificationTime: 1000},
                {id: 'asset-2', filename: 'icloud.jpg', width: 2, height: 2, mediaType: 'photo', mediaSubtypes: [], duration: 0, favorite: false, creationTime: 2000, modificationTime: 2000},
            ],
            nextOffset: undefined,
        } : {assets: [], nextOffset: undefined});
        mocks.inspect.mockImplementation(async (id: string) => id === 'asset-2'
            ? {status: 'icloud-deferred', asset: {id: 'asset-2', filename: 'icloud.jpg', width: 2, height: 2, mediaType: 'photo', mediaSubtypes: [], duration: 0, favorite: false, creationTime: 2000, modificationTime: 2000}}
            : {status: 'available', contentHash: CONTENT, byteSize: 4, thumbnailUri: 'file:///tmp/thumb.jpg', asset: {id, filename: 'local.jpg', width: 2, height: 2, mediaType: 'photo', mediaSubtypes: [], duration: 0, favorite: false, creationTime: 3000, modificationTime: 1000}});

        // First app session: indexes asset-1, records deferred SourceEntry for asset-2, and checkpoints Source in the DAG.
        const shared = fixture();
        const pass1 = await shared.service.syncLibrary({mode: 'auto', batchSize: 10});
        expect(pass1).toMatchObject({permissionGranted: true, requestedCount: 2, syncedCount: 1});
        expect(pass1.deferredAssets).toHaveLength(1);
        const sourceObj = [...shared.stored.values()].find(obj => obj.$type$ === 'Source');
        expect(sourceObj?.checkpoint).toBeTruthy();
        expect(JSON.parse(sourceObj.checkpoint)).toMatchObject({v: 1, newestCreationTime: 3000, oldestScannedCreationTime: 2000});
        expect(typeof JSON.parse(sourceObj.checkpoint).completedAt).toBe('number');
        expect(sourceObj.predecessor).toBeTruthy();

        // Simulated cold app restart: fresh FotosMediaLibrarySync sharing ONLY the ONE DAG store (zero side-channel storage).
        mocks.inspect.mockClear();
        mocks.listAlbums.mockClear();
        const progressOnRestart: any[] = [];
        const restartedService = new FotosMediaLibrarySync(shared.deps);
        const pass2 = await restartedService.syncLibrary({
            mode: 'auto',
            onProgress: value => progressOnRestart.push(value),
        });
        expect(pass2).toMatchObject({permissionGranted: true, requestedCount: 0, syncedCount: 0, skippedCount: 0});
        expect(mocks.inspect).not.toHaveBeenCalled();
        expect(mocks.listAlbums).not.toHaveBeenCalled();
        expect(progressOnRestart).toEqual([]);
    });
});
