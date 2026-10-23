import {describe, expect, it} from 'vitest';

import {isFotosQaSurfaceReady} from './fotosQaReadiness.js';

describe('isFotosQaSurfaceReady', () => {
    it('waits for source restoration and every persisted explicit collection member', () => {
        const collection = {photoHashes: ['photo-1'], matchedPhotoHashes: []};
        expect(isFotosQaSurfaceReady({
            modelInitialized: true,
            sourceInitializationComplete: false,
            collections: [collection],
        })).toBe(false);
        expect(isFotosQaSurfaceReady({
            modelInitialized: true,
            sourceInitializationComplete: true,
            collections: [collection],
        })).toBe(false);
        expect(isFotosQaSurfaceReady({
            modelInitialized: true,
            sourceInitializationComplete: true,
            collections: [{...collection, matchedPhotoHashes: ['photo-1']}],
        })).toBe(true);
    });

    it('allows a restored new library with no persisted collection members', () => {
        expect(isFotosQaSurfaceReady({
            modelInitialized: true,
            sourceInitializationComplete: true,
            collections: [],
        })).toBe(true);
    });
});
