import {describe, expect, it} from 'vitest';
import {
    EMPTY_SELECTION_STATE,
    countHiddenSelection,
    selectionReducer,
} from './selectionCoordinator.js';

describe('selectionReducer', () => {
    it('extends an ordered range from the last domain anchor', () => {
        const first = selectionReducer(EMPTY_SELECTION_STATE, {
            type: 'toggle',
            domain: 'photos',
            id: 'b',
            orderedIds: ['a', 'b', 'c', 'd'],
        });
        const ranged = selectionReducer(first, {
            type: 'toggle',
            domain: 'photos',
            id: 'd',
            orderedIds: ['a', 'b', 'c', 'd'],
            range: true,
        });

        expect(ranged.photoIds).toEqual(['b', 'c', 'd']);
        expect(ranged.photoAnchorId).toBe('b');
    });

    it('preserves hidden items until they are explicitly cleared', () => {
        const state = {
            ...EMPTY_SELECTION_STATE,
            photoIds: ['visible-photo', 'hidden-photo'],
            peopleIds: ['hidden-person'],
        };
        expect(countHiddenSelection(state, ['visible-photo'], [])).toEqual({
            photos: 1,
            people: 1,
            total: 2,
        });

        expect(selectionReducer(state, {
            type: 'clear-hidden',
            visiblePhotoIds: ['visible-photo'],
            visiblePeopleIds: [],
        })).toMatchObject({photoIds: ['visible-photo'], peopleIds: []});
    });

    it('reconciles only objects that no longer exist in the active library', () => {
        const state = {
            ...EMPTY_SELECTION_STATE,
            photoIds: ['a', 'b'],
            peopleIds: ['p1', 'p2'],
        };
        expect(selectionReducer(state, {
            type: 'reconcile',
            availablePhotoIds: ['b'],
            availablePeopleIds: ['p2'],
        })).toMatchObject({photoIds: ['b'], peopleIds: ['p2']});
    });
});
