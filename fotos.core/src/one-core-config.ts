import type {OneVersionedObjectTypeNames, Recipe} from '@refinio/one.core/lib/recipes.js';
import {FotosRecipes} from './recipes/FotosRecipes.js';
import {fotosContentRules} from './sync-rules.js';

type ReverseMapDefinitions<Kind extends string = string> = Iterable<readonly [Kind, ReadonlySet<string>]>;
type SyncRule = typeof fotosContentRules extends ReadonlyMap<string, infer Rule> ? Rule : never;

const fotosRecipeNames = new Set<string>(FotosRecipes.map(recipe => recipe.name));
const fotosReverseMaps = new Map<string, Set<string>>([
    ['FotosShareCertificate', new Set(['subject', 'issuer'])],
    ['FotosShareCertificateChain', new Set(['subject', 'issuer'])],
    ['FotosSharePinProof', new Set(['sender', 'prover'])],
]);

export function mergeReverseMapDefinitions<Kind extends string>(...definitions: ReverseMapDefinitions<Kind>[]): Map<Kind, Set<string>> {
    const merged = new Map<Kind, Set<string>>();
    for (const definition of definitions) {
        for (const [type, properties] of definition) {
            const target = merged.get(type) ?? new Set<string>();
            for (const property of properties) target.add(property);
            merged.set(type, target);
        }
    }
    return merged;
}

export interface FotosOneCoreOptions {
    recipes?: readonly Recipe[];
    reverseMaps?: readonly ReverseMapDefinitions[];
    reverseMapsForIdObjects?: readonly ReverseMapDefinitions[];
    syncRules?: ReadonlyMap<string, SyncRule>;
}

/** Compose the Fotos domain with the host's independent ONE runtime capabilities. */
export function createFotosOneCoreConfig(options: FotosOneCoreOptions = {}) {
    const syncRules = new Map<string, SyncRule>(fotosContentRules);
    for (const [type, rule] of options.syncRules ?? []) {
        if (!fotosRecipeNames.has(type)) syncRules.set(type, rule);
    }
    return {
        recipes: [...(options.recipes ?? []).filter(recipe => !fotosRecipeNames.has(recipe.name)), ...FotosRecipes],
        reverseMaps: mergeReverseMapDefinitions(...options.reverseMaps ?? [], fotosReverseMaps),
        reverseMapsForIdObjects: mergeReverseMapDefinitions(...options.reverseMapsForIdObjects ?? []) as
            Map<OneVersionedObjectTypeNames, Set<string>>,
        syncRules,
    };
}
