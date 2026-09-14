import {describe, expect, it, vi} from 'vitest';

import {FotosShareCommitCoordinator} from './fotosShareCommitCoordinator.js';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return {promise, resolve, reject};
}

function commit<T>(params: {
    coordinator: FotosShareCommitCoordinator;
    scopeKey?: string;
    fingerprint: string;
    previousPersonIds?: readonly string[];
    nextPersonIds?: readonly string[];
    intent?: 'assignment' | 'refresh';
    operation: (previousPersonIds: readonly string[]) => Promise<T>;
}): Promise<T | null> {
    return params.coordinator.commit({
        scopeKey: params.scopeKey ?? 'collection:summer',
        fingerprint: params.fingerprint,
        previousPersonIds: params.previousPersonIds ?? [],
        nextPersonIds: params.nextPersonIds ?? [],
        intent: params.intent,
        operation: params.operation,
    });
}

describe('FotosShareCommitCoordinator', () => {
    it('runs one commit for concurrent requests with the same scope fingerprint', async () => {
        const coordinator = new FotosShareCommitCoordinator();
        const pending = deferred<string>();
        const operation = vi.fn((_previousPersonIds: readonly string[]) => pending.promise);
        const request = {
            coordinator,
            fingerprint: 'members:a,b',
            previousPersonIds: ['a'],
            nextPersonIds: ['a', 'b'],
            operation,
        };

        const first = commit(request);
        const duplicate = commit(request);
        await Promise.resolve();

        expect(operation).toHaveBeenCalledTimes(1);
        expect(operation).toHaveBeenCalledWith(['a']);
        pending.resolve('published');
        await expect(Promise.all([first, duplicate])).resolves.toEqual([
            'published',
            'published',
        ]);
    });

    it('commits changed fingerprints in order without blocking a different scope', async () => {
        const coordinator = new FotosShareCommitCoordinator();
        const firstPending = deferred<string>();
        const order: string[] = [];

        const first = commit({
            coordinator,
            fingerprint: 'members:a',
            nextPersonIds: ['a'],
            operation: async () => {
                order.push('summer:a:start');
                const result = await firstPending.promise;
                order.push('summer:a:end');
                return result;
            },
        });
        const changed = commit({
            coordinator,
            fingerprint: 'members:a,b',
            previousPersonIds: ['a'],
            nextPersonIds: ['a', 'b'],
            operation: async () => {
                order.push('summer:a,b');
                return 'second';
            },
        });
        const otherScope = commit({
            coordinator,
            scopeKey: 'collection:winter',
            fingerprint: 'members:c',
            nextPersonIds: ['c'],
            operation: async () => {
                order.push('winter:c');
                return 'other';
            },
        });
        await Promise.resolve();

        expect(order).toEqual(['summer:a:start', 'winter:c']);
        firstPending.resolve('first');
        await expect(Promise.all([first, changed, otherScope])).resolves.toEqual([
            'first',
            'second',
            'other',
        ]);
        expect(order).toEqual([
            'summer:a:start',
            'winter:c',
            'summer:a:end',
            'summer:a,b',
        ]);
    });

    it('propagates a coalesced failure and retries from the last successful recipients', async () => {
        const coordinator = new FotosShareCommitCoordinator();
        await commit({
            coordinator,
            fingerprint: 'members:a',
            nextPersonIds: ['a'],
            operation: async () => 'initial',
        });

        const pending = deferred<string>();
        const failedPredecessors: Array<readonly string[]> = [];
        const operation = vi.fn((previousPersonIds: readonly string[]) => {
            failedPredecessors.push(previousPersonIds);
            return pending.promise;
        });
        const request = {
            coordinator,
            fingerprint: 'members:b',
            previousPersonIds: ['stale'],
            nextPersonIds: ['b'],
            operation,
        };
        const first = commit(request);
        const duplicate = commit(request);
        const failure = new Error('publication failed');

        pending.reject(failure);
        await expect(first).rejects.toBe(failure);
        await expect(duplicate).rejects.toBe(failure);

        const retryPredecessors: Array<readonly string[]> = [];
        await expect(commit({
            coordinator,
            fingerprint: 'members:b',
            previousPersonIds: ['stale'],
            nextPersonIds: ['b'],
            operation: async previousPersonIds => {
                retryPredecessors.push(previousPersonIds);
                return 'retried';
            },
        })).resolves.toBe('retried');
        expect(operation).toHaveBeenCalledTimes(1);
        expect(failedPredecessors).toEqual([['a']]);
        expect(retryPredecessors).toEqual([['a']]);
    });

    it('does not coalesce a desired state repeated after a different queued state', async () => {
        const coordinator = new FotosShareCommitCoordinator();
        const firstPending = deferred<void>();
        const transitions: string[] = [];
        const publish = (
            fingerprint: string,
            nextPersonId: string,
            hold?: Promise<void>,
        ) => commit({
            coordinator,
            fingerprint,
            previousPersonIds: [],
            nextPersonIds: [nextPersonId],
            operation: async previousPersonIds => {
                if (hold) {
                    await hold;
                }
                transitions.push(`${previousPersonIds.join(',')}->${nextPersonId}`);
            },
        });

        const first = publish('members:a', 'a', firstPending.promise);
        const changed = publish('members:b', 'b');
        const latest = publish('members:a', 'a');

        firstPending.resolve();
        await Promise.all([first, changed, latest]);
        expect(transitions).toEqual(['->a', 'a->b', 'b->a']);
    });

    it('restores completed state A from B using B as the actual predecessor', async () => {
        const coordinator = new FotosShareCommitCoordinator();
        const secondPending = deferred<void>();
        const transitions: string[] = [];
        let completedFingerprint: string | null = null;
        const publish = (
            fingerprint: string,
            capturedPreviousPersonIds: readonly string[],
            nextPersonIds: readonly string[],
            hold?: Promise<void>,
        ) => commit({
            coordinator,
            fingerprint,
            previousPersonIds: capturedPreviousPersonIds,
            nextPersonIds,
            operation: async actualPreviousPersonIds => {
                if (completedFingerprint === fingerprint) {
                    return;
                }
                if (hold) {
                    await hold;
                }
                transitions.push(
                    `${actualPreviousPersonIds.join(',')}->${nextPersonIds.join(',')}`,
                );
                completedFingerprint = fingerprint;
            },
        });

        await publish('members:a', [], ['a']);
        const changed = publish('members:b', ['a'], ['b'], secondPending.promise);
        const restoreLatest = publish('members:a', ['a'], ['a']);
        await Promise.resolve();

        expect(completedFingerprint).toBe('members:a');
        secondPending.resolve();
        await Promise.all([changed, restoreLatest]);
        expect(transitions).toEqual(['->a', 'a->b', 'b->a']);
        expect(completedFingerprint).toBe('members:a');
    });

    it('does not let a stale background refresh restore a revoked recipient', async () => {
        const coordinator = new FotosShareCommitCoordinator();
        await commit({
            coordinator,
            fingerprint: 'members:b:content:1',
            nextPersonIds: ['b'],
            operation: async () => 'initial',
        });

        const revokePending = deferred<void>();
        const transitions: string[] = [];
        const revoke = commit({
            coordinator,
            fingerprint: 'members:none:content:1',
            previousPersonIds: ['b'],
            nextPersonIds: [],
            operation: async previousPersonIds => {
                transitions.push(`${previousPersonIds.join(',')}->`);
                await revokePending.promise;
                return 'revoked';
            },
        });
        const staleRefreshOperation = vi.fn(async () => 'restored');
        const staleRefresh = commit({
            coordinator,
            fingerprint: 'members:b:content:2',
            previousPersonIds: ['b'],
            nextPersonIds: ['b'],
            intent: 'refresh',
            operation: staleRefreshOperation,
        });

        await expect(staleRefresh).resolves.toBeNull();
        expect(staleRefreshOperation).not.toHaveBeenCalled();
        revokePending.resolve();
        await expect(revoke).resolves.toBe('revoked');
        expect(transitions).toEqual(['b->']);
    });

    it('allows content refresh for current recipients and restores refresh after assignment failure', async () => {
        const coordinator = new FotosShareCommitCoordinator();
        await commit({
            coordinator,
            fingerprint: 'members:b:content:1',
            nextPersonIds: ['b'],
            operation: async () => 'initial',
        });

        const refreshedPredecessors: Array<readonly string[]> = [];
        await expect(commit({
            coordinator,
            fingerprint: 'members:b:content:2',
            previousPersonIds: ['b'],
            nextPersonIds: ['b'],
            intent: 'refresh',
            operation: async previousPersonIds => {
                refreshedPredecessors.push(previousPersonIds);
                return 'refreshed';
            },
        })).resolves.toBe('refreshed');

        const failure = new Error('revoke failed');
        await expect(commit({
            coordinator,
            fingerprint: 'members:none:content:2',
            previousPersonIds: ['b'],
            nextPersonIds: [],
            operation: async () => {
                throw failure;
            },
        })).rejects.toBe(failure);

        await expect(commit({
            coordinator,
            fingerprint: 'members:b:content:3',
            previousPersonIds: ['b'],
            nextPersonIds: ['b'],
            intent: 'refresh',
            operation: async previousPersonIds => {
                refreshedPredecessors.push(previousPersonIds);
                return 'retried refresh';
            },
        })).resolves.toBe('retried refresh');
        expect(refreshedPredecessors).toEqual([['b'], ['b']]);
    });
});
