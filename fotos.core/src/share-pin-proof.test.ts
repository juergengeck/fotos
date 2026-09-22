import {describe, expect, it} from 'vitest';
import {
    FOTOS_SHARE_PIN_MAX_ATTEMPTS,
    buildFotosSharePinProofId,
    createFotosSharePinProof,
    isFotosSharePinFormat,
    verifyFotosSharePinProof,
} from './share-pin-proof.js';

const parties = {
    token: 'pair-token-1',
    sender: 'sender-person' as any,
    prover: 'guest-person' as any,
    pin: '4821',
};

describe('fotos share PIN proof', () => {
    it('accepts only four-digit PINs', () => {
        expect(isFotosSharePinFormat('4821')).toBe(true);
        expect(isFotosSharePinFormat(' 4821 ')).toBe(true);
        expect(isFotosSharePinFormat('482')).toBe(false);
        expect(isFotosSharePinFormat('48210')).toBe(false);
        expect(isFotosSharePinFormat('abcd')).toBe(false);
        expect(isFotosSharePinFormat('')).toBe(false);
    });

    it('builds one stable proof id per token and prover', () => {
        const proof = createFotosSharePinProof(parties);
        expect(proof.id).toBe(buildFotosSharePinProofId(parties.token, parties.prover));
        expect(proof).toMatchObject({
            $type$: 'FotosSharePinProof',
            $version$: 'v1',
            token: parties.token,
            pin: parties.pin,
        });
    });

    it('refuses to create a proof without a four-digit PIN', () => {
        expect(() => createFotosSharePinProof({...parties, pin: '12'})).toThrow(
            'four-digit PIN',
        );
    });

    it('verifies a matching proof and rejects mismatches', () => {
        const proof = createFotosSharePinProof(parties);
        expect(verifyFotosSharePinProof(proof, parties)).toBe(true);
        expect(verifyFotosSharePinProof(proof, {...parties, pin: '0000'})).toBe(false);
        expect(verifyFotosSharePinProof(proof, {...parties, token: 'other-token'})).toBe(false);
        expect(verifyFotosSharePinProof(proof, {...parties, sender: 'impostor' as any})).toBe(false);
        expect(verifyFotosSharePinProof(proof, {...parties, prover: 'impostor' as any})).toBe(false);
    });

    it('tolerates a small number of wrong proofs', () => {
        expect(FOTOS_SHARE_PIN_MAX_ATTEMPTS).toBe(5);
    });
});
