/**
 * Story Recipe - Re-export from @refinio/api
 *
 * This re-exports the canonical StoryRecipe from @refinio/api to ensure
 * consistency with StoryFactory which creates Story objects.
 *
 * DO NOT define a local version - it must match what StoryFactory produces.
 */

export { StoryRecipe, type Story } from '@refinio/api/plan-system';
