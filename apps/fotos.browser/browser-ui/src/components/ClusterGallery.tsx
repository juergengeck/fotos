import { useEffect, useState, useRef, useCallback } from 'react';
import type { FaceClusterSummary } from '@/lib/cluster-gallery';
import { InlineRenameField } from './InlineRenameField';

interface ClusterGalleryProps {
    clusters: FaceClusterSummary[];
    activeClusterId: string | null;
    onSelectCluster: (clusterId: string) => void;
    getFileUrl: (relativePath: string) => Promise<string>;
    onRenameCluster?: (clusterId: string, name: string) => Promise<void> | void;
    selectedClusterIds: ReadonlySet<string>;
    onToggleClusterSelection: (clusterId: string, index: number, options?: {range?: boolean}) => void;
    /**
     * Name (and, for multi-selections, group) the given member clusters under a
     * single identity. If the name matches an existing person, the caller is
     * expected to merge them into that identity.
     */
    onNameClusters?: (memberClusterIds: string[], name: string) => void | Promise<void>;
    onClusterContextMenu?: (cluster: FaceClusterSummary, event: React.MouseEvent | React.TouchEvent | KeyboardEvent) => void;
}

export function ClusterGallery({
    clusters,
    activeClusterId,
    onSelectCluster,
    getFileUrl,
    onRenameCluster,
    selectedClusterIds,
    onToggleClusterSelection,
    onNameClusters,
    onClusterContextMenu,
}: ClusterGalleryProps) {
    const selectionActive = selectedClusterIds.size > 0;
    const [cursor, setCursor] = useState(-1);
    const gridRef = useRef<HTMLDivElement>(null);

    useEffect(() => setCursor(-1), [clusters]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (
                event.target instanceof HTMLInputElement
                || event.target instanceof HTMLTextAreaElement
                || event.target instanceof HTMLSelectElement
            ) return;
            if (clusters.length === 0) return;
            const columnCount = (() => {
                const columns = getComputedStyle(gridRef.current as HTMLElement).gridTemplateColumns;
                return Math.max(1, columns.split(' ').filter(Boolean).length);
            })();
            let next = cursor;
            if (event.key === 'ArrowRight') next = cursor < 0 ? 0 : Math.min(cursor + 1, clusters.length - 1);
            else if (event.key === 'ArrowLeft') next = cursor < 0 ? 0 : Math.max(cursor - 1, 0);
            else if (event.key === 'ArrowDown') next = cursor < 0 ? 0 : Math.min(cursor + columnCount, clusters.length - 1);
            else if (event.key === 'ArrowUp') next = cursor < 0 ? 0 : Math.max(cursor - columnCount, 0);
            else if (event.key === 'Enter' && cursor >= 0) {
                event.preventDefault();
                if (selectionActive) onToggleClusterSelection(clusters[cursor].clusterId, cursor);
                else onSelectCluster(clusters[cursor].clusterId);
                return;
            } else if ((event.key === 'x' || event.key === 'X' || event.key === ' ') && cursor >= 0) {
                event.preventDefault();
                onToggleClusterSelection(clusters[cursor].clusterId, cursor, {range: event.shiftKey});
                return;
            } else if (
                (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey))
                && cursor >= 0
                && onClusterContextMenu
            ) {
                event.preventDefault();
                onClusterContextMenu(clusters[cursor], event);
                return;
            } else {
                return;
            }
            event.preventDefault();
            setCursor(next);
            const card = gridRef.current?.querySelector<HTMLElement>(`[data-person-index="${next}"]`);
            card?.focus();
            card?.scrollIntoView({block: 'nearest', behavior: 'smooth'});
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [clusters, cursor, onClusterContextMenu, onSelectCluster, onToggleClusterSelection, selectionActive]);

    // Renaming a name-grouped card should rename the whole identity, not just one
    // member cluster — route through onNameClusters when available.
    const renameCluster = useCallback((cluster: FaceClusterSummary, name: string) => {
        if (onNameClusters) {
            return onNameClusters(cluster.memberClusterIds, name);
        }
        return onRenameCluster?.(cluster.memberClusterIds[0] ?? cluster.clusterId, name);
    }, [onNameClusters, onRenameCluster]);

    if (clusters.length === 0) {
        return (
            <div className="h-full flex items-center justify-center text-white/55 view-enter">
                <div className="text-center max-w-xs space-y-3">
                    <div className="text-4xl opacity-40">👤</div>
                    <p className="text-base font-medium text-white/50">No face clusters yet</p>
                    <p className="text-sm text-white/55 leading-relaxed">
                        Enable face analytics in Settings and scan your gallery to discover people in your photos.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="p-3">
            <div ref={gridRef} role="grid" aria-label="People" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {clusters.map((cluster, index) => (
                    <ClusterCard
                        key={cluster.clusterId}
                        cluster={cluster}
                        active={cluster.clusterId === activeClusterId}
                        selected={selectedClusterIds.has(cluster.clusterId)}
                        selectionActive={selectionActive}
                        onToggleSelect={options => onToggleClusterSelection(cluster.clusterId, index, options)}
                        onClick={() => onSelectCluster(cluster.clusterId)}
                        index={index}
                        getFileUrl={getFileUrl}
                        onRename={
                            (onNameClusters || onRenameCluster)
                                ? (name) => renameCluster(cluster, name)
                                : undefined
                        }
                        onContextMenu={event => onClusterContextMenu?.(cluster, event)}
                    />
                ))}
            </div>
        </div>
    );
}

export function ClusterCard({
    cluster,
    active,
    selected = false,
    selectionActive = false,
    onToggleSelect,
    onClick,
    getFileUrl,
    onRename,
    onContextMenu,
    index,
}: {
    cluster: FaceClusterSummary;
    active: boolean;
    selected?: boolean;
    selectionActive?: boolean;
    onToggleSelect?: (options?: {range?: boolean}) => void;
    onClick: () => void;
    getFileUrl: (relativePath: string) => Promise<string>;
    onRename?: (name: string) => Promise<void> | void;
    onContextMenu?: (e: React.MouseEvent | React.TouchEvent) => void;
    index: number;
}) {
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const hasLongPressed = useRef(false);

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        hasLongPressed.current = false;
        timerRef.current = setTimeout(() => {
            hasLongPressed.current = true;
            // On touch, a long press starts/extends a selection instead of
            // opening — the implicit equivalent of hovering to reveal the checkbox.
            if (onToggleSelect) {
                onToggleSelect();
            } else if (onContextMenu) {
                onContextMenu(e);
            }
        }, 600);
    }, [onToggleSelect, onContextMenu]);

    const handleTouchMove = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const handleTouchEnd = useCallback((e: React.TouchEvent) => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        if (hasLongPressed.current) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, []);

    useEffect(() => {
        if (!cluster.avatarPath) {
            setAvatarUrl(null);
            return;
        }

        let cancelled = false;
        void getFileUrl(cluster.avatarPath)
            .then(url => {
                if (!cancelled) {
                    setAvatarUrl(url);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setAvatarUrl(null);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [cluster.avatarPath, getFileUrl]);

    const handleClick = useCallback((e: React.MouseEvent) => {
        // Browsing is the default. Selection is implicit: once anything is
        // selected, or with a modifier held, a click toggles selection instead
        // of opening the cluster.
        if (onToggleSelect && (selectionActive || e.metaKey || e.ctrlKey || e.shiftKey)) {
            e.preventDefault();
            onToggleSelect({range: e.shiftKey});
            return;
        }
        onClick();
    }, [onToggleSelect, selectionActive, onClick]);

    const handleCheckboxClick = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        onToggleSelect?.();
    }, [onToggleSelect]);

    return (
        <div
            className={`group relative flex flex-col gap-3 rounded-2xl border p-4 text-left transition-colors ${
                selected
                    ? 'border-sky-400 bg-sky-950/55 ring-2 ring-sky-500/70'
                    : active
                        ? 'border-[#e94560]/70 bg-[#1f1015]'
                        : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]'
            }`}
        >
            {onToggleSelect && (
                <button
                    type="button"
                    aria-pressed={selected}
                    aria-label={selected ? 'Deselect person' : 'Select person'}
                    onClick={handleCheckboxClick}
                    className={`absolute left-0 top-0 z-10 flex h-11 w-11 items-center justify-center rounded-md transition-opacity ${
                        selected || selectionActive
                            ? 'opacity-100'
                            : 'opacity-0 group-hover:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-70'
                    }`}
                >
                    <span className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold backdrop-blur-sm ${
                        selected
                            ? 'border-sky-200/80 bg-sky-600 text-white'
                            : 'border-white/30 bg-black/45 text-white/60 hover:border-white/60'
                    }`} aria-hidden="true">
                        {selected ? '✓' : ''}
                    </span>
                </button>
            )}
            <div className="flex items-center gap-3">
                {avatarUrl ? (
                    <img
                        src={avatarUrl}
                        alt={cluster.label}
                        className="h-16 w-16 rounded-full object-cover border border-white/10"
                    />
                ) : (
                    <div className="h-16 w-16 rounded-full bg-white/10 border border-white/10 flex items-center justify-center text-white/55 text-xs uppercase tracking-[0.2em]">
                        AI
                    </div>
                )}
                <div className="min-w-0">
                    {onRename ? (
                        <InlineRenameField
                            value={cluster.personName}
                            fallback={cluster.label}
                            placeholder="Name this cluster"
                            onSubmit={name => onRename(name)}
                            labelClassName="truncate text-sm font-medium text-white/85"
                            inputClassName="min-w-0 flex-1 rounded-md border border-[#e94560]/35 bg-[#1a1115] px-2 py-1.5 text-sm text-white placeholder:text-white/55 focus:border-[#ff9db0]/60 focus:outline-none"
                        />
                    ) : (
                        <div className="text-sm font-medium text-white/85 truncate">{cluster.label}</div>
                    )}
                    <div className="text-xs text-white/55">
                        {cluster.memberClusterIds.length > 1
                            ? `Person · ${cluster.memberClusterIds.length} clusters`
                            : cluster.personName
                                ? 'Person cluster'
                                : 'Face group'}
                    </div>
                </div>
            </div>
            <div className="flex items-center gap-3 text-xs text-white/55">
                <span>{cluster.faceCount} faces</span>
                <span>{cluster.photoCount} photos</span>
            </div>
            <button
                type="button"
                data-person-index={index}
                onClick={handleClick}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onContextMenu={event => {
                    event.preventDefault();
                    event.stopPropagation();
                    onContextMenu?.(event);
                }}
                className="min-h-11 rounded-md border border-white/10 bg-white/[0.035] px-3 py-2 text-left text-xs uppercase tracking-[0.16em] text-white/55 transition-colors hover:bg-white/[0.07] hover:text-white/80"
            >
                {selectionActive ? (selected ? 'Deselect person' : 'Select person') : 'Open person photos'}
            </button>
        </div>
    );
}
