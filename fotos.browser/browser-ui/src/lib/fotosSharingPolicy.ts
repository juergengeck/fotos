import type { FotosShareAssignments } from './fotosCollections.js';

function uniquePersonIds(values: Iterable<string>): string[] {
    const seen = new Set<string>();
    const unique: string[] = [];

    for (const value of values) {
        const normalized = value.trim();
        if (!normalized || seen.has(normalized)) {
            continue;
        }

        seen.add(normalized);
        unique.push(normalized);
    }

    return unique.sort((left, right) => left.localeCompare(right));
}

export function collectSharedPersonIds(sharing: FotosShareAssignments): string[] {
    return uniquePersonIds([
        ...sharing.galleryPersonIds,
        ...Object.values(sharing.collectionPersonIds).flat(),
        ...Object.values(sharing.clusterPersonIds).flat(),
    ]);
}

export function buildAcceptedIncomingSharingPeerIds(options: {
    sharing: FotosShareAssignments;
    contactPersonIds: readonly string[];
    acceptSharing: boolean;
}): string[] {
    const sharedPersonIds = collectSharedPersonIds(options.sharing);
    if (!options.acceptSharing) {
        return sharedPersonIds;
    }

    return uniquePersonIds([
        ...sharedPersonIds,
        ...options.contactPersonIds,
    ]);
}

export function shouldAdvertiseSharingIdentity(options: {
    sharing: FotosShareAssignments;
    acceptSharing: boolean;
}): boolean {
    return options.acceptSharing || collectSharedPersonIds(options.sharing).length > 0;
}
