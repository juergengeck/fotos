import { useCallback, useRef } from 'react';
import { useFotosGalleryState } from '@refinio/fotos.ui';
import type { DisplaySettings, FotosSettings, GalleryAccessSource } from '@refinio/fotos.ui';
import { PhotoGrid } from '@/components/PhotoGrid';
import { Lightbox } from '@/components/Lightbox';
import { Sidebar } from '@/components/Sidebar';
import { TimelineScrubber } from '@/components/TimelineScrubber';
import type { PhotoEntry } from '@/types/fotos';
import type { IngestStatus } from '@/hooks/useServerAccess';

export interface FotosViewerProgress {
    phase: 'scanning' | 'processing' | 'writing' | 'done';
    current: number;
    total: number;
    fileName?: string;
}

export interface FotosViewerSource extends GalleryAccessSource<PhotoEntry> {
    isOpen: boolean;
    ingestProgress: FotosViewerProgress | null;
    ingestStatus: IngestStatus | null;
    openFolder?: () => Promise<void>;
    startIngest?: () => Promise<void>;
    pauseIngest?: () => Promise<void>;
    resumeIngest?: () => Promise<void>;
    getFileUrl: (relativePath: string) => Promise<string>;
    getThumbUrl: (entry: PhotoEntry) => Promise<string | null>;
}

export interface FotosViewerSettingsController {
    settings: FotosSettings;
    updateStorage: (updates: Partial<FotosSettings['storage']>) => void;
    updateDisplay: (updates: Partial<DisplaySettings>) => void;
    updateDeviceName: (name: string) => void;
}

export interface FotosViewerProps {
    source: FotosViewerSource;
    settingsController: FotosViewerSettingsController;
    appTitle?: string;
    loadingLabel?: string;
    emptyStateLabel?: string;
}

export function FotosViewer({
    source,
    settingsController,
    appTitle = 'fotos.one',
    loadingLabel = 'connecting to source...',
    emptyStateLabel = 'no photos found',
}: FotosViewerProps) {
    const gallery = useFotosGalleryState<PhotoEntry>({ source });
    const { settings, updateStorage, updateDisplay, updateDeviceName } = settingsController;
    const scrollRef = useRef<HTMLDivElement>(null);

    const handleDelete = useCallback((hash: string) => {
        gallery.deletePhoto(hash);
        if (gallery.selectedIndex !== null) {
            const remaining = gallery.photos.length - 1;
            if (remaining <= 0) {
                gallery.setSelectedIndex(null);
            } else if (gallery.selectedIndex >= remaining) {
                gallery.setSelectedIndex(remaining - 1);
            }
        }
    }, [gallery]);

    const handleFaceSearch = useCallback((embedding: Float32Array) => {
        gallery.setSearchFace(embedding);
        gallery.setSelectedIndex(null);
    }, [gallery]);

    // ── Ingestion progress screen ─────────────────────────────────────
    const status = source.ingestStatus;
    if (status && (status.state === 'running' || status.state === 'paused')) {
        const folderPct = status.totalFolders > 0
            ? (status.folderIndex / status.totalFolders) * 100
            : 0;
        const photoPct = status.photosInFolder > 0
            ? (status.photoIndex / status.photosInFolder) * 100
            : 0;

        return (
            <div className="h-screen flex flex-col items-center justify-center bg-[#111] text-white/70"
                 style={{ fontFamily: "'Figtree', system-ui, sans-serif" }}>
                <div className="w-80 space-y-6">
                    <h2 className="text-lg font-medium text-white text-center">
                        {status.state === 'paused' ? 'Paused' : 'Ingesting photos...'}
                    </h2>

                    {/* Folder progress */}
                    <div>
                        <div className="flex justify-between text-xs text-white/40 mb-1">
                            <span className="truncate mr-2">{status.currentFolder || '...'}</span>
                            <span className="shrink-0">Folder {status.folderIndex + 1} of {status.totalFolders}</span>
                        </div>
                        <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                            <div className="h-full bg-[#e94560] transition-all" style={{ width: `${folderPct}%` }} />
                        </div>
                    </div>

                    {/* Photo progress within folder */}
                    <div>
                        <div className="flex justify-between text-xs text-white/40 mb-1">
                            <span>Photos in folder</span>
                            <span>{status.photoIndex} / {status.photosInFolder}</span>
                        </div>
                        <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                            <div className="h-full bg-[#e94560] transition-all" style={{ width: `${photoPct}%` }} />
                        </div>
                    </div>

                    {/* Overall */}
                    <p className="text-xs text-white/30 text-center">
                        {status.totalProcessed} of {status.totalFound} photos processed
                    </p>

                    {/* Pause / Resume button */}
                    <button
                        onClick={status.state === 'running' ? source.pauseIngest : source.resumeIngest}
                        className="w-full py-2 rounded bg-white/10 hover:bg-white/20 text-sm text-white/70 transition-colors"
                    >
                        {status.state === 'running' ? 'Pause' : 'Resume'}
                    </button>
                </div>
            </div>
        );
    }

    // ── Legacy ingest progress (browser-side) ─────────────────────────
    const progress = source.ingestProgress;
    if (progress) {
        return (
            <div className="h-screen flex flex-col items-center justify-center bg-[#111] text-white/70"
                 style={{ fontFamily: "'Figtree', system-ui, sans-serif" }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', minWidth: 280 }}>
                    <div style={{ width: '100%', height: 6, borderRadius: 3, background: '#333', overflow: 'hidden' }}>
                        <div style={{
                            height: '100%', borderRadius: 3, background: '#e94560',
                            width: progress.total > 0 ? `${Math.round((progress.current / progress.total) * 100)}%` : '0%',
                            transition: 'width 0.3s ease',
                        }} />
                    </div>
                    <p style={{ fontSize: '0.85rem' }}>
                        {progress.phase === 'scanning' && 'Scanning for images...'}
                        {progress.phase === 'processing' && `Processing ${progress.current}/${progress.total}${progress.fileName ? ` — ${progress.fileName}` : ''}`}
                        {progress.phase === 'writing' && 'Writing metadata...'}
                        {progress.phase === 'done' && `Done — ${progress.total} images ingested`}
                    </p>
                </div>
            </div>
        );
    }

    // ── Loading ───────────────────────────────────────────────────────
    if (gallery.loading && !source.isOpen) {
        return (
            <div className="h-screen flex flex-col items-center justify-center bg-[#111] text-white/70"
                 style={{ fontFamily: "'Figtree', system-ui, sans-serif" }}>
                <p className="text-sm text-white/40">{loadingLabel}</p>
            </div>
        );
    }

    // ── Empty state with Start Ingestion button ──────────────────────
    if (!source.isOpen) {
        return (
            <div className="h-screen flex flex-col items-center justify-center bg-[#111] text-white/70"
                 style={{ fontFamily: "'Figtree', system-ui, sans-serif" }}>
                <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem' }}>
                    <h1 style={{ fontFamily: "'Outfit', system-ui, sans-serif", fontWeight: 800, fontSize: 'clamp(2rem, 5vw, 3rem)', letterSpacing: '-0.03em' }}>
                        {appTitle.split('.').map((part, index, parts) => (
                            <span key={`${part}-${index}`}>
                                {part}
                                {index < parts.length - 1 && <span style={{ color: '#e94560' }}>.</span>}
                            </span>
                        ))}
                    </h1>
                    <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.9rem' }}>
                        {emptyStateLabel}
                    </p>
                    {source.startIngest && (
                        <button
                            onClick={source.startIngest}
                            className="px-6 py-2 rounded bg-[#e94560] hover:bg-[#d63850] text-white text-sm font-medium transition-colors"
                        >
                            Start Ingestion
                        </button>
                    )}
                </div>
            </div>
        );
    }

    // ── Gallery ──────────────────────────────────────────────────────
    return (
        <>
            <div className="h-screen flex">
                <div className="flex-1 min-w-0 relative">
                    <div ref={scrollRef} className="h-full overflow-y-auto">
                        <PhotoGrid
                            dayGroups={gallery.dayGroups}
                            photos={gallery.photos}
                            thumbScale={settings.display.thumbScale}
                            onPhotoClick={gallery.setSelectedIndex}
                            loading={gallery.loading}
                            getThumbUrl={source.getThumbUrl}
                        />
                    </div>
                    <TimelineScrubber
                        scrollRef={scrollRef}
                        dayGroups={gallery.dayGroups}
                    />
                </div>

                <Sidebar
                    tags={gallery.tags}
                    activeTag={gallery.activeTag}
                    onTagClick={gallery.setActiveTag}
                    searchQuery={gallery.searchQuery}
                    onSearchChange={gallery.setSearchQuery}
                    photoCount={gallery.photos.length}
                    totalCount={gallery.totalCount}
                    settings={settings}
                    onUpdateStorage={updateStorage}
                    onUpdateDisplay={updateDisplay}
                    onUpdateDeviceName={updateDeviceName}
                    folderName={source.folderName}
                    onOpenFolder={source.openFolder}
                    onRescan={() => { void source.rescan(); }}
                    faceSearchActive={gallery.searchFace !== null}
                    onClearFaceSearch={() => gallery.setSearchFace(null)}
                />
            </div>

            {gallery.selectedIndex !== null && (
                <Lightbox
                    photos={gallery.photos}
                    index={gallery.selectedIndex}
                    onIndexChange={gallery.setSelectedIndex}
                    onClose={() => gallery.setSelectedIndex(null)}
                    onDelete={handleDelete}
                    onFaceSearch={handleFaceSearch}
                    getFileUrl={source.getFileUrl}
                />
            )}
        </>
    );
}
