import RecipesStable from '@refinio/one.models/lib/recipes/recipes-stable.js';
import RecipesExperimental from '@refinio/one.models/lib/recipes/recipes-experimental.js';
import GlueContentRecipes from '@glueone/glue.core/recipes/GlueContentRecipes.js';
import PresenceRecipes from '@glueone/glue.core/recipes/PresenceRecipes.js';
import GlueAuthorityRecipes from '@glueone/glue.core/recipes/GlueAuthorityRecipes.js';
import GlueInstanceAuthorizationRecipes from '@glueone/glue.core/recipes/GlueInstanceAuthorization.js';
import { ConnectionPhoneBookRecipes } from '@refinio/connection.core/recipes';
import { CubeCoreRecipes } from '@refinio/cube.core';
import { TrustApiRecipes } from '@refinio/trust.api';
import {
    ReverseMapsStable,
    ReverseMapsForIdObjectsStable
} from '@refinio/one.models/lib/recipes/reversemaps-stable.js';
import {
    ReverseMapsExperimental,
    ReverseMapsForIdObjectsExperimental
} from '@refinio/one.models/lib/recipes/reversemaps-experimental.js';
import { AppSettingsRecipe } from '@vger/vger.core/recipes/AppSettingsRecipe.js';
import { AssemblyCoreRecipes, AssemblyCoreReverseMaps } from '@refinio/assembly.core/recipes';
import { CHAT_CORE_RECIPES } from '@refinio/chat.core/recipes/index.js';
import { AllRecipes as TrustCoreRecipes, AllReverseMaps as TrustCoreReverseMaps } from '@refinio/trust.core/recipes/index.js';
import { PersonalTrustRecipes, PersonalTrustReverseMaps } from '@refinio/trust.me/recipes';
import {createFotosOneCoreConfig} from '@refinio/fotos.core/one-core-config';
import { DeviceCoreRecipes, DeviceCoreReverseMaps } from '@refinio/device.core/recipes/index.js';
import { SettingsRecipes } from '@refinio/settings.core/recipes/index.js';

export function getFotosRuntimeRecipeConfig() {
    const recipeGroups: Array<{ name: string; recipes: any[] }> = [
        { name: 'one.models/stable', recipes: RecipesStable },
        { name: 'one.models/experimental', recipes: RecipesExperimental },
        { name: 'glue.core/content', recipes: GlueContentRecipes },
        { name: 'glue.core/presence', recipes: PresenceRecipes },
        { name: 'glue.core/authority', recipes: GlueAuthorityRecipes },
        { name: 'glue.core/instance-authorization', recipes: GlueInstanceAuthorizationRecipes },
        { name: 'connection.core/phonebook', recipes: ConnectionPhoneBookRecipes },
        { name: 'cube.core', recipes: CubeCoreRecipes },
        { name: 'app settings', recipes: [AppSettingsRecipe] },
        { name: 'assembly.core', recipes: AssemblyCoreRecipes },
        { name: 'chat.core protocol', recipes: CHAT_CORE_RECIPES },
        { name: 'trust.core', recipes: TrustCoreRecipes as any[] },
        { name: 'trust.api', recipes: TrustApiRecipes },
        { name: 'trust.me', recipes: PersonalTrustRecipes },
        { name: 'device.core', recipes: DeviceCoreRecipes },
        { name: 'settings.core', recipes: SettingsRecipes },
    ];

    const recipes: any[] = [];
    for (const group of recipeGroups) {
        if (!Array.isArray(group.recipes)) {
            throw new Error(`[Model] Recipe group ${group.name} is not an array`);
        }

        group.recipes.forEach((recipe, index) => {
            if (recipe === undefined) {
                throw new Error(`[Model] Recipe ${group.name}[${index}] is undefined`);
            }
            if (recipe === null || typeof recipe !== 'object') {
                throw new Error(`[Model] Recipe ${group.name}[${index}] is not an object`);
            }
            if (recipe.$type$ !== 'Recipe') {
                throw new Error(`[Model] Recipe ${group.name}[${index}] has invalid $type$: ${String(recipe.$type$)}`);
            }
            if (typeof recipe.name !== 'string' || recipe.name.length === 0) {
                throw new Error(`[Model] Recipe ${group.name}[${index}] has invalid name`);
            }
            if (!Array.isArray(recipe.rule)) {
                throw new Error(`[Model] Recipe ${group.name}[${index}] (${recipe.name}) has invalid rule`);
            }
            recipes.push(recipe);
        });
    }

    const recipeNames = recipes.map((recipe) => recipe.name);
    const nameCounts = new Map<string, number>();
    for (const name of recipeNames) {
        nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
    }
    const duplicateNames = [...nameCounts.entries()].filter(([, count]) => count > 1);
    if (duplicateNames.length > 0) {
        throw new Error(`[Model] Duplicate recipes detected: ${duplicateNames.map(([name]) => name).join(', ')}`);
    }

    return createFotosOneCoreConfig({
        recipes,
        reverseMaps: [ReverseMapsStable, ReverseMapsExperimental, TrustCoreReverseMaps,
            PersonalTrustReverseMaps, AssemblyCoreReverseMaps, DeviceCoreReverseMaps],
        reverseMapsForIdObjects: [ReverseMapsForIdObjectsStable, ReverseMapsForIdObjectsExperimental],
    });
}
