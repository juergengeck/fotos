import type {Person} from '@refinio/one.core/lib/recipes.js';
import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {FotosSharePinProof} from './recipes/FotosRecipes.js';

/** Number of wrong PIN proofs a pending invitation tolerates before it dies. */
export const FOTOS_SHARE_PIN_MAX_ATTEMPTS = 5;

function requireToken(value: string): string {
    const normalized = value.trim();
    if (!normalized) throw new Error('PIN proof token must not be empty');
    return normalized;
}

/** The PIN is a short numeric second factor the sender shows out of band. */
export function isFotosSharePinFormat(value: string): boolean {
    return /^\d{4}$/.test(value.trim());
}

export function buildFotosSharePinProofId(token: string, prover: string): string {
    return [
        'fotos-share-pin-proof',
        'v1',
        requireToken(token),
        prover.trim(),
    ].join(':');
}

export function createFotosSharePinProof(params: {
    token: string;
    sender: SHA256IdHash<Person>;
    prover: SHA256IdHash<Person>;
    pin: string;
    createdAt?: string;
}): FotosSharePinProof {
    const pin = params.pin.trim();
    if (!isFotosSharePinFormat(pin)) {
        throw new Error('PIN proof requires a four-digit PIN.');
    }
    return {
        $type$: 'FotosSharePinProof',
        $version$: 'v1',
        id: buildFotosSharePinProofId(params.token, String(params.prover)),
        token: requireToken(params.token),
        sender: params.sender,
        prover: params.prover,
        pin,
        createdAt: params.createdAt ?? new Date().toISOString(),
    };
}

function constantTimeEquals(left: string, right: string): boolean {
    if (left.length !== right.length) return false;
    let diff = 0;
    for (let index = 0; index < left.length; index++) {
        diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
    }
    return diff === 0;
}

/**
 * Check one PIN proof against the pending invitation the sender keeps in
 * memory. Returns true only when token, sender, prover, and PIN all match.
 * Attempt counting and invitation invalidation stay with the caller.
 */
export function verifyFotosSharePinProof(
    proof: FotosSharePinProof,
    expected: {token: string; sender: string; prover: string; pin: string},
): boolean {
    if (proof.$type$ !== 'FotosSharePinProof' || proof.$version$ !== 'v1') return false;
    if (proof.token !== expected.token) return false;
    if (String(proof.sender) !== expected.sender) return false;
    if (String(proof.prover) !== expected.prover) return false;
    if (!isFotosSharePinFormat(proof.pin)) return false;
    return constantTimeEquals(proof.pin, expected.pin.trim());
}
