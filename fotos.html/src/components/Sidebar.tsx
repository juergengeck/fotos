import { useState } from 'react';
import { Search, FolderOpen, Download, SlidersHorizontal, ChevronLeft, X } from 'lucide-react';
import type { FotosSettings, StorageMode, DisplaySettings } from '@/types/fotos';

type Tab = 'browse' | 'manage' | 'settings';

interface SidebarProps {
    tags: [string, number][];
    activeTag: string | null;
    onTagClick: (tag: string | null) => void;
    searchQuery: string;
    onSearchChange: (q: string) => void;
    photoCount: number;
    totalCount: number;
    settings: FotosSettings;
    onUpdateStorage: (updates: Partial<FotosSettings['storage']>) => void;
    onUpdateDisplay: (updates: Partial<DisplaySettings>) => void;
    onUpdateDeviceName: (name: string) => void;
    folderName?: string | null;
    onOpenFolder?: () => void;
    onRescan?: () => void;
    faceSearchActive?: boolean;
    onClearFaceSearch?: () => void;
}

export function Sidebar({
    tags, activeTag, onTagClick,
    searchQuery, onSearchChange,
    photoCount, totalCount,
    settings, onUpdateStorage, onUpdateDisplay, onUpdateDeviceName,
    folderName, onOpenFolder, onRescan,
    faceSearchActive, onClearFaceSearch
}: SidebarProps) {
    const [tab, setTab] = useState<Tab>('browse');
    const [mobileOpen, setMobileOpen] = useState(false);

    return (
        <>
        {/* Mobile toggle — chevron in lower-right */}
        {!mobileOpen && (
            <button
                onClick={() => setMobileOpen(true)}
                className="md:hidden fixed bottom-6 right-4 z-50 w-10 h-10 flex items-center justify-center bg-black/70 backdrop-blur-sm rounded-full border border-white/15"
                aria-label="Open sidebar"
            >
                <ChevronLeft className="w-5 h-5 text-white/70" />
            </button>
        )}

        {/* Backdrop for mobile */}
        {mobileOpen && (
            <div
                className="md:hidden fixed inset-0 z-50 bg-black/50"
                onClick={() => setMobileOpen(false)}
            />
        )}

        <aside className={`
            w-64 h-full flex flex-col bg-[#0d0d0d] border-l border-white/10 shrink-0
            max-md:fixed max-md:right-0 max-md:top-0 max-md:z-50 max-md:transition-transform max-md:duration-200
            ${mobileOpen ? 'max-md:translate-x-0' : 'max-md:translate-x-full'}
        `}>
            {/* Mobile close + Tabs */}
            <div className="flex items-center border-b border-white/10">
                <button
                    onClick={() => setMobileOpen(false)}
                    className="md:hidden p-2 text-white/40 hover:text-white/70"
                    aria-label="Close sidebar"
                >
                    <X className="w-4 h-4" />
                </button>
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
                        photoCount={photoCount}
                        totalCount={totalCount}
                        thumbScale={settings.display.thumbScale}
                        onThumbScaleChange={s => onUpdateDisplay({ thumbScale: s })}
                        sortBy={settings.display.sortBy}
                        onSortByChange={sortBy => onUpdateDisplay({ sortBy })}
                        sortOrder={settings.display.sortOrder}
                        onSortOrderChange={sortOrder => onUpdateDisplay({ sortOrder })}
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
                    />
                )}
            </div>
        </aside>
        </>
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

function BrowseTab({
    tags, activeTag, onTagClick,
    searchQuery, onSearchChange,
    photoCount, totalCount,
    thumbScale, onThumbScaleChange,
    sortBy, onSortByChange,
    sortOrder, onSortOrderChange
}: {
    tags: [string, number][];
    activeTag: string | null;
    onTagClick: (tag: string | null) => void;
    searchQuery: string;
    onSearchChange: (q: string) => void;
    photoCount: number;
    totalCount: number;
    thumbScale: number;
    onThumbScaleChange: (s: number) => void;
    sortBy: string;
    onSortByChange: (s: 'date' | 'name' | 'added') => void;
    sortOrder: string;
    onSortOrderChange: (o: 'asc' | 'desc') => void;
}) {
    return (
        <>
            {/* Stats */}
            <div className="text-xs text-white/35">
                {photoCount === totalCount
                    ? `${totalCount} photos`
                    : `${photoCount} of ${totalCount}`}
            </div>

            {/* Search */}
            <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/25" />
                <input
                    type="search"
                    placeholder="Search..."
                    value={searchQuery}
                    onChange={e => onSearchChange(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 bg-white/5 border border-white/10 rounded-md text-xs text-white placeholder:text-white/25 focus:outline-none focus:border-white/20"
                />
            </div>

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

function SettingsTab({ settings, onUpdateStorage, onUpdateDeviceName }: {
    settings: FotosSettings;
    onUpdateStorage: (updates: Partial<FotosSettings['storage']>) => void;
    onUpdateDeviceName: (name: string) => void;
}) {
    return (
        <>
            <SectionLabel>Storage</SectionLabel>

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

            <SectionLabel>Device</SectionLabel>

            <SmallField label="Device name">
                <input
                    type="text"
                    value={settings.device.name}
                    onChange={e => onUpdateDeviceName(e.target.value)}
                    className="sidebar-input"
                />
            </SmallField>
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
