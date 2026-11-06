import '@refinio/one.core/lib/system/load-nodejs.js';

import {describe, expect, it} from 'vitest';
import {GalleryTrieManager, type GalleryIndexEntry} from './gallery-trie.js';

interface TestPhoto extends GalleryIndexEntry {
    name: string;
}

const PHOTOS: TestPhoto[] = [
    {
        hash: 'photo-a',
        name: 'A',
        addedAt: '2026-03-08T12:00:00.000Z',
        capturedAt: '2026-03-08T12:00:00.000Z',
        updatedAt: '2026-03-09T08:00:00.000Z',
        folderPath: 'Trips/Berlin',
        sourcePath: 'Trips/Berlin/a.jpg',
        tagKeys: ['travel', 'favorites'],
        personKeys: ['Alice'],
        faceGroupKeys: ['cluster-alice'],
        faceCount: 1,
    },
    {
        hash: 'photo-b',
        name: 'B',
        addedAt: '2026-03-10T08:00:00.000Z',
        capturedAt: '2026-03-10T08:00:00.000Z',
        updatedAt: '2026-03-10T10:00:00.000Z',
        folderPath: 'Trips/Berlin',
        sourcePath: 'Trips/Berlin/b.jpg',
        tagKeys: ['travel'],
        personKeys: ['Alice', 'Bob'],
        faceGroupKeys: ['cluster-alice', 'cluster-bob'],
        faceCount: 2,
    },
    {
        hash: 'photo-c',
        name: 'C',
        addedAt: '2026-03-10T06:30:00.000Z',
        capturedAt: '2026-03-10T06:30:00.000Z',
        updatedAt: '2026-03-10T07:00:00.000Z',
        folderPath: 'Family',
        sourcePath: 'Family/c.jpg',
        tagKeys: ['family'],
    },
];

describe('GalleryTrieManager', () => {
    it('builds newest-first day groups from capture time', async () => {
        const manager = new GalleryTrieManager<TestPhoto>('gallery-test');

        await manager.replaceEntries(PHOTOS);
        const groups = await manager.getCaptureDayGroups();

        expect(groups.map(group => group.date)).toEqual(['2026-03-10', '2026-03-08']);
        expect(groups[0].entries.map(entry => entry.hash)).toEqual(['photo-b', 'photo-c']);
        expect(groups[1].entries.map(entry => entry.hash)).toEqual(['photo-a']);
    });

    it('queries nested folder paths through the folder trie', async () => {
        const manager = new GalleryTrieManager<TestPhoto>('gallery-test');

        await manager.replaceEntries(PHOTOS);

        expect((await manager.getEntriesForFolder('Trips')).map(entry => entry.hash)).toEqual([
            'photo-b',
            'photo-a',
        ]);
        expect((await manager.getEntriesForFolder('Trips/Berlin')).map(entry => entry.hash)).toEqual([
            'photo-b',
            'photo-a',
        ]);
        expect((await manager.getEntriesForFolder('Family')).map(entry => entry.hash)).toEqual([
            'photo-c',
        ]);
    });

    it('queries capture-time ranges through the shared trie', async () => {
        const manager = new GalleryTrieManager<TestPhoto>('gallery-test');

        await manager.replaceEntries(PHOTOS);

        expect((
            await manager.getEntriesInDateRange(
                new Date('2026-03-10T00:00:00.000Z'),
                new Date('2026-03-10T23:59:59.999Z')
            )
        ).map(entry => entry.hash)).toEqual([
            'photo-b',
            'photo-c',
        ]);

        expect((
            await manager.getEntriesInDateRange(
                new Date('2026-03-09T23:59:59.999Z'),
                new Date('2026-03-08T00:00:00.000Z')
            )
        ).map(entry => entry.hash)).toEqual([
            'photo-a',
        ]);
    });

    it('queries tag, person, and face-group facets through projection tries', async () => {
        const manager = new GalleryTrieManager<TestPhoto>('gallery-test');

        await manager.replaceEntries(PHOTOS);

        expect((await manager.getEntriesForTag('travel')).map(entry => entry.hash)).toEqual([
            'photo-b',
            'photo-a',
        ]);
        expect((await manager.getEntriesForPerson('Alice')).map(entry => entry.hash)).toEqual([
            'photo-b',
            'photo-a',
        ]);
        expect((await manager.getEntriesForFaceGroup('cluster-bob')).map(entry => entry.hash)).toEqual([
            'photo-b',
        ]);
        expect((await manager.getEntriesWithDetectedFaces()).map(entry => entry.hash)).toEqual([
            'photo-b',
            'photo-a',
        ]);
    });

    it('lists facet counts for browse selections', async () => {
        const manager = new GalleryTrieManager<TestPhoto>('gallery-test');

        await manager.replaceEntries(PHOTOS);

        expect(manager.listTagCounts()).toEqual([
            {key: 'travel', count: 2},
            {key: 'family', count: 1},
            {key: 'favorites', count: 1},
        ]);
        expect(manager.listPersonCounts()).toEqual([
            {key: 'Alice', count: 2},
            {key: 'Bob', count: 1},
        ]);
        expect(manager.listFaceGroupCounts()).toEqual([
            {key: 'cluster-alice', count: 2},
            {key: 'cluster-bob', count: 1},
        ]);
    });

    it('rebuilds tries cleanly on upsert and remove', async () => {
        const manager = new GalleryTrieManager<TestPhoto>('gallery-test');

        await manager.replaceEntries(PHOTOS);
        await manager.upsertEntry({
            hash: 'photo-d',
            name: 'D',
            addedAt: '2026-03-11T09:00:00.000Z',
            capturedAt: '2026-03-11T09:00:00.000Z',
            updatedAt: '2026-03-11T09:30:00.000Z',
            folderPath: 'Trips/Paris',
            sourcePath: 'Trips/Paris/d.jpg',
            tagKeys: ['travel'],
            personKeys: ['Carla'],
            faceGroupKeys: ['cluster-carla'],
            faceCount: 1,
        });

        expect((await manager.getCaptureDayGroups()).map(group => group.date)[0]).toBe('2026-03-11');
        expect((await manager.getEntriesForFolder('Trips')).map(entry => entry.hash)).toContain('photo-d');
        expect((await manager.getEntriesForPerson('Carla')).map(entry => entry.hash)).toEqual(['photo-d']);

        await manager.removeEntry('photo-b');

        expect((await manager.getEntriesForFolder('Trips/Berlin')).map(entry => entry.hash)).toEqual([
            'photo-a',
        ]);
        expect((await manager.getCaptureDayGroups())[0].entries.map(entry => entry.hash)).toEqual(['photo-d']);
        expect((await manager.getEntriesForPerson('Bob')).map(entry => entry.hash)).toEqual([]);
    });
});
