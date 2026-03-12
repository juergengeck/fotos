import { useCallback, useEffect, useRef, useState } from 'react';
import type { PhotoEntry } from '@/types/fotos';

interface DayGroup {
    date: string;
    photos: PhotoEntry[];
}

interface TimelineScrubberProps {
    scrollRef: React.RefObject<HTMLElement | null>;
    dayGroups: DayGroup[];
}

interface YearSpan {
    year: string;
    /** Start position as fraction 0–1 */
    start: number;
    /** End position as fraction 0–1 */
    end: number;
}

function buildYearSpans(dayGroups: DayGroup[]): YearSpan[] {
    if (dayGroups.length === 0) return [];

    let total = 0;
    for (const g of dayGroups) total += g.photos.length;
    if (total === 0) return [];

    const spans: YearSpan[] = [];
    let cumulative = 0;
    let currentYear = '';
    let spanStart = 0;

    for (const g of dayGroups) {
        const year = g.date.slice(0, 4);
        if (year !== currentYear) {
            if (currentYear) {
                spans.push({ year: currentYear, start: spanStart, end: cumulative / total });
            }
            currentYear = year;
            spanStart = cumulative / total;
        }
        cumulative += g.photos.length;
    }
    if (currentYear) {
        spans.push({ year: currentYear, start: spanStart, end: 1 });
    }

    return spans;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dateAtRatio(dayGroups: DayGroup[], ratio: number): string {
    let total = 0;
    for (const g of dayGroups) total += g.photos.length;
    const target = ratio * total;
    let cumulative = 0;
    for (const g of dayGroups) {
        cumulative += g.photos.length;
        if (cumulative >= target) {
            const m = parseInt(g.date.slice(5, 7));
            const y = g.date.slice(0, 4);
            return `${MONTH_NAMES[m - 1]} ${y}`;
        }
    }
    return '';
}

const PADDING = 8;
const BOTTOM_PAD = 64;
const HOLD_MS = 300;
const TOP_THRESHOLD = 8;

export function TimelineScrubber({ scrollRef, dayGroups }: TimelineScrubberProps) {
    const yearSpans = buildYearSpans(dayGroups);
    const trackRef = useRef<HTMLDivElement>(null);
    const btnRef = useRef<HTMLButtonElement>(null);
    const [viewTop, setViewTop] = useState(0);
    const [viewHeight, setViewHeight] = useState(0.1);
    const [hoverLabel, setHoverLabel] = useState<string | null>(null);
    const [hoverY, setHoverY] = useState(0);
    const scrubbingRef = useRef(false);
    const [scrubMode, setScrubMode] = useState(false);
    const [atTop, setAtTop] = useState(true);
    const rafRef = useRef(0);

    // Track viewport position
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const update = () => {
            if (el.scrollHeight <= el.clientHeight) {
                setViewTop(0);
                setViewHeight(1);
                return;
            }
            setViewTop(el.scrollTop / el.scrollHeight);
            setViewHeight(el.clientHeight / el.scrollHeight);
            if (!scrubbingRef.current) {
                setAtTop(el.scrollTop <= TOP_THRESHOLD);
            }
        };
        el.addEventListener('scroll', update, { passive: true });
        rafRef.current = requestAnimationFrame(update);
        return () => {
            el.removeEventListener('scroll', update);
            cancelAnimationFrame(rafRef.current);
        };
    }, [scrollRef, dayGroups]);

    const scrollToTop = useCallback(() => {
        scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }, [scrollRef]);

    // --- Scrubber track interactions (when in scrub mode) ---

    const scrubTo = useCallback((clientY: number) => {
        const track = trackRef.current;
        const el = scrollRef.current;
        if (!track || !el) return;
        const rect = track.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
        el.scrollTop = ratio * (el.scrollHeight - el.clientHeight);
        setHoverLabel(dateAtRatio(dayGroups, ratio));
        setHoverY(clientY - rect.top);
    }, [scrollRef, dayGroups]);

    const onTrackPointerDown = useCallback((e: React.PointerEvent) => {
        const track = trackRef.current;
        if (!track) return;
        e.preventDefault();
        track.setPointerCapture(e.pointerId);
        scrubbingRef.current = true;

        let moved = false;
        const onMove = (me: PointerEvent) => {
            moved = true;
            scrubTo(me.clientY);
        };
        const onUp = () => {
            scrubbingRef.current = false;
            setHoverLabel(null);
            track.removeEventListener('pointermove', onMove);
            track.removeEventListener('pointerup', onUp);
            track.removeEventListener('pointercancel', onUp);
            if (!moved) {
                // Tap on track without drag — exit scrub mode
                setScrubMode(false);
            }
        };
        track.addEventListener('pointermove', onMove);
        track.addEventListener('pointerup', onUp);
        track.addEventListener('pointercancel', onUp);
    }, [scrubTo]);

    const onMouseMove = useCallback((e: React.MouseEvent) => {
        if (scrubbingRef.current) return;
        const track = trackRef.current;
        if (!track) return;
        const rect = track.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
        setHoverLabel(dateAtRatio(dayGroups, ratio));
        setHoverY(e.clientY - rect.top);
    }, [dayGroups]);

    const onMouseLeave = useCallback(() => {
        if (!scrubbingRef.current) setHoverLabel(null);
    }, []);

    const [isHovering, setIsHovering] = useState(false);

    if (yearSpans.length < 1) return null;

    const active = isHovering || scrubbingRef.current;

    // --- Scrub mode: full timeline track ---
    if (scrubMode) {
        return (
            <div
                ref={trackRef}
                className="absolute top-0 right-0 z-20 select-none cursor-pointer transition-all duration-200"
                style={{
                    bottom: BOTTOM_PAD,
                    width: active ? 56 : 20,
                    touchAction: 'none',
                }}
                onPointerDown={onTrackPointerDown}
                onMouseMove={(e) => { setIsHovering(true); onMouseMove(e); }}
                onMouseEnter={() => setIsHovering(true)}
                onMouseLeave={() => { setIsHovering(false); onMouseLeave(); }}
            >
                {/* Track line — widens on hover */}
                <div
                    className="absolute rounded-full transition-all duration-200"
                    style={{
                        top: PADDING,
                        bottom: PADDING,
                        right: active ? 12 : 6,
                        width: active ? 3 : 2,
                        background: active ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.08)',
                    }}
                />

                {/* Year labels — only visible when active */}
                <div
                    className="transition-opacity duration-200"
                    style={{ opacity: active ? 1 : 0 }}
                >
                    {yearSpans.map(span => {
                        const midPos = (span.start + span.end) / 2;
                        return (
                            <div
                                key={span.year}
                                className="absolute right-7 text-[10px] text-white/40 font-medium pointer-events-none whitespace-nowrap"
                                style={{
                                    top: `calc(${PADDING}px + ${midPos * 100}% * (1 - ${2 * PADDING}px / 100%))`,
                                    transform: 'translateY(-50%)',
                                }}
                            >
                                {span.year}
                            </div>
                        );
                    })}

                    {/* Year boundary ticks */}
                    {yearSpans.slice(1).map(span => (
                        <div
                            key={`tick-${span.year}`}
                            className="absolute w-2 pointer-events-none"
                            style={{
                                top: `calc(${PADDING}px + ${span.start * 100}%)`,
                                right: 10,
                                height: 1,
                                background: 'rgba(255,255,255,0.2)',
                            }}
                        />
                    ))}
                </div>

                {/* Circular handle */}
                <div
                    className="absolute flex items-center justify-center rounded-full bg-black/70 backdrop-blur-sm border border-white/15 transition-all duration-200"
                    style={{
                        width: 40,
                        height: 40,
                        right: -10,
                        top: `calc(${PADDING}px + ${(viewTop + viewHeight / 2) * 100}%)`,
                        transform: 'translateY(-50%)',
                        transition: scrubbingRef.current ? 'none' : 'top 0.15s ease-out',
                    }}
                >
                    {/* Grip lines */}
                    <div className="flex flex-col gap-[2px]">
                        <div className="rounded-full" style={{ width: 10, height: 1.5, background: 'rgba(255,255,255,0.35)' }} />
                        <div className="rounded-full" style={{ width: 10, height: 1.5, background: 'rgba(255,255,255,0.35)' }} />
                        <div className="rounded-full" style={{ width: 10, height: 1.5, background: 'rgba(255,255,255,0.35)' }} />
                    </div>
                </div>

                {/* Scrub/hover bubble with connecting line */}
                {hoverLabel && (
                    <>
                        <div
                            className="absolute pointer-events-none"
                            style={{
                                top: hoverY,
                                right: 18,
                                width: 24,
                                height: 1,
                                background: 'rgba(255,255,255,0.2)',
                                transform: 'translateY(-50%)',
                            }}
                        />
                        <div
                            className="absolute px-3 py-1.5 rounded-md text-xs text-white font-medium whitespace-nowrap pointer-events-none"
                            style={{
                                top: hoverY,
                                right: 44,
                                transform: 'translateY(-50%)',
                                background: 'rgba(0,0,0,0.85)',
                                boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
                                border: '1px solid rgba(255,255,255,0.1)',
                            }}
                        >
                            {hoverLabel}
                        </div>
                    </>
                )}
            </div>
        );
    }

    // --- Button mode: navigate-to-top, hold to enter scrub ---
    return (
        <button
            ref={btnRef}
            aria-label="Scroll to top"
            onContextMenu={(e) => e.preventDefault()}
            onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const btn = e.currentTarget;
                let hasPointerCapture = false;
                try {
                    btn.setPointerCapture(e.pointerId);
                    hasPointerCapture = true;
                } catch {}

                const releaseCapture = () => {
                    if (!hasPointerCapture) return;
                    try { btn.releasePointerCapture(e.pointerId); } catch {}
                    hasPointerCapture = false;
                };

                let entered = false;
                const holdTimer = setTimeout(() => {
                    entered = true;
                    setScrubMode(true);
                }, HOLD_MS);

                const stop = () => {
                    clearTimeout(holdTimer);
                    releaseCapture();
                    btn.removeEventListener('pointerup', stop);
                    btn.removeEventListener('pointercancel', stop);
                    if (!entered) scrollToTop();
                };
                btn.addEventListener('pointerup', stop);
                btn.addEventListener('pointercancel', stop);
            }}
            className="absolute z-20 flex items-center justify-center rounded-full bg-black/70 backdrop-blur-sm border border-white/15 select-none"
            style={{
                bottom: 16,
                right: 16,
                width: 40,
                height: 40,
                cursor: 'pointer',
                touchAction: 'none',
                userSelect: 'none',
                WebkitTouchCallout: 'none',
                opacity: atTop ? 0 : 1,
                pointerEvents: atTop ? 'none' : 'auto',
                transition: 'opacity 0.2s',
                boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
            }}
        >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 12V4M4 7l4-3 4 3" />
            </svg>
        </button>
    );
}
