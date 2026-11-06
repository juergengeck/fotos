import type {Person} from '@refinio/one.core/lib/recipes.js';
import {SET_ACCESS_MODE} from '@refinio/one.core/lib/storage-base-common.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import {
    FOTOS_SHARE_PIN_MAX_ATTEMPTS,
    createFotosSharePinProof,
    verifyFotosSharePinProof,
    type FotosSharePinProof,
} from '@refinio/fotos.core';

export type FotosSharePinProofOutcome = 'grant' | 'mismatch' | 'exhausted' | 'ignore';

export interface PendingGalleryInvite {
    pin: string;
    attempts: number;
    remotePersonId: string | null;
}

export interface FotosSharePinProofDeps {
    calculateIdHash(object: unknown): Promise<unknown>;
    storeVersioned(object: FotosSharePinProof): Promise<{hash: SHA256Hash<FotosSharePinProof>}>;
    setAccess(entries: Array<Record<string, unknown>>): Promise<void>;
    getProof(hash: string): Promise<FotosSharePinProof>;
}

/**
 * Decide what one observed PIN proof means for a pending invitation. Pure so
 * the sender's verification policy stays unit-testable without a ONE runtime.
 */
export function decidePinProofOutcome(
    pending: PendingGalleryInvite | undefined,
    proof: Pick<FotosSharePinProof, 'token' | 'sender' | 'prover' | 'pin'>,
    expected: {token: string; sender: string; prover: string},
): FotosSharePinProofOutcome {
    if (!pending) return 'ignore';
    if (proof.token !== expected.token) return 'ignore';
    if (String(proof.sender) !== expected.sender) return 'ignore';
    if (String(proof.prover) !== expected.prover) return 'ignore';
    const matches = verifyFotosSharePinProof(proof as FotosSharePinProof, {
        token: expected.token,
        sender: expected.sender,
        prover: expected.prover,
        pin: pending.pin,
    });
    if (matches) return 'grant';
    return pending.attempts + 1 >= FOTOS_SHARE_PIN_MAX_ATTEMPTS ? 'exhausted' : 'mismatch';
}

/**
 * Send proof of the invitation PIN to the sender as a ONE object over CHUM.
 * Access is granted to the sender's Person only (besides the prover's own
 * device), so the PIN travels inside CHUM and never appears in the link. The
 * IdAccess grant is established before storing, so an already-running CHUM
 * session observes the proof.
 */
export async function submitFotosSharePinProof(
    params: {
        token: string;
        sender: SHA256IdHash<Person>;
        prover: SHA256IdHash<Person>;
        pin: string;
    },
    deps: FotosSharePinProofDeps,
): Promise<SHA256Hash<FotosSharePinProof>> {
    const proof = createFotosSharePinProof(params);
    const proofIdHash = await deps.calculateIdHash({$type$: proof.$type$, id: proof.id});
    await deps.setAccess([
        {
            id: proofIdHash,
            person: [String(params.sender)],
            hashGroup: [],
            mode: SET_ACCESS_MODE.ADD,
        },
    ]);
    const stored = await deps.storeVersioned(proof);
    return stored.hash;
}
