import { describe, expect, it, vi } from 'vitest';

import {
  decidePinProofOutcome,
  submitFotosSharePinProof,
} from './fotosSharePinProof';

const pending = {pin: '4821', attempts: 0, remotePersonId: 'guest-person'};
const expected = {token: 'pair-token-1', sender: 'sender-person', prover: 'guest-person'};
const proof = {
  $type$: 'FotosSharePinProof',
  $version$: 'v1',
  token: 'pair-token-1',
  sender: 'sender-person' as any,
  prover: 'guest-person' as any,
  pin: '4821',
};

describe('decidePinProofOutcome', () => {
  it('grants on the first valid proof from the paired person', () => {
    expect(decidePinProofOutcome(pending, proof, expected)).toBe('grant');
  });

  it('ignores proofs without a pending invitation', () => {
    expect(decidePinProofOutcome(undefined, proof, expected)).toBe('ignore');
  });

  it('ignores proofs for other tokens, senders, or provers', () => {
    expect(decidePinProofOutcome(pending, {...proof, token: 'other'}, expected)).toBe('ignore');
    expect(decidePinProofOutcome(pending, {...proof, sender: 'x' as any}, expected)).toBe('ignore');
    expect(decidePinProofOutcome(pending, {...proof, prover: 'x' as any}, expected)).toBe('ignore');
  });

  it('counts wrong proofs and exhausts the invitation after five', () => {
    const wrong = {...proof, pin: '0000'};
    expect(decidePinProofOutcome({...pending, attempts: 0}, wrong, expected)).toBe('mismatch');
    expect(decidePinProofOutcome({...pending, attempts: 3}, wrong, expected)).toBe('mismatch');
    expect(decidePinProofOutcome({...pending, attempts: 4}, wrong, expected)).toBe('exhausted');
  });
});

describe('submitFotosSharePinProof', () => {
  it('grants sender access before storing so CHUM observes the proof', async () => {
    const order: string[] = [];
    const deps = {
      calculateIdHash: vi.fn(async () => {
        order.push('idHash');
        return 'proof-id-hash';
      }),
      setAccess: vi.fn(async () => {
        order.push('access');
      }),
      storeVersioned: vi.fn(async () => {
        order.push('store');
        return {hash: 'proof-hash'};
      }),
      getProof: vi.fn(),
    };

    const hash = await submitFotosSharePinProof(
      {token: 'pair-token-1', sender: 'sender-person' as any, prover: 'guest-person' as any, pin: '4821'},
      deps as any,
    );

    expect(hash).toBe('proof-hash');
    expect(order).toEqual(['idHash', 'access', 'store']);
    expect(deps.setAccess).toHaveBeenCalledWith([
      expect.objectContaining({id: 'proof-id-hash', person: ['sender-person']}),
    ]);
    expect(deps.storeVersioned).toHaveBeenCalledWith(
      expect.objectContaining({$type$: 'FotosSharePinProof', pin: '4821'}),
    );
  });
});
