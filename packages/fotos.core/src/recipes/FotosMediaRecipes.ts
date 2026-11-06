/**
 * Fotos media recipes.
 *
 * These objects make the separation explicit between:
 * - canonical fotos identity (`FotosEntry`, keyed by contentHash)
 * - concrete known media variants (thumbs, previews, crops, edits)
 * - platform-specific local or remote locators used to reacquire bytes
 *
 * This keeps content identity device-agnostic while giving Expo, browser,
 * and headless runtimes somewhere correct to persist their reachability data.
 */
import type {BLOB, Recipe, VersionNode} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {FotosEntry} from './FotosRecipes.js';

export const FOTOS_MEDIA_VARIANT_ROLES = [
    'original',
    'thumbnail',
    'preview',
    'transcode',
    'edit',
    'face-crop',
    'analysis-input',
    'analysis-output',
] as const;

export type FotosMediaVariantRole = typeof FOTOS_MEDIA_VARIANT_ROLES[number];

export const FOTOS_MEDIA_LOCATOR_PLATFORMS = [
    'ios',
    'android',
    'browser',
    'headless',
    'desktop',
    'web',
] as const;

export type FotosMediaLocatorPlatform = typeof FOTOS_MEDIA_LOCATOR_PLATFORMS[number];

export const FOTOS_MEDIA_LOCATOR_KINDS = [
    'phasset',
    'media-store',
    'filesystem-path',
    'file-handle',
    'relative-path',
    'url',
    'one-blob',
] as const;

export type FotosMediaLocatorKind = typeof FOTOS_MEDIA_LOCATOR_KINDS[number];

export const FOTOS_MEDIA_LOCATOR_SCOPES = [
    'device-local',
    'shared-cache',
    'remote',
] as const;

export type FotosMediaLocatorScope = typeof FOTOS_MEDIA_LOCATOR_SCOPES[number];

export function isFotosMediaVariantRole(value: string): value is FotosMediaVariantRole {
    return (FOTOS_MEDIA_VARIANT_ROLES as readonly string[]).includes(value);
}

export function isFotosMediaLocatorPlatform(value: string): value is FotosMediaLocatorPlatform {
    return (FOTOS_MEDIA_LOCATOR_PLATFORMS as readonly string[]).includes(value);
}

export function isFotosMediaLocatorKind(value: string): value is FotosMediaLocatorKind {
    return (FOTOS_MEDIA_LOCATOR_KINDS as readonly string[]).includes(value);
}

export function isFotosMediaLocatorScope(value: string): value is FotosMediaLocatorScope {
    return (FOTOS_MEDIA_LOCATOR_SCOPES as readonly string[]).includes(value);
}

export interface FotosMediaVariant {
    $type$: 'FotosMediaVariant';
    $versionHash$?: SHA256Hash<VersionNode>;
    contentHash: string;
    family: SHA256IdHash<FotosEntry>;
    role: FotosMediaVariantRole;
    mime: string;
    byteSize?: number;
    width?: number;
    height?: number;
    blob?: SHA256Hash<BLOB>;
    derivedFrom?: SHA256IdHash<FotosMediaVariant>;
    createdAt?: string;
    label?: string;
}

export interface FotosMediaLocator {
    $type$: 'FotosMediaLocator';
    $versionHash$?: SHA256Hash<VersionNode>;
    id: string;
    variant: SHA256IdHash<FotosMediaVariant>;
    platform: FotosMediaLocatorPlatform;
    kind: FotosMediaLocatorKind;
    scope: FotosMediaLocatorScope;
    locator: string;
    deviceId?: string;
    lastVerifiedAt?: string;
}

declare module '@OneObjectInterfaces' {
    export interface OneIdObjectInterfaces {
        FotosMediaVariant: Pick<FotosMediaVariant, '$type$' | 'contentHash'>;
        FotosMediaLocator: Pick<FotosMediaLocator, '$type$' | 'id'>;
    }

    export interface OneVersionedObjectInterfaces {
        FotosMediaVariant: FotosMediaVariant;
        FotosMediaLocator: FotosMediaLocator;
    }
}

export const FotosMediaVariantRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'FotosMediaVariant',
    rule: [
        {itemprop: 'contentHash', isId: true, itemtype: {type: 'string'}},
        {itemprop: 'family', itemtype: {type: 'referenceToId', allowedTypes: new Set(['FotosEntry'])}},
        {itemprop: 'role', itemtype: {type: 'string'}},
        {itemprop: 'mime', itemtype: {type: 'string'}},
        {itemprop: 'byteSize', optional: true, itemtype: {type: 'integer'}},
        {itemprop: 'width', optional: true, itemtype: {type: 'integer'}},
        {itemprop: 'height', optional: true, itemtype: {type: 'integer'}},
        {itemprop: 'blob', optional: true, itemtype: {type: 'referenceToBlob'}},
        {
            itemprop: 'derivedFrom',
            optional: true,
            itemtype: {type: 'referenceToId', allowedTypes: new Set(['FotosMediaVariant'])},
        },
        {itemprop: 'createdAt', optional: true, itemtype: {type: 'string'}},
        {itemprop: 'label', optional: true, itemtype: {type: 'string'}},
    ],
};

export const FotosMediaLocatorRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'FotosMediaLocator',
    rule: [
        {itemprop: 'id', isId: true, itemtype: {type: 'string'}},
        {
            itemprop: 'variant',
            itemtype: {type: 'referenceToId', allowedTypes: new Set(['FotosMediaVariant'])},
        },
        {itemprop: 'platform', itemtype: {type: 'string'}},
        {itemprop: 'kind', itemtype: {type: 'string'}},
        {itemprop: 'scope', itemtype: {type: 'string'}},
        {itemprop: 'locator', itemtype: {type: 'string'}},
        {itemprop: 'deviceId', optional: true, itemtype: {type: 'string'}},
        {itemprop: 'lastVerifiedAt', optional: true, itemtype: {type: 'string'}},
    ],
};

export const FotosMediaRecipes: Recipe[] = [
    FotosMediaVariantRecipe,
    FotosMediaLocatorRecipe,
];
