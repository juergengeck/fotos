export type SelectionDomain = 'photos' | 'people';

export interface SelectionState {
    photoIds: string[];
    peopleIds: string[];
    photoAnchorId: string | null;
    peopleAnchorId: string | null;
}

export const EMPTY_SELECTION_STATE: SelectionState = {
    photoIds: [],
    peopleIds: [],
    photoAnchorId: null,
    peopleAnchorId: null,
};

export type SelectionAction =
    | {type: 'toggle'; domain: SelectionDomain; id: string; orderedIds: readonly string[]; range?: boolean}
    | {type: 'select-visible'; domain: SelectionDomain; ids: readonly string[]}
    | {type: 'clear-hidden'; visiblePhotoIds: readonly string[]; visiblePeopleIds: readonly string[]}
    | {type: 'reconcile'; availablePhotoIds: readonly string[]; availablePeopleIds: readonly string[]}
    | {type: 'clear'};

function unique(values: readonly string[]): string[] {
    return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)));
}

function applyToggle(
    selectedIds: readonly string[],
    anchorId: string | null,
    id: string,
    orderedIds: readonly string[],
    range: boolean,
): {ids: string[]; anchorId: string | null} {
    if (range && anchorId) {
        const anchorIndex = orderedIds.indexOf(anchorId);
        const targetIndex = orderedIds.indexOf(id);
        if (anchorIndex >= 0 && targetIndex >= 0) {
            const start = Math.min(anchorIndex, targetIndex);
            const end = Math.max(anchorIndex, targetIndex);
            return {
                ids: unique([...selectedIds, ...orderedIds.slice(start, end + 1)]),
                anchorId,
            };
        }
    }

    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return {ids: Array.from(next), anchorId: id};
}

export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
    switch (action.type) {
        case 'toggle': {
            if (action.domain === 'photos') {
                const next = applyToggle(
                    state.photoIds,
                    state.photoAnchorId,
                    action.id,
                    action.orderedIds,
                    action.range === true,
                );
                return {...state, photoIds: next.ids, photoAnchorId: next.anchorId};
            }
            const next = applyToggle(
                state.peopleIds,
                state.peopleAnchorId,
                action.id,
                action.orderedIds,
                action.range === true,
            );
            return {...state, peopleIds: next.ids, peopleAnchorId: next.anchorId};
        }
        case 'select-visible':
            return action.domain === 'photos'
                ? {...state, photoIds: unique([...state.photoIds, ...action.ids])}
                : {...state, peopleIds: unique([...state.peopleIds, ...action.ids])};
        case 'clear-hidden': {
            const visiblePhotos = new Set(action.visiblePhotoIds);
            const visiblePeople = new Set(action.visiblePeopleIds);
            const photoIds = state.photoIds.filter(id => visiblePhotos.has(id));
            const peopleIds = state.peopleIds.filter(id => visiblePeople.has(id));
            return {
                photoIds,
                peopleIds,
                photoAnchorId: state.photoAnchorId && visiblePhotos.has(state.photoAnchorId)
                    ? state.photoAnchorId
                    : null,
                peopleAnchorId: state.peopleAnchorId && visiblePeople.has(state.peopleAnchorId)
                    ? state.peopleAnchorId
                    : null,
            };
        }
        case 'reconcile': {
            const availablePhotos = new Set(action.availablePhotoIds);
            const availablePeople = new Set(action.availablePeopleIds);
            return {
                photoIds: state.photoIds.filter(id => availablePhotos.has(id)),
                peopleIds: state.peopleIds.filter(id => availablePeople.has(id)),
                photoAnchorId: state.photoAnchorId && availablePhotos.has(state.photoAnchorId)
                    ? state.photoAnchorId
                    : null,
                peopleAnchorId: state.peopleAnchorId && availablePeople.has(state.peopleAnchorId)
                    ? state.peopleAnchorId
                    : null,
            };
        }
        case 'clear':
            return EMPTY_SELECTION_STATE;
    }
}

export function countHiddenSelection(
    state: Pick<SelectionState, 'photoIds' | 'peopleIds'>,
    visiblePhotoIds: readonly string[],
    visiblePeopleIds: readonly string[],
): {photos: number; people: number; total: number} {
    const visiblePhotos = new Set(visiblePhotoIds);
    const visiblePeople = new Set(visiblePeopleIds);
    const photos = state.photoIds.filter(id => !visiblePhotos.has(id)).length;
    const people = state.peopleIds.filter(id => !visiblePeople.has(id)).length;
    return {photos, people, total: photos + people};
}
