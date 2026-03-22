/**
 * Photo-based key derivation — thin wrapper around @refinio/recovery.core.
 *
 * Delegates to recovery.core's deriveRecoveryKey and signRecoveryRequest with
 * browser-specific deps (hash-wasm for Argon2id, one.core for Ed25519).
 *
 * NOTE: Salt changed from 'one.photo.key.v1' to 'one.recovery.key.v1' (inside
 * recovery.core). This is a breaking change for any previously derived keys.
 * Acceptable because recovery is pre-production.
 */
import {
    deriveRecoveryKey,
    signRecoveryRequest as coreSignRecoveryRequest,
} from '@refinio/recovery.core';
import type {RecoveryDeps, RecoveryKeyPair, RecoveryRequest} from '@refinio/recovery.core';
import {argon2id} from 'hash-wasm';
import {
    createSignKeyPairFromSeed,
    sign as signDetached,
    ensureSecretSignKey,
} from '@refinio/one.core/lib/crypto/sign.js';

// ---------------------------------------------------------------------------
// Browser deps for recovery.core's dependency injection
// ---------------------------------------------------------------------------

const deriveDeps: Pick<RecoveryDeps, 'argon2id' | 'createSignKeyPairFromSeed'> = {
    argon2id: async (password, salt, params) => {
        const hex = await argon2id({
            password,
            salt,
            parallelism: params.parallelism,
            iterations: params.timeCost,
            memorySize: params.memoryCost,
            hashLength: params.hashLength,
            outputType: 'hex',
        });
        const bytes = new Uint8Array(params.hashLength);
        for (let i = 0; i < params.hashLength; i++) {
            bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
        }
        return bytes;
    },
    createSignKeyPairFromSeed: (seed) => {
        const kp = createSignKeyPairFromSeed(seed);
        return {
            publicKey: kp.publicKey as Uint8Array,
            secretKey: kp.secretKey as Uint8Array,
        };
    },
};

const signDeps: Pick<RecoveryDeps, 'sign'> = {
    sign: (message, secretKey) =>
        signDetached(message, ensureSecretSignKey(secretKey)) as Uint8Array,
};

// ---------------------------------------------------------------------------
// Public API — same signatures as the old inline implementation
// ---------------------------------------------------------------------------

interface PhotoKeyDerivationOptions {
    images: Uint8Array[];
    pin: string;
    memoryCost?: number;
    timeCost?: number;
    parallelism?: number;
}

interface DerivedKeyResult {
    seed: Uint8Array;
    publicKey: Uint8Array;
    secretKey: Uint8Array;
}

export async function deriveKeyFromPhotos(
    options: PhotoKeyDerivationOptions,
): Promise<DerivedKeyResult> {
    const {images, pin, memoryCost, timeCost, parallelism} = options;

    // PIN validation stays here — recovery.core accepts any non-empty passphrase
    if (!/^\d{8}$/.test(pin)) {
        throw new Error('PIN must be exactly 8 digits');
    }

    // Wrap raw bytes as files with opaque mimeType so extractRecoverableBytes
    // passes them through unchanged (same behavior as the old implementation).
    const files = images.map(bytes => ({bytes, mimeType: 'application/octet-stream'}));

    const params =
        memoryCost !== undefined || timeCost !== undefined || parallelism !== undefined
            ? {memoryCost, timeCost, parallelism}
            : undefined;

    return deriveRecoveryKey(files, pin, deriveDeps, params);
}

export function signRecoveryRequest(
    result: DerivedKeyResult,
    personId: string,
): RecoveryRequest {
    return coreSignRecoveryRequest(result.secretKey, result.publicKey, personId, signDeps);
}

export type {DerivedKeyResult, PhotoKeyDerivationOptions, RecoveryKeyPair, RecoveryRequest};
