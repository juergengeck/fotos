import {ensureRecipeObj} from '@refinio/one.core/lib/util/recipe-checks.js';
import RecipesStable from '@refinio/one.models/lib/recipes/recipes-stable.js';
import RecipesExperimental from '@refinio/one.models/lib/recipes/recipes-experimental.js';
import {ReverseMapsStable, ReverseMapsForIdObjectsStable} from '@refinio/one.models/lib/recipes/reversemaps-stable.js';
import {ReverseMapsExperimental, ReverseMapsForIdObjectsExperimental} from '@refinio/one.models/lib/recipes/reversemaps-experimental.js';
import {AssemblyCoreRecipes, AssemblyCoreReverseMaps} from '@refinio/assembly.core/recipes';
import GlueContentRecipes from '@glueone/glue.core/recipes/GlueContentRecipes.js';
import PresenceRecipes from '@glueone/glue.core/recipes/PresenceRecipes.js';
import GlueAuthorityRecipes from '@glueone/glue.core/recipes/GlueAuthorityRecipes.js';
import GlueInstanceAuthorizationRecipes from '@glueone/glue.core/recipes/GlueInstanceAuthorization.js';
import {AllRecipes as TrustRecipes, AllReverseMaps as TrustReverseMaps} from '@refinio/trust.core/recipes/index.js';
import {PersonalTrustRecipes, PersonalTrustReverseMaps} from '@refinio/trust.me/recipes';
import {TrustApiRecipes} from '@refinio/trust.api';
import {CubeCoreRecipes} from '@refinio/cube.core';
import {CHAT_CORE_RECIPES} from '@refinio/chat.core/recipes/index.js';
import {ConnectionPhoneBookRecipes} from '@refinio/connection.core/recipes';
import {SettingsRecipes} from '@refinio/settings.core/recipes/index.js';
import {DeviceCoreRecipes, DeviceCoreReverseMaps} from '@refinio/device.core/recipes/index.js';
import {SourceCoreRecipes, SourceCoreReverseMaps} from '@refinio/source.core/recipes';
import {AppSettingsRecipe} from '@vger/vger.core/recipes/AppSettingsRecipe.js';
import {createFotosOneCoreConfig} from '@refinio/fotos.core/one-core-config';

/** Same host capabilities as the current Fotos mobile graph; Fotos owns its domain schema and rules. */
export const fireOneCoreConfig = createFotosOneCoreConfig({
  recipes: [
    ...RecipesStable, ...RecipesExperimental, ...GlueContentRecipes, ...PresenceRecipes,
    ...GlueAuthorityRecipes, ...GlueInstanceAuthorizationRecipes, ...ConnectionPhoneBookRecipes,
    ...CubeCoreRecipes, AppSettingsRecipe, ...AssemblyCoreRecipes, ...CHAT_CORE_RECIPES,
    ...TrustRecipes, ...TrustApiRecipes, ...PersonalTrustRecipes, ...DeviceCoreRecipes,
    ...SettingsRecipes, ...SourceCoreRecipes,
  ].map(ensureRecipeObj),
  reverseMaps: [
    ReverseMapsStable, ReverseMapsExperimental, TrustReverseMaps, PersonalTrustReverseMaps,
    AssemblyCoreReverseMaps, DeviceCoreReverseMaps, SourceCoreReverseMaps,
  ],
  reverseMapsForIdObjects: [ReverseMapsForIdObjectsStable, ReverseMapsForIdObjectsExperimental],
});
