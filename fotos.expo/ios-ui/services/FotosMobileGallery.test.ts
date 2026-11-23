import {describe, expect, it} from 'vitest';
import type {FotosEntry} from '@refinio/fotos.core';
import type {FotosPhotoKitAsset} from './FotosPhotoKit';
import {mergeFotosMobileGallery} from './FotosMobileGallery';

describe('mobile gallery identity', () => {
    const contentHash = 'a'.repeat(64);
    const entry: FotosEntry = {
        $type$: 'FotosEntry', contentHash, streamId: 'library', mime: 'image/heic', size: 42,
        originalFilename: 'Desktop.heic', capturedAt: '2026-07-03T12:00:00Z',
    };
    const asset: FotosPhotoKitAsset = {
        id: 'example/L0/001', filename: 'iPhone.heic', width: 10, height: 10, duration: 0,
        favorite: false, mediaType: 'photo', mediaSubtypes: [],
    };

    it('merges renamed local and shared copies through the verified content hash', () => {
        const items = mergeFotosMobileGallery([asset], {
            owned: [entry],
            shared: [{...entry, originalFilename: 'Shared.heic', capturedAt: '2026-07-02T12:00:00Z'}],
            localHashes: new Map([[asset.id, contentHash]]),
            collections: [{$type$: 'FotosCollection', id: 'album', name: 'Weekend', photoHashes: new Set([contentHash])}],
        });
        expect(items).toEqual([{
            id: contentHash, name: entry.originalFilename, date: entry.capturedAt, entry, asset,
            owned: true, shared: true, albums: ['Weekend'],
        }]);
    });

    it('keeps same-named media separate until a verified locator links them', () => {
        const items = mergeFotosMobileGallery([{...asset, filename: entry.originalFilename!}], {
            owned: [entry], shared: [], collections: [], localHashes: new Map(),
        });
        expect(items.map(item => item.id)).toEqual([contentHash, asset.id]);
    });
});
