import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCw, RotateCcw, FlipHorizontal, FlipVertical, Trash2, Maximize, Minimize, X, Pencil } from 'lucide-react';
import type { PhotoEntry } from '@/types/fotos';
import { EMBEDDING_DIM } from '@refinio/fotos.core';

interface LightboxProps {
    photos: PhotoEntry[];
    index: number;
    onIndexChange: (index: number) => void;
    onClose: () => void;
    onDelete?: (hash: string) => void;
    onFaceSearch?: (embedding: Float32Array) => void;
    onEditFace?: (clusterId: string) => void;
    onDeleteFace?: (clusterId: string) => void;
    getFileUrl: (relativePath: string) => Promise<string>;
}

export function Lightbox({ photos, index, onIndexChange, onClose, onDelete, onFaceSearch, onEditFace, onDeleteFace, getFileUrl }: LightboxProps) {
    const photo = photos[index];
    const [fullscreen, setFullscreen] = useState(false);
    const [chevronVisible, setChevronVisible] = useState(false);
    const chevronTimer = useRef<ReturnType<typeof setTimeout>>(null);

    // Zoom/pan state
    const [scale, setScale] = useState<number | null>(null); // null = fit mode
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [rotation, setRotation] = useState(0);
    const [flipH, setFlipH] = useState(false);
    const [flipV, setFlipV] = useState(false);
    const vpRef = useRef<HTMLDivElement>(null);
    const imgRef = useRef<HTMLImageElement>(null);
    const dragRef = useRef({ active: false, startX: 0, startY: 0, startPanX: 0, startPanY: 0 });

    // Reset on photo change
    useEffect(() => {
        setScale(null);
        setPan({ x: 0, y: 0 });
        setRotation(0);
        setFlipH(false);
        setFlipV(false);
    }, [index]);

    // Navigate
    const goPrev = useCallback(() => { if (index > 0) onIndexChange(index - 1); }, [index, onIndexChange]);
    const goNext = useCallback(() => { if (index < photos.length - 1) onIndexChange(index + 1); }, [index, photos.length, onIndexChange]);

    // Compute fit scale from actual displayed image natural size
    const getFitScale = useCallback(() => {
        const vp = vpRef.current;
        const img = imgRef.current;
        if (!vp || !img || !img.naturalWidth) return 1;
        const natW = img.naturalWidth;
        const natH = img.naturalHeight;
        const rotated = (rotation % 180) !== 0;
        const imgW = rotated ? natH : natW;
        const imgH = rotated ? natW : natH;
        return Math.min((vp.clientWidth - 16) / imgW, (vp.clientHeight - 16) / imgH, 1);
    }, [rotation]);

    const getEffectiveScale = useCallback(() => {
        return scale ?? getFitScale();
    }, [scale, getFitScale]);

    const zoomFit = useCallback(() => {
        setScale(null);
        setPan({ x: 0, y: 0 });
    }, []);

    const zoom1to1 = useCallback(() => {
        setScale(1);
        setPan({ x: 0, y: 0 });
    }, []);

    const zoomBy = useCallback((factor: number) => {
        setScale(prev => {
            const current = prev ?? getFitScale();
            return Math.max(0.05, Math.min(20, current * factor));
        });
    }, [getFitScale]);

    const rotate90 = useCallback((deg: number) => {
        setRotation(prev => ((prev + deg) % 360 + 360) % 360);
        setPan({ x: 0, y: 0 });
        // Reset to fit when rotating in fit mode
        if (scale === null) setScale(null);
    }, [scale]);

    // Fullscreen chevron
    const showChevron = useCallback(() => {
        setChevronVisible(true);
        if (chevronTimer.current) clearTimeout(chevronTimer.current);
        chevronTimer.current = setTimeout(() => setChevronVisible(false), 5000);
    }, []);

    // Keyboard
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement) return;
            switch (e.key) {
                case 'Escape':
                    if (fullscreen) { setFullscreen(false); setChevronVisible(false); }
                    else onClose();
                    break;
                case 'ArrowLeft': goPrev(); break;
                case 'ArrowRight': goNext(); break;
                case 'f': case 'F':
                    if (fullscreen) { setFullscreen(false); setChevronVisible(false); }
                    else zoomFit();
                    break;
                case '1': zoom1to1(); break;
                case '=': case '+': zoomBy(1.25); break;
                case '-': zoomBy(0.8); break;
                case 'r': case 'R': rotate90(e.shiftKey ? -90 : 90); break;
                case 'l': case 'L': rotate90(-90); break;
                case 'h': case 'H': setFlipH(p => !p); break;
                case 'v': case 'V': setFlipV(p => !p); break;
                case 'Delete': case 'Backspace': if (onDelete) onDelete(photo.hash); break;
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [index, fullscreen, photo, onClose, goPrev, goNext, zoomFit, zoom1to1, zoomBy, rotate90, onDelete]);

    // Mouse drag (only when zoomed/panned)
    const onMouseDown = useCallback((e: React.MouseEvent) => {
        if (e.button !== 0 || scale === null) return;
        dragRef.current = { active: true, startX: e.clientX, startY: e.clientY, startPanX: pan.x, startPanY: pan.y };
        e.preventDefault();
    }, [scale, pan]);

    useEffect(() => {
        const onMove = (e: MouseEvent) => {
            const d = dragRef.current;
            if (!d.active) return;
            setPan({ x: d.startPanX + (e.clientX - d.startX), y: d.startPanY + (e.clientY - d.startY) });
        };
        const onUp = () => { dragRef.current.active = false; };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    }, []);

    // Wheel zoom. React's wheel listener is passive in this path, so bind natively.
    useEffect(() => {
        const viewport = vpRef.current;
        if (!viewport) return;

        const onWheel = (event: WheelEvent) => {
            event.preventDefault();
            const factor = event.deltaY < 0 ? 1.15 : 0.87;
            zoomBy(factor);
        };

        viewport.addEventListener('wheel', onWheel, {passive: false});
        return () => viewport.removeEventListener('wheel', onWheel);
    }, [zoomBy]);

    // Double click toggle fit/1:1
    const onDblClick = useCallback(() => {
        if (scale === null) zoom1to1();
        else zoomFit();
    }, [scale, zoom1to1, zoomFit]);

    // Click on viewport: fullscreen shows chevron, otherwise navigate
    const onViewportClick = useCallback((e: React.MouseEvent) => {
        if (dragRef.current.active) return;
        const vp = vpRef.current;
        if (!vp) return;

        if (fullscreen) {
            showChevron();
            return;
        }

        const rect = vp.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const third = rect.width / 3;
        if (x < third) goPrev();
        else if (x > third * 2) goNext();
    }, [fullscreen, showChevron, goPrev, goNext]);

    // Touch swipe
    const touchRef = useRef({ startX: 0, startY: 0 });
    const onTouchStart = useCallback((e: React.TouchEvent) => {
        const t = e.touches[0];
        touchRef.current = { startX: t.clientX, startY: t.clientY };
    }, []);
    const onTouchEnd = useCallback((e: React.TouchEvent) => {
        const t = e.changedTouches[0];
        const dx = t.clientX - touchRef.current.startX;
        const dy = t.clientY - touchRef.current.startY;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
            if (dx < 0) goNext();
            else goPrev();
        } else if (fullscreen) {
            showChevron();
        }
    }, [goNext, goPrev, fullscreen, showChevron]);

    // Load full-size image
    const [imgSrc, setImgSrc] = useState('');
    useEffect(() => {
        setImgSrc('');
        if (photo.sourcePath) {
            getFileUrl(photo.sourcePath).then(setImgSrc).catch(() => {});
        }
    }, [photo.sourcePath, getFileUrl]);

    // Build image style
    const isFit = scale === null;
    const effectiveScale = getEffectiveScale();
    const scaleX = flipH ? -effectiveScale : effectiveScale;
    const scaleY = flipV ? -effectiveScale : effectiveScale;

    const imgStyle: React.CSSProperties = isFit && rotation === 0 && !flipH && !flipV
        ? {
            // Simple fit mode — absolute centered, browser handles EXIF orientation
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            maxWidth: 'calc(100% - 16px)',
            maxHeight: 'calc(100% - 16px)',
            width: 'auto',
            height: 'auto',
        }
        : {
            // Manual transform mode for zoom/rotate/flip
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) rotate(${rotation}deg) scale(${scaleX}, ${scaleY})`,
            width: 'auto',
            height: 'auto',
        };

    const viewport = (
        <div
            ref={vpRef}
            className={`flex-1 h-full overflow-hidden relative ${scale !== null ? 'cursor-grab active:cursor-grabbing' : ''}`}
            onMouseDown={onMouseDown}
            onDoubleClick={onDblClick}
            onClick={onViewportClick}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
        >
            {imgSrc ? (
                <img
                    ref={imgRef}
                    src={imgSrc}
                    alt={photo.name}
                    className="select-none"
                    draggable={false}
                    style={imgStyle}
                />
            ) : (
                <div className="absolute inset-0 flex items-center justify-center text-white/30">
                    <p>No image data — photo is in reference mode</p>
                </div>
            )}
        </div>
    );

    // --- FULLSCREEN MODE ---
    if (fullscreen) {
        return (
            <div className="fixed inset-0 z-[60] flex bg-black">
                {viewport}

                <div className={`absolute top-4 left-1/2 -translate-x-1/2 text-white/20 text-xs tabular-nums transition-opacity duration-500 ${chevronVisible ? 'opacity-100' : 'opacity-0'}`}>
                    {index + 1} / {photos.length}
                </div>

                {/* Back to gallery */}
                <button
                    onClick={() => { setFullscreen(false); setChevronVisible(false); onClose(); }}
                    className={`fixed bottom-6 right-[4.5rem] z-[70] w-10 h-10 flex items-center justify-center bg-black/70 backdrop-blur-sm rounded-full border border-white/15 text-white/50 hover:text-white/70 transition-opacity duration-500 ${chevronVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                    aria-label="Back to gallery"
                >
                    <ChevronLeft className="w-5 h-5" />
                </button>

                {/* Exit fullscreen */}
                <button
                    onClick={() => { setFullscreen(false); setChevronVisible(false); }}
                    className={`fixed bottom-6 right-4 z-[70] w-10 h-10 flex items-center justify-center bg-black/70 backdrop-blur-sm rounded-full border border-white/15 text-white/50 hover:text-white/70 transition-opacity duration-500 ${chevronVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                    aria-label="Exit fullscreen"
                >
                    <Minimize className="w-5 h-5" />
                </button>
            </div>
        );
    }

    // --- IMAGE VIEW MODE ---
    return (
        <div className="fixed inset-0 z-[60] flex bg-black">
            <div className="flex-1 min-w-0 relative">
                {viewport}
                <button
                    onClick={(event) => {
                        event.stopPropagation();
                        onClose();
                    }}
                    className="absolute top-4 right-4 z-30 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/70 text-white/55 backdrop-blur-sm transition-colors hover:text-white/80"
                    aria-label="Close image view"
                    title="Close image view (Esc)"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>

            <aside className="w-72 h-full flex flex-col bg-[#0d0d0d] border-l border-white/10 shrink-0 max-md:w-64">
                {/* Header — matches gallery sidebar tab bar shape */}
                <div className="flex items-center border-b border-white/10">
                    <div className="flex-1 px-3 py-2">
                        <div className="text-[11px] font-medium tracking-wide uppercase text-white/90">{photo.name}</div>
                        <div className="text-[10px] text-white/25 tabular-nums mt-0.5">{index + 1} of {photos.length}</div>
                    </div>
                </div>

                {/* Scrollable content */}
                <div className="flex-1 overflow-y-auto p-4 space-y-5">
                    {/* EXIF */}
                    {photo.exif && (
                        <Section label="Details">
                            <div className="space-y-1">
                                {photo.exif.date && <DetailRow label="Date" value={photo.exif.date} />}
                                {photo.exif.camera && <DetailRow label="Camera" value={photo.exif.camera} />}
                                {photo.exif.aperture && <DetailRow label="Aperture" value={photo.exif.aperture} />}
                                {photo.exif.iso && <DetailRow label="ISO" value={String(photo.exif.iso)} />}
                                {photo.exif.width && photo.exif.height && <DetailRow label="Size" value={`${photo.exif.width}\u00d7${photo.exif.height}`} />}
                            </div>
                        </Section>
                    )}

                    {/* Tags */}
                    {photo.tags.length > 0 && (
                        <Section label="Tags">
                            <div className="flex flex-wrap gap-1">
                                {photo.tags.map(t => (
                                    <span key={t} className="bg-white/5 text-[11px] text-white/50 px-2 py-0.5 rounded-full border border-white/10">{t}</span>
                                ))}
                            </div>
                        </Section>
                    )}

                    {/* Faces */}
                    {photo.faces && photo.faces.count > 0 && (
                        <Section label="Faces">
                            <FaceCrops photo={photo} getFileUrl={getFileUrl} onFaceSearch={onFaceSearch} onEditFace={onEditFace} onDeleteFace={onDeleteFace} />
                        </Section>
                    )}

                    {/* View controls */}
                    <Section label="View">
                        <div className="grid grid-cols-4 gap-1">
                            <CtrlBtn onClick={zoomFit} active={isFit} title="Fit (F)"><Maximize className="w-3.5 h-3.5" /></CtrlBtn>
                            <CtrlBtn onClick={zoom1to1} active={scale === 1} title="1:1"><span className="text-[10px] font-mono">1:1</span></CtrlBtn>
                            <CtrlBtn onClick={() => zoomBy(0.8)} title="Zoom out (-)"><ZoomOut className="w-3.5 h-3.5" /></CtrlBtn>
                            <CtrlBtn onClick={() => zoomBy(1.25)} title="Zoom in (+)"><ZoomIn className="w-3.5 h-3.5" /></CtrlBtn>
                        </div>
                        <p className="text-[10px] text-white/20 text-center tabular-nums mt-1">{Math.round(effectiveScale * 100)}%</p>
                        <div className="grid grid-cols-4 gap-1 mt-1">
                            <CtrlBtn onClick={() => rotate90(-90)} title="Rotate left (L)"><RotateCcw className="w-3.5 h-3.5" /></CtrlBtn>
                            <CtrlBtn onClick={() => rotate90(90)} title="Rotate right (R)"><RotateCw className="w-3.5 h-3.5" /></CtrlBtn>
                            <CtrlBtn onClick={() => setFlipH(p => !p)} active={flipH} title="Flip H"><FlipHorizontal className="w-3.5 h-3.5" /></CtrlBtn>
                            <CtrlBtn onClick={() => setFlipV(p => !p)} active={flipV} title="Flip V"><FlipVertical className="w-3.5 h-3.5" /></CtrlBtn>
                        </div>
                    </Section>

                    {/* Delete */}
                    {onDelete && (
                        <Section label="Actions">
                            <button
                                onClick={() => onDelete(photo.hash)}
                                className="flex items-center gap-2 text-[11px] text-red-400/60 hover:text-red-400 transition-colors"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                                Delete photo
                            </button>
                        </Section>
                    )}
                </div>

            </aside>

            {/* Fullscreen — fixed circle, bottom-right */}
            <button
                onClick={() => setFullscreen(true)}
                className="fixed bottom-6 right-4 z-[70] w-10 h-10 flex items-center justify-center bg-black/70 backdrop-blur-sm rounded-full border border-white/15 text-white/50 hover:text-white/70 transition-colors"
                aria-label="Fullscreen"
                title="Fullscreen"
            >
                <ChevronRight className="w-5 h-5" />
            </button>
        </div>
    );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <div className="text-[10px] text-white/25 uppercase tracking-wider font-medium mb-1.5">{label}</div>
            {children}
        </div>
    );
}

function DetailRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex justify-between text-[11px]">
            <span className="text-white/30">{label}</span>
            <span className="text-white/60">{value}</span>
        </div>
    );
}

function CtrlBtn({ onClick, active, title, children }: {
    onClick: () => void; active?: boolean; title: string; children: React.ReactNode;
}) {
    return (
        <button
            onClick={onClick}
            title={title}
            className={`flex items-center justify-center p-2 rounded text-sm transition-colors ${
                active
                    ? 'bg-white/10 text-white/70 border border-white/20'
                    : 'text-white/30 border border-transparent hover:text-white/60 hover:bg-white/5'
            }`}
        >
            {children}
        </button>
    );
}

function FaceCrops({ photo, getFileUrl, onFaceSearch, onEditFace, onDeleteFace }: {
    photo: PhotoEntry;
    getFileUrl: (path: string) => Promise<string>;
    onFaceSearch?: (embedding: Float32Array) => void;
    onEditFace?: (clusterId: string) => void;
    onDeleteFace?: (clusterId: string) => void;
}) {
    const faces = photo.faces!;
    return (
        <div className="space-y-2">
            {faces.crops.map((cropPath, i) => (
                <FaceCropRow
                    key={i}
                    cropPath={cropPath}
                    index={i}
                    score={faces.scores[i]}
                    name={faces.names?.[i]}
                    clusterId={faces.clusterIds?.[i]}
                    embeddings={faces.embeddings}
                    getFileUrl={getFileUrl}
                    onFaceSearch={onFaceSearch}
                    onEdit={onEditFace}
                    onDelete={onDeleteFace}
                />
            ))}
        </div>
    );
}

function FaceCropRow({ cropPath, index, score, name, clusterId, embeddings, getFileUrl, onFaceSearch, onEdit, onDelete }: {
    cropPath: string;
    index: number;
    score: number;
    name?: string;
    clusterId?: string;
    embeddings: Float32Array | null;
    getFileUrl: (path: string) => Promise<string>;
    onFaceSearch?: (embedding: Float32Array) => void;
    onEdit?: (clusterId: string) => void;
    onDelete?: (clusterId: string) => void;
}) {
    const [src, setSrc] = useState('');

    useEffect(() => {
        if (!cropPath) return;
        let cancelled = false;
        getFileUrl(cropPath).then(url => { if (!cancelled) setSrc(url); }).catch(() => {});
        return () => { cancelled = true; };
    }, [cropPath, getFileUrl]);

    const handleSearch = () => {
        if (!onFaceSearch || !embeddings) return;
        const emb = embeddings.slice(index * EMBEDDING_DIM, (index + 1) * EMBEDDING_DIM);
        onFaceSearch(emb);
    };

    return (
        <div className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2 py-1.5">
            <button
                onClick={handleSearch}
                title={`Face ${index + 1} (${(score * 100).toFixed(0)}%) — click to find similar`}
                className="w-8 h-8 rounded-full overflow-hidden border border-white/20 hover:border-white/60 transition-colors shrink-0"
            >
                {src ? (
                    <img src={src} alt={`Face ${index + 1}`} className="w-full h-full object-cover" />
                ) : (
                    <div className="w-full h-full bg-white/10 flex items-center justify-center text-[9px] text-white/40">
                        {index + 1}
                    </div>
                )}
            </button>
            <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] text-white/75">{name && name !== 'Unknown' ? name : `Face ${index + 1}`}</div>
                <div className="text-[10px] text-white/25">{(score * 100).toFixed(0)}% confidence</div>
            </div>
            {onEdit && clusterId && (
                <button
                    onClick={() => onEdit(clusterId)}
                    className="text-white/20 hover:text-white/60 transition-colors"
                    title="Rename face"
                >
                    <Pencil className="h-3 w-3" />
                </button>
            )}
            {onDelete && clusterId && (
                <button
                    onClick={() => onDelete(clusterId)}
                    className="text-white/20 hover:text-red-400 transition-colors"
                    title="Delete face"
                >
                    <Trash2 className="h-3 w-3" />
                </button>
            )}
        </div>
    );
}
