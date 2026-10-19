import type {Signature} from '@refinio/one.models/lib/recipes/SignatureRecipes.js';

interface TrustedShareSignatures {
    verifySignatureWithTrustedKeys(signature: Signature): Promise<boolean>;
}

interface RegisteredShareSignatures {
    /** Verify against registrar-bound keys for the claimed Person. */
    verifyRegisteredPersonSignature(signature: Signature): Promise<boolean>;
}

/** Check local trust first, then the registrar-backed registered identity. */
export function createFotosShareSignatureVerifier(
    trusted: TrustedShareSignatures,
    registered?: RegisteredShareSignatures | null,
): (signature: unknown) => Promise<boolean> {
    return async signature => {
        try {
            if (await trusted.verifySignatureWithTrustedKeys(signature as Signature)) {
                return true;
            }
        } catch {
            // A missing local trust record must not skip registrar verification.
        }
        try {
            return await registered?.verifyRegisteredPersonSignature(signature as Signature) ?? false;
        } catch {
            return false;
        }
    };
}
