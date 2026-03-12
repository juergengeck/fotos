import { useEffect, useState } from 'react';
import { Search, FolderOpen, Download, SlidersHorizontal, ChevronLeft, ChevronRight, ChevronDown, Trash2, Pencil } from 'lucide-react';
import type { FotosSettings, StorageMode, DisplaySettings } from '@/types/fotos';
import type { FotosModel } from '@/lib/onecore-boot';
import type { FaceClusterSummary, SimilarFaceMatch } from '@/lib/cluster-gallery';
import type { FotosHistoryBranchNode } from '@/lib/fotosHistorySettings';
import { FotosSettings as FotosSettingsPanel } from './FotosSettings';
import { ClusterCard } from './ClusterGallery';

type Tab = 'browse' | 'manage' | 'settings';

interface SidebarProps {
    tags: [string, number][];
    activeTag: string | null;
    onTagClick: (tag: string | null) => void;
    searchQuery: string;
    onSearchChange: (q: string) => void;
    browseSummary: string;
    settings: FotosSettings;
    onUpdateStorage: (updates: Partial<FotosSettings['storage']>) => void;
    onUpdateDisplay: (updates: Partial<DisplaySettings>) => void;
    onUpdateDeviceName: (name: string) => void;
    onUpdateAnalysis: (updates: Partial<FotosSettings['analysis']>) => void;
    historyEnabled: boolean;
    historyReady: boolean;
    historyCurrentEventId: string;
    historyBranchTree: FotosHistoryBranchNode[];
    historyVisibleEntryCount: number;
    historyBranchCount: number;
    onHistoryEnabledChange: (enabled: boolean) => void;
    onHistoryNavigate: (eventId: string) => void;
    onHistoryDelete: (eventId: string) => void;
    currentFolderName?: string | null;
    folderName?: string | null;
    onOpenFolder?: () => void;
    onRescan?: () => void;
    onReanalyze?: () => void;
    faceSearchActive?: boolean;
    onClearFaceSearch?: () => void;
    fotosModel?: FotosModel | null;
    mobile?: boolean;
    footerMarquee?: string | null;
    galleryMode: 'images' | 'clusters';
    onGalleryModeChange: (mode: 'images' | 'clusters') => void;
    clusters: FaceClusterSummary[];
    people: FaceClusterSummary[];
    groups: FaceClusterSummary[];
    similarFaces: SimilarFaceMatch[];
    searchClusters: FaceClusterSummary[];
    activeClusterId: string | null;
    onClusterSelect: (clusterId: string | null) => void;
    getFileUrl: (relativePath: string) => Promise<string>;
    selectedClusterAvatarKey: string | null;
    onSelectClusterAvatar: (avatarKey: string) => void;
    onOpenSimilarFace: (match: SimilarFaceMatch) => void;
    onDeletePhoto: (hash: string) => void;
    onEditFace: (clusterId: string) => void;
    onDeleteFace: (clusterId: string) => void;
}

export function Sidebar({
    tags, activeTag, onTagClick,
    searchQuery, onSearchChange,
    browseSummary,
    settings, onUpdateStorage, onUpdateDisplay, onUpdateDeviceName, onUpdateAnalysis,
    historyEnabled, historyReady, historyCurrentEventId, historyBranchTree,
    historyVisibleEntryCount, historyBranchCount,
    onHistoryEnabledChange, onHistoryNavigate, onHistoryDelete, currentFolderName,
    folderName, onOpenFolder, onRescan, onReanalyze,
    faceSearchActive, onClearFaceSearch,
    fotosModel,
    mobile,
    footerMarquee,
    galleryMode, onGalleryModeChange,
    clusters, people, groups,
    similarFaces, searchClusters,
    activeClusterId, onClusterSelect,
    getFileUrl,
    selectedClusterAvatarKey,
    onSelectClusterAvatar,
    onOpenSimilarFace,
    onDeletePhoto,
    onEditFace,
    onDeleteFace,
}: SidebarProps) {
    const [tab, setTab] = useState<Tab>('browse');
    const [collapsed, setCollapsed] = useState(false);

    // Mobile: inline panel, no overlay/drawer
    if (mobile) {
        return (
            <aside className="shrink-0 bg-[#0d0d0d] border-t landscape:border-t-0 landscape:border-l border-white/10 flex flex-col overflow-y-auto landscape:w-64 landscape:h-full">
                <div className="flex items-center border-b border-white/10">
                    <div className="flex flex-1">
                        <TabBtn active={tab === 'browse'} onClick={() => setTab('browse')}>Browse</TabBtn>
                        <TabBtn active={tab === 'settings'} onClick={() => setTab('settings')}>Settings</TabBtn>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-4">
                    {tab === 'browse' && (
                        <BrowseTab
                            tags={tags} activeTag={activeTag} onTagClick={onTagClick}
                            searchQuery={searchQuery} onSearchChange={onSearchChange}
                            browseSummary={browseSummary}
                            thumbScale={100} onThumbScaleChange={() => {}}
                            sortBy={settings.display.sortBy} onSortByChange={sortBy => onUpdateDisplay({ sortBy })}
                            sortOrder={settings.display.sortOrder} onSortOrderChange={sortOrder => onUpdateDisplay({ sortOrder })}
                            galleryMode={galleryMode}
                            onGalleryModeChange={onGalleryModeChange}
                            clusters={clusters}
                            people={people}
                            groups={groups}
                            similarFaces={similarFaces}
                            searchClusters={searchClusters}
                            activeClusterId={activeClusterId}
                            onClusterSelect={onClusterSelect}
                            getFileUrl={getFileUrl}
                            selectedClusterAvatarKey={selectedClusterAvatarKey}
                            onSelectClusterAvatar={onSelectClusterAvatar}
                            onOpenSimilarFace={onOpenSimilarFace}
                            onDeletePhoto={onDeletePhoto}
                            onEditFace={onEditFace}
                            onDeleteFace={onDeleteFace}
                        />
                    )}
                    {tab === 'settings' && (
                        <SettingsTab
                            settings={settings} onUpdateStorage={onUpdateStorage}
                            onUpdateDeviceName={onUpdateDeviceName}
                            onUpdateAnalysis={onUpdateAnalysis}
                            historyEnabled={historyEnabled}
                            historyReady={historyReady}
                            historyCurrentEventId={historyCurrentEventId}
                            historyBranchTree={historyBranchTree}
                            historyVisibleEntryCount={historyVisibleEntryCount}
                            historyBranchCount={historyBranchCount}
                            onHistoryEnabledChange={onHistoryEnabledChange}
                            onHistoryNavigate={onHistoryNavigate}
                            onHistoryDelete={onHistoryDelete}
                            currentFolderName={currentFolderName}
                            fotosModel={fotosModel ?? null}
                            clusters={clusters}
                            getFileUrl={getFileUrl}
                            onClusterSelect={id => onClusterSelect(id)}
                        />
                    )}
                </div>
                {footerMarquee && <SidebarMarquee text={footerMarquee} />}
            </aside>
        );
    }

    // Desktop: fixed-width sidebar with collapse/expand
    return (
        <>
        {/* Desktop expand toggle — lower-right */}
        {collapsed && (
            <button
                onClick={() => setCollapsed(false)}
                className="fixed bottom-[4.5rem] right-4 z-50 w-10 h-10 flex items-center justify-center bg-black/70 backdrop-blur-sm rounded-full border border-white/15 text-white/50 hover:text-white/70 transition-colors"
                aria-label="Expand sidebar"
            >
                <ChevronLeft className="w-5 h-5" />
            </button>
        )}

        <aside className={`
            w-64 h-full flex flex-col bg-[#0d0d0d] border-l border-white/10 shrink-0
            ${collapsed ? 'hidden' : ''}
        `}>
            {/* Tabs */}
            <div className="flex items-center border-b border-white/10">
                <div className="flex flex-1">
                    <TabBtn active={tab === 'browse'} onClick={() => setTab('browse')}>Browse</TabBtn>
                    <TabBtn active={tab === 'manage'} onClick={() => setTab('manage')}>Manage</TabBtn>
                    <TabBtn active={tab === 'settings'} onClick={() => setTab('settings')}>Settings</TabBtn>
                </div>
            </div>

            {/* Folder controls */}
            <div className="px-3 py-2 border-b border-white/10">
                {folderName ? (
                    <div className="flex items-center gap-2">
                        <FolderOpen className="w-3.5 h-3.5 text-white/40 shrink-0" />
                        <span className="text-xs text-white/60 truncate flex-1">{folderName}</span>
                        {onRescan && (
                            <button onClick={onRescan} className="text-[10px] text-white/30 hover:text-white/60">rescan</button>
                        )}
                        {onReanalyze && (
                            <button onClick={onReanalyze} className="text-[10px] text-[#ff9db0]/50 hover:text-[#ff9db0]">reanalyze</button>
                        )}
                        {onOpenFolder && (
                            <button onClick={onOpenFolder} className="text-[10px] text-white/30 hover:text-white/60">change</button>
                        )}
                    </div>
                ) : onOpenFolder ? (
                    <button onClick={onOpenFolder} className="flex items-center gap-2 text-xs text-white/40 hover:text-white/60">
                        <FolderOpen className="w-3.5 h-3.5" />
                        Open folder...
                    </button>
                ) : null}
            </div>

            {/* Face search indicator */}
            {faceSearchActive && (
                <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
                    <span className="text-[11px] text-blue-400/80 flex-1">Showing similar faces</span>
                    {onClearFaceSearch && (
                        <button onClick={onClearFaceSearch} className="text-[10px] text-white/30 hover:text-white/60">clear</button>
                    )}
                </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-3 space-y-4">
                {tab === 'browse' && (
                    <BrowseTab
                        tags={tags}
                        activeTag={activeTag}
                        onTagClick={onTagClick}
                        searchQuery={searchQuery}
                        onSearchChange={onSearchChange}
                        browseSummary={browseSummary}
                        thumbScale={settings.display.thumbScale}
                        onThumbScaleChange={s => onUpdateDisplay({ thumbScale: s })}
                        sortBy={settings.display.sortBy}
                        onSortByChange={sortBy => onUpdateDisplay({ sortBy })}
                        sortOrder={settings.display.sortOrder}
                        onSortOrderChange={sortOrder => onUpdateDisplay({ sortOrder })}
                        galleryMode={galleryMode}
                        onGalleryModeChange={onGalleryModeChange}
                        clusters={clusters}
                        people={people}
                        groups={groups}
                        similarFaces={similarFaces}
                        searchClusters={searchClusters}
                        activeClusterId={activeClusterId}
                        onClusterSelect={onClusterSelect}
                        getFileUrl={getFileUrl}
                        selectedClusterAvatarKey={selectedClusterAvatarKey}
                        onSelectClusterAvatar={onSelectClusterAvatar}
                        onOpenSimilarFace={onOpenSimilarFace}
                        onDeletePhoto={onDeletePhoto}
                        onEditFace={onEditFace}
                        onDeleteFace={onDeleteFace}
                    />
                )}
                {tab === 'manage' && (
                    <ManageTab settings={settings} onUpdateStorage={onUpdateStorage} />
                )}
                {tab === 'settings' && (
                    <SettingsTab
                        settings={settings}
                        onUpdateStorage={onUpdateStorage}
                        onUpdateDeviceName={onUpdateDeviceName}
                        onUpdateAnalysis={onUpdateAnalysis}
                        historyEnabled={historyEnabled}
                        historyReady={historyReady}
                        historyCurrentEventId={historyCurrentEventId}
                        historyBranchTree={historyBranchTree}
                        historyVisibleEntryCount={historyVisibleEntryCount}
                        historyBranchCount={historyBranchCount}
                        onHistoryEnabledChange={onHistoryEnabledChange}
                        onHistoryNavigate={onHistoryNavigate}
                        onHistoryDelete={onHistoryDelete}
                        currentFolderName={currentFolderName}
                        fotosModel={fotosModel ?? null}
                        clusters={clusters}
                        getFileUrl={getFileUrl}
                        onClusterSelect={id => onClusterSelect(id)}
                    />
                )}
            </div>
            {footerMarquee && <SidebarMarquee text={footerMarquee} />}

        </aside>

        {/* Collapse — fixed circle, bottom-right */}
        {!collapsed && (
            <button
                onClick={() => setCollapsed(true)}
                className="fixed bottom-6 right-4 z-50 w-10 h-10 flex items-center justify-center bg-black/70 backdrop-blur-sm rounded-full border border-white/15 text-white/50 hover:text-white/70 transition-colors"
                aria-label="Collapse sidebar"
            >
                <ChevronRight className="w-5 h-5" />
            </button>
        )}
        </>
    );
}

function SidebarMarquee({ text }: { text: string }) {
    return (
        <div className="border-t border-[#e94560]/30 bg-gradient-to-r from-[#1c0b11] via-[#15181f] to-[#1c0b11] overflow-hidden shadow-[0_-1px_0_rgba(233,69,96,0.15)]">
            <style>{`
                @keyframes fotos-sidebar-marquee {
                    from { transform: translateX(0); }
                    to { transform: translateX(-33.333%); }
                }
            `}</style>
            <div
                className="flex min-w-max whitespace-nowrap py-2 text-[11px] font-medium tracking-[0.18em] text-[#ff9db0]"
                style={{ animation: 'fotos-sidebar-marquee 18s linear infinite' }}
            >
                <span className="px-4">Image AI: {text}</span>
                <span className="px-4">Image AI: {text}</span>
                <span className="px-4">Image AI: {text}</span>
            </div>
        </div>
    );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            onClick={onClick}
            className={`flex-1 px-2 py-2 text-[11px] font-medium tracking-wide uppercase transition-colors ${
                active
                    ? 'text-white/90 border-b-2 border-white/40'
                    : 'text-white/30 hover:text-white/50 border-b-2 border-transparent'
            }`}
        >
            {children}
        </button>
    );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
    return <div className="text-[10px] text-white/25 uppercase tracking-wider font-medium">{children}</div>;
}

function CollapsibleSection({ label, defaultOpen = true, children }: { label: string; defaultOpen?: boolean; children: React.ReactNode }) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div>
            <button
                onClick={() => setOpen(o => !o)}
                className="flex w-full items-center gap-1 text-[10px] text-white/25 uppercase tracking-wider font-medium hover:text-white/40 transition-colors"
            >
                <ChevronDown className={`w-3 h-3 transition-transform ${open ? '' : '-rotate-90'}`} />
                {label}
            </button>
            {open && <div className="mt-1.5 space-y-2">{children}</div>}
        </div>
    );
}

function BrowseTab({
    tags, activeTag, onTagClick,
    searchQuery, onSearchChange,
    browseSummary,
    thumbScale, onThumbScaleChange,
    sortBy, onSortByChange,
    sortOrder, onSortOrderChange,
    galleryMode, onGalleryModeChange,
    clusters, people, groups,
    similarFaces, searchClusters,
    activeClusterId, onClusterSelect,
    getFileUrl,
    selectedClusterAvatarKey, onSelectClusterAvatar,
    onOpenSimilarFace, onDeletePhoto,
    onEditFace, onDeleteFace,
}: {
    tags: [string, number][];
    activeTag: string | null;
    onTagClick: (tag: string | null) => void;
    searchQuery: string;
    onSearchChange: (q: string) => void;
    browseSummary: string;
    thumbScale: number;
    onThumbScaleChange: (s: number) => void;
    sortBy: string;
    onSortByChange: (s: 'date' | 'name' | 'added') => void;
    sortOrder: string;
    onSortOrderChange: (o: 'asc' | 'desc') => void;
    galleryMode: 'images' | 'clusters';
    onGalleryModeChange: (mode: 'images' | 'clusters') => void;
    clusters: FaceClusterSummary[];
    people: FaceClusterSummary[];
    groups: FaceClusterSummary[];
    similarFaces: SimilarFaceMatch[];
    searchClusters: FaceClusterSummary[];
    activeClusterId: string | null;
    onClusterSelect: (clusterId: string | null) => void;
    getFileUrl: (relativePath: string) => Promise<string>;
    selectedClusterAvatarKey: string | null;
    onSelectClusterAvatar: (avatarKey: string) => void;
    onOpenSimilarFace: (match: SimilarFaceMatch) => void;
    onDeletePhoto: (hash: string) => void;
    onEditFace: (clusterId: string) => void;
    onDeleteFace: (clusterId: string) => void;
}) {
    return (
        <>
            {/* Stats */}
            <div className="text-xs text-white/35">
                {browseSummary}
            </div>

            <div>
                <SectionLabel>Gallery</SectionLabel>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                    <TogglePill
                        active={galleryMode === 'images'}
                        onClick={() => onGalleryModeChange('images')}
                        label="Images"
                    />
                    <TogglePill
                        active={galleryMode === 'clusters'}
                        onClick={() => onGalleryModeChange('clusters')}
                        label={`Clusters ${clusters.length}`}
                    />
                </div>
            </div>

            {/* Search */}
            <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/25" />
                <input
                    type="search"
                    placeholder={galleryMode === 'clusters' ? 'Search people or groups...' : 'Search photos...'}
                    value={searchQuery}
                    onChange={e => onSearchChange(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 bg-white/5 border border-white/10 rounded-md text-xs text-white placeholder:text-white/25 focus:outline-none focus:border-white/20"
                />
            </div>

            {galleryMode === 'clusters' && (
                <>
                    {activeClusterId && (
                        <button
                            onClick={() => onClusterSelect(null)}
                            className="w-full text-left text-[11px] text-white/45 hover:text-white/65"
                        >
                            ← Back to all clusters
                        </button>
                    )}

                    {people.length > 0 && (
                        <div>
                            <SectionLabel>People</SectionLabel>
                            <div className="mt-1.5 space-y-1">
                                {people.map(cluster => (
                                    <ClusterBrowseRow
                                        key={cluster.clusterId}
                                        cluster={cluster}
                                        active={cluster.clusterId === activeClusterId}
                                        onClick={() => onClusterSelect(cluster.clusterId)}
                                        getFileUrl={getFileUrl}
                                        onEdit={onEditFace}
                                        onDelete={onDeleteFace}
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    {groups.length > 0 && (
                        <div>
                            <SectionLabel>Groups</SectionLabel>
                            <div className="mt-1.5 space-y-1">
                                {groups.map(cluster => (
                                    <ClusterBrowseRow
                                        key={cluster.clusterId}
                                        cluster={cluster}
                                        active={cluster.clusterId === activeClusterId}
                                        onClick={() => onClusterSelect(cluster.clusterId)}
                                        getFileUrl={getFileUrl}
                                        onEdit={onEditFace}
                                        onDelete={onDeleteFace}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}

            {similarFaces.length > 0 && (
                <>
                    {searchClusters.length > 0 && (
                        <div>
                            <SectionLabel>Clusters</SectionLabel>
                            <div className="mt-1.5 space-y-1">
                                {searchClusters.map(cluster => (
                                    <ClusterBrowseRow
                                        key={cluster.clusterId}
                                        cluster={cluster}
                                        active={cluster.clusterId === activeClusterId}
                                        onClick={() => onClusterSelect(cluster.clusterId)}
                                        getFileUrl={getFileUrl}
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    <div>
                        <SectionLabel>Similar Faces</SectionLabel>
                        <div className="mt-1.5 space-y-1">
                            {similarFaces.slice(0, 12).map(match => {
                                const avatarKey = `${match.photo.hash}:${match.faceIndex}`;
                                return (
                                    <SimilarFaceRow
                                        key={avatarKey}
                                        match={match}
                                        getFileUrl={getFileUrl}
                                        checked={selectedClusterAvatarKey === avatarKey}
                                        onCheck={() => onSelectClusterAvatar(avatarKey)}
                                        onOpen={() => onOpenSimilarFace(match)}
                                        onDelete={() => onDeletePhoto(match.photo.hash)}
                                    />
                                );
                            })}
                        </div>
                    </div>
                </>
            )}

            {galleryMode === 'images' && (
                <>
                    {/* Size slider */}
                    <div>
                        <SectionLabel>Size</SectionLabel>
                        <div className="flex items-center gap-2 mt-1.5">
                            <SlidersHorizontal className="w-3 h-3 text-white/25 shrink-0" />
                            <input
                                type="range"
                                min={60}
                                max={400}
                                step={10}
                                value={thumbScale}
                                onChange={e => onThumbScaleChange(parseInt(e.target.value))}
                                className="flex-1 accent-white/50 h-1"
                            />
                            <span className="text-[10px] text-white/30 w-8 text-right tabular-nums">{thumbScale}</span>
                        </div>
                    </div>

                    {/* Sort */}
                    <div>
                        <SectionLabel>Sort</SectionLabel>
                        <div className="flex items-center gap-1.5 mt-1.5">
                            <select
                                value={sortBy}
                                onChange={e => onSortByChange(e.target.value as 'date' | 'name' | 'added')}
                                className="flex-1 bg-white/5 border border-white/10 text-[11px] text-white/60 px-2 py-1 rounded-md focus:outline-none cursor-pointer"
                            >
                                <option value="date">Date</option>
                                <option value="name">Name</option>
                                <option value="added">Added</option>
                            </select>
                            <button
                                onClick={() => onSortOrderChange(sortOrder === 'asc' ? 'desc' : 'asc')}
                                className="text-[11px] text-white/35 hover:text-white/60 px-2 py-1 bg-white/5 rounded-md border border-white/10"
                            >
                                {sortOrder === 'desc' ? 'Newest' : 'Oldest'}
                            </button>
                        </div>
                    </div>

                    {/* Tags */}
                    {tags.length > 0 && (
                        <div>
                            <SectionLabel>Tags</SectionLabel>
                            <div className="flex flex-wrap gap-1 mt-1.5">
                                <TagPill active={!activeTag} onClick={() => onTagClick(null)} label="All" />
                                {tags.map(([tag, count]) => (
                                    <TagPill
                                        key={tag}
                                        active={activeTag === tag}
                                        onClick={() => onTagClick(activeTag === tag ? null : tag)}
                                        label={`${tag} ${count}`}
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Detected faces */}
                    {clusters.length > 0 && (
                        <div>
                            <SectionLabel>Faces</SectionLabel>
                            <div className="mt-1.5 space-y-1">
                                {clusters.map(cluster => (
                                    <ClusterBrowseRow
                                        key={cluster.clusterId}
                                        cluster={cluster}
                                        active={false}
                                        onClick={() => {
                                            onGalleryModeChange('clusters');
                                            onClusterSelect(cluster.clusterId);
                                        }}
                                        getFileUrl={getFileUrl}
                                        onEdit={onEditFace}
                                        onDelete={onDeleteFace}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}
        </>
    );
}

function TagPill({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
    return (
        <button
            onClick={onClick}
            className={`px-2 py-0.5 rounded-full text-[10px] border transition-colors ${
                active
                    ? 'bg-white/10 text-white/80 border-white/20'
                    : 'bg-white/5 text-white/35 border-transparent hover:text-white/55'
            }`}
        >
            {label}
        </button>
    );
}

function TogglePill({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
    return (
        <button
            onClick={onClick}
            className={`rounded-md border px-2 py-1 text-[10px] uppercase tracking-[0.18em] transition-colors ${
                active
                    ? 'border-[#e94560]/50 bg-[#e94560]/12 text-[#ff9db0]'
                    : 'border-white/10 bg-white/5 text-white/35 hover:text-white/55'
            }`}
        >
            {label}
        </button>
    );
}

function ClusterBrowseRow({
    cluster,
    active,
    onClick,
    getFileUrl,
    onEdit,
    onDelete,
}: {
    cluster: FaceClusterSummary;
    active: boolean;
    onClick: () => void;
    getFileUrl: (relativePath: string) => Promise<string>;
    onEdit?: (clusterId: string) => void;
    onDelete?: (clusterId: string) => void;
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
        <div className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 transition-colors ${
            active
                ? 'border-[#e94560]/50 bg-[#e94560]/10'
                : 'border-white/10 bg-white/5 hover:bg-white/10'
        }`}>
            <button onClick={onClick} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                {avatarUrl ? (
                    <img src={avatarUrl} alt={cluster.label} className="h-7 w-7 rounded-full object-cover border border-white/10" />
                ) : (
                    <div className="h-7 w-7 rounded-full bg-white/10 border border-white/10" />
                )}
                <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] text-white/75">{cluster.label}</div>
                    <div className="text-[10px] text-white/25">{cluster.faceCount} faces · {cluster.photoCount} photos</div>
                </div>
            </button>
            {onEdit && (
                <button
                    onClick={() => onEdit(cluster.clusterId)}
                    className="text-white/20 hover:text-white/60 transition-colors"
                    title="Rename cluster"
                >
                    <Pencil className="h-3 w-3" />
                </button>
            )}
            {onDelete && (
                <button
                    onClick={() => onDelete(cluster.clusterId)}
                    className="text-white/20 hover:text-red-400 transition-colors"
                    title="Delete cluster"
                >
                    <Trash2 className="h-3 w-3" />
                </button>
            )}
        </div>
    );
}

function SimilarFaceRow({
    match,
    getFileUrl,
    checked,
    onCheck,
    onOpen,
    onDelete,
}: {
    match: SimilarFaceMatch;
    getFileUrl: (relativePath: string) => Promise<string>;
    checked: boolean;
    onCheck: () => void;
    onOpen: () => void;
    onDelete: () => void;
}) {
    const [src, setSrc] = useState<string | null>(null);

    useEffect(() => {
        if (!match.cropPath) {
            setSrc(null);
            return;
        }

        let cancelled = false;
        void getFileUrl(match.cropPath)
            .then(url => {
                if (!cancelled) {
                    setSrc(url);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setSrc(null);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [match.cropPath, getFileUrl]);

    return (
        <div className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2 py-1.5">
            <input
                type="checkbox"
                checked={checked}
                onChange={onCheck}
                className="h-3.5 w-3.5 accent-[#e94560]"
                title="Use as cluster avatar"
            />
            <button
                onClick={onOpen}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                title={`Open ${match.photo.name}`}
            >
                {src ? (
                    <img src={src} alt={match.photo.name} className="h-8 w-8 rounded-full object-cover border border-white/10" />
                ) : (
                    <div className="h-8 w-8 rounded-full bg-white/10 border border-white/10" />
                )}
                <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] text-white/75">{match.photo.name}</div>
                    <div className="text-[10px] text-white/25">
                        {(match.similarity * 100).toFixed(0)}% match
                        {match.personName ? ` · ${match.personName}` : ''}
                    </div>
                </div>
            </button>
            <button
                onClick={onDelete}
                className="text-white/25 hover:text-red-400 transition-colors"
                title={`Delete ${match.photo.name}`}
            >
                <Trash2 className="h-3.5 w-3.5" />
            </button>
        </div>
    );
}

function ManageTab({ settings, onUpdateStorage }: {
    settings: FotosSettings;
    onUpdateStorage: (updates: Partial<FotosSettings['storage']>) => void;
}) {
    return (
        <>
            <SectionLabel>Ingestion</SectionLabel>

            <div>
                <label className="text-[11px] text-white/40 mb-1 block">Default mode</label>
                <select
                    value={settings.storage.defaultMode}
                    onChange={e => onUpdateStorage({ defaultMode: e.target.value as StorageMode })}
                    className="w-full bg-white/5 border border-white/10 text-[11px] text-white/60 px-2.5 py-1.5 rounded-md focus:outline-none cursor-pointer"
                >
                    <option value="reference">Reference</option>
                    <option value="metadata">Metadata</option>
                    <option value="ingest">Ingest</option>
                </select>
            </div>

            <div className="p-2.5 bg-white/5 rounded-md text-[10px] text-white/35 space-y-0.5">
                <p><span className="text-yellow-400/60 font-mono">R</span> Reference — pointer to file</p>
                <p><span className="text-blue-400/60 font-mono">M</span> Metadata — EXIF + thumbnail</p>
                <p><span className="text-green-400/60 font-mono">I</span> Ingest — full blob copy</p>
            </div>

            <SectionLabel>Sources</SectionLabel>
            <div className="space-y-1">
                <SourceRow icon={<FolderOpen className="w-3 h-3" />} label="~/Downloads" />
                <SourceRow icon={<FolderOpen className="w-3 h-3" />} label="~/Pictures" />
            </div>

            <SectionLabel>Export</SectionLabel>
            <button className="w-full flex items-center gap-2 px-2.5 py-1.5 bg-white/5 border border-white/10 rounded-md text-[11px] text-white/40 hover:text-white/60 hover:bg-white/10 transition-colors">
                <Download className="w-3 h-3" />
                Export as HTML
            </button>
        </>
    );
}

function SourceRow({ icon, label }: { icon: React.ReactNode; label: string }) {
    return (
        <div className="flex items-center gap-2 px-2.5 py-1.5 bg-white/5 rounded-md text-[11px] text-white/40">
            {icon}
            <span className="flex-1 font-mono text-[10px]">{label}</span>
            <span className="text-white/15 text-[9px]">active</span>
        </div>
    );
}

function SettingsTab({
    settings,
    onUpdateStorage,
    onUpdateDeviceName,
    onUpdateAnalysis,
    historyEnabled,
    historyReady,
    historyCurrentEventId,
    historyBranchTree,
    historyVisibleEntryCount,
    historyBranchCount,
    onHistoryEnabledChange,
    onHistoryNavigate,
    onHistoryDelete,
    currentFolderName,
    fotosModel,
    clusters,
    getFileUrl,
    onClusterSelect,
}: {
    settings: FotosSettings;
    onUpdateStorage: (updates: Partial<FotosSettings['storage']>) => void;
    onUpdateDeviceName: (name: string) => void;
    onUpdateAnalysis: (updates: Partial<FotosSettings['analysis']>) => void;
    historyEnabled: boolean;
    historyReady: boolean;
    historyCurrentEventId: string;
    historyBranchTree: FotosHistoryBranchNode[];
    historyVisibleEntryCount: number;
    historyBranchCount: number;
    onHistoryEnabledChange: (enabled: boolean) => void;
    onHistoryNavigate: (eventId: string) => void;
    onHistoryDelete: (eventId: string) => void;
    currentFolderName?: string | null;
    fotosModel: FotosModel | null;
    clusters: FaceClusterSummary[];
    getFileUrl: (relativePath: string) => Promise<string>;
    onClusterSelect: (clusterId: string) => void;
}) {
    return (
        <>
            <FotosSettingsPanel model={fotosModel} />

            <div className="border-t border-white/10 pt-4 mt-2" />

            <CollapsibleSection label="Storage" defaultOpen={false}>
                <SmallField label="Blob directory">
                    <input
                        type="text"
                        value={settings.storage.blobDir}
                        onChange={e => onUpdateStorage({ blobDir: e.target.value })}
                        className="sidebar-input"
                    />
                </SmallField>

                <SmallField label="Thumbnail directory">
                    <input
                        type="text"
                        value={settings.storage.thumbDir}
                        onChange={e => onUpdateStorage({ thumbDir: e.target.value })}
                        className="sidebar-input"
                    />
                </SmallField>

                <SmallField label="Thumb size (px)">
                    <input
                        type="number"
                        value={settings.storage.thumbSize}
                        onChange={e => onUpdateStorage({ thumbSize: parseInt(e.target.value) || 400 })}
                        className="sidebar-input w-20"
                        min={100} max={1200} step={100}
                    />
                </SmallField>

                <SmallField label="Quota (MB, 0 = unlimited)">
                    <input
                        type="number"
                        value={settings.storage.quotaMb}
                        onChange={e => onUpdateStorage({ quotaMb: parseInt(e.target.value) || 0 })}
                        className="sidebar-input w-20"
                        min={0} step={100}
                    />
                </SmallField>

                <SmallField label="Min copies before drop">
                    <input
                        type="number"
                        value={settings.storage.minCopies}
                        onChange={e => onUpdateStorage({ minCopies: parseInt(e.target.value) || 1 })}
                        className="sidebar-input w-16"
                        min={1} max={10}
                    />
                </SmallField>
            </CollapsibleSection>

            <CollapsibleSection label="Image AI">
                <SmallField label="Cluster sensitivity">
                    <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                            <input
                                type="range"
                                min={0}
                                max={100}
                                step={1}
                                value={settings.analysis.clusterSensitivity}
                                onChange={e => onUpdateAnalysis({ clusterSensitivity: parseInt(e.target.value, 10) || 0 })}
                                className="flex-1 accent-[#e94560] h-1"
                            />
                            <span className="w-8 text-right text-[10px] text-white/35 tabular-nums">
                                {settings.analysis.clusterSensitivity}
                            </span>
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-white/25">
                            <span>Merge more</span>
                            <span>Split more</span>
                        </div>
                        <p className="text-[10px] leading-relaxed text-white/28">
                            Lower values keep nearby faces together. Higher values split similar faces into separate clusters.
                        </p>
                    </div>
                </SmallField>
            </CollapsibleSection>

            <CollapsibleSection label="Breadcrumb History" defaultOpen={historyEnabled || historyVisibleEntryCount > 0}>
                <label className="flex items-start gap-2 rounded-md border border-white/10 bg-white/5 px-2.5 py-2">
                    <input
                        type="checkbox"
                        checked={historyEnabled}
                        onChange={event => onHistoryEnabledChange(event.target.checked)}
                        className="mt-0.5 h-3.5 w-3.5 accent-[#e94560]"
                    />
                    <div className="space-y-1">
                        <div className="text-[11px] text-white/72">Record breadcrumb history</div>
                        <p className="text-[10px] leading-relaxed text-white/30">
                            Keep branchable gallery places in synced settings so trusted instances can resume where you left off.
                        </p>
                    </div>
                </label>

                <div className="rounded-md bg-white/[0.035] px-2.5 py-2 text-[10px] text-white/30">
                    {historyReady
                        ? `${historyVisibleEntryCount} saved place${historyVisibleEntryCount === 1 ? '' : 's'} across ${historyBranchCount} branch${historyBranchCount === 1 ? '' : 'es'}`
                        : 'Loading synced history...'}
                </div>

                {!historyEnabled && historyVisibleEntryCount > 0 && (
                    <div className="text-[10px] leading-relaxed text-white/24">
                        Recording is paused. Existing branches stay available until you delete them.
                    </div>
                )}

                {historyVisibleEntryCount === 0 ? (
                    <div className="rounded-md border border-dashed border-white/10 px-2.5 py-2 text-[10px] text-white/24">
                        {historyEnabled ? 'Open folders and follow breadcrumbs to start a shared history.' : 'Enable recording to save breadcrumb branches here.'}
                    </div>
                ) : (
                    <div className="space-y-1.5">
                        {historyBranchTree.map(node => (
                            <HistoryBranchRow
                                key={node.entry.eventId}
                                node={node}
                                depth={0}
                                currentEventId={historyCurrentEventId}
                                currentFolderName={currentFolderName ?? null}
                                onNavigate={onHistoryNavigate}
                                onDelete={onHistoryDelete}
                            />
                        ))}
                    </div>
                )}
            </CollapsibleSection>

            {clusters.length > 0 && (
                <CollapsibleSection label="Detected Faces">
                    {clusters.map(cluster => (
                        <ClusterCard
                            key={cluster.clusterId}
                            cluster={cluster}
                            active={false}
                            onClick={() => onClusterSelect(cluster.clusterId)}
                            getFileUrl={getFileUrl}
                        />
                    ))}
                </CollapsibleSection>
            )}

            <CollapsibleSection label="Device">
                <SmallField label="Device name">
                    <input
                        type="text"
                        value={settings.device.name}
                        onChange={e => onUpdateDeviceName(e.target.value)}
                        className="sidebar-input"
                    />
                </SmallField>
            </CollapsibleSection>
        </>
    );
}

function SmallField({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="block">
            <span className="text-[10px] text-white/30 mb-0.5 block">{label}</span>
            {children}
        </label>
    );
}

function HistoryBranchRow({
    node,
    depth,
    currentEventId,
    currentFolderName,
    onNavigate,
    onDelete,
}: {
    node: FotosHistoryBranchNode;
    depth: number;
    currentEventId: string;
    currentFolderName: string | null;
    onNavigate: (eventId: string) => void;
    onDelete: (eventId: string) => void;
}) {
    const label = node.entry.breadcrumbs[node.entry.breadcrumbs.length - 1]
        ?? node.entry.folderName
        ?? node.entry.state.folderName
        ?? 'Library';
    const trail = node.entry.breadcrumbs.join(' / ');
    const folderName = node.entry.folderName ?? node.entry.state.folderName ?? '';
    const canNavigate = folderName.length > 0
        ? folderName === (currentFolderName ?? '')
        : currentFolderName === null;
    const isCurrent = node.entry.eventId === currentEventId;

    return (
        <div className="space-y-1">
            <div
                className="rounded-md border border-white/8 bg-white/[0.035] px-2.5 py-2"
                style={{ marginLeft: `${depth * 14}px` }}
            >
                <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1 space-y-1">
                        <div className="truncate text-[11px] text-white/72">
                            {label}
                        </div>
                        <div className="truncate text-[9px] text-white/25">
                            {trail || folderName || 'Library'}
                        </div>
                        <div className="text-[9px] text-white/18">
                            {new Date(node.entry.createdAt).toLocaleString()}
                        </div>
                        {!canNavigate && (
                            <div className="text-[9px] leading-relaxed text-white/18">
                                Open {folderName || 'this folder'} to restore this branch.
                            </div>
                        )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                        <button
                            type="button"
                            onClick={() => onNavigate(node.entry.eventId)}
                            disabled={!canNavigate || isCurrent}
                            className={`rounded-md px-2 py-1 text-[10px] transition-colors ${
                                isCurrent
                                    ? 'bg-[#e94560]/15 text-[#ff9db0]'
                                    : canNavigate
                                        ? 'bg-white/6 text-white/55 hover:bg-white/10 hover:text-white/72'
                                        : 'bg-white/4 text-white/20 cursor-not-allowed'
                            }`}
                        >
                            {isCurrent ? 'Current' : 'Open'}
                        </button>
                        <button
                            type="button"
                            onClick={() => onDelete(node.entry.eventId)}
                            className="rounded-md p-1.5 text-white/24 transition-colors hover:bg-white/8 hover:text-white/52"
                            aria-label={`Delete history entry ${label}`}
                        >
                            <Trash2 className="w-3 h-3" />
                        </button>
                    </div>
                </div>
            </div>

            {node.children.map(child => (
                <HistoryBranchRow
                    key={child.entry.eventId}
                    node={child}
                    depth={depth + 1}
                    currentEventId={currentEventId}
                    currentFolderName={currentFolderName}
                    onNavigate={onNavigate}
                    onDelete={onDelete}
                />
            ))}
        </div>
    );
}
