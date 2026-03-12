import {cosineSimilarity, EMBEDDING_DIM} from '../../../fotos.core/src/index.js';
import type {PhotoEntry} from '../types/fotos.js';

export interface DayGroup<TPhoto extends PhotoEntry = PhotoEntry> {
    date: string;
    photos: TPhoto[];
}

export interface GalleryFilterOptions {
    activeTag?: string | null;
    searchQuery?: string;
    searchFace?: Float32Array | null;
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
        if (!photo.faces?.embeddings || !photo.faces.clusterIds) {
            continue;
        }

        for (let index = 0; index < photo.faces.count; index++) {
            const embedding = photo.faces.embeddings.slice(
                index * EMBEDDING_DIM,
                (index + 1) * EMBEDDING_DIM
            );
            if (cosineSimilarity(searchFace, embedding) > 0.99) {
                return photo.faces.clusterIds[index];
            }
        }
    }

    return undefined;
}

function scorePhotosByFaceSimilarity(photos: PhotoEntry[], searchFace: Float32Array): PhotoEntry[] {
    const scored: Array<{photo: PhotoEntry; similarity: number}> = [];

    for (const photo of photos) {
        if (!photo.faces?.embeddings) {
            continue;
        }

        let bestSimilarity = -1;
        for (let index = 0; index < photo.faces.count; index++) {
            const embedding = photo.faces.embeddings.slice(
                index * EMBEDDING_DIM,
                (index + 1) * EMBEDDING_DIM
            );
            const similarity = cosineSimilarity(searchFace, embedding);
            if (similarity > bestSimilarity) {
                bestSimilarity = similarity;
            }
        }

        if (bestSimilarity > 0.3) {
            scored.push({photo, similarity: bestSimilarity});
        }
    }

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.map(entry => entry.photo);
}

export function filterGalleryPhotos(
    photos: PhotoEntry[],
    options: GalleryFilterOptions = {}
): PhotoEntry[] {
    const {activeTag, searchQuery, searchFace} = options;

    if (searchFace) {
        const clusterId = findMatchingClusterId(photos, searchFace);
        if (clusterId) {
            return photos.filter(photo => photo.faces?.clusterIds?.includes(clusterId) ?? false);
        }

        return scorePhotosByFaceSimilarity(photos, searchFace);
    }

    const query = searchQuery?.trim().toLowerCase() ?? '';
    const filtered = photos.filter(photo => {
        if (activeTag && !photo.tags.includes(activeTag)) {
            return false;
        }

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
