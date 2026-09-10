import {useEffect, useMemo, useState} from 'react';

interface RunnerStep {
    id: string;
    title: string;
    status: 'pending' | 'running' | 'passed' | 'failed' | 'stopped';
    durationMs: number | null;
    summary: string | null;
}

interface RunnerState {
    runId: string | null;
    profile: 'ui' | 'full' | null;
    status: 'idle' | 'running' | 'passed' | 'failed' | 'stopped';
    reportPath: string | null;
    coverage: {documented: number; mapped: number; missing: string[]; stale: string[]};
    steps: RunnerStep[];
    logs: string[];
    error: string | null;
}

const EMPTY_STATE: RunnerState = {
    runId: null,
    profile: null,
    status: 'idle',
    reportPath: null,
    coverage: {documented: 0, mapped: 0, missing: [], stale: []},
    steps: [],
    logs: [],
    error: null,
};

function statusClass(status: RunnerState['status'] | RunnerStep['status']): string {
    if (status === 'passed') return 'text-emerald-200';
    if (status === 'failed') return 'text-red-300';
    if (status === 'running') return 'text-sky-200';
    if (status === 'stopped') return 'text-amber-200';
    return 'text-white/55';
}

export function FotosTestRunnerPanel() {
    const [state, setState] = useState<RunnerState>(EMPTY_STATE);
    const [requestError, setRequestError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        void fetch('/__fotos-tests/status')
            .then(response => response.json())
            .then(value => { if (active) setState(value); })
            .catch(error => { if (active) setRequestError(error instanceof Error ? error.message : String(error)); });
        const events = new EventSource('/__fotos-tests/events');
        events.onmessage = event => {
            if (!active) return;
            try {
                setState(JSON.parse(event.data));
                setRequestError(null);
            } catch (error) {
                setRequestError(error instanceof Error ? error.message : String(error));
            }
        };
        events.onerror = () => { if (active) setRequestError('Runner event stream disconnected'); };
        return () => {
            active = false;
            events.close();
        };
    }, []);

    const recentLogs = useMemo(() => state.logs.slice(-80).join('\n'), [state.logs]);

    const start = async (profile: 'ui' | 'full') => {
        setRequestError(null);
        try {
            const response = await fetch('/__fotos-tests/run', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({profile, baseUrl: `${window.location.origin}/`}),
            });
            const value = await response.json();
            if (!response.ok) {
                setRequestError(value.error ?? `Runner returned ${response.status}`);
                return;
            }
            setState(value);
        } catch (error) {
            setRequestError(error instanceof Error ? error.message : String(error));
        }
    };

    const stop = async () => {
        setRequestError(null);
        try {
            const response = await fetch('/__fotos-tests/stop', {method: 'POST'});
            setState(await response.json());
        } catch (error) {
            setRequestError(error instanceof Error ? error.message : String(error));
        }
    };

    const running = state.status === 'running';
    const coverageReady = state.coverage.documented > 0;

    return (
        <section aria-label="Fotos QA runner" className="space-y-3 rounded-lg border border-sky-400/20 bg-sky-400/[0.04] p-3">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-sky-100/85">Integrated QA runner</div>
                    <p className="mt-1 text-xs leading-relaxed text-white/55">
                        Drives fresh desktop and mobile browsers. Full protocol also runs contract tests and real multi-instance sync, sharing, and revocation.
                    </p>
                </div>
                <span className={`shrink-0 text-xs font-semibold uppercase ${statusClass(state.status)}`}>{state.status}</span>
            </div>

            <div className="rounded-md border border-white/10 bg-black/20 px-2.5 py-2 text-xs text-white/60">
                {coverageReady
                    ? `${state.coverage.mapped}/${state.coverage.documented} PRD flows mapped${state.coverage.missing.length ? ` · missing ${state.coverage.missing.join(', ')}` : ''}`
                    : 'Coverage is checked at protocol start.'}
            </div>

            <div className="flex flex-wrap gap-2">
                <button type="button" disabled={running} onClick={() => { void start('ui'); }} className="min-h-11 rounded-md bg-sky-500/20 px-3 text-xs font-medium text-sky-100 hover:bg-sky-500/30 disabled:cursor-not-allowed disabled:opacity-35">
                    Run UI protocol
                </button>
                <button type="button" disabled={running} onClick={() => { void start('full'); }} className="min-h-11 rounded-md bg-[#e94560] px-3 text-xs font-medium text-white hover:bg-[#d13354] disabled:cursor-not-allowed disabled:opacity-35">
                    Run full protocol
                </button>
                {running ? (
                    <button type="button" onClick={() => { void stop(); }} className="min-h-11 rounded-md border border-amber-300/25 px-3 text-xs text-amber-100 hover:bg-amber-400/10">
                        Stop
                    </button>
                ) : null}
                {state.reportPath ? (
                    <a href="/__fotos-tests/report" target="_blank" rel="noreferrer" className="flex min-h-11 items-center rounded-md px-3 text-xs text-white/65 hover:bg-white/8 hover:text-white">
                        Open report
                    </a>
                ) : null}
            </div>

            {state.steps.length > 0 ? (
                <ol className="space-y-1.5">
                    {state.steps.map(step => (
                        <li key={step.id} className="rounded-md border border-white/8 bg-black/15 px-2.5 py-2 text-xs">
                            <div className="flex items-start gap-2">
                                <span className={`w-14 shrink-0 uppercase ${statusClass(step.status)}`}>{step.status}</span>
                                <span className="min-w-0 flex-1 text-white/72">{step.title}</span>
                                {step.durationMs !== null ? <span className="shrink-0 tabular-nums text-white/45">{(step.durationMs / 1000).toFixed(1)}s</span> : null}
                            </div>
                            {step.summary ? <div className="mt-1 pl-16 text-white/50">{step.summary}</div> : null}
                        </li>
                    ))}
                </ol>
            ) : null}

            {requestError || state.error ? <div role="alert" className="rounded-md border border-red-400/20 bg-red-500/10 px-2.5 py-2 text-xs text-red-200">{requestError ?? state.error}</div> : null}

            {recentLogs ? (
                <details>
                    <summary className="min-h-11 cursor-pointer py-3 text-xs text-white/60">Protocol log</summary>
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-black/40 p-2 text-[11px] leading-relaxed text-white/55">{recentLogs}</pre>
                </details>
            ) : null}
        </section>
    );
}
