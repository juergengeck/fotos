import {sign} from '@refinio/one.models/lib/misc/Signature.js';
import {
    commitFotosShareScope as commitSharedFotosShareScope,
    createFotosSharePublicationDeps,
    type CommitFotosShareScopeParams,
    type CommitFotosShareScopeResult,
    type FotosShareCertificateDeps,
} from '@refinio/fotos.core/share-publication';
import {traceFotosSharePhase} from './fotosShareTrace.js';

export type {
    CommitFotosShareScopeParams,
    CommitFotosShareScopeResult,
    FotosShareCertificateDeps,
    FotosShareCertificateTransition,
} from '@refinio/fotos.core/share-publication';

const defaultDeps = createFotosSharePublicationDeps(
    async (hash, issuer) => (await sign(hash, issuer)).hash,
);

/** Commit recipient assignments with the browser's signer and phase diagnostics. */
export function commitFotosShareScope(
    params: CommitFotosShareScopeParams,
    deps: FotosShareCertificateDeps = defaultDeps,
): Promise<CommitFotosShareScopeResult> {
    return commitSharedFotosShareScope(params, deps, traceFotosSharePhase);
}
