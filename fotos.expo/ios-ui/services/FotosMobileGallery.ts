import {
    getOwnedFotosManifestId,
    projectFotosEntryReferences,
    type FotosCollection,
    type FotosEntry,
} from '@refinio/fotos.core';
import {projectReceivedFotosShares} from '@refinio/fotos.core/received-shares';
import {onChumImportBatch} from '@refinio/one.core/lib/chum-sync.js';
import {getObjectWithType} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {getObjectByIdHash, onVersionedObj} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {calculateIdHashOfObj} from '@refinio/one.core/lib/util/object.js';
import type {Signature} from '@refinio/one.models/lib/recipes/SignatureRecipes.js';
import type Model from '../Model';
import type {FotosPhotoKitAsset} from './FotosPhotoKit';

export type FotosGalleryItem = {
    id: string;
    name: string;
    date?: string;
    asset?: FotosPhotoKitAsset;
    entry?: FotosEntry;
    owned: boolean;
    shared: boolean;
    albums: string[];
};

export type FotosGalleryLibrary = {
    owned: FotosEntry[];
    shared: FotosEntry[];
    collections: FotosCollection[];
    localHashes: ReadonlyMap<string, string>;
};

export const emptyFotosGallery: FotosGalleryLibrary = {
    owned: [], shared: [], collections: [], localHashes: new Map(),
};
const galleryReads = new WeakMap<Model, Promise<FotosGalleryLibrary>>();

function isMissing(error: unknown): boolean {
    return error instanceof Error && error.name === 'FileNotFoundError';
}

async function readRefs<Hash, Object>(hashes: ReadonlySet<Hash> | undefined, read: (hash: Hash) => Promise<Object>): Promise<Object[]> {
    const refs = [...hashes ?? []];
    const objects: Object[] = [];
    for (let offset = 0; offset < refs.length; offset += 16) {
        const batch = await Promise.all(refs.slice(offset, offset + 16).map(async hash => {
            try {
                return await read(hash);
            } catch (error) {
                if (isMissing(error)) return undefined;
                throw error;
            }
        }));
        for (const object of batch) if (object !== undefined) objects.push(object);
    }
    return objects;
}

async function readOwnedGallery(owner: string) {
    const id = getOwnedFotosManifestId(owner);
    const hash = await calculateIdHashOfObj({$type$: 'FotosManifest', id, entries: new Set()});
    try {
        const {obj} = await getObjectByIdHash(hash);
        if (obj.$type$ !== 'FotosManifest' || obj.id !== id) throw new Error('Invalid owner gallery manifest');
        const [owned, collections] = await Promise.all([
            readRefs(obj.entries, async hash => ({hash, entry: await getObjectWithType(hash, 'FotosEntry')})),
            readRefs(obj.collections, collection => getObjectWithType(collection, 'FotosCollection')),
        ]);
        const byHash = new Map(owned.map(({hash, entry}) => [String(hash), entry]));
        const entries = projectFotosEntryReferences(owned).map(({entry, hashes}) => {
            const tags = new Set(hashes.flatMap(hash => [...byHash.get(hash)?.tags ?? []]));
            return tags.size ? {...entry, tags} : entry;
        });
        return {owned: entries, collections};
    } catch (error) {
        if (isMissing(error)) return {owned: [], collections: []};
        throw error;
    }
}

async function readSharedGallery(model: Model, owner: string): Promise<FotosEntry[]> {
    const trust = model.leuteModel.trust;
    await trust.refreshCaches();
    const scopes = await projectReceivedFotosShares(owner, signature =>
        trust.verifySignatureWithTrustedKeys(signature as Signature));
    return scopes.filter(scope => scope.status === 'active' && scope.verified).flatMap(scope => scope.entries);
}

export function readFotosMobileGallery(model: Model): Promise<FotosGalleryLibrary> {
    const pending = galleryReads.get(model);
    if (pending) return pending;
    const read = loadGallery(model).finally(() => galleryReads.delete(model));
    galleryReads.set(model, read);
    return read;
}

async function loadGallery(model: Model): Promise<FotosGalleryLibrary> {
    const owner = model.ownerId;
    if (!owner) return emptyFotosGallery;
    const [owned, shared, localHashes] = await Promise.all([
        readOwnedGallery(owner),
        readSharedGallery(model, owner),
        model.fotosMediaLibrarySync?.getLocalPhotoHashes() ?? new Map<string, string>(),
    ]);
    if (model.ownerId !== owner) return emptyFotosGallery;
    return {...owned, shared, localHashes};
}

const shareAuthorizationTypes = new Set([
    'FotosShareManifest', 'FotosShareCertificateChain', 'FotosShareCertificate',
    'Signature', 'Profile', 'Person', 'Keys', 'TrustKeysCertificate',
]);
const galleryObjectTypes = new Set(['FotosManifest', 'FotosEntry', 'FotosCollection', 'FotosDeviceBook', 'FotosMediaVariant']);

export function observeFotosMobileGallery(refresh: () => void, invalidateShared: () => void): () => void {
    const stopLocal = onVersionedObj.addListener(({obj}) => {
        if (shareAuthorizationTypes.has(obj.$type$)) invalidateShared();
        else if (galleryObjectTypes.has(obj.$type$)) refresh();
    });
    const stopRemote = onChumImportBatch.addListener(({batch}) => {
        if (batch.imported.some(item => shareAuthorizationTypes.has(item.type))) {
            invalidateShared();
            return;
        }
        if (batch.imported.some(item => item.kind === 'blob' || galleryObjectTypes.has(item.type))) {
            refresh();
        }
    });
    return () => {
        stopLocal();
        stopRemote();
    };
}

export function mergeFotosMobileGallery(assets: readonly FotosPhotoKitAsset[], library: FotosGalleryLibrary): FotosGalleryItem[] {
    const albumsByHash = new Map<string, string[]>();
    for (const collection of library.collections) {
        for (const hash of collection.photoHashes) {
            const names = albumsByHash.get(hash) ?? [];
            if (!names.includes(collection.name)) names.push(collection.name);
            albumsByHash.set(hash, names);
        }
    }
    const items = new Map<string, FotosGalleryItem>();
    const ownedHashes = new Set(library.owned.map(entry => entry.contentHash));
    const sharedHashes = new Set(library.shared.map(entry => entry.contentHash));
    for (const entry of [...library.owned, ...library.shared]) {
        const id = entry.contentHash;
        if (items.has(id)) continue;
        items.set(id, {
            id, entry, name: entry.originalFilename ?? entry.sourcePath?.split('/').pop() ?? 'Photo',
            date: [entry.capturedAt, entry.exifDate, entry.updatedAt].find(date => date && Number.isFinite(Date.parse(date))),
            owned: ownedHashes.has(id), shared: sharedHashes.has(id), albums: albumsByHash.get(id) ?? [],
        });
    }
    for (const asset of assets) {
        const id = library.localHashes.get(asset.id) ?? asset.id;
        const current = items.get(id);
        if (current?.asset) continue;
        const date = asset.creationTime === undefined ? undefined : new Date(asset.creationTime).toISOString();
        items.set(id, current ? {...current, asset, date: current.date ?? date} : {
            id, asset, name: asset.filename,
            date,
            owned: false, shared: false, albums: [],
        });
    }
    return [...items.values()].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.id.localeCompare(b.id));
}
