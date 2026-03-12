import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Shows a banner when a new version of fotos.one is available.
 * Checks on focus, visibility change, and every 2 minutes.
 */
export function UpdatePrompt() {
    const [updating, setUpdating] = useState(false);
    const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
    const [hasWaitingWorker, setHasWaitingWorker] = useState(false);

    const {
        needRefresh: [needRefresh],
        updateServiceWorker,
    } = useRegisterSW({
        onRegistered(r) { if (r) setRegistration(r); },
        onRegisteredSW(_url, r) { if (r) setRegistration(r); },
        onRegisterError(err) { console.error('[SW] Registration error:', err); },
    });

    useEffect(() => {
        if (!registration) return;

        const checkWaiting = () => setHasWaitingWorker(Boolean(registration.waiting));

        const triggerCheck = () => {
            registration.update().catch(() => {});
            checkWaiting();
        };

        const onUpdateFound = () => {
            const installing = registration.installing;
            if (!installing) return;
            installing.addEventListener('statechange', () => {
                if (installing.state === 'installed') checkWaiting();
            });
        };

        const onVisibility = () => { if (!document.hidden) triggerCheck(); };
        const onFocus = () => triggerCheck();
        const onController = () => setHasWaitingWorker(false);

        registration.addEventListener('updatefound', onUpdateFound);
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('focus', onFocus);
        navigator.serviceWorker.addEventListener('controllerchange', onController);

        triggerCheck();
        const interval = setInterval(triggerCheck, 2 * 60 * 1000);

        return () => {
            clearInterval(interval);
            registration.removeEventListener('updatefound', onUpdateFound);
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('focus', onFocus);
            navigator.serviceWorker.removeEventListener('controllerchange', onController);
        };
    }, [registration]);

    if (!needRefresh && !hasWaitingWorker) return null;

    return (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[9999] pointer-events-auto flex items-center gap-3 px-5 py-3 rounded-xl bg-black/80 backdrop-blur-md text-white text-sm shadow-lg border border-white/10 max-w-[calc(100vw-2rem)]">
            <span className="flex-1">{updating ? 'Updating...' : 'New version available'}</span>
            <button
                type="button"
                disabled={updating}
                onClick={() => {
                    setUpdating(true);
                    registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
                    updateServiceWorker(true);
                    window.setTimeout(() => window.location.reload(), 5000);
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
