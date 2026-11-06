import React, {useCallback, useEffect, useRef} from 'react';
import { Trash2, Share2, CheckCircle, Edit3, X } from 'lucide-react';

interface ContextMenuProps {
    x: number;
    y: number;
    type: 'photo' | 'cluster' | 'collection';
    visible: boolean;
    data: any;
    onClose: () => void;
    mobile: boolean;

    // Photo Actions
    onDeletePhoto?: (hash: string) => void;
    onToggleSelectPhoto?: (hash: string) => void;
    isPhotoSelected?: (hash: string) => boolean;
    onSharePhoto?: (photo: any) => void;

    // Cluster Actions
    onRenameCluster?: (clusterId: string) => void;
    onDeleteCluster?: (clusterId: string) => void;

    // Collection Actions
    onRenameCollection?: (collectionId: string) => void;
    onDeleteCollection?: (collectionId: string) => void;
}

export function ContextMenu({
    x,
    y,
    type,
    visible,
    data,
    onClose,
    mobile,
    onDeletePhoto,
    onToggleSelectPhoto,
    isPhotoSelected,
    onSharePhoto,
    onRenameCluster,
    onDeleteCluster,
    onRenameCollection,
    onDeleteCollection,
}: ContextMenuProps) {
    const menuRef = useRef<HTMLDivElement | null>(null);
    const previouslyFocusedRef = useRef<HTMLElement | null>(null);

    const closeMenu = useCallback(() => {
        const previous = previouslyFocusedRef.current;
        previouslyFocusedRef.current = null;
        if (previous?.isConnected) previous.focus();
        onClose();
    }, [onClose]);

    useEffect(() => {
        if (!visible) return;
        previouslyFocusedRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        const frame = requestAnimationFrame(() => {
            menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
        });
        return () => {
            cancelAnimationFrame(frame);
            const previous = previouslyFocusedRef.current;
            previouslyFocusedRef.current = null;
            if (previous?.isConnected) previous.focus();
        };
    }, [visible]);

    useEffect(() => {
        if (!visible) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                closeMenu();
                return;
            }

            const items = Array.from(
                menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
            );
            if (items.length === 0) return;
            const currentIndex = Math.max(0, items.indexOf(document.activeElement as HTMLElement));
            let nextIndex: number | null = null;
            if (e.key === 'Tab') {
                nextIndex = e.shiftKey
                    ? (currentIndex - 1 + items.length) % items.length
                    : (currentIndex + 1) % items.length;
            }
            if (e.key === 'ArrowDown') nextIndex = (currentIndex + 1) % items.length;
            if (e.key === 'ArrowUp') nextIndex = (currentIndex - 1 + items.length) % items.length;
            if (e.key === 'Home') nextIndex = 0;
            if (e.key === 'End') nextIndex = items.length - 1;
            if (nextIndex !== null) {
                e.preventDefault();
                items[nextIndex]?.focus();
            }
        };
        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [closeMenu, visible]);

    // Position adjustment for desktop so it doesn't overflow screen boundaries
    const getAdjustedStyles = () => {
        if (mobile) return undefined;

        const menuWidth = 192; // w-48 is 12rem = 192px
        const menuHeight = 160; // approximate
        
        let adjustedX = x;
        let adjustedY = y;

        if (x + menuWidth > window.innerWidth) {
            adjustedX = window.innerWidth - menuWidth - 8;
        }
        if (y + menuHeight > window.innerHeight) {
            adjustedY = window.innerHeight - menuHeight - 8;
        }

        return {
            top: `${adjustedY}px`,
            left: `${adjustedX}px`,
        };
    };

    if (!visible || !data) return null;

    return (
        <>
            {/* Backdrop click away */}
            <div
                className="fixed inset-0 z-[100] bg-black/10 transition-opacity landscape:bg-transparent"
                onClick={closeMenu}
                aria-hidden="true"
            />

            {/* Menu panel */}
            <div
                ref={menuRef}
                role="menu"
                aria-label={type === 'photo' ? 'Photo actions' : type === 'cluster' ? 'Face cluster actions' : 'Collection actions'}
                className={`
                    z-[101] border border-white/10 bg-[#1a1a1a]/95 backdrop-blur-md shadow-2xl transition-all duration-200
                    ${mobile
                        ? 'fixed bottom-0 left-0 right-0 rounded-t-2xl p-4 pb-8 animate-slide-up max-h-[50vh] overflow-y-auto'
                        : 'fixed rounded-lg py-1.5 w-48 text-left animate-[fadeIn_150ms_ease]'
                    }
                `}
                style={getAdjustedStyles()}
            >
                {/* Mobile Header */}
                {mobile && (
                    <div className="flex items-center justify-between border-b border-white/5 pb-2.5 mb-2.5">
                        <span className="text-xs font-bold tracking-wider text-white/55 uppercase">
                            {type === 'photo' ? 'Photo Options' : type === 'cluster' ? 'Face Cluster Options' : 'Collection Actions'}
                        </span>
                        <button
                            type="button"
                            onClick={closeMenu}
                            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/5 text-white/60 hover:text-white/85"
                            aria-label="Close actions menu"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>
                )}

                {/* Content based on type */}
                <div className="space-y-0.5">
                    {type === 'photo' && (
                        <>
                            <MenuBtn
                                icon={Share2}
                                label="Share Photo"
                                mobile={mobile}
                                onClick={() => {
                                    onSharePhoto?.(data);
                                    closeMenu();
                                }}
                            />
                            <MenuBtn
                                icon={CheckCircle}
                                label={isPhotoSelected?.(data.hash) ? 'Deselect Photo' : 'Select Photo'}
                                mobile={mobile}
                                onClick={() => {
                                    onToggleSelectPhoto?.(data.hash);
                                    closeMenu();
                                }}
                            />
                            <div role="separator" className="my-1 h-px bg-white/5" />
                            <MenuBtn
                                icon={Trash2}
                                label="Delete Photo"
                                mobile={mobile}
                                destructive
                                onClick={() => {
                                    onDeletePhoto?.(data.hash);
                                    closeMenu();
                                }}
                            />
                        </>
                    )}

                    {type === 'cluster' && (
                        <>
                            <MenuBtn
                                icon={Edit3}
                                label="Rename Face"
                                mobile={mobile}
                                onClick={() => {
                                    onRenameCluster?.(data.clusterId);
                                    closeMenu();
                                }}
                            />
                            <div role="separator" className="my-1 h-px bg-white/5" />
                            <MenuBtn
                                icon={Trash2}
                                label="Delete Face Cluster"
                                mobile={mobile}
                                destructive
                                onClick={() => {
                                    onDeleteCluster?.(data.clusterId);
                                    closeMenu();
                                }}
                            />
                        </>
                    )}

                    {type === 'collection' && (
                        <>
                            <MenuBtn
                                icon={Edit3}
                                label="Rename Collection"
                                mobile={mobile}
                                onClick={() => {
                                    onRenameCollection?.(data.id);
                                    closeMenu();
                                }}
                            />
                            <div role="separator" className="my-1 h-px bg-white/5" />
                            <MenuBtn
                                icon={Trash2}
                                label="Delete Collection"
                                mobile={mobile}
                                destructive
                                onClick={() => {
                                    onDeleteCollection?.(data.id);
                                    closeMenu();
                                }}
                            />
                        </>
                    )}
                </div>
            </div>
        </>
    );
}

interface MenuBtnProps {
    icon: React.ComponentType<any>;
    label: string;
    mobile: boolean;
    destructive?: boolean;
    onClick: () => void;
}

function MenuBtn({ icon: Icon, label, mobile, destructive = false, onClick }: MenuBtnProps) {
    return (
        <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={onClick}
            className={`
                w-full flex items-center gap-3 text-left transition-colors font-medium
                ${mobile
                    ? 'min-h-11 px-4 py-3 text-sm rounded-xl'
                    : 'min-h-11 px-3 py-2 text-xs'
                }
                ${destructive
                    ? 'text-red-300 hover:bg-red-500/10'
                    : 'text-white/80 hover:bg-white/5 hover:text-white'
                }
            `}
        >
            <Icon className={mobile ? 'w-5 h-5 shrink-0' : 'w-3.5 h-3.5 shrink-0'} />
            <span>{label}</span>
        </button>
    );
}
