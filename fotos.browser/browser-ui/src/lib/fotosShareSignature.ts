import type {Signature} from '@refinio/one.models/lib/recipes/SignatureRecipes.js';

interface TrustedShareSignatures {
    verifySignatureWithTrustedKeys(signature: Signature): Promise<boolean>;
}

/** Reopening stored shares uses native local trust and never registrar approval. */
export function createFotosShareSignatureVerifier(
    trusted: TrustedShareSignatures,
): (signature: unknown) => Promise<boolean> {
    return async signature => {
        try {
            return await trusted.verifySignatureWithTrustedKeys(signature as Signature);
        } catch {
            return false;
        }
    };
}
