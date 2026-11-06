import {beforeEach, describe, expect, it, vi} from 'vitest';
import {ensureIdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {TraceContent} from '@refinio/assembly.core/recipes';

const harness = vi.hoisted(() => ({
  setters: [] as Array<ReturnType<typeof vi.fn>>,
  read: vi.fn(),
}));

vi.mock('react', () => ({
  useState: (initial: unknown) => {
    const setter = vi.fn();
    harness.setters.push(setter);
    return [initial, setter];
  },
  useCallback: (callback: unknown) => callback,
  useEffect: () => undefined,
}));
vi.mock('@refinio/one.core/lib/storage-versioned-objects.js', () => ({
  getObjectByIdObj: harness.read,
}));

import {useMessageTrace} from './useMessageTrace';

beforeEach(() => {
  harness.setters.length = 0;
  harness.read.mockReset();
});

describe('message trace context subjects', () => {
  it('preserves stored identities and pending references without inventing an identity', async () => {
    const idHash = ensureIdHash('a'.repeat(64));
    const trace: TraceContent = {
      $type$: 'TraceContent',
      messageId: 'message',
      timestamp: 100,
      contextInjection: {
        subjects: [
          {idHash, keywords: ['stored']},
          {pendingRef: 'turn:subject:1', keywords: ['pending']},
        ],
        tokenCount: 20,
      },
    };
    harness.read.mockResolvedValue({obj: trace});

    await useMessageTrace('message').refetch();

    expect(harness.setters[0]).toHaveBeenLastCalledWith(expect.objectContaining({
      contextInjection: {
        subjects: [
          {id: idHash, pendingRef: undefined, keywords: ['stored'], description: undefined},
          {id: undefined, pendingRef: 'turn:subject:1', keywords: ['pending'], description: undefined},
        ],
        tokenCount: 20,
      },
    }));
  });
});
