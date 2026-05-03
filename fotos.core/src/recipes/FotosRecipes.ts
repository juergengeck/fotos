/**
 * FotosRecipes -- ONE.core recipe definitions for fotos.one federation.
 *
 * FotosEntry: versioned object representing a photo's metadata.
 * Created by any instance during ingestion. Updated by desktop to add face data.
 * Keyed by contentHash (isId) -- all instances converge on the same object.
 *
 * FotosManifest: singleton versioned object listing all FotosEntry refs.
 * Fixed id 'fotos' ensures deterministic idHash across all instances.
 * IdAccess grants on this manifest gate who can sync photo metadata.
 */
import type {BLOB, Person, Recipe, VersionNode} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import {GalleryTrieRecipes} from './GalleryTrieRecipes.js';

interface SubscriptionCertificateRef {
    $type$: 'SubscriptionCertificate';
}

// ---------------------------------------------------------------------------
// TypeScript interfaces
// ---------------------------------------------------------------------------

export interface FotosEntry {
    $type$: 'FotosEntry';
    $versionHash$?: SHA256Hash<VersionNode>;
    contentHash: string;
    streamId: string;
    mime: string;
    size: number;
    capturedAt?: string;
    updatedAt?: string;
    sourcePath?: string;
    folderPath?: string;
    exifDate?: string;
    exifCamera?: string;
    exifLens?: string;
    exifFocalLength?: string;
    exifAperture?: string;
    exifShutter?: string;
    exifIso?: number;
    exifGpsLat?: number;
    exifGpsLon?: number;
    exifWidth?: number;
    exifHeight?: number;
    thumb?: SHA256Hash<BLOB>;
    faceCount?: number;
    faceEmbeddings?: SHA256Hash<BLOB>;
    faceCrops?: SHA256Hash<BLOB>;
}

export const FOTOS_AUTHENTICITY_SCHEME = 'fotos-authenticity-v1';

export interface FotosAuthenticityAttestation {
    $type$: 'FotosAuthenticityAttestation';
    $versionHash$?: SHA256Hash<VersionNode>;
    id: string;
    contentHash: string;
    signer: SHA256IdHash<Person>;
    signerPublicKey: string;
    signatureScheme: typeof FOTOS_AUTHENTICITY_SCHEME;
    signature: string;
    subscriptionCertificate?: SHA256Hash<SubscriptionCertificateRef>;
}

export interface FotosManifest {
    $type$: 'FotosManifest';
    $versionHash$?: SHA256Hash<VersionNode>;
    id: string;
    entries: Set<SHA256Hash<FotosEntry>>;
    authenticityAttestations?: Set<SHA256Hash<FotosAuthenticityAttestation>>;
}

// ---------------------------------------------------------------------------
// Recipe definitions
// ---------------------------------------------------------------------------

export const FotosEntryRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'FotosEntry',
    rule: [
        {itemprop: 'contentHash', isId: true, itemtype: {type: 'string'}},
        {itemprop: 'streamId', itemtype: {type: 'string'}},
        {itemprop: 'mime', itemtype: {type: 'string'}},
        {itemprop: 'size', itemtype: {type: 'integer'}},
        {itemprop: 'capturedAt', optional: true, itemtype: {type: 'string'}},
        {itemprop: 'updatedAt', optional: true, itemtype: {type: 'string'}},
        {itemprop: 'sourcePath', optional: true, itemtype: {type: 'string'}},
        {itemprop: 'folderPath', optional: true, itemtype: {type: 'string'}},
        {itemprop: 'exifDate', optional: true, itemtype: {type: 'string'}},
        {itemprop: 'exifCamera', optional: true, itemtype: {type: 'string'}},
        {itemprop: 'exifLens', optional: true, itemtype: {type: 'string'}},
        {itemprop: 'exifFocalLength', optional: true, itemtype: {type: 'string'}},
        {itemprop: 'exifAperture', optional: true, itemtype: {type: 'string'}},
        {itemprop: 'exifShutter', optional: true, itemtype: {type: 'string'}},
        {itemprop: 'exifIso', optional: true, itemtype: {type: 'integer'}},
        {itemprop: 'exifGpsLat', optional: true, itemtype: {type: 'number'}},
        {itemprop: 'exifGpsLon', optional: true, itemtype: {type: 'number'}},
        {itemprop: 'exifWidth', optional: true, itemtype: {type: 'integer'}},
        {itemprop: 'exifHeight', optional: true, itemtype: {type: 'integer'}},
        {itemprop: 'thumb', optional: true, itemtype: {type: 'referenceToBlob'}},
        {itemprop: 'faceCount', optional: true, itemtype: {type: 'integer'}},
        {itemprop: 'faceEmbeddings', optional: true, itemtype: {type: 'referenceToBlob'}},
        {itemprop: 'faceCrops', optional: true, itemtype: {type: 'referenceToBlob'}}
    ]
};

export const FotosManifestRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'FotosManifest',
    rule: [
        {
            itemprop: 'id',
            isId: true,
            itemtype: {type: 'string', regexp: /^fotos$/}
        },
        {
            itemprop: 'entries',
            itemtype: {
                type: 'set',
                item: {type: 'referenceToObj', allowedTypes: new Set(['FotosEntry'])}
            }
        },
        {
            itemprop: 'authenticityAttestations',
            optional: true,
            itemtype: {
                type: 'set',
                item: {type: 'referenceToObj', allowedTypes: new Set(['FotosAuthenticityAttestation'])}
            }
        }
    ]
};

export const FotosAuthenticityAttestationRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'FotosAuthenticityAttestation',
    rule: [
        {itemprop: 'id', isId: true, itemtype: {type: 'string'}},
        {itemprop: 'contentHash', itemtype: {type: 'string'}},
        {itemprop: 'signer', itemtype: {type: 'referenceToId', allowedTypes: new Set(['Person'])}},
        {itemprop: 'signerPublicKey', itemtype: {type: 'string'}},
        {itemprop: 'signatureScheme', itemtype: {type: 'string'}},
        {itemprop: 'signature', itemtype: {type: 'string'}},
        {
            itemprop: 'subscriptionCertificate',
            optional: true,
            itemtype: {type: 'referenceToObj', allowedTypes: new Set(['SubscriptionCertificate'])},
        },
    ],
};

export const FotosRecipes: Recipe[] = [
    FotosEntryRecipe,
    FotosManifestRecipe,
    FotosAuthenticityAttestationRecipe,
    ...GalleryTrieRecipes,
];
