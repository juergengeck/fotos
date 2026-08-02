import type {Person} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {
    FotosEntry,
    FotosShareCertificate,
    FotosShareCertificateChain,
    FotosShareManifest,
    FotosShareScopeKind,
} from './recipes/FotosRecipes.js';

export interface FotosShareScope {
    kind: FotosShareScopeKind;
    id: string;
}

export interface FotosShareSnapshotChild {
    type: 'object' | 'id' | 'blob' | 'clob';
    hash: string;
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

export function buildFotosShareCertificateChainId(
    issuer: string,
    subject: string,
    scope: FotosShareScope,
): string {
    return [
        'fotos-share-certificate-chain',
        'v1',
        requireIdentityPart(issuer, 'issuer'),
        requireIdentityPart(subject, 'subject'),
        scope.kind,
        requireIdentityPart(scope.id, 'scope id'),
    ].join(':');
}

export function createFotosShareCertificateChain(params: {
    issuer: SHA256IdHash<Person>;
    subject: SHA256IdHash<Person>;
    scope: FotosShareScope;
    certificate: SHA256Hash<FotosShareCertificate>;
    signature: SHA256Hash<any>;
}): FotosShareCertificateChain {
    return {
        $type$: 'FotosShareCertificateChain',
        $version$: 'v1',
        id: buildFotosShareCertificateChainId(String(params.issuer), String(params.subject), params.scope),
        issuer: params.issuer,
        subject: params.subject,
        scopeKind: params.scope.kind,
        scopeId: requireIdentityPart(params.scope.id, 'scope id'),
        certificate: params.certificate,
        signature: params.signature,
    };
}

export function createFotosShareManifest(params: {
    issuer: SHA256IdHash<Person>;
    scope: FotosShareScope;
    entries: Iterable<SHA256Hash<FotosEntry>>;
    /** Complete parent-before-dependency closure for every entry. */
    snapshotChildren?: Iterable<FotosShareSnapshotChild>;
}): FotosShareManifest {
    const entries = new Set(params.entries);
    const orderedChildren = new Map<string, FotosShareSnapshotChild>();
    const appendChild = (child: FotosShareSnapshotChild) => {
        orderedChildren.set(`${child.type}:${child.hash}`, child);
    };
    entries.forEach(hash => appendChild({type: 'object', hash: String(hash)}));
    for (const child of params.snapshotChildren ?? []) appendChild(child);
    appendChild({type: 'id', hash: String(params.issuer)});

    const snapshotObjects = new Set<SHA256Hash<any>>();
    const snapshotIds = new Set<SHA256IdHash<any>>();
    const snapshotBlobs = new Set<SHA256Hash<any>>();
    const snapshotClobs = new Set<SHA256Hash<any>>();
    for (const child of orderedChildren.values()) {
        if (child.type === 'object') snapshotObjects.add(child.hash as SHA256Hash<any>);
        if (child.type === 'id') snapshotIds.add(child.hash as SHA256IdHash<any>);
        if (child.type === 'blob') snapshotBlobs.add(child.hash as SHA256Hash<any>);
        if (child.type === 'clob') snapshotClobs.add(child.hash as SHA256Hash<any>);
    }
    return {
        $type$: 'FotosShareManifest',
        id: buildFotosShareManifestId(String(params.issuer), params.scope),
        issuer: params.issuer,
        scopeKind: params.scope.kind,
        scopeId: requireIdentityPart(params.scope.id, 'scope id'),
        entries,
        snapshotObjects,
        snapshotIds,
        ...(snapshotBlobs.size > 0 ? {snapshotBlobs} : {}),
        ...(snapshotClobs.size > 0 ? {snapshotClobs} : {}),
        snapshotOrder: Array.from(orderedChildren.keys()),
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
