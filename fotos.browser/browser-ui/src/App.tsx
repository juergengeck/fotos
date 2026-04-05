import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Impressum } from '@/components/Impressum';
import { GalleryBreadcrumbs } from '@/components/GalleryBreadcrumbs';
import { PhotoGrid } from '@/components/PhotoGrid';
import { Lightbox } from '@/components/Lightbox';
import { Sidebar } from '@/components/Sidebar';
import { TimelineScrubber } from '@/components/TimelineScrubber';
import { ClusterGallery } from '@/components/ClusterGallery';
import { useGallery } from '@/hooks/useGallery';
import { useHeadlessSource } from '@/hooks/useHeadlessSource';
import { useBreadcrumbHistory } from '@/hooks/useBreadcrumbHistory';
import { useSettings } from '@/hooks/useSettings';
import { shareFile } from '@/lib/platform';
import { UpdatePrompt } from '@/components/UpdatePrompt';
import {
    DEFAULT_GLUE_CONNECTION_BINDING_ID,
    getGlueBindingPersonId,
    getGlueIdentityProfile,
} from '@glueone/glue.core';
import { getFaceCount } from '@refinio/fotos.ui';
import type { FotosModel } from './lib/onecore-boot';
import { setModelUpdater } from './lib/onecore-boot';
import { traceHang } from './lib/hangTrace';
import type { SimilarFaceMatch } from '@/lib/cluster-gallery';
import { shouldExposeFotosDebugApi } from '@/lib/fotosLiveDiagnostics';
import { fotosShareController, type FotosShareSnapshot } from '@/lib/fotosShareController';
import { isSnapshotEqual, type FotosBreadcrumbSnapshot } from '@/lib/fotosHistorySettings';
import { grantFotosAccess } from '@/lib/fotos-manifest';
import { ensureConfiguredGlueIdentity } from '@/lib/glueIdentity';
import {
    buildPersistentPhotoPath,
    parsePersistentPhotoRouteTarget,
} from '@/lib/photoRoute';

interface AppProps {
    fotosModel?: FotosModel;
}

interface RouteLocationSnapshot {
    pathname: string;
    search: string;
    hash: string;
}

function getCurrentRouteLocation(): RouteLocationSnapshot {
    if (typeof window === 'undefined') {
        return {
            pathname: '/',
            search: '',
            hash: '',
        };
    }

    return {
        pathname: window.location.pathname,
        search: window.location.search,
        hash: window.location.hash,
    };
}

function areRouteLocationsEqual(
    left: RouteLocationSnapshot,
    right: RouteLocationSnapshot,
): boolean {
    return left.pathname === right.pathname
        && left.search === right.search
        && left.hash === right.hash;
}

interface FotosDebugApi {
    getStatus: () => {
        initialized: boolean;
        ownerId: string | null;
        publicationIdentity: string | null;
        headlessConnected: boolean;
        isOpen: boolean;
        folderName: string | null;
        entryCount: number;
        visiblePhotoCount: number;
    };
    getLocalIdentitySnapshot: () => Promise<{
        ownerId: string | null;
        publicationIdentity: string | null;
        glueDisplayName: string | null;
        syncEnabled: boolean;
        headlessConnected: boolean;
    }>;
    prepareIdentity: (displayName: string) => Promise<{
        personId: string;
        created: boolean;
        syncEnabled: boolean;
        reloadRequired: boolean;
    }>;
    getPresenceSnapshot: () => Promise<unknown | null>;
    getOnlinePeers: () => Array<{
        personId: string;
        displayName: string | null;
        hasVerifiedIdentity: boolean;
        transportCapabilities: string[];
    }>;
    getPeerConnectionInfo: (personId: string) => {
        online: boolean;
        advertisedDisplayName: string | null;
        certifiedDisplayName: string | null;
        advertisedEncryptionKey: string | null;
        coordinatorState: string | null;
        encryptionKey: string | null;
        certifiedEncryptionKeys: string[];
        certifiedCredentialIssuedAt: number | null;
        transportCapabilities: string[];
        hasVerifiedIdentity: boolean;
    };
    forceRouteKeyConnect: (personId: string, keySource?: 'advertised' | 'certified') => Promise<{
        started: true;
        encryptionKey: string;
        transportCapabilities: string[];
        keySource: 'advertised' | 'certified';
    }>;
    grantFotosAccess: (personId: string) => Promise<{ granted: true; personId: string }>;
    getFotosSyncState: () => Promise<FotosShareSnapshot>;
    getShareState: () => Promise<FotosShareSnapshot>;
    getGalleryState: () => {
        isOpen: boolean;
        folderName: string | null;
        totalCount: number;
        visibleCount: number;
        items: Array<{
            hash: string;
            name: string;
            sourcePath?: string;
            thumb?: string;
            capturedAt?: string;
            updatedAt?: string;
            faceCount: number;
        }>;
    };
    openLocalPicker: () => boolean;
}

async function getLocalIdentitySnapshot(
    targetModel: FotosModel | null | undefined,
): Promise<Awaited<ReturnType<FotosDebugApi['getLocalIdentitySnapshot']>>> {
    if (!targetModel?.initialized) {
        return {
            ownerId: null,
            publicationIdentity: null,
            glueDisplayName: null,
            syncEnabled: false,
            headlessConnected: false,
        };
    }

    const { values } = await targetModel.settingsPlan
        .getSection({ moduleId: 'glue' })
        .catch(() => ({ values: {} as Record<string, unknown> }));
    const publicationIdentity = getGlueBindingPersonId(
        values,
        DEFAULT_GLUE_CONNECTION_BINDING_ID,
    ) ?? targetModel.publicationIdentity;
    const boundProfile = publicationIdentity
        ? getGlueIdentityProfile(values, publicationIdentity)
        : null;
    const glueDisplayName = typeof boundProfile?.displayName === 'string'
        ? boundProfile.displayName.trim()
        : typeof values.glueDisplayName === 'string'
            ? values.glueDisplayName.trim()
            : null;

    return {
        ownerId: targetModel.ownerId ? String(targetModel.ownerId) : null,
        publicationIdentity: publicationIdentity ? String(publicationIdentity) : null,
        glueDisplayName,
        syncEnabled: values.syncEnabled === true,
        headlessConnected: Boolean(targetModel.headlessConnected),
    };
}

export function App({ fotosModel: initialModel }: AppProps) {
    const [fotosModel, setFotosModel] = useState<FotosModel | null>(initialModel ?? null);
    const [headlessUrl, setHeadlessUrl] = useState<string | null>(null);
    const [headlessInput, setHeadlessInput] = useState('');
    const [showHeadlessConnect, setShowHeadlessConnect] = useState(false);

    // Wire up model updater so async state changes (e.g. headlessConnected) trigger re-renders
    useEffect(() => {
        setModelUpdater(setFotosModel);
        return () => setModelUpdater(null);
    }, []);
    const { settings, updateStorage, updateDisplay, updateDeviceName, updateAnalysis } = useSettings(fotosModel);
    const headlessFolder = useHeadlessSource(headlessUrl);
    const gallery = useGallery({
        faceAnalyticsEnabled: settings.analysis.faceAnalyticsEnabled,
        semanticSearchEnabled: settings.analysis.semanticSearchEnabled,
        clusterSensitivity: settings.analysis.clusterSensitivity,
        folder: headlessUrl ? headlessFolder : undefined,
    });
    const scrollRef = useRef<HTMLDivElement>(null);
    const [routeLocation, setRouteLocation] = useState<RouteLocationSnapshot>(getCurrentRouteLocation);

    const visiblePhotos = gallery.galleryMode === 'clusters' && gallery.activeClusterId
        ? gallery.clusterPhotos
        : gallery.photos;
    const visibleDayGroups = gallery.galleryMode === 'clusters' && gallery.activeClusterId
        ? gallery.clusterDayGroups
        : gallery.dayGroups;
    const showClusterGallery = gallery.galleryMode === 'clusters' && !gallery.activeClusterId;
    const trimmedSearchQuery = gallery.searchQuery.trim();
    const hasGalleryDetail = gallery.galleryMode === 'clusters'
        || gallery.activeTag !== null
        || trimmedSearchQuery.length > 0
        || gallery.searchFace !== null
        || gallery.activeClusterId !== null;

    const handleRenameFace = useCallback(
        (clusterId: string, name: string) => gallery.folder.renameFace(clusterId, name),
        [gallery.folder],
    );

    const handleDeleteFace = useCallback((clusterId: string) => {
        void gallery.folder.deleteFace(clusterId);
    }, [gallery.folder]);

    const handleAssociateFaceWithCluster = useCallback((photoHash: string, faceIndex: number, clusterId: string) => {
        void gallery.folder.associateFaceWithCluster(photoHash, faceIndex, clusterId);
    }, [gallery.folder]);

    const handleMergeFaceClusters = useCallback((targetClusterId: string, sourceClusterIds: string[]) => {
        void gallery.folder.mergeFaceClusters(targetClusterId, sourceClusterIds);
    }, [gallery.folder]);

    const handleGroupFaceClustersAsPerson = useCallback((clusterIds: string[]) => {
        void gallery.folder.groupFaceClustersAsPerson(clusterIds);
    }, [gallery.folder]);

    const handleSeparatePersonGroup = useCallback((personId: string) => {
        void gallery.folder.separatePersonGroup(personId);
    }, [gallery.folder]);

    const mobile = gallery.folder.mobile;
    const intakePlan = gallery.folder.defaultIntakePlan;
    const canRunFaceAnalytics = settings.analysis.faceAnalyticsEnabled
        && intakePlan.faceEnrichment === 'local';
    const canReanalyze = canRunFaceAnalytics || settings.analysis.semanticSearchEnabled;

    useEffect(() => {
        const handlePopState = () => {
            setRouteLocation(getCurrentRouteLocation());
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    useEffect(() => {
        const nextLocation = getCurrentRouteLocation();
        setRouteLocation((current) => (
            areRouteLocationsEqual(current, nextLocation) ? current : nextLocation
        ));
    });

    const photoRouteTarget = useMemo(
        () => parsePersistentPhotoRouteTarget(routeLocation.search),
        [routeLocation.search],
    );
    const buildPhotoRoutePath = useCallback(
        (photoHash?: string | null) => buildPersistentPhotoPath(
            routeLocation.pathname,
            routeLocation.search,
            photoHash ? { photoHash } : null,
        ),
        [routeLocation.pathname, routeLocation.search],
    );
    const navigatePhotoRoute = useCallback((photoHash?: string | null, options?: { replace?: boolean }) => {
        const nextPath = buildPhotoRoutePath(photoHash);
        const nextUrl = new URL(window.location.href);
        const [nextPathname, nextSearch = ''] = nextPath.split('?');
        nextUrl.pathname = nextPathname;
        nextUrl.search = nextSearch ? `?${nextSearch}` : '';

        const currentRoute = `${routeLocation.pathname}${routeLocation.search}${routeLocation.hash}`;
        const nextRoute = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
        if (currentRoute === nextRoute) {
            return;
        }

        const historyMethod = options?.replace ? 'replaceState' : 'pushState';
        window.history[historyMethod]({}, '', nextUrl.toString());
        setRouteLocation({
            pathname: nextUrl.pathname,
            search: nextUrl.search,
            hash: nextUrl.hash,
        });
    }, [buildPhotoRoutePath, routeLocation.hash, routeLocation.pathname, routeLocation.search]);
    const openPhotoRoute = useCallback((photoHash: string, options?: { replace?: boolean }) => {
        const nextIndex = visiblePhotos.findIndex((photo) => photo.hash === photoHash);
        if (nextIndex >= 0) {
            gallery.setSelectedIndex(nextIndex);
        }
        navigatePhotoRoute(photoHash, options);
    }, [gallery, navigatePhotoRoute, visiblePhotos]);
    const openPhotoRouteIndex = useCallback((index: number, options?: { replace?: boolean }) => {
        const photo = visiblePhotos[index];
        if (!photo) {
            return;
        }
        openPhotoRoute(photo.hash, options);
    }, [openPhotoRoute, visiblePhotos]);
    const closePhotoRoute = useCallback((options?: { replace?: boolean }) => {
        gallery.setSelectedIndex(null);
        navigatePhotoRoute(null, options);
    }, [gallery, navigatePhotoRoute]);

    const handleDelete = useCallback((hash: string) => {
        if (photoRouteTarget?.photoHash === hash) {
            const currentIndex = gallery.selectedIndex;
            const fallbackPhoto = currentIndex !== null
                ? visiblePhotos[currentIndex + 1] ?? visiblePhotos[currentIndex - 1] ?? null
                : null;

            if (fallbackPhoto) {
                openPhotoRoute(fallbackPhoto.hash, { replace: true });
            } else {
                closePhotoRoute({ replace: true });
            }
        }

        gallery.deletePhoto(hash);
        if (!photoRouteTarget?.photoHash && gallery.selectedIndex !== null) {
            const remaining = visiblePhotos.length - 1;
            if (remaining <= 0) {
                gallery.setSelectedIndex(null);
            } else if (gallery.selectedIndex >= remaining) {
                gallery.setSelectedIndex(remaining - 1);
            }
        }
    }, [
        closePhotoRoute,
        gallery,
        openPhotoRoute,
        photoRouteTarget?.photoHash,
        visiblePhotos,
        visiblePhotos.length,
    ]);

    const handleFaceSearch = useCallback((embedding: Float32Array) => {
        closePhotoRoute({ replace: true });
        gallery.setGalleryMode('images');
        gallery.setActiveClusterId(null);
        gallery.setSearchFace(embedding);
    }, [closePhotoRoute, gallery]);

    // On mobile, tap a photo → share via native share sheet (opens in photo app)
    const handlePhotoClick = useCallback(async (index: number) => {
        traceHang('photo-click', {
            index,
            hash: visiblePhotos[index]?.hash,
            mobile,
        });
        if (!mobile) {
            openPhotoRouteIndex(index);
            return;
        }
        const photo = visiblePhotos[index];
        if (!photo.sourcePath) return;
        try {
            const file = await gallery.folder.readFile(photo.sourcePath);
            const shared = await shareFile(file);
            if (!shared) {
                traceHang('photo-click-fallback-lightbox', { index, hash: photo.hash });
                openPhotoRouteIndex(index);
            }
        } catch {
            // Share API unavailable — fall back to lightbox
            traceHang('photo-click-share-error', { index, hash: photo.hash });
            openPhotoRouteIndex(index);
        }
    }, [mobile, gallery, openPhotoRouteIndex, visiblePhotos]);

    const progress = gallery.folder.ingestProgress;
    const totalDetectedFaces = gallery.folder.entries.reduce(
        (count, photo) => count + getFaceCount(photo.faces),
        0,
    );
    const analysisProgress = progress
        && (
            progress.phase === 'faces'
            || progress.phase === 'preparing-faces'
            || progress.phase === 'semantic'
            || progress.phase === 'preparing-semantic'
        )
        ? progress
        : null;
    const configMarquee = (() => {
        if (!analysisProgress) return null;
        if (analysisProgress.phase === 'preparing-faces') {
            const prefix = analysisProgress.statusLabel?.startsWith('Loading')
                ? 'Downloading image AI...'
                : 'Preparing image AI...';
            return `${prefix} ${analysisProgress.statusLabel ?? ''}`.trim();
        }
        if (analysisProgress.phase === 'faces') {
            const step = analysisProgress.total > 0
                ? `Analyzing faces ${analysisProgress.current}/${analysisProgress.total}`
                : 'Analyzing faces...';
            return analysisProgress.fileName
                ? `${step} ${analysisProgress.fileName}`.trim()
                : step;
        }
        if (analysisProgress.phase === 'preparing-semantic') {
            return analysisProgress.statusLabel ?? 'Loading semantic search model...';
        }
        if (analysisProgress.phase === 'semantic') {
            const step = analysisProgress.total > 0
                ? `Indexing semantic search ${analysisProgress.current}/${analysisProgress.total}`
                : 'Indexing semantic search...';
            return analysisProgress.fileName
                ? `${step} ${analysisProgress.fileName}`.trim()
                : step;
        }
        return null;
    })();
    const breadcrumbItems = useMemo(() => {
        const items: Array<{ key: string; label: string; onClick?: () => void }> = [];

        if (gallery.galleryMode === 'clusters') {
            items.push({
                key: 'mode',
                label: 'Faces',
                onClick: gallery.activeClusterId !== null || trimmedSearchQuery.length > 0
                    ? () => {
                        gallery.setActiveClusterId(null);
                        gallery.setSearchQuery('');
                    }
                    : undefined,
            });

            if (trimmedSearchQuery.length > 0) {
                items.push({
                    key: 'query',
                    label: `Search: ${trimmedSearchQuery}`,
                    onClick: gallery.activeClusterId !== null
                        ? () => {
                            gallery.setActiveClusterId(null);
                        }
                        : undefined,
                });
            }

            if (gallery.activeCluster) {
                items.push({
                    key: 'cluster',
                    label: gallery.activeCluster.label,
                });
            }
        } else {
            if (!hasGalleryDetail) {
                return items;
            }

            items.push({
                key: 'mode',
                label: 'Photos',
                onClick: gallery.activeTag !== null || trimmedSearchQuery.length > 0 || gallery.searchFace !== null
                    ? () => {
                        gallery.setActiveTag(null);
                        gallery.setSearchQuery('');
                        gallery.setSearchFace(null);
                    }
                    : undefined,
            });

            if (gallery.activeTag !== null) {
                items.push({
                    key: 'tag',
                    label: gallery.activeTag,
                    onClick: trimmedSearchQuery.length > 0 || gallery.searchFace !== null
                        ? () => {
                            gallery.setSearchQuery('');
                            gallery.setSearchFace(null);
                        }
                        : undefined,
                });
            }

            if (trimmedSearchQuery.length > 0) {
                items.push({
                    key: 'query',
                    label: `Search: ${trimmedSearchQuery}`,
                    onClick: gallery.searchFace !== null
                        ? () => {
                            gallery.setSearchFace(null);
                        }
                        : undefined,
                });
            }

            if (gallery.searchFace !== null) {
                items.push({
                    key: 'face-search',
                    label: 'Similar faces',
                });
            }
        }

        return items;
    }, [
        gallery.activeCluster,
        gallery.activeClusterId,
        gallery.activeTag,
        gallery.folder.folderName,
        gallery.galleryMode,
        gallery.searchFace,
        gallery.setActiveClusterId,
        gallery.setActiveTag,
        gallery.setGalleryMode,
        gallery.setSearchFace,
        gallery.setSearchQuery,
        trimmedSearchQuery.length,
        trimmedSearchQuery,
        hasGalleryDetail,
    ]);
    const breadcrumbSummary = useMemo(() => {
        if (showClusterGallery) {
            return `${gallery.clusters.length} clusters`;
        }
        if (gallery.galleryMode === 'clusters' && gallery.activeCluster) {
            return `${gallery.clusterPhotos.length} photos`;
        }
        if (gallery.searchFace !== null) {
            return `${visiblePhotos.length} matches`;
        }
        return `${visiblePhotos.length} photos`;
    }, [
        gallery.activeCluster,
        gallery.clusterPhotos.length,
        gallery.clusters.length,
        gallery.galleryMode,
        gallery.searchFace,
        showClusterGallery,
        visiblePhotos.length,
    ]);
    const historySnapshot = useMemo<FotosBreadcrumbSnapshot | null>(() => {
        if (!gallery.folder.isOpen) {
            return null;
        }

        return {
            version: 1,
            ...(gallery.folder.folderName ? { folderName: gallery.folder.folderName } : {}),
            galleryMode: gallery.galleryMode,
            ...(gallery.activeTag ? { activeTag: gallery.activeTag } : {}),
            ...(gallery.activeClusterId ? { activeClusterId: gallery.activeClusterId } : {}),
            ...(trimmedSearchQuery.length > 0 ? { searchQuery: trimmedSearchQuery } : {}),
            ...(gallery.searchFace ? { searchFace: Array.from(gallery.searchFace) } : {}),
        };
    }, [
        gallery.activeClusterId,
        gallery.activeTag,
        gallery.folder.folderName,
        gallery.folder.isOpen,
        gallery.galleryMode,
        gallery.searchFace,
        trimmedSearchQuery,
    ]);
    const historyBreadcrumbs = useMemo(
        () => breadcrumbItems.map(item => item.label),
        [breadcrumbItems],
    );
    const showBreadcrumbs = breadcrumbItems.length > 0;
    const breadcrumbHistory = useBreadcrumbHistory({
        model: fotosModel,
        snapshot: historySnapshot,
        breadcrumbs: historyBreadcrumbs,
    });

    useEffect(() => {
        const restoreEntry = breadcrumbHistory.restoreEntry;
        if (!restoreEntry || !gallery.folder.isOpen) {
            return;
        }

        const currentFolderName = gallery.folder.folderName ?? '';
        const targetFolderName = restoreEntry.folderName ?? restoreEntry.state.folderName ?? '';
        if (targetFolderName !== currentFolderName) {
            return;
        }

        const targetState = restoreEntry.state;
        const currentSnapshot = historySnapshot;
        if (currentSnapshot && isSnapshotEqual(currentSnapshot, targetState)) {
            return;
        }

        closePhotoRoute({ replace: true });
        gallery.setGalleryMode(targetState.galleryMode);
        gallery.setActiveTag(targetState.activeTag ?? null);
        gallery.setActiveClusterId(targetState.activeClusterId ?? null);
        gallery.setSearchQuery(targetState.searchQuery ?? '');
        gallery.setSearchFace(targetState.searchFace?.length
            ? new Float32Array(targetState.searchFace)
            : null);
    }, [
        breadcrumbHistory.restoreEntry,
        gallery.folder.isOpen,
        gallery.folder.folderName,
        gallery.setActiveClusterId,
        gallery.setActiveTag,
        gallery.setGalleryMode,
        gallery.setSearchFace,
        gallery.setSearchQuery,
        gallery.setSelectedIndex,
        historySnapshot,
        closePhotoRoute,
    ]);

    useEffect(() => {
        if (!gallery.folder.isOpen) {
            if (gallery.selectedIndex !== null) {
                gallery.setSelectedIndex(null);
            }
            return;
        }

        const nextPhotoHash = photoRouteTarget?.photoHash ?? null;
        if (!nextPhotoHash) {
            gallery.setSelectedIndex((current) => current === null ? current : null);
            return;
        }

        const nextIndex = visiblePhotos.findIndex((photo) => photo.hash === nextPhotoHash);
        if (nextIndex === -1) {
            gallery.setSelectedIndex((current) => current === null ? current : null);
            return;
        }

        gallery.setSelectedIndex((current) => current === nextIndex ? current : nextIndex);
    }, [
        gallery.folder.isOpen,
        gallery.selectedIndex,
        gallery.setSelectedIndex,
        photoRouteTarget?.photoHash,
        visiblePhotos,
    ]);

    useEffect(() => {
        traceHang('app-state', {
            isOpen: gallery.folder.isOpen,
            photoCount: visiblePhotos.length,
            selectedIndex: gallery.selectedIndex,
            analysisProgress: analysisProgress
                ? {
                    current: analysisProgress.current,
                    total: analysisProgress.total,
                    fileName: analysisProgress.fileName,
                    statusLabel: analysisProgress.statusLabel,
                }
                : null,
        });
    }, [
        gallery.folder.isOpen,
        visiblePhotos.length,
        gallery.selectedIndex,
        analysisProgress?.current,
        analysisProgress?.total,
        analysisProgress?.fileName,
        analysisProgress?.statusLabel,
    ]);

    const handleOpenSimilarFace = useCallback((match: SimilarFaceMatch) => {
        gallery.setGalleryMode('images');
        gallery.setActiveClusterId(null);
        openPhotoRoute(match.photo.hash);
    }, [gallery, openPhotoRoute]);

    const debugRuntimeRef = useRef({
        model: fotosModel,
        folder: gallery.folder,
        visiblePhotos,
        entries: gallery.folder.entries,
    });
    debugRuntimeRef.current = {
        model: fotosModel,
        folder: gallery.folder,
        visiblePhotos,
        entries: gallery.folder.entries,
    };

    useEffect(() => {
        if (!fotosModel?.initialized) {
            fotosShareController.reset();
            return;
        }

        void fotosShareController.start();

        return () => {
            fotosShareController.stop();
        };
    }, [fotosModel?.initialized]);

    useEffect(() => {
        fotosShareController.updateState({
            isOpen: gallery.folder.isOpen,
            folderName: gallery.folder.folderName,
            entries: gallery.folder.entries,
            visibleHashes: visiblePhotos.map(photo => photo.hash),
        });
    }, [
        gallery.folder.entries,
        gallery.folder.folderName,
        gallery.folder.isOpen,
        visiblePhotos,
    ]);

    useEffect(() => {
        if (!shouldExposeFotosDebugApi(import.meta.env.DEV, window.location.search)) {
            return;
        }

        const debugWindow = window as Window & { __fotosDebug?: FotosDebugApi };
        const debugApi: FotosDebugApi = {
            getStatus: () => {
                const { model: activeModel, folder, visiblePhotos: activeVisiblePhotos, entries: activeEntries } = debugRuntimeRef.current;
                return {
                    initialized: Boolean(activeModel?.initialized),
                    ownerId: activeModel?.ownerId ? String(activeModel.ownerId) : null,
                    publicationIdentity: activeModel?.publicationIdentity ? String(activeModel.publicationIdentity) : null,
                    headlessConnected: Boolean(activeModel?.headlessConnected),
                    isOpen: folder.isOpen,
                    folderName: folder.folderName,
                    entryCount: activeEntries.length,
                    visiblePhotoCount: activeVisiblePhotos.length,
                };
            },
            getLocalIdentitySnapshot: async () => await getLocalIdentitySnapshot(debugRuntimeRef.current.model),
            prepareIdentity: async (displayName: string) => {
                const activeModel = debugRuntimeRef.current.model;
                if (!activeModel?.settingsPlan) {
                    throw new Error('fotos.one model is not initialized');
                }

                const snapshot = await getLocalIdentitySnapshot(activeModel);
                const result = await ensureConfiguredGlueIdentity(
                    activeModel.settingsPlan,
                    activeModel.leuteModel,
                    displayName,
                    activeModel.ownerId,
                );

                if (!snapshot.syncEnabled) {
                    await activeModel.settingsPlan.updateSection({
                        moduleId: 'glue',
                        values: { syncEnabled: true },
                    });
                }

                const reloadRequired = !snapshot.syncEnabled || snapshot.publicationIdentity !== result.personId;
                return {
                    personId: String(result.personId),
                    created: result.created,
                    syncEnabled: true,
                    reloadRequired,
                };
            },
            getPresenceSnapshot: async () => {
                const activeModel = debugRuntimeRef.current.model;
                if (!activeModel?.glueModule?.presenceTrieService) {
                    return null;
                }

                return await activeModel.glueModule.presenceTrieService.getDebugSnapshot(24);
            },
            getOnlinePeers: () => {
                const activeModel = debugRuntimeRef.current.model;
                const presenceService = activeModel?.glueModule?.presenceTrieService;
                if (!presenceService) {
                    return [];
                }

                return presenceService.getOnlinePeerIds().map(personId => ({
                    personId,
                    displayName: presenceService.getDisplayName(personId) ?? null,
                    hasVerifiedIdentity: presenceService.hasVerifiedIdentity(personId) ?? false,
                    transportCapabilities: presenceService.getTransportCapabilities(personId) ?? [],
                }));
            },
            getPeerConnectionInfo: (personId: string) => {
                const activeModel = debugRuntimeRef.current.model;
                const presenceService = activeModel?.glueModule?.presenceTrieService;
                const peerDebugInfo = presenceService?.getPeerDebugInfo(personId);
                const glueModuleWithPeerState = activeModel?.glueModule as {
                    getPeerConnectionState?: (targetPersonId: string) => string | undefined;
                } | undefined;

                return {
                    online: peerDebugInfo?.online ?? false,
                    advertisedDisplayName: peerDebugInfo?.advertisedDisplayName ?? null,
                    certifiedDisplayName: peerDebugInfo?.certifiedDisplayName ?? null,
                    advertisedEncryptionKey: peerDebugInfo?.advertisedEncryptionKey ?? null,
                    coordinatorState: glueModuleWithPeerState?.getPeerConnectionState?.(personId) ?? null,
                    encryptionKey: presenceService?.getEncryptionKey(personId) ?? null,
                    certifiedEncryptionKeys: peerDebugInfo?.certifiedEncryptionKeys ?? [],
                    certifiedCredentialIssuedAt: peerDebugInfo?.certifiedCredentialIssuedAt ?? null,
                    transportCapabilities: presenceService?.getTransportCapabilities(personId) ?? [],
                    hasVerifiedIdentity: presenceService?.hasVerifiedIdentity(personId) ?? false,
                };
            },
            forceRouteKeyConnect: async (personId: string, keySource: 'advertised' | 'certified' = 'advertised') => {
                const activeModel = debugRuntimeRef.current.model;
                if (
                    !activeModel?.initialized ||
                    !activeModel.publicationIdentity ||
                    !activeModel.glueModule?.presenceTrieService
                ) {
                    throw new Error('fotos.one glue runtime is not initialized');
                }

                const presenceService = activeModel.glueModule.presenceTrieService;
                const peerDebugInfo = presenceService.getPeerDebugInfo(personId);
                const advertisedEncryptionKey = peerDebugInfo?.advertisedEncryptionKey ?? null;
                const certifiedEncryptionKey = presenceService.getEncryptionKey(personId);
                const encryptionKey =
                    keySource === 'certified'
                        ? certifiedEncryptionKey
                        : advertisedEncryptionKey ?? certifiedEncryptionKey;

                if (!encryptionKey) {
                    throw new Error(`No ${keySource} encryption key available for ${personId}`);
                }

                const glueModuleWithRequest = activeModel.glueModule as {
                    requestPeerConnection?: (targetPersonId: string) => boolean;
                };
                const transportCapabilities = presenceService.getTransportCapabilities(personId) ?? ['webrtc', 'commserver-relay'];
                if (
                    keySource !== 'certified' &&
                    typeof glueModuleWithRequest.requestPeerConnection === 'function' &&
                    glueModuleWithRequest.requestPeerConnection(personId)
                ) {
                    return {
                        started: true as const,
                        encryptionKey,
                        transportCapabilities,
                        keySource: 'advertised' as const,
                    };
                }

                await activeModel.connectionModule?.connectToPeerByKey(
                    encryptionKey,
                    activeModel.publicationIdentity,
                    transportCapabilities,
                    personId as any,
                );

                return {
                    started: true as const,
                    encryptionKey,
                    transportCapabilities,
                    keySource:
                        keySource === 'advertised' && advertisedEncryptionKey
                            ? 'advertised'
                            : 'certified',
                };
            },
            grantFotosAccess: async (personId: string) => {
                await grantFotosAccess(personId as any);
                fotosShareController.recordGrant(personId);
                return {
                    granted: true as const,
                    personId,
                };
            },
            getFotosSyncState: async () => {
                await fotosShareController.refreshManifest();
                return fotosShareController.getSnapshot();
            },
            getShareState: async () => {
                await fotosShareController.refreshManifest();
                return fotosShareController.getSnapshot();
            },
            getGalleryState: () => {
                const { folder, visiblePhotos: activeVisiblePhotos, entries: activeEntries } = debugRuntimeRef.current;
                return {
                    isOpen: folder.isOpen,
                    folderName: folder.folderName,
                    totalCount: activeEntries.length,
                    visibleCount: activeVisiblePhotos.length,
                    items: activeEntries.map(photo => ({
                        hash: photo.hash,
                        name: photo.name,
                        ...(photo.sourcePath ? { sourcePath: photo.sourcePath } : {}),
                        ...(photo.thumb ? { thumb: photo.thumb } : {}),
                        ...(photo.capturedAt ? { capturedAt: photo.capturedAt } : {}),
                        ...(photo.updatedAt ? { updatedAt: photo.updatedAt } : {}),
                        faceCount: getFaceCount(photo.faces),
                    })),
                };
            },
            openLocalPicker: () => {
                debugRuntimeRef.current.folder.openLocalFiles();
                return true;
            },
        };

        debugWindow.__fotosDebug = debugApi;

        return () => {
            if (debugWindow.__fotosDebug === debugApi) {
                delete debugWindow.__fotosDebug;
            }
        };
    }, []);

    const appContent = (() => {
        // Ingestion in progress — show progress overlay
        if (progress && !analysisProgress) {
            return (
                <div className="h-screen flex flex-col items-center justify-center bg-[#111] text-white/70"
                     style={{ fontFamily: "'Figtree', system-ui, sans-serif" }}>
                    <div style={{ width: 'min(480px, 80vw)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <div style={{ width: '100%', height: 6, borderRadius: 3, background: '#333', overflow: 'hidden' }}>
                            <div style={{
                                height: '100%', borderRadius: 3, background: '#e94560',
                                width: progress.total > 0 ? `${Math.round((progress.current / progress.total) * 100)}%` : '0%',
                                transition: 'width 0.3s ease',
                            }} />
                        </div>
                        <p style={{ fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {progress.phase === 'scanning' && 'Scanning for images...'}
                            {progress.phase === 'processing' && `Processing ${progress.current}/${progress.total}${progress.fileName ? ` — ${progress.fileName}` : ''}`}
                            {progress.phase === 'preparing-faces' && (progress.statusLabel ?? 'Preparing face analytics...')}
                            {progress.phase === 'faces' && `Detecting faces ${progress.current}/${progress.total}${progress.fileName ? ` — ${progress.fileName}` : ''}`}
                            {progress.phase === 'preparing-semantic' && (progress.statusLabel ?? 'Loading semantic search model...')}
                            {progress.phase === 'semantic' && `Embedding images ${progress.current}/${progress.total}${progress.fileName ? ` — ${progress.fileName}` : ''}`}
                            {progress.phase === 'writing' && 'Writing metadata...'}
                            {progress.phase === 'done' && `Done — ${progress.total} images ingested`}
                        </p>
                    </div>
                </div>
            );
        }

        // No folder open yet — show landing page
        if (!gallery.folder.isOpen) {
            return (
                <div className="h-screen flex flex-col bg-[#111]" style={{ fontFamily: "'Figtree', system-ui, sans-serif" }}>
                    <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-6 p-6">
                        <img src="/cam.svg" className="flex-1 min-h-0 invert opacity-20" style={{ maxWidth: '80vw', objectFit: 'contain' }} />
                        <div className="w-full max-w-lg space-y-3 rounded-2xl border border-white/10 bg-white/[0.035] p-4 backdrop-blur-sm">
                            <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-3">
                                <input
                                    type="checkbox"
                                    checked={settings.analysis.faceAnalyticsEnabled}
                                    onChange={event => updateAnalysis({ faceAnalyticsEnabled: event.target.checked })}
                                    className="mt-0.5 h-4 w-4 accent-[#e94560]"
                                />
                                <div className="space-y-1">
                                    <div className="text-sm font-medium text-white/80">Enable face analytics</div>
                                    <p className="text-xs leading-relaxed text-white/38">
                                        Downloads on-device face detection and recognition weights when needed for people clustering and similar-face search.
                                    </p>
                                </div>
                            </label>

                            <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-3">
                                <input
                                    type="checkbox"
                                    checked={settings.analysis.semanticSearchEnabled}
                                    onChange={event => updateAnalysis({ semanticSearchEnabled: event.target.checked })}
                                    className="mt-0.5 h-4 w-4 accent-[#e94560]"
                                />
                                <div className="space-y-1">
                                    <div className="text-sm font-medium text-white/80">Enable semantic search</div>
                                    <p className="text-xs leading-relaxed text-white/38">
                                        Downloads the multimodal search model when you search by meaning instead of exact words.
                                    </p>
                                </div>
                            </label>
                        </div>
                        <button
                            onClick={gallery.folder.openFolder}
                            className="px-5 py-2.5 rounded-lg bg-[#e94560] text-white text-sm font-medium hover:bg-[#d13354] transition-colors"
                        >
                            {intakePlan.actionLabel}
                        </button>

                        <div className="flex items-center gap-3 w-full max-w-lg">
                            <div className="flex-1 h-px bg-white/10" />
                            <span className="text-xs text-white/30">or</span>
                            <div className="flex-1 h-px bg-white/10" />
                        </div>

                        {!showHeadlessConnect ? (
                            <button
                                onClick={() => setShowHeadlessConnect(true)}
                                className="px-5 py-2.5 rounded-lg border border-white/15 text-white/60 text-sm font-medium hover:border-white/25 hover:text-white/80 transition-colors"
                            >
                                Connect to server
                            </button>
                        ) : (
                            <div className="flex gap-2 w-full max-w-lg">
                                <input
                                    type="text"
                                    value={headlessInput}
                                    onChange={e => setHeadlessInput(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter' && headlessInput.trim()) {
                                            setHeadlessUrl(headlessInput.trim().replace(/\/+$/, ''));
                                        }
                                    }}
                                    placeholder="http://192.168.1.100:3000"
                                    className="flex-1 px-3 py-2 rounded-lg border border-white/15 bg-black/30 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-white/30"
                                    autoFocus
                                />
                                <button
                                    onClick={() => {
                                        if (headlessInput.trim()) {
                                            setHeadlessUrl(headlessInput.trim().replace(/\/+$/, ''));
                                        }
                                    }}
                                    disabled={!headlessInput.trim()}
                                    className="px-4 py-2 rounded-lg bg-white/10 text-white/70 text-sm font-medium hover:bg-white/15 hover:text-white/90 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                    Connect
                                </button>
                            </div>
                        )}

                        <p className="max-w-md text-center text-xs text-white/45">
                            {intakePlan.summary}
                        </p>
                    </div>
                    <Impressum />
                </div>
            );
        }

        return (
            <>
                {/* Portrait mobile: column (grid above, sidebar below)
                     Landscape mobile + desktop: row (grid left, sidebar right) */}
                <div className={`h-screen flex ${mobile ? 'flex-col landscape:flex-row' : ''}`}>
                    {/* Main content area */}
                    <div className="flex-1 min-w-0 min-h-0 relative">
                        <div ref={scrollRef} className="h-full overflow-y-auto hide-scrollbar">
                            {showBreadcrumbs ? (
                                <GalleryBreadcrumbs items={breadcrumbItems} summary={breadcrumbSummary} />
                            ) : null}
                            {showClusterGallery ? (
                                <ClusterGallery
                                    clusters={gallery.clusters}
                                    activeClusterId={gallery.activeClusterId}
                                    onSelectCluster={gallery.setActiveClusterId}
                                    getFileUrl={gallery.folder.getFileUrl}
                                    onRenameCluster={handleRenameFace}
                                />
                            ) : (
                                <PhotoGrid
                                    dayGroups={visibleDayGroups}
                                    photos={visiblePhotos}
                                    thumbScale={settings.display.thumbScale}
                                    onPhotoClick={handlePhotoClick}
                                    loading={gallery.loading}
                                    getThumbUrl={gallery.folder.getThumbUrl}
                                    mobile={mobile}
                                    analysisProgress={analysisProgress}
                                />
                            )}
                        </div>
                        {!showClusterGallery && (
                            <TimelineScrubber
                                scrollRef={scrollRef}
                                dayGroups={visibleDayGroups}
                            />
                        )}
                    </div>

                    {/* Sidebar — on mobile: below grid (portrait) or right (landscape) */}
                    <Sidebar
                        tags={gallery.tags}
                        activeTag={gallery.activeTag}
                        onTagClick={gallery.setActiveTag}
                        searchQuery={gallery.searchQuery}
                        onSearchChange={gallery.setSearchQuery}
                        browseSummary={gallery.galleryMode === 'clusters'
                            ? gallery.activeCluster
                                ? `${gallery.clusterPhotos.length} photos in ${gallery.activeCluster.label}`
                                : `${gallery.clusters.length} clusters`
                            : `${gallery.totalCount} photos` + (totalDetectedFaces > 0 ? ` · ${totalDetectedFaces} faces` : '')}
                        settings={settings}
                        onUpdateStorage={updateStorage}
                        onUpdateDisplay={updateDisplay}
                        onUpdateDeviceName={updateDeviceName}
                        onUpdateAnalysis={updateAnalysis}
                        historyEnabled={breadcrumbHistory.enabled}
                        historyReady={breadcrumbHistory.ready}
                        historyCurrentEventId={breadcrumbHistory.currentEventId}
                        historyBranchTree={breadcrumbHistory.branchTree}
                        historyVisibleEntryCount={breadcrumbHistory.visibleEntryCount}
                        historyBranchCount={breadcrumbHistory.branchCount}
                        onHistoryEnabledChange={breadcrumbHistory.setEnabled}
                        onHistoryNavigate={breadcrumbHistory.navigateTo}
                        onHistoryDelete={breadcrumbHistory.deleteEntry}
                        currentFolderName={gallery.folder.folderName}
                        folderName={gallery.folder.folderName}
                        onOpenFolder={gallery.folder.openFolder}
                        onRescan={gallery.folder.rescan}
                        onReanalyze={canReanalyze ? gallery.folder.reanalyzeFaces : undefined}
                        faceSearchActive={gallery.searchFace !== null}
                        onClearFaceSearch={() => gallery.setSearchFace(null)}
                        fotosModel={fotosModel}
                        mobile={mobile}
                        footerMarquee={configMarquee}
                        analysisProgress={analysisProgress}
                        galleryMode={gallery.galleryMode}
                        onGalleryModeChange={gallery.setGalleryMode}
                        clusters={gallery.clusters}
                        people={gallery.people}
                        groups={gallery.groups}
                        similarFaces={gallery.similarFaces}
                        searchClusters={gallery.searchClusters}
                        activeClusterId={gallery.activeClusterId}
                        onClusterSelect={gallery.setActiveClusterId}
                        getFileUrl={gallery.folder.getFileUrl}
                        onAssociateFaceWithCluster={handleAssociateFaceWithCluster}
                        onMergeFaceClusters={handleMergeFaceClusters}
                        onGroupFaceClustersAsPerson={handleGroupFaceClustersAsPerson}
                        onSeparatePersonGroup={handleSeparatePersonGroup}
                        onOpenSimilarFace={handleOpenSimilarFace}
                        onDeletePhoto={handleDelete}
                        onRenameFace={handleRenameFace}
                        onDeleteFace={handleDeleteFace}
                    />
                </div>

                {!showClusterGallery && gallery.selectedIndex !== null && (
                    <Lightbox
                        photos={visiblePhotos}
                        index={gallery.selectedIndex}
                        onIndexChange={(index) => openPhotoRouteIndex(index, { replace: true })}
                        onClose={() => closePhotoRoute({ replace: true })}
                        onDelete={handleDelete}
                        onFaceSearch={handleFaceSearch}
                        onRenameFace={handleRenameFace}
                        onDeleteFace={handleDeleteFace}
                        getFileUrl={gallery.folder.getFileUrl}
                    />
                )}
            </>
        );
    })();

    return (
        <>
            {appContent}
            <UpdatePrompt />
        </>
    );
}
