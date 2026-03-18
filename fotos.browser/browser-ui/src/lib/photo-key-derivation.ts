import { argon2id } from 'hash-wasm';
import { createSignKeyPairFromSeed, sign as signDetached, ensureSecretSignKey } from '@refinio/one.core/lib/crypto/sign.js';

const APPLICATION_SALT = 'one.photo.key.v1';

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

export async function deriveKeyFromPhotos(options: PhotoKeyDerivationOptions): Promise<DerivedKeyResult> {
    const {
        images,
        pin,
        memoryCost = 262144,
        timeCost = 3,
        parallelism = 4,
    } = options;

    if (images.length === 0) {
        throw new Error('At least one image is required');
    }
    for (const img of images) {
        if (img.length === 0) {
            throw new Error('Each image must be non-empty');
        }
    }
    if (!/^\d{8}$/.test(pin)) {
        throw new Error('PIN must be exactly 8 digits');
    }

    // Concatenate: img1 || img2 || ... || imgN || PIN (ASCII bytes)
    const pinBytes = new TextEncoder().encode(pin);
    const totalLength = images.reduce((sum, img) => sum + img.length, 0) + pinBytes.length;
    const password = new Uint8Array(totalLength);
    let offset = 0;
    for (const img of images) {
        password.set(img, offset);
        offset += img.length;
    }
    password.set(pinBytes, offset);

    const hashHex = await argon2id({
        password,
        salt: new TextEncoder().encode(APPLICATION_SALT),
        parallelism,
        iterations: timeCost,
        memorySize: memoryCost,
        hashLength: 32,
        outputType: 'hex',
    });

    // Convert hex to Uint8Array
    const seed = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
        seed[i] = parseInt(hashHex.slice(i * 2, i * 2 + 2), 16);
    }

    const keyPair = createSignKeyPairFromSeed(seed);

    return {
        seed,
        publicKey: keyPair.publicKey as Uint8Array,
        secretKey: keyPair.secretKey as Uint8Array,
    };
}

function hexEncode(bytes: Uint8Array): string {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Build and sign a recovery request from a derived keypair.
 * Returns a ready-to-POST JSON body.
 */
export function signRecoveryRequest(
    result: DerivedKeyResult,
    personId: string,
): {
    personId: string;
    recoveryPubKey: string;
    newSigningPubKey: string;
    newEncryptionPubKey: string;
    timestamp: number;
    signature: string;
} {
    const publicKeyHex = hexEncode(result.publicKey);
    const timestamp = Date.now();
    const message = new TextEncoder().encode(
        `${personId}${publicKeyHex}${publicKeyHex}${timestamp}`
    );
    const signature = signDetached(message, ensureSecretSignKey(result.secretKey));
    return {
        personId,
        recoveryPubKey: publicKeyHex,
        newSigningPubKey: publicKeyHex,
        newEncryptionPubKey: publicKeyHex,
        timestamp,
        signature: hexEncode(signature),
    };
}
