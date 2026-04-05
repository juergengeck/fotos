import type { PhotoEntry } from '@/types/fotos';
import type { FotosEntry } from '@refinio/fotos.core';
import { EMBEDDING_DIM } from '@refinio/fotos.core';

import {
    listenForFotosManifestUpdates,
    readFotosManifestSnapshot,
    type FotosManifestResolvedEntry,
    type FotosManifestSnapshot,
} from './fotos-manifest.js';
import { listenForFotosUpdates } from './fotos-sync.js';

type FotosShareListener = () => void;

export interface FotosShareItem {
    hash: string;
    name: string;
    sourceKind: 'local' | 'remote';
    syncState: 'pending' | 'shared' | 'remote';
    visible: boolean;
    faceCount: number;
    sourcePath?: string;
    thumb?: string;
    capturedAt?: string;
    updatedAt?: string;
}

export interface FotosShareSnapshot {
    isOpen: boolean;
    folderName: string | null;
    manifest: FotosManifestSnapshot | null;
    manifestEntries: FotosManifestResolvedEntry[];
    importedEntries: FotosImportedEntry[];
    localItems: FotosShareItem[];
    remoteItems: FotosShareItem[];
    pendingItems: FotosShareItem[];
    sharedItems: FotosShareItem[];
    items: FotosShareItem[];
    grantedPeerIds: string[];
    projection: FotosShareProjectionSummary;
}

export interface FotosImportedEntry {
    versionHash: string | null;
    contentHash: string;
    name: string;
    sourcePath: string | null;
    folderPath: string | null;
    capturedAt: string | null;
    updatedAt: string | null;
    faceCount: number;
    hasThumb: boolean;
    manifested: boolean;
    projected: boolean;
    sourceKind: 'local' | 'remote' | null;
    syncState: 'pending' | 'shared' | 'remote' | null;
    visible: boolean;
}

export interface FotosShareProjectionSummary {
    totalCount: number;
    visibleCount: number;
    localCount: number;
    remoteCount: number;
    pendingCount: number;
    sharedCount: number;
}

export interface FotosShareState {
    isOpen: boolean;
    folderName: string | null;
    entries: PhotoEntry[];
    visibleHashes: string[];
}

function isRemoteEntry(entry: PhotoEntry): boolean {
    return entry.sourcePath?.startsWith('remote:') === true
        || entry.thumb?.startsWith('remote:') === true;
}

function getPhotoFaceCount(entry: PhotoEntry): number {
    const faces = entry.faces;
    if (!faces) {
        return 0;
    }

    const derivedCounts = [
        faces.count,
        faces.bboxes.length,
        faces.scores.length,
        faces.crops.filter(Boolean).length,
        faces.clusterIds?.filter(Boolean).length ?? 0,
        faces.names?.filter(Boolean).length ?? 0,
        faces.personIds?.filter(Boolean).length ?? 0,
    ];

    if (faces.embeddings) {
        derivedCounts.push(Math.floor(faces.embeddings.length / EMBEDDING_DIM));
    }

    return Math.max(
        0,
        ...derivedCounts.filter((value): value is number => Number.isFinite(value)),
    );
}

function basenameFromPath(pathValue: string | null | undefined): string | null {
    const normalized = pathValue?.trim();
    if (!normalized) {
        return null;
    }

    const segments = normalized.split('/').filter(Boolean);
    return segments.length > 0 ? segments[segments.length - 1] ?? null : normalized;
}

function dirnameFromPath(pathValue: string | null | undefined): string | null {
    const normalized = pathValue?.trim();
    if (!normalized || !normalized.includes('/')) {
        return null;
    }

    const segments = normalized.split('/').filter(Boolean);
    if (segments.length <= 1) {
        return null;
    }

    return segments.slice(0, -1).join('/');
}

export function toFotosImportedEntry(
    entry: FotosEntry,
    metadata?: { versionHash: string | null },
): Omit<FotosImportedEntry, 'manifested' | 'projected' | 'sourceKind' | 'syncState' | 'visible'> {
    const sourcePath = typeof entry.sourcePath === 'string' ? entry.sourcePath : null;
    const folderPath = typeof entry.folderPath === 'string'
        ? entry.folderPath
        : dirnameFromPath(sourcePath);

    return {
        versionHash: metadata?.versionHash ?? entry.$versionHash$ ?? null,
        contentHash: entry.contentHash,
        name: basenameFromPath(sourcePath) ?? `${entry.contentHash.slice(0, 12)}.photo`,
        sourcePath,
        folderPath,
        capturedAt: typeof entry.capturedAt === 'string' ? entry.capturedAt : null,
        updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : null,
        faceCount: typeof entry.faceCount === 'number' ? entry.faceCount : 0,
        hasThumb: Boolean(entry.thumb),
    };
}

export function toFotosShareItem(
    entry: PhotoEntry,
    visibleHashes: ReadonlySet<string>,
    manifestHashes: ReadonlySet<string>,
): FotosShareItem {
    const remote = isRemoteEntry(entry);
    const inManifest = manifestHashes.has(entry.hash);

    return {
        hash: entry.hash,
        name: entry.name,
        sourceKind: remote ? 'remote' : 'local',
        syncState: remote
            ? 'remote'
            : inManifest
                ? 'shared'
                : 'pending',
        visible: visibleHashes.has(entry.hash),
        faceCount: getPhotoFaceCount(entry),
        ...(entry.sourcePath ? { sourcePath: entry.sourcePath } : {}),
        ...(entry.thumb ? { thumb: entry.thumb } : {}),
        ...(entry.capturedAt ? { capturedAt: entry.capturedAt } : {}),
        ...(entry.updatedAt ? { updatedAt: entry.updatedAt } : {}),
    };
}

export function buildFotosShareSnapshot(
    state: FotosShareState,
    manifest: FotosManifestSnapshot | null,
    grantedPeerIds: readonly string[],
    importedEntries: readonly Omit<FotosImportedEntry, 'manifested' | 'projected' | 'sourceKind' | 'syncState' | 'visible'>[] = [],
): FotosShareSnapshot {
    const manifestHashes = new Set(manifest?.contentHashes ?? []);
    const visibleHashes = new Set(state.visibleHashes);
    const items = state.entries.map(entry => toFotosShareItem(entry, visibleHashes, manifestHashes));
    const itemByHash = new Map(items.map(item => [item.hash, item]));
    const localItems = items.filter(item => item.sourceKind === 'local');
    const remoteItems = items.filter(item => item.sourceKind === 'remote');
    const pendingItems = items.filter(item => item.syncState === 'pending');
    const sharedItems = items.filter(item => item.syncState === 'shared' || item.syncState === 'remote');
    const trackedImports = [...importedEntries]
        .map(entry => {
            const projected = itemByHash.get(entry.contentHash);
            return {
                ...entry,
                manifested: manifestHashes.has(entry.contentHash),
                projected: Boolean(projected),
                sourceKind: projected?.sourceKind ?? null,
                syncState: projected?.syncState ?? null,
                visible: projected?.visible ?? false,
            } satisfies FotosImportedEntry;
        })
        .sort((left, right) => left.name.localeCompare(right.name) || left.contentHash.localeCompare(right.contentHash));

    return {
        isOpen: state.isOpen,
        folderName: state.folderName,
        manifest,
        manifestEntries: manifest?.resolvedEntries ?? [],
        importedEntries: trackedImports,
        localItems,
        remoteItems,
        pendingItems,
        sharedItems,
        items,
        grantedPeerIds: [...grantedPeerIds],
        projection: {
            totalCount: items.length,
            visibleCount: items.filter(item => item.visible).length,
            localCount: localItems.length,
            remoteCount: remoteItems.length,
            pendingCount: pendingItems.length,
            sharedCount: sharedItems.length,
        },
    };
}

export class FotosShareController {
    private readonly listeners = new Set<FotosShareListener>();
    private manifestSnapshot: FotosManifestSnapshot | null = null;
    private readonly importedEntries = new Map<string, Omit<FotosImportedEntry, 'manifested' | 'projected' | 'sourceKind' | 'syncState' | 'visible'>>();
    private state: FotosShareState = {
        isOpen: false,
        folderName: null,
        entries: [],
        visibleHashes: [],
    };
    private grantedPeerIds = new Set<string>();
    private started = false;
    private unsubManifest: (() => void) | null = null;
    private unsubFotosUpdates: (() => void) | null = null;

    subscribe(listener: FotosShareListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    getSnapshot(): FotosShareSnapshot {
        return buildFotosShareSnapshot(
            this.state,
            this.manifestSnapshot,
            Array.from(this.grantedPeerIds).sort(),
            Array.from(this.importedEntries.values()),
        );
    }

    async start(): Promise<void> {
        if (this.started) {
            return;
        }

        this.started = true;
        this.manifestSnapshot = await readFotosManifestSnapshot().catch(() => null);
        this.unsubManifest = listenForFotosManifestUpdates(snapshot => {
            this.manifestSnapshot = snapshot;
            this.emit();
        });
        this.unsubFotosUpdates = listenForFotosUpdates((entry, metadata) => {
            this.importedEntries.set(entry.contentHash, toFotosImportedEntry(entry, metadata));
            this.emit();
        });
        this.emit();
    }

    stop(): void {
        this.unsubManifest?.();
        this.unsubManifest = null;
        this.unsubFotosUpdates?.();
        this.unsubFotosUpdates = null;
        this.started = false;
    }

    reset(): void {
        this.stop();
        this.manifestSnapshot = null;
        this.state = {
            isOpen: false,
            folderName: null,
            entries: [],
            visibleHashes: [],
        };
        this.grantedPeerIds.clear();
        this.importedEntries.clear();
        this.emit();
    }

    async refreshManifest(): Promise<FotosManifestSnapshot | null> {
        this.manifestSnapshot = await readFotosManifestSnapshot().catch(() => null);
        this.emit();
        return this.manifestSnapshot;
    }

    updateState(nextState: FotosShareState): void {
        this.state = nextState;
        this.emit();
    }

    recordGrant(personId: string): void {
        const normalizedPersonId = personId.trim();
        if (!normalizedPersonId) {
            return;
        }

        this.grantedPeerIds.add(normalizedPersonId);
        this.emit();
    }

    private emit(): void {
        for (const listener of this.listeners) {
            listener();
        }
    }
}

export const fotosShareController = new FotosShareController();
