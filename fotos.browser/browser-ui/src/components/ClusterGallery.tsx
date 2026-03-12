import { useEffect, useState } from 'react';
import type { FaceClusterSummary } from '@/lib/cluster-gallery';
import { InlineRenameField } from './InlineRenameField';

interface ClusterGalleryProps {
    clusters: FaceClusterSummary[];
    activeClusterId: string | null;
    onSelectCluster: (clusterId: string) => void;
    getFileUrl: (relativePath: string) => Promise<string>;
    onRenameCluster?: (clusterId: string, name: string) => Promise<void> | void;
}

export function ClusterGallery({
    clusters,
    activeClusterId,
    onSelectCluster,
    getFileUrl,
    onRenameCluster,
}: ClusterGalleryProps) {
    if (clusters.length === 0) {
        return (
            <div className="h-full flex items-center justify-center text-white/30">
                <div className="text-center">
                    <p className="text-lg mb-2">No face clusters yet</p>
                    <p className="text-sm">Run image AI to populate people and group galleries.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="p-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {clusters.map(cluster => (
                    <ClusterCard
                        key={cluster.clusterId}
                        cluster={cluster}
                        active={cluster.clusterId === activeClusterId}
                        onClick={() => onSelectCluster(cluster.clusterId)}
                        getFileUrl={getFileUrl}
                        onRename={onRenameCluster}
                    />
                ))}
            </div>
        </div>
    );
}

export function ClusterCard({
    cluster,
    active,
    onClick,
    getFileUrl,
    onRename,
}: {
    cluster: FaceClusterSummary;
    active: boolean;
    onClick: () => void;
    getFileUrl: (relativePath: string) => Promise<string>;
    onRename?: (clusterId: string, name: string) => Promise<void> | void;
}) {
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

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

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onClick}
            onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onClick();
                }
            }}
            className={`group flex flex-col gap-3 rounded-2xl border p-4 text-left transition-colors ${
                active
                    ? 'border-[#e94560]/70 bg-[#1f1015]'
                    : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]'
            }`}
        >
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
                            onSubmit={name => onRename(cluster.clusterId, name)}
                            labelClassName="truncate text-sm font-medium text-white/85"
                            inputClassName="min-w-0 flex-1 rounded-md border border-[#e94560]/35 bg-[#1a1115] px-2 py-1.5 text-sm text-white placeholder:text-white/20 focus:border-[#ff9db0]/60 focus:outline-none"
                        />
                    ) : (
                        <div className="text-sm font-medium text-white/85 truncate">{cluster.label}</div>
                    )}
                    <div className="text-[11px] text-white/35">
                        {cluster.personName ? 'Person cluster' : 'Face group'}
                    </div>
                </div>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-white/40">
                <span>{cluster.faceCount} faces</span>
                <span>{cluster.photoCount} photos</span>
            </div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-white/25 group-hover:text-white/45 transition-colors">
                Open cluster gallery
            </div>
        </div>
    );
}
