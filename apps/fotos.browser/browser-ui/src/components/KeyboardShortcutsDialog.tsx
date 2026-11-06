import {useEffect, useId, useRef} from 'react';
import {X} from 'lucide-react';

interface KeyboardShortcutsDialogProps {
    open: boolean;
    onClose: () => void;
}

const shortcutGroups = [
    {
        title: 'Gallery',
        shortcuts: [
            ['Arrow keys', 'Move between photos'],
            ['Enter', 'Open the focused photo'],
            ['X or Space', 'Select or deselect the focused item'],
            ['Shift + F10', 'Open the focused item menu'],
            ['Escape', 'Clear the current selection'],
        ],
    },
    {
        title: 'Photo viewer',
        shortcuts: [
            ['← / →', 'Previous or next photo'],
            ['F', 'Fit photo to the window'],
            ['1', 'Show at actual size'],
            ['+ / −', 'Zoom in or out'],
            ['R / Shift + R', 'Rotate right or left'],
            ['H / V', 'Flip horizontally or vertically'],
            ['I', 'Show or hide photo details'],
            ['Delete', 'Review deleting the photo'],
            ['Escape', 'Exit full screen, then close the viewer'],
        ],
    },
    {
        title: 'Menus and dialogs',
        shortcuts: [
            ['↑ / ↓', 'Move through menu items'],
            ['Home / End', 'Move to the first or last menu item'],
            ['Enter', 'Choose the focused action'],
            ['Escape', 'Close and return focus'],
        ],
    },
] as const;

export function KeyboardShortcutsDialog({open, onClose}: KeyboardShortcutsDialogProps) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const closeRef = useRef<HTMLButtonElement>(null);
    const previouslyFocusedRef = useRef<HTMLElement | null>(null);
    const titleId = useId();

    useEffect(() => {
        if (!open) return;
        previouslyFocusedRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        const frame = requestAnimationFrame(() => closeRef.current?.focus());
        return () => {
            cancelAnimationFrame(frame);
            const previous = previouslyFocusedRef.current;
            previouslyFocusedRef.current = null;
            if (previous?.isConnected) previous.focus();
        };
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                onClose();
                return;
            }
            if (event.key !== 'Tab') return;
            const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
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
        };
        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [onClose, open]);

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            role="presentation"
            onMouseDown={onClose}
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="max-h-[min(42rem,90vh)] w-full max-w-2xl overflow-y-auto rounded-xl border border-white/10 bg-[#141414] p-5 text-white shadow-2xl"
                onMouseDown={event => event.stopPropagation()}
            >
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <h2 id={titleId} className="text-base font-semibold text-white/90">Keyboard shortcuts</h2>
                        <p className="mt-1 text-xs leading-relaxed text-white/60">Press ? anywhere outside a text field to open this guide.</p>
                    </div>
                    <button
                        ref={closeRef}
                        type="button"
                        onClick={onClose}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white"
                        aria-label="Close keyboard shortcuts"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="mt-5 grid gap-5 sm:grid-cols-2">
                    {shortcutGroups.map(group => (
                        <section key={group.title}>
                            <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-white/55">{group.title}</h3>
                            <dl className="space-y-1.5">
                                {group.shortcuts.map(([keys, description]) => (
                                    <div key={`${group.title}-${keys}`} className="grid min-h-11 grid-cols-[minmax(7.5rem,auto)_1fr] items-center gap-3 rounded-lg bg-white/[0.035] px-3 py-2">
                                        <dt><kbd className="rounded border border-white/15 bg-black/35 px-2 py-1 text-[12px] font-medium text-white/80">{keys}</kbd></dt>
                                        <dd className="text-xs leading-relaxed text-white/65">{description}</dd>
                                    </div>
                                ))}
                            </dl>
                        </section>
                    ))}
                </div>
            </div>
        </div>
    );
}
