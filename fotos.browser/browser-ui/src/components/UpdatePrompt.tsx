import { useEffect, useState } from 'react';
import {
    applyAppUpdate,
    useServiceWorkerUpdates,
} from '@/lib/serviceWorkerUpdates';

/**
 * Shows a banner when a newer deployed build of fotos.one is available.
 * Worker-only refreshes are applied silently because the service worker no
 * longer owns the app shell.
 */

export function UpdatePrompt() {
    const [updating, setUpdating] = useState(false);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const { hasDeployedBuildUpdate } = useServiceWorkerUpdates();

    useEffect(() => {
        if (hasDeployedBuildUpdate) {
            setStatusMessage(null);
        }
    }, [hasDeployedBuildUpdate]);

    useEffect(() => {
        if (statusMessage === null) {
            return undefined;
        }

        const timeoutId = window.setTimeout(() => {
            setStatusMessage(null);
        }, 4_000);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [statusMessage]);

    const showPrompt = hasDeployedBuildUpdate;
    if (!showPrompt) return null;

    return (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[9999] pointer-events-auto flex items-center gap-3 px-5 py-3 rounded-xl bg-black/80 backdrop-blur-md text-white text-sm shadow-lg border border-white/10 max-w-[calc(100vw-2rem)]">
            <span className="flex-1">{statusMessage ?? 'New version available'}</span>
            <button
                type="button"
                disabled={updating}
                onClick={() => {
                    setUpdating(true);
                    void applyAppUpdate().catch((error) => {
                        console.error('[updates] Failed to apply update:', error);
                        setStatusMessage('Update failed');
                        setUpdating(false);
                    });
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
