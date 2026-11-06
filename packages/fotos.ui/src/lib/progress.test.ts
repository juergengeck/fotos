import {describe, expect, it} from 'vitest';
import {resolveProgressDisplay} from './progress.js';

describe('resolveProgressDisplay', () => {
    it('maps known phases and exposes a measured fraction', () => {
        expect(resolveProgressDisplay({phase: 'faces', current: 3, total: 8})).toEqual({
            label: 'Face analytics',
            measured: true,
            percent: 38,
            countLabel: '3/8',
        });
    });

    it('uses indeterminate state when no real total exists', () => {
        expect(resolveProgressDisplay({phase: 'preparing-semantic', current: 0, total: 0})).toEqual({
            label: 'Preparing semantic search',
            measured: false,
            percent: null,
            countLabel: null,
        });
    });

    it('never leaks invalid or unbounded percentages', () => {
        expect(resolveProgressDisplay({phase: 'processing', current: Number.NaN, total: 4}).percent).toBeNull();
        expect(resolveProgressDisplay({phase: 'writing', current: 12, total: 10}).percent).toBe(100);
    });
});
