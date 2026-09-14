interface ScopeCommitQueue {
    tail: Promise<void>;
    lastFingerprint: string;
    lastCommit: Promise<unknown>;
}

export interface FotosShareCommitRequest<T> {
    scopeKey: string;
    fingerprint: string;
    previousPersonIds: readonly string[];
    nextPersonIds: readonly string[];
    intent?: 'assignment' | 'refresh';
    operation: (previousPersonIds: readonly string[]) => Promise<T>;
}

interface DesiredScopeState {
    requestToken: symbol | null;
    personIds: readonly string[];
}

function samePersonIds(left: readonly string[], right: readonly string[]): boolean {
    const leftSet = new Set(left);
    const rightSet = new Set(right);
    return leftSet.size === rightSet.size
        && Array.from(leftSet).every(personId => rightSet.has(personId));
}

/**
 * Serialize share publication per scope while coalescing adjacent requests for
 * the same desired state. A repeated fingerprint after a different queued
 * fingerprint remains a distinct commit so the final requested state wins.
 */
export class FotosShareCommitCoordinator {
    private readonly queues = new Map<string, ScopeCommitQueue>();
    private readonly committedPersonIds = new Map<string, readonly string[]>();
    private readonly desiredScopes = new Map<string, DesiredScopeState>();

    commit<T>(request: FotosShareCommitRequest<T>): Promise<T | null> {
        const isRefresh = request.intent === 'refresh';
        const currentDesired = this.desiredScopes.get(request.scopeKey);
        const requestToken = isRefresh ? null : Symbol(request.scopeKey);
        if (isRefresh) {
            if (
                currentDesired
                && !samePersonIds(currentDesired.personIds, request.nextPersonIds)
            ) {
                return Promise.resolve(null);
            }
            if (!currentDesired) {
                this.desiredScopes.set(request.scopeKey, {
                    requestToken: null,
                    personIds: [...request.nextPersonIds],
                });
            }
        } else {
            this.desiredScopes.set(request.scopeKey, {
                requestToken,
                personIds: [...request.nextPersonIds],
            });
        }

        const current = this.queues.get(request.scopeKey);
        if (current?.lastFingerprint === request.fingerprint) {
            return this.trackAssignmentFailure(
                request,
                requestToken,
                current.lastCommit as Promise<T | null>,
            );
        }

        const queue = current ?? {
            tail: Promise.resolve(),
            lastFingerprint: '',
            lastCommit: Promise.resolve(undefined),
        };
        const commit = queue.tail.then(async () => {
            const desired = this.desiredScopes.get(request.scopeKey);
            if (
                isRefresh
                && desired
                && !samePersonIds(desired.personIds, request.nextPersonIds)
            ) {
                return null;
            }
            const previousPersonIds = this.committedPersonIds.get(request.scopeKey)
                ?? request.previousPersonIds;
            const result = await request.operation(previousPersonIds);
            this.committedPersonIds.set(request.scopeKey, [...request.nextPersonIds]);
            return result;
        });
        queue.lastFingerprint = request.fingerprint;
        queue.lastCommit = commit;
        queue.tail = commit.then(
            () => this.release(request.scopeKey, queue, commit),
            () => this.release(request.scopeKey, queue, commit),
        );
        this.queues.set(request.scopeKey, queue);
        return this.trackAssignmentFailure(request, requestToken, commit);
    }

    private trackAssignmentFailure<T>(
        request: FotosShareCommitRequest<T>,
        requestToken: symbol | null,
        commit: Promise<T | null>,
    ): Promise<T | null> {
        if (!requestToken) {
            return commit;
        }
        return commit.catch(error => {
            if (this.desiredScopes.get(request.scopeKey)?.requestToken === requestToken) {
                this.desiredScopes.set(request.scopeKey, {
                    requestToken: null,
                    personIds: [
                        ...(this.committedPersonIds.get(request.scopeKey)
                            ?? request.previousPersonIds),
                    ],
                });
            }
            throw error;
        });
    }

    private release(scopeKey: string, queue: ScopeCommitQueue, commit: Promise<unknown>): void {
        if (this.queues.get(scopeKey) === queue && queue.lastCommit === commit) {
            this.queues.delete(scopeKey);
        }
    }
}
