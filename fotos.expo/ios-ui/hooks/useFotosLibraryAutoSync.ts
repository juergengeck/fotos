import {useEffect, useRef, useSyncExternalStore} from 'react';
import {AppState} from 'react-native';
import {
    getFotosLibraryAutoSync,
    type FotosLibraryAutoSyncRuntime,
    type FotosLibraryAutoSyncSnapshot,
} from '../services/FotosLibraryAutoSync';

/**
 * Mount in the root so granted photo-library access indexes automatically without opening Runtime.
 * Re-renders or remounts never cancel/restart indexing; only actual logout deactivates the controller.
 */
export function useFotosLibraryAutoSync(
    runtime: FotosLibraryAutoSyncRuntime | null,
    authenticated: boolean,
): void {
    const ownerId = runtime?.ownerId;
    const initialized = runtime?.initialized;
    const supported = runtime?.platformCapabilities.supportsPhotoLibrarySync;
    const activeRuntimeRef = useRef<FotosLibraryAutoSyncRuntime | null>(null);

    useEffect(() => {
        if (!runtime || !authenticated || !initialized || !supported) {
            if (!authenticated && activeRuntimeRef.current) {
                getFotosLibraryAutoSync(activeRuntimeRef.current).deactivate();
                activeRuntimeRef.current = null;
            }
            return;
        }
        if (activeRuntimeRef.current && activeRuntimeRef.current !== runtime) {
            getFotosLibraryAutoSync(activeRuntimeRef.current).deactivate();
        }
        activeRuntimeRef.current = runtime;
        const controller = getFotosLibraryAutoSync(runtime);
        const subscription = AppState.addEventListener('change', state => {
            void controller.handleAppState(state);
        });
        void controller.activate(AppState.currentState);
        return () => {
            subscription.remove();
        };
    }, [runtime, authenticated, ownerId, initialized, supported]);
}

/** Library and Runtime tabs subscribe to the same root-owned sync controller. */
export function useFotosLibraryAutoSyncStatus(
    runtime: FotosLibraryAutoSyncRuntime,
): FotosLibraryAutoSyncSnapshot {
    const controller = getFotosLibraryAutoSync(runtime);
    return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}
