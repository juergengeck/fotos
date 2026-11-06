import '@refinio/one.core/lib/system/load-nodejs.js';

import {describe, expect, it} from 'vitest';
import type {FotosCatalogEntry, FotosStream} from './fotos-catalog.js';
import {FotosCatalogTrie} from './fotos-catalog-trie.js';

const makeEntry = (
    id: string,
    date: string,
    tags: string[] = ['test'],
    folderPath?: string,
    people?: string[],
    faceGroups?: string[],
    faceCount?: number
): FotosCatalogEntry => ({
    stream: {
        $type$: 'Stream',
        id,
        creator: 'test-creator' as any,
        created: Date.now(),
        mimeType: 'image/jpeg',
        status: 'finalized',
        exif: {date},
    } as FotosStream,
    name: `photo-${id.slice(0, 4)}.jpg`,
    managed: 'metadata',
    folderPath,
    tags,
    people,
    faceGroups,
    faceCount,
    size: 1000,
});

describe('FotosCatalogTrie', () => {
    it('insert and retrieve a photo', async () => {
        const trie = await FotosCatalogTrie.create('test');
        const entry = makeEntry('a'.repeat(64), '2025-08-15T10:30:00');
        await trie.insert(entry);
        expect(trie.getEntry(entry.stream.id)).toEqual(entry);
        expect(trie.allEntries()).toHaveLength(1);
    });

    it('query by date range', async () => {
        const trie = await FotosCatalogTrie.create('test');
        await trie.insert(makeEntry('a'.repeat(64), '2025-08-15T10:00:00', ['test'], 'Trips/Berlin'));
        await trie.insert(makeEntry('b'.repeat(64), '2025-09-01T14:00:00', ['test'], 'Trips/Berlin'));
        await trie.insert(makeEntry('c'.repeat(64), '2025-12-25T09:00:00', ['test'], 'Family'));

        const aug = await trie.queryDateRange(new Date('2025-08-01'), new Date('2025-08-31'));
        expect(aug).toHaveLength(1);
        expect(aug[0].stream.id).toBe('a'.repeat(64));

        const all = await trie.queryDateRange(new Date('2025-01-01'), new Date('2025-12-31'));
        expect(all).toHaveLength(3);
    });

    it('query by folder path', async () => {
        const trie = await FotosCatalogTrie.create('test');
        await trie.insert(makeEntry('a'.repeat(64), '2025-08-15T10:00:00', ['test'], 'Trips/Berlin'));
        await trie.insert(makeEntry('b'.repeat(64), '2025-09-01T14:00:00', ['test'], 'Trips/Berlin'));
        await trie.insert(makeEntry('c'.repeat(64), '2025-12-25T09:00:00', ['test'], 'Family'));

        expect((await trie.getEntriesForFolder('Trips')).map(entry => entry.stream.id)).toEqual([
            'b'.repeat(64),
            'a'.repeat(64),
        ]);
        expect((await trie.getEntriesForFolder('Trips/Berlin')).map(entry => entry.stream.id)).toEqual([
            'b'.repeat(64),
            'a'.repeat(64),
        ]);
        expect((await trie.getEntriesForFolder('Family')).map(entry => entry.stream.id)).toEqual([
            'c'.repeat(64),
        ]);
    });

    it('queries tag, person, group, and detected-face projections', async () => {
        const trie = await FotosCatalogTrie.create('test');
        await trie.insert(makeEntry(
            'a'.repeat(64),
            '2025-08-15T10:00:00',
            ['travel', 'favorites'],
            'Trips/Berlin',
            ['Alice'],
            ['cluster-alice'],
            1
        ));
        await trie.insert(makeEntry(
            'b'.repeat(64),
            '2025-09-01T14:00:00',
            ['travel'],
            'Trips/Berlin',
            ['Alice', 'Bob'],
            ['cluster-alice', 'cluster-bob'],
            2
        ));
        await trie.insert(makeEntry('c'.repeat(64), '2025-12-25T09:00:00', ['family'], 'Family'));

        expect((await trie.getEntriesForTag('travel')).map(entry => entry.stream.id)).toEqual([
            'b'.repeat(64),
            'a'.repeat(64),
        ]);
        expect((await trie.getEntriesForPerson('Alice')).map(entry => entry.stream.id)).toEqual([
            'b'.repeat(64),
            'a'.repeat(64),
        ]);
        expect((await trie.getEntriesForFaceGroup('cluster-bob')).map(entry => entry.stream.id)).toEqual([
            'b'.repeat(64),
        ]);
        expect((await trie.getEntriesWithDetectedFaces()).map(entry => entry.stream.id)).toEqual([
            'b'.repeat(64),
            'a'.repeat(64),
        ]);
        expect(trie.listTagCounts()).toEqual([
            {key: 'travel', count: 2},
            {key: 'family', count: 1},
            {key: 'favorites', count: 1},
        ]);
        expect(trie.listPersonCounts()).toEqual([
            {key: 'Alice', count: 2},
            {key: 'Bob', count: 1},
        ]);
        expect(trie.listFaceGroupCounts()).toEqual([
            {key: 'cluster-alice', count: 2},
            {key: 'cluster-bob', count: 1},
        ]);
    });

    it('sync root changes on insert', async () => {
        const trie = await FotosCatalogTrie.create('test');
        expect(await trie.syncRoot()).toBeNull();

        await trie.insert(makeEntry('a'.repeat(64), '2025-08-15T10:00:00'));
        expect(await trie.syncRoot()).not.toBeNull();
    });

    it('diff finds missing entries', async () => {
        const trieA = await FotosCatalogTrie.create('a');
        const trieB = await FotosCatalogTrie.create('b');

        await trieA.insert(makeEntry('a'.repeat(64), '2025-08-15T10:00:00'));
        await trieA.insert(makeEntry('b'.repeat(64), '2025-09-01T14:00:00'));
        await trieB.insert(makeEntry('a'.repeat(64), '2025-08-15T10:00:00'));

        const missing = trieA.diffFrom(trieB);
        expect(missing).toHaveLength(1);
        expect(missing[0]).toBe('b'.repeat(64));
    });

    it('serialize and restore round-trips', async () => {
        const trie = await FotosCatalogTrie.create('test');
        await trie.insert(makeEntry(
            'a'.repeat(64),
            '2025-08-15T10:00:00',
            ['test'],
            'Trips/Berlin',
            ['Alice'],
            ['cluster-alice'],
            1
        ));
        await trie.insert(makeEntry('b'.repeat(64), '2025-09-01T14:00:00', ['test'], 'Trips/Paris'));

        const snapshot = trie.serialize();
        const restored = await FotosCatalogTrie.fromSnapshot(snapshot, 'test');

        expect(restored.allEntries()).toHaveLength(2);
        expect(restored.getEntry('a'.repeat(64))).toBeDefined();
        expect(restored.getEntry('a'.repeat(64))?.folderPath).toBe('Trips/Berlin');
        expect(restored.getEntry('a'.repeat(64))?.people).toEqual(['Alice']);
        expect(await restored.syncRoot()).toBe(await trie.syncRoot());
    });

    it('updateEntry modifies metadata without affecting trie', async () => {
        const trie = await FotosCatalogTrie.create('test');
        const entry = makeEntry('a'.repeat(64), '2025-08-15T10:00:00', ['landscape']);
        await trie.insert(entry);

        const updated = {...entry, tags: ['landscape', 'sunset']};
        await trie.updateEntry(entry.stream.id, updated);

        expect(trie.getEntry(entry.stream.id)?.tags).toEqual(['landscape', 'sunset']);
    });
});
