import type {
    FotosAuthenticityAttestation,
    FotosEntry,
    FotosManifest,
} from '../../../../fotos.core/src/recipes/FotosRecipes.js';
import type { SHA256Hash } from '@refinio/one.core/lib/util/type-checks.js';

type ManifestLike = Pick<FotosManifest, 'entries' | 'authenticityAttestations'> | null | undefined;

export interface MergedFotosManifestState {
    changed: boolean;
    addedEntryCount: number;
    addedAuthenticityCount: number;
    entries: Set<SHA256Hash<FotosEntry>>;
    authenticityAttestations: Set<SHA256Hash<FotosAuthenticityAttestation>>;
}

export function mergeFotosManifestState(
    current: ManifestLike,
    incoming: ManifestLike,
): MergedFotosManifestState {
    const currentEntries = current?.entries ?? new Set<SHA256Hash<FotosEntry>>();
    const incomingEntries = incoming?.entries ?? new Set<SHA256Hash<FotosEntry>>();
    const currentAuthenticity = current?.authenticityAttestations ?? new Set<SHA256Hash<FotosAuthenticityAttestation>>();
    const incomingAuthenticity = incoming?.authenticityAttestations ?? new Set<SHA256Hash<FotosAuthenticityAttestation>>();

    const entries = new Set(currentEntries);
    const authenticityAttestations = new Set(currentAuthenticity);

    let addedEntryCount = 0;
    let addedAuthenticityCount = 0;

    for (const entryHash of incomingEntries) {
        if (!entries.has(entryHash)) {
            entries.add(entryHash);
            addedEntryCount += 1;
        }
    }

    for (const attestationHash of incomingAuthenticity) {
        if (!authenticityAttestations.has(attestationHash)) {
            authenticityAttestations.add(attestationHash);
            addedAuthenticityCount += 1;
        }
    }

    return {
        changed: addedEntryCount > 0 || addedAuthenticityCount > 0,
        addedEntryCount,
        addedAuthenticityCount,
        entries,
        authenticityAttestations,
    };
}
