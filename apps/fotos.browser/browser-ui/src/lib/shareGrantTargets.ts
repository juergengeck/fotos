import {
    resolveGlueIdentityForPeer,
    type SharePeerOption,
} from '@/components/ShareWithField';

function normalizeIdentity(value: string | null | undefined): string | null {
    const trimmed = value?.trim().toLowerCase();
    return trimmed && trimmed.length > 0 ? trimmed : null;
}

/**
 * Identity the reviewed recipient stands for. A name-derived identity is only
 * accepted for a verified peer; an unverified display name vouches for nothing.
 */
function resolveSelectedIdentity(peer: SharePeerOption): string | null {
    const explicitIdentity = normalizeIdentity(peer.glueIdentity);
    if (explicitIdentity) {
        return explicitIdentity;
    }
    return peer.hasVerifiedIdentity ? resolveGlueIdentityForPeer(peer) : null;
}

/**
 * Expand a reviewed recipient to the other Person IDs of the same identity.
 *
 * Only peers carrying an explicit identity (the contact's Person email, which is
 * bound to its Person ID) join the grant. Display names are self-asserted, so a
 * peer is never added because its name matches the reviewed recipient.
 */
export function resolveShareGrantPersonIds(
    selectedPersonId: string,
    peers: readonly SharePeerOption[],
): string[] {
    const normalizedSelectedPersonId = selectedPersonId.trim();
    if (!normalizedSelectedPersonId) {
        return [];
    }

    const selectedPeer = peers.find(peer => peer.personId === normalizedSelectedPersonId);
    const selectedIdentity = selectedPeer ? resolveSelectedIdentity(selectedPeer) : null;
    if (!selectedIdentity) {
        return [normalizedSelectedPersonId];
    }

    const grantIds = new Set([normalizedSelectedPersonId]);
    for (const peer of peers) {
        const normalizedPeerId = peer.personId.trim();
        if (!normalizedPeerId || normalizedPeerId === normalizedSelectedPersonId) {
            continue;
        }
        if (normalizeIdentity(peer.glueIdentity) === selectedIdentity) {
            grantIds.add(normalizedPeerId);
        }
    }

    return [...grantIds];
}
