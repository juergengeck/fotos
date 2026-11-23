import {getOwnedFotosManifestId, projectFotosEntryReferences, type FotosEntry, type FotosManifest} from '@refinio/fotos.core';
import {grantFotosShareScopeToPerson, createFotosSharePublicationDeps} from '@refinio/fotos.core/share-publication';
import type {Person} from '@refinio/one.core/lib/recipes.js';
import {getObjectWithType} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import {sign} from '@refinio/one.models/lib/misc/Signature.js';

const publicationDeps = createFotosSharePublicationDeps(async (hash, issuer) => (await sign(hash, issuer)).hash);

/** Resolve all collection members within the exact owner root before granting any access. */
export async function shareFotosMobileCollection(
    owner: SHA256IdHash<Person>,
    owned: FotosManifest,
    collectionId: string,
    recipient: SHA256IdHash<Person>,
): Promise<void> {
    if (owned.id !== getOwnedFotosManifestId(owner)) throw new Error('Your Fotos library changed.');
    let members: Set<string> | undefined;
    for (const ref of owned.collections ?? []) {
        const collection = await getObjectWithType(ref, 'FotosCollection');
        if (collection.id === collectionId) {
            members = collection.photoHashes;
            break;
        }
    }
    if (!members?.size) throw new Error('Choose a collection with photos from your library.');

    const references: Array<{hash: SHA256Hash<FotosEntry>; entry: FotosEntry}> = [];
    for (const hash of owned.entries) {
        const entry = await getObjectWithType(hash, 'FotosEntry');
        if (members.has(entry.contentHash)) references.push({hash, entry});
    }
    const selected = projectFotosEntryReferences(references);
    if (selected.length !== members.size) throw new Error('Some collection photos are unavailable in your library.');

    await grantFotosShareScopeToPerson({
        issuer: owner, scope: {kind: 'collection', id: collectionId}, recipient,
        entryHashes: selected.map(({hash}) => hash as SHA256Hash<FotosEntry>),
    }, publicationDeps);
}
