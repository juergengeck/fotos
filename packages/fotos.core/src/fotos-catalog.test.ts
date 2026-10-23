import '@refinio/one.core/lib/system/load-nodejs.js';

import {describe, expect, it} from 'vitest';
import {
    filterFotosCatalogEntries,
    listFotosFaceGroups,
    listFotosPeople,
    listFotosTags,
    type FotosCatalogEntry,
    type FotosStream,
    type FotosCatalogV2,
} from './fotos-catalog.js';
import {FotosCatalogTrie} from './fotos-catalog-trie.js';

function makeEntry(
    id: string,
    name: string,
    folderPath: string | undefined,
    tags: string[],
    createdAt: number,
    people?: string[],
    faceGroups?: string[],
    faceCount?: number
): FotosCatalogEntry {
    return {
        stream: {
            $type$: 'Stream',
            id,
            creator: 'test-creator' as any,
            created: createdAt,
            mimeType: 'image/jpeg',
            status: 'finalized',
        } as FotosStream,
        name,
        managed: 'metadata',
        folderPath,
        tags,
        people,
        faceGroups,
        faceCount,
        size: 1000,
    };
}

async function makeCatalog(): Promise<FotosCatalogV2> {
    return {
        version: 2,
        name: 'test',
        created: '2026-03-10T00:00:00.000Z',
        trie: await FotosCatalogTrie.create('catalog-test'),
    };
}

describe('fotos catalog helpers', () => {
    it('filters entries through shared facet tries', async () => {
        const catalog = await makeCatalog();
        await catalog.trie.insert(makeEntry(
            'a'.repeat(64),
            'berlin.jpg',
            'Trips/Berlin',
            ['travel'],
            Date.parse('2026-03-08T10:00:00.000Z'),
            ['Alice'],
            ['cluster-alice'],
            1
        ));
        await catalog.trie.insert(makeEntry(
            'b'.repeat(64),
            'family.jpg',
            'Family',
            ['family'],
            Date.parse('2026-03-09T10:00:00.000Z'),
            ['Bob'],
            ['cluster-bob'],
            1
        ));

        expect((await filterFotosCatalogEntries(catalog, {folder: 'Trips'})).map(entry => entry.name)).toEqual([
            'berlin.jpg',
        ]);
        expect((await filterFotosCatalogEntries(catalog, {tag: 'travel', folder: 'Trips/Berlin'})).map(entry => entry.name)).toEqual([
            'berlin.jpg',
        ]);
        expect((await filterFotosCatalogEntries(catalog, {person: 'Alice'})).map(entry => entry.name)).toEqual([
            'berlin.jpg',
        ]);
        expect((await filterFotosCatalogEntries(catalog, {faceGroup: 'cluster-bob'})).map(entry => entry.name)).toEqual([
            'family.jpg',
        ]);
        expect((await filterFotosCatalogEntries(catalog, {detectedFaces: true})).map(entry => entry.name)).toEqual([
            'family.jpg',
            'berlin.jpg',
        ]);
    });

    it('lists tag, person, and group browse counts', async () => {
        const catalog = await makeCatalog();
        await catalog.trie.insert(makeEntry(
            'a'.repeat(64),
            'berlin.jpg',
            'Trips/Berlin',
            ['travel', 'favorites'],
            Date.parse('2026-03-08T10:00:00.000Z'),
            ['Alice'],
            ['cluster-alice'],
            1
        ));
        await catalog.trie.insert(makeEntry(
            'b'.repeat(64),
            'family.jpg',
            'Family',
            ['family'],
            Date.parse('2026-03-09T10:00:00.000Z'),
            ['Bob'],
            ['cluster-bob'],
            1
        ));

        expect(listFotosTags(catalog)).toEqual(new Map([
            ['travel', 1],
            ['favorites', 1],
            ['family', 1],
        ]));
        expect(listFotosPeople(catalog)).toEqual(new Map([
            ['Alice', 1],
            ['Bob', 1],
        ]));
        expect(listFotosFaceGroups(catalog)).toEqual(new Map([
            ['cluster-alice', 1],
            ['cluster-bob', 1],
        ]));
    });
});
