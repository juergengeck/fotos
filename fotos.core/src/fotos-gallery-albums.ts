import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import {
    buildFotosAlbumCollectionId, createFotosGalleryCollection, getFotosCollectionOwner, isFotosAlbumCollectionFromLibrary,
    isFotosManualCollectionForOwner,
} from './fotos-collection.js';
import {
    buildFotosGalleryAlbumBindingId, createFotosGalleryAlbumBinding, isFotosGalleryAlbumBindingFromLibrary,
    type FotosGalleryAlbumPlatform,
} from './fotos-gallery-album-binding.js';
import type {FotosCollection, FotosGalleryAlbumBinding} from './recipes/FotosRecipes.js';

type CollectionRef = SHA256Hash<FotosCollection>;
type CollectionId = SHA256IdHash<FotosCollection>;
type BindingRef = SHA256Hash<FotosGalleryAlbumBinding>;

export interface FotosObservedGalleryAlbum {
    id: string;
    name: string;
    photoHashes: ReadonlySet<string>;
}

export interface ReconcileFotosGalleryAlbumsParams {
    owner: string;
    platform: FotosGalleryAlbumPlatform;
    libraryId: string;
    complete: boolean;
    observed: readonly FotosObservedGalleryAlbum[];
    collectionRefs: ReadonlySet<CollectionRef>;
    bindingRefs: ReadonlySet<BindingRef>;
    allocateCollectionUuid(): string;
    calculateCollectionId(collection: FotosCollection): Promise<CollectionId>;
    readCollection(ref: CollectionRef): Promise<FotosCollection>;
    readBinding(ref: BindingRef): Promise<FotosGalleryAlbumBinding>;
    storeCollection(collection: FotosCollection): Promise<CollectionRef>;
    storeBinding(binding: FotosGalleryAlbumBinding): Promise<BindingRef>;
}

function sameSet<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
    return left.size === right.size && [...left].every(value => right.has(value));
}

/** Resolve one complete or limited source observation against an owner's exact album state. */
export async function reconcileFotosGalleryAlbums(params: ReconcileFotosGalleryAlbumsParams): Promise<{
    collections: Set<CollectionRef>;
    albumBindings: Set<BindingRef>;
    changed: boolean;
}> {
    const {owner, platform, libraryId} = params;
    const versions = new Map<CollectionId, Array<{ref: CollectionRef; collection: FotosCollection}>>();
    const legacy = new Map<string, CollectionId>();
    for (const ref of params.collectionRefs) {
        const collection = await params.readCollection(ref);
        if (collection.$type$ !== 'FotosCollection' || typeof collection.id !== 'string'
            || !(collection.photoHashes instanceof Set)) throw new Error('Invalid stored Fotos album collection');
        const id = await params.calculateCollectionId(collection);
        const history = versions.get(id) ?? [];
        history.push({ref, collection});
        versions.set(id, history);
        if (platform === 'ios' && isFotosAlbumCollectionFromLibrary(collection.id, owner, libraryId)) {
            legacy.set(collection.id, id);
        }
    }

    const bindings = new Map<string, {ref?: BindingRef; binding: FotosGalleryAlbumBinding}>();
    for (const ref of params.bindingRefs) {
        const binding = await params.readBinding(ref);
        if (binding.$type$ !== 'FotosGalleryAlbumBinding' || bindings.has(binding.id)
            || !(binding.photoHashes instanceof Set)) throw new Error('Invalid stored Fotos gallery album binding');
        bindings.set(binding.id, {ref, binding});
    }

    const observed = new Set<string>();
    const retainedLegacy = new Set<string>();
    const candidateCollections = new Map<CollectionId, FotosCollection>();
    const affected = new Set<CollectionId>();
    for (const album of params.observed) {
        const source = {owner, platform, libraryId, albumId: album.id};
        const bindingId = buildFotosGalleryAlbumBindingId(source);
        if (observed.has(bindingId)) throw new Error('Duplicate Fotos gallery album observation');
        observed.add(bindingId);

        const previous = bindings.get(bindingId);
        const legacyId = platform === 'ios' ? buildFotosAlbumCollectionId(owner, libraryId, album.id) : undefined;
        const legacyTarget = legacyId ? legacy.get(legacyId) : undefined;
        const priorTarget = previous?.binding.collection ?? legacyTarget;
        if (legacyId && priorTarget === legacyTarget) retainedLegacy.add(legacyId);
        const priorVersions = priorTarget ? versions.get(priorTarget) : undefined;
        if (priorTarget && !priorVersions?.length) throw new Error('Fotos gallery album is missing its collection');
        const prior = priorVersions?.[0].collection;
        if (prior && (getFotosCollectionOwner(prior.id) !== owner || isFotosManualCollectionForOwner(prior.id, owner))) {
            throw new Error('A gallery album must reference an imported collection owned by the library');
        }

        const photoHashes = new Set(album.photoHashes);
        if (!params.complete) {
            for (const hash of previous?.binding.photoHashes
                ?? (priorVersions ?? []).flatMap(version => [...version.collection.photoHashes])) photoHashes.add(hash);
        }
        const collection = prior ?? createFotosGalleryCollection({
            owner, uuid: params.allocateCollectionUuid(), name: album.name, photoHashes,
        });
        const target = priorTarget ?? await params.calculateCollectionId(collection);
        const binding = createFotosGalleryAlbumBinding({
            ...source, collection: target, name: album.name, photoHashes,
        });
        const nextName = previous?.binding.name === album.name
            ? (candidateCollections.get(target)?.name ?? collection.name) : album.name;
        candidateCollections.set(target, {...collection, name: nextName});
        affected.add(target);
        bindings.set(bindingId, previous?.binding.name === binding.name
            && sameSet(previous.binding.photoHashes, binding.photoHashes) ? previous : {binding});
    }

    if (params.complete) {
        for (const [id, candidate] of bindings) {
            if (!observed.has(id) && isFotosGalleryAlbumBindingFromLibrary(id, owner, platform, libraryId)) {
                affected.add(candidate.binding.collection);
                bindings.delete(id);
            }
        }
        for (const [id, collection] of legacy) {
            if (!retainedLegacy.has(id)) affected.add(collection);
        }
    }

    const members = new Map<CollectionId, Set<string>>();
    for (const {binding} of bindings.values()) {
        if (!affected.has(binding.collection)) continue;
        const hashes = members.get(binding.collection) ?? new Set<string>();
        for (const hash of binding.photoHashes) hashes.add(hash);
        members.set(binding.collection, hashes);
    }

    const collections = new Set(params.collectionRefs);
    for (const id of affected) {
        const priorVersions = versions.get(id) ?? [];
        const current = candidateCollections.get(id) ?? priorVersions[0]?.collection;
        if (!current || getFotosCollectionOwner(current.id) !== owner || isFotosManualCollectionForOwner(current.id, owner)) continue;
        const photoHashes = members.get(id);
        for (const {ref} of priorVersions) collections.delete(ref);
        if (!photoHashes) continue;
        const sameVersion = priorVersions.find(({collection}) =>
            collection.name === current.name && sameSet(collection.photoHashes, photoHashes));
        collections.add(sameVersion?.ref ?? await params.storeCollection({...current, photoHashes}));
    }
    const albumBindings = new Set<BindingRef>();
    for (const {ref, binding} of bindings.values()) {
        albumBindings.add(ref ?? await params.storeBinding(binding));
    }
    return {
        collections, albumBindings,
        changed: !sameSet(collections, params.collectionRefs) || !sameSet(albumBindings, params.bindingRefs),
    };
}
