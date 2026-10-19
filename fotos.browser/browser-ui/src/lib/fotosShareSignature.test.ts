import {describe, expect, it, vi} from 'vitest';
import {createFotosShareSignatureVerifier} from './fotosShareSignature';

describe('Fotos share signature verification', () => {
    it('passes the stored signature to native local trust', async () => {
        const signature = {$type$: 'Signature', issuer: 'paired-person'};
        const trusted = {verifySignatureWithTrustedKeys: vi.fn(async () => true)};
        const verify = createFotosShareSignatureVerifier(trusted);

        await expect(verify(signature)).resolves.toBe(true);
        expect(trusted.verifySignatureWithTrustedKeys).toHaveBeenCalledWith(signature);
    });

    it('rejects signatures when native local trust cannot read its evidence', async () => {
        const verify = createFotosShareSignatureVerifier({
            verifySignatureWithTrustedKeys: async () => { throw new Error('trust evidence unavailable'); },
        });

        await expect(verify({$type$: 'Signature', issuer: 'unknown'})).resolves.toBe(false);
    });

    it('rejects signatures without durable native signer admission', async () => {
        const verify = createFotosShareSignatureVerifier({
            verifySignatureWithTrustedKeys: async () => false,
        });

        await expect(verify({$type$: 'Signature', issuer: 'registered-only'})).resolves.toBe(false);
    });
});
