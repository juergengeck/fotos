import { argon2id } from 'hash-wasm';
import nacl from 'tweetnacl';

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

    const keyPair = nacl.sign.keyPair.fromSeed(seed);

    return {
        seed,
        publicKey: keyPair.publicKey,
        secretKey: keyPair.secretKey,
    };
}
