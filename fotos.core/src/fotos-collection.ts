import type {FotosCollection} from './recipes/FotosRecipes.js';

const COLLECTION_ID = /^fotos-album:v1:([a-f0-9]{64}):([a-f0-9]{64}):([A-Za-z0-9_.!~*'()-]|%[A-F0-9]{2})+$/;
const SHA256 = /^[a-f0-9]{64}$/;
export const MAX_FOTOS_COLLECTION_NAME_LENGTH = 255;
export const MAX_FOTOS_COLLECTION_MEMBERS = 250_000;

export function getFotosCollectionOwner(id: string): string | undefined {
    if (id.length > 4096) return undefined;
    return COLLECTION_ID.exec(id)?.[1];
}

/** Identity is scoped to the owner and source library, so an album rename keeps its ID. */
export function buildFotosAlbumCollectionId(owner: string, libraryId: string, albumId: string): string {
    const id = `fotos-album:v1:${owner}:${libraryId}:${encodeURIComponent(albumId)}`;
    if (!SHA256.test(owner) || !SHA256.test(libraryId) || getFotosCollectionOwner(id) !== owner) {
        throw new Error('Invalid Fotos album source identity');
    }
    return id;
}

export function isFotosCollectionName(name: unknown): name is string {
    return typeof name === 'string' && name.length > 0 && name.length <= MAX_FOTOS_COLLECTION_NAME_LENGTH;
}

export function isFotosCollectionMembership(hashes: unknown): hashes is Set<string> {
    if (!(hashes instanceof Set) || hashes.size > MAX_FOTOS_COLLECTION_MEMBERS) return false;
    for (const hash of hashes) {
        if (typeof hash !== 'string' || !SHA256.test(hash)) return false;
    }
    return true;
}

export function createFotosAlbumCollection(params: {
    owner: string;
    libraryId: string;
    albumId: string;
    name: string;
    photoHashes: Iterable<string>;
}): FotosCollection {
    const id = buildFotosAlbumCollectionId(params.owner, params.libraryId, params.albumId);
    const photoHashes = new Set(params.photoHashes);
    if (!isFotosCollectionName(params.name) || !isFotosCollectionMembership(photoHashes)) {
        throw new Error('Invalid Fotos album metadata');
    }
    return {$type$: 'FotosCollection', id, name: params.name, photoHashes};
}
