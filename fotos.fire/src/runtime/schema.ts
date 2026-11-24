import type {Recipe} from '@refinio/one.core/lib/recipes.js';

type ReverseMaps = ReadonlyMap<string, ReadonlySet<string>>;

export interface RuntimeSchema {
  recipes: readonly Recipe[];
  reverseMaps: ReverseMaps;
  reverseMapsForIdObjects: ReverseMaps;
}

export interface StoredInstanceSchema {
  recipe: ReadonlySet<string>;
  enabledReverseMapTypes: ReverseMaps;
  enabledReverseMapTypesForIdObjects: ReverseMaps;
}

export interface RuntimeSchemaAdditions {
  recipes: Recipe[];
  enabledReverseMapTypes: Map<string, Set<string>>;
  enabledReverseMapTypesForIdObjects: Map<string, Set<string>>;
}

function missingMapTypes(current: ReverseMaps, requested: ReverseMaps): Map<string, Set<string>> {
  const missing = new Map<string, Set<string>>();
  for (const [type, properties] of requested) {
    const existing = current.get(type);
    if (existing) {
      if (existing.size !== properties.size || [...properties].some(property => !existing.has(property))) {
        throw new Error(`The saved Fire TV reverse-map definition conflicts for ${type}; the existing store has been preserved`);
      }
    } else {
      missing.set(type, new Set(properties));
    }
  }
  return missing;
}

/** Admit new schema before starting producers. Existing definitions and objects are never rewritten or backfilled. */
export async function admitRuntimeSchema(
  current: StoredInstanceSchema,
  desired: RuntimeSchema,
  ports: {
    hashRecipe(recipe: Recipe): Promise<string>;
    publish(additions: RuntimeSchemaAdditions): Promise<unknown>;
  },
): Promise<void> {
  // Preflight both index sets before hashing recipes or publishing any change.
  const enabledReverseMapTypes = missingMapTypes(current.enabledReverseMapTypes, desired.reverseMaps);
  const enabledReverseMapTypesForIdObjects = missingMapTypes(
    current.enabledReverseMapTypesForIdObjects, desired.reverseMapsForIdObjects);
  const recipes: Recipe[] = [];
  for (const recipe of desired.recipes) {
    if (!current.recipe.has(await ports.hashRecipe(recipe))) recipes.push(recipe);
  }
  if (recipes.length || enabledReverseMapTypes.size || enabledReverseMapTypesForIdObjects.size) {
    await ports.publish({recipes, enabledReverseMapTypes, enabledReverseMapTypesForIdObjects});
  }
}
