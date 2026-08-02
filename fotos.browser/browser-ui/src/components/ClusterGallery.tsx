import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import type { FaceClusterSummary } from '@/lib/cluster-gallery';
import { InlineRenameField } from './InlineRenameField';

interface ClusterGalleryProps {
    clusters: FaceClusterSummary[];
    activeClusterId: string | null;
    onSelectCluster: (clusterId: string) => void;
    getFileUrl: (relativePath: string) => Promise<string>;
    onRenameCluster?: (clusterId: string, name: string) => Promise<void> | void;
    /** Existing named people, used to power the "this is …" suggestions. */
    people?: FaceClusterSummary[];
    /**
     * Name (and, for multi-selections, group) the given member clusters under a
     * single identity. If the name matches an existing person, the caller is
     * expected to merge them into that identity.
     */
    onNameClusters?: (memberClusterIds: string[], name: string) => void | Promise<void>;
}

function personDisplayName(cluster: FaceClusterSummary): string {
    return (cluster.personName ?? cluster.label).trim();
}

export function ClusterGallery({
    clusters,
    activeClusterId,
    onSelectCluster,
    getFileUrl,
    onRenameCluster,
    people,
    onNameClusters,
}: ClusterGalleryProps) {
    const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
    const [nameDraft, setNameDraft] = useState('');
    const selectionActive = selectedIds.size > 0;
    const canName = Boolean(onNameClusters);

    // Drop selections that no longer exist after the cluster list changes.
    useEffect(() => {
        setSelectedIds(prev => {
            if (prev.size === 0) return prev;
            const present = new Set(clusters.map(cluster => cluster.clusterId));
            let changed = false;
            const next = new Set<string>();
            prev.forEach(id => {
                if (present.has(id)) {
                    next.add(id);
                } else {
                    changed = true;
                }
            });
            return changed ? next : prev;
        });
    }, [clusters]);

    const clearSelection = useCallback(() => {
        setSelectedIds(new Set());
        setNameDraft('');
    }, []);

    const toggleSelection = useCallback((clusterId: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(clusterId)) {
                next.delete(clusterId);
            } else {
                next.add(clusterId);
            }
            return next;
        });
    }, []);

    // Escape clears an active selection.
    useEffect(() => {
        if (!selectionActive) return;
        const handler = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                clearSelection();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [selectionActive, clearSelection]);

    const peopleNames = useMemo(
        () => Array.from(new Set((people ?? []).map(personDisplayName).filter(Boolean))),
        [people],
    );

    // Renaming a name-grouped card should rename the whole identity, not just one
    // member cluster — route through onNameClusters when available.
    const renameCluster = useCallback((cluster: FaceClusterSummary, name: string) => {
        if (onNameClusters) {
            return onNameClusters(cluster.memberClusterIds, name);
        }
        return onRenameCluster?.(cluster.memberClusterIds[0] ?? cluster.clusterId, name);
    }, [onNameClusters, onRenameCluster]);

    const applyName = useCallback(() => {
        const trimmed = nameDraft.trim();
        if (!trimmed || !onNameClusters) return;

        const selected = clusters.filter(cluster => selectedIds.has(cluster.clusterId));
        const memberIds = selected.flatMap(cluster => cluster.memberClusterIds);

        // Naming with an existing person's name merges the selection into them.
        const match = (people ?? []).find(
            person => personDisplayName(person).toLowerCase() === trimmed.toLowerCase(),
        );
        const allIds = match ? [...match.memberClusterIds, ...memberIds] : memberIds;

        void onNameClusters(allIds, trimmed);
        clearSelection();
    }, [nameDraft, onNameClusters, clusters, selectedIds, people, clearSelection]);

    if (clusters.length === 0) {
        return (
            <div className="h-full flex items-center justify-center text-white/30 view-enter">
                <div className="text-center max-w-xs space-y-3">
                    <div className="text-4xl opacity-40">👤</div>
                    <p className="text-base font-medium text-white/50">No face clusters yet</p>
                    <p className="text-sm text-white/30 leading-relaxed">
                        Enable face analytics in Settings and scan your gallery to discover people in your photos.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="p-3">
            {selectionActive && canName && (
                <div className="sticky top-2 z-30 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/80 px-3 py-2 shadow-2xl backdrop-blur-md view-enter">
                    <span className="text-xs font-medium text-white/80 tabular-nums whitespace-nowrap">
                        {selectedIds.size} selected
                    </span>
                    <div className="h-4 w-px bg-white/10" />
                    <form
                        className="flex min-w-0 flex-1 items-center gap-2"
                        onSubmit={event => {
                            event.preventDefault();
                            applyName();
                        }}
                    >
                        <input
                            type="text"
                            list="cluster-people-names"
                            value={nameDraft}
                            onChange={event => setNameDraft(event.target.value)}
                            placeholder={selectedIds.size > 1 ? 'Name these people…' : 'Name this person…'}
                            aria-label="Name selected faces"
                            className="min-w-0 flex-1 rounded-md border border-[#e94560]/35 bg-[#1a1115] px-2.5 py-1.5 text-[11px] text-white placeholder:text-white/25 focus:border-[#ff9db0]/60 focus:outline-none"
                        />
                        <datalist id="cluster-people-names">
                            {peopleNames.map(name => (
                                <option key={name} value={name} />
                            ))}
                        </datalist>
                        <button
                            type="submit"
                            disabled={nameDraft.trim().length === 0}
                            className={`rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                                nameDraft.trim().length === 0
                                    ? 'bg-white/5 text-white/25 cursor-not-allowed'
                                    : 'bg-[#e94560]/90 text-white hover:bg-[#e94560]'
                            }`}
                        >
                            {selectedIds.size > 1 ? 'Name & group' : 'Name'}
                        </button>
                    </form>
                    <button
                        type="button"
                        onClick={clearSelection}
                        className="rounded-md px-2 py-1 text-[11px] text-white/45 transition-colors hover:bg-white/10 hover:text-white/75"
                    >
                        Clear
                    </button>
                </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {clusters.map(cluster => (
                    <ClusterCard
                        key={cluster.clusterId}
                        cluster={cluster}
                        active={cluster.clusterId === activeClusterId}
                        selected={selectedIds.has(cluster.clusterId)}
                        selectionActive={selectionActive}
                        onToggleSelect={canName ? () => toggleSelection(cluster.clusterId) : undefined}
                        onClick={() => onSelectCluster(cluster.clusterId)}
                        getFileUrl={getFileUrl}
                        onRename={
                            (onNameClusters || onRenameCluster)
                                ? (name) => renameCluster(cluster, name)
                                : undefined
                        }
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
}: {
    cluster: FaceClusterSummary;
    active: boolean;
    selected?: boolean;
    selectionActive?: boolean;
    onToggleSelect?: () => void;
    onClick: () => void;
    getFileUrl: (relativePath: string) => Promise<string>;
    onRename?: (name: string) => Promise<void> | void;
    onContextMenu?: (e: React.MouseEvent | React.TouchEvent) => void;
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
            onToggleSelect();
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
            role="button"
            tabIndex={0}
            onClick={handleClick}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (onContextMenu) {
                    onContextMenu(e);
                }
            }}
            onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onClick();
                }
            }}
            className={`group relative flex flex-col gap-3 rounded-2xl border p-4 text-left transition-colors ${
                selected
                    ? 'border-[#ff9db0] bg-[#1f1015] ring-2 ring-[#e94560]/70'
                    : active
                        ? 'border-[#e94560]/70 bg-[#1f1015]'
                        : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]'
            }`}
        >
            {onToggleSelect && (
                <span
                    role="checkbox"
                    aria-checked={selected}
                    aria-label={selected ? 'Deselect person' : 'Select person'}
                    tabIndex={-1}
                    onClick={handleCheckboxClick}
                    className={`absolute left-2.5 top-2.5 z-10 flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-semibold backdrop-blur-sm transition-opacity ${
                        selected
                            ? 'border-[#ff9db0]/80 bg-[#e94560]/90 text-white'
                            : 'border-white/30 bg-black/45 text-white/60 hover:border-white/60'
                    } ${
                        selected || selectionActive
                            ? 'opacity-100'
                            : 'opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-70'
                    }`}
                >
                    {selected ? '✓' : ''}
                </span>
            )}
            <div className="flex items-center gap-3">
                {avatarUrl ? (
                    <img
                        src={avatarUrl}
                        alt={cluster.label}
                        className="h-16 w-16 rounded-full object-cover border border-white/10"
                    />
                ) : (
                    <div className="h-16 w-16 rounded-full bg-white/10 border border-white/10 flex items-center justify-center text-white/25 text-[11px] uppercase tracking-[0.2em]">
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
                            inputClassName="min-w-0 flex-1 rounded-md border border-[#e94560]/35 bg-[#1a1115] px-2 py-1.5 text-sm text-white placeholder:text-white/20 focus:border-[#ff9db0]/60 focus:outline-none"
                        />
                    ) : (
                        <div className="text-sm font-medium text-white/85 truncate">{cluster.label}</div>
                    )}
                    <div className="text-[11px] text-white/35">
                        {cluster.memberClusterIds.length > 1
                            ? `Person · ${cluster.memberClusterIds.length} clusters`
                            : cluster.personName
                                ? 'Person cluster'
                                : 'Face group'}
                    </div>
                </div>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-white/40">
                <span>{cluster.faceCount} faces</span>
                <span>{cluster.photoCount} photos</span>
            </div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-white/25 group-hover:text-white/45 transition-colors">
                {selectionActive ? 'Click to select' : 'Open cluster gallery'}
            </div>
        </div>
    );
}
