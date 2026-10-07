import { useRef, type PointerEvent, type ReactNode, type RefObject } from 'react';

interface Props {
  scrollRef: RefObject<HTMLElement | null>;
  progress: number;
  label?: string;
  children?: ReactNode;
}

/** The marker controls the same scroll ratio used to place the day ticks. */
export function GalleryTimelineSlider({ scrollRef, progress, label, children }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ id: number; y: number; scrollTop: number; height: number } | null>(null);
  const finish = (event: PointerEvent<HTMLButtonElement>, cancelled = false) => {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    gesture.current = null;
    if (cancelled && scrollRef.current) scrollRef.current.scrollTop = current.scrollTop;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return (
    <div ref={track} style={{ position: 'relative', width: 44, height: 76, display: 'flex', justifyContent: 'center' }}>
      {children}
      <button type="button" role="slider" aria-label="Gallery timeline" aria-orientation="vertical"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-valuetext={label}
        draggable={false}
        onDragStart={event => event.preventDefault()}
        onContextMenu={event => event.preventDefault()}
        onPointerDown={event => {
          if (!event.isPrimary || event.button !== 0 || gesture.current || !scrollRef.current || !track.current) return;
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          gesture.current = { id: event.pointerId, y: event.clientY, scrollTop: scrollRef.current.scrollTop,
            height: track.current.getBoundingClientRect().height };
        }}
        onPointerMove={event => {
          const current = gesture.current;
          const scroller = scrollRef.current;
          if (!current || current.id !== event.pointerId || !scroller || current.height <= 0) return;
          const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
          scroller.scrollTop = Math.max(0, Math.min(maximum,
            current.scrollTop + (event.clientY - current.y) / current.height * maximum));
        }}
        onPointerUp={event => finish(event)}
        onPointerCancel={event => finish(event, true)}
        onLostPointerCapture={event => finish(event, true)}
        onKeyDown={event => {
          const scroller = scrollRef.current;
          if (!scroller || !['Home', 'End', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(event.key)) return;
          event.preventDefault();
          const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
          const direction = event.key === 'ArrowUp' || event.key === 'PageUp' ? -1 : 1;
          scroller.scrollTop = event.key === 'Home' ? 0 : event.key === 'End' ? maximum
            : scroller.scrollTop + direction * scroller.clientHeight * (event.key.startsWith('Page') ? 1 : 0.1);
        }}
        style={{ position: 'absolute', top: `${Math.max(0, Math.min(1, progress)) * 100}%`, left: '50%',
          width: 44, height: 24, padding: 0, border: 0, background: 'transparent', borderRadius: 4,
          transform: 'translate(-50%, -50%)', cursor: 'ns-resize', touchAction: 'none', pointerEvents: 'auto',
          display: 'flex', alignItems: 'center', justifyContent: 'center', WebkitTouchCallout: 'none' }}>
        <span style={{ width: 18, height: 2, borderRadius: 999, background: 'var(--accent)',
          boxShadow: '0 0 8px color-mix(in srgb, var(--accent) 52%, transparent)' }} />
      </button>
    </div>
  );
}
