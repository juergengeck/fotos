/**
 * FaceClusterDimension — groups face embeddings into person clusters
 * using HNSW approximate nearest neighbor search on cluster centroids.
 *
 * Each cluster represents a unique person. New face embeddings are
 * assigned to the nearest existing cluster (if similarity exceeds a
 * threshold) or start a new cluster. Centroids are maintained as
 * running averages and kept in sync with the HNSW index.
 */

import {HNSWIndex} from '@refinio/meaning.core/vector-index/HNSWIndex.js';
import type {HNSWSearchResult} from '@refinio/meaning.core/vector-index/HNSWIndex.js';
import {EMBEDDING_DIM} from './faces.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClusterMember {
    photoHash: string;
    faceIndex: number;
}

export interface FaceCluster {
    id: string;
    centroid: number[];
    members: ClusterMember[];
    personName?: string;
}

export interface ClusterMatch {
    clusterId: string;
    similarity: number;
}

// ---------------------------------------------------------------------------
// Serialization shape (internal)
// ---------------------------------------------------------------------------

interface SerializedState {
    threshold?: number;
    clusters: Array<{
        id: string;
        centroid: number[];
        members: ClusterMember[];
        personName?: string;
    }>;
}

// ---------------------------------------------------------------------------
// FaceClusterDimension
// ---------------------------------------------------------------------------

const DEFAULT_SIMILARITY_THRESHOLD = 0.55;

export class FaceClusterDimension {
    private readonly hnsw: HNSWIndex;
    private readonly clusters: Map<string, FaceCluster> = new Map();
    private readonly threshold: number;

    constructor(threshold = DEFAULT_SIMILARITY_THRESHOLD) {
        this.threshold = threshold;
        this.hnsw = new HNSWIndex(EMBEDDING_DIM, 'cosine');
    }

    // ------------------------------------------------------------------
    // Core operations
    // ------------------------------------------------------------------

    /**
     * Assign a face embedding to the nearest cluster or create a new one.
     * Returns the cluster ID the face was assigned to.
     */
    assign(embedding: number[], photoHash: string, faceIndex: number): string {
        const member: ClusterMember = {photoHash, faceIndex};

        // Try to find a matching cluster
        if (this.clusters.size > 0) {
            const results = this.hnsw.search(embedding, 1);
            if (results.length > 0 && results[0].similarity >= this.threshold) {
                const clusterId = results[0].objectHash as string;
                const cluster = this.clusters.get(clusterId);
                if (cluster) {
                    // Update centroid as running average
                    const n = cluster.members.length;
                    const newCentroid = new Array<number>(EMBEDDING_DIM);
                    for (let i = 0; i < EMBEDDING_DIM; i++) {
                        newCentroid[i] = (cluster.centroid[i] * n + embedding[i]) / (n + 1);
                    }
                    cluster.centroid = newCentroid;
                    cluster.members.push(member);

                    // Update HNSW: remove old, add updated centroid
                    this.hnsw.remove(clusterId as any);
                    this.hnsw.add(clusterId as any, clusterId as any, newCentroid);

                    return clusterId;
                }
            }
        }

        // No match — create new cluster
        const clusterId = `${photoHash}:${faceIndex}`;
        const cluster: FaceCluster = {
            id: clusterId,
            centroid: [...embedding],
            members: [member],
        };
        this.clusters.set(clusterId, cluster);
        this.hnsw.add(clusterId as any, clusterId as any, embedding);

        return clusterId;
    }

    /**
     * Search for the k nearest clusters to the given embedding.
     */
    findNearest(embedding: number[], k: number): ClusterMatch[] {
        if (this.clusters.size === 0) return [];

        const results: HNSWSearchResult[] = this.hnsw.search(embedding, k);
        return results.map(r => ({
            clusterId: r.objectHash as string,
            similarity: r.similarity,
        }));
    }

    // ------------------------------------------------------------------
    // Cluster access
    // ------------------------------------------------------------------

    getCluster(id: string): FaceCluster | undefined {
        return this.clusters.get(id);
    }

    getAllClusters(): FaceCluster[] {
        return Array.from(this.clusters.values());
    }

    getClusterCount(): number {
        return this.clusters.size;
    }

    getThreshold(): number {
        return this.threshold;
    }

    // ------------------------------------------------------------------
    // Naming
    // ------------------------------------------------------------------

    nameCluster(id: string, name: string): void {
        const cluster = this.clusters.get(id);
        if (!cluster) {
            throw new Error(`Cluster not found: ${id}`);
        }
        cluster.personName = name;
    }

    removeCluster(id: string): void {
        const cluster = this.clusters.get(id);
        if (!cluster) {
            throw new Error(`Cluster not found: ${id}`);
        }
        this.hnsw.remove(id as any);
        this.clusters.delete(id);
    }

    // ------------------------------------------------------------------
    // Merge
    // ------------------------------------------------------------------

    /**
     * Merge sourceId cluster into targetId. The target centroid becomes
     * a weighted average. The source cluster is removed.
     */
    merge(targetId: string, sourceId: string): void {
        const target = this.clusters.get(targetId);
        const source = this.clusters.get(sourceId);
        if (!target) throw new Error(`Target cluster not found: ${targetId}`);
        if (!source) throw new Error(`Source cluster not found: ${sourceId}`);

        const nTarget = target.members.length;
        const nSource = source.members.length;
        const total = nTarget + nSource;

        // Weighted centroid merge
        const merged = new Array<number>(EMBEDDING_DIM);
        for (let i = 0; i < EMBEDDING_DIM; i++) {
            merged[i] = (target.centroid[i] * nTarget + source.centroid[i] * nSource) / total;
        }

        target.centroid = merged;
        target.members.push(...source.members);

        // Remove source from HNSW and cluster map
        this.hnsw.remove(sourceId as any);
        this.clusters.delete(sourceId);

        // Update target in HNSW
        this.hnsw.remove(targetId as any);
        this.hnsw.add(targetId as any, targetId as any, merged);
    }

    // ------------------------------------------------------------------
    // Serialization
    // ------------------------------------------------------------------

    serialize(): string {
        const state: SerializedState = {
            threshold: this.threshold,
            clusters: Array.from(this.clusters.values()).map(c => ({
                id: c.id,
                centroid: c.centroid,
                members: c.members,
                ...(c.personName !== undefined ? {personName: c.personName} : {}),
            })),
        };
        return JSON.stringify(state);
    }

    static deserialize(json: string, thresholdOverride?: number): FaceClusterDimension {
        const state: SerializedState = JSON.parse(json);
        const dim = new FaceClusterDimension(
            thresholdOverride ?? state.threshold ?? DEFAULT_SIMILARITY_THRESHOLD
        );

        for (const c of state.clusters) {
            const cluster: FaceCluster = {
                id: c.id,
                centroid: c.centroid,
                members: c.members,
                ...(c.personName !== undefined ? {personName: c.personName} : {}),
            };
            dim.clusters.set(cluster.id, cluster);
            dim.hnsw.add(cluster.id as any, cluster.id as any, cluster.centroid);
        }

        return dim;
    }
}
