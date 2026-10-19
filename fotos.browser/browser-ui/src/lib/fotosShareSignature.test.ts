import {describe, expect, it, vi} from 'vitest';
import {createFotosShareSignatureVerifier} from './fotosShareSignature';

describe('Fotos share signature verification', () => {
    it('uses registrar verification when the local trust lookup throws', async () => {
        const signature = {$type$: 'Signature', issuer: 'registered-person'};
        const registered = {verifyRegisteredPersonSignature: vi.fn(async () => true)};
        const verify = createFotosShareSignatureVerifier(
            {verifySignatureWithTrustedKeys: async () => { throw new Error('trust cache unavailable'); }},
            registered,
        );

        await expect(verify(signature)).resolves.toBe(true);
        expect(registered.verifyRegisteredPersonSignature).toHaveBeenCalledWith(signature);
    });

    it('rejects signatures when neither trust source verifies them', async () => {
        const verify = createFotosShareSignatureVerifier(
            {verifySignatureWithTrustedKeys: async () => false},
            {verifyRegisteredPersonSignature: async () => false},
        );

        await expect(verify({$type$: 'Signature', issuer: 'unknown'})).resolves.toBe(false);
    });
});
