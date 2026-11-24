import {describe, expect, it} from 'vitest';
import {createFotosOneCoreConfig} from './one-core-config.js';
import {fotosContentRules} from './sync-rules.js';

describe('compose Fotos with host ONE configuration', () => {
    it('registers identical Fotos schema and rules alongside host capabilities', () => {
        const fallback = {canImport: () => false};
        const core = createFotosOneCoreConfig();
        const host = createFotosOneCoreConfig({
            recipes: [{$type$: 'Recipe', name: 'HostRecipe', rule: []}, ...core.recipes],
            reverseMaps: [new Map([['FotosShareCertificateChain', new Set(['certificate'])]])],
            reverseMapsForIdObjects: [new Map([['FotosShareCertificateChain', new Set(['id'])]])],
            syncRules: new Map([['FotosManifest', fallback], ['HostRecipe', fallback]]),
        });
        expect(host.recipes.map(recipe => recipe.name)).toEqual(['HostRecipe', ...core.recipes.map(recipe => recipe.name)]);
        expect(host.reverseMaps.get('FotosShareCertificateChain')).toEqual(new Set(['certificate', 'subject', 'issuer']));
        expect(host.reverseMapsForIdObjects.get('FotosShareCertificateChain')).toEqual(new Set(['id']));
        expect(host.syncRules.get('FotosManifest')).toBe(fotosContentRules.get('FotosManifest'));
        expect(host.syncRules.get('HostRecipe')).toBe(fallback);
        expect(core.reverseMaps.get('FotosShareCertificateChain')).toEqual(new Set(['subject', 'issuer']));
    });
});
