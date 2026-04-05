import { getFaceCount, type PhotoEntry } from '@refinio/fotos.ui';

import type { FaceClusterSummary } from './cluster-gallery.js';

export const FOTOS_LIBRARY_STATE_STORAGE_KEY = 'fotos.browser.library-state';
export const FOTOS_LIBRARY_STATE_FIELD = 'libraryStateJson';

export interface FotosCollectionDefinition {
    id: string;
    name: string;
    photoHashes: string[];
    clusterIds: string[];
    personIds: string[];
    createdAt: string;
    updatedAt: string;
}

export interface FotosShareAssignments {
    galleryPersonIds: string[];
    collectionPersonIds: Record<string, string[]>;
    clusterPersonIds: Record<string, string[]>;
}

export interface FotosLibraryState {
    version: 1;
    collections: FotosCollectionDefinition[];
    sharing: FotosShareAssignments;
}

export interface FotosCollectionSummary extends FotosCollectionDefinition {
    photoCount: number;
    faceCount: number;
    coverPhotoHash: string | null;
    matchedPhotoHashes: string[];
}

export const EMPTY_FOTOS_LIBRARY_STATE: FotosLibraryState = {
    version: 1,
    collections: [],
    sharing: {
        galleryPersonIds: [],
        collectionPersonIds: {},
        clusterPersonIds: {},
    },
};

function asTrimmedString(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function uniqueStrings(values: Iterable<string>): string[] {
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const value of values) {
        const trimmed = value.trim();
        if (!trimmed || seen.has(trimmed)) {
            continue;
        }
        seen.add(trimmed);
        unique.push(trimmed);
    }
    return unique;
}

function normalizeCollectionName(name: string | null | undefined, fallbackIndex: number): string {
    const trimmed = name?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : `Collection ${fallbackIndex}`;
}

function createCollectionId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    return `collection-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeCollection(
    value: unknown,
    fallbackIndex: number,
): FotosCollectionDefinition | null {
    if (typeof value !== 'object' || value === null) {
        return null;
    }

    const candidate = value as Partial<Record<keyof FotosCollectionDefinition, unknown>>;
    const id = asTrimmedString(candidate.id) ?? createCollectionId();
    const createdAt = asTrimmedString(candidate.createdAt) ?? new Date().toISOString();
    const updatedAt = asTrimmedString(candidate.updatedAt) ?? createdAt;

    return {
        id,
        name: normalizeCollectionName(asTrimmedString(candidate.name), fallbackIndex),
        photoHashes: Array.isArray(candidate.photoHashes)
            ? uniqueStrings(candidate.photoHashes.filter((item): item is string => typeof item === 'string'))
            : [],
        clusterIds: Array.isArray(candidate.clusterIds)
            ? uniqueStrings(candidate.clusterIds.filter((item): item is string => typeof item === 'string'))
            : [],
        personIds: Array.isArray(candidate.personIds)
            ? uniqueStrings(candidate.personIds.filter((item): item is string => typeof item === 'string'))
            : [],
        createdAt,
        updatedAt,
    };
}

function normalizeShareAssignments(value: unknown): FotosShareAssignments {
    if (typeof value !== 'object' || value === null) {
        return { ...EMPTY_FOTOS_LIBRARY_STATE.sharing };
    }

    const candidate = value as Partial<Record<keyof FotosShareAssignments, unknown>>;

    const normalizeRecord = (recordValue: unknown): Record<string, string[]> => {
        if (typeof recordValue !== 'object' || recordValue === null) {
            return {};
        }

        const nextRecord: Record<string, string[]> = {};
        for (const [key, rawValues] of Object.entries(recordValue)) {
            const normalizedKey = asTrimmedString(key);
            if (!normalizedKey || !Array.isArray(rawValues)) {
                continue;
            }

            const normalizedValues = uniqueStrings(rawValues.filter((item): item is string => typeof item === 'string'));
            if (normalizedValues.length === 0) {
                continue;
            }

            nextRecord[normalizedKey] = normalizedValues;
        }

        return nextRecord;
    };

    return {
        galleryPersonIds: Array.isArray(candidate.galleryPersonIds)
            ? uniqueStrings(candidate.galleryPersonIds.filter((item): item is string => typeof item === 'string'))
            : [],
        collectionPersonIds: normalizeRecord(candidate.collectionPersonIds),
        clusterPersonIds: normalizeRecord(candidate.clusterPersonIds),
    };
}

export function normalizeFotosLibraryState(value: unknown): FotosLibraryState {
    if (typeof value !== 'object' || value === null) {
        return { ...EMPTY_FOTOS_LIBRARY_STATE };
    }

    const candidate = value as Partial<Record<keyof FotosLibraryState, unknown>>;
    const collections = Array.isArray(candidate.collections)
        ? candidate.collections
            .map((collection, index) => normalizeCollection(collection, index + 1))
            .filter((collection): collection is FotosCollectionDefinition => collection !== null)
        : [];

    return {
        version: 1,
        collections: collections.sort((left, right) =>
            right.updatedAt.localeCompare(left.updatedAt)
            || left.name.localeCompare(right.name)
            || left.id.localeCompare(right.id),
        ),
        sharing: normalizeShareAssignments(candidate.sharing),
    };
}

export function deserializeFotosLibraryState(value: unknown): FotosLibraryState {
    if (typeof value === 'string') {
        try {
            return normalizeFotosLibraryState(JSON.parse(value));
        } catch {
            return { ...EMPTY_FOTOS_LIBRARY_STATE };
        }
    }

    return normalizeFotosLibraryState(value);
}

export function serializeFotosLibraryState(state: FotosLibraryState): string {
    return JSON.stringify(normalizeFotosLibraryState(state));
}

export function loadFotosLibraryState(
    storage: Pick<Storage, 'getItem'> | null | undefined,
    storageKey = FOTOS_LIBRARY_STATE_STORAGE_KEY,
): FotosLibraryState {
    const raw = storage?.getItem(storageKey);
    if (!raw) {
        return { ...EMPTY_FOTOS_LIBRARY_STATE };
    }

    return deserializeFotosLibraryState(raw);
}

export function saveFotosLibraryState(
    state: FotosLibraryState,
    storage: Pick<Storage, 'setItem'> | null | undefined,
    storageKey = FOTOS_LIBRARY_STATE_STORAGE_KEY,
): void {
    storage?.setItem(storageKey, serializeFotosLibraryState(state));
}

export function isFotosLibraryStateEmpty(state: FotosLibraryState): boolean {
    return state.collections.length === 0
        && state.sharing.galleryPersonIds.length === 0
        && Object.keys(state.sharing.collectionPersonIds).length === 0
        && Object.keys(state.sharing.clusterPersonIds).length === 0;
}

export function collectionMatchesPhoto(
    collection: FotosCollectionDefinition,
    photo: PhotoEntry,
): boolean {
    if (collection.photoHashes.includes(photo.hash)) {
        return true;
    }

    const clusterIds = photo.faces?.clusterIds?.filter(Boolean) ?? [];
    if (clusterIds.some(clusterId => collection.clusterIds.includes(clusterId))) {
        return true;
    }

    const personIds = photo.faces?.personIds?.filter(Boolean) ?? [];
    return personIds.some(personId => collection.personIds.includes(personId));
}

export function buildFotosCollectionSummary(
    collection: FotosCollectionDefinition,
    photos: PhotoEntry[],
): FotosCollectionSummary {
    const matchedPhotos = photos.filter(photo => collectionMatchesPhoto(collection, photo));

    return {
        ...collection,
        photoCount: matchedPhotos.length,
        faceCount: matchedPhotos.reduce((total, photo) => total + getFaceCount(photo.faces), 0),
        coverPhotoHash: matchedPhotos[0]?.hash ?? null,
        matchedPhotoHashes: matchedPhotos.map(photo => photo.hash),
    };
}

export function buildFotosCollectionSummaries(
    collections: readonly FotosCollectionDefinition[],
    photos: PhotoEntry[],
): FotosCollectionSummary[] {
    return collections.map(collection => buildFotosCollectionSummary(collection, photos));
}

export function buildFotosCollectionFromSelection(
    name: string,
    selectedPhotos: readonly PhotoEntry[],
    selectedClusters: readonly FaceClusterSummary[],
    existingCollectionsCount = 0,
): FotosCollectionDefinition {
    const now = new Date().toISOString();

    return {
        id: createCollectionId(),
        name: normalizeCollectionName(name, existingCollectionsCount + 1),
        photoHashes: uniqueStrings(selectedPhotos.map(photo => photo.hash)),
        clusterIds: uniqueStrings(selectedClusters.flatMap(cluster => cluster.memberClusterIds)),
        personIds: uniqueStrings(
            selectedClusters
                .map(cluster => cluster.personId)
                .filter((personId): personId is string => typeof personId === 'string' && personId.trim().length > 0),
        ),
        createdAt: now,
        updatedAt: now,
    };
}
