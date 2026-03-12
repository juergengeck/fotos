import { useState, useEffect, useCallback, useRef } from 'react';
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCw, RotateCcw, FlipHorizontal, FlipVertical, Trash2, Maximize } from 'lucide-react';
import type { PhotoEntry } from '@/types/fotos';
import { EMBEDDING_DIM } from '@refinio/fotos.core';

interface LightboxProps {
    photos: PhotoEntry[];
    index: number;
    onIndexChange: (index: number) => void;
    onClose: () => void;
    onDelete?: (hash: string) => void;
    onFaceSearch?: (embedding: Float32Array) => void;
    getFileUrl: (relativePath: string) => Promise<string>;
}

interface ViewState {
    scale: number;
    panX: number;
    panY: number;
    rotation: number;
    flipH: boolean;
    flipV: boolean;
    mode: 'fit' | '1:1' | 'custom';
    natW: number;
    natH: number;
}

const INITIAL_VIEW: ViewState = {
    scale: 1, panX: 0, panY: 0, rotation: 0,
    flipH: false, flipV: false, mode: 'fit', natW: 0, natH: 0
};

export function Lightbox({ photos, index, onIndexChange, onClose, onDelete, onFaceSearch, getFileUrl }: LightboxProps) {
    const photo = photos[index];
    const [vw, setVw] = useState<ViewState>(INITIAL_VIEW);
    const vpRef = useRef<HTMLDivElement>(null);
    const imgRef = useRef<HTMLImageElement>(null);
    const dragRef = useRef({ active: false, startX: 0, startY: 0, startPanX: 0, startPanY: 0 });

    // Reset view on photo change
    useEffect(() => {
        setVw(INITIAL_VIEW);
    }, [index]);

    const fitScale = useCallback((natW: number, natH: number, rotation: number) => {
        const vp = vpRef.current;
        if (!vp || !natW) return 1;
        const rotated = (rotation % 180) !== 0;
        const imgW = rotated ? natH : natW;
        const imgH = rotated ? natW : natH;
        return Math.min((vp.clientWidth - 16) / imgW, (vp.clientHeight - 16) / imgH, 1);
    }, []);

    const center = useCallback((scale: number, natW: number, natH: number, rotation: number) => {
        const vp = vpRef.current;
        if (!vp) return { panX: 0, panY: 0 };
        const rotated = (rotation % 180) !== 0;
        const dispW = (rotated ? natH : natW) * scale;
        const dispH = (rotated ? natW : natH) * scale;
        return { panX: (vp.clientWidth - dispW) / 2, panY: (vp.clientHeight - dispH) / 2 };
    }, []);

    const handleImgLoad = useCallback(() => {
        const img = imgRef.current;
        if (!img) return;
        const natW = img.naturalWidth;
        const natH = img.naturalHeight;
        const scale = fitScale(natW, natH, 0);
        const { panX, panY } = center(scale, natW, natH, 0);
        setVw({ ...INITIAL_VIEW, scale, panX, panY, natW, natH });
    }, [fitScale, center]);

    const zoomFit = useCallback(() => {
        setVw(prev => {
            const s = fitScale(prev.natW, prev.natH, prev.rotation);
            const c = center(s, prev.natW, prev.natH, prev.rotation);
            return { ...prev, scale: s, ...c, mode: 'fit' };
        });
    }, [fitScale, center]);

    const zoom1to1 = useCallback(() => {
        setVw(prev => {
            const c = center(1, prev.natW, prev.natH, prev.rotation);
            return { ...prev, scale: 1, ...c, mode: '1:1' };
        });
    }, [center]);

    const zoomBy = useCallback((factor: number) => {
        setVw(prev => {
            const vp = vpRef.current;
            if (!vp) return prev;
            const cx = vp.clientWidth / 2, cy = vp.clientHeight / 2;
            const newScale = Math.max(0.05, Math.min(20, prev.scale * factor));
            const ratio = newScale / prev.scale;
            return {
                ...prev,
                scale: newScale,
                panX: cx - ratio * (cx - prev.panX),
                panY: cy - ratio * (cy - prev.panY),
                mode: 'custom'
            };
        });
    }, []);

    const rotate = useCallback((deg: number) => {
        setVw(prev => {
            const r = ((prev.rotation + deg) % 360 + 360) % 360;
            const s = prev.mode === 'fit' ? fitScale(prev.natW, prev.natH, r) : prev.scale;
            const c = center(s, prev.natW, prev.natH, r);
            return { ...prev, rotation: r, scale: s, ...c };
        });
    }, [fitScale, center]);

    // Keyboard
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement) return;
            switch (e.key) {
                case 'Escape': onClose(); break;
                case 'ArrowLeft': if (index > 0) onIndexChange(index - 1); break;
                case 'ArrowRight': if (index < photos.length - 1) onIndexChange(index + 1); break;
                case 'f': case 'F': zoomFit(); break;
                case '1': zoom1to1(); break;
                case '=': case '+': zoomBy(1.25); break;
                case '-': zoomBy(0.8); break;
                case 'r': case 'R': rotate(e.shiftKey ? -90 : 90); break;
                case 'l': case 'L': rotate(-90); break;
                case 'h': case 'H': setVw(p => ({ ...p, flipH: !p.flipH })); break;
                case 'v': case 'V': setVw(p => ({ ...p, flipV: !p.flipV })); break;
                case 'Delete': case 'Backspace': if (onDelete) onDelete(photo.hash); break;
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [index, photos.length, photo, onClose, onIndexChange, zoomFit, zoom1to1, zoomBy, rotate, onDelete]);

    // Mouse drag
    const onMouseDown = useCallback((e: React.MouseEvent) => {
        if (e.button !== 0) return;
        dragRef.current = { active: true, startX: e.clientX, startY: e.clientY, startPanX: vw.panX, startPanY: vw.panY };
        e.preventDefault();
    }, [vw.panX, vw.panY]);

    useEffect(() => {
        const onMove = (e: MouseEvent) => {
            const d = dragRef.current;
            if (!d.active) return;
            setVw(prev => ({
                ...prev,
                panX: d.startPanX + (e.clientX - d.startX),
                panY: d.startPanY + (e.clientY - d.startY),
                mode: 'custom'
            }));
        };
        const onUp = () => { dragRef.current.active = false; };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    }, []);

    // Wheel zoom
    const onWheel = useCallback((e: React.WheelEvent) => {
        e.preventDefault();
        const vp = vpRef.current;
        if (!vp) return;
        const rect = vp.getBoundingClientRect();
        const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
        const factor = e.deltaY < 0 ? 1.15 : 0.87;
        setVw(prev => {
            const newScale = Math.max(0.05, Math.min(20, prev.scale * factor));
            const ratio = newScale / prev.scale;
            return { ...prev, scale: newScale, panX: cx - ratio * (cx - prev.panX), panY: cy - ratio * (cy - prev.panY), mode: 'custom' };
        });
    }, []);

    // Double click toggle fit/1:1
    const onDblClick = useCallback(() => {
        if (vw.mode === 'fit' && vw.scale < 1) zoom1to1();
        else zoomFit();
    }, [vw.mode, vw.scale, zoom1to1, zoomFit]);

    // Build transform
    const isRotated = (vw.rotation % 180) !== 0;
    let tx = vw.panX, ty = vw.panY;
    if (isRotated) {
        if (vw.rotation === 90 || vw.rotation === -270) tx = vw.panX + vw.natH * vw.scale;
        if (vw.rotation === 270 || vw.rotation === -90) ty = vw.panY + vw.natW * vw.scale;
    }
    const sx = vw.flipH ? -vw.scale : vw.scale;
    const sy = vw.flipV ? -vw.scale : vw.scale;
    const ox = vw.flipH ? vw.natW : 0;
    const oy = vw.flipV ? vw.natH : 0;

    // Load full-size image from folder access
    const [imgSrc, setImgSrc] = useState('');
    useEffect(() => {
        setImgSrc(''); // reset on photo change
        if (photo.sourcePath) {
            getFileUrl(photo.sourcePath).then(setImgSrc).catch(() => {});
        }
    }, [photo.sourcePath, getFileUrl]);

    const exifParts: string[] = [];
    if (photo.exif?.date) exifParts.push(photo.exif.date);
    if (photo.exif?.camera) exifParts.push(photo.exif.camera);
    if (photo.exif?.aperture) exifParts.push(photo.exif.aperture);
    if (photo.exif?.iso) exifParts.push(`ISO ${photo.exif.iso}`);
    if (photo.exif?.width && photo.exif?.height) exifParts.push(`${photo.exif.width}\u00d7${photo.exif.height}`);

    return (
        <div className="fixed inset-0 z-[60] flex flex-col bg-black">
            {/* Toolbar */}
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex gap-1 bg-black/70 rounded-md p-1">
                <Btn onClick={zoomFit} active={vw.mode === 'fit'} title="Fit (F)"><Maximize className="w-3.5 h-3.5" /></Btn>
                <Btn onClick={zoom1to1} active={vw.mode === '1:1'} title="1:1"><span className="text-xs font-mono">1:1</span></Btn>
                <Sep />
                <Btn onClick={() => zoomBy(0.8)} title="Zoom out (-)"><ZoomOut className="w-3.5 h-3.5" /></Btn>
                <span className="text-[var(--fg-muted)] text-[11px] px-1 self-center min-w-[40px] text-center">{Math.round(vw.scale * 100)}%</span>
                <Btn onClick={() => zoomBy(1.25)} title="Zoom in (+)"><ZoomIn className="w-3.5 h-3.5" /></Btn>
                <Sep />
                <Btn onClick={() => rotate(-90)} title="Rotate left (L)"><RotateCcw className="w-3.5 h-3.5" /></Btn>
                <Btn onClick={() => rotate(90)} title="Rotate right (R)"><RotateCw className="w-3.5 h-3.5" /></Btn>
                <Btn onClick={() => setVw(p => ({ ...p, flipH: !p.flipH }))} title="Flip H"><FlipHorizontal className="w-3.5 h-3.5" /></Btn>
                <Btn onClick={() => setVw(p => ({ ...p, flipV: !p.flipV }))} title="Flip V"><FlipVertical className="w-3.5 h-3.5" /></Btn>
                {onDelete && (
                    <>
                        <Sep />
                        <Btn onClick={() => onDelete(photo.hash)} title="Delete" className="text-red-400 hover:text-red-300">
                            <Trash2 className="w-3.5 h-3.5" />
                        </Btn>
                    </>
                )}
            </div>

            {/* Close */}
            <button onClick={onClose} className="absolute top-3 right-4 z-10 text-[var(--fg-muted)] hover:text-[var(--fg)]">
                <X className="w-6 h-6" />
            </button>

            {/* Nav */}
            {index > 0 && (
                <button onClick={() => onIndexChange(index - 1)} className="absolute left-3 top-1/2 z-10 text-gray-600 hover:text-white text-4xl">
                    <ChevronLeft className="w-8 h-8" />
                </button>
            )}
            {index < photos.length - 1 && (
                <button onClick={() => onIndexChange(index + 1)} className="absolute right-3 top-1/2 z-10 text-gray-600 hover:text-white text-4xl">
                    <ChevronRight className="w-8 h-8" />
                </button>
            )}

            {/* Viewport */}
            <div
                ref={vpRef}
                className="flex-1 overflow-hidden relative cursor-grab active:cursor-grabbing"
                onMouseDown={onMouseDown}
                onWheel={onWheel}
                onDoubleClick={onDblClick}
            >
                {imgSrc && (
                    <img
                        ref={imgRef}
                        src={imgSrc}
                        alt={photo.name}
                        onLoad={handleImgLoad}
                        className="absolute select-none"
                        draggable={false}
                        style={{
                            transformOrigin: `${ox}px ${oy}px`,
                            transform: `translate(${tx}px,${ty}px) rotate(${vw.rotation}deg) scale(${sx},${sy})`,
                            width: vw.natW || undefined,
                            height: vw.natH || undefined
                        }}
                    />
                )}
                {!imgSrc && (
                    <div className="flex items-center justify-center h-full text-[var(--fg-muted)]">
                        <p>No image data — photo is in reference mode</p>
                    </div>
                )}
            </div>

            {/* Info bar */}
            <div className="bg-black/60 px-4 py-2 text-center z-10">
                <p className="text-sm">{photo.name}</p>
                {exifParts.length > 0 && (
                    <p className="text-xs text-[var(--fg-muted)] mt-0.5">{exifParts.join(' \u00b7 ')}</p>
                )}
                {photo.tags.length > 0 && (
                    <div className="flex gap-1 justify-center mt-1">
                        {photo.tags.map(t => (
                            <span key={t} className="bg-[var(--bg-tertiary)] text-[11px] text-[var(--fg-muted)] px-2 py-0.5 rounded-full">{t}</span>
                        ))}
                    </div>
                )}
                {photo.faces && photo.faces.count > 0 && (
                    <FaceCrops
                        photo={photo}
                        getFileUrl={getFileUrl}
                        onFaceSearch={onFaceSearch}
                    />
                )}
            </div>
        </div>
    );
}

function Btn({ onClick, active, title, className, children }: {
    onClick: () => void; active?: boolean; title: string; className?: string; children: React.ReactNode;
}) {
    return (
        <button
            onClick={onClick}
            title={title}
            className={`px-2 py-1.5 rounded text-sm ${active ? 'text-[var(--accent-fg)] border border-[var(--accent)]' : 'text-[var(--fg-muted)] border border-transparent hover:text-[var(--fg)] hover:bg-white/10'} ${className ?? ''}`}
        >
            {children}
        </button>
    );
}

function Sep() {
    return <div className="w-px bg-gray-700 my-1" />;
}

function FaceCrops({ photo, getFileUrl, onFaceSearch }: {
    photo: PhotoEntry;
    getFileUrl: (path: string) => Promise<string>;
    onFaceSearch?: (embedding: Float32Array) => void;
}) {
    const faces = photo.faces!;
    return (
        <div className="flex gap-2 justify-center mt-2">
            {faces.crops.map((cropPath, i) => (
                <FaceCropThumb
                    key={i}
                    cropPath={cropPath}
                    index={i}
                    score={faces.scores[i]}
                    embeddings={faces.embeddings}
                    getFileUrl={getFileUrl}
                    onFaceSearch={onFaceSearch}
                />
            ))}
        </div>
    );
}

function FaceCropThumb({ cropPath, index, score, embeddings, getFileUrl, onFaceSearch }: {
    cropPath: string;
    index: number;
    score: number;
    embeddings: Float32Array | null;
    getFileUrl: (path: string) => Promise<string>;
    onFaceSearch?: (embedding: Float32Array) => void;
}) {
    const [src, setSrc] = useState('');

    useEffect(() => {
        if (!cropPath) return;
        let cancelled = false;
        getFileUrl(cropPath).then(url => { if (!cancelled) setSrc(url); }).catch(() => {});
        return () => { cancelled = true; };
    }, [cropPath, getFileUrl]);

    const handleClick = () => {
        if (!onFaceSearch || !embeddings) return;
        const emb = embeddings.slice(index * EMBEDDING_DIM, (index + 1) * EMBEDDING_DIM);
        onFaceSearch(emb);
    };

    return (
        <button
            onClick={handleClick}
            title={`Face ${index + 1} (${(score * 100).toFixed(0)}%) — click to find similar`}
            className="w-10 h-10 rounded-full overflow-hidden border-2 border-white/20 hover:border-white/60 transition-colors"
        >
            {src ? (
                <img src={src} alt={`Face ${index + 1}`} className="w-full h-full object-cover" />
            ) : (
                <div className="w-full h-full bg-white/10 flex items-center justify-center text-[9px] text-white/40">
                    {index + 1}
                </div>
            )}
        </button>
    );
}
