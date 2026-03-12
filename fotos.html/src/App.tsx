import { useCallback, useRef } from 'react';
import { PhotoGrid } from '@/components/PhotoGrid';
import { Lightbox } from '@/components/Lightbox';
import { Sidebar } from '@/components/Sidebar';
import { TimelineScrubber } from '@/components/TimelineScrubber';
import { useGallery } from '@/hooks/useGallery';
import { useSettings } from '@/hooks/useSettings';

export function App() {
    const gallery = useGallery();
    const { settings, updateStorage, updateDisplay, updateDeviceName } = useSettings();
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

    const progress = gallery.folder.ingestProgress;

    // Ingestion in progress
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

    // Loading / connecting to server
    if (gallery.loading && !gallery.folder.isOpen) {
        return (
            <div className="h-screen flex flex-col items-center justify-center bg-[#111] text-white/70"
                 style={{ fontFamily: "'Figtree', system-ui, sans-serif" }}>
                <p className="text-sm text-white/40">connecting to server...</p>
            </div>
        );
    }

    // No photos found — offer to ingest
    if (!gallery.folder.isOpen) {
        return (
            <div className="h-screen flex flex-col items-center justify-center bg-[#111] text-white/70 cursor-pointer"
                 onClick={gallery.folder.openFolder}
                 style={{ fontFamily: "'Figtree', system-ui, sans-serif" }}>
                <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem' }}>
                    <h1 style={{ fontFamily: "'Outfit', system-ui, sans-serif", fontWeight: 800, fontSize: 'clamp(2rem, 5vw, 3rem)', letterSpacing: '-0.03em' }}>
                        fotos<span style={{ color: '#e94560' }}>.</span>one
                    </h1>
                    <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.9rem' }}>
                        no photos found on server — tap to ingest
                    </p>
                </div>
            </div>
        );
    }

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
                        getThumbUrl={gallery.folder.getThumbUrl}
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
                folderName={gallery.folder.folderName}
                onRescan={gallery.folder.rescan}
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
                getFileUrl={gallery.folder.getFileUrl}
            />
        )}
        </>
    );
}
