import { describe, expect, it } from 'vitest';

import {
    buildAcceptedIncomingSharingPeerIds,
    collectShareLifecyclePersonIds,
    collectSharedPersonIds,
    shouldAdvertiseSharingIdentity,
} from './fotosSharingPolicy.js';

describe('fotosSharingPolicy', () => {
    const sharing = {
        galleryPersonIds: ['peer-b', ' peer-a ', 'peer-b'],
        collectionPersonIds: {
            collectionA: ['peer-c'],
        },
        clusterPersonIds: {
            clusterA: ['peer-d', 'peer-a'],
        },
        certificatePersonIds: ['peer-e'],
    };

    it('collects unique shared peer ids across gallery, collections, and clusters', () => {
        expect(collectSharedPersonIds(sharing)).toEqual([
            'peer-a',
            'peer-b',
            'peer-c',
            'peer-d',
        ]);
    });

    it('keeps revoked certificate peers in the durable lifecycle relationship', () => {
        expect(collectShareLifecyclePersonIds(sharing)).toEqual([
            'peer-a',
            'peer-b',
            'peer-c',
            'peer-d',
            'peer-e',
        ]);
    });

    it('extends accepted incoming peers with contacts when acceptSharing is enabled', () => {
        expect(buildAcceptedIncomingSharingPeerIds({
            sharing,
            contactPersonIds: ['peer-z', 'peer-c', ''],
            acceptSharing: true,
        })).toEqual([
            'peer-a',
            'peer-b',
            'peer-c',
            'peer-d',
            'peer-e',
            'peer-z',
        ]);
    });

    it('keeps accepted incoming peers limited to explicit shares when acceptSharing is disabled', () => {
        expect(buildAcceptedIncomingSharingPeerIds({
            sharing,
            contactPersonIds: ['peer-z'],
            acceptSharing: false,
        })).toEqual([
            'peer-a',
            'peer-b',
            'peer-c',
            'peer-d',
            'peer-e',
        ]);
    });

    it('advertises identity when there are explicit shares or acceptSharing is enabled', () => {
        expect(shouldAdvertiseSharingIdentity({
            sharing,
            acceptSharing: false,
        })).toBe(true);
        expect(shouldAdvertiseSharingIdentity({
            sharing: {
                galleryPersonIds: [],
                collectionPersonIds: {},
                clusterPersonIds: {},
                certificatePersonIds: [],
            },
            acceptSharing: true,
        })).toBe(true);
        expect(shouldAdvertiseSharingIdentity({
            sharing: {
                galleryPersonIds: [],
                collectionPersonIds: {},
                clusterPersonIds: {},
                certificatePersonIds: [],
            },
            acceptSharing: false,
        })).toBe(false);
    });
});
