import type {FotosCatalogTrie} from './fotos-catalog-trie.js';
import type {GalleryFacetCount} from './gallery-trie.js';

export interface FotosStream {
    $type$: 'Stream';
    id: string;
    creator: unknown;
    created: number;
    mimeType: string;
    status: string;
    exif?: Record<string, unknown>;
}

export interface FotosCatalogEntry {
    stream: FotosStream;
    name: string;
    managed: 'reference' | 'metadata' | 'ingested';
    sourcePath?: string;
    folderPath?: string;
    thumb?: string;
    tags: string[];
    people?: string[];
    faceGroups?: string[];
    faceCount?: number;
    size: number;
    copies?: string[];
}

export interface FotosCatalogExif {
    date?: string;
    camera?: string;
    lens?: string;
    focalLength?: string;
    aperture?: string;
    shutter?: string;
    iso?: number;
    gps?: {lat: number; lon: number};
    width?: number;
    height?: number;
}

export interface FotosCatalog {
    version: 1;
    name: string;
    created: string;
    device?: string;
    photos: Array<FotosCatalogEntry & {exif?: FotosCatalogExif}>;
}

export type FotosCatalogV1 = FotosCatalog;

export interface FotosCatalogV2 {
    version: 2;
    name: string;
    created: string;
    device?: string;
    trie: FotosCatalogTrie;
}

export interface FotosCatalogConfig {
    blobDir: string;
    thumbDir: string;
    thumbSize: number;
    deviceName: string;
    owner: string;
}

export interface FotosCatalogFilter {
    tag?: string;
    folder?: string;
    person?: string;
    faceGroup?: string;
    detectedFaces?: boolean;
}

export const DEFAULT_FOTOS_CONFIG: Omit<FotosCatalogConfig, 'owner'> = {
    blobDir: 'blobs',
    thumbDir: 'thumbs',
    thumbSize: 400,
    deviceName: 'default',
};

export async function filterFotosCatalogEntries(
    catalog: FotosCatalogV2,
    filters: FotosCatalogFilter = {}
): Promise<FotosCatalogEntry[]> {
    let entries = catalog.trie.allEntries();
    const matches: FotosCatalogEntry[][] = [];

    if (filters.folder) {
        matches.push(await catalog.trie.getEntriesForFolder(filters.folder));
    }
    if (filters.tag) {
        matches.push(await catalog.trie.getEntriesForTag(filters.tag));
    }
    if (filters.person) {
        matches.push(await catalog.trie.getEntriesForPerson(filters.person));
    }
    if (filters.faceGroup) {
        matches.push(await catalog.trie.getEntriesForFaceGroup(filters.faceGroup));
    }
    if (filters.detectedFaces) {
        matches.push(await catalog.trie.getEntriesWithDetectedFaces());
    }

    for (const matchingEntries of matches) {
        const ids = new Set(matchingEntries.map(entry => entry.stream.id));
        entries = entries.filter(entry => ids.has(entry.stream.id));
    }

    return entries;
}

function facetCountsToMap(counts: GalleryFacetCount[]): Map<string, number> {
    return new Map(counts.map(({key, count}) => [key, count]));
}

export function listFotosTags(catalog: FotosCatalogV2): Map<string, number> {
    return facetCountsToMap(catalog.trie.listTagCounts());
}

export function listFotosPeople(catalog: FotosCatalogV2): Map<string, number> {
    return facetCountsToMap(catalog.trie.listPersonCounts());
}

export function listFotosFaceGroups(catalog: FotosCatalogV2): Map<string, number> {
    return facetCountsToMap(catalog.trie.listFaceGroupCounts());
}
