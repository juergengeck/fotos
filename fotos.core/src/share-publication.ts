import type {OneVersionedObjectTypes, Person} from '@refinio/one.core/lib/recipes.js';
import {createAccess} from '@refinio/one.core/lib/access.js';
import {SET_ACCESS_MODE} from '@refinio/one.core/lib/storage-base-common.js';
import {
    getObjectByIdHash,
    storeVersionedObject,
} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {calculateIdHashOfObj} from '@refinio/one.core/lib/util/object.js';
import {
    determineChildrenFromHash,
    type ChildObject,
} from '@refinio/one.core/lib/util/determine-children.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import {
    createActiveFotosShareCertificate,
    createFotosShareCertificateChain,
    createFotosShareManifest,
    createRevokedFotosShareCertificate,
    buildFotosShareCertificateId,
    buildFotosShareCertificateChainId,
    type FotosShareSnapshotChild,
    type FotosShareScope,
} from './share-model.js';
import type {FotosEntry, FotosShareCertificate, FotosShareManifest} from './recipes/FotosRecipes.js';

interface StoredVersion<T extends OneVersionedObjectTypes> {
    obj: T;
    hash: SHA256Hash<T>;
    idHash: SHA256IdHash<T>;
}

export interface FotosShareCertificateDeps {
    calculateIdHash(object: unknown): Promise<SHA256IdHash<any>>;
    getByIdHash(idHash: SHA256IdHash<any>): Promise<StoredVersion<any>>;
    storeVersioned<T extends OneVersionedObjectTypes>(object: T): Promise<StoredVersion<T>>;
    signVersion(hash: SHA256Hash<any>, issuer: SHA256IdHash<Person>): Promise<SHA256Hash<any>>;
    setAccess(entries: Array<Record<string, unknown>>): Promise<void>;
    resolveEntryChildren(hash: SHA256Hash<FotosEntry>): Promise<ChildObject[]>;
}

/** Use ONE storage and access defaults with the platform's signing implementation. */
export function createFotosSharePublicationDeps(
    signVersion: FotosShareCertificateDeps['signVersion'],
): FotosShareCertificateDeps {
    return {
        calculateIdHash: object => calculateIdHashOfObj(object as any),
        getByIdHash: idHash => getObjectByIdHash(idHash as any) as Promise<StoredVersion<any>>,
        storeVersioned: object => storeVersionedObject(object as any) as Promise<StoredVersion<any>>,
        signVersion,
        setAccess: async entries => {
            await createAccess(entries as any);
        },
        resolveEntryChildren: hash => determineChildrenFromHash(hash),
    };
}

export type FotosSharePublicationPhase =
    | 'scope-closure'
    | 'scope-root-load-or-create'
    | 'certificate-status-check'
    | 'certificate-store'
    | 'certificate-sign'
    | 'certificate-chain-access'
    | 'certificate-chain-store'
    | 'manifest-access-replace'
    | 'manifest-store';

export type FotosSharePublicationTrace = <T>(
    scope: FotosShareScope,
    phase: FotosSharePublicationPhase,
    operation: () => Promise<T>,
) => Promise<T>;

const runPublicationPhase: FotosSharePublicationTrace = (_scope, _phase, operation) => operation();

export interface CommitFotosShareScopeParams {
    issuer: SHA256IdHash<Person>;
    scope: FotosShareScope;
    previousPersonIds: readonly string[];
    nextPersonIds: readonly string[];
    entryHashes: readonly SHA256Hash<FotosEntry>[];
    revocationReason?: string;
}

export interface FotosShareCertificateTransition {
    personId: string;
    status: 'active' | 'revoked';
    certificateIdHash: string;
    certificateHash: string;
    signatureHash: string;
    chainIdHash: string;
    chainHash: string;
}

export interface CommitFotosShareScopeResult {
    manifestIdHash: string;
    manifestHash: string;
    transitions: FotosShareCertificateTransition[];
}

function uniquePersonIds(values: readonly string[]): string[] {
    return Array.from(new Set(values.map(value => value.trim()).filter(Boolean))).sort();
}

function sameHashSet(left: Iterable<unknown>, right: Iterable<unknown>): boolean {
    const leftValues = new Set(Array.from(left, String));
    const rightValues = new Set(Array.from(right, String));
    return leftValues.size === rightValues.size
        && Array.from(leftValues).every(value => rightValues.has(value));
}

function sameStringArray(left: readonly unknown[] | undefined, right: readonly unknown[]): boolean {
    return Array.isArray(left)
        && left.length === right.length
        && left.every((value, index) => String(value) === String(right[index]));
}

function sameFotosShareManifest(
    current: Partial<FotosShareManifest>,
    next: FotosShareManifest,
): boolean {
    return sameHashSet(current.entries ?? [], next.entries)
        && sameHashSet(current.snapshotObjects ?? [], next.snapshotObjects)
        && sameHashSet(current.snapshotIds ?? [], next.snapshotIds)
        && sameHashSet(current.snapshotBlobs ?? [], next.snapshotBlobs ?? [])
        && sameHashSet(current.snapshotClobs ?? [], next.snapshotClobs ?? [])
        && sameStringArray(current.snapshotOrder, next.snapshotOrder);
}

async function hasCurrentCertificateStatus(
    issuer: SHA256IdHash<Person>,
    subject: SHA256IdHash<Person>,
    scope: FotosShareScope,
    status: FotosShareCertificate['status'],
    deps: FotosShareCertificateDeps,
): Promise<boolean> {
    const id = buildFotosShareCertificateId(String(issuer), String(subject), scope);
    const idHash = await deps.calculateIdHash({$type$: 'FotosShareCertificate', id});
    try {
        const current = await deps.getByIdHash(idHash);
        if (
            current.obj?.$type$ !== 'FotosShareCertificate'
            || current.obj.status !== status
        ) return false;

        // Certificates created before the transfer-chain model existed are not
        // discoverable by recipients. Treat them as incomplete so the normal
        // transition path mints and publishes a signed chain-backed version.
        const chainId = buildFotosShareCertificateChainId(
            String(issuer),
            String(subject),
            scope,
        );
        const chainIdHash = await deps.calculateIdHash({
            $type$: 'FotosShareCertificateChain',
            id: chainId,
        });
        const currentChain = await deps.getByIdHash(chainIdHash);
        return currentChain.obj?.$type$ === 'FotosShareCertificateChain'
            && String(currentChain.obj.issuer) === String(issuer)
            && String(currentChain.obj.subject) === String(subject)
            && currentChain.obj.scopeKind === scope.kind
            && currentChain.obj.scopeId === scope.id
            && String(currentChain.obj.certificate) === String(current.hash);
    } catch {
        return false;
    }
}

async function storeAndPublishCertificate(
    certificate: FotosShareCertificate,
    deps: FotosShareCertificateDeps,
    trace: FotosSharePublicationTrace,
): Promise<FotosShareCertificateTransition> {
    const scope: FotosShareScope = {
        kind: certificate.scopeKind,
        id: certificate.scopeId,
    };
    const stored = await trace(
        scope,
        'certificate-store',
        () => deps.storeVersioned(certificate),
    );
    const signatureHash = await trace(
        scope,
        'certificate-sign',
        () => deps.signVersion(stored.hash, certificate.issuer),
    );
    const {chain, chainIdHash} = await trace(
        scope,
        'certificate-chain-access',
        async () => {
            const nextChain = createFotosShareCertificateChain({
                issuer: certificate.issuer,
                subject: certificate.subject,
                scope,
                certificate: stored.hash,
                signature: signatureHash,
            });
            const nextChainIdHash = await deps.calculateIdHash({
                $type$: nextChain.$type$,
                id: nextChain.id,
            });

            // Retain this IdAccess after revocation and establish it before storing the
            // chain version. The store event is the feed-forward checkpoint that makes
            // an already-running CHUM session observe the complete cert+signature DAG.
            await deps.setAccess([
                {
                    id: nextChainIdHash,
                    person: [certificate.subject],
                    hashGroup: [],
                    mode: SET_ACCESS_MODE.ADD,
                },
            ]);
            return {chain: nextChain, chainIdHash: nextChainIdHash};
        },
    );
    const storedChain = await trace(
        scope,
        'certificate-chain-store',
        () => deps.storeVersioned(chain),
    );

    return {
        personId: String(certificate.subject),
        status: certificate.status,
        certificateIdHash: String(stored.idHash),
        certificateHash: String(stored.hash),
        signatureHash: String(signatureHash),
        chainIdHash: String(chainIdHash),
        chainHash: String(storedChain.hash),
    };
}

/**
 * Commit one complete recipient assignment for a fotos scope.
 *
 * Certificate transitions are stored, signed, and published first. Scope-root
 * access is then replaced atomically from the caller's committed recipient set.
 * Only after access replacement is a changed scope-manifest version stored, so a
 * removed peer cannot observe newly added photo roots in the transition window.
 */
export async function commitFotosShareScope(
    params: CommitFotosShareScopeParams,
    deps: FotosShareCertificateDeps,
    trace: FotosSharePublicationTrace = runPublicationPhase,
): Promise<CommitFotosShareScopeResult> {
    return publishFotosShareScope(params, deps, trace, SET_ACCESS_MODE.REPLACE);
}

/** Grant one peer without replacing the existing direct recipients or groups. */
export async function grantFotosShareScopeToPerson(
    params: Pick<CommitFotosShareScopeParams, 'issuer' | 'scope' | 'entryHashes'> & {recipient: SHA256IdHash<Person>},
    deps: FotosShareCertificateDeps,
): Promise<CommitFotosShareScopeResult> {
    return publishFotosShareScope({
        issuer: params.issuer, scope: params.scope, entryHashes: params.entryHashes,
        previousPersonIds: [], nextPersonIds: [params.recipient],
    }, deps, runPublicationPhase, SET_ACCESS_MODE.ADD);
}

async function publishFotosShareScope(
    params: CommitFotosShareScopeParams,
    deps: FotosShareCertificateDeps,
    trace: FotosSharePublicationTrace,
    mode: typeof SET_ACCESS_MODE[keyof typeof SET_ACCESS_MODE],
): Promise<CommitFotosShareScopeResult> {
    const previousPersonIds = uniquePersonIds(params.previousPersonIds);
    const nextPersonIds = uniquePersonIds(params.nextPersonIds);
    const previousSet = new Set(previousPersonIds);
    const nextSet = new Set(nextPersonIds);
    const removed = previousPersonIds.filter(personId => !nextSet.has(personId));
    const added = nextPersonIds.filter(personId => !previousSet.has(personId));
    const {manifest, manifestIdHash} = await trace(
        params.scope,
        'scope-closure',
        async () => {
            const snapshotChildren: FotosShareSnapshotChild[] = [];
            for (const entryHash of params.entryHashes) {
                const children = await deps.resolveEntryChildren(entryHash);
                snapshotChildren.push(...children.map(child => ({
                    type: child.type,
                    hash: String(child.hash),
                })));
            }
            const nextManifest = createFotosShareManifest({
                issuer: params.issuer,
                scope: params.scope,
                entries: params.entryHashes,
                snapshotChildren,
            });
            const nextManifestIdHash = await deps.calculateIdHash({
                $type$: nextManifest.$type$,
                id: nextManifest.id,
            });
            return {manifest: nextManifest, manifestIdHash: nextManifestIdHash};
        },
    );

    let currentManifest = await trace(
        params.scope,
        'scope-root-load-or-create',
        async (): Promise<StoredVersion<FotosShareManifest>> => {
            try {
                return await deps.getByIdHash(manifestIdHash) as StoredVersion<FotosShareManifest>;
            } catch {
                // A first share needs a stored root before IdAccess can be created.
                return await deps.storeVersioned(manifest);
            }
        },
    );

    const transitions: FotosShareCertificateTransition[] = [];
    const transitionAt = new Date().toISOString();
    for (const personId of removed) {
        if (await trace(
            params.scope,
            'certificate-status-check',
            () => hasCurrentCertificateStatus(
                params.issuer,
                personId as SHA256IdHash<Person>,
                params.scope,
                'revoked',
                deps,
            ),
        )) continue;
        transitions.push(await storeAndPublishCertificate(
            createRevokedFotosShareCertificate({
                issuer: params.issuer,
                subject: personId as SHA256IdHash<Person>,
                scope: params.scope,
                reason: params.revocationReason ?? 'Recipient removed from fotos share',
                revokedAt: transitionAt,
            }),
            deps,
            trace,
        ));
    }
    for (const personId of added) {
        if (await trace(
            params.scope,
            'certificate-status-check',
            () => hasCurrentCertificateStatus(
                params.issuer,
                personId as SHA256IdHash<Person>,
                params.scope,
                'active',
                deps,
            ),
        )) continue;
        transitions.push(await storeAndPublishCertificate(
            createActiveFotosShareCertificate({
                issuer: params.issuer,
                subject: personId as SHA256IdHash<Person>,
                scope: params.scope,
                issuedAt: transitionAt,
            }),
            deps,
            trace,
        ));
    }

    const committedRecipients = nextPersonIds as unknown as SHA256IdHash<Person>[];
    await trace(params.scope, 'manifest-access-replace', () => deps.setAccess([
        {
            id: manifestIdHash,
            person: committedRecipients,
            hashGroup: [],
            mode,
        },
        {
            object: currentManifest.hash,
            // IdAccess publishes the scope's causal head. Retire the redundant
            // exact snapshot grant retained by earlier publishers.
            person: [],
            hashGroup: [],
            mode: SET_ACCESS_MODE.REPLACE,
        },
    ]));

    currentManifest = await trace(
        params.scope,
        'manifest-store',
        async () => sameFotosShareManifest(currentManifest.obj, manifest)
            ? currentManifest
            : deps.storeVersioned(manifest),
    );

    return {
        manifestIdHash: String(manifestIdHash),
        manifestHash: String(currentManifest.hash),
        transitions,
    };
}
