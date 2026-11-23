import {
    reconcileFotosGalleryAlbums,
    type FotosObservedGalleryAlbum,
    type ReconcileFotosGalleryAlbumsParams,
} from '@refinio/fotos.core';
import type {FotosPhotoKitNative} from './FotosPhotoKit';
import {visitFotosPhotoKitPages} from './FotosPhotoKitPaging';

export type FotosPhotoKitAlbumNative = Pick<FotosPhotoKitNative, 'listAlbums' | 'listAlbumMembers' | 'releaseCursor'>;

export interface ReconcileFotosPhotoKitAlbumsParams extends Omit<
    ReconcileFotosGalleryAlbumsParams, 'owner' | 'platform' | 'complete' | 'observed' | 'collectionRefs'
> {
    native: FotosPhotoKitAlbumNative;
    ownerId: string;
    platform?: ReconcileFotosGalleryAlbumsParams['platform'];
    fullAccess: boolean;
    assetHashes: ReadonlyMap<string, string>;
    existingRefs: ReconcileFotosGalleryAlbumsParams['collectionRefs'];
}

const PAGE_SIZE = 100;

function checkPage(items: unknown, nextOffset?: number): asserts items is unknown[] {
    if (!Array.isArray(items) || items.length > PAGE_SIZE) {
        throw new Error('Invalid or oversized PhotoKit album page');
    }
    if (!items.length && nextOffset !== undefined) {
        throw new Error('Invalid PhotoKit album page offset on an empty page');
    }
}

/** Finish the native scan before applying an owner-scoped gallery observation. */
export async function reconcileFotosPhotoKitAlbums(params: ReconcileFotosPhotoKitAlbumsParams) {
    const {native, ownerId, platform = 'ios', fullAccess, assetHashes, existingRefs, ...storage} = params;
    const visible: Array<{id: string; name: string}> = [];
    const seen = new Set<string>();
    const releaseCursor = (cursor: string) => native.releaseCursor(cursor);
    await visitFotosPhotoKitPages(
        (offset, cursor) => native.listAlbums(offset, PAGE_SIZE, cursor), releaseCursor,
        page => {
            checkPage(page.albums, page.nextOffset);
            for (const album of page.albums) {
                if (!album || typeof album.id !== 'string' || !album.id || typeof album.name !== 'string'
                    || (album.kind !== 'user' && album.kind !== 'smart') || seen.has(album.id)) {
                    throw new Error('Invalid or duplicate PhotoKit album');
                }
                seen.add(album.id);
                if (album.kind === 'user') visible.push(album);
            }
        },
    );

    const observed: FotosObservedGalleryAlbum[] = [];
    for (const album of visible) {
        const photoHashes = new Set<string>();
        await visitFotosPhotoKitPages(
            (offset, cursor) => native.listAlbumMembers(album.id, offset, PAGE_SIZE, cursor), releaseCursor,
            page => {
                checkPage(page.assetIds, page.nextOffset);
                for (const assetId of page.assetIds) {
                    if (typeof assetId !== 'string' || !assetId) throw new Error('Invalid PhotoKit album member');
                    const hash = assetHashes.get(assetId);
                    if (hash !== undefined) photoHashes.add(hash);
                }
            },
        );
        observed.push({id: album.id, name: album.name, photoHashes});
    }

    return reconcileFotosGalleryAlbums({
        ...storage, owner: ownerId, platform, complete: fullAccess, observed, collectionRefs: existingRefs,
    });
}
