import type {Person} from '@refinio/one.core/lib/recipes.js';
import {getOnlyLatestReferencingObjsHashAndId} from '@refinio/one.core/lib/reverse-map-query.js';
import {getObjectWithType} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {getObjectByIdHash} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {calculateIdHashOfObj} from '@refinio/one.core/lib/util/object.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import {getSignatures} from '@refinio/one.models/lib/misc/Signature.js';
import {
    buildFotosShareCertificateId,
    buildFotosShareManifestId,
    type FotosShareCertificate,
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
    listLatestCertificates(subject: string): Promise<LatestCertificateReference[]>;
    getCertificate(hash: string): Promise<FotosShareCertificate>;
    getManifest(issuer: string, scope: FotosShareScope): Promise<FotosShareManifest>;
    certificateIdHash(certificate: FotosShareCertificate): Promise<string>;
    getCertificateSignatures(hash: string, issuer: string): Promise<unknown[]>;
}

const defaultDeps: ReceivedFotosShareProjectionDeps = {
    listLatestCertificates: async subject => (
        await getOnlyLatestReferencingObjsHashAndId(
            subject as SHA256IdHash<Person>,
            'FotosShareCertificate',
        ) as Array<{hash: SHA256Hash<any>; idHash: SHA256IdHash<any>; timestamp: number}>
    ).map(reference => ({
        hash: String(reference.hash),
        idHash: String(reference.idHash),
        timestamp: reference.timestamp,
    })),
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
    getCertificateSignatures: (hash, issuer) => getSignatures(
        hash as SHA256Hash<any>,
        issuer as SHA256IdHash<Person>,
    ),
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

    const references = await deps.listLatestCertificates(normalizedSubject);
    const currentById = new Map<string, LatestCertificateReference>();
    for (const reference of references) {
        const current = currentById.get(reference.idHash);
        if (!current || reference.timestamp > current.timestamp) currentById.set(reference.idHash, reference);
    }

    const scopes = await Promise.all(Array.from(currentById.values()).map(async reference => {
        let certificate: FotosShareCertificate;
        try {
            certificate = await deps.getCertificate(reference.hash);
        } catch {
            return invalidScope(reference, 'Certificate object is unavailable');
        }

        const scope: FotosShareScope = {kind: certificate.scopeKind, id: certificate.scopeId};
        if (
            certificate.$type$ !== 'FotosShareCertificate'
            || certificate.$version$ !== 'v1'
            || String(certificate.subject) !== normalizedSubject
            || certificate.id !== buildFotosShareCertificateId(
                String(certificate.issuer),
                normalizedSubject,
                scope,
            )
        ) return invalidScope(reference, 'Certificate identity binding is invalid', certificate);

        if (await deps.certificateIdHash(certificate) !== reference.idHash) {
            return invalidScope(reference, 'Certificate stable identity does not match its version map', certificate);
        }

        const signatures = await deps.getCertificateSignatures(reference.hash, String(certificate.issuer));
        const signatureChecks = await Promise.all(signatures.map(signature => verifySignature(signature)));
        if (!signatureChecks.some(Boolean)) {
            return invalidScope(reference, 'Certificate signature is missing or untrusted', certificate);
        }

        if (certificate.status === 'revoked') {
            if (!certificate.revokedAt || !certificate.revocationReason) {
                return invalidScope(reference, 'Revocation lifecycle fields are incomplete', certificate);
            }
            return {
                certificateIdHash: reference.idHash,
                certificateHash: reference.hash,
                issuer: String(certificate.issuer),
                scope,
                status: 'revoked' as const,
                verified: true,
                photoCount: null,
                observedAt: reference.timestamp,
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
                certificateIdHash: reference.idHash,
                certificateHash: reference.hash,
                issuer: String(certificate.issuer),
                scope,
                status: 'active' as const,
                verified: true,
                photoCount: manifest.entries.size,
                observedAt: reference.timestamp,
                issuedAt: certificate.issuedAt,
                revokedAt: null,
                revocationReason: null,
            };
        } catch {
            return invalidScope(reference, 'Active share manifest is unavailable', certificate);
        }
    }));

    return scopes.sort((left, right) => right.observedAt - left.observedAt
        || left.issuer.localeCompare(right.issuer)
        || left.scope.kind.localeCompare(right.scope.kind)
        || left.scope.id.localeCompare(right.scope.id));
}
