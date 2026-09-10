import { DeviceCoreRecipes, DeviceCoreReverseMaps } from '@refinio/device.core';
import type { Recipe } from '@refinio/one.core/lib/recipes.js';
import RecipesStable from '@refinio/one.models/lib/recipes/recipes-stable.js';
import RecipesExperimental from '@refinio/one.models/lib/recipes/recipes-experimental.js';
import {
  ReverseMapsStable,
  ReverseMapsForIdObjectsStable,
} from '@refinio/one.models/lib/recipes/reversemaps-stable.js';
import {
  ReverseMapsExperimental,
  ReverseMapsForIdObjectsExperimental,
} from '@refinio/one.models/lib/recipes/reversemaps-experimental.js';
import { RefinioApiRecipes } from '@refinio/api/recipes';
import {
  AssemblyCoreRecipes,
  AssemblyCoreReverseMaps,
} from '@refinio/assembly.core';
import GlueContentRecipes from '@glueone/glue.core/recipes/GlueContentRecipes.js';
import PresenceRecipes from '@glueone/glue.core/recipes/PresenceRecipes.js';
import TimeTrieRecipes from '@glueone/glue.core/recipes/TimeTrieRecipes.js';
import {
  AllRecipes as TrustCoreRecipes,
  AllReverseMaps as TrustCoreReverseMaps,
  AllReverseMapsForIdObjects as TrustCoreReverseMapsForIdObjects,
} from '@refinio/trust.core/recipes';
import { CubeCoreRecipes } from '@refinio/cube.core/recipes/index.js';
import { CHAT_CORE_RECIPES } from '@refinio/chat.core/recipes/index.js';
import { ConnectionPhoneBookRecipes } from '@refinio/connection.core/recipes';
import { SettingsRecipes } from '@refinio/settings.core';
import { FotosRecipes } from '../../../../fotos.core/src/recipes/FotosRecipes.js';
import { SourceCoreRecipes } from '../../../../../one/packages/source.core/dist/recipes/index.js';

type ReverseMapDefinitions = Iterable<readonly [string, ReadonlySet<string>]>;

export function mergeReverseMapDefinitions(
  ...definitions: ReverseMapDefinitions[]
): Map<string, Set<string>> {
  const merged = new Map<string, Set<string>>();
  for (const definition of definitions) {
    for (const [objectType, properties] of definition) {
      const target = merged.get(objectType) ?? new Set<string>();
      for (const property of properties) target.add(property);
      merged.set(objectType, target);
    }
  }
  return merged;
}

export const FotosOneCoreRecipes: Recipe[] = [
  ...RecipesStable,
  ...RecipesExperimental,
  ...GlueContentRecipes,
  ...PresenceRecipes,
  ...TimeTrieRecipes,
  ...TrustCoreRecipes,
  ...CubeCoreRecipes,
  ...SettingsRecipes,
  ...DeviceCoreRecipes,
  ...CHAT_CORE_RECIPES,
  ...AssemblyCoreRecipes,
  ...ConnectionPhoneBookRecipes,
  ...SourceCoreRecipes,
  ...RefinioApiRecipes,
  ...FotosRecipes,
] as Recipe[];

export const FotosReverseMaps = mergeReverseMapDefinitions(
  new Map(DeviceCoreReverseMaps),
  ReverseMapsStable,
  ReverseMapsExperimental,
  TrustCoreReverseMaps,
  AssemblyCoreReverseMaps,
  new Map([
    ['FotosShareCertificate', new Set(['subject', 'issuer'])],
    ['FotosShareCertificateChain', new Set(['subject', 'issuer'])],
  ]),
);

export const FotosReverseMapsForIdObjects = mergeReverseMapDefinitions(
  ReverseMapsForIdObjectsStable,
  ReverseMapsForIdObjectsExperimental,
  TrustCoreReverseMapsForIdObjects,
);
