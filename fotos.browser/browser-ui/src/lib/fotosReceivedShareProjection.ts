import type {Person} from '@refinio/one.core/lib/recipes.js';
import {getAllEntries} from '@refinio/one.core/lib/reverse-map-query.js';
import {getObjectWithType} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {getObjectByIdHash} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {calculateIdHashOfObj} from '@refinio/one.core/lib/util/object.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import {
    buildFotosShareCertificateId,
    buildFotosShareCertificateChainId,
    buildFotosShareManifestId,
    type FotosShareCertificate,
    type FotosShareCertificateChain,
    type FotosShareManifest,
    type FotosShareScope,
} from '@refinio/fotos.core';

export interface ReceivedFotosShareScope {
    certificateIdHash: string;
    certificateHash: string;
    issuer: string;
    scope: FotosShareScope;
    status: 'active' | 'revoked' | 'invalid';
    verified: boolean;
    photoCount: number | null;
    observedAt: number;
    issuedAt: string | null;
    revokedAt: string | null;
    revocationReason: string | null;
    invalidReason?: string;
}

interface LatestCertificateReference {
    hash: string;
    idHash: string;
    timestamp: number;
}

export interface ReceivedFotosShareProjectionDeps {
    listLatestCertificateChains(subject: string): Promise<LatestCertificateReference[]>;
    getCertificateChain(hash: string): Promise<FotosShareCertificateChain>;
    getCertificate(hash: string): Promise<FotosShareCertificate>;
    getManifest(issuer: string, scope: FotosShareScope): Promise<FotosShareManifest>;
    certificateIdHash(certificate: FotosShareCertificate): Promise<string>;
    getCertificateSignature(hash: string): Promise<unknown>;
}

const defaultDeps: ReceivedFotosShareProjectionDeps = {
    listLatestCertificateChains: async subject => (
        await getAllEntries(
            subject as SHA256IdHash<Person>,
            'FotosShareCertificateChain',
        ) as Array<SHA256Hash<FotosShareCertificateChain>>
    ).map(hash => ({
        hash: String(hash),
        idHash: String(hash),
        timestamp: 0,
    })),
    getCertificateChain: async hash => (
        await getObjectWithType(hash as SHA256Hash<FotosShareCertificateChain>)
    ) as FotosShareCertificateChain,
    getCertificate: async hash => (
        await getObjectWithType(hash as SHA256Hash<FotosShareCertificate>)
    ) as FotosShareCertificate,
    getManifest: async (issuer, scope) => {
        const id = buildFotosShareManifestId(issuer, scope);
        const idHash = await calculateIdHashOfObj({$type$: 'FotosShareManifest', id});
        return (await getObjectByIdHash(idHash as SHA256IdHash<FotosShareManifest>)).obj;
    },
    certificateIdHash: async certificate => String(await calculateIdHashOfObj({
        $type$: 'FotosShareCertificate',
        id: certificate.id,
    })),
    getCertificateSignature: hash => getObjectWithType(hash as SHA256Hash<any>, 'Signature'),
};

function invalidScope(
    reference: LatestCertificateReference,
    reason: string,
    certificate?: Partial<FotosShareCertificate>,
): ReceivedFotosShareScope {
    return {
        certificateIdHash: reference.idHash,
        certificateHash: reference.hash,
        issuer: String(certificate?.issuer ?? ''),
        scope: {
            kind: certificate?.scopeKind ?? 'gallery',
            id: String(certificate?.scopeId ?? 'unknown'),
        },
        status: 'invalid',
        verified: false,
        photoCount: null,
        observedAt: reference.timestamp,
        issuedAt: typeof certificate?.issuedAt === 'string' ? certificate.issuedAt : null,
        revokedAt: typeof certificate?.revokedAt === 'string' ? certificate.revokedAt : null,
        revocationReason: typeof certificate?.revocationReason === 'string'
            ? certificate.revocationReason
            : null,
        invalidReason: reason,
    };
}

/**
 * Project the current certificate version for every fotos scope addressed to one
 * recipient. Reverse-map lookup returns only the current version for each stable
 * certificate ID, so a late older active version cannot cross a newer revocation.
 */
export async function projectReceivedFotosShares(
    subject: string,
    verifySignature: (signature: unknown) => Promise<boolean>,
    deps: ReceivedFotosShareProjectionDeps = defaultDeps,
): Promise<ReceivedFotosShareScope[]> {
    const normalizedSubject = subject.trim();
    if (!normalizedSubject) return [];

    const references = await deps.listLatestCertificateChains(normalizedSubject);
    const scopes = await Promise.all(references.map(async reference => {
        let chain: FotosShareCertificateChain;
        try {
            chain = await deps.getCertificateChain(reference.hash);
        } catch {
            return invalidScope(reference, 'Certificate chain is unavailable');
        }

        // The reverse map indexes both participants so issuers retain their
        // evidence. Outbound chains are not received shares for this subject.
        if (String(chain.subject) !== normalizedSubject) return null;

        const scope: FotosShareScope = {kind: chain.scopeKind, id: chain.scopeId};
        if (
            chain.$type$ !== 'FotosShareCertificateChain'
            || chain.$version$ !== 'v1'
            || chain.id !== buildFotosShareCertificateChainId(
                String(chain.issuer),
                normalizedSubject,
                scope,
            )
        ) return invalidScope(reference, 'Certificate chain identity binding is invalid');

        let certificate: FotosShareCertificate;
        try {
            certificate = await deps.getCertificate(String(chain.certificate));
        } catch {
            return invalidScope(reference, 'Certificate object is unavailable');
        }
        if (
            certificate.$type$ !== 'FotosShareCertificate'
            || certificate.$version$ !== 'v1'
            || String(certificate.issuer) !== String(chain.issuer)
            || String(certificate.subject) !== normalizedSubject
            || certificate.scopeKind !== scope.kind
            || certificate.scopeId !== scope.id
            || certificate.id !== buildFotosShareCertificateId(
                String(certificate.issuer),
                normalizedSubject,
                scope,
            )
        ) return invalidScope(reference, 'Certificate identity binding is invalid', certificate);

        let signature: unknown;
        try {
            signature = await deps.getCertificateSignature(String(chain.signature));
        } catch {
            return invalidScope(reference, 'Certificate signature is unavailable', certificate);
        }
        const signatureObject = signature as {$type$?: unknown; data?: unknown; issuer?: unknown};
        if (
            signatureObject.$type$ !== 'Signature'
            || String(signatureObject.data) !== String(chain.certificate)
            || String(signatureObject.issuer) !== String(chain.issuer)
            || !await verifySignature(signature)
        ) {
            return invalidScope(reference, 'Certificate signature is missing or untrusted', certificate);
        }

        const certificateIdHash = await deps.certificateIdHash(certificate);
        const lifecycleTimestamp = Date.parse(certificate.issuedAt);
        const observedAt = Number.isFinite(lifecycleTimestamp)
            ? lifecycleTimestamp
            : reference.timestamp;

        if (certificate.status === 'revoked') {
            if (!certificate.revokedAt || !certificate.revocationReason) {
                return invalidScope(reference, 'Revocation lifecycle fields are incomplete', certificate);
            }
            return {
                certificateIdHash,
                certificateHash: String(chain.certificate),
                issuer: String(certificate.issuer),
                scope,
                status: 'revoked' as const,
                verified: true,
                photoCount: null,
                observedAt,
                issuedAt: certificate.issuedAt,
                revokedAt: certificate.revokedAt,
                revocationReason: certificate.revocationReason,
            };
        }

        if (certificate.status !== 'active' || certificate.revokedAt || certificate.revocationReason) {
            return invalidScope(reference, 'Certificate lifecycle is invalid', certificate);
        }

        try {
            const manifest = await deps.getManifest(String(certificate.issuer), scope);
            if (
                manifest.$type$ !== 'FotosShareManifest'
                || String(manifest.issuer) !== String(certificate.issuer)
                || manifest.scopeKind !== scope.kind
                || manifest.scopeId !== scope.id
                || manifest.id !== buildFotosShareManifestId(String(certificate.issuer), scope)
            ) return invalidScope(reference, 'Share manifest binding is invalid', certificate);
            return {
                certificateIdHash,
                certificateHash: String(chain.certificate),
                issuer: String(certificate.issuer),
                scope,
                status: 'active' as const,
                verified: true,
                photoCount: manifest.entries.size,
                observedAt,
                issuedAt: certificate.issuedAt,
                revokedAt: null,
                revocationReason: null,
            };
        } catch {
            return invalidScope(reference, 'Active share manifest is unavailable', certificate);
        }
    }));

    const currentByCertificateId = new Map<string, ReceivedFotosShareScope>();
    for (const scope of scopes.filter((value): value is ReceivedFotosShareScope => value !== null)) {
        const current = currentByCertificateId.get(scope.certificateIdHash);
        const scopeRank = scope.status === 'revoked' ? 2 : scope.status === 'active' ? 1 : 0;
        const currentRank = current?.status === 'revoked' ? 2 : current?.status === 'active' ? 1 : 0;
        if (
            !current
            || scope.observedAt > current.observedAt
            || (scope.observedAt === current.observedAt && scopeRank > currentRank)
        ) currentByCertificateId.set(scope.certificateIdHash, scope);
    }

    return Array.from(currentByCertificateId.values())
        .sort((left, right) => right.observedAt - left.observedAt
        || left.issuer.localeCompare(right.issuer)
        || left.scope.kind.localeCompare(right.scope.kind)
        || left.scope.id.localeCompare(right.scope.id));
}
