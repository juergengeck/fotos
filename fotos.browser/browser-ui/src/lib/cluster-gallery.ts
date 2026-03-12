import { cosineSimilarity, EMBEDDING_DIM } from '@refinio/fotos.core';
import type { PhotoEntry } from '@/types/fotos';

export interface FaceClusterSummary {
    clusterId: string;
    personName?: string;
    label: string;
    avatarPath?: string;
    faceCount: number;
    photoCount: number;
    photoHashes: string[];
}

export interface SimilarFaceMatch {
    photo: PhotoEntry;
    faceIndex: number;
    similarity: number;
    cropPath?: string;
    clusterId?: string;
    personName?: string;
}

export function buildFaceClusterSummaries(photos: PhotoEntry[]): FaceClusterSummary[] {
    const clusters = new Map<string, FaceClusterSummary>();

    for (const photo of photos) {
        const faces = photo.faces;
        if (!faces?.clusterIds?.length) {
            continue;
        }

        for (let index = 0; index < faces.clusterIds.length; index++) {
            const clusterId = faces.clusterIds[index];
            if (!clusterId) {
                continue;
            }

            const personName = faces.names?.[index]?.trim() || undefined;
            const existing = clusters.get(clusterId);

            if (!existing) {
                clusters.set(clusterId, {
                    clusterId,
                    personName,
                    label: personName ?? `Group ${clusterId.slice(0, 8)}`,
                    avatarPath: faces.crops[index] || undefined,
                    faceCount: 1,
                    photoCount: 1,
                    photoHashes: [photo.hash],
                });
                continue;
            }

            existing.faceCount += 1;
            if (!existing.personName && personName) {
                existing.personName = personName;
                existing.label = personName;
            }
            if (!existing.avatarPath && faces.crops[index]) {
                existing.avatarPath = faces.crops[index];
            }
            if (!existing.photoHashes.includes(photo.hash)) {
                existing.photoHashes.push(photo.hash);
                existing.photoCount += 1;
            }
        }
    }

    return [...clusters.values()].sort((left, right) => {
        if (Boolean(left.personName) !== Boolean(right.personName)) {
            return left.personName ? -1 : 1;
        }
        if (left.faceCount !== right.faceCount) {
            return right.faceCount - left.faceCount;
        }
        return left.label.localeCompare(right.label);
    });
}

export function buildSimilarFaceMatches(
    photos: PhotoEntry[],
    searchFace: Float32Array,
    minSimilarity = 0.35,
): SimilarFaceMatch[] {
    const matches: SimilarFaceMatch[] = [];

    for (const photo of photos) {
        const faces = photo.faces;
        if (!faces?.embeddings) {
            continue;
        }

        for (let index = 0; index < faces.count; index++) {
            const embedding = faces.embeddings.slice(
                index * EMBEDDING_DIM,
                (index + 1) * EMBEDDING_DIM,
            );
            const similarity = cosineSimilarity(searchFace, embedding);
            if (similarity < minSimilarity) {
                continue;
            }

            matches.push({
                photo,
                faceIndex: index,
                similarity,
                cropPath: faces.crops[index] || undefined,
                clusterId: faces.clusterIds?.[index],
                personName: faces.names?.[index],
            });
        }
    }

    return matches.sort((left, right) => right.similarity - left.similarity);
}
