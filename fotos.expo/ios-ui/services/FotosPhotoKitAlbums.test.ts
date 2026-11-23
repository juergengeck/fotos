import {createHash} from 'node:crypto';
import {describe, expect, it, vi} from 'vitest';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';
import type {FotosCollection} from '@refinio/fotos.core';
import {createFotosAlbumCollection, isFotosAlbumCollectionFromLibrary} from '@refinio/fotos.core';
import {
    reconcileFotosPhotoKitAlbums,
    type FotosPhotoKitAlbumNative,
    type ReconcileFotosPhotoKitAlbumsParams,
} from './FotosPhotoKitAlbums';

// Exercise the canonical collection implementation without loading unrelated core services.
vi.mock('@refinio/fotos.core', async () => await import('../../../fotos.core/src/fotos-collection.js'));

const OWNER = 'a'.repeat(64);
const LIBRARY = 'b'.repeat(64);
const PHOTO_A = '1'.repeat(64);
const PHOTO_B = '2'.repeat(64);
const PHOTO_C = '3'.repeat(64);
type Ref = SHA256Hash<FotosCollection>;
type Album = {id: string; name: string; kind: 'user' | 'smart'};

function reference(collection: FotosCollection): Ref {
    return createHash('sha256').update(JSON.stringify({
        id: collection.id, name: collection.name, members: [...collection.photoHashes].sort(),
    })).digest('hex') as Ref;
}

function harness(albums: Album[] = []) {
    const objects = new Map<Ref, FotosCollection>();
    const native = {
        listAlbums: vi.fn<FotosPhotoKitAlbumNative['listAlbums']>(async () => ({albums})),
        listAlbumMembers: vi.fn<FotosPhotoKitAlbumNative['listAlbumMembers']>(async () => ({assetIds: []})),
    };
    const params: ReconcileFotosPhotoKitAlbumsParams = {
        native, ownerId: OWNER, libraryId: LIBRARY, fullAccess: true,
        assetHashes: new Map([['local-a', PHOTO_A], ['local-b', PHOTO_B], ['local-c', PHOTO_C]]),
        existingRefs: new Set(),
        readCollection: vi.fn(async ref => {
            const value = objects.get(ref);
            if (!value) throw new Error('Missing stored collection');
            return value;
        }),
        storeCollection: vi.fn(async value => {
            const ref = reference(value);
            objects.set(ref, value);
            return ref;
        }),
    };
    function seed(albumId: string, name: string, photos: string[], owner = OWNER, libraryId = LIBRARY) {
        const collection = createFotosAlbumCollection({owner, libraryId, albumId, name, photoHashes: photos});
        const ref = reference(collection);
        objects.set(ref, collection);
        (params.existingRefs as Set<Ref>).add(ref);
        return ref;
    }
    return {params, native, objects, seed};
}

const userAlbum = (id: string, name = id): Album => ({id, name, kind: 'user'});

describe('PhotoKit album reconciliation', () => {
    it('reuses the exact reference when names and deduplicated membership are unchanged', async () => {
        const h = harness([userAlbum('trip', 'Trip')]);
        const old = h.seed('trip', 'Trip', [PHOTO_A, PHOTO_B]);
        h.params.assetHashes = new Map([['copy-a', PHOTO_A], ['local-a', PHOTO_A], ['local-b', PHOTO_B]]);
        h.native.listAlbumMembers.mockResolvedValue({assetIds: ['local-b', 'copy-a', 'local-a', 'unknown']});
        const result = await reconcileFotosPhotoKitAlbums(h.params);
        expect(result).toEqual({collections: new Set([old]), changed: false});
        expect(h.params.storeCollection).not.toHaveBeenCalled();
    });

    it('keeps album identity through renames and replaces only its exact reference', async () => {
        const h = harness([userAlbum('album/with:escapes', 'Summer Trip')]);
        const old = h.seed('album/with:escapes', 'Trip', [PHOTO_A]);
        const previous = h.objects.get(old)!;
        h.native.listAlbumMembers.mockResolvedValue({assetIds: ['local-a']});
        const result = await reconcileFotosPhotoKitAlbums(h.params);
        expect(result.changed).toBe(true);
        expect(result.collections.has(old)).toBe(false);
        expect(h.params.storeCollection).toHaveBeenCalledWith({
            $type$: 'FotosCollection', id: previous.id, name: 'Summer Trip', photoHashes: new Set([PHOTO_A]),
        });
        expect(previous.name).toBe('Trip');
    });

    it('recomputes full-access membership and removes vanished albums while preserving foreign refs', async () => {
        const h = harness([userAlbum('kept'), {id: 'smart', name: 'Recents', kind: 'smart'}]);
        const old = h.seed('kept', 'kept', [PHOTO_A, PHOTO_B]);
        const vanished = h.seed('gone', 'gone', [PHOTO_C]);
        const otherLibrary = h.seed('gone', 'Other device', [PHOTO_C], OWNER, 'c'.repeat(64));
        const otherOwner = h.seed('kept', 'Other owner', [PHOTO_A], 'd'.repeat(64));
        h.native.listAlbumMembers.mockResolvedValue({assetIds: ['local-b', 'local-c', 'unknown']});
        const result = await reconcileFotosPhotoKitAlbums(h.params);
        expect(result.collections.has(old)).toBe(false);
        expect(result.collections.has(vanished)).toBe(false);
        expect(result.collections.has(otherLibrary)).toBe(true);
        expect(result.collections.has(otherOwner)).toBe(true);
        expect(result.collections.size).toBe(3);
        expect(h.params.storeCollection).toHaveBeenCalledWith(expect.objectContaining({
            photoHashes: new Set([PHOTO_B, PHOTO_C]),
        }));
        expect(h.native.listAlbumMembers).toHaveBeenCalledTimes(1);
        expect(h.native.listAlbumMembers.mock.calls[0][0]).toBe('kept');
    });

    it('merges visible limited-access members and preserves missing albums and hidden members', async () => {
        const h = harness([userAlbum('visible', 'New name'), userAlbum('new')]);
        h.params.fullAccess = false;
        const old = h.seed('visible', 'Old name', [PHOTO_A]);
        const hidden = h.seed('hidden', 'Hidden album', [PHOTO_C]);
        const foreign = h.seed('foreign', 'Foreign', [PHOTO_A], OWNER, 'c'.repeat(64));
        h.native.listAlbumMembers.mockImplementation(async id => ({assetIds: id === 'visible' ? ['local-b'] : ['local-c']}));
        const result = await reconcileFotosPhotoKitAlbums(h.params);
        expect(result.changed).toBe(true);
        expect(result.collections.has(old)).toBe(false);
        expect(result.collections.has(hidden)).toBe(true);
        expect(result.collections.has(foreign)).toBe(true);
        expect(h.params.storeCollection).toHaveBeenCalledWith(expect.objectContaining({
            name: 'New name', photoHashes: new Set([PHOTO_A, PHOTO_B]),
        }));
        expect(h.objects.get(old)!.photoHashes).toEqual(new Set([PHOTO_A]));
    });

    it('keeps exact hidden references when limited access exposes no albums or members', async () => {
        const h = harness([userAlbum('visible')]);
        h.params.fullAccess = false;
        const visible = h.seed('visible', 'visible', [PHOTO_A]);
        const hidden = h.seed('hidden', 'hidden', [PHOTO_B]);
        expect(await reconcileFotosPhotoKitAlbums(h.params)).toEqual({
            collections: new Set([visible, hidden]), changed: false,
        });
        h.native.listAlbums.mockResolvedValue({albums: []});
        expect(await reconcileFotosPhotoKitAlbums(h.params)).toEqual({
            collections: new Set([visible, hidden]), changed: false,
        });
        expect(h.params.storeCollection).not.toHaveBeenCalled();
    });

    it('removes all current-library collections on a successful empty full-access scan', async () => {
        const h = harness();
        h.seed('removed', 'removed', [PHOTO_A]);
        const foreign = h.seed('foreign', 'foreign', [PHOTO_A], OWNER, 'c'.repeat(64));
        expect(await reconcileFotosPhotoKitAlbums(h.params)).toEqual({collections: new Set([foreign]), changed: true});
    });

    it('reads album and membership pages with a bounded limit and deduplicates hashes across pages', async () => {
        const h = harness();
        h.native.listAlbums.mockImplementation(async offset => offset === 0
            ? {albums: [userAlbum('first')], nextOffset: 1} : {albums: [userAlbum('second')]});
        h.native.listAlbumMembers.mockImplementation(async (_id, offset) => offset === 0
            ? {assetIds: ['local-a'], nextOffset: 1} : {assetIds: ['local-a', 'local-b']});
        const result = await reconcileFotosPhotoKitAlbums(h.params);
        expect(result.collections.size).toBe(2);
        expect(h.native.listAlbums.mock.calls.map(([offset]) => offset)).toEqual([0, 1]);
        for (const [, limit] of h.native.listAlbums.mock.calls) expect(limit).toBeGreaterThan(0);
        for (const [, , limit] of h.native.listAlbumMembers.mock.calls) expect(limit).toBeLessThanOrEqual(100);
        for (const [collection] of vi.mocked(h.params.storeCollection).mock.calls) {
            expect(collection.photoHashes).toEqual(new Set([PHOTO_A, PHOTO_B]));
        }
    });

    it.each(['albums', 'members'] as const)('rejects failed %s pages before storing any replacement', async kind => {
        const h = harness([userAlbum('first'), userAlbum('second')]);
        const old = h.seed('old', 'Old', [PHOTO_C]);
        if (kind === 'albums') {
            h.native.listAlbums.mockResolvedValueOnce({albums: [userAlbum('first')], nextOffset: 1})
                .mockRejectedValueOnce(new Error('Native page failed'));
        } else {
            h.native.listAlbumMembers.mockResolvedValueOnce({assetIds: ['local-a']})
                .mockResolvedValueOnce({assetIds: ['local-b'], nextOffset: 1})
                .mockRejectedValueOnce(new Error('Native page failed'));
        }
        await expect(reconcileFotosPhotoKitAlbums(h.params)).rejects.toThrow('Native page failed');
        expect(h.params.storeCollection).not.toHaveBeenCalled();
        expect(h.params.existingRefs).toEqual(new Set([old]));
    });

    it.each([0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid album continuation %s', async nextOffset => {
        const h = harness();
        h.native.listAlbums.mockResolvedValue({albums: [userAlbum('first')], nextOffset});
        await expect(reconcileFotosPhotoKitAlbums(h.params)).rejects.toThrow('page offset');
        expect(h.params.storeCollection).not.toHaveBeenCalled();
    });

    it('rejects a nonadvancing member page and an empty continuing page', async () => {
        const h = harness([userAlbum('first')]);
        h.native.listAlbumMembers.mockResolvedValueOnce({assetIds: ['local-a'], nextOffset: 1})
            .mockResolvedValueOnce({assetIds: ['local-b'], nextOffset: 1});
        await expect(reconcileFotosPhotoKitAlbums(h.params)).rejects.toThrow('page offset');
        h.native.listAlbumMembers.mockResolvedValue({assetIds: [], nextOffset: 1});
        await expect(reconcileFotosPhotoKitAlbums(h.params)).rejects.toThrow('page offset');
        expect(h.params.storeCollection).not.toHaveBeenCalled();
    });

    it('rejects duplicate albums and oversized pages instead of publishing a partial scan', async () => {
        const h = harness([userAlbum('duplicate'), userAlbum('duplicate')]);
        await expect(reconcileFotosPhotoKitAlbums(h.params)).rejects.toThrow('duplicate');
        h.native.listAlbums.mockResolvedValue({albums: Array.from({length: 101}, (_, i) => userAlbum(String(i)))});
        await expect(reconcileFotosPhotoKitAlbums(h.params)).rejects.toThrow('oversized');
        expect(h.params.storeCollection).not.toHaveBeenCalled();
    });

    it('propagates storage failures without returning a new root reference set', async () => {
        const h = harness([userAlbum('first')]);
        vi.mocked(h.params.storeCollection).mockRejectedValue(new Error('Storage failed'));
        await expect(reconcileFotosPhotoKitAlbums(h.params)).rejects.toThrow('Storage failed');
    });
});

describe('canonical album source scope', () => {
    it('checks exact owners and libraries and rejects malformed identities', () => {
        const album = createFotosAlbumCollection({owner: OWNER, libraryId: LIBRARY,
            albumId: 'path:with/escapes', name: 'Name', photoHashes: []});
        expect(isFotosAlbumCollectionFromLibrary(album.id, OWNER, LIBRARY)).toBe(true);
        expect(isFotosAlbumCollectionFromLibrary(album.id, OWNER, 'c'.repeat(64))).toBe(false);
        expect(isFotosAlbumCollectionFromLibrary(album.id, 'd'.repeat(64), LIBRARY)).toBe(false);
        expect(isFotosAlbumCollectionFromLibrary(`fotos-album:v1:${OWNER}:${LIBRARY}:bad%ZZ`, OWNER, LIBRARY)).toBe(false);
        expect(isFotosAlbumCollectionFromLibrary(album.id + 'x'.repeat(4096), OWNER, LIBRARY)).toBe(false);
    });
});
