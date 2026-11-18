import {File as NodeFile} from 'node:buffer';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {FotosEntry} from '@refinio/fotos.core';
import {hashImageBytes} from '../../../../fotos.core/src/ingest/hash.js';

const runtime = vi.hoisted(() => ({
    receive: undefined as undefined | ((entry: unknown) => void),
    committed: undefined as undefined | ((entries: Array<{sourcePath?: string}>) => void),
    getObject: vi.fn(), readBlob: vi.fn(), readVersionHead: vi.fn(),
    localHandle: null as unknown,
    rootRefCreated: false,
    thumbnail: 'blob:thumbnail-only',
}));
vi.mock('react', () => ({
    useState: (initial: unknown) => {
        let current = typeof initial === 'function' ? initial() : initial;
        return [current, (next: unknown) => {
            current = typeof next === 'function' ? next(current) : next;
            if (Array.isArray(current) && current.length && current[0].hash) runtime.committed?.(current);
        }];
    },
    useRef: (initial: unknown) => {
        if (!runtime.rootRefCreated) {
            runtime.rootRefCreated = true;
            return {current: runtime.localHandle};
        }
        // Device folder/share-target restoration has already run in this focused fixture.
        return {current: initial === false ? true : initial};
    },
    useCallback: (value: unknown) => value,
    useMemo: (factory: () => unknown) => factory(),
    // Execute subscription/projection effects; keep resource cleanup registered.
    useEffect: (effect: () => void, dependencies: unknown[]) => {if (dependencies.length) effect();},
}));
vi.mock('@/lib/fotos-sync', () => ({
    syncPhotosToOneCore: vi.fn(),
    listenForFotosUpdates: (receive: (entry: unknown) => void) => {runtime.receive = receive; return () => {};},
    extractThumbUrlFromEntry: async () => runtime.thumbnail,
}));
vi.mock('@/lib/analysis-variants', () => ({extractRemoteAnalysis: async () => ({})}));
vi.mock('@/lib/platform', () => ({isMobile: () => false}));
vi.mock('@/lib/hangTrace', () => ({traceHang: vi.fn()}));
vi.mock('@/workers/face.worker.ts?worker&url', () => ({default: 'face-worker'}));
vi.mock('@/workers/semantic.worker.ts?worker&url', () => ({default: 'semantic-worker'}));
vi.mock('@refinio/one.core/lib/util/object.js', () => ({calculateIdHashOfObj: async () => 'entry-id'}));
vi.mock('@refinio/one.core/lib/storage-unversioned-objects.js', () => ({getObject: runtime.getObject}));
vi.mock('@refinio/one.core/lib/storage-versioned-objects.js', () => ({getObjectByIdHash: runtime.readVersionHead, storeVersionedObject: vi.fn()}));
vi.mock('@refinio/one.core/lib/storage-blob.js', () => ({readBlobAsArrayBuffer: runtime.readBlob, storeArrayBufferAsBlob: vi.fn()}));

import {useFolderAccess} from './useFolderAccess';

// The original has valid JPEG boundaries and deliberately differs from the thumbnail BLOB.
const originalBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x11, 0x22, 0xff, 0xd9]);
const thumbnailBytes = Uint8Array.from([0xff, 0xd8, 0x77, 0xff, 0xd9]);

async function entryFixture(): Promise<FotosEntry> {
    return {$type$: 'FotosEntry', contentHash: await hashImageBytes(originalBytes), streamId: 'native-entry',
        mime: 'image/jpeg', size: originalBytes.length, sourcePath: 'Native/Gecko-original.jpg', thumb: 'thumb-blob',
        variants: new Set(['thumb-variant', 'original-variant'])} as unknown as FotosEntry;
}

function open(options: {receivedEntries?: FotosEntry[]} = {}) {
    const committed = new Promise<Array<{sourcePath?: string}>>(resolve => {runtime.committed = resolve;});
    const access = useFolderAccess(options);
    return {access, committed};
}

async function receive(entry: FotosEntry) {
    const test = open();
    runtime.receive!(entry);
    const [photo] = await test.committed;
    return {...test, photo};
}

describe('remote Fotos originals', () => {
    afterEach(() => vi.unstubAllGlobals());
    beforeEach(() => {
        vi.clearAllMocks();
        runtime.rootRefCreated = false;
        runtime.localHandle = null;
        runtime.thumbnail = 'blob:thumbnail-only';
        vi.stubGlobal('File', NodeFile);
        runtime.getObject.mockImplementation(async hash => hash === 'original-variant'
            ? {$type$: 'FotosMediaVariant', role: 'original', contentHash: await hashImageBytes(originalBytes), blob: 'original-blob'}
            : {$type$: 'FotosMediaVariant', role: 'thumbnail', contentHash: await hashImageBytes(originalBytes), blob: 'thumb-blob'});
        runtime.readBlob.mockImplementation(async hash => (hash === 'original-blob' ? originalBytes : thumbnailBytes).slice().buffer);
        runtime.readVersionHead.mockRejectedValue(new Error('Version heads must not be sampled'));
    });

    it('exports original JPEG BLOB bytes from the arriving exact entry before any version backfill', async () => {
        const entry = await entryFixture();
        const test = await receive(entry);
        const file = await test.access.readFile(test.photo.sourcePath!);
        expect(file.name).toBe('Gecko-original.jpg');
        expect(file.type).toBe(entry.mime);
        expect(new Uint8Array(await file.arrayBuffer())).toEqual(originalBytes);
        expect(new Uint8Array(await file.arrayBuffer())).not.toEqual(thumbnailBytes);
        expect(runtime.readBlob).toHaveBeenCalledExactlyOnceWith('original-blob');
        expect(runtime.readVersionHead).not.toHaveBeenCalled();
    });

    it('rebuilds exact original bindings through admitted received manifest entries on reopen', async () => {
        const entry = await entryFixture();
        const test = open({receivedEntries: [entry]});
        const [photo] = await test.committed;
        expect(new Uint8Array(await (await test.access.readFile(photo.sourcePath!)).arrayBuffer())).toEqual(originalBytes);
        expect(runtime.readVersionHead).not.toHaveBeenCalled();
    });

    it('retains original export even when no thumbnail has arrived', async () => {
        runtime.thumbnail = '';
        const entry = await entryFixture();
        const test = await receive(entry);
        expect(test.photo.sourcePath).toBe(`remote:${entry.contentHash}`);
        expect(new Uint8Array(await (await test.access.readFile(test.photo.sourcePath!)).arrayBuffer())).toEqual(originalBytes);
    });

    it('rejects malformed remote paths and hashes without an admitted binding', async () => {
        const {access} = open();
        await expect(access.readFile('remote:../original.jpg')).rejects.toThrow('Invalid remote Fotos source path');
        await expect(access.readFile(`remote:${'a'.repeat(64)}/extra`)).rejects.toThrow('Invalid remote Fotos source path');
        await expect(access.readFile(`remote:${'a'.repeat(64)}`)).rejects.toThrow('no matching admitted entry');
        expect(runtime.readBlob).not.toHaveBeenCalled();
    });

    it('rejects a remote binding whose exact entry no longer matches its content hash', async () => {
        const entry = await entryFixture();
        const test = await receive(entry);
        entry.contentHash = 'a'.repeat(64);
        await expect(test.access.readFile(test.photo.sourcePath!)).rejects.toThrow('no matching admitted entry');
        expect(runtime.readBlob).not.toHaveBeenCalled();
    });

    it('rejects corrupt original bytes through the canonical original reader', async () => {
        const entry = await entryFixture();
        const test = await receive(entry);
        runtime.readBlob.mockResolvedValueOnce(new Uint8Array(originalBytes.length).buffer);
        await expect(test.access.readFile(test.photo.sourcePath!)).rejects.toThrow('original content hash mismatch');
    });

    it('requires the matching entry filename and MIME type rather than guessing export metadata', async () => {
        for (const patch of [{sourcePath: undefined}, {mime: ''}]) {
            runtime.rootRefCreated = false;
            const test = await receive({...await entryFixture(), ...patch});
            await expect(test.access.readFile(test.photo.sourcePath!)).rejects.toThrow('missing its filename or MIME type');
        }
        expect(runtime.readBlob).not.toHaveBeenCalled();
    });

    it('preserves local folder file reads', async () => {
        const localFile = new NodeFile([originalBytes], 'local.jpg', {type: 'image/jpeg'});
        const getFileHandle = vi.fn(async () => ({getFile: async () => localFile}));
        runtime.localHandle = {getDirectoryHandle: vi.fn(), getFileHandle};
        const {access} = open();
        expect(await access.readFile('local.jpg')).toBe(localFile);
        expect(getFileHandle).toHaveBeenCalledWith('local.jpg');
        expect(runtime.readBlob).not.toHaveBeenCalled();
    });
});
