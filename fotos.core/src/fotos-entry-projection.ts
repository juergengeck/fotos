import type {FotosEntry} from './recipes/FotosRecipes.js';

export type FotosEntryReference = {hash: string; entry: FotosEntry};
export type ProjectedFotosEntryReference = FotosEntryReference & {hashes: string[]};

/** Order exact authorized representatives without choosing or writing a domain version head. */
function compareReferences(left: FotosEntryReference, right: FotosEntryReference): number {
    const leftPath = left.entry.sourcePath ?? '';
    const rightPath = right.entry.sourcePath ?? '';
    if (leftPath !== rightPath) return leftPath < rightPath ? -1 : 1;
    return left.hash === right.hash ? 0 : left.hash < right.hash ? -1 : 1;
}

/**
 * Project one original per content-keyed FotosEntry identity from an exact snapshot.
 * Source path and exact hash choose only its display and hydration representative;
 * every authorized metadata reference remains bound into the item's version.
 */
export function projectFotosEntryReferences(references: readonly FotosEntryReference[]): ProjectedFotosEntryReference[] {
    const images = new Map<string, FotosEntryReference[]>();
    for (const reference of references) {
        const image = images.get(reference.entry.contentHash) ?? [];
        image.push(reference);
        images.set(reference.entry.contentHash, image);
    }
    return [...images.values()].map(image => {
        const selected = image.sort(compareReferences)[0];
        return {...selected, hashes: [...new Set(image.map(reference => reference.hash))].sort()};
    }).sort(compareReferences);
}

/** Preserve single-version metadata and bind repeated image versions in canonical hash order. */
export async function getFotosEntryProjectionVersion(reference: ProjectedFotosEntryReference,
    hash: (value: string) => Promise<string>): Promise<string> {
    return reference.hashes.length === 1 ? reference.hashes[0]
        : hash(JSON.stringify({presentation: 'fotos-image-v1', entries: reference.hashes}));
}
