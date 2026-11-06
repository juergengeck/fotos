export interface ProgressState {
    phase?: string;
    current: number;
    total: number;
    fileName?: string;
    statusLabel?: string;
}

export interface ProgressDisplay {
    label: string;
    measured: boolean;
    percent: number | null;
    countLabel: string | null;
}

const PHASE_LABELS: Record<string, string> = {
    scanning: 'Scanning for photos',
    processing: 'Processing photos',
    'preparing-faces': 'Preparing face analytics',
    faces: 'Face analytics',
    'preparing-semantic': 'Preparing semantic search',
    semantic: 'Semantic indexing',
    writing: 'Writing metadata',
    done: 'Library update complete',
};

/**
 * Map engine progress to honest UI state. A fraction is exposed only when both
 * operands are finite and the engine provides a positive total.
 */
export function resolveProgressDisplay(progress: ProgressState): ProgressDisplay {
    const measured = Number.isFinite(progress.current)
        && progress.current >= 0
        && Number.isFinite(progress.total)
        && progress.total > 0;
    const label = PHASE_LABELS[progress.phase ?? ''] ?? 'Updating library';

    if (!measured) {
        return {label, measured: false, percent: null, countLabel: null};
    }

    return {
        label,
        measured: true,
        percent: Math.max(0, Math.min(100, Math.round((progress.current / progress.total) * 100))),
        countLabel: `${progress.current}/${progress.total}`,
    };
}
