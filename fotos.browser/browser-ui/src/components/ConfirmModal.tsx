import { useCallback, useEffect, useRef } from 'react';

export interface ConfirmModalProps {
    open: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    isDestructive?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

export function ConfirmModal({
    open,
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    isDestructive = false,
    onConfirm,
    onCancel,
}: ConfirmModalProps) {
    const confirmRef = useRef<HTMLButtonElement>(null);
    const cancelRef = useRef<HTMLButtonElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);
    const titleId = 'confirm-modal-title';

    // Auto-focus the cancel button on open (safer default for destructive actions)
    useEffect(() => {
        if (open) {
            cancelRef.current?.focus();
        }
    }, [open]);

    // Close on Escape
    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                onCancel();
            }
        };
        window.addEventListener('keydown', handler, true);
        return () => window.removeEventListener('keydown', handler, true);
    }, [open, onCancel]);

    // Trap focus within the modal
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key !== 'Tab') return;
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (!focusable || focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
            if (document.activeElement === first) {
                e.preventDefault();
                last.focus();
            }
        } else {
            if (document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
    }, []);

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-[fadeIn_150ms_ease]"
            onClick={onCancel}
            role="presentation"
        >
            {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="w-full max-w-sm mx-4 rounded-xl border border-white/10 bg-[var(--surface-2,#1a1a1a)] p-5 shadow-2xl animate-[fadeIn_150ms_ease]"
                onClick={e => e.stopPropagation()}
                onKeyDown={handleKeyDown}
            >
                <h2
                    id={titleId}
                    className="text-sm font-medium text-[var(--fg,#eee)]"
                >
                    {title}
                </h2>
                <p className="mt-2 text-xs leading-relaxed text-white/50">
                    {message}
                </p>

                <div className="mt-5 flex items-center justify-end gap-2">
                    <button
                        ref={cancelRef}
                        type="button"
                        onClick={onCancel}
                        className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/55 transition-colors hover:bg-white/10 hover:text-white/75"
                    >
                        {cancelLabel}
                    </button>
                    <button
                        ref={confirmRef}
                        type="button"
                        onClick={onConfirm}
                        className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                            isDestructive
                                ? 'bg-[var(--danger,#a44)] text-[var(--danger-fg,#faa)] hover:bg-[#c55]'
                                : 'bg-[var(--accent-primary,#e94560)] text-white hover:bg-[var(--accent-primary-hover,#d13354)]'
                        }`}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
