import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type BuildVersionInfo = {
    buildId: string;
    builtAt?: string;
};

const swRegisterMockState = vi.hoisted(() => {
    const state: {
        options?: Parameters<typeof import('virtual:pwa-register').registerSW>[0];
        updateServiceWorkerMock: ReturnType<typeof vi.fn>;
    } = {
        options: undefined,
        updateServiceWorkerMock: vi.fn().mockResolvedValue(undefined),
    };

    const registerSWMock = vi.fn((options = {}) => {
        state.options = options;
        return state.updateServiceWorkerMock;
    });

    return { state, registerSWMock };
});

vi.mock('virtual:pwa-register', () => ({
    registerSW: swRegisterMockState.registerSWMock,
}));

type EventTargetWithProps<T extends object> = EventTarget & T;
const nativeSetTimeout = globalThis.setTimeout;
const nativeClearTimeout = globalThis.clearTimeout;
const nativeSetInterval = globalThis.setInterval;
const nativeClearInterval = globalThis.clearInterval;

type ServiceWorkerHarness = {
    documentMock: Document;
    localStorageMock: {
        getItem: ReturnType<typeof vi.fn>;
        setItem: ReturnType<typeof vi.fn>;
        removeItem: ReturnType<typeof vi.fn>;
    };
    locationReplace: ReturnType<typeof vi.fn>;
    registrationTarget: EventTargetWithProps<{
        waiting: ServiceWorker | null;
        installing: ServiceWorker | null;
        update: ReturnType<typeof vi.fn>;
    }>;
    serviceWorkerTarget: EventTargetWithProps<{
        controller: ServiceWorker | null;
        getRegistration: ReturnType<typeof vi.fn>;
    }>;
    updateCheck: ReturnType<typeof vi.fn>;
    waitingPostMessage: ReturnType<typeof vi.fn>;
    windowMock: Window & typeof globalThis;
};

function createEventTarget<T extends object>(props: T): EventTargetWithProps<T> {
    return Object.assign(new EventTarget(), props);
}

function createHarness(): ServiceWorkerHarness {
    const waitingPostMessage = vi.fn();
    const updateCheck = vi.fn().mockResolvedValue(undefined);
    const locationReplace = vi.fn();
    const storage = new Map<string, string>();
    const localStorageMock = {
        getItem: vi.fn((key: string) => storage.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => {
            storage.set(key, value);
        }),
        removeItem: vi.fn((key: string) => {
            storage.delete(key);
        }),
    };

    const initialController = { scriptURL: '/sw-old.js' } as ServiceWorker;
    const waitingWorker = { postMessage: waitingPostMessage } as unknown as ServiceWorker;
    const registrationTarget = createEventTarget({
        waiting: waitingWorker,
        installing: null as ServiceWorker | null,
        update: updateCheck,
    });

    const serviceWorkerTarget = createEventTarget({
        controller: initialController,
        getRegistration: vi.fn().mockResolvedValue(registrationTarget as unknown as ServiceWorkerRegistration),
    });

    const documentMock = createEventTarget({
        hidden: false,
    }) as Document;

    const windowMock = createEventTarget({
        location: {
            href: 'https://fotos.one/?view=grid',
            replace: locationReplace,
        } as unknown as Location,
        localStorage: localStorageMock,
        setTimeout: nativeSetTimeout.bind(globalThis),
        clearTimeout: nativeClearTimeout.bind(globalThis),
        setInterval: nativeSetInterval.bind(globalThis),
        clearInterval: nativeClearInterval.bind(globalThis),
    }) as unknown as Window & typeof globalThis;

    return {
        documentMock,
        localStorageMock,
        locationReplace,
        registrationTarget,
        serviceWorkerTarget,
        updateCheck,
        waitingPostMessage,
        windowMock,
    };
}

function createBuildMetadataResponse(
    overrides: Partial<BuildVersionInfo> = {},
): Response {
    return {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
            buildId: 'current-build',
            builtAt: '2026-04-05T10:00:00.000Z',
            ...overrides,
        }),
    } as unknown as Response;
}

async function flushPromises(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await vi.dynamicImportSettled();
    await Promise.resolve();
    await Promise.resolve();
}

describe('serviceWorkerUpdates', () => {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');

    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        swRegisterMockState.state.options = undefined;
        swRegisterMockState.state.updateServiceWorkerMock.mockReset().mockResolvedValue(undefined);
        swRegisterMockState.registerSWMock.mockClear();
        Object.defineProperty(globalThis, 'fetch', {
            configurable: true,
            value: vi.fn().mockResolvedValue(createBuildMetadataResponse()),
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.resetModules();

        if (originalWindow === undefined) {
            delete (globalThis as Partial<typeof globalThis>).window;
        } else {
            globalThis.window = originalWindow;
        }

        if (originalDocument === undefined) {
            delete (globalThis as Partial<typeof globalThis>).document;
        } else {
            globalThis.document = originalDocument;
        }

        if (originalNavigator) {
            Object.defineProperty(globalThis, 'navigator', originalNavigator);
        } else {
            delete (globalThis as Partial<typeof globalThis>).navigator;
        }

        if (originalFetch) {
            Object.defineProperty(globalThis, 'fetch', originalFetch);
        } else {
            delete (globalThis as Partial<typeof globalThis>).fetch;
        }
    });

    it('silently activates a waiting worker when the deployed build did not change', async () => {
        const harness = createHarness();
        globalThis.window = harness.windowMock;
        globalThis.document = harness.documentMock;
        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            value: { serviceWorker: harness.serviceWorkerTarget as unknown as ServiceWorkerContainer },
        });

        const serviceWorkerUpdates = await import('./serviceWorkerUpdates');
        const snapshots: ReturnType<typeof serviceWorkerUpdates.useServiceWorkerUpdates>[] = [];
        const unsubscribe = serviceWorkerUpdates.subscribeToServiceWorkerUpdates((nextSnapshot) => {
            snapshots.push(nextSnapshot);
        });

        serviceWorkerUpdates.startServiceWorkerUpdates();
        swRegisterMockState.state.options?.onNeedRefresh?.();
        await flushPromises();
        unsubscribe();

        expect(harness.waitingPostMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
        expect(swRegisterMockState.state.updateServiceWorkerMock).toHaveBeenCalled();
        expect(snapshots.at(-1)).toMatchObject({
            needRefresh: false,
            hasDeployedBuildUpdate: false,
            hasWaitingWorker: true,
        });
    });

    it('does not silently activate a waiting worker on reload-driven page loads', async () => {
        const harness = createHarness();
        const navigationEntriesSpy = vi.spyOn(globalThis.performance, 'getEntriesByType')
            .mockReturnValue([{ type: 'reload' }] as unknown as PerformanceEntryList);
        globalThis.window = harness.windowMock;
        globalThis.document = harness.documentMock;
        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            value: { serviceWorker: harness.serviceWorkerTarget as unknown as ServiceWorkerContainer },
        });

        const serviceWorkerUpdates = await import('./serviceWorkerUpdates');
        const snapshots: ReturnType<typeof serviceWorkerUpdates.useServiceWorkerUpdates>[] = [];
        const unsubscribe = serviceWorkerUpdates.subscribeToServiceWorkerUpdates((nextSnapshot) => {
            snapshots.push(nextSnapshot);
        });

        serviceWorkerUpdates.startServiceWorkerUpdates();
        swRegisterMockState.state.options?.onNeedRefresh?.();
        await flushPromises();
        unsubscribe();
        navigationEntriesSpy.mockRestore();

        expect(harness.waitingPostMessage).not.toHaveBeenCalled();
        expect(swRegisterMockState.state.updateServiceWorkerMock).not.toHaveBeenCalled();
        expect(snapshots.at(-1)).toMatchObject({
            needRefresh: false,
            hasDeployedBuildUpdate: false,
            hasWaitingWorker: true,
        });
    });

    it('marks deployed build updates when the live build id differs from the running bundle', async () => {
        const harness = createHarness();
        const fetchMock = vi.fn().mockResolvedValue(createBuildMetadataResponse({
            buildId: 'next-build',
            builtAt: '2026-04-05T11:00:00.000Z',
        }));

        globalThis.window = harness.windowMock;
        globalThis.document = harness.documentMock;
        Object.defineProperty(globalThis, 'fetch', {
            configurable: true,
            value: fetchMock,
        });
        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            value: { serviceWorker: harness.serviceWorkerTarget as unknown as ServiceWorkerContainer },
        });

        const serviceWorkerUpdates = await import('./serviceWorkerUpdates');
        const snapshots: ReturnType<typeof serviceWorkerUpdates.useServiceWorkerUpdates>[] = [];
        const unsubscribe = serviceWorkerUpdates.subscribeToServiceWorkerUpdates((nextSnapshot) => {
            snapshots.push(nextSnapshot);
        });

        serviceWorkerUpdates.startServiceWorkerUpdates();
        await flushPromises();
        unsubscribe();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toContain('/version.json?__build_check__=');
        expect(fetchMock.mock.calls[0][1]).toMatchObject({
            cache: 'no-store',
            headers: { Accept: 'application/json' },
        });
        expect(snapshots.at(-1)).toMatchObject({
            hasDeployedBuildUpdate: true,
            remoteBuildId: 'next-build',
            remoteBuiltAt: '2026-04-05T11:00:00.000Z',
        });
    });

    it('reloads immediately when a deployed build update exists and no waiting worker is present', async () => {
        const harness = createHarness();
        harness.registrationTarget.waiting = null;

        const fetchMock = vi.fn().mockResolvedValueOnce(createBuildMetadataResponse({
            buildId: 'next-build',
        }));

        globalThis.window = harness.windowMock;
        globalThis.document = harness.documentMock;
        Object.defineProperty(globalThis, 'fetch', {
            configurable: true,
            value: fetchMock,
        });
        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            value: { serviceWorker: harness.serviceWorkerTarget as unknown as ServiceWorkerContainer },
        });

        const serviceWorkerUpdates = await import('./serviceWorkerUpdates');
        serviceWorkerUpdates.startServiceWorkerUpdates();
        await flushPromises();

        await serviceWorkerUpdates.applyAppUpdate();

        expect(harness.updateCheck).toHaveBeenCalledTimes(1);
        expect(harness.waitingPostMessage).not.toHaveBeenCalled();
        expect(swRegisterMockState.state.updateServiceWorkerMock).not.toHaveBeenCalled();
        expect(harness.locationReplace).toHaveBeenCalledTimes(1);
        expect(harness.locationReplace.mock.calls[0][0]).toContain('__sw_reload__=');
    });

    it('does not block a deployed build reload on a hanging waiting-worker activation', async () => {
        const harness = createHarness();
        swRegisterMockState.state.updateServiceWorkerMock.mockImplementation(
            () => new Promise<void>(() => {}),
        );

        const fetchMock = vi.fn().mockResolvedValueOnce(createBuildMetadataResponse({
            buildId: 'next-build',
        }));

        globalThis.window = harness.windowMock;
        globalThis.document = harness.documentMock;
        Object.defineProperty(globalThis, 'fetch', {
            configurable: true,
            value: fetchMock,
        });
        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            value: { serviceWorker: harness.serviceWorkerTarget as unknown as ServiceWorkerContainer },
        });

        const serviceWorkerUpdates = await import('./serviceWorkerUpdates');
        serviceWorkerUpdates.startServiceWorkerUpdates();
        await flushPromises();

        const applyResultPromise = serviceWorkerUpdates.applyAppUpdate().then(
            () => ({ status: 'resolved' as const }),
            (error: unknown) => ({ status: 'rejected' as const, error }),
        );
        await flushPromises();

        const applyResult = await applyResultPromise;
        expect(applyResult.status).toBe('resolved');
        expect(harness.waitingPostMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
        expect(swRegisterMockState.state.updateServiceWorkerMock).toHaveBeenCalled();
        expect(harness.locationReplace).toHaveBeenCalledTimes(1);
        expect(harness.locationReplace.mock.calls[0][0]).toContain('__sw_reload__=');
    });

    it('rehydrates a previously detected deployed build update before the next metadata poll completes', async () => {
        const harness = createHarness();
        harness.localStorageMock.setItem(
            'fotos.browser.deployed-build-update',
            JSON.stringify({
                buildId: 'next-build',
                builtAt: '2026-04-05T11:00:00.000Z',
            }),
        );

        globalThis.window = harness.windowMock;
        globalThis.document = harness.documentMock;
        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            value: { serviceWorker: harness.serviceWorkerTarget as unknown as ServiceWorkerContainer },
        });

        const serviceWorkerUpdates = await import('./serviceWorkerUpdates');
        const snapshots: ReturnType<typeof serviceWorkerUpdates.useServiceWorkerUpdates>[] = [];
        const unsubscribe = serviceWorkerUpdates.subscribeToServiceWorkerUpdates((nextSnapshot) => {
            snapshots.push(nextSnapshot);
        });

        serviceWorkerUpdates.startServiceWorkerUpdates();
        unsubscribe();

        expect(snapshots.at(-1)).toMatchObject({
            hasDeployedBuildUpdate: true,
            remoteBuildId: 'next-build',
            remoteBuiltAt: '2026-04-05T11:00:00.000Z',
        });
    });

    it('surfaces a newly deployed build when the app manually checks for updates after startup', async () => {
        const harness = createHarness();
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(createBuildMetadataResponse({
                buildId: 'current-build',
            }))
            .mockResolvedValueOnce(createBuildMetadataResponse({
                buildId: 'next-build',
                builtAt: '2026-04-05T11:00:00.000Z',
            }));

        globalThis.window = harness.windowMock;
        globalThis.document = harness.documentMock;
        Object.defineProperty(globalThis, 'fetch', {
            configurable: true,
            value: fetchMock,
        });
        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            value: { serviceWorker: harness.serviceWorkerTarget as unknown as ServiceWorkerContainer },
        });

        const serviceWorkerUpdates = await import('./serviceWorkerUpdates');
        const snapshots: ReturnType<typeof serviceWorkerUpdates.useServiceWorkerUpdates>[] = [];
        const unsubscribe = serviceWorkerUpdates.subscribeToServiceWorkerUpdates((nextSnapshot) => {
            snapshots.push(nextSnapshot);
        });

        serviceWorkerUpdates.startServiceWorkerUpdates();
        await flushPromises();

        expect(snapshots.at(-1)).toMatchObject({
            hasDeployedBuildUpdate: false,
            remoteBuildId: 'current-build',
        });

        const nextSnapshot = await serviceWorkerUpdates.checkForAppUpdate();
        unsubscribe();

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(nextSnapshot).toMatchObject({
            hasDeployedBuildUpdate: true,
            remoteBuildId: 'next-build',
            remoteBuiltAt: '2026-04-05T11:00:00.000Z',
        });
    });
});
