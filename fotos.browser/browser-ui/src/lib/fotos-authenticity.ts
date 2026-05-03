import { nameToIdentity } from '@glueone/glue.core';
import { getInstanceIdHash, getInstanceOwnerIdHash } from '@refinio/one.core/lib/instance.js';
import { sign, ensureSecretSignKey } from '@refinio/one.core/lib/crypto/sign.js';
import { getDefaultKeys, getDefaultSecretKeysAsBase64 } from '@refinio/one.core/lib/keychain/keychain.js';
import { getPublicKeys } from '@refinio/one.core/lib/keychain/key-storage-public.js';
import { storeVersionedObject } from '@refinio/one.core/lib/storage-versioned-objects.js';
import type { Person } from '@refinio/one.core/lib/recipes.js';
import type { SecretSignKey } from '@refinio/one.core/lib/crypto/sign.js';
import type { SHA256Hash, SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import { uint8arrayToHexString } from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';
import { InstanceSettingsStorage, SettingsPlan } from '@refinio/settings.core';
import type { SubscriptionCertificate } from '@refinio/trust.core/recipes';
import { toByteArray as fromBase64 } from 'base64-js';

import { API_BASE } from '../config.js';
import { resolveGlueIdentityState } from './glueIdentityState.js';
import type { FotosAuthenticityAttestation } from '../../../../fotos.core/src/recipes/FotosRecipes.js';
import { FOTOS_AUTHENTICITY_SCHEME } from '../../../../fotos.core/src/recipes/FotosRecipes.js';

export interface FotosAuthenticityContext {
    signerPersonId: SHA256IdHash<Person>;
    signerPublicKey: string;
    secretSignKey: SecretSignKey;
    subscriptionCertificateHash?: SHA256Hash<SubscriptionCertificate>;
}

function readCert(body: any): SubscriptionCertificate | null {
    if (body?.data?.cert) {
        return body.data.cert as SubscriptionCertificate;
    }

    if (body?.cert) {
        return body.cert as SubscriptionCertificate;
    }

    return null;
}

export function buildFotosAuthenticityPayload(contentHash: string): string {
    return `${FOTOS_AUTHENTICITY_SCHEME}:${contentHash}`;
}

export function buildFotosAuthenticityAttestationId(
    contentHash: string,
    signerPersonId: string,
): string {
    return `${FOTOS_AUTHENTICITY_SCHEME}:${signerPersonId}:${contentHash}`;
}

async function resolveSettingsIdentity(): Promise<{
    publicationIdentity: SHA256IdHash<Person> | null;
    displayName: string | null;
}> {
    const instanceIdHash = getInstanceIdHash();
    if (!instanceIdHash) {
        return {
            publicationIdentity: null,
            displayName: null,
        };
    }

    const settingsPlan = new SettingsPlan(new InstanceSettingsStorage({ instanceIdHash }));
    const { values } = await settingsPlan
        .getSection({ moduleId: 'glue' })
        .catch(() => ({ values: {} as Record<string, unknown> }));
    const identityState = resolveGlueIdentityState(values);

    return {
        publicationIdentity: identityState.publicationIdentity as SHA256IdHash<Person> | null,
        displayName: identityState.displayName,
    };
}

async function resolveSubscriptionCertificateHash(options: {
    displayName: string | null;
    signerPublicKey: string;
    fetchImpl?: typeof fetch;
    apiBase?: string;
}): Promise<SHA256Hash<SubscriptionCertificate> | undefined> {
    const trimmedDisplayName = options.displayName?.trim() ?? '';
    if (!trimmedDisplayName) {
        return undefined;
    }

    const response = await (options.fetchImpl ?? fetch)(
        `${options.apiBase ?? API_BASE}/api/registration/certByPublicKey/${encodeURIComponent(options.signerPublicKey)}`,
    ).catch(() => null);
    if (!response?.ok) {
        return undefined;
    }

    const body = await response.json().catch(() => null);
    const cert = readCert(body);
    if (!cert) {
        return undefined;
    }

    if (cert.subjectPublicKey !== options.signerPublicKey) {
        return undefined;
    }

    const expectedIdentity = nameToIdentity(trimmedDisplayName);
    if (cert.claims?.identity !== expectedIdentity) {
        return undefined;
    }

    const stored = await storeVersionedObject(cert as any);
    return stored.hash as SHA256Hash<SubscriptionCertificate>;
}

export async function resolveFotosAuthenticityContext(): Promise<FotosAuthenticityContext | null> {
    const ownerId = getInstanceOwnerIdHash() as SHA256IdHash<Person> | null;
    if (!ownerId) {
        return null;
    }

    const { publicationIdentity, displayName } = await resolveSettingsIdentity();
    const signerPersonId = publicationIdentity && publicationIdentity !== ownerId
        ? publicationIdentity
        : ownerId;
    const { secretSignKey: secretSignKeyBase64 } = await getDefaultSecretKeysAsBase64(signerPersonId);
    const secretSignKey = ensureSecretSignKey(fromBase64(secretSignKeyBase64));
    const keysHash = await getDefaultKeys(signerPersonId);
    const { publicSignKey } = await getPublicKeys(keysHash);
    const signerPublicKey = uint8arrayToHexString(publicSignKey);
    const subscriptionCertificateHash = signerPersonId === publicationIdentity
        ? await resolveSubscriptionCertificateHash({
            displayName,
            signerPublicKey,
        })
        : undefined;

    return {
        signerPersonId,
        signerPublicKey,
        secretSignKey,
        ...(subscriptionCertificateHash ? { subscriptionCertificateHash } : {}),
    };
}

export function createFotosAuthenticityAttestation(
    contentHash: string,
    context: FotosAuthenticityContext,
): FotosAuthenticityAttestation {
    const signature = uint8arrayToHexString(
        sign(
            new TextEncoder().encode(buildFotosAuthenticityPayload(contentHash)),
            context.secretSignKey,
        ),
    );

    return {
        $type$: 'FotosAuthenticityAttestation',
        id: buildFotosAuthenticityAttestationId(contentHash, context.signerPersonId),
        contentHash,
        signer: context.signerPersonId,
        signerPublicKey: context.signerPublicKey,
        signatureScheme: FOTOS_AUTHENTICITY_SCHEME,
        signature,
        ...(context.subscriptionCertificateHash
            ? { subscriptionCertificate: context.subscriptionCertificateHash }
            : {}),
    };
}
