const TRACE_QUERY_KEY = 'traceHang';
const TRACE_STORAGE_KEY = 'fotos.traceHang';
const TRACE_PREFIX = '[hang-trace]';

import { addTraceEntry } from './traceStore';

declare global {
    interface Window {
        __fotosHangTraceInstalled?: boolean;
    }
}

function readEnabledFlag(): boolean {
    if (typeof window === 'undefined') return false;

    try {
        const params = new URLSearchParams(window.location.search);
        if (params.has(TRACE_QUERY_KEY)) {
            localStorage.setItem(TRACE_STORAGE_KEY, '1');
            return true;
        }
    } catch {
        // Ignore malformed URLs and storage failures.
    }

    try {
        return localStorage.getItem(TRACE_STORAGE_KEY) === '1';
    } catch {
        return false;
    }
}

export function isHangTraceEnabled(): boolean {
    return readEnabledFlag();
}

export function traceHang(message: string, details?: unknown): void {
    if (!readEnabledFlag()) return;

    addTraceEntry({
        ts: new Date().toISOString(),
        level: 'log',
        message,
        details,
    });

    if (details === undefined) {
        console.log(`${TRACE_PREFIX} ${message}`);
        return;
    }

    console.log(`${TRACE_PREFIX} ${message}`, details);
}

function describeTarget(target: EventTarget | null): string {
    if (!(target instanceof Element)) return 'unknown';

    const id = target.id ? `#${target.id}` : '';
    const className = typeof target.className === 'string'
        ? target.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.')
        : '';
    const classes = className ? `.${className}` : '';
    const label = target.getAttribute('aria-label')
        ?? target.getAttribute('data-date')
        ?? target.getAttribute('type')
        ?? '';

    return `${target.tagName.toLowerCase()}${id}${classes}${label ? `(${label})` : ''}`;
}

export function installHangTrace(label: string): void {
    if (!readEnabledFlag()) return;
    if (typeof window === 'undefined') return;
    if (window.__fotosHangTraceInstalled) return;

    window.__fotosHangTraceInstalled = true;
    traceHang('enabled', { label, href: window.location.href });

    let lastInterval = performance.now();
    window.setInterval(() => {
        const now = performance.now();
        const drift = now - lastInterval - 1000;
        if (drift > 250) {
            addTraceEntry({
                ts: new Date().toISOString(),
                level: 'warn',
                message: 'event-loop-lag',
                details: { driftMs: Math.round(drift) },
            });
            console.warn(`${TRACE_PREFIX} event-loop-lag`, { driftMs: Math.round(drift) });
        }
        lastInterval = now;
    }, 1000);

    let lastFrame = performance.now();
    const frameLoop = (ts: number) => {
        const gap = ts - lastFrame;
        if (gap > 250) {
            addTraceEntry({
                ts: new Date().toISOString(),
                level: 'warn',
                message: 'raf-gap',
                details: { gapMs: Math.round(gap) },
            });
            console.warn(`${TRACE_PREFIX} raf-gap`, { gapMs: Math.round(gap) });
        }
        lastFrame = ts;
        window.requestAnimationFrame(frameLoop);
    };
    window.requestAnimationFrame(frameLoop);

    if ('PerformanceObserver' in window) {
        const supported = PerformanceObserver.supportedEntryTypes ?? [];
        if (supported.includes('longtask')) {
            const observer = new PerformanceObserver(list => {
                for (const entry of list.getEntries()) {
                    addTraceEntry({
                        ts: new Date().toISOString(),
                        level: 'warn',
                        message: 'longtask',
                        details: {
                            name: entry.name,
                            durationMs: Math.round(entry.duration),
                            startMs: Math.round(entry.startTime),
                        },
                    });
                    console.warn(`${TRACE_PREFIX} longtask`, {
                        name: entry.name,
                        durationMs: Math.round(entry.duration),
                        startMs: Math.round(entry.startTime),
                    });
                }
            });
            observer.observe({ entryTypes: ['longtask'] });
        }
    }

    document.addEventListener('pointerdown', event => {
        traceHang('pointerdown', { target: describeTarget(event.target) });
    }, true);

    document.addEventListener('click', event => {
        traceHang('click', { target: describeTarget(event.target) });
    }, true);

    document.addEventListener('visibilitychange', () => {
        traceHang('visibility', { hidden: document.hidden });
    });

    window.addEventListener('error', event => {
        addTraceEntry({
            ts: new Date().toISOString(),
            level: 'error',
            message: 'window-error',
            details: {
                message: event.message,
                source: event.filename,
                line: event.lineno,
                column: event.colno,
            },
        });
        console.warn(`${TRACE_PREFIX} window-error`, {
            message: event.message,
            source: event.filename,
            line: event.lineno,
            column: event.colno,
        });
    });

    window.addEventListener('unhandledrejection', event => {
        addTraceEntry({
            ts: new Date().toISOString(),
            level: 'error',
            message: 'unhandled-rejection',
            details: {
                reason: String(event.reason),
            },
        });
        console.warn(`${TRACE_PREFIX} unhandled-rejection`, {
            reason: String(event.reason),
        });
    });
}
