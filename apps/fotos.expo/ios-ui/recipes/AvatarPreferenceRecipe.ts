/**
 * ONE.core Recipe for AvatarPreference objects
 *
 * Stores named avatar configurations for a person:
 * - ID properties: personId + name (name is the avatar identifier)
 * - Generation tracks versions (increments on each save)
 * - Custom vger avatar with configurable parts
 * - Simple color preference (fallback)
 * - Optional mood indicator
 */
export const AvatarPreferenceRecipe = {
    $type$: 'Recipe',
    name: 'AvatarPreference',
    rule: [
        {
            itemprop: '$type$',
            itemtype: { type: 'string', regexp: /^AvatarPreference$/ }
        },
        {
            itemprop: 'personId',
            itemtype: { type: 'string' },
            isId: true // Person ID (part of composite ID)
        },
        {
            itemprop: 'name',
            itemtype: { type: 'string' },
            isId: true // Avatar name is the ID (default: "VGER")
        },
        {
            itemprop: 'generation',
            itemtype: { type: 'integer' } // Version number, starts at 1
        },
        {
            itemprop: 'vgerConfig',
            itemtype: {
                type: 'object',
                rules: [
                    {
                        itemprop: 'fell',
                        itemtype: { type: 'boolean' }
                    },
                    {
                        itemprop: 'hufen',
                        itemtype: { type: 'boolean' }
                    },
                    {
                        itemprop: 'schwanz',
                        itemtype: { type: 'boolean' }
                    },
                    {
                        itemprop: 'ohren',
                        itemtype: { type: 'boolean' }
                    },
                    {
                        itemprop: 'augen',
                        itemtype: { type: 'boolean' }
                    },
                    {
                        itemprop: 'krawatte',
                        itemtype: { type: 'boolean' }
                    },
                    {
                        itemprop: 'hut',
                        itemtype: { type: 'boolean' }
                    },
                    {
                        itemprop: 'punk',
                        itemtype: { type: 'boolean' }
                    },
                    {
                        itemprop: 'fellColor',
                        itemtype: { type: 'string' },
                        optional: true
                    },
                    {
                        itemprop: 'hufenColor',
                        itemtype: { type: 'string' },
                        optional: true
                    },
                    {
                        itemprop: 'schwanzColor',
                        itemtype: { type: 'string' },
                        optional: true
                    },
                    {
                        itemprop: 'ohrenColor',
                        itemtype: { type: 'string' },
                        optional: true
                    },
                    {
                        itemprop: 'augenColor',
                        itemtype: { type: 'string' },
                        optional: true
                    },
                    {
                        itemprop: 'krawatteColor',
                        itemtype: { type: 'string' },
                        optional: true
                    },
                    {
                        itemprop: 'hutColor',
                        itemtype: { type: 'string' },
                        optional: true
                    },
                    {
                        itemprop: 'punkColor',
                        itemtype: { type: 'string' },
                        optional: true
                    }
                ]
            },
            optional: true
        },
        {
            itemprop: 'color',
            itemtype: { type: 'string' },
            optional: true
        },
        {
            itemprop: 'mood',
            itemtype: { type: 'string', regexp: /^(happy|sad|angry|calm|excited|tired|focused|neutral)$/ },
            optional: true
        },
        {
            itemprop: 'createdAt',
            itemtype: { type: 'integer' }
        },
        {
            itemprop: 'updatedAt',
            itemtype: { type: 'integer' }
        },
        {
            itemprop: '$versionHash$',
            itemtype: { type: 'string' },
            optional: true
        }
    ]
};
