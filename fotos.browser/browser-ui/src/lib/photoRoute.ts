export interface PersistentPhotoRouteTarget {
    photoHash?: string;
}

const PHOTO_QUERY_KEY = 'photo';
const TASK_QUERY_KEY = 'task';
export type PersistentAppTask = 'sharing' | 'settings';

type QueryLike = URLSearchParams | string | Record<string, string>;

function normalizeValue(value: string | null | undefined): string | undefined {
    const normalized = value?.trim();
    return normalized ? normalized : undefined;
}

function toSearchParams(query: QueryLike): URLSearchParams {
    if (typeof query === 'string') {
        const search = query.startsWith('?') ? query.slice(1) : query;
        return new URLSearchParams(search);
    }

    if (query instanceof URLSearchParams) {
        return new URLSearchParams(query);
    }

    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
        params.set(key, value);
    });
    return params;
}

export function parsePersistentPhotoRouteTarget(
    query: QueryLike,
): PersistentPhotoRouteTarget | null {
    const params = toSearchParams(query);
    const photoHash = normalizeValue(params.get(PHOTO_QUERY_KEY));

    if (!photoHash) {
        return null;
    }

    return { photoHash };
}

export function buildPersistentPhotoPath(
    pathname: string,
    query: QueryLike,
    target?: PersistentPhotoRouteTarget | null,
): string {
    const params = toSearchParams(query);
    const photoHash = normalizeValue(target?.photoHash);

    if (photoHash) {
        params.set(PHOTO_QUERY_KEY, photoHash);
    } else {
        params.delete(PHOTO_QUERY_KEY);
    }

    const search = params.toString();
    return search ? `${pathname}?${search}` : pathname;
}

export function arePersistentPhotoRouteTargetsEqual(
    left?: PersistentPhotoRouteTarget | null,
    right?: PersistentPhotoRouteTarget | null,
): boolean {
    return normalizeValue(left?.photoHash) === normalizeValue(right?.photoHash);
}

export function parsePersistentAppTask(query: QueryLike): PersistentAppTask | null {
    const task = normalizeValue(toSearchParams(query).get(TASK_QUERY_KEY));
    return task === 'sharing' || task === 'settings' ? task : null;
}

export function buildPersistentAppTaskPath(
    pathname: string,
    query: QueryLike,
    task?: PersistentAppTask | null,
): string {
    const params = toSearchParams(query);
    if (task) params.set(TASK_QUERY_KEY, task);
    else params.delete(TASK_QUERY_KEY);
    const search = params.toString();
    return search ? `${pathname}?${search}` : pathname;
}
