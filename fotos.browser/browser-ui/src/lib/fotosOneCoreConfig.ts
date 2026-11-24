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
import {
  GlueAuthorityCertificateRecipe,
  GlueAuthoritySourceRecipe,
} from '@glueone/glue.core/recipes/GlueAuthorityRecipes.js';
import { GlueInstanceAuthorizationRecipes } from '@glueone/glue.core/recipes/GlueInstanceAuthorization.js';
import PresenceRecipes from '@glueone/glue.core/recipes/PresenceRecipes.js';
import TimeTrieRecipes from '@glueone/glue.core/recipes/TimeTrieRecipes.js';
import {
  AllRecipes as TrustCoreRecipes,
  AllReverseMaps as TrustCoreReverseMaps,
  AllReverseMapsForIdObjects as TrustCoreReverseMapsForIdObjects,
} from '@refinio/trust.core/recipes';
import { PersonalTrustRecipes, PersonalTrustReverseMaps } from '@refinio/trust.me/recipes';
import { CubeCoreRecipes } from '@refinio/cube.core/recipes/index.js';
import { CHAT_CORE_RECIPES } from '@refinio/chat.core/recipes/index.js';
import { ConnectionPhoneBookRecipes } from '@refinio/connection.core/recipes';
import { SettingsRecipes } from '@refinio/settings.core';
import { createFotosOneCoreConfig } from '@refinio/fotos.core/one-core-config';
import { SourceCoreRecipes } from '@refinio/source.core/recipes';

export {mergeReverseMapDefinitions} from '@refinio/fotos.core/one-core-config';

const config = createFotosOneCoreConfig({
  recipes: [
    ...RecipesStable,
    ...RecipesExperimental,
    ...GlueContentRecipes,
    GlueAuthorityCertificateRecipe,
    GlueAuthoritySourceRecipe,
    ...GlueInstanceAuthorizationRecipes,
    ...PresenceRecipes,
    ...TimeTrieRecipes,
    ...TrustCoreRecipes,
    ...PersonalTrustRecipes,
    ...CubeCoreRecipes,
    ...SettingsRecipes,
    ...DeviceCoreRecipes,
    ...CHAT_CORE_RECIPES,
    ...AssemblyCoreRecipes,
    ...ConnectionPhoneBookRecipes,
    ...SourceCoreRecipes,
    ...RefinioApiRecipes,
  ] as Recipe[],
  reverseMaps: [
    DeviceCoreReverseMaps,
    ReverseMapsStable,
    ReverseMapsExperimental,
    TrustCoreReverseMaps,
    PersonalTrustReverseMaps,
    AssemblyCoreReverseMaps,
  ],
  reverseMapsForIdObjects: [
    ReverseMapsForIdObjectsStable,
    ReverseMapsForIdObjectsExperimental,
    TrustCoreReverseMapsForIdObjects,
  ],
});

export const FotosOneCoreRecipes = config.recipes;
export const FotosReverseMaps = config.reverseMaps;
export const FotosReverseMapsForIdObjects = config.reverseMapsForIdObjects;
export const FotosSyncRules = config.syncRules;
