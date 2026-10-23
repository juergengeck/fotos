import {useEffect, useRef, useState, type RefObject} from 'react';
import {Image, Maximize2, Minimize2} from 'lucide-react';
import {getMediaPlaybackKind} from '@refinio/media.core/media-types';
import type {PhotoEntry} from '@/types/fotos';

interface FullscreenGalleryProps {
    dayGroups: Array<{date: string; photos: PhotoEntry[]}>;
    scrollRef: RefObject<HTMLElement | null>;
    getThumbUrl: (photo: PhotoEntry) => Promise<string | null>;
    getFileUrl: (path: string) => Promise<string>;
    onPhotoClick: (index: number) => void;
}

/** Glue's immersive stream: full-width, uncropped media without grid gutters. */
export function FullscreenGallery({dayGroups, scrollRef, getThumbUrl, getFileUrl, onPhotoClick}: FullscreenGalleryProps) {
    let flatIndex = 0;
    return (
        <main data-fullscreen-gallery="true" aria-label="Fullscreen images">
            {dayGroups.map(group => {
                const startIndex = flatIndex;
                flatIndex += group.photos.length;
                return (
                    <section key={group.date} data-gallery-day={group.date} data-date={group.date}>
                        {group.photos.map((photo, index) => (
                            <FullscreenPhoto
                                key={photo.hash}
                                photo={photo}
                                index={startIndex + index}
                                scrollRef={scrollRef}
                                getThumbUrl={getThumbUrl}
                                getFileUrl={getFileUrl}
                                onOpen={() => onPhotoClick(startIndex + index)}
                            />
                        ))}
                    </section>
                );
            })}
        </main>
    );
}

function FullscreenPhoto({photo, index, scrollRef, getThumbUrl, getFileUrl, onOpen}: {
    photo: PhotoEntry;
    index: number;
    scrollRef: RefObject<HTMLElement | null>;
    getThumbUrl: FullscreenGalleryProps['getThumbUrl'];
    getFileUrl: FullscreenGalleryProps['getFileUrl'];
    onOpen: () => void;
}) {
    const cardRef = useRef<HTMLButtonElement>(null);
    const [src, setSrc] = useState<string | null>(null);
    const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
    const [failedSrc, setFailedSrc] = useState<string | null>(null);
    const loaded = src !== null && loadedSrc === src;
    const failed = src !== null && failedSrc === src;
    const mediaKind = getMediaPlaybackKind(photo.name, photo.mimeType);

    useEffect(() => {
        let cancelled = false;
        let originalRequested = false;
        let originalResolved = false;
        setSrc(null);
        void getThumbUrl(photo).then(url => {
            if (!cancelled && !originalResolved && url) setSrc(url);
        }).catch(() => {});

        // Fetch originals only near the viewport; large libraries stay scrollable
        // without opening every source file when the stream first mounts.
        const loadOriginal = () => {
            if (originalRequested || mediaKind === 'video' || !photo.sourcePath) return;
            originalRequested = true;
            void getFileUrl(photo.sourcePath).then(url => {
                if (cancelled) return;
                originalResolved = true;
                setSrc(url);
            }).catch(() => {});
        };
        const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
            if (!entries.some(entry => entry.isIntersecting)) return;
            loadOriginal();
            observer?.disconnect();
        }, {root: scrollRef.current, rootMargin: '100% 0px'});
        if (observer && cardRef.current) observer.observe(cardRef.current);
        else loadOriginal();
        return () => {
            cancelled = true;
            observer?.disconnect();
        };
    }, [getFileUrl, getThumbUrl, mediaKind, photo, scrollRef]);

    const width = photo.exif?.width;
    const height = photo.exif?.height;
    return (
        <button
            ref={cardRef}
            type="button"
            data-photo-index={index}
            onClick={onOpen}
            aria-label={`Open ${photo.name}`}
            title={photo.name}
            className="relative block w-full cursor-zoom-in overflow-hidden border-0 bg-[#151515] p-0 text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#e94560]"
            style={{aspectRatio: !loaded || failed ? width && height ? `${width} / ${height}` : '1 / 1' : undefined}}
        >
            {src && !failed && (
                <img
                    key={src}
                    src={src}
                    alt={photo.name}
                    loading="lazy"
                    onLoad={() => setLoadedSrc(src)}
                    onError={() => setFailedSrc(src)}
                    className={`block h-auto w-full object-contain transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
                />
            )}
            {(!src || !loaded || failed) && (
                <span className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white/55">
                    {photo.name}
                </span>
            )}
        </button>
    );
}

export function GallerySurfaceSwitcher({fullscreen, onChange}: {fullscreen: boolean; onChange: (fullscreen: boolean) => void}) {
    return (
        <div role="group" aria-label="Gallery view" className="inline-flex items-center gap-0.5 rounded-full border border-white/15 bg-black/70 p-0.5 shadow-lg backdrop-blur-sm">
            <button type="button" aria-label="Show images" aria-pressed={!fullscreen} title="Show images" onClick={() => onChange(false)} className={`flex h-10 w-10 items-center justify-center rounded-full ${!fullscreen ? 'bg-white/10 text-[#ff9db0]' : 'text-white/60 hover:text-white'}`}>
                <Image aria-hidden="true" size={17} />
            </button>
            <button type="button" aria-label="Show images fullscreen" aria-pressed={fullscreen} title="Show images fullscreen" onClick={() => onChange(true)} className={`flex h-10 w-10 items-center justify-center rounded-full ${fullscreen ? 'bg-white/10 text-[#ff9db0]' : 'text-white/60 hover:text-white'}`}>
                <Maximize2 aria-hidden="true" size={17} />
            </button>
        </div>
    );
}

export function FullscreenGalleryExit({onExit}: {onExit: () => void}) {
    return (
        <button type="button" autoFocus onClick={onExit} aria-label="Exit fullscreen images" title="Exit fullscreen images (Escape)" className="absolute right-3 top-3 z-40 flex h-11 w-11 items-center justify-center rounded-full border border-white/30 bg-black/60 text-white shadow-lg backdrop-blur-sm" style={{top: 'calc(12px + env(safe-area-inset-top, 0px))', right: 'calc(12px + env(safe-area-inset-right, 0px))'}}>
            <Minimize2 aria-hidden="true" size={19} />
        </button>
    );
}
