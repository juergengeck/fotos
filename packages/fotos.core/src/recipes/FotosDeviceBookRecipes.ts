import type { Recipe, VersionNode } from '@refinio/one.core/lib/recipes.js';
import type { SHA256Hash } from '@refinio/one.core/lib/util/type-checks.js';
import type {
    FotosAuthenticityAttestation,
    FotosEntry,
} from './FotosRecipes.js';
import type {
    FotosMediaLocator,
    FotosMediaVariant,
} from './FotosMediaRecipes.js';

export const FOTOS_DEVICE_BOOK_ROLES = [
    'storage',
    'compute',
    'browser',
    'mobile',
    'headless',
] as const;

export type FotosDeviceBookRole = typeof FOTOS_DEVICE_BOOK_ROLES[number];

export function isFotosDeviceBookRole(value: string): value is FotosDeviceBookRole {
    return (FOTOS_DEVICE_BOOK_ROLES as readonly string[]).includes(value);
}

export interface FotosDeviceBook {
    $type$: 'FotosDeviceBook';
    $versionHash$?: SHA256Hash<VersionNode>;
    id: string;
    deviceId: string;
    title: string;
    role: FotosDeviceBookRole;
    entries: Set<SHA256Hash<FotosEntry>>;
    sourceIdHashes?: Set<string>;
    entryIdHashes?: Set<string>;
    variants?: Set<SHA256Hash<FotosMediaVariant>>;
    locators?: Set<SHA256Hash<FotosMediaLocator>>;
    authenticityAttestations?: Set<SHA256Hash<FotosAuthenticityAttestation>>;
    createdAt: number;
    updatedAt: number;
}

declare module '@OneObjectInterfaces' {
    export interface OneIdObjectInterfaces {
        FotosDeviceBook: Pick<FotosDeviceBook, '$type$' | 'id'>;
    }

    export interface OneVersionedObjectInterfaces {
        FotosDeviceBook: FotosDeviceBook;
    }
}

const DEVICE_BOOK_ROLE_REGEXP = /^(storage|compute|browser|mobile|headless)$/;

export const FotosDeviceBookRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'FotosDeviceBook',
    rule: [
        { itemprop: 'id', isId: true, itemtype: { type: 'string' } },
        { itemprop: 'deviceId', itemtype: { type: 'string' } },
        { itemprop: 'title', itemtype: { type: 'string' } },
        { itemprop: 'role', itemtype: { type: 'string', regexp: DEVICE_BOOK_ROLE_REGEXP } },
        {
            itemprop: 'entries',
            itemtype: {
                type: 'set',
                item: { type: 'referenceToObj', allowedTypes: new Set(['FotosEntry']) },
            },
        },
        {
            itemprop: 'sourceIdHashes',
            optional: true,
            itemtype: {
                type: 'set',
                item: { type: 'string' },
            },
        },
        {
            itemprop: 'entryIdHashes',
            optional: true,
            itemtype: {
                type: 'set',
                item: { type: 'string' },
            },
        },
        {
            itemprop: 'variants',
            optional: true,
            itemtype: {
                type: 'set',
                item: { type: 'referenceToObj', allowedTypes: new Set(['FotosMediaVariant']) },
            },
        },
        {
            itemprop: 'locators',
            optional: true,
            itemtype: {
                type: 'set',
                item: { type: 'referenceToObj', allowedTypes: new Set(['FotosMediaLocator']) },
            },
        },
        {
            itemprop: 'authenticityAttestations',
            optional: true,
            itemtype: {
                type: 'set',
                item: { type: 'referenceToObj', allowedTypes: new Set(['FotosAuthenticityAttestation']) },
            },
        },
        { itemprop: 'createdAt', itemtype: { type: 'number' } },
        { itemprop: 'updatedAt', itemtype: { type: 'number' } },
    ],
};

export const FotosDeviceBookRecipes: Recipe[] = [
    FotosDeviceBookRecipe,
];
