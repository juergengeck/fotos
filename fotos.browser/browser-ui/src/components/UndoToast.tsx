import {useEffect} from 'react';
import {RotateCcw, X} from 'lucide-react';

interface UndoToastProps {
    message: string;
    onUndo: () => void;
    onDismiss: () => void;
    elevated?: boolean;
    veryElevated?: boolean;
    durationMs?: number;
}

export function UndoToast({message, onUndo, onDismiss, elevated = false, veryElevated = false, durationMs = 8_000}: UndoToastProps) {
    useEffect(() => {
        const timeoutId = window.setTimeout(onDismiss, durationMs);
        return () => window.clearTimeout(timeoutId);
    }, [durationMs, onDismiss]);

    return (
        <div role="status" aria-live="polite" className={`fixed ${veryElevated ? 'bottom-60' : elevated ? 'bottom-40' : 'bottom-5'} left-1/2 z-[70] flex w-[min(92vw,34rem)] -translate-x-1/2 items-center gap-2 rounded-xl border border-white/15 bg-[#171717]/95 p-2.5 text-xs text-white shadow-2xl backdrop-blur-md`}>
            <span className="min-w-0 flex-1 px-1 text-white/80">{message}</span>
            <button type="button" onClick={onUndo} className="flex min-h-11 items-center gap-2 rounded-md px-3 font-medium text-cyan-100 hover:bg-cyan-500/12"><RotateCcw className="h-4 w-4" />Undo</button>
            <button type="button" onClick={onDismiss} className="flex h-11 w-11 items-center justify-center rounded-md text-white/55 hover:bg-white/10 hover:text-white" aria-label="Dismiss undo message"><X className="h-4 w-4" /></button>
        </div>
    );
}
