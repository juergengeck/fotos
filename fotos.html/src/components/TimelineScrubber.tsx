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

export function TimelineScrubber({ scrollRef, dayGroups }: TimelineScrubberProps) {
    const yearSpans = buildYearSpans(dayGroups);
    const trackRef = useRef<HTMLDivElement>(null);
    const [viewTop, setViewTop] = useState(0);
    const [viewHeight, setViewHeight] = useState(0.1);
    const [hoverLabel, setHoverLabel] = useState<string | null>(null);
    const [hoverY, setHoverY] = useState(0);
    const scrubbingRef = useRef(false);
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
        };
        el.addEventListener('scroll', update, { passive: true });
        rafRef.current = requestAnimationFrame(update);
        return () => {
            el.removeEventListener('scroll', update);
            cancelAnimationFrame(rafRef.current);
        };
    }, [scrollRef, dayGroups]);

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

    const onPointerDown = useCallback((e: React.PointerEvent) => {
        const track = trackRef.current;
        if (!track) return;
        e.preventDefault();
        track.setPointerCapture(e.pointerId);
        scrubbingRef.current = true;
        scrubTo(e.clientY);

        const onMove = (me: PointerEvent) => scrubTo(me.clientY);
        const onUp = () => {
            scrubbingRef.current = false;
            setHoverLabel(null);
            track.removeEventListener('pointermove', onMove);
            track.removeEventListener('pointerup', onUp);
            track.removeEventListener('pointercancel', onUp);
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

    if (yearSpans.length < 1) return null;

    const PADDING = 8;

    return (
        <div
            ref={trackRef}
            className="absolute top-0 right-0 bottom-0 w-14 z-20 select-none cursor-pointer"
            style={{ touchAction: 'none' }}
            onPointerDown={onPointerDown}
            onMouseMove={onMouseMove}
            onMouseLeave={onMouseLeave}
        >
            {/* Track line */}
            <div className="absolute right-3 w-0.5 rounded-full bg-white/10"
                style={{ top: PADDING, bottom: PADDING }} />

            {/* Year labels along the track */}
            {yearSpans.map(span => {
                const midPos = (span.start + span.end) / 2;
                return (
                    <div
                        key={span.year}
                        className="absolute right-6 text-[9px] text-white/30 font-medium pointer-events-none whitespace-nowrap"
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
                    className="absolute right-2 w-3 h-px bg-white/15 pointer-events-none"
                    style={{
                        top: `calc(${PADDING}px + ${span.start * 100}%)`,
                    }}
                />
            ))}

            {/* Viewport indicator */}
            <div
                className="absolute right-2.5 w-1.5 rounded-full bg-white/30"
                style={{
                    top: `calc(${PADDING}px + ${viewTop * 100}%)`,
                    height: `max(16px, ${viewHeight * 100}%)`,
                    transition: scrubbingRef.current ? 'none' : 'top 0.1s ease-out',
                }}
            />

            {/* Hover/scrub bubble */}
            {hoverLabel && (
                <div
                    className="absolute right-16 px-3 py-1.5 rounded-lg bg-black/90 text-xs text-white font-medium whitespace-nowrap pointer-events-none shadow-xl border border-white/15"
                    style={{ top: hoverY, transform: 'translateY(-50%)' }}
                >
                    {hoverLabel}
                </div>
            )}
        </div>
    );
}
