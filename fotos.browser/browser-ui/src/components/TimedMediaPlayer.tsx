import {useCallback, useEffect, useRef, useState, type CSSProperties, type SyntheticEvent} from 'react';
import {Pause, Play, Repeat2} from 'lucide-react';
import {createGifPlaybackTimeline, getGifFrameIndex, type GifAnimation} from '@refinio/media.core/gif';
import {decodeGifInWorker} from '@/lib/gifDecoder';

interface TimedMediaPlayerProps {
    src: string;
    name: string;
    mediaStyle: CSSProperties;
    onReady: (width: number, height: number) => void;
    onLoadStateChange?: (loaded: boolean) => void;
}

function formatTime(timeMs: number): string {
    if (timeMs < 10_000) {
        const totalCentiseconds = Math.max(0, Math.floor(timeMs / 10));
        const minutes = Math.floor(totalCentiseconds / 6_000);
        const seconds = Math.floor((totalCentiseconds % 6_000) / 100);
        const centiseconds = totalCentiseconds % 100;
        return `${minutes}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
    }
    const totalSeconds = Math.max(0, Math.floor(timeMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function stopControlEvent(event: SyntheticEvent) {
    event.stopPropagation();
}

export function TimedMediaPlayer({
    src,
    name,
    mediaStyle,
    onReady,
    onLoadStateChange,
}: TimedMediaPlayerProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationFrameRef = useRef<number | null>(null);
    const currentTimeRef = useRef(0);
    const playbackStartedAtRef = useRef(0);
    const playbackStartedFromRef = useRef(0);
    const renderedFrameRef = useRef(-1);
    const displayedCentisecondRef = useRef(-1);
    const playbackEndedRef = useRef(false);
    const onReadyRef = useRef(onReady);
    const onLoadStateChangeRef = useRef(onLoadStateChange);
    const [animation, setAnimation] = useState<GifAnimation | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [playing, setPlaying] = useState(true);
    const [loopOverride, setLoopOverride] = useState<boolean | null>(null);
    const [currentTimeMs, setCurrentTimeMs] = useState(0);
    onReadyRef.current = onReady;
    onLoadStateChangeRef.current = onLoadStateChange;

    const loopEnabled = animation
        ? loopOverride ?? animation.loopCount !== null
        : false;

    const drawFrame = useCallback((timeMs: number, force = false) => {
        if (!animation) return;

        const frameIndex = getGifFrameIndex(animation, timeMs);
        if (!force && renderedFrameRef.current === frameIndex) return;

        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d');
        if (!canvas || !context) {
            setError('This browser cannot render animated GIF frames.');
            setPlaying(false);
            return;
        }

        if (canvas.width !== animation.width || canvas.height !== animation.height) {
            canvas.width = animation.width;
            canvas.height = animation.height;
        }

        const pixels = context.createImageData(animation.width, animation.height);
        pixels.data.set(animation.frames[frameIndex].rgba);
        context.putImageData(pixels, 0, 0);
        renderedFrameRef.current = frameIndex;
    }, [animation]);

    useEffect(() => {
        const controller = new AbortController();
        let active = true;

        setAnimation(null);
        setLoading(true);
        setError(null);
        setPlaying(true);
        setLoopOverride(null);
        setCurrentTimeMs(0);
        currentTimeRef.current = 0;
        playbackEndedRef.current = false;
        renderedFrameRef.current = -1;
        displayedCentisecondRef.current = -1;
        onLoadStateChangeRef.current?.(false);

        const load = async () => {
            try {
                const response = await fetch(src, {signal: controller.signal});
                if (!response.ok) {
                    throw new Error(`request failed (${response.status})`);
                }
                const bytes = await response.arrayBuffer();
                if (!active) return;

                const decoded = createGifPlaybackTimeline(await decodeGifInWorker(bytes, controller.signal));
                if (decoded.width <= 0 || decoded.height <= 0 || decoded.frames.length === 0) {
                    throw new Error('the file contains no displayable frames');
                }
                if (!active) return;

                setAnimation(decoded);
                setLoading(false);
                setPlaying(decoded.frames.length > 1 && decoded.durationMs > 0);
                onReadyRef.current(decoded.width, decoded.height);
                onLoadStateChangeRef.current?.(true);
            } catch (loadError) {
                if (!active || controller.signal.aborted) return;
                const detail = loadError instanceof Error ? loadError.message : String(loadError);
                setLoading(false);
                setPlaying(false);
                setError(`Unable to play “${name}”: ${detail}`);
                onLoadStateChangeRef.current?.(false);
            }
        };

        void load();
        return () => {
            active = false;
            controller.abort();
        };
    }, [name, src]);

    useEffect(() => {
        if (!animation) return;
        drawFrame(currentTimeRef.current, true);
    }, [animation, drawFrame]);

    useEffect(() => {
        if (!animation || !playing || error) return;

        playbackStartedAtRef.current = performance.now();
        playbackStartedFromRef.current = currentTimeRef.current;

        const tick = (timestamp: number) => {
            const elapsed = playbackStartedFromRef.current + timestamp - playbackStartedAtRef.current;
            const sourceCycles = animation.loopCount === 0
                ? Number.POSITIVE_INFINITY
                : (animation.loopCount ?? 0) + 1;
            const playbackCycles = loopOverride === true
                ? Number.POSITIVE_INFINITY
                : loopOverride === false ? 1 : sourceCycles;
            const playbackDuration = animation.durationMs * playbackCycles;
            const ended = Number.isFinite(playbackDuration) && elapsed >= playbackDuration;
            const nextElapsed = ended ? playbackDuration : elapsed;
            const cycleTime = ended
                ? animation.durationMs
                : nextElapsed % animation.durationMs;
            const frameTime = loopOverride === null
                ? Math.min(nextElapsed, Math.max(0, playbackDuration - 0.001))
                : loopEnabled
                    ? cycleTime
                    : Math.min(cycleTime, Math.max(0, animation.durationMs - 0.001));

            currentTimeRef.current = nextElapsed;
            playbackEndedRef.current = ended;
            const centisecond = Math.floor(cycleTime / 10);
            if (displayedCentisecondRef.current !== centisecond || ended) {
                displayedCentisecondRef.current = centisecond;
                setCurrentTimeMs(cycleTime);
            }
            drawFrame(frameTime);

            if (ended) {
                setPlaying(false);
                return;
            }
            animationFrameRef.current = requestAnimationFrame(tick);
        };

        animationFrameRef.current = requestAnimationFrame(tick);
        return () => {
            if (animationFrameRef.current !== null) {
                cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = null;
            }
        };
    }, [animation, drawFrame, error, loopEnabled, loopOverride, playing]);

    const seek = useCallback((nextTime: number) => {
        if (!animation) return;
        const clamped = Math.min(Math.max(nextTime, 0), animation.durationMs);
        currentTimeRef.current = clamped;
        playbackEndedRef.current = false;
        playbackStartedAtRef.current = performance.now();
        playbackStartedFromRef.current = clamped;
        displayedCentisecondRef.current = Math.floor(clamped / 10);
        setCurrentTimeMs(clamped);
        drawFrame(animation.durationMs > 0
            ? Math.min(clamped, Math.max(0, animation.durationMs - 0.001))
            : 0, true);
    }, [animation, drawFrame]);

    const togglePlaying = useCallback(() => {
        if (!animation) return;
        if (!playing && playbackEndedRef.current) {
            seek(0);
        }
        setPlaying(value => !value);
    }, [animation, playing, seek]);

    return (
        <>
            <canvas
                ref={canvasRef}
                aria-label={`Animated image: ${name}`}
                className="select-none"
                style={{...mediaStyle, zIndex: 1}}
            />

            {loading && (
                <div className="absolute inset-0 z-[2] flex items-center justify-center pointer-events-none">
                    <div className="w-8 h-8 border-2 border-white/10 border-t-white/40 rounded-full animate-spin" />
                </div>
            )}

            {error && (
                <div className="absolute inset-0 z-[2] flex items-center justify-center p-8 text-center text-sm text-red-200/80">
                    {error}
                </div>
            )}

            {animation && animation.frames.length > 1 && animation.durationMs > 0 && !error && (
                <div
                    data-media-controls
                    className="absolute bottom-5 left-1/2 z-20 flex w-[min(34rem,calc(100%-2rem))] -translate-x-1/2 items-center gap-3 rounded-xl border border-white/15 bg-black/75 px-3 py-2 text-white/75 shadow-xl backdrop-blur-sm"
                    role="group"
                    aria-label="Animated image playback"
                    onClick={stopControlEvent}
                    onDoubleClick={stopControlEvent}
                    onMouseDown={stopControlEvent}
                    onTouchStart={stopControlEvent}
                    onTouchMove={stopControlEvent}
                    onTouchEnd={stopControlEvent}
                >
                    <button
                        type="button"
                        onClick={togglePlaying}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
                        aria-label={playing ? 'Pause animated image' : 'Play animated image'}
                    >
                        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </button>
                    <input
                        type="range"
                        min={0}
                        max={animation.durationMs}
                        step={1}
                        value={Math.min(currentTimeMs, animation.durationMs)}
                        onChange={event => seek(Number(event.currentTarget.value))}
                        aria-label="Animated image position"
                        className="min-w-0 flex-1 accent-[#e94560]"
                    />
                    <span className="shrink-0 text-xs tabular-nums text-white/60">
                        {formatTime(currentTimeMs)} / {formatTime(animation.durationMs)}
                    </span>
                    <button
                        type="button"
                        onClick={() => setLoopOverride(!loopEnabled)}
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${loopEnabled ? 'bg-[#e94560]/25 text-[#ff9db0]' : 'bg-white/10 hover:bg-white/20'}`}
                        aria-label={loopEnabled ? 'Disable animated image looping' : 'Enable animated image looping'}
                        aria-pressed={loopEnabled}
                    >
                        <Repeat2 className="h-4 w-4" />
                    </button>
                </div>
            )}
        </>
    );
}
