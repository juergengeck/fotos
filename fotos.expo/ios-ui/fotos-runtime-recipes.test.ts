import {describe, expect, it} from 'vitest';
import {getFotosRuntimeRecipeConfig} from './fotos-runtime-recipes';

describe('Fotos runtime storage schema', () => {
    it('registers gallery, connection and signed publication schemas together without duplicates', () => {
        const {recipes, reverseMaps} = getFotosRuntimeRecipeConfig();
        const names = recipes.map(recipe => recipe.name);
        expect(new Set(names).size).toBe(names.length);
        for (const name of ['FotosEntry', 'FotosManifest', 'FotosMediaVariant', 'FotosMediaLocator',
            'FotosShareCertificateChain', 'WriterPolicy', 'Assembly', 'Task', 'InstanceRound',
            'Plan', 'ChatTrieEntry', 'Device', 'TargetModuleSettings',
            'Source', 'SourceEntry', 'SourceRun', 'Book',
            'DimensionState', 'DimensionStateReference', 'PhoneBookProjectionRegistry']) {
            expect(names).toContain(name);
        }
        expect(reverseMaps.has('FotosShareCertificateChain')).toBe(true);
        expect(reverseMaps.get('SourceEntry')?.has('sourceId')).toBe(true);
    });
});
