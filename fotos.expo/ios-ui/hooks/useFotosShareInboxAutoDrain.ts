import {useEffect, useSyncExternalStore} from 'react';
import {AppState} from 'react-native';
import {
    getFotosShareInboxAutoDrain,
    type FotosShareInboxAutoDrainRuntime,
    type FotosShareInboxAutoDrainSnapshot,
} from '../services/FotosShareInboxAutoDrain';

/** Mount in the root so returning from a Share Extension drains without opening a tab. */
export function useFotosShareInboxAutoDrain(
    runtime: FotosShareInboxAutoDrainRuntime | null,
    authenticated: boolean,
): void {
    const ownerId = runtime?.ownerId;
    const initialized = runtime?.initialized;
    const supported = runtime?.platformCapabilities.supportsShareInbox;
    useEffect(() => {
        if (!runtime || !authenticated || !initialized || !supported) return;
        const controller = getFotosShareInboxAutoDrain(runtime);
        const subscription = AppState.addEventListener('change', state => {
            void controller.handleAppState(state);
        });
        void controller.activate(AppState.currentState);
        return () => {
            subscription.remove();
            controller.deactivate();
        };
    }, [runtime, authenticated, ownerId, initialized, supported]);
}

/** Runtime diagnostics share the exact controller driven by the root lifecycle hook. */
export function useFotosShareInboxAutoDrainStatus(
    runtime: FotosShareInboxAutoDrainRuntime,
): FotosShareInboxAutoDrainSnapshot {
    const controller = getFotosShareInboxAutoDrain(runtime);
    return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}
