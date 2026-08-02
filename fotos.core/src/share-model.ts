import type {Person} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {
    FotosEntry,
    FotosShareCertificate,
    FotosShareManifest,
    FotosShareScopeKind,
} from './recipes/FotosRecipes.js';

export interface FotosShareScope {
    kind: FotosShareScopeKind;
    id: string;
}

function requireIdentityPart(value: string, label: string): string {
    const normalized = value.trim();
    if (!normalized) throw new Error(`${label} must not be empty`);
    return normalized;
}

export function buildFotosShareManifestId(
    issuer: string,
    scope: FotosShareScope,
): string {
    return [
        'fotos-share-manifest',
        'v1',
        requireIdentityPart(issuer, 'issuer'),
        scope.kind,
        requireIdentityPart(scope.id, 'scope id'),
    ].join(':');
}

export function buildFotosShareCertificateId(
    issuer: string,
    subject: string,
    scope: FotosShareScope,
): string {
    return [
        'fotos-share-certificate',
        'v1',
        requireIdentityPart(issuer, 'issuer'),
        requireIdentityPart(subject, 'subject'),
        scope.kind,
        requireIdentityPart(scope.id, 'scope id'),
    ].join(':');
}

export function createFotosShareManifest(params: {
    issuer: SHA256IdHash<Person>;
    scope: FotosShareScope;
    entries: Iterable<SHA256Hash<FotosEntry>>;
}): FotosShareManifest {
    return {
        $type$: 'FotosShareManifest',
        id: buildFotosShareManifestId(String(params.issuer), params.scope),
        issuer: params.issuer,
        scopeKind: params.scope.kind,
        scopeId: requireIdentityPart(params.scope.id, 'scope id'),
        entries: new Set(params.entries),
    };
}

export function createActiveFotosShareCertificate(params: {
    issuer: SHA256IdHash<Person>;
    subject: SHA256IdHash<Person>;
    scope: FotosShareScope;
    issuedAt?: string;
}): FotosShareCertificate {
    return {
        $type$: 'FotosShareCertificate',
        $version$: 'v1',
        id: buildFotosShareCertificateId(String(params.issuer), String(params.subject), params.scope),
        issuer: params.issuer,
        subject: params.subject,
        scopeKind: params.scope.kind,
        scopeId: requireIdentityPart(params.scope.id, 'scope id'),
        status: 'active',
        issuedAt: params.issuedAt ?? new Date().toISOString(),
    };
}

export function createRevokedFotosShareCertificate(params: {
    issuer: SHA256IdHash<Person>;
    subject: SHA256IdHash<Person>;
    scope: FotosShareScope;
    reason: string;
    revokedAt?: string;
}): FotosShareCertificate {
    const revokedAt = params.revokedAt ?? new Date().toISOString();
    return {
        $type$: 'FotosShareCertificate',
        $version$: 'v1',
        id: buildFotosShareCertificateId(String(params.issuer), String(params.subject), params.scope),
        issuer: params.issuer,
        subject: params.subject,
        scopeKind: params.scope.kind,
        scopeId: requireIdentityPart(params.scope.id, 'scope id'),
        status: 'revoked',
        issuedAt: revokedAt,
        revokedAt,
        revocationReason: requireIdentityPart(params.reason, 'revocation reason'),
    };
}

export function isActiveFotosShareCertificate(
    certificate: FotosShareCertificate,
): boolean {
    return certificate.status === 'active'
        && certificate.revokedAt === undefined
        && certificate.revocationReason === undefined;
}
