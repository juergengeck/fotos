import { useCallback, useEffect, useRef, useState } from 'react';
import type { PhotoEntry } from '@/types/fotos';
import { FeedScrollControl } from './FeedScrollControl';
import { GalleryTimelineSlider } from './GalleryTimelineSlider';

interface DayGroup { date: string; photos: PhotoEntry[] }
interface TimelineScrubberProps {
    scrollRef: React.RefObject<HTMLElement | null>;
    dayGroups: DayGroup[];
    topInset?: number;
}
interface DayTick { date: string; ratio: number }

function formatDate(date: string): string {
    const parsed = new Date(`${date}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString(undefined, {
        day: 'numeric', month: 'short', year: 'numeric',
    });
}

/** Glue's floating scroll dock and gallery scale, measured from the rendered days. */
export function TimelineScrubber({ scrollRef, dayGroups, topInset = 0 }: TimelineScrubberProps) {
    const [progress, setProgress] = useState(0);
    const [scrubbing, setScrubbing] = useState(false);
    const [activeDate, setActiveDate] = useState<string | null>(null);
    const [ticks, setTicks] = useState<DayTick[]>([]);
    const frame = useRef(0);

    useEffect(() => {
        const scroller = scrollRef.current;
        if (!scroller) return;
        const update = () => {
            frame.current = 0;
            const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
            setProgress(maximum > 0 ? scroller.scrollTop / maximum : 0);
            const rect = scroller.getBoundingClientRect();
            // Rect differences work even when sections have another offset parent.
            const sections = Array.from(scroller.querySelectorAll<HTMLElement>('section[data-date], section[data-gallery-day]'));
            const positions = sections.map(section => ({
                date: section.dataset.date ?? section.dataset.galleryDay!,
                top: section.getBoundingClientRect().top - rect.top - scroller.clientTop + scroller.scrollTop,
            }));
            setTicks(positions.map(section => ({
                date: section.date,
                ratio: maximum > 0 ? Math.max(0, Math.min(1, section.top / maximum)) : 0,
            })));
            let date = positions[0]?.date ?? dayGroups[0]?.date ?? null;
            for (const section of positions) {
                if (section.top > scroller.scrollTop + 28) break;
                date = section.date;
            }
            setActiveDate(date);
        };
        const requestUpdate = () => {
            if (!frame.current) frame.current = requestAnimationFrame(update);
        };
        const observer = new ResizeObserver(requestUpdate);
        observer.observe(scroller);
        for (const child of scroller.children) observer.observe(child);
        scroller.addEventListener('scroll', requestUpdate, { passive: true });
        update();
        return () => {
            observer.disconnect();
            scroller.removeEventListener('scroll', requestUpdate);
            cancelAnimationFrame(frame.current);
            frame.current = 0;
        };
    }, [scrollRef, dayGroups]);

    const scrollToTop = useCallback(() => {
        scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }, [scrollRef]);

    if (!dayGroups.some(group => group.photos.length > 0)) return null;
    const first = dayGroups[0]?.date;
    const last = dayGroups[dayGroups.length - 1]?.date;
    const label = activeDate ? formatDate(activeDate) : undefined;

    return (
        <FeedScrollControl scrollRef={scrollRef} progress={progress} topInset={topInset}
            scrubbing={scrubbing} onScrubbingChange={setScrubbing} onScrollToTop={scrollToTop}>
            <div className="flex flex-col items-center gap-1.5 min-w-11 text-white/55 select-none pointer-events-none">
                {label && <div className="max-w-28 text-[11px] leading-tight text-center text-white">{label}</div>}
                {first && <span className="text-[10px] opacity-70">{formatDate(first)}</span>}
                <GalleryTimelineSlider scrollRef={scrollRef} progress={progress} label={label}>
                    <div className="absolute inset-y-0 w-px bg-white/20" />
                    {ticks.map((tick, index) => (
                        <div key={`${tick.date}-${index}`} className="absolute left-1/2 w-2.5 h-px bg-white/40 rounded-full"
                            style={{ top: `${tick.ratio * 100}%`, transform: 'translate(-50%, -50%)' }} />
                    ))}
                </GalleryTimelineSlider>
                {last && last !== first && <span className="text-[10px] opacity-70">{formatDate(last)}</span>}
            </div>
        </FeedScrollControl>
    );
}
