import { describe, expect, it } from 'vitest';

import type { PhotoEntry } from '@/types/fotos';

import {
    buildFotosShareSnapshot,
    toFotosImportedEntry,
    toFotosShareItem,
} from './fotosShareController.js';

function createEntry(overrides: Partial<PhotoEntry> = {}): PhotoEntry {
    return {
        hash: overrides.hash ?? 'hash-1',
        name: overrides.name ?? 'photo.jpg',
        managed: overrides.managed ?? 'metadata',
        tags: overrides.tags ?? [],
        capturedAt: overrides.capturedAt ?? '2024-01-01T00:00:00.000Z',
        updatedAt: overrides.updatedAt ?? '2024-01-01T00:00:00.000Z',
        addedAt: overrides.addedAt ?? '2024-01-01T00:00:00.000Z',
        size: overrides.size ?? 123,
        ...overrides,
    };
}

describe('toFotosShareItem', () => {
    it('classifies remote entries from the synthetic remote source path', () => {
        const item = toFotosShareItem(
            createEntry({
                hash: 'remote-hash',
                sourcePath: 'remote:remote-hash',
                thumb: 'remote:remote-hash',
            }),
            new Set(['remote-hash']),
            new Set(),
        );

        expect(item.sourceKind).toBe('remote');
        expect(item.syncState).toBe('remote');
        expect(item.visible).toBe(true);
    });

    it('marks local entries outside the manifest as pending', () => {
        const item = toFotosShareItem(
            createEntry({
                hash: 'local-hash',
                sourcePath: 'albums/rose.jpg',
            }),
            new Set(),
            new Set(['different-hash']),
        );

        expect(item.sourceKind).toBe('local');
        expect(item.syncState).toBe('pending');
    });

    it('marks local entries in the manifest as shared', () => {
        const item = toFotosShareItem(
            createEntry({
                hash: 'shared-hash',
                sourcePath: 'albums/shared.jpg',
            }),
            new Set(),
            new Set(['shared-hash']),
        );

        expect(item.sourceKind).toBe('local');
        expect(item.syncState).toBe('shared');
    });
});

describe('buildFotosShareSnapshot', () => {
    it('splits items into local, remote, pending, and shared groups', () => {
        const snapshot = buildFotosShareSnapshot(
            {
                isOpen: true,
                folderName: 'shared',
                visibleHashes: ['local-pending', 'remote-hash'],
                entries: [
                    createEntry({
                        hash: 'local-pending',
                        name: 'pending.jpg',
                        sourcePath: 'albums/pending.jpg',
                    }),
                    createEntry({
                        hash: 'local-shared',
                        name: 'shared.jpg',
                        sourcePath: 'albums/shared.jpg',
                    }),
                    createEntry({
                        hash: 'remote-hash',
                        name: 'remote.jpg',
                        sourcePath: 'remote:remote-hash',
                        thumb: 'remote:remote-hash',
                    }),
                ],
            },
            {
                exists: true,
                idHash: 'manifest-id',
                hash: 'manifest-hash',
                entryCount: 1,
                entryHashes: ['fotos-entry-hash'],
                contentHashes: ['local-shared'],
                resolvedEntries: [{
                    entryHash: 'fotos-entry-hash',
                    contentHash: 'local-shared',
                    name: 'shared.jpg',
                    sourcePath: 'albums/shared.jpg',
                    folderPath: 'albums',
                    capturedAt: '2024-01-01T00:00:00.000Z',
                    updatedAt: '2024-01-01T00:00:00.000Z',
                    faceCount: 0,
                    hasThumb: true,
                }],
            },
            ['peer-b', 'peer-a'],
            [{
                versionHash: 'remote-version-hash',
                contentHash: 'remote-hash',
                name: 'remote.jpg',
                sourcePath: 'albums/remote.jpg',
                folderPath: 'albums',
                capturedAt: '2024-01-01T00:00:00.000Z',
                updatedAt: '2024-01-01T00:00:00.000Z',
                faceCount: 0,
                hasThumb: true,
            }],
        );

        expect(snapshot.localItems.map(item => item.hash)).toEqual(['local-pending', 'local-shared']);
        expect(snapshot.remoteItems.map(item => item.hash)).toEqual(['remote-hash']);
        expect(snapshot.pendingItems.map(item => item.hash)).toEqual(['local-pending']);
        expect(snapshot.sharedItems.map(item => item.hash)).toEqual(['local-shared', 'remote-hash']);
        expect(snapshot.grantedPeerIds).toEqual(['peer-b', 'peer-a']);
        expect(snapshot.folderName).toBe('shared');
        expect(snapshot.isOpen).toBe(true);
        expect(snapshot.manifestEntries.map(item => item.contentHash)).toEqual(['local-shared']);
        expect(snapshot.importedEntries).toEqual([{
            versionHash: 'remote-version-hash',
            contentHash: 'remote-hash',
            name: 'remote.jpg',
            sourcePath: 'albums/remote.jpg',
            folderPath: 'albums',
            capturedAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
            faceCount: 0,
            hasThumb: true,
            manifested: false,
            projected: true,
            sourceKind: 'remote',
            syncState: 'remote',
            visible: true,
        }]);
        expect(snapshot.projection).toEqual({
            totalCount: 3,
            visibleCount: 2,
            localCount: 2,
            remoteCount: 1,
            pendingCount: 1,
            sharedCount: 2,
        });
    });
});

describe('toFotosImportedEntry', () => {
    it('normalizes FotosEntry objects into stable debug snapshots', () => {
        expect(toFotosImportedEntry({
            $type$: 'FotosEntry',
            contentHash: 'content-hash',
            streamId: 'content-hash',
            mime: 'image/jpeg',
            size: 123,
            sourcePath: 'Trips/Berlin/rose.jpg',
            capturedAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-02T00:00:00.000Z',
            faceCount: 2,
            thumb: 'thumb-hash' as never,
        }, {
            versionHash: 'version-hash',
        })).toEqual({
            versionHash: 'version-hash',
            contentHash: 'content-hash',
            name: 'rose.jpg',
            sourcePath: 'Trips/Berlin/rose.jpg',
            folderPath: 'Trips/Berlin',
            capturedAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-02T00:00:00.000Z',
            faceCount: 2,
            hasThumb: true,
        });
    });
});
