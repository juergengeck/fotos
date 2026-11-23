import type {FotosCollection} from './recipes/FotosRecipes.js';

const COLLECTION_ID = /^fotos-album:v1:([a-f0-9]{64}):([a-f0-9]{64}):([A-Za-z0-9_.!~*'()-]|%[A-F0-9]{2})+$/;
const MANUAL_COLLECTION_ID = /^fotos-collection:v1:([a-f0-9]{64}):[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
export const MAX_FOTOS_COLLECTION_NAME_LENGTH = 255;
export const MAX_FOTOS_COLLECTION_MEMBERS = 250_000;

export function getFotosCollectionOwner(id: string): string | undefined {
    if (id.length > 4096) return undefined;
    return COLLECTION_ID.exec(id)?.[1] ?? MANUAL_COLLECTION_ID.exec(id)?.[1];
}

export function isFotosManualCollectionForOwner(id: string, owner: string): boolean {
    return id.length <= 4096 && MANUAL_COLLECTION_ID.exec(id)?.[1] === owner;
}

export function createFotosManualCollection(params: {
    owner: string;
    uuid: string;
    name: string;
    photoHashes: Iterable<string>;
}): FotosCollection {
    const id = `fotos-collection:v1:${params.owner}:${params.uuid}`;
    const photoHashes = new Set(params.photoHashes);
    if (!isFotosManualCollectionForOwner(id, params.owner)
        || !isFotosCollectionName(params.name) || !isFotosCollectionMembership(photoHashes)) {
        throw new Error('Invalid Fotos collection metadata');
    }
    return {$type$: 'FotosCollection', id, name: params.name, photoHashes};
}

/** Whether a valid album identity belongs to this exact owner and source library. */
export function isFotosAlbumCollectionFromLibrary(id: string, ownerId: string, libraryId: string): boolean {
    if (id.length > 4096) return false;
    const source = COLLECTION_ID.exec(id);
    return source?.[1] === ownerId && source?.[2] === libraryId;
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
