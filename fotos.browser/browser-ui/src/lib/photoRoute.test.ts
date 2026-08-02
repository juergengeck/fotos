import { describe, expect, it } from 'vitest';

import {
    arePersistentPhotoRouteTargetsEqual,
    buildPersistentAppTaskPath,
    buildPersistentPhotoPath,
    parsePersistentAppTask,
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

describe('persistent app task routes', () => {
    it('preserves photo and invite parameters while opening and closing tasks', () => {
        const opened = buildPersistentAppTaskPath('/gallery', '?photo=abc&fotosShare=invite', 'sharing');
        expect(opened).toContain('photo=abc');
        expect(opened).toContain('fotosShare=invite');
        expect(parsePersistentAppTask(opened.split('?')[1] ?? '')).toBe('sharing');
        expect(buildPersistentAppTaskPath('/gallery', opened.split('?')[1] ?? '', null)).not.toContain('task=');
    });

    it('ignores unsupported task values', () => {
        expect(parsePersistentAppTask('?task=advanced')).toBeNull();
    });
});
