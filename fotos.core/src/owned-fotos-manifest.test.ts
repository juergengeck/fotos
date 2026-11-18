import {describe, expect, it} from 'vitest';
import {getOwnedFotosManifestId} from './owned-fotos-manifest.js';

describe('owned Fotos manifest identity', () => {
    it('is stable for one owner and separates different owners from the legacy root', () => {
        expect(getOwnedFotosManifestId('a'.repeat(64))).toBe(`fotos:${'a'.repeat(64)}`);
        expect(getOwnedFotosManifestId('a'.repeat(64))).not.toBe(getOwnedFotosManifestId('b'.repeat(64)));
        expect(getOwnedFotosManifestId('a'.repeat(64))).not.toBe('fotos');
    });
    it.each(['', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'z'.repeat(64), ` ${'a'.repeat(64)}`])(
        'rejects a noncanonical owner', owner => {expect(() => getOwnedFotosManifestId(owner)).toThrow('canonical Person');});
});
