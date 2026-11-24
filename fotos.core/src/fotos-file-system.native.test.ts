import '@refinio/one.core/lib/system/load-nodejs.js';
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {closeInstance, getInstanceOwnerIdHash, initInstance} from '@refinio/one.core/lib/instance.js';
import {resetBaseDirOrName} from '@refinio/one.core/lib/system/storage-base.js';
import {createAccess} from '@refinio/one.core/lib/access.js';
import {SET_ACCESS_MODE} from '@refinio/one.core/lib/storage-base-common.js';
import {beginAccessManagerChumSession, endAccessManagerChumSession, getAccessibleRootHashes, getChildren,
    isAccessibleBy} from '@refinio/one.core/lib/accessManager.js';
import {getObjectByIdHash, storeVersionedObject} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {getObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {readBlobAsArrayBuffer, storeArrayBufferAsBlob} from '@refinio/one.core/lib/storage-blob.js';
import {calculateIdHashOfObj} from '@refinio/one.core/lib/util/object.js';
import type {Person} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import {FotosRecipes} from './recipes/FotosRecipes.js';
import {FotosFileSystem, getOwnedFotosManifestId, readFotosOriginal, type FotosThumbnailAdapter} from './fotos-file-system.js';
import {hashImageBytes, sha256Hex} from './ingest/hash.js';
import {createFotosMediaVariant} from './media-model.js';

// A real one-pixel JPEG, generated with an image decoder; not original bytes relabeled as a thumbnail.
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAASABIAAD/4QCARXhpZgAATU0AKgAAAAgABAEaAAUAAAABAAAAPgEbAAUAAAABAAAARgEoAAMAAAABAAIAAIdpAAQAAAABAAAATgAAAAAAAABIAAAAAQAAAEgAAAABAAOgAQADAAAAAQABAACgAgAEAAAAAQAAAAGgAwAEAAAAAQAAAAEAAAAA/+0AOFBob3Rvc2hvcCAzLjAAOEJJTQQEAAAAAAAAOEJJTQQlAAAAAAAQ1B2M2Y8AsgTpgAmY7PhCfv/AABEIAAEAAQMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgv/xAC1EAACAQMDAgQDBQUEBAAAAX0BAgMABBEFEiExQQYTUWEHInEUMoGRoQgjQrHBFVLR8CQzYnKCCQoWFxgZGiUmJygpKjQ1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4eLj5OXm5+jp6vHy8/T19vf4+fr/xAAfAQADAQEBAQEBAQEBAAAAAAAAAQIDBAUGBwgJCgv/xAC1EQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2wBDAAICAgICAgMCAgMFAwMDBQYFBQUFBggGBgYGBggKCAgICAgICgoKCgoKCgoMDAwMDAwODg4ODg8PDw8PDw8PDw//2wBDAQICAgQEBAcEBAcQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/3QAEAAH/2gAMAwEAAhEDEQA/APuyiiiviz+mD//Z', 'base64');
const ORIGINAL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
/** Copy fixture bytes into an ordinary ArrayBuffer. */
function buffer(bytes: Uint8Array): ArrayBuffer { return Uint8Array.from(bytes).buffer; }

describe('Fotos filesystem thumbnail publication on native ONE', () => {
    it('reads metadata-rewritten JPEG, PNG and HEIC originals with the recorded bitfield identity', async () => {
        const folder = new URL('../../../one/packages/media.core/test/fixtures/bitfield-hash/', import.meta.url);
        const manifest = JSON.parse(await readFile(new URL('generated-pairs.json', folder), 'utf8')) as {
            pairs: Array<{format: string; original: string; rewritten: string; contentHash: string}>;
        };
        for (const pair of manifest.pairs) {
            const original = await readFile(new URL(pair.original, folder));
            const rewritten = await readFile(new URL(pair.rewritten, folder));
            const entry = {
                $type$: 'FotosEntry' as const, contentHash: pair.contentHash, streamId: pair.contentHash,
                mime: `image/${pair.format}`, size: original.byteLength, originalFilename: pair.original,
            };
            expect(rewritten.byteLength, pair.format).not.toBe(entry.size);
            await expect(readFotosOriginal(entry, async () => buffer(rewritten))).resolves.toEqual({content: buffer(rewritten)});
        }
    });

    it('stores tags in the object version while retaining the same image identity', async () => {
        const untagged = await storeVersionedObject({
            $type$: 'FotosEntry', contentHash: 'c'.repeat(64), streamId: 'tag-test', mime: 'image/jpeg', size: 1,
        });
        const tagged = await storeVersionedObject({...untagged.obj, tags: new Set(['Weekend'])});
        expect(tagged.idHash).toBe(untagged.idHash);
        expect(tagged.hash).not.toBe(untagged.hash);
        expect((await getObject(tagged.hash)).tags).toEqual(new Set(['Weekend']));
        expect((await getObject(untagged.hash)).tags).toBeUndefined();
    });

    let directory: string;
    beforeAll(async () => {
        directory = await mkdtemp(join(tmpdir(), 'fotos-thumbnail-publication-'));
        await initInstance({directory, name: 'fotos-thumbnail-test', email: 'fotos-thumbnail@test.invalid',
            secret: 'test-secret', encryptStorage: false, initialRecipes: FotosRecipes});
    }, 30_000);
    afterAll(async () => {
        closeInstance(); resetBaseDirOrName();
        await rm(directory, {recursive: true, force: true});
    });

    it('keeps one ONE identity across image metadata versions and verifies both originals', async () => {
        const sharedFixtures = new URL('../../../one/packages/media.core/test/fixtures/bitfield-hash/', import.meta.url);
        const fixture = (name: string) => readFile(new URL(name, sharedFixtures));
        const plain = await fixture('plain.png');
        const withMetadata = await fixture('with-exif-and-text.png');
        const otherImage = await fixture('different-pixels.png');
        const contentHash = await hashImageBytes(plain);
        const first = {$type$: 'FotosEntry' as const, contentHash, streamId: contentHash,
            mime: 'image/png', size: plain.length, originalFilename: 'first.png', capturedAt: '2026-01-01'};
        const second = {...first, contentHash: await hashImageBytes(withMetadata), size: withMetadata.length,
            originalFilename: 'second.png', capturedAt: '2026-01-02', favorite: true};
        const storedFirst = await storeVersionedObject(first);
        const storedSecond = await storeVersionedObject(second);
        expect(storedFirst.idHash).toBe(storedSecond.idHash);
        expect(storedFirst.hash).not.toBe(storedSecond.hash);
        await expect(readFotosOriginal(first, async () => buffer(withMetadata))).resolves.toEqual({content: buffer(withMetadata)});
        await expect(readFotosOriginal(second, async () => buffer(plain))).resolves.toEqual({content: buffer(plain)});
        await expect(readFotosOriginal(second, async () => buffer(otherImage))).rejects.toThrow('content hash mismatch');
        const legacy = {...second, contentHash: await sha256Hex(withMetadata)};
        expect(legacy.contentHash).not.toBe(contentHash);
        await expect(readFotosOriginal(legacy, async () => buffer(withMetadata))).resolves.toEqual({content: buffer(withMetadata)});
        const variant = createFotosMediaVariant({contentHash, family: storedFirst.idHash, role: 'original', mime: first.mime});
        const reference = await storeVersionedObject(variant);
        const blob = await storeArrayBufferAsBlob(plain);
        const ingest = await storeVersionedObject({...variant, blob: blob.hash});
        await expect(readFotosOriginal({...second, variants: new Set([reference.hash, ingest.hash])}))
            .resolves.toEqual({content: buffer(plain)});
    });

    it('publishes exact original and thumbnail bytes with acquisition and owner-only access through the scoped root', async () => {
        const createThumbnail = vi.fn<FotosThumbnailAdapter>(async () => buffer(JPEG));
        const owner = getInstanceOwnerIdHash()!;
        const fs = new FotosFileSystem(getOwnedFotosManifestId(owner), true, undefined, createThumbnail);
        const rootId = await fs.getRootId();
        expect(rootId).not.toBe(await new FotosFileSystem('fotos').getRootId());
        expect(rootId).not.toBe(await new FotosFileSystem(getOwnedFotosManifestId('b'.repeat(64))).getRootId());
        // Identical to native composition: establish the owner grant before the root exists.
        await createAccess([{id: rootId, person: [owner], hashGroup: [], mode: SET_ACCESS_MODE.ADD}]);
        await fs.init();
        const beforeImport = await fs.stat('/');
        expect(beforeImport.mode).toBe(0o040755);
        expect(beforeImport.canAddChildren).toBe(true);
        const readOnlyView = new FotosFileSystem(getOwnedFotosManifestId(owner));
        const readOnlyRoot = await readOnlyView.stat('/');
        expect(readOnlyRoot.mode).toBe(0o040555);
        expect(readOnlyRoot.canAddChildren).toBe(false);
        expect(readOnlyRoot.contentHash).toBe(beforeImport.contentHash);
        expect(readOnlyRoot.metadataHash).not.toBe(beforeImport.metadataHash);
        await fs.importFile('original.png', buffer(ORIGINAL));
        const afterImport = await fs.stat('/');
        expect(afterImport.mode).toBe(0o040755);
        expect(afterImport.canAddChildren).toBe(true);
        expect(afterImport.contentHash).not.toBe(beforeImport.contentHash);
        expect(afterImport.metadataHash).not.toBe(beforeImport.metadataHash);
        const immutableOriginal = await fs.stat('/original.png');
        expect(immutableOriginal.mode).toBe(0o100444);
        expect(immutableOriginal.canAddChildren).toBe(false);
        await expect(readOnlyView.importFile('forbidden.png', buffer(ORIGINAL))).rejects.toThrow('writable Fotos root');
        expect(createThumbnail).toHaveBeenCalledWith(buffer(ORIGINAL), 'image/png');
        const manifest = await getObjectByIdHash(rootId);
        expect(manifest.obj.id).toBe(getOwnedFotosManifestId(owner));
        const [entryHash] = [...manifest.obj.entries];
        const entry = await getObject(entryHash);
        expect(entry.thumb).toBeDefined();
        expect(new Uint8Array(await readBlobAsArrayBuffer(entry.thumb!))).toEqual(new Uint8Array(JPEG));
        expect(new Uint8Array((await fs.readFile('/original.png')).content)).toEqual(new Uint8Array(ORIGINAL));
        const variants = await Promise.all([...entry.variants!].map(hash => getObject(hash)));
        const original = variants.find(variant => variant.role === 'original')!;
        const thumbnail = variants.find(variant => variant.role === 'thumbnail')!;
        expect(variants).toHaveLength(2);
        expect(thumbnail).toMatchObject({mime: 'image/jpeg', width: 1, height: 1, byteSize: JPEG.length, blob: entry.thumb,
            derivedFrom: await calculateIdHashOfObj(original)});
        const observation = await getObject([...entry.acquisitionObservations!][0]);
        expect(observation.observer).toBe(owner);

        const accessId = await calculateIdHashOfObj({$type$: 'IdAccess', id: rootId});
        expect((await getObjectByIdHash(accessId)).obj).toMatchObject({person: [owner], hashGroup: []});
        const stranger = 'ab'.repeat(32) as SHA256IdHash<Person>;
        beginAccessManagerChumSession(owner); beginAccessManagerChumSession(stranger);
        try {
            await getAccessibleRootHashes(owner);
            const queue: SHA256Hash[] = [manifest.hash];
            const visited = new Set<string>();
            // Exercise canonical authorization edge by edge, with a strict bound on this fixture's DAG.
            while (queue.length > 0) {
                const hash = queue.shift()!;
                if (visited.has(hash)) continue;
                if (visited.size >= 64) throw new Error('Unexpectedly large fixture media graph');
                visited.add(hash);
                expect(await isAccessibleBy(owner, hash)).toBe(true);
                for (const child of await getChildren(owner, hash)) {
                    if (child.type === 'object') queue.push(child.hash as SHA256Hash);
                }
            }
            expect(await isAccessibleBy(owner, original.blob!)).toBe(true);
            expect(await isAccessibleBy(owner, entry.thumb!)).toBe(true);
            await getAccessibleRootHashes(stranger);
            expect(await isAccessibleBy(stranger, manifest.hash)).toBe(false);
            expect(await isAccessibleBy(stranger, original.blob!)).toBe(false);
            expect(await isAccessibleBy(stranger, entry.thumb!)).toBe(false);
        } finally {endAccessManagerChumSession(owner); endAccessManagerChumSession(stranger);}
    });

    it('projects 100 exact metadata versions as one immutable original without rewriting the owner root on reads', async () => {
        const fs = new FotosFileSystem(getOwnedFotosManifestId(getInstanceOwnerIdHash()!), true);
        const rootId = await fs.getRootId();
        const original = await getObjectByIdHash(rootId);
        const entry = await getObject([...original.obj.entries][0]);
        const refs = [];
        for (let faceCount = 0; faceCount < 100; faceCount++) {
            refs.push((await storeVersionedObject({...entry, faceCount})).hash);
        }
        const snapshot = await storeVersionedObject({...original.obj, entries: new Set(refs)});
        expect(await fs.readDir('/')).toEqual({children: ['original.png']});
        const before = await fs.stat('/original.png');
        expect(before.contentHash).toBe(entry.contentHash);
        expect(new Uint8Array((await fs.readFile('/original.png')).content)).toEqual(new Uint8Array(ORIGINAL));
        expect((await getObjectByIdHash(rootId)).hash).toBe(snapshot.hash);
        await storeVersionedObject({...snapshot.obj, entries: new Set([...refs].reverse())});
        expect(await fs.stat('/original.png')).toEqual(before);
        await storeVersionedObject({...snapshot.obj, entries: new Set(refs.slice(0, 99))});
        expect((await fs.stat('/original.png')).metadataHash).not.toBe(before.metadataHash);

        const distinct = await storeVersionedObject({...entry, contentHash: 'a'.repeat(64)});
        await storeVersionedObject({$type$: 'FotosManifest', id: 'fotos', entries: new Set([refs[0], distinct.hash])});
        await expect(new FotosFileSystem('fotos').readDir('/')).rejects.toMatchObject({code: -17});
    }, 15000);

    it.each(['failed', 'empty', 'oversized', 'missing'] as const)('leaves the manifest unchanged when the adapter returns %s output', async kind => {
        const adapter: FotosThumbnailAdapter = async () => {
            if (kind === 'failed') throw new Error('Decoder failed');
            if (kind === 'empty') return new ArrayBuffer(0);
            if (kind === 'missing') return undefined as never;
            const bytes = Uint8Array.from(JPEG);
            const frame = bytes.findIndex((value, index) => value === 0xff && bytes[index + 1] === 0xc0);
            bytes[frame + 7] = 2; bytes[frame + 8] = 1;
            return bytes.buffer;
        };
        const fs = new FotosFileSystem(getOwnedFotosManifestId(getInstanceOwnerIdHash()!), true, undefined, adapter);
        const before = await getObjectByIdHash(await fs.getRootId());
        const changed = Uint8Array.from(ORIGINAL); changed[changed.length - 1] ^= kind.length;
        await expect(fs.importFile(`${kind}.png`, changed.buffer)).rejects.toThrow();
        expect((await getObjectByIdHash(await fs.getRootId())).hash).toBe(before.hash);
    });
});
