import {useEffect, useState, type ReactNode} from 'react';
import type {DayGroup} from '../lib/gallery.js';
import {getFaceCount, type PhotoEntry} from '../types/fotos.js';

export interface PhotoGridProps<TPhoto extends PhotoEntry = PhotoEntry> {
    dayGroups: Array<DayGroup<TPhoto>>;
    photos: TPhoto[];
    thumbScale: number;
    onPhotoClick: (index: number) => void;
    loading?: boolean;
    getThumbUrl: (entry: TPhoto) => Promise<string | null>;
    mobile?: boolean;
    analysisProgress?: {
        phase?: string;
        current: number;
        total: number;
        fileName?: string;
        statusLabel?: string;
    } | null;
    loadingLabel?: ReactNode;
    emptyTitle?: ReactNode;
    emptyHint?: ReactNode;
}

/** Generate a deterministic color from a hash string. */
function hashColor(hash: string): string {
    let h = 0;
    for (let i = 0; i < hash.length; i++) {
        h = (h * 31 + hash.charCodeAt(i)) & 0xffffff;
    }

    return `hsl(${h % 360}, 25%, 20%)`;
}

/** Format YYYY-MM-DD as readable date. */
function formatDate(date: string): string {
    const day = new Date(date + 'T00:00:00');
    const now = new Date();
    const diff = Math.floor((now.getTime() - day.getTime()) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return day.toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: day.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
}

export function PhotoGrid<TPhoto extends PhotoEntry = PhotoEntry>({
    dayGroups,
    photos,
    thumbScale,
    onPhotoClick,
    loading,
    getThumbUrl,
    mobile,
    analysisProgress,
    loadingLabel = 'Scanning gallery...',
    emptyTitle = 'No photos found',
    emptyHint = (
        <>
            Run <code className="px-1 py-0.5 bg-white/10 rounded">fotos ingest</code> on your folder first
        </>
    ),
}: PhotoGridProps<TPhoto>) {
    if (loading) {
        return (
            <div className="flex items-center justify-center h-full text-white/20 text-sm">
                {loadingLabel}
            </div>
        );
    }

    if (photos.length === 0) {
        return (
            <div className="flex items-center justify-center h-full text-white/30">
                <div className="text-center">
                    <p className="text-lg mb-2">{emptyTitle}</p>
                    <p className="text-sm">{emptyHint}</p>
                </div>
            </div>
        );
    }

    const colStyle = `repeat(auto-fill, minmax(${thumbScale}px, 1fr))`;
    const progressLabel = (() => {
        switch (analysisProgress?.phase) {
            case 'preparing-faces':
            case 'faces':
                return 'Face analytics';
            case 'preparing-semantic':
            case 'semantic':
                return 'Semantic indexing';
            default:
                return 'Analysis';
        }
    })();
    const progressPercent = analysisProgress && analysisProgress.total > 0
        ? Math.max(0, Math.min(100, Math.round((analysisProgress.current / analysisProgress.total) * 100)))
        : 0;
    let flatIndex = 0;

    return (
        <div>
            {analysisProgress && analysisProgress.total > 0 && (
                <div className="sticky top-0 z-20 px-3 py-1 bg-black/80 backdrop-blur-sm flex items-center gap-2">
                    <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
                        <div
                            className="h-full rounded-full bg-[#e94560]/70 transition-all duration-500"
                            style={{width: `${progressPercent}%`}}
                        />
                    </div>
                    <span className="text-[10px] text-white/40 whitespace-nowrap">
                        {progressLabel} {analysisProgress.current}/{analysisProgress.total}
                    </span>
                    {(analysisProgress?.statusLabel || analysisProgress?.fileName) && (
                        <span className="max-w-[24ch] truncate text-[10px] text-white/25">
                            {analysisProgress?.statusLabel ?? analysisProgress?.fileName}
                        </span>
                    )}
                </div>
            )}
            {dayGroups.map(group => {
                const startIndex = flatIndex;
                flatIndex += group.photos.length;
                return (
                    <section key={group.date} data-date={group.date}>
                        <div className="sticky top-0 z-10 px-3 py-1.5 bg-black/70 backdrop-blur-sm">
                            <span className="text-[11px] text-white/50 font-medium">{formatDate(group.date)}</span>
                            <span className="text-[10px] text-white/20 ml-2">{group.photos.length}</span>
                        </div>
                        <div className="grid gap-1 px-1 pb-1" style={{gridTemplateColumns: colStyle}}>
                            {group.photos.map((photo, index) => (
                                <PhotoCard
                                    key={photo.hash}
                                    photo={photo}
                                    onClick={() => onPhotoClick(startIndex + index)}
                                    getThumbUrl={getThumbUrl}
                                />
                            ))}
                        </div>
                    </section>
                );
            })}
        </div>
    );
}

function PhotoCard<TPhoto extends PhotoEntry = PhotoEntry>({
    photo,
    onClick,
    getThumbUrl,
}: {
    photo: TPhoto;
    onClick: () => void;
    getThumbUrl: (entry: TPhoto) => Promise<string | null>;
}) {
    const [thumbSrc, setThumbSrc] = useState<string | null>(null);
    const [loaded, setLoaded] = useState(false);
    const faceCount = getFaceCount(photo.faces);

    useEffect(() => {
        let cancelled = false;
        void getThumbUrl(photo).then(url => {
            if (!cancelled && url) {
                setThumbSrc(url);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [photo, getThumbUrl]);

    return (
        <button
            type="button"
            onClick={onClick}
            className="group relative aspect-square overflow-hidden cursor-pointer touch-manipulation appearance-none border-0 p-0 text-left"
            style={{background: hashColor(photo.hash)}}
        >
            {thumbSrc && (
                <img
                    src={thumbSrc}
                    alt={photo.name}
                    loading="lazy"
                    onLoad={() => setLoaded(true)}
                    className={`w-full h-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
                />
            )}

            {photo.faces === undefined && (
                <div className="absolute top-1.5 left-1.5 w-2 h-2 rounded-full bg-white/20 animate-pulse" />
            )}

            {faceCount > 0 && (
                <div className="absolute top-1.5 right-1.5 rounded-full border border-white/15 bg-[#e94560]/85 px-2 py-0.5 text-[10px] font-medium text-white shadow-[0_6px_18px_rgba(233,69,96,0.35)] backdrop-blur-sm">
                    {faceCount} {faceCount === 1 ? 'face' : 'faces'}
                </div>
            )}

            <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                <p className="text-xs truncate text-white/90">{photo.name}</p>
            </div>
        </button>
    );
}
