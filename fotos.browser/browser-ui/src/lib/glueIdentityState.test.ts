import { describe, expect, it } from 'vitest';
import {
    DEFAULT_GLUE_CONNECTION_BINDING_ID,
    updateGlueIdentityBinding,
    updateGlueIdentityProfile,
} from '@glueone/glue.core';
import {
    requirePreparedGlueIdentity,
    recordAdmittedNativeGlueOwner,
    resolveReusableGlueIdentity,
    resolveGlueDisplayName,
    resolveGlueIdentityState,
    resolveGluePublicationIdentity,
} from './glueIdentityState';

describe('glueIdentityState', () => {
    it('retains the exact native owner only with admission evidence bound to this runtime', () => {
        const settingsPlan = {};
        const owner = 'a'.repeat(64);
        expect(resolveReusableGlueIdentity(settingsPlan, owner, owner)).toBeNull();
        recordAdmittedNativeGlueOwner(settingsPlan, owner);
        expect(resolveReusableGlueIdentity(settingsPlan, owner, owner)).toBe(owner);
        expect(resolveReusableGlueIdentity(settingsPlan, null, owner)).toBe(owner);
        expect(resolveReusableGlueIdentity({}, owner, owner)).toBeNull();
        expect(() => resolveReusableGlueIdentity(settingsPlan, 'b'.repeat(64), owner)).toThrow('differs from');
        expect(() => resolveReusableGlueIdentity(settingsPlan, owner, 'b'.repeat(64))).toThrow('differs from');
    });

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

    it('validates the prepared identity from persisted Glue settings', () => {
        const values = {
            ...updateGlueIdentityBinding(
                {},
                'prepared-person-id',
                DEFAULT_GLUE_CONNECTION_BINDING_ID,
            ),
            syncEnabled: true,
        };

        expect(requirePreparedGlueIdentity(values, ' prepared-person-id '))
            .toBe('prepared-person-id');
        expect(() => requirePreparedGlueIdentity(values, 'active-old-person-id'))
            .toThrow('expected active-old-person-id, got prepared-person-id');
        expect(() => requirePreparedGlueIdentity({...values, syncEnabled: false}, 'prepared-person-id'))
            .toThrow('expected prepared-person-id, got prepared-person-id');
        expect(() => requirePreparedGlueIdentity({
            publicationIdentity: 'prepared-person-id',
            syncEnabled: true,
        }, 'prepared-person-id')).toThrow('expected prepared-person-id, got none');
    });
});
