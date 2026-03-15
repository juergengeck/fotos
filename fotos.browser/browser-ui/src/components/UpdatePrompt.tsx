import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Shows a banner when a new version of fotos.one is available.
 * Checks on focus, visibility change, and every 2 minutes.
 */

interface BuildVersionInfo {
    buildId?: string;
}

export function UpdatePrompt() {
    const [updating, setUpdating] = useState(false);
    const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
    const [hasWaitingWorker, setHasWaitingWorker] = useState(false);
    const [hasController, setHasController] = useState(() => Boolean(navigator.serviceWorker?.controller));
    const [bootSettled, setBootSettled] = useState(false);
    const [hasNewBuild, setHasNewBuild] = useState(false);

    const currentBuildId = __APP_BUILD_ID__;

    const {
        needRefresh: [needRefresh],
        updateServiceWorker,
    } = useRegisterSW({
        onRegistered(r) { if (r) setRegistration(r); },
        onRegisteredSW(_url, r) { if (r) setRegistration(r); },
        onRegisterError(err) { console.error('[SW] Registration error:', err); },
    });

    useEffect(() => {
        const timer = window.setTimeout(() => setBootSettled(true), 2000);
        return () => window.clearTimeout(timer);
    }, []);

    useEffect(() => {
        if (import.meta.env.DEV) return;

        let cancelled = false;

        const fetchBuildVersion = async () => {
            try {
                const response = await fetch(`/version.json?ts=${Date.now()}`, {
                    cache: 'no-store',
                });
                if (!response.ok) {
                    return;
                }
                const result = await response.json() as BuildVersionInfo;
                if (cancelled || typeof result.buildId !== 'string') {
                    return;
                }
                setHasNewBuild(result.buildId !== currentBuildId);
            } catch {
                // Keep the last known update state when the network flakes out.
            }
        };

        const checkWaiting = () => setHasWaitingWorker(Boolean(registration?.waiting));
        const triggerCheck = () => {
            registration?.update().catch(() => {});
            checkWaiting();
            void fetchBuildVersion();
        };
        const onVisibility = () => { if (!document.hidden) triggerCheck(); };
        const onFocus = () => triggerCheck();
        const onController = () => {
            setHasController(true);
            checkWaiting();
        };

        const initialCheck = window.setTimeout(triggerCheck, 15000);
        const interval = window.setInterval(triggerCheck, 2 * 60 * 1000);
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('focus', onFocus);
        navigator.serviceWorker.addEventListener('controllerchange', onController);

        if (registration) {
            const onUpdateFound = () => {
                const installing = registration.installing;
                if (!installing) return;
                installing.addEventListener('statechange', () => {
                    if (installing.state === 'installed') checkWaiting();
                });
            };

            registration.addEventListener('updatefound', onUpdateFound);
            checkWaiting();
            void fetchBuildVersion();

            return () => {
                cancelled = true;
                window.clearTimeout(initialCheck);
                window.clearInterval(interval);
                registration.removeEventListener('updatefound', onUpdateFound);
                document.removeEventListener('visibilitychange', onVisibility);
                window.removeEventListener('focus', onFocus);
                navigator.serviceWorker.removeEventListener('controllerchange', onController);
            };
        }

        return () => {
            cancelled = true;
            window.clearTimeout(initialCheck);
            window.clearInterval(interval);
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('focus', onFocus);
            navigator.serviceWorker.removeEventListener('controllerchange', onController);
        };
    }, [currentBuildId, registration]);

    const showPrompt = !import.meta.env.DEV
        && bootSettled
        && (((hasController && (needRefresh || hasWaitingWorker))) || hasNewBuild);

    if (!showPrompt) return null;

    return (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[9999] pointer-events-auto flex items-center gap-3 px-5 py-3 rounded-xl bg-black/80 backdrop-blur-md text-white text-sm shadow-lg border border-white/10 max-w-[calc(100vw-2rem)]">
            <span className="flex-1">{updating ? 'Updating...' : 'New version available'}</span>
            <button
                type="button"
                disabled={updating}
                onClick={async () => {
                    setUpdating(true);
                    await registration?.update().catch(() => {});

                    if (registration?.waiting) {
                        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
                        await updateServiceWorker(true);
                        window.setTimeout(() => window.location.reload(), 5000);
                        return;
                    }

                    window.location.reload();
                }}
                className={`touch-manipulation px-4 py-1.5 rounded-lg font-semibold text-xs whitespace-nowrap ${
                    updating
                        ? 'bg-white/20 cursor-wait'
                        : 'bg-[#e94560] hover:bg-[#d13354] cursor-pointer'
                }`}
            >
                {updating ? 'Updating...' : 'Update'}
            </button>
        </div>
    );
}
