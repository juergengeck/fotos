import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {BLOB} from '@refinio/one.core/lib/recipes.js';

import type {FotosEntry} from './recipes/FotosRecipes.js';
import type {
    FotosMediaLocator,
    FotosMediaLocatorKind,
    FotosMediaLocatorPlatform,
    FotosMediaLocatorScope,
    FotosMediaVariant,
    FotosMediaVariantRole,
} from './recipes/FotosMediaRecipes.js';

export interface CreateFotosMediaVariantParams {
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

export function createFotosMediaVariant(
    params: CreateFotosMediaVariantParams,
): FotosMediaVariant {
    return {
        $type$: 'FotosMediaVariant',
        contentHash: params.contentHash,
        family: params.family,
        role: params.role,
        mime: params.mime,
        ...(params.byteSize !== undefined ? {byteSize: params.byteSize} : {}),
        ...(params.width !== undefined ? {width: params.width} : {}),
        ...(params.height !== undefined ? {height: params.height} : {}),
        ...(params.blob ? {blob: params.blob} : {}),
        ...(params.derivedFrom ? {derivedFrom: params.derivedFrom} : {}),
        ...(params.createdAt ? {createdAt: params.createdAt} : {}),
        ...(params.label ? {label: params.label} : {}),
    };
}

export interface BuildFotosMediaLocatorIdParams {
    variant: SHA256IdHash<FotosMediaVariant>;
    platform: FotosMediaLocatorPlatform;
    kind: FotosMediaLocatorKind;
    scope: FotosMediaLocatorScope;
    locator: string;
    deviceId?: string;
}

function encodeLocatorPart(value: string): string {
    return encodeURIComponent(value);
}

export function buildFotosMediaLocatorId(
    params: BuildFotosMediaLocatorIdParams,
): string {
    return [
        'fotos-locator',
        params.platform,
        params.kind,
        params.scope,
        params.deviceId ? encodeLocatorPart(params.deviceId) : '-',
        encodeLocatorPart(String(params.variant)),
        encodeLocatorPart(params.locator),
    ].join(':');
}

export interface CreateFotosMediaLocatorParams extends BuildFotosMediaLocatorIdParams {
    lastVerifiedAt?: string;
}

export function createFotosMediaLocator(
    params: CreateFotosMediaLocatorParams,
): FotosMediaLocator {
    return {
        $type$: 'FotosMediaLocator',
        id: buildFotosMediaLocatorId(params),
        variant: params.variant,
        platform: params.platform,
        kind: params.kind,
        scope: params.scope,
        locator: params.locator,
        ...(params.deviceId ? {deviceId: params.deviceId} : {}),
        ...(params.lastVerifiedAt ? {lastVerifiedAt: params.lastVerifiedAt} : {}),
    };
}
