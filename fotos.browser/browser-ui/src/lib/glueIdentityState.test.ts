import { describe, expect, it } from 'vitest';
import {
    DEFAULT_GLUE_CONNECTION_BINDING_ID,
    updateGlueIdentityBinding,
    updateGlueIdentityProfile,
} from '@glueone/glue.core';
import {
    resolveGlueDisplayName,
    resolveGlueIdentityState,
    resolveGluePublicationIdentity,
} from './glueIdentityState';

describe('glueIdentityState', () => {
    it('resolves legacy publication identity values', () => {
        const values = {
            publicationIdentity: 'legacy-person-id',
            glueDisplayName: 'Legacy Alice',
        };

        expect(resolveGluePublicationIdentity(values)).toBe('legacy-person-id');
        expect(resolveGlueDisplayName(values, 'legacy-person-id')).toBe('Legacy Alice');
        expect(resolveGlueIdentityState(values)).toEqual({
            publicationIdentity: 'legacy-person-id',
            displayName: 'Legacy Alice',
        });
    });

    it('prefers bound identity registry data when available', () => {
        const baseValues: Record<string, unknown> = {};
        const withBinding = updateGlueIdentityBinding(
            baseValues,
            'bound-person-id',
            DEFAULT_GLUE_CONNECTION_BINDING_ID,
        );
        const withProfile = {
            ...withBinding,
            ...updateGlueIdentityProfile(withBinding, 'bound-person-id', {
                displayName: 'Bound Bob',
            }),
        };

        expect(resolveGlueIdentityState(withProfile)).toEqual({
            publicationIdentity: 'bound-person-id',
            displayName: 'Bound Bob',
        });
    });
});
