import { contentRules } from '@refinio/sync.core/rules/default-rules.js';
import type { TrustLevel } from '@refinio/trust.core/types/trust-types.js';
import {
    buildFotosShareCertificateId,
    buildFotosShareCertificateChainId,
    buildFotosShareManifestId,
} from '@refinio/fotos.core';

type SyncRule = typeof contentRules extends Map<string, infer Value> ? Value : never;

const MAX_REFERENCE_LENGTH = 256;
const MAX_FOTOS_MANIFEST_ENTRIES = 250_000;
const MAX_FOTOS_SNAPSHOT_REFS = 1_000_000;
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
const MAX_MEDIA_LOCATOR_VALUE_LENGTH = 4_096;
const MAX_MEDIA_LOCATOR_KIND_LENGTH = 64;
const MAX_MEDIA_LOCATOR_SCOPE_LENGTH = 64;
const MAX_MEDIA_LOCATOR_PLATFORM_LENGTH = 64;
const FOTOS_SHARE_SCOPE_KINDS = new Set(['gallery', 'collection', 'person']);

interface SyncContextLike {
    peerTrustLevel: TrustLevel;
}

type ImportedObject = Record<string, unknown>;

const rejectedFotosImportKeys = new Set<string>();

function logRejectedFotosImport(type: string, obj?: object): void {
    const value = obj as ImportedObject | undefined;
    const shape = value
        ? Object.keys(value).sort().join(',')
        : 'missing-object';
    const key = `${type}:${shape}`;
    if (rejectedFotosImportKeys.has(key)) return;
    rejectedFotosImportKeys.add(key);
    console.warn(`[fotos.sync] Rejected ${type} import with shape: ${shape}`);
}

function fotosImportRule(
    type: string,
    canImport: (context: SyncContextLike, obj?: object) => boolean,
): SyncRule {
    return {
        canImport: (context, obj) => {
            const allowed = canImport(context, obj);
            if (!allowed) logRejectedFotosImport(type, obj);
            return allowed;
        },
    } as SyncRule;
}

function allowsExplicitFotosShare(context: SyncContextLike): boolean {
    return context.peerTrustLevel !== 'ignore';
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

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: ReadonlySet<string>): boolean {
    return Object.keys(value).every(key => allowedKeys.has(key));
}

function isIdOnlyObject(
    value: ImportedObject,
    allowedKeys: ReadonlySet<string>,
    idKey: string,
    maxLength: number,
): boolean {
    return hasOnlyKeys(value, allowedKeys)
        && isStringWithinBounds(value[idKey], maxLength);
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

function hasValidFotosShareSnapshotClosure(manifest: ImportedObject): boolean {
    if (!isStringSetWithinBounds(
        manifest.snapshotObjects,
        MAX_FOTOS_SNAPSHOT_REFS,
        MAX_REFERENCE_LENGTH,
    ) || !isStringSetWithinBounds(
        manifest.snapshotIds,
        MAX_FOTOS_SNAPSHOT_REFS,
        MAX_REFERENCE_LENGTH,
    )) return false;
    if (manifest.snapshotBlobs !== undefined && !isStringSetWithinBounds(
        manifest.snapshotBlobs,
        MAX_FOTOS_SNAPSHOT_REFS,
        MAX_REFERENCE_LENGTH,
    )) return false;
    if (manifest.snapshotClobs !== undefined && !isStringSetWithinBounds(
        manifest.snapshotClobs,
        MAX_FOTOS_SNAPSHOT_REFS,
        MAX_REFERENCE_LENGTH,
    )) return false;

    const objects = manifest.snapshotObjects;
    const ids = manifest.snapshotIds;
    const blobs = (manifest.snapshotBlobs ?? new Set<string>()) as Set<string>;
    const clobs = (manifest.snapshotClobs ?? new Set<string>()) as Set<string>;
    if (!ids.has(String(manifest.issuer))) return false;
    if (!(manifest.entries instanceof Set)
        || Array.from(manifest.entries).some(entry => !objects.has(String(entry)))) return false;

    const expectedKeys = new Set([
        ...Array.from(objects, hash => `object:${hash}`),
        ...Array.from(ids, hash => `id:${hash}`),
        ...Array.from(blobs, hash => `blob:${hash}`),
        ...Array.from(clobs, hash => `clob:${hash}`),
    ]);
    if (!Array.isArray(manifest.snapshotOrder)
        || manifest.snapshotOrder.length !== expectedKeys.size) return false;
    const seen = new Set<string>();
    for (const value of manifest.snapshotOrder) {
        if (typeof value !== 'string' || !expectedKeys.has(value) || seen.has(value)) return false;
        seen.add(value);
    }
    return true;
}

export function canImportFotosManifest(context: SyncContextLike, obj?: object): boolean {
    if (!allowsExplicitFotosShare(context) || !obj) {
        return false;
    }

    const manifest = obj as ImportedObject;
    if (isIdOnlyObject(manifest, new Set(['$type$', 'id']), 'id', MAX_PATH_LENGTH)) {
        return manifest.id === 'fotos';
    }

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
    if (!allowsExplicitFotosShare(context) || !obj) {
        return false;
    }

    const entry = obj as ImportedObject;
    const faceCount = entry.faceCount;
    if (isIdOnlyObject(entry, new Set(['$type$', 'contentHash']), 'contentHash', MAX_REFERENCE_LENGTH)) {
        return true;
    }

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

export function canImportFotosShareManifest(context: SyncContextLike, obj?: object): boolean {
    if (!allowsExplicitFotosShare(context) || !obj) return false;
    const manifest = obj as ImportedObject;
    if (isIdOnlyObject(manifest, new Set(['$type$', 'id']), 'id', MAX_PATH_LENGTH)) {
        return String(manifest.id).startsWith('fotos-share-manifest:v1:');
    }
    const structurallyValid = isStringWithinBounds(manifest.id, MAX_PATH_LENGTH)
        && String(manifest.id).startsWith('fotos-share-manifest:v1:')
        && isStringWithinBounds(manifest.issuer, MAX_REFERENCE_LENGTH)
        && typeof manifest.scopeKind === 'string'
        && FOTOS_SHARE_SCOPE_KINDS.has(manifest.scopeKind)
        && isStringWithinBounds(manifest.scopeId, MAX_PATH_LENGTH)
        && isStringSetWithinBounds(manifest.entries, MAX_FOTOS_MANIFEST_ENTRIES, MAX_REFERENCE_LENGTH)
        && hasValidFotosShareSnapshotClosure(manifest);
    return structurallyValid && manifest.id === buildFotosShareManifestId(
        String(manifest.issuer),
        {kind: manifest.scopeKind as 'gallery' | 'collection' | 'person', id: String(manifest.scopeId)},
    );
}

export function canImportFotosShareCertificate(context: SyncContextLike, obj?: object): boolean {
    if (!allowsExplicitFotosShare(context) || !obj) return false;
    const certificate = obj as ImportedObject;
    if (isIdOnlyObject(certificate, new Set(['$type$', 'id']), 'id', MAX_PATH_LENGTH)) {
        return String(certificate.id).startsWith('fotos-share-certificate:v1:');
    }
    const statusIsValid = certificate.status === 'active' || certificate.status === 'revoked';
    const lifecycleIsConsistent = certificate.status === 'revoked'
        ? isStringWithinBounds(certificate.revokedAt, MAX_TIMESTAMP_LENGTH)
            && isStringWithinBounds(certificate.revocationReason, MAX_PATH_LENGTH)
        : certificate.revokedAt === undefined && certificate.revocationReason === undefined;
    const structurallyValid = certificate.$version$ === 'v1'
        && isStringWithinBounds(certificate.id, MAX_PATH_LENGTH)
        && String(certificate.id).startsWith('fotos-share-certificate:v1:')
        && isStringWithinBounds(certificate.issuer, MAX_REFERENCE_LENGTH)
        && isStringWithinBounds(certificate.subject, MAX_REFERENCE_LENGTH)
        && typeof certificate.scopeKind === 'string'
        && FOTOS_SHARE_SCOPE_KINDS.has(certificate.scopeKind)
        && isStringWithinBounds(certificate.scopeId, MAX_PATH_LENGTH)
        && statusIsValid
        && isStringWithinBounds(certificate.issuedAt, MAX_TIMESTAMP_LENGTH)
        && lifecycleIsConsistent;
    return structurallyValid && certificate.id === buildFotosShareCertificateId(
        String(certificate.issuer),
        String(certificate.subject),
        {kind: certificate.scopeKind as 'gallery' | 'collection' | 'person', id: String(certificate.scopeId)},
    );
}

export function canImportFotosShareCertificateChain(context: SyncContextLike, obj?: object): boolean {
    if (!allowsExplicitFotosShare(context) || !obj) return false;
    const chain = obj as ImportedObject;
    if (isIdOnlyObject(chain, new Set(['$type$', 'id']), 'id', MAX_PATH_LENGTH)) {
        return String(chain.id).startsWith('fotos-share-certificate-chain:v1:');
    }
    const structurallyValid = chain.$version$ === 'v1'
        && isStringWithinBounds(chain.id, MAX_PATH_LENGTH)
        && isStringWithinBounds(chain.issuer, MAX_REFERENCE_LENGTH)
        && isStringWithinBounds(chain.subject, MAX_REFERENCE_LENGTH)
        && typeof chain.scopeKind === 'string'
        && FOTOS_SHARE_SCOPE_KINDS.has(chain.scopeKind)
        && isStringWithinBounds(chain.scopeId, MAX_PATH_LENGTH)
        && isStringWithinBounds(chain.certificate, MAX_REFERENCE_LENGTH)
        && isStringWithinBounds(chain.signature, MAX_REFERENCE_LENGTH);
    return structurallyValid && chain.id === buildFotosShareCertificateChainId(
        String(chain.issuer),
        String(chain.subject),
        {kind: chain.scopeKind as 'gallery' | 'collection' | 'person', id: String(chain.scopeId)},
    );
}

export function canImportFotosMediaVariant(context: SyncContextLike, obj?: object): boolean {
    if (!allowsExplicitFotosShare(context) || !obj) {
        return false;
    }

    const variant = obj as ImportedObject;
    if (isIdOnlyObject(variant, new Set(['$type$', 'contentHash']), 'contentHash', MAX_REFERENCE_LENGTH)) {
        return true;
    }

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
    if (!allowsExplicitFotosShare(context) || !obj) {
        return false;
    }

    const attestation = obj as ImportedObject;
    if (isIdOnlyObject(attestation, new Set(['$type$', 'id']), 'id', MAX_PATH_LENGTH)) {
        return true;
    }

    return isStringWithinBounds(attestation.id, MAX_PATH_LENGTH)
        && isStringWithinBounds(attestation.contentHash, MAX_REFERENCE_LENGTH)
        && isStringWithinBounds(attestation.signer, MAX_REFERENCE_LENGTH)
        && isStringWithinBounds(attestation.signerPublicKey, MAX_PUBLIC_KEY_LENGTH)
        && isStringWithinBounds(attestation.signatureScheme, MAX_SIGNATURE_SCHEME_LENGTH)
        && isStringWithinBounds(attestation.signature, MAX_SIGNATURE_LENGTH)
        && isOptionalReference(attestation.subscriptionCertificate);
}

export function canImportFotosDeviceBook(context: SyncContextLike, obj?: object): boolean {
    if (!allowsExplicitFotosShare(context) || !obj) {
        return false;
    }

    const book = obj as ImportedObject;
    if (isIdOnlyObject(book, new Set(['$type$', 'id']), 'id', MAX_PATH_LENGTH)) {
        return true;
    }

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

export function canImportFotosMediaLocator(context: SyncContextLike, obj?: object): boolean {
    if (!allowsExplicitFotosShare(context) || !obj) {
        return false;
    }

    const locator = obj as ImportedObject;
    if (isIdOnlyObject(locator, new Set(['$type$', 'id']), 'id', MAX_PATH_LENGTH)) {
        return true;
    }

    return isStringWithinBounds(locator.id, MAX_PATH_LENGTH)
        && isStringWithinBounds(locator.variant, MAX_REFERENCE_LENGTH)
        && isStringWithinBounds(locator.platform, MAX_MEDIA_LOCATOR_PLATFORM_LENGTH)
        && isStringWithinBounds(locator.kind, MAX_MEDIA_LOCATOR_KIND_LENGTH)
        && isStringWithinBounds(locator.scope, MAX_MEDIA_LOCATOR_SCOPE_LENGTH)
        && isStringWithinBounds(locator.locator, MAX_MEDIA_LOCATOR_VALUE_LENGTH)
        && isOptionalStringWithinBounds(locator.deviceId, MAX_DEVICE_ID_LENGTH)
        && isOptionalStringWithinBounds(locator.lastVerifiedAt, MAX_TIMESTAMP_LENGTH);
}

const fotosManifestRule = fotosImportRule('FotosManifest', canImportFotosManifest);
const fotosEntryRule = fotosImportRule('FotosEntry', canImportFotosEntry);
const fotosShareManifestRule = fotosImportRule('FotosShareManifest', canImportFotosShareManifest);
const fotosShareCertificateRule = fotosImportRule('FotosShareCertificate', canImportFotosShareCertificate);
const fotosShareCertificateChainRule = fotosImportRule(
    'FotosShareCertificateChain',
    canImportFotosShareCertificateChain,
);
const fotosMediaVariantRule = fotosImportRule('FotosMediaVariant', canImportFotosMediaVariant);
const fotosAuthenticityAttestationRule = fotosImportRule(
    'FotosAuthenticityAttestation',
    canImportFotosAuthenticityAttestation,
);
const fotosDeviceBookRule = fotosImportRule('FotosDeviceBook', canImportFotosDeviceBook);
const fotosMediaLocatorRule = fotosImportRule('FotosMediaLocator', canImportFotosMediaLocator);

export const fotosContentRules = new Map(contentRules);
fotosContentRules.set('FotosManifest', fotosManifestRule);
fotosContentRules.set('FotosEntry', fotosEntryRule);
fotosContentRules.set('FotosShareManifest', fotosShareManifestRule);
fotosContentRules.set('FotosShareCertificate', fotosShareCertificateRule);
fotosContentRules.set('FotosShareCertificateChain', fotosShareCertificateChainRule);
fotosContentRules.set('FotosMediaVariant', fotosMediaVariantRule);
fotosContentRules.set('FotosMediaLocator', fotosMediaLocatorRule);
fotosContentRules.set('FotosAuthenticityAttestation', fotosAuthenticityAttestationRule);
fotosContentRules.set('FotosDeviceBook', fotosDeviceBookRule);
