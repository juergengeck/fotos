import type { Person } from '@refinio/one.core/lib/recipes.js';
import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import { getDefaultKeys } from '@refinio/one.core/lib/keychain/keychain.js';
import { getPublicKeys } from '@refinio/one.core/lib/keychain/key-storage-public.js';
import { uint8arrayToHexString } from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';
import { API_BASE } from '../config.js';
import { toGlueHandle } from './authLoginBridge';

export type GlueCertificationLevel = 'ephemeral' | 'anchored' | 'certified';

export interface GlueCertificationState {
    certState: GlueCertificationLevel;
    certValidUntil: string | null;
    publicKeyHex: string | null;
}

interface ResolveGlueCertificationOptions {
    publicationIdentity: SHA256IdHash<Person> | null;
    displayName: string | null;
    fetchImpl?: typeof fetch;
    apiBase?: string;
    now?: number;
    resolvePublicSignKeyHex?: (personId: SHA256IdHash<Person>) => Promise<string>;
}

const CERTIFICATION_STORAGE_KEY = 'fotos.glue.certifications';

function readSavedCertificates(): Record<string, any> {
    try {
        const saved = JSON.parse(localStorage.getItem(CERTIFICATION_STORAGE_KEY) ?? '{}');
        return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    } catch {
        return {};
    }
}

function saveCertificate(personId: string, cert: unknown): void {
    try {
        const saved = readSavedCertificates();
        if (cert) saved[personId] = cert;
        else delete saved[personId];
        localStorage.setItem(CERTIFICATION_STORAGE_KEY, JSON.stringify(saved));
    } catch {
        // Storage may be disabled; the current login can still complete.
    }
}

function certificateMatches(cert: any, identity: string, publicKeyHex: string, now: number): boolean {
    const validUntil = parseValidUntil(cert?.validUntil);
    return cert?.claims?.identity === identity
        && cert?.subjectPublicKey === publicKeyHex
        && validUntil !== null && validUntil > now;
}

/** Remember the popup result for this local identity, without changing its keys or library. */
export async function rememberGlueCertification(
    personId: SHA256IdHash<Person>,
    displayName: string,
    cert: unknown,
    resolvePublicSignKeyHex = getLocalPublicSignKeyHex,
): Promise<void> {
    const publicKeyHex = await resolvePublicSignKeyHex(personId);
    if (certificateMatches(cert, `${toGlueHandle(displayName)}@glue.one`, publicKeyHex, Date.now())) {
        saveCertificate(personId, cert);
    }
}

export function forgetGlueCertification(personId: SHA256IdHash<Person>): void {
    saveCertificate(personId, null);
}

export async function getLocalPublicSignKeyHex(
    personId: SHA256IdHash<Person>,
): Promise<string> {
    const keysHash = await getDefaultKeys(personId);
    const { publicSignKey } = await getPublicKeys(keysHash);
    return uint8arrayToHexString(publicSignKey);
}

function parseValidUntil(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
}

function readCert(body: any): any | null {
    if (body?.data?.cert) {
        return body.data.cert;
    }

    if (body?.cert) {
        return body.cert;
    }

    return null;
}

export async function resolveGlueCertificationState({
    publicationIdentity,
    displayName,
    fetchImpl = fetch,
    apiBase = API_BASE,
    now = Date.now(),
    resolvePublicSignKeyHex = getLocalPublicSignKeyHex,
}: ResolveGlueCertificationOptions): Promise<GlueCertificationState> {
    const trimmedDisplayName = displayName?.trim() ?? '';
    if (!publicationIdentity || !trimmedDisplayName) {
        return {
            certState: 'ephemeral',
            certValidUntil: null,
            publicKeyHex: null,
        };
    }

    const glueHandle = toGlueHandle(trimmedDisplayName);
    if (!glueHandle) {
        return {
            certState: 'anchored',
            certValidUntil: null,
            publicKeyHex: null,
        };
    }

    let publicKeyHex: string;
    try {
        publicKeyHex = await resolvePublicSignKeyHex(publicationIdentity);
    } catch {
        return {
            certState: 'anchored',
            certValidUntil: null,
            publicKeyHex: null,
        };
    }

    const expectedIdentity = `${glueHandle}@glue.one`;
    const savedCert = readSavedCertificates()[publicationIdentity];
    const savedState: GlueCertificationState = certificateMatches(savedCert, expectedIdentity, publicKeyHex, now)
        ? {
            certState: 'certified',
            certValidUntil: new Date(parseValidUntil(savedCert.validUntil)!).toLocaleDateString(),
            publicKeyHex,
        }
        : { certState: 'anchored', certValidUntil: null, publicKeyHex };

    let response: Response;
    try {
        response = await fetchImpl(
            `${apiBase}/api/registration/certByPublicKey/${encodeURIComponent(publicKeyHex)}`,
        );
    } catch {
        return savedState;
    }
    if (response.status >= 500) return savedState;
    if (!response.ok) {
        forgetGlueCertification(publicationIdentity);
        return {
            certState: 'anchored',
            certValidUntil: null,
            publicKeyHex,
        };
    }

    const body = await response.json().catch(() => null);
    const cert = readCert(body);
    if (cert?.claims?.identity !== expectedIdentity) {
        forgetGlueCertification(publicationIdentity);
        return {
            certState: 'anchored',
            certValidUntil: null,
            publicKeyHex,
        };
    }

    const validUntil = parseValidUntil(cert?.validUntil);
    if (validUntil !== null && validUntil > now) {
        if (certificateMatches(cert, expectedIdentity, publicKeyHex, now)) {
            saveCertificate(publicationIdentity, cert);
        }
        return {
            certState: 'certified',
            certValidUntil: new Date(validUntil).toLocaleDateString(),
            publicKeyHex,
        };
    }

    forgetGlueCertification(publicationIdentity);
    return {
        certState: 'anchored',
        certValidUntil: null,
        publicKeyHex,
    };
}
