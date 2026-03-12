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
import { createAccess } from '@refinio/one.core/lib/access.js';
import { SET_ACCESS_MODE } from '@refinio/one.core/lib/storage-base-common.js';
import {
    getObjectByIdHash,
    storeVersionedObject
} from '@refinio/one.core/lib/storage-versioned-objects.js';
import { calculateIdHashOfObj } from '@refinio/one.core/lib/util/object.js';

// Cached idHash for the singleton manifest (calculated once, deterministic)
let cachedManifestIdHash: SHA256IdHash<FotosManifest> | null = null;

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

    console.log(
        `[fotos-manifest] Granting IdAccess on FotosManifest idHash=${(manifestIdHash as string).substring(0, 12)}` +
        ` to person=${(remotePersonId as string).substring(0, 12)}`
    );

    await createAccess([{
        id: manifestIdHash as SHA256IdHash,
        person: [remotePersonId],
        hashGroup: [],
        mode: SET_ACCESS_MODE.ADD
    }] as any);

    console.log('[fotos-manifest] IdAccess granted');
}
