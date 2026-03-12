import { useEffect, useMemo, useRef, useState } from 'react';
import { GalleryTrieManager } from '@refinio/fotos.core';
import { groupPhotosByDay, useFotosGalleryState } from '@refinio/fotos.ui';
import type { PhotoEntry } from '@/types/fotos';
import { buildFaceClusterSummaries, buildSimilarFaceMatches } from '@/lib/cluster-gallery';
import { createSemanticWorker } from '@/lib/semanticWorkerClient';
import { useFolderAccess } from './useFolderAccess';
import semanticWorkerUrl from '@/workers/semantic.worker.ts?worker&url';

export type FotosGalleryMode = 'images' | 'clusters';

export interface UseGalleryOptions {
    clusterSensitivity?: number;
}

async function resolveCaptureDayGroups(photos: PhotoEntry[]) {
    const manager = new GalleryTrieManager<PhotoEntry>('fotos-browser-ui');
    await manager.replaceEntries(
        photos.map(photo => ({
            ...photo,
            capturedAt: photo.capturedAt ?? photo.exif?.date ?? photo.addedAt,
            updatedAt: photo.updatedAt ?? photo.addedAt,
            folderPath: photo.folderPath ?? photo.sourcePath?.split('/').slice(0, -1).join('/') ?? undefined,
        }))
    );

    const groups = await manager.getCaptureDayGroups();
    return groups.map(group => ({
        date: group.date,
        photos: group.entries,
    }));
}

export function useGallery(options: UseGalleryOptions = {}) {
    const folder = useFolderAccess({
        clusterSensitivity: options.clusterSensitivity,
    });
    const gallery = useFotosGalleryState<PhotoEntry>({
        source: folder,
        resolveDayGroups: resolveCaptureDayGroups,
    });
    const [galleryMode, setGalleryMode] = useState<FotosGalleryMode>('images');
    const [activeClusterId, setActiveClusterId] = useState<string | null>(null);
    const semanticWorkerRef = useRef<ReturnType<typeof createSemanticWorker> | null>(null);
    const semanticRequestIdRef = useRef(0);

    const clusters = useMemo(() => buildFaceClusterSummaries(folder.entries), [folder.entries]);
    const activeCluster = useMemo(
        () => clusters.find(cluster => cluster.clusterId === activeClusterId) ?? null,
        [clusters, activeClusterId],
    );

    const clusterPhotos = useMemo(() => {
        if (!activeClusterId) {
            return [] as PhotoEntry[];
        }
        return gallery.photos.filter(photo => photo.faces?.clusterIds?.includes(activeClusterId) ?? false);
    }, [gallery.photos, activeClusterId]);
    const clusterDayGroups = useMemo(
        () => groupPhotosByDay(clusterPhotos),
        [clusterPhotos],
    );

    const clusterQuery = gallery.searchQuery.trim().toLowerCase();
    const visibleClusters = useMemo(() => {
        if (!clusterQuery) {
            return clusters;
        }
        return clusters.filter(cluster =>
            cluster.label.toLowerCase().includes(clusterQuery)
            || cluster.clusterId.toLowerCase().includes(clusterQuery)
            || (cluster.personName ?? '').toLowerCase().includes(clusterQuery),
        );
    }, [clusters, clusterQuery]);

    const people = useMemo(
        () => visibleClusters.filter(cluster => Boolean(cluster.personName)),
        [visibleClusters],
    );
    const groups = useMemo(
        () => visibleClusters.filter(cluster => !cluster.personName),
        [visibleClusters],
    );
    const similarFaces = useMemo(
        () => gallery.searchFace ? buildSimilarFaceMatches(folder.entries, gallery.searchFace) : [],
        [folder.entries, gallery.searchFace],
    );
    const searchClusters = useMemo(() => {
        if (!gallery.searchFace) {
            return [] as typeof visibleClusters;
        }

        const clusterIds = new Set(
            similarFaces
                .map(match => match.clusterId)
                .filter((value): value is string => Boolean(value)),
        );

        if (clusterIds.size === 0) {
            if (similarFaces.length === 0) {
                return [];
            }

            return [{
                clusterId: 'current-match',
                label: 'Current match',
                avatarPath: similarFaces[0].cropPath,
                faceCount: similarFaces.length,
                photoCount: new Set(similarFaces.map(match => match.photo.hash)).size,
                photoHashes: [...new Set(similarFaces.map(match => match.photo.hash))],
            }];
        }

        return clusters.filter(cluster => clusterIds.has(cluster.clusterId));
    }, [gallery.searchFace, similarFaces, clusters]);

    const semanticSearchQuery = galleryMode === 'images' && !gallery.searchFace
        ? gallery.searchQuery.trim()
        : '';
    const ensureSemanticEmbeddings = folder.ensureSemanticEmbeddings;
    const setSearchEmbedding = gallery.setSearchEmbedding;

    useEffect(() => {
        return () => {
            semanticWorkerRef.current?.terminate();
        };
    }, []);

    useEffect(() => {
        const requestId = ++semanticRequestIdRef.current;
        if (!semanticSearchQuery) {
            setSearchEmbedding(null);
            return;
        }

        setSearchEmbedding(null);

        let cancelled = false;
        void (async () => {
            try {
                let worker = semanticWorkerRef.current;
                if (!worker) {
                    worker = createSemanticWorker(semanticWorkerUrl);
                    await worker.ready;
                    semanticWorkerRef.current = worker;
                }

                const semantic = await worker.handle.embedText(semanticSearchQuery);
                if (cancelled || semanticRequestIdRef.current !== requestId) {
                    return;
                }

                setSearchEmbedding(semantic);
            } catch (error) {
                if (!cancelled && semanticRequestIdRef.current === requestId) {
                    console.warn('[semantic-search] Failed to embed query:', error);
                    setSearchEmbedding(null);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [semanticSearchQuery, setSearchEmbedding]);

    useEffect(() => {
        if (!semanticSearchQuery) {
            return;
        }

        void ensureSemanticEmbeddings();
    }, [ensureSemanticEmbeddings, semanticSearchQuery, folder.entries]);

    return {
        ...gallery,
        folder,
        galleryMode,
        setGalleryMode,
        clusters: visibleClusters,
        people,
        groups,
        similarFaces,
        searchClusters,
        activeClusterId,
        activeCluster,
        setActiveClusterId,
        clusterPhotos,
        clusterDayGroups,
    };
}
