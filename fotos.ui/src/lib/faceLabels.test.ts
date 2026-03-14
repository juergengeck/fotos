import {describe, expect, it} from 'vitest';
import type {FaceInfo} from '../types/fotos.js';
import {summarizeNamedFaces} from './faceLabels.js';

function makeFaces(overrides: Partial<FaceInfo> = {}): FaceInfo {
    return {
        count: 0,
        bboxes: [],
        scores: [],
        embeddings: null,
        crops: [],
        ...overrides,
    };
}

describe('summarizeNamedFaces', () => {
    it('returns a concise label when every detected face is named', () => {
        expect(summarizeNamedFaces(makeFaces({
            count: 3,
            names: ['Alice', 'Bob', 'Alice'],
        }))).toEqual({
            label: 'Alice, Bob',
            fullLabel: 'Alice, Bob',
            names: ['Alice', 'Bob'],
            hiddenCount: 0,
        });
    });

    it('compresses overflow into a +N suffix', () => {
        expect(summarizeNamedFaces(makeFaces({
            count: 3,
            names: ['Alice', 'Bob', 'Charlie'],
        }))).toEqual({
            label: 'Alice, Bob +1',
            fullLabel: 'Alice, Bob, Charlie',
            names: ['Alice', 'Bob', 'Charlie'],
            hiddenCount: 1,
        });
    });

    it('falls back when any face is still unknown', () => {
        expect(summarizeNamedFaces(makeFaces({
            count: 2,
            names: ['Alice', 'Unknown'],
        }))).toBeNull();
        expect(summarizeNamedFaces(makeFaces({
            count: 2,
            names: ['Alice'],
        }))).toBeNull();
    });
});
