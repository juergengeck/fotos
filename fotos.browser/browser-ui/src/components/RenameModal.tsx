import {useCallback, useEffect, useId, useRef, useState} from 'react';

export interface RenameModalProps {
    open: boolean;
    title: string;
    label: string;
    initialValue: string;
    submitLabel?: string;
    onSubmit: (value: string) => void;
    onCancel: () => void;
}

export function RenameModal({
    open,
    title,
    label,
    initialValue,
    submitLabel = 'Rename',
    onSubmit,
    onCancel,
}: RenameModalProps) {
    const [value, setValue] = useState(initialValue);
    const dialogRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const previouslyFocusedRef = useRef<HTMLElement | null>(null);
    const titleId = useId();
    const inputId = useId();

    useEffect(() => {
        if (!open) return;
        previouslyFocusedRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        setValue(initialValue);
        const frame = requestAnimationFrame(() => {
            inputRef.current?.focus();
            inputRef.current?.select();
        });
        return () => {
            cancelAnimationFrame(frame);
            const previous = previouslyFocusedRef.current;
            previouslyFocusedRef.current = null;
            if (previous?.isConnected) previous.focus();
        };
    }, [initialValue, open]);

    useEffect(() => {
        if (!open) return;
        const handler = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                onCancel();
            }
        };
        window.addEventListener('keydown', handler, true);
        return () => window.removeEventListener('keydown', handler, true);
    }, [onCancel, open]);

    const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
        if (event.key !== 'Tab') return;
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
            'button, input, [href], select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }, []);

    if (!open) return null;

    const trimmedValue = value.trim();

    return (
        <div
            className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={onCancel}
            role="presentation"
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="w-full max-w-sm rounded-xl border border-white/10 bg-[var(--surface-2,#1a1a1a)] p-5 shadow-2xl"
                onClick={event => event.stopPropagation()}
                onKeyDown={handleKeyDown}
            >
                <h2 id={titleId} className="text-sm font-medium text-[var(--fg,#eee)]">
                    {title}
                </h2>
                <form
                    className="mt-4 space-y-4"
                    onSubmit={event => {
                        event.preventDefault();
                        if (trimmedValue) onSubmit(trimmedValue);
                    }}
                >
                    <div className="space-y-1.5">
                        <label htmlFor={inputId} className="block text-xs text-white/65">
                            {label}
                        </label>
                        <input
                            ref={inputRef}
                            id={inputId}
                            value={value}
                            onChange={event => setValue(event.target.value)}
                            className="min-h-11 w-full rounded-md border border-white/15 bg-black/25 px-3 py-2 text-sm text-white placeholder:text-white/35 focus:border-[var(--accent-primary,#e94560)]"
                        />
                    </div>
                    <div className="flex justify-end gap-2">
                        <button
                            type="button"
                            onClick={onCancel}
                            className="min-h-11 rounded-md border border-white/10 bg-white/5 px-4 py-2 text-xs text-white/65 transition-colors hover:bg-white/10 hover:text-white/85"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={!trimmedValue}
                            className="min-h-11 rounded-md bg-[var(--accent-primary,#e94560)] px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-[var(--accent-primary-hover,#d13354)] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            {submitLabel}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
