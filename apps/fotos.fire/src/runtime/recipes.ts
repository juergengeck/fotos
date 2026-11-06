import type {Recipe} from '@refinio/one.core/lib/recipes.js';
import RecipesStable from '@refinio/one.models/lib/recipes/recipes-stable.js';
import RecipesExperimental from '@refinio/one.models/lib/recipes/recipes-experimental.js';
import {ReverseMapsStable, ReverseMapsForIdObjectsStable} from '@refinio/one.models/lib/recipes/reversemaps-stable.js';
import {ReverseMapsExperimental, ReverseMapsForIdObjectsExperimental} from '@refinio/one.models/lib/recipes/reversemaps-experimental.js';
import {RefinioApiRecipes} from '@refinio/api/recipes';
import {AssemblyCoreRecipes, AssemblyCoreReverseMaps} from '@refinio/assembly.core';
import GlueContentRecipes from '@glueone/glue.core/recipes/GlueContentRecipes.js';
import PresenceRecipes from '@glueone/glue.core/recipes/PresenceRecipes.js';
import TimeTrieRecipes from '@glueone/glue.core/recipes/TimeTrieRecipes.js';
import {AllRecipes as TrustRecipes, AllReverseMaps as TrustReverseMaps,
  AllReverseMapsForIdObjects as TrustIdReverseMaps} from '@refinio/trust.core/recipes';
import {CubeCoreRecipes} from '@refinio/cube.core/recipes/index.js';
import {CHAT_CORE_RECIPES} from '@refinio/chat.core/recipes/index.js';
import {ConnectionPhoneBookRecipes} from '@refinio/connection.core/recipes';
import {SettingsRecipes} from '@refinio/settings.core';
import {DeviceCoreRecipes, DeviceCoreReverseMaps} from '@refinio/device.core';
import {SourceCoreRecipes} from '@refinio/source.core/recipes';
import {FotosRecipes} from '@refinio/fotos.core';
import {FotosShareReverseMaps} from '@refinio/fotos.core/shared-filesystem';

type ReverseMapDefinitions = Iterable<readonly [string, ReadonlySet<string>]>;
export function mergeReverseMaps(...groups: ReverseMapDefinitions[]): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const group of groups) {
    for (const [type, properties] of group) {
      const merged = result.get(type) ?? new Set<string>();
      for (const property of properties) merged.add(property);
      result.set(type, merged);
    }
  }
  return result;
}

export const fireRecipes: Recipe[] = [
  ...RecipesStable, ...RecipesExperimental, ...GlueContentRecipes, ...PresenceRecipes,
  ...TimeTrieRecipes, ...TrustRecipes, ...CubeCoreRecipes,
  ...SettingsRecipes, ...DeviceCoreRecipes, ...CHAT_CORE_RECIPES, ...AssemblyCoreRecipes,
  ...ConnectionPhoneBookRecipes, ...SourceCoreRecipes, ...RefinioApiRecipes, ...FotosRecipes,
] as Recipe[];

export const fireReverseMaps = mergeReverseMaps(
  ReverseMapsStable, ReverseMapsExperimental, TrustReverseMaps,
  AssemblyCoreReverseMaps, DeviceCoreReverseMaps, FotosShareReverseMaps,
  new Map([
    ['FotosShareCertificate', new Set(['subject', 'issuer'])],
    ['FotosShareCertificateChain', new Set(['subject', 'issuer'])],
    ['FotosSharePinProof', new Set(['sender', 'prover'])],
  ]),
);

export const fireIdReverseMaps = mergeReverseMaps(
  ReverseMapsForIdObjectsStable, ReverseMapsForIdObjectsExperimental, TrustIdReverseMaps,
);
