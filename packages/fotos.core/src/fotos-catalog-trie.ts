import type {Hash} from '@refinio/trie.core';
import {
    GalleryTrieManager,
    type GalleryFacetCount,
    type GalleryIndexEntry,
} from './gallery-trie.js';
import type {FotosCatalogEntry, FotosCatalogExif} from './fotos-catalog.js';

export interface FotosCatalogTrieSnapshot {
    entries: Record<string, FotosCatalogEntry>;
    timeEntries: Array<{id: string; timestamp: string}>;
}

type IndexedFotosCatalogEntry = FotosCatalogEntry & GalleryIndexEntry;

function resolveExif(entry: FotosCatalogEntry): FotosCatalogExif | undefined {
    return entry.stream.exif as FotosCatalogExif | undefined;
}

function toIsoTimestamp(value: number): string {
    return new Date(value).toISOString();
}

function normalizeFolderPath(folderPath?: string): string | undefined {
    if (!folderPath) {
        return undefined;
    }

    const normalized = folderPath
        .replace(/\\/g, '/')
        .split('/')
        .map(segment => segment.trim())
        .filter(Boolean)
        .join('/');

    return normalized || undefined;
}

function folderPathFromSourcePath(sourcePath?: string): string | undefined {
    const normalized = normalizeFolderPath(sourcePath);
    if (!normalized) {
        return undefined;
    }

    const segments = normalized.split('/');
    segments.pop();
    return segments.length > 0 ? segments.join('/') : undefined;
}

function entryTimestamp(entry: FotosCatalogEntry): string {
    return resolveExif(entry)?.date ?? toIsoTimestamp(entry.stream.created);
}

function toIndexedEntry(entry: FotosCatalogEntry): IndexedFotosCatalogEntry {
    const capturedAt = resolveExif(entry)?.date;
    const addedAt = toIsoTimestamp(entry.stream.created);

    return {
        ...entry,
        hash: entry.stream.id,
        addedAt,
        capturedAt,
        updatedAt: addedAt,
        sourcePath: entry.sourcePath,
        folderPath: normalizeFolderPath(entry.folderPath ?? folderPathFromSourcePath(entry.sourcePath)),
        tagKeys: entry.tags,
        personKeys: entry.people,
        faceGroupKeys: entry.faceGroups,
        faceCount: entry.faceCount,
    };
}

function stripIndexedEntry(entry: IndexedFotosCatalogEntry): FotosCatalogEntry {
    const {
        hash: _hash,
        addedAt: _addedAt,
        capturedAt: _capturedAt,
        updatedAt: _updatedAt,
        tagKeys: _tagKeys,
        personKeys: _personKeys,
        faceGroupKeys: _faceGroupKeys,
        ...plain
    } = entry;

    return plain;
}

function isWithinRange(timestamp: string, from: Date, to: Date): boolean {
    const value = new Date(timestamp).getTime();
    const start = Math.min(from.getTime(), to.getTime());
    const end = Math.max(from.getTime(), to.getTime());
    return value >= start && value <= end;
}

export class FotosCatalogTrie {
    private readonly gallery: GalleryTrieManager<IndexedFotosCatalogEntry>;

    private constructor(gallery: GalleryTrieManager<IndexedFotosCatalogEntry>) {
        this.gallery = gallery;
    }

    static async create(trieId: string): Promise<FotosCatalogTrie> {
        return new FotosCatalogTrie(new GalleryTrieManager<IndexedFotosCatalogEntry>(trieId));
    }

    async insert(entry: FotosCatalogEntry): Promise<void> {
        await this.gallery.upsertEntry(toIndexedEntry(entry));
    }

    getEntry(id: string): FotosCatalogEntry | undefined {
        const entry = this.gallery.getEntry(id);
        return entry ? stripIndexedEntry(entry) : undefined;
    }

    async updateEntry(id: string, entry: FotosCatalogEntry): Promise<void> {
        if (id !== entry.stream.id) {
            throw new Error(`Entry id mismatch: expected ${id}, got ${entry.stream.id}`);
        }

        await this.gallery.upsertEntry(toIndexedEntry(entry));
    }

    allEntries(): FotosCatalogEntry[] {
        return this.gallery.listEntries().map(stripIndexedEntry);
    }

    entryCount(): number {
        return this.gallery.listEntries().length;
    }

    async queryDateRange(from: Date, to: Date): Promise<FotosCatalogEntry[]> {
        const indexed = await this.gallery.getEntriesInDateRange(from, to);
        return indexed
            .filter(entry => isWithinRange(entryTimestamp(entry), from, to))
            .map(stripIndexedEntry);
    }

    async getEntriesForFolder(folderPath?: string): Promise<FotosCatalogEntry[]> {
        return (await this.gallery.getEntriesForFolder(folderPath)).map(stripIndexedEntry);
    }

    async getEntriesForTag(tag: string): Promise<FotosCatalogEntry[]> {
        return (await this.gallery.getEntriesForTag(tag)).map(stripIndexedEntry);
    }

    async getEntriesForPerson(person: string): Promise<FotosCatalogEntry[]> {
        return (await this.gallery.getEntriesForPerson(person)).map(stripIndexedEntry);
    }

    async getEntriesForFaceGroup(group: string): Promise<FotosCatalogEntry[]> {
        return (await this.gallery.getEntriesForFaceGroup(group)).map(stripIndexedEntry);
    }

    async getEntriesWithDetectedFaces(): Promise<FotosCatalogEntry[]> {
        return (await this.gallery.getEntriesWithDetectedFaces()).map(stripIndexedEntry);
    }

    listTagCounts(): GalleryFacetCount[] {
        return this.gallery.listTagCounts();
    }

    listPersonCounts(): GalleryFacetCount[] {
        return this.gallery.listPersonCounts();
    }

    listFaceGroupCounts(): GalleryFacetCount[] {
        return this.gallery.listFaceGroupCounts();
    }

    async syncRoot(): Promise<Hash | null> {
        return await this.gallery.getRoot(
            'sync' as Parameters<GalleryTrieManager<IndexedFotosCatalogEntry>['getRoot']>[0]
        ) as Hash | null;
    }

    diffFrom(remote: FotosCatalogTrie): string[] {
        const remoteIds = new Set(remote.allEntries().map(entry => entry.stream.id));
        return this.allEntries()
            .map(entry => entry.stream.id)
            .filter(id => !remoteIds.has(id));
    }

    serialize(): FotosCatalogTrieSnapshot {
        const entries: Record<string, FotosCatalogEntry> = {};
        const timeEntries: Array<{id: string; timestamp: string}> = [];

        for (const entry of this.gallery.listEntries()) {
            const plain = stripIndexedEntry(entry);
            entries[plain.stream.id] = plain;
            timeEntries.push({
                id: plain.stream.id,
                timestamp: entryTimestamp(plain),
            });
        }

        return {entries, timeEntries};
    }

    static async fromSnapshot(
        snapshot: FotosCatalogTrieSnapshot,
        trieId: string
    ): Promise<FotosCatalogTrie> {
        const trie = await FotosCatalogTrie.create(trieId);
        await trie.gallery.replaceEntries(
            Object.values(snapshot.entries).map(toIndexedEntry)
        );
        return trie;
    }
}
