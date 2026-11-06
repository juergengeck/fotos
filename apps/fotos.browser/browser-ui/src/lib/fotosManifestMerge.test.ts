import { describe, expect, it } from 'vitest';
import { mergeFotosManifestState } from './fotosManifestMerge';

describe('mergeFotosManifestState', () => {
    it('unions concurrent manifest branches', () => {
        const merged = mergeFotosManifestState(
            {
                entries: new Set(['entry-a', 'entry-b'] as any[]),
                authenticityAttestations: new Set(['attestation-a'] as any[]),
            },
            {
                entries: new Set(['entry-b', 'entry-c'] as any[]),
                authenticityAttestations: new Set(['attestation-a', 'attestation-b'] as any[]),
            },
        );

        expect(merged.changed).toBe(true);
        expect(merged.addedEntryCount).toBe(1);
        expect(merged.addedAuthenticityCount).toBe(1);
        expect([...merged.entries]).toEqual(['entry-a', 'entry-b', 'entry-c']);
        expect([...merged.authenticityAttestations]).toEqual(['attestation-a', 'attestation-b']);
    });

    it('stays unchanged when the incoming manifest is a subset', () => {
        const merged = mergeFotosManifestState(
            {
                entries: new Set(['entry-a', 'entry-b'] as any[]),
                authenticityAttestations: new Set(['attestation-a', 'attestation-b'] as any[]),
            },
            {
                entries: new Set(['entry-a'] as any[]),
                authenticityAttestations: new Set(['attestation-a'] as any[]),
            },
        );

        expect(merged.changed).toBe(false);
        expect(merged.addedEntryCount).toBe(0);
        expect(merged.addedAuthenticityCount).toBe(0);
        expect([...merged.entries]).toEqual(['entry-a', 'entry-b']);
        expect([...merged.authenticityAttestations]).toEqual(['attestation-a', 'attestation-b']);
    });
});
