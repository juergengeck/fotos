import { describe, expect, it } from 'vitest';

import {
    arePersistentPhotoRouteTargetsEqual,
    buildPersistentPhotoPath,
    parsePersistentPhotoRouteTarget,
} from './photoRoute';

describe('photoRoute', () => {
    it('parses the selected photo from the query string', () => {
        expect(parsePersistentPhotoRouteTarget('?photo=hash-1')).toEqual({
            photoHash: 'hash-1',
        });
    });

    it('returns null when no photo route is present', () => {
        expect(parsePersistentPhotoRouteTarget('?view=all')).toBeNull();
    });

    it('preserves existing params when setting the photo route', () => {
        expect(
            buildPersistentPhotoPath('/gallery', '?view=all', {
                photoHash: 'hash-2',
            }),
        ).toBe('/gallery?view=all&photo=hash-2');
    });

    it('removes the photo route without touching other params', () => {
        expect(
            buildPersistentPhotoPath('/gallery', '?view=all&photo=hash-2', null),
        ).toBe('/gallery?view=all');
    });

    it('compares normalized targets', () => {
        expect(
            arePersistentPhotoRouteTargetsEqual(
                { photoHash: ' hash-3 ' },
                { photoHash: 'hash-3' },
            ),
        ).toBe(true);
    });
});
