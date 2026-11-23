import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {FotosCollection, FotosEntry, FotosManifest} from '@refinio/fotos.core';
import type {Person} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import {shareFotosMobileCollection} from './FotosMobileCollectionShare';

const mocks = vi.hoisted(() => ({
    read: vi.fn(), publish: vi.fn(),
}));
vi.mock('@refinio/one.core/lib/storage-unversioned-objects.js', () => ({getObjectWithType: mocks.read}));
vi.mock('@refinio/one.models/lib/misc/Signature.js', () => ({sign: vi.fn()}));
vi.mock('@refinio/fotos.core/share-publication', () => ({
    createFotosSharePublicationDeps: vi.fn(() => ({})), grantFotosShareScopeToPerson: mocks.publish,
}));

const owner = 'a'.repeat(64) as SHA256IdHash<Person>;
const previous = 'b'.repeat(64) as SHA256IdHash<Person>;
const recipient = 'c'.repeat(64) as SHA256IdHash<Person>;
const photo: FotosEntry = {
    $type$: 'FotosEntry', contentHash: 'd'.repeat(64), mime: 'image/jpeg', size: 12, streamId: 'album',
};
const collection: FotosCollection = {
    $type$: 'FotosCollection', id: 'summer', name: 'Summer', photoHashes: new Set([photo.contentHash]),
};
const entryHash = 'e'.repeat(64) as SHA256Hash<FotosEntry>;
const collectionHash = 'f'.repeat(64) as SHA256Hash<FotosCollection>;
const root: FotosManifest = {$type$: 'FotosManifest', id: `fotos:${owner}`, entries: new Set([entryHash]), collections: new Set([collectionHash])};

describe('mobile collection sharing', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.read.mockImplementation(async hash => hash === entryHash ? photo : collection);
    });

    it('adds a recipient to the existing scoped grant using exact authorized entries', async () => {
        await shareFotosMobileCollection(owner, root, 'summer', recipient);
        expect(mocks.publish).toHaveBeenCalledExactlyOnceWith({
            issuer: owner, scope: {kind: 'collection', id: 'summer'}, recipient, entryHashes: [entryHash],
        }, {});
    });

    it('does not publish a partial collection or a different owner root', async () => {
        await expect(shareFotosMobileCollection(owner, {...root, entries: new Set()}, 'summer', recipient))
            .rejects.toThrow('Some collection photos are unavailable');
        await expect(shareFotosMobileCollection(owner, {...root, id: `fotos:${previous}`}, 'summer', recipient))
            .rejects.toThrow('Your Fotos library changed');
        expect(mocks.publish).not.toHaveBeenCalled();
    });

});
