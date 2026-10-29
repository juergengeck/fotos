import type {Recipe} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';
import type {FotosMediaVariant} from './FotosMediaRecipes.js';

/** Acquisition is possession of retained bytes, or an import of reported metadata. */
export interface FotosAcquisitionClaim {
    $type$: 'FotosAcquisitionClaim';
    $version$: '1';
    variant: SHA256Hash<FotosMediaVariant>;
    kind: 'bytes-acquired' | 'metadata-imported';
    capture: 'unestablished';
    authorship: 'unestablished';
    licensingAuthority: 'unestablished';
}

export interface FotosAcquisitionMethod {
    $type$: 'FotosAcquisitionMethod';
    $version$: '1';
    procedure: 'retain-original-bytes' | 'import-reported-metadata';
}

/** Catalog/EXIF values are reported data, never evidence that capture occurred. */
export interface FotosAcquisitionContext {
    $type$: 'FotosAcquisitionContext';
    $version$: '1';
    acquiredAt: number;
    surface: 'browser' | 'mobile-library' | 'shared-file' | 'filesystem';
    source: string;
    reportedCaptureTime?: string;
    reportedCamera?: string;
    reportedGpsLat?: number;
    reportedGpsLon?: number;
}

export interface FotosAcquisitionPremise {
    $type$: 'FotosAcquisitionPremise';
    $version$: '1';
    proposition: 'imported-metadata-corresponds-to-unavailable-original';
}

declare module '@OneObjectInterfaces' {
    interface OneUnversionedObjectInterfaces {
        FotosAcquisitionClaim: FotosAcquisitionClaim;
        FotosAcquisitionMethod: FotosAcquisitionMethod;
        FotosAcquisitionContext: FotosAcquisitionContext;
        FotosAcquisitionPremise: FotosAcquisitionPremise;
    }
}

const version = {itemprop: '$version$', itemtype: {type: 'string', regexp: /^1$/}} as const;
export const FotosAcquisitionRecipes: Recipe[] = [
    {$type$: 'Recipe', name: 'FotosAcquisitionClaim', rule: [
        version,
        {itemprop: 'variant', itemtype: {type: 'referenceToObj', allowedTypes: new Set(['FotosMediaVariant'])}},
        {itemprop: 'kind', itemtype: {type: 'string', regexp: /^(bytes-acquired|metadata-imported)$/}},
        ...['capture', 'authorship', 'licensingAuthority'].map(itemprop => ({itemprop, itemtype: {type: 'string' as const, regexp: /^unestablished$/}})),
    ]},
    {$type$: 'Recipe', name: 'FotosAcquisitionMethod', rule: [
        version,
        {itemprop: 'procedure', itemtype: {type: 'string', regexp: /^(retain-original-bytes|import-reported-metadata)$/}},
    ]},
    {$type$: 'Recipe', name: 'FotosAcquisitionContext', rule: [
        version,
        {itemprop: 'acquiredAt', itemtype: {type: 'number'}},
        {itemprop: 'surface', itemtype: {type: 'string', regexp: /^(browser|mobile-library|shared-file|filesystem)$/}},
        {itemprop: 'source', itemtype: {type: 'string'}},
        {itemprop: 'reportedCaptureTime', optional: true, itemtype: {type: 'string'}},
        {itemprop: 'reportedCamera', optional: true, itemtype: {type: 'string'}},
        {itemprop: 'reportedGpsLat', optional: true, itemtype: {type: 'number'}},
        {itemprop: 'reportedGpsLon', optional: true, itemtype: {type: 'number'}},
    ]},
    {$type$: 'Recipe', name: 'FotosAcquisitionPremise', rule: [
        version,
        {itemprop: 'proposition', itemtype: {type: 'string', regexp: /^imported-metadata-corresponds-to-unavailable-original$/}},
    ]},
];
