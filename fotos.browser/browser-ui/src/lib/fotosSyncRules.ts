import { contentRules } from '../../../../../vger/packages/sync.core/dist/rules/default-rules.js';
import { TRUST_LEVEL_ORDER } from '../../../../../one/packages/trust.core/src/types/trust-types.js';
import type { TrustLevel } from '../../../../../one/packages/trust.core/src/types/trust-types.js';

type SyncRule = typeof contentRules extends Map<string, infer Value> ? Value : never;

const MAX_REFERENCE_LENGTH = 256;
const MAX_FOTOS_MANIFEST_ENTRIES = 250_000;
const MAX_FOTOS_ATTESTATIONS = 250_000;
const MAX_MIME_TYPE_LENGTH = 255;
const MAX_PATH_LENGTH = 4_096;
const MAX_EXIF_STRING_LENGTH = 1_024;
const MAX_TIMESTAMP_LENGTH = 128;
const MAX_FACE_COUNT = 10_000;
const MAX_VARIANT_REFS = 1_024;
const MAX_SIGNATURE_SCHEME_LENGTH = 128;
const MAX_PUBLIC_KEY_LENGTH = 256;
const MAX_SIGNATURE_LENGTH = 1_024;
const MAX_MEDIA_ROLE_LENGTH = 64;
const MAX_MEDIA_LABEL_LENGTH = 255;
const MAX_DEVICE_ID_LENGTH = 255;
const MAX_DEVICE_TITLE_LENGTH = 255;

interface SyncContextLike {
    peerTrustLevel: TrustLevel;
}

type ImportedObject = Record<string, unknown>;

function meetsContentTrustFloor(context: SyncContextLike): boolean {
    return TRUST_LEVEL_ORDER[context.peerTrustLevel] >= TRUST_LEVEL_ORDER.low;
}

function isStringWithinBounds(value: unknown, maxLength: number): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function isOptionalStringWithinBounds(value: unknown, maxLength: number): boolean {
    return value === undefined || isStringWithinBounds(value, maxLength);
}

function isOptionalFiniteNumber(value: unknown): boolean {
    return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

function isOptionalNonNegativeNumber(value: unknown): boolean {
    return value === undefined || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}

function isOptionalNonNegativeInteger(value: unknown): boolean {
    return value === undefined
        || (typeof value === 'number' && Number.isInteger(value) && value >= 0);
}

function isOptionalReference(value: unknown): boolean {
    return value === undefined || isStringWithinBounds(value, MAX_REFERENCE_LENGTH);
}

function isStringSetWithinBounds(value: unknown, maxEntries: number, maxLength: number): value is Set<string> {
    if (!(value instanceof Set) || value.size > maxEntries) {
        return false;
    }

    for (const entry of value) {
        if (typeof entry !== 'string' || entry.length === 0 || entry.length > maxLength) {
            return false;
        }
    }

    return true;
}

export function canImportFotosManifest(context: SyncContextLike, obj?: object): boolean {
    if (!meetsContentTrustFloor(context) || !obj) {
        return false;
    }

    const manifest = obj as ImportedObject;

    return manifest.id === 'fotos'
        && isStringSetWithinBounds(
            manifest.entries,
            MAX_FOTOS_MANIFEST_ENTRIES,
            MAX_REFERENCE_LENGTH,
        )
        && (
            manifest.authenticityAttestations === undefined
            || isStringSetWithinBounds(
                manifest.authenticityAttestations,
                MAX_FOTOS_ATTESTATIONS,
                MAX_REFERENCE_LENGTH,
            )
        );
}

export function canImportFotosEntry(context: SyncContextLike, obj?: object): boolean {
    if (!meetsContentTrustFloor(context) || !obj) {
        return false;
    }

    const entry = obj as ImportedObject;
    const faceCount = entry.faceCount;

    return isStringWithinBounds(entry.contentHash, MAX_REFERENCE_LENGTH)
        && isStringWithinBounds(entry.streamId, MAX_REFERENCE_LENGTH)
        && isStringWithinBounds(entry.mime, MAX_MIME_TYPE_LENGTH)
        && isOptionalNonNegativeNumber(entry.size)
        && isOptionalStringWithinBounds(entry.capturedAt, MAX_TIMESTAMP_LENGTH)
        && isOptionalStringWithinBounds(entry.updatedAt, MAX_TIMESTAMP_LENGTH)
        && isOptionalStringWithinBounds(entry.sourcePath, MAX_PATH_LENGTH)
        && isOptionalStringWithinBounds(entry.folderPath, MAX_PATH_LENGTH)
        && isOptionalStringWithinBounds(entry.exifDate, MAX_TIMESTAMP_LENGTH)
        && isOptionalStringWithinBounds(entry.exifCamera, MAX_EXIF_STRING_LENGTH)
        && isOptionalStringWithinBounds(entry.exifLens, MAX_EXIF_STRING_LENGTH)
        && isOptionalStringWithinBounds(entry.exifFocalLength, MAX_EXIF_STRING_LENGTH)
        && isOptionalStringWithinBounds(entry.exifAperture, MAX_EXIF_STRING_LENGTH)
        && isOptionalStringWithinBounds(entry.exifShutter, MAX_EXIF_STRING_LENGTH)
        && isOptionalFiniteNumber(entry.exifIso)
        && isOptionalFiniteNumber(entry.exifGpsLat)
        && isOptionalFiniteNumber(entry.exifGpsLon)
        && isOptionalFiniteNumber(entry.exifWidth)
        && isOptionalFiniteNumber(entry.exifHeight)
        && isOptionalReference(entry.thumb)
        && (
            entry.variants === undefined
            || isStringSetWithinBounds(entry.variants, MAX_VARIANT_REFS, MAX_REFERENCE_LENGTH)
        )
        && (faceCount === undefined
            || (typeof faceCount === 'number'
                && Number.isInteger(faceCount)
                && faceCount >= 0
                && faceCount <= MAX_FACE_COUNT))
        && isOptionalReference(entry.faceEmbeddings)
        && isOptionalReference(entry.faceCrops);
}

export function canImportFotosMediaVariant(context: SyncContextLike, obj?: object): boolean {
    if (!meetsContentTrustFloor(context) || !obj) {
        return false;
    }

    const variant = obj as ImportedObject;

    return isStringWithinBounds(variant.contentHash, MAX_REFERENCE_LENGTH)
        && isStringWithinBounds(variant.family, MAX_REFERENCE_LENGTH)
        && isStringWithinBounds(variant.role, MAX_MEDIA_ROLE_LENGTH)
        && isStringWithinBounds(variant.mime, MAX_MIME_TYPE_LENGTH)
        && isOptionalNonNegativeInteger(variant.byteSize)
        && isOptionalNonNegativeInteger(variant.width)
        && isOptionalNonNegativeInteger(variant.height)
        && isOptionalReference(variant.blob)
        && isOptionalReference(variant.derivedFrom)
        && isOptionalStringWithinBounds(variant.createdAt, MAX_TIMESTAMP_LENGTH)
        && isOptionalStringWithinBounds(variant.label, MAX_MEDIA_LABEL_LENGTH);
}

export function canImportFotosAuthenticityAttestation(context: SyncContextLike, obj?: object): boolean {
    if (!meetsContentTrustFloor(context) || !obj) {
        return false;
    }

    const attestation = obj as ImportedObject;

    return isStringWithinBounds(attestation.id, MAX_PATH_LENGTH)
        && isStringWithinBounds(attestation.contentHash, MAX_REFERENCE_LENGTH)
        && isStringWithinBounds(attestation.signer, MAX_REFERENCE_LENGTH)
        && isStringWithinBounds(attestation.signerPublicKey, MAX_PUBLIC_KEY_LENGTH)
        && isStringWithinBounds(attestation.signatureScheme, MAX_SIGNATURE_SCHEME_LENGTH)
        && isStringWithinBounds(attestation.signature, MAX_SIGNATURE_LENGTH)
        && isOptionalReference(attestation.subscriptionCertificate);
}

export function canImportFotosDeviceBook(context: SyncContextLike, obj?: object): boolean {
    if (!meetsContentTrustFloor(context) || !obj) {
        return false;
    }

    const book = obj as ImportedObject;

    return isStringWithinBounds(book.id, MAX_PATH_LENGTH)
        && isStringWithinBounds(book.deviceId, MAX_DEVICE_ID_LENGTH)
        && isStringWithinBounds(book.title, MAX_DEVICE_TITLE_LENGTH)
        && isStringWithinBounds(book.role, MAX_MEDIA_ROLE_LENGTH)
        && isStringSetWithinBounds(book.entries, MAX_FOTOS_MANIFEST_ENTRIES, MAX_REFERENCE_LENGTH)
        && (
            book.sourceIdHashes === undefined
            || isStringSetWithinBounds(book.sourceIdHashes, MAX_VARIANT_REFS, MAX_REFERENCE_LENGTH)
        )
        && (
            book.entryIdHashes === undefined
            || isStringSetWithinBounds(book.entryIdHashes, MAX_VARIANT_REFS, MAX_REFERENCE_LENGTH)
        )
        && (
            book.variants === undefined
            || isStringSetWithinBounds(book.variants, MAX_VARIANT_REFS, MAX_REFERENCE_LENGTH)
        )
        && (
            book.locators === undefined
            || isStringSetWithinBounds(book.locators, MAX_VARIANT_REFS, MAX_REFERENCE_LENGTH)
        )
        && (
            book.authenticityAttestations === undefined
            || isStringSetWithinBounds(
                book.authenticityAttestations,
                MAX_FOTOS_ATTESTATIONS,
                MAX_REFERENCE_LENGTH,
            )
        )
        && isOptionalNonNegativeNumber(book.createdAt)
        && isOptionalNonNegativeNumber(book.updatedAt);
}

const fotosManifestRule: SyncRule = {
    canImport: canImportFotosManifest,
};

const fotosEntryRule: SyncRule = {
    canImport: canImportFotosEntry,
};

const fotosMediaVariantRule: SyncRule = {
    canImport: canImportFotosMediaVariant,
};

const fotosAuthenticityAttestationRule: SyncRule = {
    canImport: canImportFotosAuthenticityAttestation,
};

const fotosDeviceBookRule: SyncRule = {
    canImport: canImportFotosDeviceBook,
};

export const fotosContentRules = new Map(contentRules);
fotosContentRules.set('FotosManifest', fotosManifestRule);
fotosContentRules.set('FotosEntry', fotosEntryRule);
fotosContentRules.set('FotosMediaVariant', fotosMediaVariantRule);
fotosContentRules.set('FotosAuthenticityAttestation', fotosAuthenticityAttestationRule);
fotosContentRules.set('FotosDeviceBook', fotosDeviceBookRule);
