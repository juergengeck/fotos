import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {FotosCollection, FotosGalleryAlbumBinding} from './recipes/FotosRecipes.js';
import {isFotosCollectionMembership, isFotosCollectionName} from './fotos-collection.js';

export type FotosGalleryAlbumPlatform = 'ios' | 'android';

const SHA256 = /^[a-f0-9]{64}$/;
const BINDING_ID = /^fotos-gallery-album-binding:v1:([a-f0-9]{64}):(ios|android):([a-f0-9]{64}):((?:[A-Za-z0-9_.!~*'()-]|%[A-F0-9]{2})+)$/;

interface FotosGalleryAlbumSource {
    owner: string;
    platform: FotosGalleryAlbumPlatform;
    libraryId: string;
    albumId: string;
}

function parseBindingId(id: string): RegExpExecArray | undefined {
    if (id.length > 4096) return undefined;
    const parts = BINDING_ID.exec(id);
    if (!parts) return undefined;
    try {
        // Reject malformed UTF-8 and alternate encodings of the same native ID.
        return encodeURIComponent(decodeURIComponent(parts[4])) === parts[4] ? parts : undefined;
    } catch {
        return undefined;
    }
}

export function getFotosGalleryAlbumBindingOwner(id: string): string | undefined {
    return parseBindingId(id)?.[1];
}

/** Stable source identity; album names and observed membership are versioned data. */
export function buildFotosGalleryAlbumBindingId(params: FotosGalleryAlbumSource): string {
    const id = `fotos-gallery-album-binding:v1:${params.owner}:${params.platform}:${params.libraryId}:${encodeURIComponent(params.albumId)}`;
    if (!SHA256.test(params.owner) || !SHA256.test(params.libraryId)
        || getFotosGalleryAlbumBindingOwner(id) !== params.owner) {
        throw new Error('Invalid Fotos gallery album source identity');
    }
    return id;
}

/** Whether this source belongs to an exact owner, platform, and library. */
export function isFotosGalleryAlbumBindingFromLibrary(
    id: string, owner: string, platform: FotosGalleryAlbumPlatform, libraryId: string,
): boolean {
    const source = parseBindingId(id);
    return source?.[1] === owner && source?.[2] === platform && source?.[3] === libraryId;
}

/** Persist the typed collection target and the membership observed in this source. */
export function createFotosGalleryAlbumBinding(params: FotosGalleryAlbumSource & {
    collection: SHA256IdHash<FotosCollection>;
    name: string;
    photoHashes: Iterable<string>;
}): FotosGalleryAlbumBinding {
    const id = buildFotosGalleryAlbumBindingId(params);
    const photoHashes = new Set(params.photoHashes);
    if (!SHA256.test(params.collection) || !isFotosCollectionName(params.name)
        || !isFotosCollectionMembership(photoHashes)) {
        throw new Error('Invalid Fotos gallery album binding metadata');
    }
    return {$type$: 'FotosGalleryAlbumBinding', id, collection: params.collection, name: params.name, photoHashes};
}
