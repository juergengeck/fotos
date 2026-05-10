/**
 * SubscriptionBalance Recipe
 *
 * Stores user's subscription balance and deposit history.
 * Versioned object keyed by userId (Person ID hash).
 */

import type { Recipe } from '@refinio/one.core/lib/recipes.js';

export const SubscriptionBalanceRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'SubscriptionBalance',
    rule: [
        {
            itemprop: 'userId',
            isId: true,  // ID property - makes this a versioned object
            itemtype: {
                type: 'referenceToId',
                allowedTypes: new Set(['Person'])
            }
        },
        {
            itemprop: 'balance',
            itemtype: { type: 'number' }
        },
        {
            itemprop: 'totalDeposited',
            itemtype: { type: 'number' }
        },
        {
            itemprop: 'lastUpdated',
            itemtype: { type: 'number' }
        },
        {
            itemprop: 'version',
            itemtype: { type: 'number' }
        }
    ]
};
