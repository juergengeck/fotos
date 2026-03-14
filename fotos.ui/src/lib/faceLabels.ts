import type {FaceInfo} from '../types/fotos.js';

export interface FaceNameSummary {
    label: string;
    fullLabel: string;
    names: string[];
    hiddenCount: number;
}

function normalizeFaceName(name?: string): string | null {
    const trimmed = name?.trim();
    if (!trimmed) {
        return null;
    }

    return trimmed.toLowerCase() === 'unknown' ? null : trimmed;
}

export function summarizeNamedFaces(
    faces?: FaceInfo,
    maxVisibleNames = 2,
): FaceNameSummary | null {
    if (!faces || faces.count <= 0) {
        return null;
    }

    const uniqueNames: string[] = [];
    const seenNames = new Set<string>();

    for (let index = 0; index < faces.count; index++) {
        const normalizedName = normalizeFaceName(faces.names?.[index]);
        if (!normalizedName) {
            return null;
        }

        const dedupeKey = normalizedName.toLocaleLowerCase();
        if (seenNames.has(dedupeKey)) {
            continue;
        }

        seenNames.add(dedupeKey);
        uniqueNames.push(normalizedName);
    }

    if (uniqueNames.length === 0) {
        return null;
    }

    const visibleNames = uniqueNames.slice(0, Math.max(1, maxVisibleNames));
    const hiddenCount = Math.max(0, uniqueNames.length - visibleNames.length);
    const fullLabel = uniqueNames.join(', ');

    return {
        label: hiddenCount > 0
            ? `${visibleNames.join(', ')} +${hiddenCount}`
            : fullLabel,
        fullLabel,
        names: uniqueNames,
        hiddenCount,
    };
}
