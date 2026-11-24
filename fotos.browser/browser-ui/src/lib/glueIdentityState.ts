import {
    DEFAULT_GLUE_CONNECTION_BINDING_ID,
    getGlueBindingPersonId,
    getGlueConnectionBindings,
    getGlueIdentityProfile,
} from '@glueone/glue.core';

function asTrimmedString(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

export function resolveGluePublicationIdentity(
    values: Record<string, unknown>,
    fallbackPublicationIdentity: string | null = null,
    bindingId = DEFAULT_GLUE_CONNECTION_BINDING_ID,
): string | null {
    return getGlueBindingPersonId(values, bindingId) ?? asTrimmedString(fallbackPublicationIdentity);
}

export function resolveGlueDisplayName(
    values: Record<string, unknown>,
    publicationIdentity: string | null,
): string | null {
    const profile = publicationIdentity
        ? getGlueIdentityProfile(values, publicationIdentity)
        : null;
    const profileDisplayName = asTrimmedString(profile?.displayName);
    return profileDisplayName ?? asTrimmedString(values.glueDisplayName);
}

export function resolveGlueIdentityState(
    values: Record<string, unknown>,
    fallbackPublicationIdentity: string | null = null,
    bindingId = DEFAULT_GLUE_CONNECTION_BINDING_ID,
): {
    publicationIdentity: string | null;
    displayName: string | null;
} {
    const publicationIdentity = resolveGluePublicationIdentity(
        values,
        fallbackPublicationIdentity,
        bindingId,
    );

    return {
        publicationIdentity,
        displayName: resolveGlueDisplayName(values, publicationIdentity),
    };
}

export function requirePreparedGlueIdentity(
    values: Record<string, unknown>,
    expectedPersonId: string,
    bindingId = DEFAULT_GLUE_CONNECTION_BINDING_ID,
): string {
    const normalizedExpectedPersonId = asTrimmedString(expectedPersonId);
    if (!normalizedExpectedPersonId) {
        throw new Error('expectedPersonId is required');
    }

    const persistedPublicationIdentity = asTrimmedString(getGlueConnectionBindings(values)[bindingId]);
    if (values.syncEnabled !== true || persistedPublicationIdentity !== normalizedExpectedPersonId) {
        throw new Error(
            `Prepared Fotos identity mismatch: expected ${normalizedExpectedPersonId}, got ${persistedPublicationIdentity ?? 'none'}`,
        );
    }

    return normalizedExpectedPersonId;
}

// Runtime evidence belongs to the SettingsPlan of the opened, custody-checked store.
const admittedNativeOwners = new WeakMap<object, string>();

/** Feed forward canonical native admission after installation or offline custody validation. */
export function recordAdmittedNativeGlueOwner(settingsPlan: object, personId: string): void {
    if (!/^[a-f0-9]{64}$/.test(personId)) throw new Error('Invalid admitted native Glue owner');
    admittedNativeOwners.set(settingsPlan, personId);
}

/** Keep the admitted native owner through settings edits without granting visitor owners admission. */
export function resolveReusableGlueIdentity(settingsPlan: object, configuredPersonId: string | null, ownerId: string | null): string | null {
    const admittedOwner = admittedNativeOwners.get(settingsPlan);
    if (admittedOwner) {
        if (admittedOwner !== ownerId || (configuredPersonId && configuredPersonId !== admittedOwner)) {
            throw new Error('Configured Glue identity differs from the admitted native owner');
        }
        return admittedOwner;
    }
    return configuredPersonId && configuredPersonId !== ownerId ? configuredPersonId : null;
}
