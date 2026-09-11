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
