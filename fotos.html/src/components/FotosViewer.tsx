import { useCallback, useRef } from 'react';
import { useFotosGalleryState } from '@refinio/fotos.ui';
import type { DisplaySettings, FotosSettings, GalleryAccessSource } from '@refinio/fotos.ui';
import { PhotoGrid } from '@/components/PhotoGrid';
import { Lightbox } from '@/components/Lightbox';
import { Sidebar } from '@/components/Sidebar';
import { TimelineScrubber } from '@/components/TimelineScrubber';
import type { PhotoEntry } from '@/types/fotos';
import type { FolderMetadata, IngestStatus } from '@/hooks/useServerAccess';

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
    currentFolder: string;
    folderChildren: FolderMetadata[];
    openFolder?: () => Promise<void>;
    startIngest?: () => Promise<void>;
    pauseIngest?: () => Promise<void>;
    resumeIngest?: () => Promise<void>;
    navigateToFolder: (path: string) => void;
    navigateUp: () => void;
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

// ── Helper: format date range for folder cards ────────────────────────

function formatDateRange(start?: string, end?: string): string | null {
    if (!start) return null;
    const fmt = (iso: string) => {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return iso;
        return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    };
    const s = fmt(start);
    const e = end ? fmt(end) : null;
    if (!e || s === e) return s;
    return `${s} \u2013 ${e}`;
}

function formatCount(n: number): string {
    if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
    return String(n);
}

// ── Breadcrumb bar ────────────────────────────────────────────────────

function Breadcrumbs({ currentFolder, onNavigate }: { currentFolder: string; onNavigate: (path: string) => void }) {
    if (currentFolder === '') return null;

    const segments = currentFolder.split('/');
    const crumbs: Array<{ label: string; path: string }> = [
        { label: 'Library', path: '' },
    ];
    for (let i = 0; i < segments.length; i++) {
        crumbs.push({
            label: segments[i],
            path: segments.slice(0, i + 1).join('/'),
        });
    }

    return (
        <div style={{
            padding: '12px 16px',
            fontSize: '0.85rem',
            color: 'rgba(255,255,255,0.5)',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            flexWrap: 'wrap',
        }}>
            {crumbs.map((crumb, i) => (
                <span key={crumb.path} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    {i > 0 && <span style={{ color: 'rgba(255,255,255,0.2)' }}>/</span>}
                    {i < crumbs.length - 1 ? (
                        <button
                            onClick={() => onNavigate(crumb.path)}
                            style={{
                                background: 'none',
                                border: 'none',
                                color: '#e94560',
                                cursor: 'pointer',
                                padding: '2px 4px',
                                borderRadius: '4px',
                                fontSize: 'inherit',
                                fontFamily: 'inherit',
                            }}
                            onMouseEnter={e => { (e.target as HTMLButtonElement).style.background = 'rgba(233,69,96,0.1)'; }}
                            onMouseLeave={e => { (e.target as HTMLButtonElement).style.background = 'none'; }}
                        >
                            {i === 0 ? '\uD83D\uDCF7' : ''} {crumb.label}
                        </button>
                    ) : (
                        <span style={{ color: 'rgba(255,255,255,0.7)', padding: '2px 4px' }}>
                            {crumb.label}
                        </span>
                    )}
                </span>
            ))}
        </div>
    );
}

// ── Folder cards grid ─────────────────────────────────────────────────

function FolderCards({ children, onNavigate }: { children: FolderMetadata[]; onNavigate: (path: string) => void }) {
    if (children.length === 0) return null;

    return (
        <div style={{
            padding: '12px 16px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '12px',
        }}>
            {children.map(child => {
                const dateRange = formatDateRange(child.dateRangeStart, child.dateRangeEnd);
                return (
                    <button
                        key={child.path}
                        onClick={() => onNavigate(child.path)}
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '6px',
                            padding: '14px 16px',
                            background: '#1a1a1a',
                            border: '1px solid rgba(255,255,255,0.06)',
                            borderRadius: '10px',
                            cursor: 'pointer',
                            textAlign: 'left',
                            transition: 'background 0.15s, border-color 0.15s',
                            fontFamily: "'Figtree', system-ui, sans-serif",
                        }}
                        onMouseEnter={e => {
                            (e.currentTarget as HTMLButtonElement).style.background = '#222';
                            (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(233,69,96,0.3)';
                        }}
                        onMouseLeave={e => {
                            (e.currentTarget as HTMLButtonElement).style.background = '#1a1a1a';
                            (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.06)';
                        }}
                    >
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                        }}>
                            <span style={{ fontSize: '1.2rem' }}>{'\uD83D\uDCC1'}</span>
                            <span style={{
                                color: 'rgba(255,255,255,0.9)',
                                fontSize: '0.95rem',
                                fontWeight: 500,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                            }}>
                                {child.name}
                            </span>
                        </div>
                        <div style={{
                            fontSize: '0.8rem',
                            color: 'rgba(255,255,255,0.35)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '2px',
                        }}>
                            <span>{formatCount(child.photoCount)} photos</span>
                            {dateRange && <span>{dateRange}</span>}
                        </div>
                    </button>
                );
            })}
        </div>
    );
}

// ── Main viewer ───────────────────────────────────────────────────────

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

    // ── Empty state: root with no entries and no children → ingestion UI ──
    if (!source.isOpen && source.currentFolder === '') {
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

    // ── Gallery (with folder navigation) ──────────────────────────────
    const hasPhotos = gallery.photos.length > 0;
    const hasFolders = source.folderChildren.length > 0;

    return (
        <>
            <div className="h-screen flex">
                <div className="flex-1 min-w-0 relative">
                    <div ref={scrollRef} className="h-full overflow-y-auto">
                        <Breadcrumbs
                            currentFolder={source.currentFolder}
                            onNavigate={source.navigateToFolder}
                        />
                        {hasFolders && (
                            <FolderCards
                                children={source.folderChildren}
                                onNavigate={source.navigateToFolder}
                            />
                        )}
                        {hasPhotos && (
                            <PhotoGrid
                                dayGroups={gallery.dayGroups}
                                photos={gallery.photos}
                                thumbScale={settings.display.thumbScale}
                                onPhotoClick={gallery.setSelectedIndex}
                                loading={gallery.loading}
                                getThumbUrl={source.getThumbUrl}
                            />
                        )}
                        {!hasPhotos && !hasFolders && source.currentFolder !== '' && (
                            <div style={{
                                padding: '48px 16px',
                                textAlign: 'center',
                                color: 'rgba(255,255,255,0.3)',
                                fontSize: '0.9rem',
                                fontFamily: "'Figtree', system-ui, sans-serif",
                            }}>
                                This folder is empty
                            </div>
                        )}
                    </div>
                    {hasPhotos && (
                        <TimelineScrubber
                            scrollRef={scrollRef}
                            dayGroups={gallery.dayGroups}
                        />
                    )}
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
