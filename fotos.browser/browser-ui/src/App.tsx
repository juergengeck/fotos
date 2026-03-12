import { useCallback, useEffect, useRef, useState } from 'react';
import { Impressum } from '@/components/Impressum';
import { PhotoGrid } from '@/components/PhotoGrid';
import { Lightbox } from '@/components/Lightbox';
import { Sidebar } from '@/components/Sidebar';
import { TimelineScrubber } from '@/components/TimelineScrubber';
import { ClusterGallery } from '@/components/ClusterGallery';
import { useGallery } from '@/hooks/useGallery';
import { useSettings } from '@/hooks/useSettings';
import { shareFile } from '@/lib/platform';
import { UpdatePrompt } from '@/components/UpdatePrompt';
import type { FotosModel } from './lib/onecore-boot';
import { setModelUpdater } from './lib/onecore-boot';
import { traceHang } from './lib/hangTrace';
import type { SimilarFaceMatch } from '@/lib/cluster-gallery';

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
        && (progress.phase === 'faces' || progress.phase === 'preparing-faces')
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
        return null;
    })();

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
                    {gallery.galleryMode === 'clusters' && gallery.activeCluster && (
                        <button
                            onClick={() => gallery.setActiveClusterId(null)}
                            className="sticky top-0 z-20 w-full flex items-center gap-2 px-3 py-1.5 bg-[#e94560]/12 backdrop-blur-sm text-[11px] text-[#ff9db0] hover:text-white transition-colors"
                        >
                            <span>&larr;</span>
                            <span>{gallery.activeCluster.label}</span>
                            <span className="text-white/35 ml-auto">{gallery.clusterPhotos.length} photos</span>
                        </button>
                    )}
                    {gallery.searchFace !== null && gallery.galleryMode === 'images' && (
                        <button
                            onClick={() => gallery.setSearchFace(null)}
                            className="sticky top-0 z-20 w-full flex items-center gap-2 px-3 py-1.5 bg-blue-500/15 backdrop-blur-sm text-[11px] text-blue-300/80 hover:text-blue-200 transition-colors"
                        >
                            <span>&larr;</span>
                            <span>Showing similar faces</span>
                            <span className="text-blue-300/40 ml-auto">click to clear</span>
                        </button>
                    )}
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
                folderName={gallery.folder.folderName}
                onOpenFolder={gallery.folder.openFolder}
                onRescan={gallery.folder.rescan}
                onReanalyze={gallery.folder.reanalyzeFaces}
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
