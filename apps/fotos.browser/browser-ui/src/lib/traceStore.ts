export interface TraceEntry {
    ts: string;
    level: 'log' | 'warn' | 'error';
    message: string;
    details?: unknown;
}

const TRACE_LIMIT = 400;
const entries: TraceEntry[] = [];

export function addTraceEntry(entry: TraceEntry): void {
    entries.push(entry);
    if (entries.length > TRACE_LIMIT) {
        entries.splice(0, entries.length - TRACE_LIMIT);
    }
}

export function getTraceEntries(): TraceEntry[] {
    return [...entries];
}

export function clearTraceEntries(): void {
    entries.length = 0;
}
