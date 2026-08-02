import {useCallback, useEffect, useRef, useState, type ReactNode} from 'react';
import type {DayGroup} from '../lib/gallery.js';
import {summarizeNamedFaces} from '../lib/faceLabels.js';
import {getFaceCount, type PhotoEntry} from '../types/fotos.js';

export interface PhotoGridProps<TPhoto extends PhotoEntry = PhotoEntry> {
    dayGroups: Array<DayGroup<TPhoto>>;
    photos: TPhoto[];
    thumbScale: number;
    onPhotoClick: (index: number) => void;
    /**
     * @deprecated Selection is now implicit. Kept for backward compatibility;
     * the grid no longer requires a mode to be toggled before selecting.
     */
    selectionMode?: boolean;
    /** True whenever at least one photo is selected. Drives the implicit selecting state. */
    selectionActive?: boolean;
    selectedPhotoHashes?: ReadonlySet<string>;
    onPhotoToggleSelection?: (photo: TPhoto, index: number) => void;
    /** Clear the current selection (wired to Escape while a selection is active). */
    onClearSelection?: () => void;
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
    onPhotoContextMenu?: (photo: TPhoto, index: number, event: React.MouseEvent | React.TouchEvent) => void;
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
    selectionActive = false,
    selectedPhotoHashes,
    onPhotoToggleSelection,
    onClearSelection,
    loading,
    getThumbUrl,
    analysisProgress,
    loadingLabel = 'Scanning gallery...',
    emptyTitle = 'No photos found',
    emptyHint = (
        <>
            Run <code className="px-1 py-0.5 bg-white/10 rounded">fotos ingest</code> on your folder first
        </>
    ),
    onPhotoContextMenu,
}: PhotoGridProps<TPhoto>) {
    const [cursor, setCursor] = useState(-1);
    const gridRef = useRef<HTMLDivElement>(null);

    // Compute how many columns the grid has from the first visible grid element
    const getColumnCount = useCallback(() => {
        const grid = gridRef.current?.querySelector('[data-photo-grid]') as HTMLElement | null;
        if (!grid) return 1;
        return getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    }, []);

    // Keyboard navigation
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            const total = photos.length;
            if (total === 0) return;

            let next = cursor;
            switch (e.key) {
                case 'ArrowRight':
                    next = cursor < 0 ? 0 : Math.min(cursor + 1, total - 1);
                    break;
                case 'ArrowLeft':
                    next = cursor < 0 ? 0 : Math.max(cursor - 1, 0);
                    break;
                case 'ArrowDown': {
                    const cols = getColumnCount();
                    next = cursor < 0 ? 0 : Math.min(cursor + cols, total - 1);
                    break;
                }
                case 'ArrowUp': {
                    const cols = getColumnCount();
                    next = cursor < 0 ? 0 : Math.max(cursor - cols, 0);
                    break;
                }
                case 'Enter':
                    if (cursor >= 0) {
                        e.preventDefault();
                        // Implicit selecting state: once anything is selected, Enter
                        // toggles (mirrors click). Otherwise Enter opens the photo.
                        if (selectionActive && onPhotoToggleSelection) {
                            const photo = photos[cursor];
                            if (photo) {
                                onPhotoToggleSelection(photo, cursor);
                            }
                        } else {
                            onPhotoClick(cursor);
                        }
                    }
                    return;
                case 'x':
                case 'X':
                case ' ':
                    // Toggle selection of the focused photo without entering a mode.
                    if (cursor >= 0 && onPhotoToggleSelection) {
                        e.preventDefault();
                        const photo = photos[cursor];
                        if (photo) {
                            onPhotoToggleSelection(photo, cursor);
                        }
                    }
                    return;
                case 'Escape':
                    if (selectionActive && onClearSelection) {
                        e.preventDefault();
                        onClearSelection();
                    }
                    return;
                default:
                    return;
            }

            e.preventDefault();
            setCursor(next);

            // Scroll focused card into view
            const card = gridRef.current?.querySelector(`[data-photo-index="${next}"]`);
            card?.scrollIntoView({block: 'nearest', behavior: 'smooth'});
        };

        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [cursor, photos, getColumnCount, onPhotoClick, onPhotoToggleSelection, onClearSelection, selectionActive]);

    // Reset cursor when photos change
    useEffect(() => { setCursor(-1); }, [photos]);

    if (loading) {
        return (
            <div className="p-1">
                <div className="sticky top-0 z-10 px-3 py-1.5 bg-black/70 backdrop-blur-sm">
                    <span className="text-[11px] text-white/50 font-medium">{loadingLabel}</span>
                </div>
                <div className="grid gap-1 px-1 pb-1" style={{gridTemplateColumns: `repeat(auto-fill, minmax(${thumbScale}px, 1fr))`}}>
                    {Array.from({length: 12}, (_, i) => (
                        <div key={i} className="aspect-square skeleton rounded" />
                    ))}
                </div>
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
        <div ref={gridRef}>
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
                        <div className="grid gap-1 px-1 pb-1" data-photo-grid style={{gridTemplateColumns: colStyle}}>
                            {group.photos.map((photo, index) => {
                                const fi = startIndex + index;
                                return (
                                    <PhotoCard
                                        key={photo.hash}
                                        photo={photo}
                                        flatIndex={fi}
                                        focused={fi === cursor}
                                        selected={selectedPhotoHashes?.has(photo.hash) === true}
                                        selectionActive={selectionActive}
                                        onOpen={() => onPhotoClick(fi)}
                                        onToggleSelection={
                                            onPhotoToggleSelection
                                                ? () => onPhotoToggleSelection(photo, fi)
                                                : undefined
                                        }
                                        onContextMenu={(e) => {
                                            if (onPhotoContextMenu) {
                                                onPhotoContextMenu(photo, fi, e);
                                            }
                                        }}
                                        getThumbUrl={getThumbUrl}
                                    />
                                );
                            })}
                        </div>
                    </section>
                );
            })}
        </div>
    );
}

function PhotoCard<TPhoto extends PhotoEntry = PhotoEntry>({
    photo,
    flatIndex,
    focused,
    selected,
    selectionActive,
    onOpen,
    onToggleSelection,
    onContextMenu,
    getThumbUrl,
}: {
    photo: TPhoto;
    flatIndex: number;
    focused: boolean;
    selected: boolean;
    selectionActive: boolean;
    onOpen: () => void;
    onToggleSelection?: () => void;
    onContextMenu?: (e: React.MouseEvent | React.TouchEvent) => void;
    getThumbUrl: (entry: TPhoto) => Promise<string | null>;
}) {
    const [thumbSrc, setThumbSrc] = useState<string | null>(null);
    const [loaded, setLoaded] = useState(false);
    const faceCount = getFaceCount(photo.faces);
    const namedFaces = summarizeNamedFaces(photo.faces);
    
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const hasLongPressed = useRef(false);

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        hasLongPressed.current = false;
        timerRef.current = setTimeout(() => {
            hasLongPressed.current = true;
            if (onContextMenu) {
                onContextMenu(e);
            }
        }, 600);
    }, [onContextMenu]);

    const handleTouchMove = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const handleTouchEnd = useCallback((e: React.TouchEvent) => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        if (hasLongPressed.current) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, []);

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

    const handleCardClick = useCallback((e: React.MouseEvent) => {
        // Browse is the default. Selection is implicit: once anything is selected
        // (selectionActive) or the user holds a modifier, a plain click toggles
        // selection instead of opening — no "manage mode" to switch into.
        if (onToggleSelection && (selectionActive || e.metaKey || e.ctrlKey || e.shiftKey)) {
            e.preventDefault();
            onToggleSelection();
            return;
        }

        onOpen();
    }, [onToggleSelection, selectionActive, onOpen]);

    const handleCheckboxClick = useCallback((e: React.MouseEvent) => {
        // The checkbox always selects, regardless of state, and never opens.
        e.preventDefault();
        e.stopPropagation();
        onToggleSelection?.();
    }, [onToggleSelection]);

    return (
        <button
            type="button"
            onClick={handleCardClick}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (onContextMenu) {
                    onContextMenu(e);
                }
            }}
            data-photo-index={flatIndex}
            className={`group relative aspect-square overflow-hidden cursor-pointer touch-manipulation appearance-none p-0 text-left ${
                focused ? 'ring-2 ring-[#e94560] ring-offset-1 ring-offset-black border-0' : 'border-0'
            } ${
                selected ? 'ring-2 ring-[#ff9db0] ring-inset' : ''
            }`}
            style={{background: hashColor(photo.hash)}}
        >
            {!loaded && (
                <div className="absolute inset-0 skeleton" />
            )}
            {thumbSrc && (
                <img
                    src={thumbSrc}
                    alt={photo.name}
                    loading="lazy"
                    onLoad={() => setLoaded(true)}
                    className={`w-full h-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
                />
            )}

            {onToggleSelection && (
                <span
                    role="checkbox"
                    aria-checked={selected}
                    aria-label={selected ? 'Deselect photo' : 'Select photo'}
                    tabIndex={-1}
                    onClick={handleCheckboxClick}
                    className={`absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-semibold shadow-[0_6px_18px_rgba(0,0,0,0.28)] backdrop-blur-sm transition-opacity ${
                        selected
                            ? 'border-[#ff9db0]/80 bg-[#e94560]/90 text-white'
                            : 'border-white/30 bg-black/45 text-white/60 hover:border-white/60'
                    } ${
                        // Always visible while selecting or selected; otherwise
                        // revealed on hover (desktop) and faintly shown on touch.
                        selected || selectionActive
                            ? 'opacity-100'
                            : 'opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-70'
                    }`}
                >
                    {selected ? '✓' : ''}
                </span>
            )}

            {photo.faces === undefined && (
                <div className="absolute top-1.5 left-1.5 w-2 h-2 rounded-full bg-white/20 animate-pulse" />
            )}

            {faceCount > 0 && !namedFaces && (
                <div className="absolute top-1.5 right-1.5 rounded-full border border-white/15 bg-[#e94560]/85 px-2 py-0.5 text-[10px] font-medium text-white shadow-[0_6px_18px_rgba(233,69,96,0.35)] backdrop-blur-sm">
                    {faceCount} {faceCount === 1 ? 'face' : 'faces'}
                </div>
            )}

            {namedFaces && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 px-2 pb-1.5 pt-6 bg-gradient-to-t from-black/70 via-black/20 to-transparent">
                    <p
                        className="truncate text-[10px] font-medium tracking-[0.01em] text-white/70 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
                        title={namedFaces.fullLabel}
                    >
                        {namedFaces.label}
                    </p>
                </div>
            )}

            <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 via-black/35 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                <p className="text-xs truncate text-white/90">{photo.name}</p>
                {namedFaces && (
                    <p className="mt-0.5 truncate text-[10px] text-white/55">{namedFaces.fullLabel}</p>
                )}
            </div>
        </button>
    );
}
