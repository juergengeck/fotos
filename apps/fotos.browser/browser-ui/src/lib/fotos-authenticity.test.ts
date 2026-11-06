import { describe, expect, it } from 'vitest';

import {
    buildFotosAuthenticityAttestationId,
    buildFotosAuthenticityPayload,
} from './fotos-authenticity.js';

describe('fotos authenticity helpers', () => {
    it('builds a stable namespaced payload from the content hash', () => {
        expect(buildFotosAuthenticityPayload('photo-hash')).toBe(
            'fotos-authenticity-v1:photo-hash',
        );
    });

    it('builds a deterministic attestation id per signer and content hash', () => {
        expect(buildFotosAuthenticityAttestationId('photo-hash', 'person-1')).toBe(
            'fotos-authenticity-v1:person-1:photo-hash',
        );
    });
});
