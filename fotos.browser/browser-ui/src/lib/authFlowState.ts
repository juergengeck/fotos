export type SidebarTabState = 'browse' | 'manage' | 'settings';

interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

const SIDEBAR_TAB_KEY = 'fotos.sidebar.tab';
const AUTHENTICATION_CONTINUATION_KEY = 'fotos.authentication.continuation';

function getSessionStorage(): StorageLike | null {
    try {
        return globalThis.sessionStorage;
    } catch {
        return null;
    }
}

function isSidebarTabState(value: string | null): value is SidebarTabState {
    return value === 'browse' || value === 'manage' || value === 'settings';
}

export function readStoredSidebarTab(storage: StorageLike | null = getSessionStorage()): SidebarTabState | null {
    const value = storage?.getItem(SIDEBAR_TAB_KEY) ?? null;
    return isSidebarTabState(value) ? value : null;
}

export function writeStoredSidebarTab(
    tab: SidebarTabState,
    storage: StorageLike | null = getSessionStorage(),
): void {
    try {
        storage?.setItem(SIDEBAR_TAB_KEY, tab);
    } catch {}
}

export function queueAuthenticationContinuation(storage: StorageLike | null = getSessionStorage()): void {
    try {
        storage?.setItem(SIDEBAR_TAB_KEY, 'settings');
        storage?.setItem(AUTHENTICATION_CONTINUATION_KEY, '1');
    } catch {}
}

export function hasPendingAuthenticationContinuation(
    storage: StorageLike | null = getSessionStorage(),
): boolean {
    return storage?.getItem(AUTHENTICATION_CONTINUATION_KEY) === '1';
}

export function clearPendingAuthenticationContinuation(
    storage: StorageLike | null = getSessionStorage(),
): void {
    try {
        storage?.removeItem(AUTHENTICATION_CONTINUATION_KEY);
    } catch {}
}
