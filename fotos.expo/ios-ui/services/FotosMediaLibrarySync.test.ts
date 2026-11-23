import {readFileSync} from 'node:fs';
import {URL} from 'node:url';
import {beforeEach, describe, expect, it, vi} from 'vitest';
const OWNER = 'a'.repeat(64);
const CONTENT = '9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a';
const fixtureDirectory = new URL('../../../fotos.core/test/fixtures/content-hash/', import.meta.url);
const JPEG = readFileSync(new URL('with-exif.jpg', fixtureDirectory)).toString('base64');
const mocks = vi.hoisted(() => ({
    record: vi.fn<(params: any) => Promise<string>>(async () => 'observation-hash'),
    blob: vi.fn(async () => ({hash: 'stored-blob'})), batches: vi.fn(async (): Promise<any[]> => []),
    deleteBatch: vi.fn(), access: vi.fn(async () => []), objects: new Map<string, any>(),
    info: vi.fn<(id: any, options: any) => Promise<any>>(), read: vi.fn(async () => 'AQIDBA=='),
    remove: vi.fn(async () => undefined),
    thumbnail: vi.fn(async () => ({uri: 'file:///thumbnail.jpg', width: 1, height: 1, base64: JPEG})),
}));
vi.mock('react-native', () => ({Platform: {OS: 'ios'}}));
vi.mock('expo-crypto', () => ({CryptoDigestAlgorithm: {SHA256: 'SHA256'}, digest: async (_algorithm: string, bytes: Uint8Array) => Uint8Array.from((await import('node:crypto')).createHash('sha256').update(bytes).digest()).buffer}));
vi.mock('expo-file-system/legacy', () => ({EncodingType: {Base64: 'base64'}, readAsStringAsync: mocks.read, deleteAsync: mocks.remove}));
vi.mock('expo-image-manipulator', () => ({SaveFormat: {JPEG: 'jpeg'}, manipulateAsync: mocks.thumbnail}));
vi.mock('expo-media-library', () => ({getPermissionsAsync: async () => ({granted: true, accessPrivileges: 'all'}), getAssetInfoAsync: mocks.info}));
vi.mock('@refinio/one.core/lib/storage-blob.js', () => ({storeArrayBufferAsBlob: mocks.blob}));
vi.mock('@refinio/one.core/lib/storage-unversioned-objects.js', () => ({getObject: async (hash: string) => mocks.objects.get(hash)}));
vi.mock('@refinio/one.core/lib/access.js', () => ({createAccess: mocks.access}));
vi.mock('@refinio/one.core/lib/storage-base-common.js', () => ({SET_ACCESS_MODE: {ADD: 'add'}}));
vi.mock('@refinio/fotos.core', async () => ({
    ...await import('../../../fotos.core/src/content-hash.js'),
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
    readFotosThumbnailDimensions: () => ({width: 1, height: 1})}));
vi.mock('../../../../one/packages/source.media/src/services/MediaSourceService.js', () => ({
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
beforeEach(() => {
    vi.clearAllMocks(); mocks.objects.clear(); mocks.record.mockResolvedValue('observation-hash');
    mocks.blob.mockResolvedValue({hash: 'stored-blob'}); mocks.batches.mockResolvedValue([]); mocks.read.mockResolvedValue('AQIDBA==');
    mocks.thumbnail.mockResolvedValue({uri: 'file:///thumbnail.jpg', width: 1, height: 1, base64: JPEG});
    mocks.info.mockImplementation(async (id: any) => ({id: typeof id === 'string' ? id : id.id,
        filename: 'photo.jpg', localUri: 'file:///photo.jpg', creationTime: 1000, modificationTime: 2000,
        width: 2, height: 2, duration: 0, exif: {Make: 'Reported', Model: 'Camera'}}));
});
describe('Expo reference-first media acquisition', () => {
    it('stores only a bounded thumbnail BLOB and grants the owner-scoped root', async () => {
        const {service, writes} = fixture();
        expect(await service.syncAssetIds(['asset-1'])).toMatchObject({syncedCount: 1, skippedCount: 0});
        expect(mocks.blob).toHaveBeenCalledExactlyOnceWith(new Uint8Array(Buffer.from(JPEG, 'base64')));
        expect(writes.find(obj => obj.role === 'original')).not.toHaveProperty('blob');
        expect(writes.find(obj => obj.role === 'thumbnail')).toMatchObject({blob: 'stored-blob', width: 1, height: 1, mime: 'image/jpeg'});
        expect(writes.find(obj => obj.$type$ === 'FotosEntry')).toMatchObject({thumb: 'stored-blob'});
        expect(writes.find(obj => obj.$type$ === 'FotosMediaLocator')).toMatchObject({kind: 'phasset', scope: 'device-local', locator: 'asset-1', deviceId: 'device-1'});
        expect(writes.at(-1)).toMatchObject({$type$: 'FotosManifest', id: `fotos:${OWNER}`, entries: expect.any(Set)});
        expect(mocks.access).toHaveBeenCalledWith([{id: `FotosManifest:fotos:${OWNER}`, person: [OWNER], hashGroup: [], mode: 'add'}]);
        expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({observer: OWNER,
            context: expect.objectContaining({surface: 'mobile-library', source: 'asset-1', reportedCaptureTime: '1970-01-01T00:00:01.000Z'})}));
        expect(mocks.remove).toHaveBeenCalledWith('file:///thumbnail.jpg', {idempotent: true});
    });
    it('keeps ingest available explicitly for gallery assets', async () => {
        const {service, writes} = fixture(OWNER, 'ingest');
        expect(await service.syncAssetIds(['asset-1'])).toMatchObject({syncedCount: 1});
        expect(mocks.blob).toHaveBeenCalledWith(new Uint8Array([1, 2, 3, 4]));
        expect(writes.find(obj => obj.role === 'original')).toHaveProperty('blob', 'stored-blob');
    });
    it('resyncs Expo metadata using the same content-derived entry identity', async () => {
        const {service, writes} = fixture(); await service.syncAssetIds(['asset-1']);
        mocks.info.mockResolvedValue({id: 'asset-1', filename: 'renamed.jpg', localUri: 'file:///photo.jpg',
            creationTime: 3000, modificationTime: 4000, width: 4096, height: 2048, duration: 2,
            isFavorite: true, orientation: 6, mediaSubtypes: ['livePhoto', 'hdr', 'depthEffect', 'videoCinematic', 'spatialMedia'],
            location: {latitude: 53, longitude: 13}, exif: {GPSAltitude: 42, LensModel: 'Lens', FNumber: 2, ISO: 100}});
        await service.syncAssetIds(['asset-1']);
        const entries = writes.filter(obj => obj.$type$ === 'FotosEntry');
        expect(entries).toHaveLength(2); expect(idOf(entries[0])).toBe(idOf(entries[1]));
        expect(entries[1]).toMatchObject({contentHash: CONTENT, originalFilename: 'renamed.jpg', duration: 2, favorite: true,
            orientation: 6, exifGpsLat: 53, exifGpsLon: 13, exifGpsAlt: 42, exifLens: 'Lens', mediaSubtypes: new Set(['live-photo', 'hdr', 'depth', 'cinematic'])});
        expect(entries[1].variants.size).toBeGreaterThanOrEqual(entries[0].variants.size);
        expect(mocks.thumbnail).toHaveBeenLastCalledWith('file:///photo.jpg', [{resize: {width: 512, height: 256}}], expect.any(Object));
    });
    it('retains one media identity and both exact versions when embedded PNG metadata changes', async () => {
        const {service, stored, writes} = fixture();
        const info = await mocks.info('asset-1', {});
        mocks.info.mockResolvedValue({...info, filename: 'photo.png', localUri: 'file:///photo.png'});
        mocks.read
            .mockResolvedValueOnce(readFileSync(new URL('plain.png', fixtureDirectory)).toString('base64'))
            .mockResolvedValueOnce(readFileSync(new URL('with-exif-and-text.png', fixtureDirectory)).toString('base64'));
        await service.syncAssetIds(['asset-1']);
        const pngInfo = await mocks.info('asset-1', {});
        mocks.info.mockResolvedValue({...pngInfo, exif: {Make: 'Corrected', Model: 'Camera', GPSLatitude: 52}});
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
        mocks.info.mockResolvedValue({id: 'asset-1', filename: 'photo.jpg', localUri: 'file:///photo.jpg', width: 2, height: 2,
            exif: {'{TIFF}': {Make: 'Reported', Model: 'Camera', Orientation: 3},
                '{ExifAux}': {LensModel: 'Lens'},
                '{Exif}': {DateTimeOriginal: '2026:11:22 12:34:56', ISOSpeedRatings: [100], FNumber: 2},
                '{GPS}': {Latitude: 20, LatitudeRef: 'S', Longitude: 30, LongitudeRef: 'W', Altitude: 10, AltitudeRef: 1}}});
        const {service, writes} = fixture();
        expect(await service.syncAssetIds(['asset-1'])).toMatchObject({syncedCount: 1});
        expect(writes.find(obj => obj.$type$ === 'FotosEntry')).toMatchObject({exifCamera: 'Reported Camera', exifLens: 'Lens',
            exifIso: 100, orientation: 3, exifGpsLat: -20, exifGpsLon: -30, exifGpsAlt: -10, exifDate: '2026-11-22T12:34:56'});
    });
    it('rejects a thumbnail whose encoded frame disagrees with native dimensions', async () => {
        mocks.thumbnail.mockResolvedValue({uri: 'file:///thumbnail.jpg', width: 2, height: 2, base64: JPEG});
        const {service, writes} = fixture();
        expect(await service.syncAssetIds(['asset-1'])).toMatchObject({syncedCount: 0, skippedCount: 1});
        expect(writes.some(obj => obj.$type$ === 'FotosEntry' || obj.$type$ === 'FotosManifest')).toBe(false);
        expect(mocks.remove).toHaveBeenCalledOnce();
    });
    it('resolves bytes through stored device locators after service restart', async () => {
        const {service, deps, stored} = fixture(); await service.syncAssetIds(['asset-1']);
        expect(new Uint8Array(await new FotosMediaLibrarySync(deps).resolveOriginal(stored.get(`entry:${CONTENT}`)))).toEqual(new Uint8Array([1, 2, 3, 4]));
        expect(mocks.info).toHaveBeenLastCalledWith('asset-1', {shouldDownloadFromNetwork: false});
        expect(mocks.blob).toHaveBeenCalledTimes(1);
    });
    it('refuses a stored locator whose bytes no longer match the content identity', async () => {
        const {service, deps, stored} = fixture(); await service.syncAssetIds(['asset-1']);
        mocks.read.mockResolvedValue('BQYHCA==');
        await expect(new FotosMediaLibrarySync(deps).resolveOriginal(stored.get(`entry:${CONTENT}`))).rejects.toThrow('No verified local Photos original');
    });
    it('reports iCloud-only assets without inventing a canonical identity', async () => {
        mocks.info.mockResolvedValue({id: 'cloud', filename: 'cloud.heic', isNetworkAsset: true});
        const {service, writes} = fixture();
        expect(await service.syncAssetIds(['cloud'])).toMatchObject({syncedCount: 0, skippedCount: 1, issues: [{reason: expect.stringContaining('iCloud')}]});
        expect(writes).toEqual([]); expect(mocks.blob).not.toHaveBeenCalled();
    });
    it('serializes concurrent service and inbox publication, preserving manifest extensions', async () => {
        const {service, deps, stored} = fixture();
        mocks.record.mockImplementation(async params => `observation:${params.context.source}`);
        stored.set(`FotosManifest:fotos:${OWNER}`, {$type$: 'FotosManifest', id: `fotos:${OWNER}`, entries: new Set(['old-entry']), collections: new Set(['album'])});
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
