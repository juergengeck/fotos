import {describe, expect, it} from 'vitest';
import {fitSparsePhotoSize} from './photoGridLayout.js';

describe('sparse gallery sizing', () => {
    it('enlarges a single result while leaving room for its date header', () => {
        expect(fitSparsePhotoSize([1], 1300, 700, 160)).toBe(668);
    });
    it('fits a few photos across rows', () => {
        const size = fitSparsePhotoSize([4], 1000, 700, 160);
        expect(size).toBe(332);
        expect(size * 2 + 4 + 32).toBeLessThanOrEqual(700);
    });
    it('accounts for separate date groups', () => {
        expect(fitSparsePhotoSize([1, 1], 1000, 700, 160)).toBe(316);
    });
    it('respects manual size and clamps to narrow screens', () => {
        expect(fitSparsePhotoSize([8], 300, 300, 400)).toBe(292);
        expect(fitSparsePhotoSize([8], 1000, 300, 160)).toBe(160);
    });
});
