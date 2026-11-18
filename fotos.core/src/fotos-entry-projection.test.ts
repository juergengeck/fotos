import {describe, expect, it} from 'vitest';
import type {FotosEntry} from './recipes/FotosRecipes.js';
import {getFotosEntryProjectionVersion, projectFotosEntryReferences} from './fotos-entry-projection.js';

const entry: FotosEntry = {$type$: 'FotosEntry', contentHash: 'same-image', streamId: 'same-image',
    sourcePath: 'photo.png', mime: 'image/png', size: 3};

describe('exact Fotos image presentation', () => {
    it('is idempotent for 100 replays of an exact entry without manufacturing a metadata version', async () => {
        const reference = {hash: 'exact-entry', entry};
        const projected = projectFotosEntryReferences(Array(100).fill(reference));
        expect(projected).toHaveLength(1);
        expect(projected[0].entry).toBe(entry);
        expect(projected[0].hashes).toEqual(['exact-entry']);
        expect(await getFotosEntryProjectionVersion(projected[0], async () => {throw new Error('No new version');}))
            .toBe('exact-entry');
    });

    it('selects only an exact authorized representative by source path then hash and binds every ref', async () => {
        const references = [{hash: 'b', entry: {...entry, sourcePath: 'z.png', faceCount: 99}},
            {hash: 'c', entry: {...entry, sourcePath: 'a.png', faceCount: 2}},
            {hash: 'a', entry: {...entry, sourcePath: 'a.png', faceCount: 1}}];
        const projected = projectFotosEntryReferences(references)[0];
        expect(projected.entry).toBe(references[2].entry);
        expect(projected.hashes).toEqual(['a', 'b', 'c']);
        expect(projectFotosEntryReferences([...references].reverse())).toEqual([projected]);
        expect(await getFotosEntryProjectionVersion(projected, async value => value)).toContain('["a","b","c"]');
    });

    it('never coalesces visually similar originals with distinct content identities', () => {
        const other = {...entry, contentHash: 'different-image', sourcePath: 'other.png'};
        expect(projectFotosEntryReferences([{hash: 'one', entry}, {hash: 'two', entry: other}])).toHaveLength(2);
    });
});
