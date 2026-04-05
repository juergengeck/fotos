import { cosineSimilarity, EMBEDDING_DIM } from '@refinio/fotos.core';
import type { PhotoEntry } from '@/types/fotos';

export interface FaceClusterSummary {
    clusterId: string;
    personId?: string;
    personName?: string;
    label: string;
    avatarPath?: string;
    faceCount: number;
    photoCount: number;
    photoHashes: string[];
    memberClusterIds: string[];
}

export interface SimilarFaceMatch {
    photo: PhotoEntry;
    faceIndex: number;
    similarity: number;
    cropPath?: string;
    clusterId?: string;
    personId?: string;
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

            const personId = faces.personIds?.[index]?.trim() || undefined;
            const personName = faces.names?.[index]?.trim() || undefined;
            const summaryId = personId ? `person:${personId}` : clusterId;
            const existing = clusters.get(summaryId);

            if (!existing) {
                clusters.set(summaryId, {
                    clusterId: summaryId,
                    personId,
                    personName,
                    label: personName ?? (personId ? `Person ${personId.slice(0, 8)}` : `Group ${clusterId.slice(0, 8)}`),
                    avatarPath: faces.crops[index] || undefined,
                    faceCount: 1,
                    photoCount: 1,
                    photoHashes: [photo.hash],
                    memberClusterIds: [clusterId],
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
            if (!existing.memberClusterIds.includes(clusterId)) {
                existing.memberClusterIds.push(clusterId);
            }
        }
    }

    return [...clusters.values()].sort((left, right) => {
        const leftIsPerson = Boolean(left.personName) || Boolean(left.personId);
        const rightIsPerson = Boolean(right.personName) || Boolean(right.personId);
        if (leftIsPerson !== rightIsPerson) {
            return leftIsPerson ? -1 : 1;
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
                personId: faces.personIds?.[index]?.trim() || undefined,
                personName: faces.names?.[index],
            });
        }
    }

    return matches.sort((left, right) => right.similarity - left.similarity);
}
