import { useEffect, useRef, type PointerEvent, type ReactNode, type RefObject } from 'react';

interface Props {
  scrollRef: RefObject<HTMLElement | null>;
  progress: number;
  topInset: number;
  scrubbing: boolean;
  onScrubbingChange: (value: boolean) => void;
  onScrollToTop: () => void;
  children?: ReactNode;
}

/** Position derives from the current track and scroll ratio, never stale pixel offsets. */
export function FeedScrollControl({ scrollRef, progress, topInset, scrubbing, onScrubbingChange, onScrollToTop, children }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ id: number; y: number; scrollTop: number; wasScrubbing: boolean; entered: boolean; moved: boolean } | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHold = () => {
    if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };
  useEffect(() => () => clearHold(), []);

  const finish = (event: PointerEvent<HTMLButtonElement>, cancelled = false) => {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    clearHold();
    gesture.current = null;
    if (cancelled) {
      if (scrollRef.current) scrollRef.current.scrollTop = current.scrollTop;
      onScrubbingChange(current.wasScrubbing);
    } else if (!current.entered) {
      onScrollToTop();
    } else if (current.wasScrubbing && !current.moved) {
      onScrubbingChange(false);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const ratio = scrubbing ? Math.max(0, Math.min(1, progress)) : 1;
  return (
    <div ref={track} data-feed-scrub-track style={{ position: 'absolute',
      top: `max(${topInset + 16}px, calc(env(safe-area-inset-top, 0px) + 16px))`,
      bottom: 'max(16px, env(safe-area-inset-bottom, 0px))', right: 16, width: 112,
      // Above the gallery header (20) and surface handles (30).
      zIndex: 40, pointerEvents: 'none' }}>
      <div ref={dock} data-feed-scrub-dock style={{ position: 'absolute', right: 0, top: `${ratio * 100}%`,
        transform: `translateY(-${ratio * 100}%)`, display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: 10, maxHeight: '100%', overflow: 'hidden', userSelect: 'none', WebkitUserSelect: 'none' }}>
        <button type="button" aria-label={scrubbing ? 'Scrub gallery' : 'Scroll to top'} draggable={false}
          onContextMenu={event => event.preventDefault()}
          onDragStart={event => event.preventDefault()}
          onPointerDown={event => {
            if (!event.isPrimary || event.button !== 0 || !scrollRef.current) return;
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            gesture.current = { id: event.pointerId, y: event.clientY, scrollTop: scrollRef.current.scrollTop,
              wasScrubbing: scrubbing, entered: scrubbing, moved: false };
            if (!scrubbing) holdTimer.current = setTimeout(() => {
              holdTimer.current = null;
              if (!gesture.current) return;
              gesture.current.entered = true;
              onScrubbingChange(true);
            }, 300);
          }}
          onPointerMove={event => {
            const current = gesture.current;
            const scroller = scrollRef.current;
            if (!current || current.id !== event.pointerId || !current.entered || !scroller || !track.current || !dock.current) return;
            const delta = event.clientY - current.y;
            current.moved ||= Math.abs(delta) > 4;
            if (!current.moved) return;
            const travel = Math.max(1, track.current.clientHeight - dock.current.offsetHeight);
            const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
            scroller.scrollTop = Math.max(0, Math.min(maximum, current.scrollTop + delta / travel * maximum));
          }}
          onPointerUp={event => finish(event)}
          onPointerCancel={event => finish(event, true)}
          onLostPointerCapture={event => finish(event, true)}
          onClick={event => { if (event.detail === 0) { if (scrubbing) onScrubbingChange(false); else onScrollToTop(); } }}
          onKeyDown={event => {
            if (!scrubbing || !scrollRef.current) return;
            const scroller = scrollRef.current;
            if (event.key === 'Home' || event.key === 'End' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault();
              scroller.scrollTop = event.key === 'Home' ? 0 : event.key === 'End' ? scroller.scrollHeight
                : scroller.scrollTop + (event.key === 'ArrowUp' ? -1 : 1) * scroller.clientHeight * 0.1;
            }
          }}
          style={{ width: 44, height: 44, flexShrink: 0, borderRadius: '50%', border: '1px solid var(--border)',
            background: 'var(--bg-secondary)', color: 'var(--fg)', fontSize: 18, cursor: 'pointer', display: 'flex',
            alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
            touchAction: 'none', pointerEvents: 'auto', WebkitTouchCallout: 'none' }}>
          {scrubbing ? '⇕' : '↑'}
        </button>
        {children}
      </div>
    </div>
  );
}
