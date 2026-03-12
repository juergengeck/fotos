import { useEffect, useRef, useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';

function normalizeEditableName(value: string | null | undefined): string {
    const trimmed = value?.trim();
    if (!trimmed || trimmed === 'Unknown') {
        return '';
    }
    return trimmed;
}

interface InlineRenameFieldProps {
    value?: string | null;
    fallback: string;
    placeholder?: string;
    onSubmit: (nextValue: string) => Promise<void> | void;
    labelClassName?: string;
    inputClassName?: string;
    actionClassName?: string;
}

export function InlineRenameField({
    value,
    fallback,
    placeholder = 'Name this person',
    onSubmit,
    labelClassName = 'truncate text-[11px] text-white/75',
    inputClassName = 'min-w-0 flex-1 rounded-md border border-[#e94560]/35 bg-[#1a1115] px-2 py-1 text-[11px] text-white placeholder:text-white/20 focus:border-[#ff9db0]/60 focus:outline-none',
    actionClassName = 'shrink-0 rounded-md p-1 text-white/28 transition-colors hover:text-white/70 focus:outline-none focus-visible:text-white/80',
}: InlineRenameFieldProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [draft, setDraft] = useState(() => normalizeEditableName(value));

    const normalizedValue = normalizeEditableName(value);
    const displayValue = normalizedValue || fallback;

    useEffect(() => {
        if (!editing) {
            setDraft(normalizedValue);
        }
    }, [editing, normalizedValue]);

    useEffect(() => {
        if (!editing) {
            return;
        }
        inputRef.current?.focus();
        inputRef.current?.select();
    }, [editing]);

    const cancel = () => {
        setEditing(false);
        setSaving(false);
        setDraft(normalizedValue);
    };

    const submit = async () => {
        const nextValue = normalizeEditableName(draft);
        if (nextValue === normalizedValue) {
            setEditing(false);
            return;
        }

        setSaving(true);
        try {
            await onSubmit(nextValue);
            setEditing(false);
        } catch (error) {
            console.error('Failed to rename face cluster', error);
        } finally {
            setSaving(false);
        }
    };

    if (editing) {
        return (
            <form
                className="flex min-w-0 items-center gap-1.5"
                onClick={event => event.stopPropagation()}
                onKeyDown={event => {
                    event.stopPropagation();
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        cancel();
                    }
                }}
                onSubmit={event => {
                    event.preventDefault();
                    void submit();
                }}
                onBlur={event => {
                    const relatedTarget = event.relatedTarget;
                    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
                        return;
                    }
                    cancel();
                }}
            >
                <input
                    ref={inputRef}
                    type="text"
                    value={draft}
                    disabled={saving}
                    placeholder={placeholder}
                    className={inputClassName}
                    onChange={event => setDraft(event.target.value)}
                />
                <button
                    type="submit"
                    disabled={saving}
                    className={actionClassName}
                    aria-label="Save name"
                    title="Save name"
                    onKeyDown={event => event.stopPropagation()}
                >
                    <Check className="h-3.5 w-3.5" />
                </button>
                <button
                    type="button"
                    disabled={saving}
                    className={actionClassName}
                    aria-label="Cancel renaming"
                    title="Cancel renaming"
                    onKeyDown={event => event.stopPropagation()}
                    onClick={event => {
                        event.stopPropagation();
                        cancel();
                    }}
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            </form>
        );
    }

    return (
        <div className="flex min-w-0 items-center gap-1.5">
            <div className={labelClassName}>{displayValue}</div>
            <button
                type="button"
                className={actionClassName}
                aria-label="Rename face cluster"
                title="Rename face cluster"
                onKeyDown={event => event.stopPropagation()}
                onClick={event => {
                    event.stopPropagation();
                    setDraft(normalizedValue);
                    setEditing(true);
                }}
            >
                <Pencil className="h-3 w-3" />
            </button>
        </div>
    );
}
