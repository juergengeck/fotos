import { contentRules } from '@vger/vger.core/modules';
import { TRUST_LEVEL_ORDER } from '@refinio/trust.core/types/trust-types.js';
import type { TrustLevel } from '@refinio/trust.core/types/trust-types.js';

type SyncRule = typeof contentRules extends Map<string, infer Value> ? Value : never;

const MAX_REFERENCE_LENGTH = 256;
const MAX_FOTOS_MANIFEST_ENTRIES = 250_000;
const MAX_MIME_TYPE_LENGTH = 255;
const MAX_PATH_LENGTH = 4_096;
const MAX_EXIF_STRING_LENGTH = 1_024;
const MAX_TIMESTAMP_LENGTH = 128;
const MAX_FACE_COUNT = 10_000;

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
        && (faceCount === undefined
            || (typeof faceCount === 'number'
                && Number.isInteger(faceCount)
                && faceCount >= 0
                && faceCount <= MAX_FACE_COUNT))
        && isOptionalReference(entry.faceEmbeddings)
        && isOptionalReference(entry.faceCrops);
}

const fotosManifestRule: SyncRule = {
    canImport: canImportFotosManifest,
};

const fotosEntryRule: SyncRule = {
    canImport: canImportFotosEntry,
};

export const fotosContentRules = new Map(contentRules);
fotosContentRules.set('FotosManifest', fotosManifestRule);
fotosContentRules.set('FotosEntry', fotosEntryRule);
