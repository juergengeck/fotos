/**
 * FotosManifest access helper -- create, populate, and grant access.
 *
 * Mirrors the glue-manifest-access.ts pattern from connection.core.
 * The manifest has a fixed identity (id: 'fotos') so all instances share
 * the same deterministic idHash. Granting IdAccess on this manifest lets
 * CHUM export the manifest AND all FotosEntry objects referenced via
 * referenceToObj to the granted peer.
 */

import type { SHA256Hash, SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person } from '@refinio/one.core/lib/recipes.js';
import type { FotosEntry, FotosManifest } from '@refinio/fotos.core';
import { ensureVersionedIdObject } from '@refinio/connection.core/helpers/ensure-versioned-id-object.js';
import { createAccess } from '@refinio/one.core/lib/access.js';
import { SET_ACCESS_MODE } from '@refinio/one.core/lib/storage-base-common.js';
import {
    getObjectByIdHash,
    onVersionedObj,
    storeVersionedObject
} from '@refinio/one.core/lib/storage-versioned-objects.js';
import { getObject } from '@refinio/one.core/lib/storage-unversioned-objects.js';
import { calculateIdHashOfObj } from '@refinio/one.core/lib/util/object.js';

// Cached idHash for the singleton manifest (calculated once, deterministic)
let cachedManifestIdHash: SHA256IdHash<FotosManifest> | null = null;

export interface FotosManifestSnapshot {
    exists: boolean;
    idHash: string;
    hash: string | null;
    entryCount: number;
    entryHashes: string[];
    contentHashes: string[];
    resolvedEntries: FotosManifestResolvedEntry[];
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
}

/**
 * Get the deterministic idHash for the FotosManifest singleton.
 * Cached after first calculation since it never changes.
 */
async function getManifestIdHash(): Promise<SHA256IdHash<FotosManifest>> {
    if (cachedManifestIdHash) {
        return cachedManifestIdHash;
    }

    cachedManifestIdHash = await calculateIdHashOfObj({
        $type$: 'FotosManifest',
        id: 'fotos',
        entries: new Set()
    } as any) as SHA256IdHash<FotosManifest>;

    return cachedManifestIdHash;
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
            } satisfies FotosManifestResolvedEntry;
        } catch {
            return null;
        }
    }));

    return entries
        .filter((value): value is FotosManifestResolvedEntry => value !== null)
        .sort((left, right) => left.name.localeCompare(right.name) || left.contentHash.localeCompare(right.contentHash));
}

async function toManifestSnapshot(
    manifestIdHash: SHA256IdHash<FotosManifest>,
    manifest: FotosManifest | null,
    hash: string | null,
): Promise<FotosManifestSnapshot> {
    const entryHashes = manifest
        ? Array.from(manifest.entries, entryHash => String(entryHash)).sort()
        : [];
    const [contentHashes, resolvedEntries] = manifest
        ? await Promise.all([
            resolveManifestContentHashes(entryHashes),
            resolveManifestEntries(entryHashes),
        ])
        : [[], []];

    return {
        exists: Boolean(manifest),
        idHash: String(manifestIdHash),
        hash,
        entryCount: entryHashes.length,
        entryHashes,
        contentHashes,
        resolvedEntries,
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
    } catch {
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
        if (manifest.id !== 'fotos') {
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
    const manifestIdHash = await getManifestIdHash();

    try {
        await getObjectByIdHash(manifestIdHash);
        console.log('[fotos-manifest] Manifest exists');
    } catch {
        console.log('[fotos-manifest] Manifest does not exist — creating empty one');
        await storeVersionedObject({
            $type$: 'FotosManifest',
            id: 'fotos',
            entries: new Set()
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
    const entries = new Set(manifest.entries);

    if (entries.has(entryHash)) {
        return;
    }

    entries.add(entryHash);

    await storeVersionedObject({
        $type$: 'FotosManifest',
        id: 'fotos',
        entries
    } as any);

    console.log(`[fotos-manifest] Added entry ${(entryHash as string).substring(0, 12)}, total: ${entries.size}`);
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
    await ensureVersionedIdObject(manifestIdHash as any);
    const currentVersion = await getObjectByIdHash(manifestIdHash);

    console.log(
        `[fotos-manifest] Granting IdAccess on FotosManifest idHash=${(manifestIdHash as string).substring(0, 12)}` +
        ` to person=${(remotePersonId as string).substring(0, 12)}`
    );

    await createAccess([{
        id: manifestIdHash as SHA256IdHash,
        person: [remotePersonId],
        hashGroup: [],
        mode: SET_ACCESS_MODE.ADD
    }, {
        object: currentVersion.hash as SHA256Hash,
        person: [remotePersonId],
        hashGroup: [],
        mode: SET_ACCESS_MODE.ADD
    }] as any);

    console.log('[fotos-manifest] IdAccess granted');
}
