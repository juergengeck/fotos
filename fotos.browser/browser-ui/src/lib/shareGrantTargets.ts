import {
    resolveGlueIdentityForPeer,
    type SharePeerOption,
} from '@/components/ShareWithField';

function normalizeDisplayName(value: string | null | undefined): string | null {
    const trimmed = value?.trim().toLowerCase();
    return trimmed && trimmed.length > 0 ? trimmed : null;
}

export function resolveShareGrantPersonIds(
    selectedPersonId: string,
    peers: readonly SharePeerOption[],
): string[] {
    const normalizedSelectedPersonId = selectedPersonId.trim();
    if (!normalizedSelectedPersonId) {
        return [];
    }

    const selectedPeer = peers.find(peer => peer.personId === normalizedSelectedPersonId);
    if (!selectedPeer) {
        return [normalizedSelectedPersonId];
    }

    const selectedGlueIdentity = resolveGlueIdentityForPeer(selectedPeer);
    const selectedDisplayName = normalizeDisplayName(selectedPeer.displayName);
    const grantIds = new Set([normalizedSelectedPersonId]);

    for (const peer of peers) {
        const normalizedPeerId = peer.personId.trim();
        if (!normalizedPeerId || normalizedPeerId === normalizedSelectedPersonId) {
            continue;
        }

        const peerGlueIdentity = resolveGlueIdentityForPeer(peer);
        if (selectedGlueIdentity && peerGlueIdentity === selectedGlueIdentity) {
            grantIds.add(normalizedPeerId);
            continue;
        }

        if (
            !selectedGlueIdentity
            && selectedDisplayName
            && normalizeDisplayName(peer.displayName) === selectedDisplayName
        ) {
            grantIds.add(normalizedPeerId);
        }
    }

    return [...grantIds];
}
