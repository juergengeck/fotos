import {
    cosineSimilarity,
    EMBEDDING_DIM,
    embeddingAt,
    faceEmbeddingRows,
    rankBySimilarity,
    SIMILARITY_THRESHOLDS,
} from '@refinio/fotos.core';
import type {PhotoEntry, SemanticInfo} from '../types/fotos.js';

export interface DayGroup<TPhoto extends PhotoEntry = PhotoEntry> {
    date: string;
    photos: TPhoto[];
}

export interface GalleryFilterOptions {
    activeTag?: string | null;
    searchQuery?: string;
    searchFace?: Float32Array | null;
    searchEmbedding?: SemanticInfo | null;
}

export function photoDate(photo: PhotoEntry): string {
    const raw = photo.capturedAt ?? photo.exif?.date ?? photo.addedAt;
    return raw.slice(0, 10);
}

export function groupPhotosByDay<TPhoto extends PhotoEntry = PhotoEntry>(photos: TPhoto[]): Array<DayGroup<TPhoto>> {
    const groups: Array<DayGroup<TPhoto>> = [];
    let currentDate = '';
    let currentGroup: TPhoto[] = [];

    for (const photo of photos) {
        const date = photoDate(photo);
        if (date !== currentDate) {
            if (currentGroup.length > 0) {
                groups.push({date: currentDate, photos: currentGroup});
            }
            currentDate = date;
            currentGroup = [photo];
        } else {
            currentGroup.push(photo);
        }
    }

    if (currentGroup.length > 0) {
        groups.push({date: currentDate, photos: currentGroup});
    }

    return groups;
}

export function flattenDayGroups<TPhoto extends PhotoEntry = PhotoEntry>(groups: Array<DayGroup<TPhoto>>): TPhoto[] {
    return groups.flatMap(group => group.photos);
}

export function collectTagCounts(photos: PhotoEntry[]): Array<[string, number]> {
    const map = new Map<string, number>();
    for (const photo of photos) {
        for (const tag of photo.tags) {
            map.set(tag, (map.get(tag) ?? 0) + 1);
        }
    }

    return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function sortByDateDescending(photos: PhotoEntry[]): PhotoEntry[] {
    return [...photos].sort((a, b) => {
        const left = a.capturedAt ?? a.exif?.date ?? a.addedAt;
        const right = b.capturedAt ?? b.exif?.date ?? b.addedAt;
        return right.localeCompare(left);
    });
}

function findMatchingClusterId(photos: PhotoEntry[], searchFace: Float32Array): string | undefined {
    for (const photo of photos) {
        const faces = photo.faces;
        if (!faces?.embeddings || !faces.clusterIds) {
            continue;
        }
        for (let index = 0; index < faces.count; index++) {
            const similarity = cosineSimilarity(searchFace, embeddingAt(faces.embeddings, index, EMBEDDING_DIM));
            if (similarity > SIMILARITY_THRESHOLDS.faceIdentity) {
                return faces.clusterIds[index];
            }
        }
    }
    return undefined;
}

function scorePhotosByFaceSimilarity(photos: PhotoEntry[], searchFace: Float32Array): PhotoEntry[] {
    const candidates = photos.flatMap(photo => photo.faces?.embeddings
        ? faceEmbeddingRows(photo, photo.faces.embeddings, photo.faces.count, EMBEDDING_DIM)
        : []);
    const ranked = rankBySimilarity(searchFace, candidates, SIMILARITY_THRESHOLDS.faceSearchPhoto);

    // Ranked best-first, so the first face seen per photo is that photo's best face.
    const seen = new Set<PhotoEntry>();
    const result: PhotoEntry[] = [];
    for (const {item} of ranked) {
        if (!seen.has(item.owner)) {
            seen.add(item.owner);
            result.push(item.owner);
        }
    }
    return result;
}

function scorePhotosBySemanticSimilarity(photos: PhotoEntry[], searchEmbedding: SemanticInfo): PhotoEntry[] {
    const candidates = photos.flatMap(photo => photo.semantic && photo.semantic.modelId === searchEmbedding.modelId
        ? [{item: photo, embedding: photo.semantic.embedding}]
        : []);
    return rankBySimilarity(searchEmbedding.embedding, candidates, SIMILARITY_THRESHOLDS.semanticSearch)
        .map(match => match.item);
}

export function filterGalleryPhotos(
    photos: PhotoEntry[],
    options: GalleryFilterOptions = {}
): PhotoEntry[] {
    const {activeTag, searchQuery, searchFace, searchEmbedding} = options;

    if (searchFace) {
        const clusterId = findMatchingClusterId(photos, searchFace);
        if (clusterId) {
            return photos.filter(photo => photo.faces?.clusterIds?.includes(clusterId) ?? false);
        }

        return scorePhotosByFaceSimilarity(photos, searchFace);
    }

    const candidates = activeTag
        ? photos.filter(photo => photo.tags.includes(activeTag))
        : photos;
    const query = searchQuery?.trim().toLowerCase() ?? '';
    if (searchEmbedding) {
        return scorePhotosBySemanticSimilarity(candidates, searchEmbedding);
    }

    const filtered = candidates.filter(photo => {
        if (!query) {
            return true;
        }

        return photo.name.toLowerCase().includes(query)
            || photo.tags.some(tag => tag.toLowerCase().includes(query))
            || (photo.exif?.camera ?? '').toLowerCase().includes(query)
            || (photo.exif?.date ?? '').includes(query);
    });

    return sortByDateDescending(filtered);
}
