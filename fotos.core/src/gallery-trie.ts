import {
    MultiTrie,
    hashPrefixKeyFn,
    sha256HashFn,
    timePathKeyFn,
    timePathLeafKeys,
    type Hash,
    type KeyFn,
    type TrieConfig,
} from '@refinio/trie.core';

export type GalleryTrieSlot = 'sync' | 'capture-time' | 'updated-time' | 'folder-path';
export type GalleryBrowseSlot = 'tag' | 'person' | 'face-group' | 'detected-face';
export type GalleryProjectionSlot = GalleryTrieSlot | GalleryBrowseSlot;

export interface GalleryIndexEntry {
    hash: string;
    addedAt: string;
    capturedAt?: string;
    updatedAt?: string;
    sourcePath?: string;
    folderPath?: string;
    tagKeys?: string[];
    personKeys?: string[];
    faceGroupKeys?: string[];
    faceCount?: number;
}

export interface GalleryTimelineDay<TEntry extends GalleryIndexEntry = GalleryIndexEntry> {
    date: string;
    entries: TEntry[];
}

export interface GalleryFacetCount {
    key: string;
    count: number;
}

function normalizeFolderPath(folderPath?: string): string {
    if (!folderPath) {
        return '';
    }

    return folderPath
        .split('/')
        .map(segment => segment.trim())
        .filter(Boolean)
        .join('/');
}

function normalizeFacetKeys(values?: readonly string[]): string[] {
    if (!values) {
        return [];
    }

    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const value of values) {
        const trimmed = value.trim();
        if (!trimmed || seen.has(trimmed)) {
            continue;
        }
        seen.add(trimmed);
        normalized.push(trimmed);
    }
    return normalized;
}

function parseIsoDate(value?: string): Date | null {
    if (!value) {
        return null;
    }

    const normalized = value.length === 10 ? `${value}T00:00:00.000Z` : value;
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
}

function resolveCaptureDate(entry: GalleryIndexEntry): Date | null {
    return parseIsoDate(entry.capturedAt) ?? parseIsoDate(entry.addedAt);
}

function resolveUpdatedDate(entry: GalleryIndexEntry): Date | null {
    return parseIsoDate(entry.updatedAt) ?? resolveCaptureDate(entry);
}

function compareEntries(
    sequenceByHash: ReadonlyMap<string, number>,
    left: GalleryIndexEntry,
    right: GalleryIndexEntry
): number {
    const leftCapture = resolveCaptureDate(left)?.getTime() ?? 0;
    const rightCapture = resolveCaptureDate(right)?.getTime() ?? 0;
    if (leftCapture !== rightCapture) {
        return rightCapture - leftCapture;
    }

    const leftUpdated = resolveUpdatedDate(left)?.getTime() ?? 0;
    const rightUpdated = resolveUpdatedDate(right)?.getTime() ?? 0;
    if (leftUpdated !== rightUpdated) {
        return rightUpdated - leftUpdated;
    }

    const leftSequence = sequenceByHash.get(left.hash) ?? Number.MAX_SAFE_INTEGER;
    const rightSequence = sequenceByHash.get(right.hash) ?? Number.MAX_SAFE_INTEGER;
    if (leftSequence !== rightSequence) {
        return leftSequence - rightSequence;
    }

    return left.hash.localeCompare(right.hash);
}

function captureKeyFn(trieId: string): KeyFn {
    const inner = timePathKeyFn('day', trieId);
    return (entryHash, context) => inner(entryHash, {timestamp: context.captureTimestamp});
}

function updatedKeyFn(trieId: string): KeyFn {
    const inner = timePathKeyFn('day', trieId);
    return (entryHash, context) => inner(entryHash, {timestamp: context.updatedTimestamp});
}

function folderPathKeyFn(trieId: string): KeyFn {
    const root = `${trieId}:root`;
    return (_entryHash, context) => {
        const normalized = normalizeFolderPath(typeof context.folderPath === 'string' ? context.folderPath : '');
        return normalized ? [root, ...normalized.split('/')] : [root];
    };
}

function facetPathKeyFn(
    trieId: string,
    contextKey: 'tagKey' | 'personKey' | 'faceGroupKey'
): KeyFn {
    return (_entryHash, context) => {
        const value = typeof context[contextKey] === 'string' ? context[contextKey] : '';
        return buildFacetChunks(trieId, value);
    };
}

function detectedFaceKeyFn(trieId: string): KeyFn {
    const root = `${trieId}:root`;
    return (_entryHash, context) => {
        const hasDetectedFaces = context.hasDetectedFaces === true;
        return hasDetectedFaces ? [root, 'detected'] : [];
    };
}

function extractDayKey(chunks: string[]): string {
    const leaf = chunks[chunks.length - 1] ?? '';
    const match = leaf.match(/(\d{4}-\d{2}-\d{2})/);
    return match?.[1] ?? leaf;
}

function buildFolderChunks(trieId: string, folderPath?: string): string[] {
    const normalized = normalizeFolderPath(folderPath);
    return normalized ? [`${trieId}:root`, ...normalized.split('/')] : [`${trieId}:root`];
}

function buildFacetChunks(trieId: string, key: string): string[] {
    return [`${trieId}:root`, encodeURIComponent(key.trim())];
}

function normalizeRange(from: Date, to: Date): {from: Date; to: Date} {
    return from.getTime() <= to.getTime()
        ? {from, to}
        : {from: to, to: from};
}

export class GalleryTrieManager<TEntry extends GalleryIndexEntry = GalleryIndexEntry> {
    private readonly trieId: string;
    private entriesByHash = new Map<string, TEntry>();
    private sequenceByHash = new Map<string, number>();
    private multiTrie: MultiTrie;

    constructor(trieId = 'gallery') {
        this.trieId = trieId;
        this.multiTrie = this.createMultiTrie();
    }

    async replaceEntries(entries: Iterable<TEntry>): Promise<void> {
        this.entriesByHash = new Map();
        this.sequenceByHash = new Map();

        let sequence = 0;
        for (const entry of entries) {
            this.entriesByHash.set(entry.hash, entry);
            this.sequenceByHash.set(entry.hash, sequence++);
        }

        await this.rebuild();
    }

    async upsertEntry(entry: TEntry): Promise<void> {
        if (!this.sequenceByHash.has(entry.hash)) {
            this.sequenceByHash.set(entry.hash, this.sequenceByHash.size);
        }
        this.entriesByHash.set(entry.hash, entry);
        await this.rebuild();
    }

    async removeEntry(hash: string): Promise<void> {
        const removed = this.entriesByHash.delete(hash);
        this.sequenceByHash.delete(hash);
        if (removed) {
            await this.rebuild();
        }
    }

    getEntry(hash: string): TEntry | undefined {
        return this.entriesByHash.get(hash);
    }

    listEntries(): TEntry[] {
        return [...this.entriesByHash.values()].sort((left, right) =>
            compareEntries(this.sequenceByHash, left, right));
    }

    async getRoot(slot: GalleryProjectionSlot): Promise<string | null> {
        return await this.multiTrie.getRoot(slot);
    }

    async getCaptureDayGroups(): Promise<Array<GalleryTimelineDay<TEntry>>> {
        const datedEntries = this.listEntries().filter(entry => resolveCaptureDate(entry) !== null);
        if (datedEntries.length === 0) {
            return [];
        }

        const oldest = resolveCaptureDate(datedEntries[datedEntries.length - 1])!;
        const newest = resolveCaptureDate(datedEntries[0])!;
        const dayPaths = timePathLeafKeys(oldest, newest, `${this.trieId}:capture`, 'day').reverse();
        const groups: Array<GalleryTimelineDay<TEntry>> = [];

        for (const path of dayPaths) {
            const rawHashes = await this.multiTrie.collectEntriesAtPath('capture-time', path);
            if (rawHashes.length === 0) {
                continue;
            }

            const seen = new Set<string>();
            const entries = rawHashes
                .map(hash => this.entriesByHash.get(hash as string))
                .filter((entry): entry is TEntry => entry !== undefined)
                .filter(entry => {
                    if (seen.has(entry.hash)) {
                        return false;
                    }
                    seen.add(entry.hash);
                    return true;
                })
                .sort((left, right) => compareEntries(this.sequenceByHash, left, right));

            if (entries.length > 0) {
                groups.push({
                    date: extractDayKey(path),
                    entries,
                });
            }
        }

        return groups;
    }

    async getEntriesInDateRange(from: Date, to: Date): Promise<TEntry[]> {
        const datedEntries = this.listEntries().filter(entry => resolveCaptureDate(entry) !== null);
        if (datedEntries.length === 0) {
            return [];
        }

        const range = normalizeRange(from, to);
        const dayPaths = timePathLeafKeys(range.from, range.to, `${this.trieId}:capture`, 'day');
        const seen = new Set<string>();
        const entries: TEntry[] = [];

        for (const path of dayPaths) {
            const rawHashes = await this.multiTrie.collectEntriesAtPath('capture-time', path);
            for (const hash of rawHashes) {
                const entry = this.entriesByHash.get(hash as string);
                if (!entry || seen.has(entry.hash)) {
                    continue;
                }

                const capturedAt = resolveCaptureDate(entry);
                if (!capturedAt) {
                    continue;
                }

                const captureTime = capturedAt.getTime();
                if (captureTime < range.from.getTime() || captureTime > range.to.getTime()) {
                    continue;
                }

                seen.add(entry.hash);
                entries.push(entry);
            }
        }

        return entries.sort((left, right) => compareEntries(this.sequenceByHash, left, right));
    }

    async getEntriesForFolder(folderPath?: string): Promise<TEntry[]> {
        const hashes = await this.multiTrie.collectEntriesAtPath(
            'folder-path',
            buildFolderChunks(`${this.trieId}:folders`, folderPath)
        );

        const seen = new Set<string>();
        return hashes
            .map(hash => this.entriesByHash.get(hash as string))
            .filter((entry): entry is TEntry => entry !== undefined)
            .filter(entry => {
                if (seen.has(entry.hash)) {
                    return false;
                }
                seen.add(entry.hash);
                return true;
            })
            .sort((left, right) => compareEntries(this.sequenceByHash, left, right));
    }

    async getEntriesForTag(tagKey: string): Promise<TEntry[]> {
        return this.getEntriesForFacet('tag', buildFacetChunks(`${this.trieId}:tags`, tagKey));
    }

    async getEntriesForPerson(personKey: string): Promise<TEntry[]> {
        return this.getEntriesForFacet('person', buildFacetChunks(`${this.trieId}:people`, personKey));
    }

    async getEntriesForFaceGroup(faceGroupKey: string): Promise<TEntry[]> {
        return this.getEntriesForFacet('face-group', buildFacetChunks(`${this.trieId}:face-groups`, faceGroupKey));
    }

    async getEntriesWithDetectedFaces(): Promise<TEntry[]> {
        return this.getEntriesForFacet('detected-face', [`${this.trieId}:detected-faces:root`, 'detected']);
    }

    listTagCounts(): GalleryFacetCount[] {
        return this.collectFacetCounts(entry => entry.tagKeys);
    }

    listPersonCounts(): GalleryFacetCount[] {
        return this.collectFacetCounts(entry => entry.personKeys);
    }

    listFaceGroupCounts(): GalleryFacetCount[] {
        return this.collectFacetCounts(entry => entry.faceGroupKeys);
    }

    private createMultiTrie(): MultiTrie {
        const hashConfig: TrieConfig = {
            chunkSize: 2,
            maxDepth: 4,
            hashFn: sha256HashFn,
            keyFn: hashPrefixKeyFn(2, 4),
        };

        const captureConfig: TrieConfig = {
            chunkSize: 2,
            maxDepth: 3,
            hashFn: sha256HashFn,
            keyFn: captureKeyFn(`${this.trieId}:capture`),
        };

        const updatedConfig: TrieConfig = {
            chunkSize: 2,
            maxDepth: 3,
            hashFn: sha256HashFn,
            keyFn: updatedKeyFn(`${this.trieId}:updated`),
        };

        const folderConfig: TrieConfig = {
            chunkSize: 2,
            maxDepth: 32,
            hashFn: sha256HashFn,
            keyFn: folderPathKeyFn(`${this.trieId}:folders`),
        };

        const tagConfig: TrieConfig = {
            chunkSize: 2,
            maxDepth: 32,
            hashFn: sha256HashFn,
            keyFn: facetPathKeyFn(`${this.trieId}:tags`, 'tagKey'),
        };

        const personConfig: TrieConfig = {
            chunkSize: 2,
            maxDepth: 32,
            hashFn: sha256HashFn,
            keyFn: facetPathKeyFn(`${this.trieId}:people`, 'personKey'),
        };

        const faceGroupConfig: TrieConfig = {
            chunkSize: 2,
            maxDepth: 32,
            hashFn: sha256HashFn,
            keyFn: facetPathKeyFn(`${this.trieId}:face-groups`, 'faceGroupKey'),
        };

        const detectedFaceConfig: TrieConfig = {
            chunkSize: 2,
            maxDepth: 2,
            hashFn: sha256HashFn,
            keyFn: detectedFaceKeyFn(`${this.trieId}:detected-faces`),
        };

        return new MultiTrie([
            {name: 'sync', config: hashConfig},
            {name: 'capture-time', config: captureConfig},
            {name: 'updated-time', config: updatedConfig},
            {name: 'folder-path', config: folderConfig},
            {name: 'tag', config: tagConfig},
            {name: 'person', config: personConfig},
            {name: 'face-group', config: faceGroupConfig},
            {name: 'detected-face', config: detectedFaceConfig},
        ]);
    }

    private async rebuild(): Promise<void> {
        this.multiTrie = this.createMultiTrie();
        const syncTrie = await this.multiTrie.getTrie('sync');
        const captureTrie = await this.multiTrie.getTrie('capture-time');
        const updatedTrie = await this.multiTrie.getTrie('updated-time');
        const folderTrie = await this.multiTrie.getTrie('folder-path');
        const tagTrie = await this.multiTrie.getTrie('tag');
        const personTrie = await this.multiTrie.getTrie('person');
        const faceGroupTrie = await this.multiTrie.getTrie('face-group');
        const detectedFaceTrie = await this.multiTrie.getTrie('detected-face');

        const entries = [...this.entriesByHash.values()].sort((left, right) => left.hash.localeCompare(right.hash));
        for (const entry of entries) {
            const captureTimestamp = resolveCaptureDate(entry);
            const updatedTimestamp = resolveUpdatedDate(entry);
            if (!captureTimestamp || !updatedTimestamp) {
                continue;
            }

            const folderPath = normalizeFolderPath(
                entry.folderPath ?? entry.sourcePath?.split('/').slice(0, -1).join('/') ?? ''
            );

            const entryHash = entry.hash as Hash;
            const tagKeys = normalizeFacetKeys(entry.tagKeys);
            const personKeys = normalizeFacetKeys(entry.personKeys);
            const faceGroupKeys = normalizeFacetKeys(entry.faceGroupKeys);
            const hasDetectedFaces = (entry.faceCount ?? 0) > 0;

            await syncTrie.insert(entryHash);
            await captureTrie.insert(entryHash, {
                captureTimestamp,
            });
            await updatedTrie.insert(entryHash, {
                updatedTimestamp,
            });
            await folderTrie.insert(entryHash, {
                folderPath,
            });

            for (const tagKey of tagKeys) {
                await tagTrie.insert(entryHash, {tagKey});
            }

            for (const personKey of personKeys) {
                await personTrie.insert(entryHash, {personKey});
            }

            for (const faceGroupKey of faceGroupKeys) {
                await faceGroupTrie.insert(entryHash, {faceGroupKey});
            }

            if (hasDetectedFaces) {
                await detectedFaceTrie.insert(entryHash, {hasDetectedFaces: true});
            }
        }
    }

    private async getEntriesForFacet(slot: GalleryBrowseSlot, chunks: string[]): Promise<TEntry[]> {
        const hashes = await this.multiTrie.collectEntriesAtPath(slot, chunks);
        const seen = new Set<string>();

        return hashes
            .map(hash => this.entriesByHash.get(hash as string))
            .filter((entry): entry is TEntry => entry !== undefined)
            .filter(entry => {
                if (seen.has(entry.hash)) {
                    return false;
                }
                seen.add(entry.hash);
                return true;
            })
            .sort((left, right) => compareEntries(this.sequenceByHash, left, right));
    }

    private collectFacetCounts(
        select: (entry: TEntry) => readonly string[] | undefined
    ): GalleryFacetCount[] {
        const counts = new Map<string, number>();

        for (const entry of this.entriesByHash.values()) {
            for (const key of normalizeFacetKeys(select(entry))) {
                counts.set(key, (counts.get(key) ?? 0) + 1);
            }
        }

        return [...counts.entries()]
            .map(([key, count]) => ({key, count}))
            .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
    }
}
