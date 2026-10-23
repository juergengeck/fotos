import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

type BuildVersionInfo = {
    buildId: string;
    builtAt?: string;
};

export type ServiceWorkerSnapshot = {
    needRefresh: boolean;
    hasWaitingWorker: boolean;
    hasDeployedBuildUpdate: boolean;
    remoteBuildId: string | null;
    remoteBuiltAt: string | null;
    registration: ServiceWorkerRegistration | null;
};

type PersistedBuildUpdate = {
    buildId: string;
    builtAt?: string;
};

export const SERVICE_WORKER_RELOAD_PARAM = '__sw_reload__';

const BUILD_METADATA_PATH = '/version.json';
const BUILD_CHECK_INTERVAL_MS = 60 * 1000;
const FOREGROUND_RETRY_DELAYS_MS = [1_500, 4_000, 8_000, 15_000];
const BUILD_UPDATE_STORAGE_KEY = 'fotos.browser.deployed-build-update';
const CURRENT_BUILD_ID = typeof __APP_BUILD_ID__ === 'string' ? __APP_BUILD_ID__ : '';

function didStartFromServiceWorkerReload(): boolean {
    if (typeof window === 'undefined') {
        return false;
    }

    try {
        return new URL(window.location.href).searchParams.has(SERVICE_WORKER_RELOAD_PARAM);
    } catch {
        return false;
    }
}

function didStartFromReloadNavigation(): boolean {
    if (typeof performance === 'undefined') {
        return false;
    }

    const navigationEntries = performance.getEntriesByType?.('navigation');
    const firstNavigationEntry = navigationEntries?.[0] as PerformanceNavigationTiming | undefined;
    if (firstNavigationEntry?.type) {
        return firstNavigationEntry.type === 'reload';
    }

    const legacyNavigation = performance.navigation;
    if (!legacyNavigation) {
        return false;
    }

    return legacyNavigation.type === legacyNavigation.TYPE_RELOAD || legacyNavigation.type === 1;
}

const SHOULD_DEFER_WAITING_WORKER_ACTIVATION_ON_THIS_LOAD = (
    didStartFromServiceWorkerReload()
    || didStartFromReloadNavigation()
);

const listeners = new Set<(snapshot: ServiceWorkerSnapshot) => void>();

let snapshot: ServiceWorkerSnapshot = {
    needRefresh: false,
    hasWaitingWorker: false,
    hasDeployedBuildUpdate: false,
    remoteBuildId: null,
    remoteBuiltAt: null,
    registration: null,
};

let started = false;
let registrationCleanup: (() => void) | null = null;
let globalCleanup: (() => void) | null = null;
let updateServiceWorker: ((reloadPage?: boolean) => Promise<void>) | null = null;
let buildMetadataRequest: Promise<void> | null = null;
let foregroundRetryTimeoutIds: number[] = [];
let silentWaitingWorkerActivation: Promise<void> | null = null;

function emitSnapshot(): void {
    const nextSnapshot = { ...snapshot };
    for (const listener of listeners) {
        listener(nextSnapshot);
    }
}

function setSnapshot(patch: Partial<ServiceWorkerSnapshot>): void {
    let changed = false;
    const nextSnapshot: ServiceWorkerSnapshot = { ...snapshot };

    if (patch.needRefresh !== undefined && nextSnapshot.needRefresh !== patch.needRefresh) {
        nextSnapshot.needRefresh = patch.needRefresh;
        changed = true;
    }

    if (patch.hasWaitingWorker !== undefined && nextSnapshot.hasWaitingWorker !== patch.hasWaitingWorker) {
        nextSnapshot.hasWaitingWorker = patch.hasWaitingWorker;
        changed = true;
    }

    if (
        patch.hasDeployedBuildUpdate !== undefined
        && nextSnapshot.hasDeployedBuildUpdate !== patch.hasDeployedBuildUpdate
    ) {
        nextSnapshot.hasDeployedBuildUpdate = patch.hasDeployedBuildUpdate;
        changed = true;
    }

    if (patch.remoteBuildId !== undefined && nextSnapshot.remoteBuildId !== patch.remoteBuildId) {
        nextSnapshot.remoteBuildId = patch.remoteBuildId;
        changed = true;
    }

    if (patch.remoteBuiltAt !== undefined && nextSnapshot.remoteBuiltAt !== patch.remoteBuiltAt) {
        nextSnapshot.remoteBuiltAt = patch.remoteBuiltAt;
        changed = true;
    }

    if (patch.registration !== undefined && nextSnapshot.registration !== patch.registration) {
        nextSnapshot.registration = patch.registration;
        changed = true;
    }

    if (!changed) {
        return;
    }

    snapshot = nextSnapshot;
    emitSnapshot();
}

function parseBuildMetadata(value: unknown): BuildVersionInfo {
    if (typeof value !== 'object' || value === null) {
        throw new Error('Build metadata must be an object');
    }

    const candidate = value as Partial<Record<keyof BuildVersionInfo, unknown>>;
    if (typeof candidate.buildId !== 'string' || candidate.buildId.length === 0) {
        throw new Error('Build metadata is missing buildId');
    }

    if (candidate.builtAt !== undefined && typeof candidate.builtAt !== 'string') {
        throw new Error('Build metadata builtAt must be a string');
    }

    return {
        buildId: candidate.buildId,
        ...(typeof candidate.builtAt === 'string' ? { builtAt: candidate.builtAt } : {}),
    };
}

function readPersistedBuildUpdate(): PersistedBuildUpdate | null {
    if (typeof window === 'undefined' || !('localStorage' in window)) {
        return null;
    }

    const raw = window.localStorage.getItem(BUILD_UPDATE_STORAGE_KEY);
    if (!raw) {
        return null;
    }

    try {
        const parsed = parseBuildMetadata(JSON.parse(raw));
        return {
            buildId: parsed.buildId,
            ...(parsed.builtAt ? { builtAt: parsed.builtAt } : {}),
        };
    } catch {
        window.localStorage.removeItem(BUILD_UPDATE_STORAGE_KEY);
        return null;
    }
}

function writePersistedBuildUpdate(metadata: PersistedBuildUpdate | null): void {
    if (typeof window === 'undefined' || !('localStorage' in window)) {
        return;
    }

    if (metadata === null) {
        window.localStorage.removeItem(BUILD_UPDATE_STORAGE_KEY);
        return;
    }

    window.localStorage.setItem(BUILD_UPDATE_STORAGE_KEY, JSON.stringify(metadata));
}

function reloadWithCacheBust(): void {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set(SERVICE_WORKER_RELOAD_PARAM, Date.now().toString());
    window.location.replace(nextUrl.toString());
}

function updateWaitingWorkerFlag(registration = snapshot.registration): void {
    setSnapshot({ hasWaitingWorker: Boolean(registration?.waiting) });
}

async function activateWaitingWorkerSilently(
    registration = snapshot.registration,
): Promise<void> {
    if (!registration?.waiting) {
        return;
    }

    if (silentWaitingWorkerActivation) {
        return silentWaitingWorkerActivation;
    }

    silentWaitingWorkerActivation = (async () => {
        try {
            registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
            await updateServiceWorker?.(false);
        } catch (error) {
            console.warn('[SW] Silent waiting-worker activation failed:', error);
        } finally {
            silentWaitingWorkerActivation = null;
        }
    })();

    return silentWaitingWorkerActivation;
}

function reconcileWaitingWorker(registration = snapshot.registration): void {
    updateWaitingWorkerFlag(registration);

    if (!registration?.waiting) {
        return;
    }

    if (snapshot.hasDeployedBuildUpdate) {
        return;
    }

    // The service worker only owns share-target interception and a small set of
    // static assets. A waiting worker by itself is not a user-facing app update.
    // Chrome DevTools "Update on reload" can create a waiting worker on each
    // reload; activating it during that same navigation can bounce the page
    // into a reload loop. Keep the prompt hidden either way, but only promote
    // the worker silently on non-reload page loads.
    setSnapshot({ needRefresh: false });
    if (SHOULD_DEFER_WAITING_WORKER_ACTIVATION_ON_THIS_LOAD) {
        return;
    }
    void activateWaitingWorkerSilently(registration);
}

function buildMetadataUrl(): string {
    const url = new URL(BUILD_METADATA_PATH, window.location.href);
    url.searchParams.set('__build_check__', Date.now().toString());
    return url.toString();
}

function restorePersistedBuildUpdate(): void {
    const metadata = readPersistedBuildUpdate();
    if (!metadata) {
        return;
    }

    const hasDeployedBuildUpdate = metadata.buildId !== CURRENT_BUILD_ID;
    if (!hasDeployedBuildUpdate) {
        writePersistedBuildUpdate(null);
        return;
    }

    setSnapshot({
        remoteBuildId: metadata.buildId,
        remoteBuiltAt: metadata.builtAt ?? null,
        hasDeployedBuildUpdate: true,
    });
}

function isPageVisible(): boolean {
    return typeof document === 'undefined' || document.hidden === false;
}

function clearForegroundRetryTimers(): void {
    if (typeof window === 'undefined') {
        foregroundRetryTimeoutIds = [];
        return;
    }

    for (const timeoutId of foregroundRetryTimeoutIds) {
        window.clearTimeout(timeoutId);
    }
    foregroundRetryTimeoutIds = [];
}

function scheduleForegroundRetryBurst(): void {
    if (typeof window === 'undefined' || isPageVisible() === false) {
        return;
    }

    clearForegroundRetryTimers();
    for (const delayMs of FOREGROUND_RETRY_DELAYS_MS) {
        const timeoutId = window.setTimeout(() => {
            foregroundRetryTimeoutIds = foregroundRetryTimeoutIds.filter(id => id !== timeoutId);
            void requestUpdateState();
        }, delayMs);
        foregroundRetryTimeoutIds.push(timeoutId);
    }
}

async function resolveServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
    if (snapshot.registration) {
        return snapshot.registration;
    }

    try {
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration) {
            rememberRegistration(registration);
        }
        return registration ?? null;
    } catch (error) {
        console.warn('[SW] Failed to resolve registration:', error);
        return null;
    }
}

async function requestServiceWorkerUpdate(registration = snapshot.registration): Promise<void> {
    if (!registration) {
        return;
    }

    if (registration.waiting) {
        reconcileWaitingWorker(registration);
        return;
    }

    try {
        await registration.update();
    } catch (error) {
        console.warn('[SW] Update check failed:', error);
    }

    reconcileWaitingWorker(registration);
}

async function requestBuildMetadataUpdate(): Promise<void> {
    if (typeof window === 'undefined') {
        return;
    }

    if (buildMetadataRequest) {
        return buildMetadataRequest;
    }

    buildMetadataRequest = (async () => {
        try {
            const response = await fetch(buildMetadataUrl(), {
                cache: 'no-store',
                headers: {
                    Accept: 'application/json',
                },
            });

            if (!response.ok) {
                throw new Error(`Build metadata request failed with ${response.status}`);
            }

            const metadata = parseBuildMetadata(await response.json());
            const hasDeployedBuildUpdate = metadata.buildId !== CURRENT_BUILD_ID;
            writePersistedBuildUpdate(hasDeployedBuildUpdate ? metadata : null);
            setSnapshot({
                remoteBuildId: metadata.buildId,
                remoteBuiltAt: metadata.builtAt ?? null,
                hasDeployedBuildUpdate,
            });

            if (!hasDeployedBuildUpdate) {
                reconcileWaitingWorker();
            }

            clearForegroundRetryTimers();
        } catch (error) {
            console.warn('[updates] Build metadata check failed:', error);
            scheduleForegroundRetryBurst();
        } finally {
            buildMetadataRequest = null;
        }
    })();

    return buildMetadataRequest;
}

async function requestUpdateState(): Promise<void> {
    const work: Promise<void>[] = [requestBuildMetadataUpdate()];

    if ('serviceWorker' in navigator) {
        work.push(requestServiceWorkerUpdate());
    }

    await Promise.allSettled(work);
}

function installRegistrationListeners(registration: ServiceWorkerRegistration): void {
    registrationCleanup?.();

    const onUpdateFound = () => {
        const installing = registration.installing;
        if (!installing) {
            return;
        }

        const onStateChange = () => {
            if (installing.state === 'installed') {
                updateWaitingWorkerFlag(registration);
            }
        };

        installing.addEventListener('statechange', onStateChange);
    };

    registration.addEventListener('updatefound', onUpdateFound);
    registrationCleanup = () => {
        registration.removeEventListener('updatefound', onUpdateFound);
        registrationCleanup = null;
    };
}

function installGlobalListeners(): void {
    if (globalCleanup) {
        return;
    }

    const onVisibilityChange = () => {
        if (!document.hidden) {
            void requestUpdateState();
            scheduleForegroundRetryBurst();
        }
    };

    const onFocus = () => {
        void requestUpdateState();
        scheduleForegroundRetryBurst();
    };

    const onPageShow = () => {
        void requestUpdateState();
        scheduleForegroundRetryBurst();
    };

    const onOnline = () => {
        void requestUpdateState();
        scheduleForegroundRetryBurst();
    };

    const onControllerChange = () => {
        setSnapshot({
            needRefresh: false,
            hasWaitingWorker: false,
        });
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('online', onOnline);
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    }

    globalCleanup = () => {
        clearForegroundRetryTimers();
        document.removeEventListener('visibilitychange', onVisibilityChange);
        window.removeEventListener('focus', onFocus);
        window.removeEventListener('pageshow', onPageShow);
        window.removeEventListener('online', onOnline);
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
        }
        globalCleanup = null;
    };
}

function rememberRegistration(registration: ServiceWorkerRegistration | undefined): void {
    if (!registration) {
        return;
    }

    if (snapshot.registration === registration) {
        reconcileWaitingWorker(registration);
        return;
    }

    installRegistrationListeners(registration);
    setSnapshot({ registration });
    reconcileWaitingWorker(registration);
    void requestServiceWorkerUpdate(registration);
}

export function startServiceWorkerUpdates(): void {
    if (started || typeof window === 'undefined') {
        return;
    }

    started = true;
    installGlobalListeners();
    restorePersistedBuildUpdate();

    if ('serviceWorker' in navigator) {
        updateServiceWorker = registerSW({
            immediate: true,
            onNeedRefresh() {
                setSnapshot({ needRefresh: true });
                void resolveServiceWorkerRegistration().then((registration) => {
                    reconcileWaitingWorker(registration);
                });
            },
            onRegistered(registration) {
                rememberRegistration(registration);
            },
            onRegisteredSW(swUrl, registration) {
                console.log('[SW] Registered:', swUrl);
                rememberRegistration(registration);
            },
            onRegisterError(error) {
                console.error('[SW] Registration error:', error);
            },
        });
    }

    void requestBuildMetadataUpdate();
    scheduleForegroundRetryBurst();

    window.setInterval(() => {
        void requestUpdateState();
    }, BUILD_CHECK_INTERVAL_MS);
}

export function subscribeToServiceWorkerUpdates(
    listener: (nextSnapshot: ServiceWorkerSnapshot) => void,
): () => void {
    listeners.add(listener);
    listener(snapshot);
    return () => {
        listeners.delete(listener);
    };
}

export async function applyServiceWorkerUpdate(): Promise<void> {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
        return;
    }

    const registration = await resolveServiceWorkerRegistration();

    if (registration && !registration.waiting) {
        await requestServiceWorkerUpdate(registration);
    }

    registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
    await updateServiceWorker?.(false);
    reloadWithCacheBust();
}

export async function applyAppUpdate(): Promise<void> {
    if (typeof window === 'undefined') {
        return;
    }

    if (!('serviceWorker' in navigator)) {
        if (snapshot.hasDeployedBuildUpdate) {
            reloadWithCacheBust();
        }
        return;
    }

    const registration = await resolveServiceWorkerRegistration();

    if (snapshot.hasDeployedBuildUpdate) {
        if (registration?.waiting || snapshot.needRefresh || snapshot.hasWaitingWorker) {
            registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
            void updateServiceWorker?.(false).catch((error) => {
                console.warn('[SW] Background waiting-worker activation failed during app reload:', error);
            });
        }
        reloadWithCacheBust();
        return;
    }

    if (registration && !registration.waiting) {
        await requestServiceWorkerUpdate(registration);
    }

    if (registration?.waiting || snapshot.needRefresh || snapshot.hasWaitingWorker) {
        await applyServiceWorkerUpdate();
    }
}

export async function checkForAppUpdate(): Promise<ServiceWorkerSnapshot> {
    if (typeof window === 'undefined') {
        return { ...snapshot };
    }

    await requestUpdateState();
    return { ...snapshot };
}

export function useServiceWorkerUpdates(): ServiceWorkerSnapshot {
    const [currentSnapshot, setCurrentSnapshot] = useState<ServiceWorkerSnapshot>(snapshot);

    useEffect(() => {
        startServiceWorkerUpdates();
        return subscribeToServiceWorkerUpdates(setCurrentSnapshot);
    }, []);

    return currentSnapshot;
}
