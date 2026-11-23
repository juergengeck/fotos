import {
    buildFotosAlbumCollectionId,
    createFotosAlbumCollection,
    isFotosAlbumCollectionFromLibrary,
    type FotosCollection,
} from '@refinio/fotos.core';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';

export interface FotosPhotoKitAlbumNative {
    listAlbums(offset: number, limit: number): Promise<{
        albums: Array<{id: string; name: string; kind: 'user' | 'smart'}>;
        nextOffset?: number;
    }>;
    listAlbumMembers(id: string, offset: number, limit: number): Promise<{
        assetIds: string[];
        nextOffset?: number;
    }>;
}

export interface ReconcileFotosPhotoKitAlbumsParams {
    native: FotosPhotoKitAlbumNative;
    ownerId: string;
    libraryId: string;
    fullAccess: boolean;
    assetHashes: ReadonlyMap<string, string>;
    existingRefs: ReadonlySet<SHA256Hash<FotosCollection>>;
    readCollection(hash: SHA256Hash<FotosCollection>): Promise<FotosCollection>;
    storeCollection(collection: FotosCollection): Promise<SHA256Hash<FotosCollection>>;
}

const PAGE_SIZE = 100;

function sameSet<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
    return left.size === right.size && [...left].every(value => right.has(value));
}

function nextPage(offset: number, nextOffset: number | undefined, count: number): number | undefined {
    if (nextOffset !== undefined && (
        !Number.isSafeInteger(nextOffset) || nextOffset <= offset || count === 0
    )) {
        throw new Error('Invalid or nonadvancing PhotoKit album page offset');
    }
    return nextOffset;
}

function checkPage(items: unknown): asserts items is unknown[] {
    if (!Array.isArray(items) || items.length > PAGE_SIZE) {
        throw new Error('Invalid or oversized PhotoKit album page');
    }
}

/** Reconcile immutable album references; the caller publishes its root only after success. */
export async function reconcileFotosPhotoKitAlbums(
    params: ReconcileFotosPhotoKitAlbumsParams,
): Promise<{collections: Set<SHA256Hash<FotosCollection>>; changed: boolean}> {
    const existing = new Map<string, Array<{hash: SHA256Hash<FotosCollection>; collection: FotosCollection}>>();
    const collections = new Set<SHA256Hash<FotosCollection>>();
    for (const hash of params.existingRefs) {
        const collection = await params.readCollection(hash);
        if (collection.$type$ !== 'FotosCollection' || typeof collection.id !== 'string'
            || !(collection.photoHashes instanceof Set)) {
            throw new Error('Invalid stored Fotos album collection');
        }
        if (!isFotosAlbumCollectionFromLibrary(collection.id, params.ownerId, params.libraryId)) {
            collections.add(hash);
            continue;
        }
        const versions = existing.get(collection.id) ?? [];
        versions.push({hash, collection});
        existing.set(collection.id, versions);
    }

    const visible = new Map<string, {id: string; name: string}>();
    const seenAlbumIds = new Set<string>();
    let offset: number | undefined = 0;
    while (offset !== undefined) {
        const page = await params.native.listAlbums(offset, PAGE_SIZE);
        checkPage(page.albums);
        const next = nextPage(offset, page.nextOffset, page.albums.length);
        for (const album of page.albums) {
            if (!album || typeof album.id !== 'string' || album.id.length === 0
                || typeof album.name !== 'string' || (album.kind !== 'user' && album.kind !== 'smart')
                || seenAlbumIds.has(album.id)) {
                throw new Error('Invalid or duplicate PhotoKit album');
            }
            seenAlbumIds.add(album.id);
            if (album.kind === 'user') {
                visible.set(buildFotosAlbumCollectionId(params.ownerId, params.libraryId, album.id), album);
            }
        }
        offset = next;
    }

    // Finish every native read before writing collections, so an incomplete scan never
    // produces a reconciliation result or stores a partial replacement snapshot.
    const pending: FotosCollection[] = [];
    for (const [id, album] of visible) {
        const photoHashes = new Set<string>();
        if (!params.fullAccess) {
            for (const version of existing.get(id) ?? []) {
                for (const hash of version.collection.photoHashes) photoHashes.add(hash);
            }
        }
        offset = 0;
        while (offset !== undefined) {
            const page = await params.native.listAlbumMembers(album.id, offset, PAGE_SIZE);
            checkPage(page.assetIds);
            const next = nextPage(offset, page.nextOffset, page.assetIds.length);
            for (const assetId of page.assetIds) {
                if (typeof assetId !== 'string' || assetId.length === 0) {
                    throw new Error('Invalid PhotoKit album member');
                }
                const hash = params.assetHashes.get(assetId);
                if (hash !== undefined) photoHashes.add(hash);
            }
            offset = next;
        }
        pending.push(createFotosAlbumCollection({
            owner: params.ownerId,
            libraryId: params.libraryId,
            albumId: album.id,
            name: album.name,
            photoHashes,
        }));
    }

    if (!params.fullAccess) {
        for (const [id, versions] of existing) {
            if (!visible.has(id)) for (const version of versions) collections.add(version.hash);
        }
    }
    for (const collection of pending) {
        const reusable = existing.get(collection.id)?.find(version =>
            version.collection.name === collection.name
            && sameSet(version.collection.photoHashes, collection.photoHashes));
        collections.add(reusable?.hash ?? await params.storeCollection(collection));
    }
    return {collections, changed: !sameSet(collections, params.existingRefs)};
}
