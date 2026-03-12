import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Impressum } from '@/components/Impressum';
import { GalleryBreadcrumbs } from '@/components/GalleryBreadcrumbs';
import { PhotoGrid } from '@/components/PhotoGrid';
import { Lightbox } from '@/components/Lightbox';
import { Sidebar } from '@/components/Sidebar';
import { TimelineScrubber } from '@/components/TimelineScrubber';
import { ClusterGallery } from '@/components/ClusterGallery';
import { useGallery } from '@/hooks/useGallery';
import { useBreadcrumbHistory } from '@/hooks/useBreadcrumbHistory';
import { useSettings } from '@/hooks/useSettings';
import { shareFile } from '@/lib/platform';
import { UpdatePrompt } from '@/components/UpdatePrompt';
import type { FotosModel } from './lib/onecore-boot';
import { setModelUpdater } from './lib/onecore-boot';
import { traceHang } from './lib/hangTrace';
import type { SimilarFaceMatch } from '@/lib/cluster-gallery';
import { isSnapshotEqual, type FotosBreadcrumbSnapshot } from '@/lib/fotosHistorySettings';

interface AppProps {
    fotosModel?: FotosModel;
}

export function App({ fotosModel: initialModel }: AppProps) {
    const [fotosModel, setFotosModel] = useState<FotosModel | null>(initialModel ?? null);

    // Wire up model updater so async state changes (e.g. headlessConnected) trigger re-renders
    useEffect(() => {
        setModelUpdater(setFotosModel);
        return () => setModelUpdater(null);
    }, []);
    const { settings, updateStorage, updateDisplay, updateDeviceName, updateAnalysis } = useSettings(fotosModel);
    const gallery = useGallery({
        faceAnalyticsEnabled: settings.analysis.faceAnalyticsEnabled,
        semanticSearchEnabled: settings.analysis.semanticSearchEnabled,
        clusterSensitivity: settings.analysis.clusterSensitivity,
    });
    const scrollRef = useRef<HTMLDivElement>(null);

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

    const handleDelete = useCallback((hash: string) => {
        gallery.deletePhoto(hash);
        if (gallery.selectedIndex !== null) {
            const remaining = visiblePhotos.length - 1;
            if (remaining <= 0) {
                gallery.setSelectedIndex(null);
            } else if (gallery.selectedIndex >= remaining) {
                gallery.setSelectedIndex(remaining - 1);
            }
        }
    }, [gallery, visiblePhotos.length]);

    const [selectedClusterAvatarKey, setSelectedClusterAvatarKey] = useState<string | null>(null);

    const handleFaceSearch = useCallback((embedding: Float32Array) => {
        gallery.setSelectedIndex(null);
        gallery.setGalleryMode('images');
        gallery.setActiveClusterId(null);
        gallery.setSearchFace(embedding);
    }, [gallery]);

    useEffect(() => {
        if (!gallery.searchFace || gallery.similarFaces.length === 0) {
            setSelectedClusterAvatarKey(null);
            return;
        }

        setSelectedClusterAvatarKey(prev => {
            if (prev && gallery.similarFaces.some(match => `${match.photo.hash}:${match.faceIndex}` === prev)) {
                return prev;
            }

            const first = gallery.similarFaces[0];
            return `${first.photo.hash}:${first.faceIndex}`;
        });
    }, [gallery.searchFace, gallery.similarFaces]);

    const mobile = gallery.folder.mobile;
    const intakePlan = gallery.folder.defaultIntakePlan;
    const canRunFaceAnalytics = settings.analysis.faceAnalyticsEnabled
        && intakePlan.faceEnrichment === 'local';

    // On mobile, tap a photo → share via native share sheet (opens in photo app)
    const handlePhotoClick = useCallback(async (index: number) => {
        traceHang('photo-click', {
            index,
            hash: visiblePhotos[index]?.hash,
            mobile,
        });
        if (!mobile) {
            gallery.setSelectedIndex(index);
            return;
        }
        const photo = visiblePhotos[index];
        if (!photo.sourcePath) return;
        try {
            const file = await gallery.folder.readFile(photo.sourcePath);
            const shared = await shareFile(file);
            if (!shared) {
                traceHang('photo-click-fallback-lightbox', { index, hash: photo.hash });
                gallery.setSelectedIndex(index);
            }
        } catch {
            // Share API unavailable — fall back to lightbox
            traceHang('photo-click-share-error', { index, hash: photo.hash });
            gallery.setSelectedIndex(index);
        }
    }, [mobile, gallery, visiblePhotos]);

    const progress = gallery.folder.ingestProgress;
    const totalDetectedFaces = gallery.folder.entries.reduce(
        (count, photo) => count + (photo.faces?.count ?? 0),
        0,
    );
    const analysisProgress = progress
        && visiblePhotos.length > 0
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

        gallery.setSelectedIndex(null);
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
        const idx = gallery.photos.findIndex(photo => photo.hash === match.photo.hash);
        if (idx >= 0) {
            gallery.setSelectedIndex(idx);
        }
    }, [gallery]);

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
                        />
                    ) : (
                        <PhotoGrid
                            dayGroups={visibleDayGroups}
                            photos={visiblePhotos}
                            thumbScale={mobile ? 100 : settings.display.thumbScale}
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
                onReanalyze={canRunFaceAnalytics ? gallery.folder.reanalyzeFaces : undefined}
                faceSearchActive={gallery.searchFace !== null}
                onClearFaceSearch={() => gallery.setSearchFace(null)}
                fotosModel={fotosModel}
                mobile={mobile}
                footerMarquee={configMarquee}
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
                selectedClusterAvatarKey={selectedClusterAvatarKey}
                onSelectClusterAvatar={setSelectedClusterAvatarKey}
                onOpenSimilarFace={handleOpenSimilarFace}
                onDeletePhoto={handleDelete}
                onEditFace={clusterId => {
                    const name = prompt('Name this face:');
                    if (name) {
                        void gallery.folder.renameFace(clusterId, name);
                    }
                }}
                onDeleteFace={clusterId => {
                    void gallery.folder.deleteFace(clusterId);
                }}
            />
        </div>

        {!showClusterGallery && gallery.selectedIndex !== null && (
            <Lightbox
                photos={visiblePhotos}
                index={gallery.selectedIndex}
                onIndexChange={gallery.setSelectedIndex}
                onClose={() => gallery.setSelectedIndex(null)}
                onDelete={handleDelete}
                onFaceSearch={handleFaceSearch}
                onEditFace={clusterId => {
                    const name = prompt('Name this face:');
                    if (name) {
                        void gallery.folder.renameFace(clusterId, name);
                    }
                }}
                onDeleteFace={clusterId => {
                    void gallery.folder.deleteFace(clusterId);
                }}
                getFileUrl={gallery.folder.getFileUrl}
            />
        )}
        <UpdatePrompt />
        </>
    );
}
