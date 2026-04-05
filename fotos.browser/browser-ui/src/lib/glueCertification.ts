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
    const response = await fetchImpl(
        `${apiBase}/api/registration/certByPublicKey/${encodeURIComponent(publicKeyHex)}`,
    );
    if (!response.ok) {
        return {
            certState: 'anchored',
            certValidUntil: null,
            publicKeyHex,
        };
    }

    const body = await response.json().catch(() => null);
    const cert = readCert(body);
    if (cert?.claims?.identity !== expectedIdentity) {
        return {
            certState: 'anchored',
            certValidUntil: null,
            publicKeyHex,
        };
    }

    const validUntil = parseValidUntil(cert?.validUntil);
    if (validUntil !== null && validUntil > now) {
        return {
            certState: 'certified',
            certValidUntil: new Date(validUntil).toLocaleDateString(),
            publicKeyHex,
        };
    }

    return {
        certState: 'anchored',
        certValidUntil: null,
        publicKeyHex,
    };
}
