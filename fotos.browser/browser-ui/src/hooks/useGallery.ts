import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GalleryTrieManager } from '@refinio/fotos.core';
import { groupPhotosByDay, useFotosGalleryState } from '@refinio/fotos.ui';
import type { PhotoEntry } from '@/types/fotos';
import { buildFaceClusterSummaries, buildSimilarFaceMatches } from '@/lib/cluster-gallery';
import type { FotosCollectionDefinition } from '@/lib/fotosCollections';
import { collectionMatchesPhoto } from '@/lib/fotosCollections';
import { createSemanticWorker } from '@/lib/semanticWorkerClient';
import type { FolderAccess } from './useFolderAccess';
import { useFolderAccess } from './useFolderAccess';
import semanticWorkerUrl from '@/workers/semantic.worker.ts?worker&url';

export type FotosGalleryMode = 'images' | 'clusters';

export interface UseGalleryOptions {
    clusterSensitivity?: number;
    faceAnalyticsEnabled?: boolean;
    semanticSearchEnabled?: boolean;
    collections?: FotosCollectionDefinition[];
    /** When provided, this folder source is used instead of creating one via useFolderAccess. */
    folder?: FolderAccess;
}

export function useGallery(options: UseGalleryOptions = {}) {
    const localFolder = useFolderAccess({
        clusterSensitivity: options.clusterSensitivity,
        faceAnalyticsEnabled: options.faceAnalyticsEnabled,
        semanticSearchEnabled: options.semanticSearchEnabled,
    });
    const folder = options.folder ?? localFolder;
    const gallery = useFotosGalleryState<PhotoEntry>({
        source: folder,
        resolveDayGroups: resolveCaptureDayGroups,
    });
    const [galleryMode, setGalleryMode] = useState<FotosGalleryMode>('images');
    const [activeClusterId, setActiveClusterId] = useState<string | null>(null);
    const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
    const semanticWorkerRef = useRef<ReturnType<typeof createSemanticWorker> | null>(null);
    const semanticRequestIdRef = useRef(0);
    const galleryTrieRef = useRef<GalleryTrieManager<PhotoEntry> | null>(null);

    const resolveCaptureDayGroups = useCallback(async (photos: PhotoEntry[]) => {
        if (!galleryTrieRef.current) {
            galleryTrieRef.current = new GalleryTrieManager<PhotoEntry>('fotos-browser-ui');
        }

        const manager = galleryTrieRef.current;
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
    }, []);

    const allClusters = useMemo(() => buildFaceClusterSummaries(folder.entries), [folder.entries]);
    const activeCluster = useMemo(
        () => allClusters.find(cluster => cluster.clusterId === activeClusterId) ?? null,
        [allClusters, activeClusterId],
    );
    const activeCollection = useMemo(
        () => options.collections?.find(collection => collection.id === activeCollectionId) ?? null,
        [activeCollectionId, options.collections],
    );

    useEffect(() => {
        if (!activeClusterId) {
            return;
        }
        if (allClusters.some(cluster => cluster.clusterId === activeClusterId)) {
            return;
        }
        setActiveClusterId(null);
    }, [activeClusterId, allClusters]);

    useEffect(() => {
        if (!activeCollectionId) {
            return;
        }

        if (options.collections?.some(collection => collection.id === activeCollectionId)) {
            return;
        }

        setActiveCollectionId(null);
    }, [activeCollectionId, options.collections]);

    const clusterPhotos = useMemo(() => {
        if (!activeClusterId || !activeCluster) {
            return [] as PhotoEntry[];
        }
        const activeClusterIds = new Set(activeCluster.memberClusterIds);
        return gallery.photos.filter(photo =>
            photo.faces?.clusterIds?.some(clusterId => activeClusterIds.has(clusterId)) ?? false,
        );
    }, [activeCluster, activeClusterId, gallery.photos]);
    const clusterDayGroups = useMemo(
        () => groupPhotosByDay(clusterPhotos),
        [clusterPhotos],
    );
    const collectionPhotos = useMemo(() => {
        if (!activeCollection) {
            return [] as PhotoEntry[];
        }

        return gallery.photos.filter(photo => collectionMatchesPhoto(activeCollection, photo));
    }, [activeCollection, gallery.photos]);
    const collectionDayGroups = useMemo(
        () => groupPhotosByDay(collectionPhotos),
        [collectionPhotos],
    );

    const clusterQuery = gallery.searchQuery.trim().toLowerCase();
    const visibleClusters = useMemo(() => {
        if (!clusterQuery) {
            return allClusters;
        }
        return allClusters.filter(cluster =>
            cluster.label.toLowerCase().includes(clusterQuery)
            || cluster.clusterId.toLowerCase().includes(clusterQuery)
            || cluster.memberClusterIds.some(clusterId => clusterId.toLowerCase().includes(clusterQuery))
            || (cluster.personName ?? '').toLowerCase().includes(clusterQuery),
        );
    }, [allClusters, clusterQuery]);

    const people = useMemo(
        () => visibleClusters.filter(cluster => Boolean(cluster.personName) || Boolean(cluster.personId)),
        [visibleClusters],
    );
    const groups = useMemo(
        () => visibleClusters.filter(cluster => !cluster.personName && !cluster.personId),
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
                .map(match => match.personId ? `person:${match.personId}` : match.clusterId)
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
                memberClusterIds: [],
            }];
        }

        return allClusters.filter(cluster => clusterIds.has(cluster.clusterId));
    }, [gallery.searchFace, similarFaces, allClusters]);

    const semanticSearchQuery = galleryMode === 'images' && !gallery.searchFace
        ? gallery.searchQuery.trim()
        : '';
    const semanticSearchEnabled = options.semanticSearchEnabled ?? false;
    const ingestionPhase = folder.ingestProgress?.phase ?? null;
    const isBlockingBackgroundWork = ingestionPhase === 'scanning'
        || ingestionPhase === 'processing'
        || ingestionPhase === 'writing'
        || ingestionPhase === 'preparing-faces'
        || ingestionPhase === 'faces';
    const ensureSemanticEmbeddings = folder.ensureSemanticEmbeddings;
    const setSearchEmbedding = gallery.setSearchEmbedding;

    useEffect(() => {
        return () => {
            semanticWorkerRef.current?.terminate();
        };
    }, []);

    useEffect(() => {
        if (semanticSearchEnabled) {
            return;
        }

        semanticWorkerRef.current?.terminate();
        semanticWorkerRef.current = null;
        setSearchEmbedding(null);
    }, [semanticSearchEnabled, setSearchEmbedding]);

    useEffect(() => {
        const requestId = ++semanticRequestIdRef.current;
        if (!semanticSearchEnabled || !semanticSearchQuery) {
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
    }, [semanticSearchEnabled, semanticSearchQuery, setSearchEmbedding]);

    useEffect(() => {
        if (!semanticSearchEnabled || !semanticSearchQuery) {
            return;
        }

        void ensureSemanticEmbeddings();
    }, [ensureSemanticEmbeddings, semanticSearchEnabled, semanticSearchQuery, folder.entries]);

    useEffect(() => {
        if (!semanticSearchEnabled || !folder.isOpen || isBlockingBackgroundWork) {
            return;
        }

        void ensureSemanticEmbeddings();
    }, [
        ensureSemanticEmbeddings,
        folder.entries,
        folder.isOpen,
        isBlockingBackgroundWork,
        semanticSearchEnabled,
    ]);

    return {
        ...gallery,
        folder,
        galleryMode,
        setGalleryMode,
        allClusters,
        clusters: visibleClusters,
        people,
        groups,
        activeCollectionId,
        activeCollection,
        setActiveCollectionId,
        collectionPhotos,
        collectionDayGroups,
        similarFaces,
        searchClusters,
        activeClusterId,
        activeCluster,
        setActiveClusterId,
        clusterPhotos,
        clusterDayGroups,
    };
}
