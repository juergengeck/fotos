import type {FotosShareScope} from '@refinio/fotos.core';

export type FotosShareTracePhase =
    | 'selected-photo-sync'
    | 'manifest-resolution'
    | 'commit-scope'
    | 'scope-closure'
    | 'scope-root-load-or-create'
    | 'certificate-status-check'
    | 'certificate-store'
    | 'certificate-sign'
    | 'certificate-chain-access'
    | 'certificate-chain-store'
    | 'manifest-access-replace'
    | 'manifest-store';

export interface FotosShareTraceSpan {
    seq: number;
    phase: FotosShareTracePhase;
    scopeKind: FotosShareScope['kind'];
    scopeId: string;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    outcome: 'success' | 'error';
}

const MAX_FOTOS_SHARE_TRACE_SPANS = 100;
const fotosShareTraceSpans: FotosShareTraceSpan[] = [];
let fotosShareTraceSeq = 0;

/** Run one publication phase and retain bounded timing metadata for QA diagnostics. */
export async function traceFotosSharePhase<T>(
    scope: FotosShareScope,
    phase: FotosShareTracePhase,
    operation: () => Promise<T>,
): Promise<T> {
    const startedMs = Date.now();
    const startedAt = new Date(startedMs).toISOString();
    let outcome: FotosShareTraceSpan['outcome'] = 'success';
    try {
        return await operation();
    } catch (error) {
        outcome = 'error';
        throw error;
    } finally {
        const finishedMs = Date.now();
        fotosShareTraceSpans.push({
            seq: ++fotosShareTraceSeq,
            phase,
            scopeKind: scope.kind,
            scopeId: scope.id,
            startedAt,
            finishedAt: new Date(finishedMs).toISOString(),
            durationMs: Math.max(0, finishedMs - startedMs),
            outcome,
        });
        if (fotosShareTraceSpans.length > MAX_FOTOS_SHARE_TRACE_SPANS) {
            fotosShareTraceSpans.splice(
                0,
                fotosShareTraceSpans.length - MAX_FOTOS_SHARE_TRACE_SPANS,
            );
        }
    }
}

/** Return the newest publication phase spans in chronological order. */
export function getFotosShareTraceSpans(limit = 50): FotosShareTraceSpan[] {
    const requestedLimit = Number.isFinite(limit) ? Math.floor(limit) : 50;
    const boundedLimit = Math.min(
        MAX_FOTOS_SHARE_TRACE_SPANS,
        Math.max(1, requestedLimit),
    );
    return fotosShareTraceSpans.slice(-boundedLimit).map(span => ({...span}));
}

/** Clear process-local phase spans between unit tests. */
export function resetFotosShareTraceForTests(): void {
    fotosShareTraceSpans.length = 0;
    fotosShareTraceSeq = 0;
}
