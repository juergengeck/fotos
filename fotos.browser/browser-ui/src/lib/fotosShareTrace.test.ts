import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
    getFotosShareTraceSpans,
    resetFotosShareTraceForTests,
    traceFotosSharePhase,
} from './fotosShareTrace.js';

describe('fotos share phase trace', () => {
    beforeEach(() => {
        resetFotosShareTraceForTests();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-12T10:00:00.000Z'));
    });

    afterEach(() => vi.useRealTimers());

    it('records bounded scope timing without operation data', async () => {
        const result = await traceFotosSharePhase(
            {kind: 'collection', id: 'scope-1'},
            'selected-photo-sync',
            async () => {
                vi.setSystemTime(new Date('2026-09-12T10:00:00.125Z'));
                return {secret: 'not retained'};
            },
        );

        expect(result).toEqual({secret: 'not retained'});
        expect(getFotosShareTraceSpans()).toEqual([{
            seq: 1,
            phase: 'selected-photo-sync',
            scopeKind: 'collection',
            scopeId: 'scope-1',
            startedAt: '2026-09-12T10:00:00.000Z',
            finishedAt: '2026-09-12T10:00:00.125Z',
            durationMs: 125,
            outcome: 'success',
        }]);
    });

    it('records an error outcome and rethrows without retaining its message', async () => {
        await expect(traceFotosSharePhase(
            {kind: 'gallery', id: 'main'},
            'manifest-store',
            async () => { throw new Error('sensitive failure detail'); },
        )).rejects.toThrow('sensitive failure detail');

        expect(getFotosShareTraceSpans()).toEqual([
            expect.objectContaining({phase: 'manifest-store', outcome: 'error'}),
        ]);
        expect(JSON.stringify(getFotosShareTraceSpans())).not.toContain('sensitive failure detail');
    });

    it('keeps only the newest one hundred spans', async () => {
        for (let index = 0; index < 105; index += 1) {
            await traceFotosSharePhase(
                {kind: 'collection', id: `scope-${index}`},
                'commit-scope',
                async () => undefined,
            );
        }

        const spans = getFotosShareTraceSpans(500);
        expect(spans).toHaveLength(100);
        expect(spans[0]).toMatchObject({seq: 6, scopeId: 'scope-5'});
        expect(spans[99]).toMatchObject({seq: 105, scopeId: 'scope-104'});
    });

    it('uses the default bounded limit for a non-finite request', async () => {
        for (let index = 0; index < 60; index += 1) {
            await traceFotosSharePhase(
                {kind: 'gallery', id: 'main'},
                'manifest-resolution',
                async () => undefined,
            );
        }

        expect(getFotosShareTraceSpans(Number.NaN)).toHaveLength(50);
    });
});
