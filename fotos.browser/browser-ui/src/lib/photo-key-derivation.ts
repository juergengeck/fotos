/**
 * Photo-based key derivation.
 *
 * Current derivation delegates to recovery.core. Recovery also needs legacy
 * support for fotos ids created before the salt moved from
 * `one.photo.key.v1` to `one.recovery.key.v1`.
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

const LEGACY_APPLICATION_SALT = 'one.photo.key.v1';
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function getImageMimeType(bytes: Uint8Array): string {
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
        return 'image/jpeg';
    }
    if (bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)) {
        return 'image/png';
    }
    return 'application/octet-stream';
}

// ---------------------------------------------------------------------------
// Public API — same signatures as the old inline implementation
// ---------------------------------------------------------------------------

interface PhotoKeyDerivationOptions {
    images: Uint8Array[];
    passphrase: string;
    memoryCost?: number;
    timeCost?: number;
    parallelism?: number;
}

interface DerivedKeyResult {
    seed: Uint8Array;
    publicKey: Uint8Array;
    secretKey: Uint8Array;
}

async function deriveLegacyRecoveryKey(
    files: Array<{bytes: Uint8Array; mimeType: string}>,
    passphrase: string,
    params?: {
        memoryCost?: number;
        timeCost?: number;
        parallelism?: number;
    },
): Promise<DerivedKeyResult> {
    if (files.length === 0) {
        throw new Error('At least one file is required');
    }

    for (const file of files) {
        if (file.bytes.length === 0) {
            throw new Error('File must not be empty');
        }
    }

    if (!passphrase) {
        throw new Error('Passphrase must not be empty');
    }

    const passphraseBytes = new TextEncoder().encode(passphrase);
    const totalLength =
        files.reduce((sum, file) => sum + file.bytes.length, 0) + passphraseBytes.length;
    const concatenated = new Uint8Array(totalLength);
    let offset = 0;
    for (const file of files) {
        concatenated.set(file.bytes, offset);
        offset += file.bytes.length;
    }
    concatenated.set(passphraseBytes, offset);

    const mergedParams = {
        memoryCost: params?.memoryCost ?? 262144,
        timeCost: params?.timeCost ?? 3,
        parallelism: params?.parallelism ?? 4,
        hashLength: 32,
    };
    const salt = new TextEncoder().encode(LEGACY_APPLICATION_SALT);
    const seed = await deriveDeps.argon2id(concatenated, salt, mergedParams);
    const keypair = deriveDeps.createSignKeyPairFromSeed(seed);

    return {
        seed,
        publicKey: keypair.publicKey,
        secretKey: keypair.secretKey,
    };
}

export async function deriveKeyFromPhotos(
    options: PhotoKeyDerivationOptions,
): Promise<DerivedKeyResult> {
    const {images, passphrase, memoryCost, timeCost, parallelism} = options;

    if (passphrase.trim().length === 0) {
        throw new Error('Passphrase must not be empty');
    }

    const files = images.map(bytes => ({bytes, mimeType: getImageMimeType(bytes)}));

    const params =
        memoryCost !== undefined || timeCost !== undefined || parallelism !== undefined
            ? {memoryCost, timeCost, parallelism}
            : undefined;

    return deriveRecoveryKey(files, passphrase, deriveDeps, params);
}

export async function deriveRecoveryKeyCandidatesFromPhotos(
    options: PhotoKeyDerivationOptions,
): Promise<DerivedKeyResult[]> {
    const current = await deriveKeyFromPhotos(options);
    // Fotos ids created before media extraction used the current salt with raw bytes.
    const rawCurrent = await deriveRecoveryKey(
        options.images.map(bytes => ({bytes, mimeType: 'application/octet-stream'})),
        options.passphrase,
        deriveDeps,
        options.memoryCost !== undefined || options.timeCost !== undefined || options.parallelism !== undefined
            ? {
                memoryCost: options.memoryCost,
                timeCost: options.timeCost,
                parallelism: options.parallelism,
            }
            : undefined,
    );
    const legacy = await deriveLegacyRecoveryKey(
        options.images.map(bytes => ({bytes, mimeType: 'application/octet-stream'})),
        options.passphrase,
        {
            memoryCost: options.memoryCost,
            timeCost: options.timeCost,
            parallelism: options.parallelism,
        },
    );

    const keys = [current];
    for (const candidate of [rawCurrent, legacy]) {
        if (!keys.some(key => key.publicKey.every((byte, i) => byte === candidate.publicKey[i]))) {
            keys.push(candidate);
        }
    }
    return keys;
}

export function signRecoveryRequest(
    result: DerivedKeyResult,
    personId: string,
): RecoveryRequest {
    return coreSignRecoveryRequest(result.secretKey, result.publicKey, personId, signDeps);
}

export type {DerivedKeyResult, PhotoKeyDerivationOptions, RecoveryKeyPair, RecoveryRequest};
