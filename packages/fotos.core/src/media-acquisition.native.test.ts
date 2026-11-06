import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import '@refinio/one.core/lib/system/load-nodejs.js';
import {closeInstance, getInstanceOwnerIdHash, initInstance} from '@refinio/one.core/lib/instance.js';
import {resetBaseDirOrName} from '@refinio/one.core/lib/system/storage-base.js';
import {getObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {getObjectByIdHash, storeVersionedObject} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {determineDirectChildren, determineChildrenFromHash} from '@refinio/one.core/lib/util/determine-children.js';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';
import type {BLOB} from '@refinio/one.core/lib/recipes.js';
import {FotosRecipes, type FotosEntry} from './recipes/FotosRecipes.js';
import {FotosFileSystem} from './fotos-file-system.js';
import {createFotosMediaVariant} from './media-model.js';
import {recordFotosAcquisition, traceFotosAcquisitions} from './media-acquisition.js';
import {createFotosShareManifest} from './share-model.js';

const limits = {maxDepth: 8, maxNodes: 16, maxResources: 64};

describe('Fotos public acquisition publication on native ONE', () => {
    let directory: string;
    const options = () => ({
        directory, name: 'fotos-acquisition', email: 'fotos-acquisition@test.invalid',
        secret: 'fotos-acquisition-test', encryptStorage: false, initialRecipes: FotosRecipes,
    });
    beforeAll(async () => {
        directory = await mkdtemp(join(tmpdir(), 'fotos-acquisition-'));
        await initInstance({...options(), wipeStorage: true});
    }, 30_000);
    afterAll(async () => {
        closeInstance();
        resetBaseDirOrName();
        await rm(directory, {recursive: true, force: true});
    });

    it('publishes an attributable acquisition from importFile and reloads it through its manifest', async () => {
        const fs = new FotosFileSystem('fotos', true);
        await fs.init();
        await fs.importFile('original.png', new Uint8Array([1, 2, 3, 4]).buffer);
        const before = await fs.stat('/original.png');
        expect(before.acquisitionObservations).toHaveLength(1);
        closeInstance();
        resetBaseDirOrName();
        await initInstance({...options(), wipeStorage: false});
        const reloaded = new FotosFileSystem('fotos');
        const manifest = await getObjectByIdHash(await reloaded.getRootId());
        const entryHash = [...manifest.obj.entries][0];
        const entry = await getObject(entryHash);
        expect(await determineDirectChildren(manifest.obj)).toContainEqual({type: 'object', hash: entryHash});
        const [observationHash] = [...entry.acquisitionObservations!];
        expect(await determineDirectChildren(entry)).toContainEqual({type: 'object', hash: observationHash});
        const [trace] = await reloaded.getProvenance('/original.png', limits);
        expect(trace.complete).toBe(true);
        expect(trace.gaps).toEqual([]);
        expect(trace.assumptions.size).toBe(0);
        const observation = trace.observations[0].observation;
        expect(observation.observer).toBe(getInstanceOwnerIdHash());
        expect(await getObject(observation.claim)).toMatchObject({
            $type$: 'FotosAcquisitionClaim', kind: 'bytes-acquired',
            capture: 'unestablished', authorship: 'unestablished', licensingAuthority: 'unestablished',
        });
        expect(await getObject(observation.method)).toMatchObject({procedure: 'retain-original-bytes'});
        expect(await getObject(observation.context)).toMatchObject({surface: 'filesystem', source: 'original.png'});
        const blob = observation.evidence.find(resource => resource.kind === 'blob');
        expect(blob).toBeDefined();
        expect(await determineDirectChildren(observation)).toContainEqual({type: 'blob', hash: blob!.kind === 'blob' ? blob!.blob : ''});
        expect(new Uint8Array((await reloaded.readFile('/original.png')).content)).toEqual(new Uint8Array([1, 2, 3, 4]));

        // The exact new products also remain legal members of the share closure.
        const children = await determineChildrenFromHash(entryHash);
        expect(children).toEqual(expect.arrayContaining([
            {type: 'object', hash: observationHash},
            {type: 'object', hash: observation.claim},
            {type: 'object', hash: observation.method},
            {type: 'object', hash: observation.context},
            {type: 'id', hash: observation.observer},
        ]));
        await storeVersionedObject(createFotosShareManifest({
            issuer: getInstanceOwnerIdHash()!, scope: {kind: 'gallery', id: 'provenance'},
            entries: [entryHash], snapshotChildren: children,
        }));
    });

    it('labels metadata-only intake and retains the unsupported premise explicitly', async () => {
        const entry: FotosEntry = {$type$: 'FotosEntry', contentHash: 'a'.repeat(64), streamId: 'metadata', mime: 'image/jpeg', size: 5};
        const stored = await storeVersionedObject(entry);
        const variant = await storeVersionedObject(createFotosMediaVariant({
            contentHash: entry.contentHash, family: stored.idHash, role: 'original', mime: entry.mime, byteSize: 5,
        }));
        const observation = await recordFotosAcquisition({
            observer: getInstanceOwnerIdHash()!, originalVariant: variant.hash,
            context: {acquiredAt: 123, surface: 'browser', source: 'remote:reported.jpg', reportedCaptureTime: '2000-01-01', reportedCamera: 'Reported camera'},
        });
        const [trace] = await traceFotosAcquisitions({...entry, acquisitionObservations: new Set([observation])}, limits);
        expect(await getObject(trace.observations[0].observation.claim)).toMatchObject({kind: 'metadata-imported', capture: 'unestablished', authorship: 'unestablished', licensingAuthority: 'unestablished'});
        expect(trace.assumptions.size).toBe(1);
        expect(await getObject([...trace.assumptions][0])).toMatchObject({proposition: 'imported-metadata-corresponds-to-unavailable-original'});
        expect(await getObject(trace.observations[0].observation.context)).toMatchObject({reportedCaptureTime: '2000-01-01', reportedCamera: 'Reported camera'});
        expect(trace.observations[0].observation.evidence.some(resource => resource.kind === 'blob')).toBe(false);
    });

    it('fails visibly for unavailable bytes and leaves the publication root unchanged', async () => {
        const fs = new FotosFileSystem('fotos', true);
        const before = await getObjectByIdHash(await fs.getRootId());
        await expect(fs.createFile('/', 'f'.repeat(64) as SHA256Hash<BLOB>, 'missing.png', 0)).rejects.toThrow();
        expect((await getObjectByIdHash(await fs.getRootId())).hash).toBe(before.hash);
        await expect(fs.stat('/missing.png')).rejects.toThrow('does not exist');
    });

    it('rejects a missing BLOB at the public provenance recorder', async () => {
        const entry = await storeVersionedObject<FotosEntry>({$type$: 'FotosEntry', contentHash: 'c'.repeat(64), streamId: 'missing-blob', mime: 'image/png', size: 1});
        const variant = await storeVersionedObject(createFotosMediaVariant({
            contentHash: 'c'.repeat(64), family: entry.idHash, role: 'original', mime: 'image/png', byteSize: 1,
            blob: 'e'.repeat(64) as SHA256Hash<BLOB>,
        }));
        await expect(recordFotosAcquisition({
            observer: getInstanceOwnerIdHash()!, originalVariant: variant.hash,
            context: {acquiredAt: 123, surface: 'filesystem', source: 'missing.png'},
        })).rejects.toThrow('unavailable');
    });

    it('preserves entries written without the new optional provenance edge', async () => {
        const legacy = await storeVersionedObject<FotosEntry>({$type$: 'FotosEntry', contentHash: 'b'.repeat(64), streamId: 'legacy', mime: 'image/png', size: 1});
        const reloaded = await getObject(legacy.hash);
        expect(reloaded.acquisitionObservations).toBeUndefined();
        expect(await traceFotosAcquisitions(reloaded, limits)).toEqual([]);
    });
});
