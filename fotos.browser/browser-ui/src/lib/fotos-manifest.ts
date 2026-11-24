/**
 * FotosManifest access helper -- create, populate, and grant access.
 *
 * Mirrors the glue-manifest-access.ts pattern from connection.core.
 * Legacy accounts retain id 'fotos'; admitted native owners use an owner-scoped
 * deterministic root. Sharing grants the manifest root and the
 * referenced content through ONE's identity-root traversal.
 */

import type { SHA256Hash, SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person } from '@refinio/one.core/lib/recipes.js';
import type {
    FotosAuthenticityAttestation,
    FotosEntry,
    FotosManifest,
} from '../../../../fotos.core/src/recipes/FotosRecipes.js';
import type { FotosDeviceBookRole } from '../../../../fotos.core/src/recipes/FotosDeviceBookRecipes.js';
import {
    ensureFotosDeviceBook,
} from '../../../../fotos.core/src/fotos-device-book.js';
import {
    ensureMediaBook,
} from '@refinio/source.media/services';
import { ensureVersionedIdObject } from '@refinio/connection.core/helpers/ensure-versioned-id-object.js';
import { createAccess } from '@refinio/one.core/lib/access.js';
import { SET_ACCESS_MODE } from '@refinio/one.core/lib/storage-base-common.js';
import {
    getObjectByIdHash,
    onVersionedObj,
    storeVersionedObject
} from '@refinio/one.core/lib/storage-versioned-objects.js';
import { getInstanceOwnerIdHash } from '@refinio/one.core/lib/instance.js';
import { getObject } from '@refinio/one.core/lib/storage-unversioned-objects.js';
import { calculateIdHashOfObj } from '@refinio/one.core/lib/util/object.js';
import {getOwnedFotosManifestId} from '../../../../fotos.core/src/owned-fotos-manifest.js';
import {projectFotosEntryReferences, type FotosEntryReference} from '../../../../fotos.core/src/fotos-entry-projection.js';

// Cached idHash for the singleton manifest (calculated once, deterministic)
let cachedManifestIdHash: SHA256IdHash<FotosManifest> | null = null;
let nativeOwnerContext: string | null = null;

/** Select a native library only after boot has verified admission and exact local custody. */
export function setFotosNativeOwnerContext(owner: string | null): void {
    if (owner !== null) {
        getOwnedFotosManifestId(owner);
        if (getInstanceOwnerIdHash() !== owner) throw new Error('Native Fotos context differs from the active owner');
    }
    nativeOwnerContext = owner;
    cachedManifestIdHash = null;
}

/** Return boot-fed native admission, never infer it from publication identity equality. */
export function getFotosNativeOwnerContext(): string | null { return nativeOwnerContext; }

/** Preserve the legacy namespace unless native boot explicitly selected its admitted owner. */
function selectedManifestId(): string {
    if (!nativeOwnerContext) return 'fotos';
    if (getInstanceOwnerIdHash() !== nativeOwnerContext) throw new Error('Native Fotos context no longer owns the active store');
    return getOwnedFotosManifestId(nativeOwnerContext);
}

export interface FotosManifestSnapshot {
    exists: boolean;
    idHash: string;
    hash: string | null;
    entryCount: number;
    entryHashes: string[];
    contentHashes: string[];
    attestationCount: number;
    attestationHashes: string[];
    resolvedEntries: FotosManifestResolvedEntry[];
    resolvedAttestations: FotosManifestResolvedAuthenticityAttestation[];
}

export interface FotosManifestResolvedEntry {
    entryHash: string;
    contentHash: string;
    name: string;
    sourcePath: string | null;
    folderPath: string | null;
    capturedAt: string | null;
    updatedAt: string | null;
    faceCount: number;
    hasThumb: boolean;
    acquisitionObservationHashes: string[];
}

export interface FotosManifestResolvedAuthenticityAttestation {
    attestationHash: string;
    contentHash: string;
    signerPersonId: string;
    signerPublicKey: string;
    signatureScheme: string;
    signature: string;
    subscriptionCertificateHash: string | null;
}

/**
 * Get the deterministic idHash for the FotosManifest singleton.
 * Cached after first calculation since it never changes.
 */
async function getManifestIdHash(): Promise<SHA256IdHash<FotosManifest>> {
    const id = selectedManifestId();
    if (cachedManifestIdHash) {
        return cachedManifestIdHash;
    }

    const idHash = await calculateIdHashOfObj({
        $type$: 'FotosManifest',
        id,
        entries: new Set(),
        authenticityAttestations: new Set(),
    } as any) as SHA256IdHash<FotosManifest>;
    if (selectedManifestId() !== id) throw new Error('Fotos library context changed while resolving its root');
    cachedManifestIdHash = idHash;
    return idHash;
}

/** Restore only exact entry references in the admitted native owner's accepted root. */
export async function readNativeOwnedFotosEntries(owner: string): Promise<FotosEntry[]> {
    if (!nativeOwnerContext) return [];
    if (owner !== nativeOwnerContext) throw new Error('Native Fotos reader does not match its admitted owner');
    const id = selectedManifestId();
    let manifest: FotosManifest;
    try {
        manifest = (await getObjectByIdHash(await getManifestIdHash())).obj as unknown as FotosManifest;
    } catch (error) {
        if (error instanceof Error && error.name === 'FileNotFoundError') return [];
        throw error;
    }
    if (manifest.$type$ !== 'FotosManifest' || manifest.id !== id || !(manifest.entries instanceof Set)) {
        throw new Error('Malformed native owned Fotos manifest');
    }
    const entries: FotosEntryReference[] = [];
    for (const hash of manifest.entries) {
        if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('Malformed native Fotos entry reference');
        const entry = await getObject(hash);
        if (entry.$type$ !== 'FotosEntry' || !/^[a-f0-9]{64}$/.test(entry.contentHash)
            || typeof entry.mime !== 'string' || !Number.isSafeInteger(entry.size) || entry.size < 0) {
            throw new Error('Malformed native owned Fotos entry');
        }
        entries.push({hash, entry});
    }
    if (selectedManifestId() !== id) throw new Error('Fotos library context changed while reading its entries');
    return projectFotosEntryReferences(entries).map(reference => reference.entry);
}

async function resolveManifestContentHashes(
    entryHashes: readonly string[],
): Promise<string[]> {
    const contentHashes = await Promise.all(entryHashes.map(async entryHash => {
        try {
            const entry = await getObject(entryHash as SHA256Hash<FotosEntry>);
            return typeof entry.contentHash === 'string' ? entry.contentHash : null;
        } catch {
            return null;
        }
    }));

    return [...new Set(contentHashes.filter((value): value is string => Boolean(value)))].sort();
}

/** Grant the identity lineage and retire its legacy exact current-snapshot grant. */
async function buildGrantedRootAccessEntries(
    remotePersonId: SHA256IdHash<Person>,
    rootIdHash: string,
): Promise<Array<Record<string, unknown>>> {
    await ensureVersionedIdObject(rootIdHash as any);
    const currentVersion = await getObjectByIdHash(rootIdHash as any);

    return [{
        id: rootIdHash as SHA256IdHash,
        person: [remotePersonId],
        hashGroup: [],
        mode: SET_ACCESS_MODE.ADD,
    }, {
        object: currentVersion.hash as SHA256Hash,
        person: [],
        hashGroup: [],
        mode: SET_ACCESS_MODE.REPLACE,
    }];
}

function basenameFromPath(pathValue: string | null | undefined): string | null {
    const normalized = pathValue?.trim();
    if (!normalized) {
        return null;
    }

    const segments = normalized.split('/').filter(Boolean);
    return segments.length > 0 ? segments[segments.length - 1] ?? null : normalized;
}

function dirnameFromPath(pathValue: string | null | undefined): string | null {
    const normalized = pathValue?.trim();
    if (!normalized || !normalized.includes('/')) {
        return null;
    }

    const segments = normalized.split('/').filter(Boolean);
    if (segments.length <= 1) {
        return null;
    }

    return segments.slice(0, -1).join('/');
}

async function resolveManifestEntries(
    entryHashes: readonly string[],
): Promise<FotosManifestResolvedEntry[]> {
    const entries = await Promise.all(entryHashes.map(async entryHash => {
        try {
            const entry = await getObject(entryHash as SHA256Hash<FotosEntry>);
            const sourcePath = typeof entry.sourcePath === 'string' ? entry.sourcePath : null;
            const folderPath = typeof entry.folderPath === 'string'
                ? entry.folderPath
                : dirnameFromPath(sourcePath);

            return {
                entryHash,
                contentHash: typeof entry.contentHash === 'string' ? entry.contentHash : entryHash,
                name: basenameFromPath(sourcePath) ?? `${entryHash.slice(0, 12)}.photo`,
                sourcePath,
                folderPath,
                capturedAt: typeof entry.capturedAt === 'string' ? entry.capturedAt : null,
                updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : null,
                faceCount: typeof entry.faceCount === 'number' ? entry.faceCount : 0,
                hasThumb: Boolean(entry.thumb),
                acquisitionObservationHashes: [...entry.acquisitionObservations ?? []].map(String).sort(),
            } satisfies FotosManifestResolvedEntry;
        } catch {
            return null;
        }
    }));

    return entries
        .filter((value): value is FotosManifestResolvedEntry => value !== null)
        .sort((left, right) => left.name.localeCompare(right.name) || left.contentHash.localeCompare(right.contentHash));
}

async function resolveManifestAuthenticityAttestations(
    attestationHashes: readonly string[],
): Promise<FotosManifestResolvedAuthenticityAttestation[]> {
    const attestations = await Promise.all(attestationHashes.map(async (
        attestationHash,
    ): Promise<FotosManifestResolvedAuthenticityAttestation | null> => {
        try {
            const attestation = await getObject(attestationHash as SHA256Hash<FotosAuthenticityAttestation>);
            const signerPersonId = typeof attestation.signer === 'string' ? String(attestation.signer) : '';
            const signerPublicKey = typeof attestation.signerPublicKey === 'string' ? attestation.signerPublicKey : '';
            const signatureScheme = typeof attestation.signatureScheme === 'string' ? attestation.signatureScheme : '';
            const signature = typeof attestation.signature === 'string' ? attestation.signature : '';
            const contentHash = typeof attestation.contentHash === 'string' ? attestation.contentHash : '';

            if (!signerPersonId || !signerPublicKey || !signatureScheme || !signature || !contentHash) {
                return null;
            }

            return {
                attestationHash,
                contentHash,
                signerPersonId,
                signerPublicKey,
                signatureScheme,
                signature,
                subscriptionCertificateHash: typeof attestation.subscriptionCertificate === 'string'
                    ? attestation.subscriptionCertificate
                    : null,
            } satisfies FotosManifestResolvedAuthenticityAttestation;
        } catch {
            return null;
        }
    }));

    return attestations
        .filter((value): value is FotosManifestResolvedAuthenticityAttestation => value !== null)
        .sort((left, right) =>
            left.contentHash.localeCompare(right.contentHash)
            || left.signerPersonId.localeCompare(right.signerPersonId)
            || left.attestationHash.localeCompare(right.attestationHash),
        );
}

async function toManifestSnapshot(
    manifestIdHash: SHA256IdHash<FotosManifest>,
    manifest: FotosManifest | null,
    hash: string | null,
): Promise<FotosManifestSnapshot> {
    const entryHashes = manifest
        ? Array.from(manifest.entries, entryHash => String(entryHash)).sort()
        : [];
    const attestationHashes = manifest?.authenticityAttestations
        ? Array.from(manifest.authenticityAttestations, attestationHash => String(attestationHash)).sort()
        : [];
    const [contentHashes, resolvedEntries, resolvedAttestations] = manifest
        ? await Promise.all([
            resolveManifestContentHashes(entryHashes),
            resolveManifestEntries(entryHashes),
            resolveManifestAuthenticityAttestations(attestationHashes),
        ])
        : [[], [], []];

    return {
        exists: Boolean(manifest),
        idHash: String(manifestIdHash),
        hash,
        entryCount: entryHashes.length,
        entryHashes,
        contentHashes,
        attestationCount: attestationHashes.length,
        attestationHashes,
        resolvedEntries,
        resolvedAttestations,
    };
}

export async function readFotosManifestSnapshot(): Promise<FotosManifestSnapshot> {
    const manifestIdHash = await getManifestIdHash();

    try {
        const existing = await getObjectByIdHash(manifestIdHash);
        return await toManifestSnapshot(
            manifestIdHash,
            existing.obj as unknown as FotosManifest,
            String(existing.hash),
        );
    } catch (error) {
        if (!(error instanceof Error) || error.name !== 'FileNotFoundError') throw error;
        return await toManifestSnapshot(manifestIdHash, null, null);
    }
}

export function listenForFotosManifestUpdates(
    onSnapshot: (snapshot: FotosManifestSnapshot) => void,
): () => void {
    return onVersionedObj.addListener(result => {
        if ((result.obj as { $type$: string }).$type$ !== 'FotosManifest') {
            return;
        }

        const manifest = result.obj as unknown as FotosManifest;
        if (manifest.id !== selectedManifestId()) {
            return;
        }

        void getManifestIdHash().then(async manifestIdHash => {
            onSnapshot(await toManifestSnapshot(manifestIdHash, manifest, String(result.hash)));
        }).catch(error => {
            console.warn('[fotos-manifest] Failed to resolve manifest snapshot:', error);
        });
    });
}

/**
 * Ensure the FotosManifest singleton exists.
 *
 * If the manifest already exists, returns its idHash.
 * If it does not exist, creates an empty one and returns the idHash.
 *
 * @returns The idHash of the FotosManifest singleton
 */
export async function ensureFotosManifest(): Promise<SHA256IdHash<FotosManifest>> {
    const id = selectedManifestId();
    const manifestIdHash = await getManifestIdHash();

    try {
        await getObjectByIdHash(manifestIdHash);
        console.log('[fotos-manifest] Manifest exists');
    } catch (error) {
        if (!(error instanceof Error) || error.name !== 'FileNotFoundError') throw error;
        if (selectedManifestId() !== id) throw new Error('Fotos library context changed before manifest creation');
        console.log('[fotos-manifest] Manifest does not exist — creating empty one');
        await storeVersionedObject({
            $type$: 'FotosManifest',
            id,
            entries: new Set(),
            authenticityAttestations: new Set(),
        } as any);
    }

    return manifestIdHash;
}

/**
 * Add a FotosEntry reference to the manifest's entries set.
 *
 * Loads the current manifest, adds the entry hash, and stores the updated version.
 * If the manifest does not exist yet, it is created first.
 *
 * @param entryHash - The content hash of the FotosEntry to add
 */
export async function addEntryToManifest(entryHash: SHA256Hash<FotosEntry>): Promise<void> {
    const manifestIdHash = await ensureFotosManifest();

    const existing = await getObjectByIdHash(manifestIdHash);
    const manifest = existing.obj as unknown as FotosManifest;
    const incomingEntry = await getObject(entryHash);
    const entries = new Set<SHA256Hash<FotosEntry>>();
    for (const currentHash of manifest.entries) {
        if (currentHash === entryHash) {
            entries.add(currentHash);
            continue;
        }
        const currentEntry = await getObject(currentHash);
        if (currentEntry.contentHash !== incomingEntry.contentHash) {
            entries.add(currentHash);
        }
    }
    const authenticityAttestations = new Set(manifest.authenticityAttestations ?? []);

    entries.add(entryHash);
    if (
        entries.size === manifest.entries.size
        && Array.from(entries).every(hash => manifest.entries.has(hash))
    ) {
        return;
    }
    if (selectedManifestId() !== manifest.id) throw new Error('Fotos library context changed before entry publication');

    await storeVersionedObject({
        ...manifest,
        entries,
        authenticityAttestations,
    } as any);

    console.log(`[fotos-manifest] Added entry ${(entryHash as string).substring(0, 12)}, total: ${entries.size}`);
}

export async function addAuthenticityAttestationToManifest(
    attestationHash: SHA256Hash<FotosAuthenticityAttestation>,
): Promise<void> {
    const manifestIdHash = await ensureFotosManifest();

    const existing = await getObjectByIdHash(manifestIdHash);
    const manifest = existing.obj as unknown as FotosManifest;
    const entries = new Set(manifest.entries);
    const authenticityAttestations = new Set(manifest.authenticityAttestations ?? []);

    if (authenticityAttestations.has(attestationHash)) {
        return;
    }

    authenticityAttestations.add(attestationHash);
    if (selectedManifestId() !== manifest.id) throw new Error('Fotos library context changed before attestation publication');

    await storeVersionedObject({
        ...manifest,
        entries,
        authenticityAttestations,
    } as any);

    console.log(
        `[fotos-manifest] Added authenticity ${(attestationHash as string).substring(0, 12)}, total: ${authenticityAttestations.size}`,
    );
}

/**
 * Grant IdAccess on the FotosManifest to a remote peer.
 *
 * This allows CHUM to discover and sync the manifest (and all referenced
 * FotosEntry objects) to the specified person.
 *
 * @param remotePersonId - The remote person to grant access to
 */
export async function grantFotosAccess(remotePersonId: SHA256IdHash<Person>): Promise<void> {
    const manifestIdHash = await ensureFotosManifest();
    console.log(
        `[fotos-manifest] Granting IdAccess on FotosManifest idHash=${(manifestIdHash as string).substring(0, 12)}` +
        ` to person=${(remotePersonId as string).substring(0, 12)}`
    );

    await createAccess(
        await buildGrantedRootAccessEntries(remotePersonId, String(manifestIdHash)) as any,
    );
    console.log('[fotos-manifest] IdAccess granted');
}

/** Retire external gallery grants while retaining the owner's IoM library root. */
export async function revokeLegacyFotosManifestAccess(): Promise<void> {
    const owner = getInstanceOwnerIdHash();
    if (!owner) throw new Error('An active owner is required for Fotos library access');
    const manifestIdHash = await ensureFotosManifest();
    const currentManifestVersion = await getObjectByIdHash(manifestIdHash);
    await createAccess([
        {
            id: manifestIdHash,
            person: [owner],
            hashGroup: [],
            mode: SET_ACCESS_MODE.REPLACE,
        },
        {
            object: currentManifestVersion.hash,
            person: [],
            hashGroup: [],
            mode: SET_ACCESS_MODE.REPLACE,
        },
    ] as any);
}

export interface GrantFotosDeviceBookAccessOptions {
    deviceId: string;
    role?: FotosDeviceBookRole;
    title?: string;
}

export async function grantFotosDeviceBookAccess(
    remotePersonId: SHA256IdHash<Person>,
    options: GrantFotosDeviceBookAccessOptions,
): Promise<{ deviceBookIdHash: string; mediaBookIdHash: string }> {
    const author = getInstanceOwnerIdHash() as SHA256IdHash<Person> | null;
    if (!author) {
        throw new Error('[fotos-manifest] Cannot share a Media Book without the local owner identity');
    }

    const deviceBook = await ensureFotosDeviceBook({
        calculateIdHashOfObj,
        getObjectByIdHash,
        storeVersionedObject,
    }, {
        deviceId: options.deviceId,
        ...(options.role ? { role: options.role } : {}),
        ...(options.title ? { title: options.title } : {}),
    });
    const deviceBookIdHash = String(deviceBook.stored.idHash);
    const mediaBook = await ensureMediaBook({
        calculateIdHashOfObj,
        getObjectByIdHash,
        storeVersionedObject,
    }, {
        author,
        deviceId: options.deviceId,
    });
    const mediaBookIdHash = String(mediaBook.stored.idHash);

    await createAccess([
        ...(await buildGrantedRootAccessEntries(remotePersonId, deviceBookIdHash)),
        ...(await buildGrantedRootAccessEntries(remotePersonId, mediaBookIdHash)),
    ] as any);

    return { deviceBookIdHash, mediaBookIdHash };
}
