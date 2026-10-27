import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
    record: vi.fn<(params: any) => Promise<string>>(async () => 'observation-hash'),
    blob: vi.fn(async () => ({hash: 'original-blob'})),
    batches: vi.fn(async (): Promise<any[]> => []),
    deleteBatch: vi.fn(),
}));
vi.mock('react-native', () => ({Platform: {OS: 'ios'}}));
vi.mock('expo-crypto', () => ({CryptoDigestAlgorithm: {SHA256: 'SHA256'}, digest: async () => new Uint8Array(32).fill(1).buffer}));
vi.mock('expo-file-system/legacy', () => ({EncodingType: {Base64: 'base64'}, readAsStringAsync: async () => 'AQIDBA=='}));
vi.mock('expo-media-library', () => ({
    getPermissionsAsync: async () => ({granted: true, accessPrivileges: 'all'}),
    getAssetInfoAsync: async () => ({id: 'asset-1', filename: 'photo.jpg', localUri: 'file:///photo.jpg', creationTime: 1000, modificationTime: 2000, width: 2, height: 2, exif: {Make: 'Reported', Model: 'Camera'}}),
}));
vi.mock('@refinio/one.core/lib/storage-blob.js', () => ({storeArrayBufferAsBlob: mocks.blob}));
vi.mock('@refinio/fotos.core', () => ({
    normalizeImageBytesForContentHash: (bytes: Uint8Array) => bytes,
    recordFotosAcquisition: mocks.record,
    createFotosMediaVariant: (params: object) => ({$type$: 'FotosMediaVariant', ...params}),
    createFotosMediaLocator: (params: object) => ({$type$: 'FotosMediaLocator', ...params}),
    appendFotosDeviceBookContent: async () => undefined,
}));
vi.mock('@refinio/source.media/services', () => ({
    createMediaSource: (params: object) => ({$type$: 'Source', id: 'source', ...params}),
    createMediaSourceEntry: (params: object) => ({$type$: 'SourceEntry', sourceRef: 'source-ref', ...params}),
    appendMediaBookContent: async () => undefined,
}));
vi.mock('./FotosShareInbox', () => ({
    readFotosShareInboxBatches: mocks.batches, deleteFotosShareInboxBatch: mocks.deleteBatch,
    getFotosShareInboxStatus: async () => ({}),
}));
import {FotosMediaLibrarySync} from './FotosMediaLibrarySync';

function fixture(owner: string | undefined = 'a'.repeat(64)) {
    const stored = new Map<string, any>();
    const writes: any[] = [];
    return {writes, service: new FotosMediaLibrarySync({
        calculateIdHashOfObj: async (obj: any) => `id:${obj.$type$}`,
        getObjectByIdHash: async id => {
            if (!stored.has(id)) {
                const error = new Error('not found');
                error.name = 'FileNotFoundError';
                throw error;
            }
            return {obj: stored.get(id)};
        },
        storeVersionedObject: async (obj: any) => {
            writes.push(obj);
            const idHash = `id:${obj.$type$}`;
            stored.set(idHash, obj);
            return {hash: `hash:${obj.$type$}`, idHash};
        },
        getOwnerId: () => owner, getInstanceId: () => 'device-1',
    })};
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.record.mockResolvedValue('observation-hash');
    mocks.blob.mockResolvedValue({hash: 'original-blob'});
    mocks.batches.mockResolvedValue([]);
});

describe('Expo public media acquisition', () => {
    it('retains library bytes and publishes their acquisition observation with the entry', async () => {
        const {service, writes} = fixture();
        const result = await service.syncAssetIds(['asset-1']);
        expect(result).toMatchObject({syncedCount: 1, skippedCount: 0});
        expect(mocks.blob).toHaveBeenCalledWith(new Uint8Array([1, 2, 3, 4]));
        expect(writes.find(obj => obj.$type$ === 'FotosMediaVariant')).toMatchObject({blob: 'original-blob', role: 'original'});
        expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({
            observer: 'a'.repeat(64), originalVariant: 'hash:FotosMediaVariant',
            context: expect.objectContaining({surface: 'mobile-library', source: 'asset-1', reportedCaptureTime: '1970-01-01T00:00:01.000Z'}),
        }));
        expect(writes.find(obj => obj.$type$ === 'FotosEntry').acquisitionObservations).toEqual(new Set(['observation-hash']));
        expect(writes.at(-1)).toMatchObject({$type$: 'FotosManifest', entries: new Set(['hash:FotosEntry'])});
    });

    it('keeps shared-file arrival time out of reported capture metadata', async () => {
        mocks.batches.mockResolvedValue([{items: [{batchId: 'batch', fileUri: 'file:///shared.png', originalName: 'shared.png', createdAt: '2026-10-21T12:00:00Z'}]}]);
        const {service, writes} = fixture();
        expect(await service.importPendingSharedInbox()).toMatchObject({syncedCount: 1, skippedCount: 0});
        expect(mocks.record.mock.calls[0][0].context).toMatchObject({surface: 'shared-file', source: 'file:///shared.png'});
        expect(mocks.record.mock.calls[0][0].context).not.toHaveProperty('reportedCaptureTime');
        expect(writes.find(obj => obj.$type$ === 'FotosMediaVariant').blob).toBe('original-blob');
        expect(writes.find(obj => obj.$type$ === 'FotosEntry')).not.toHaveProperty('capturedAt');
        expect(mocks.deleteBatch).toHaveBeenCalledOnce();
    });

    it('reports provenance failure and leaves the native publication root unpublished', async () => {
        mocks.record.mockRejectedValueOnce(new Error('evidence unavailable'));
        const {service, writes} = fixture();
        const result = await service.syncAssetIds(['asset-1']);
        expect(result).toMatchObject({syncedCount: 0, skippedCount: 1});
        expect(result.issues[0].reason).toContain('evidence unavailable');
        expect(writes.some(obj => obj.$type$ === 'FotosEntry' || obj.$type$ === 'FotosManifest')).toBe(false);
    });
});


it('does not overwrite previous acquisition evidence after an operational read failure', async () => {
    const {service, writes} = fixture();
    (service as any).deps.getObjectByIdHash = async () => {throw new Error('storage offline');};
    const result = await service.syncAssetIds(['asset-1']);
    expect(result).toMatchObject({syncedCount: 0, skippedCount: 1});
    expect(result.issues[0].reason).toContain('storage offline');
    expect(writes).toEqual([]);
    expect(mocks.record).not.toHaveBeenCalled();
});
