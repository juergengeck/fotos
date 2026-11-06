import {CircleHelp, FolderOpen, PanelRightClose, Search, Share2} from 'lucide-react';

interface ControlPaneHeaderProps {
    folderName: string;
    identityReady: boolean;
    identityLabel?: string | null;
    backgroundStatus?: string | null;
    galleryShareCount?: number;
    onOpenSharing: () => void;
    onOpenShortcuts: () => void;
    onClose?: () => void;
}

export function ControlPaneHeader({
    folderName,
    identityReady,
    identityLabel,
    backgroundStatus,
    galleryShareCount = 0,
    onOpenSharing,
    onOpenShortcuts,
    onClose,
}: ControlPaneHeaderProps) {
    return (
        <div className="shrink-0 border-b border-white/10 px-2 py-1.5">
            <div className="flex min-h-11 items-center gap-1">
                <FolderOpen className="ml-1 h-4 w-4 shrink-0 text-white/55" />
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-white/85" title={folderName}>{folderName}</div>
                    <div className="truncate text-[12px] text-white/55" title={identityLabel ?? undefined}>
                        {identityReady ? 'Sync ready' : 'Local only'}
                    </div>
                </div>
                <button
                    type="button"
                    onClick={onOpenSharing}
                    className={`flex h-11 min-w-11 items-center justify-center rounded-lg px-2 hover:bg-white/10 ${galleryShareCount > 0 ? 'text-emerald-200' : 'text-white/60 hover:text-white'}`}
                    aria-label={galleryShareCount > 0 ? `Open sharing, gallery shared with ${galleryShareCount} ${galleryShareCount === 1 ? 'person' : 'people'}` : 'Open sharing'}
                >
                    <Share2 className="h-4 w-4" />
                    {galleryShareCount > 0 ? <span className="ml-1 text-xs tabular-nums">{galleryShareCount}</span> : null}
                </button>
                <button type="button" onClick={onOpenShortcuts} className="flex h-11 w-11 items-center justify-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white" aria-label="Open keyboard shortcuts" title="Keyboard shortcuts (?)">
                    <CircleHelp className="h-4 w-4" />
                </button>
                {onClose ? (
                    <button type="button" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white" aria-label="Close control pane" title="Maximize gallery">
                        <PanelRightClose className="h-4 w-4" />
                    </button>
                ) : null}
            </div>
            {backgroundStatus ? <div role="status" aria-live="polite" className="truncate px-1 pb-1 text-[12px] text-white/60">{backgroundStatus}</div> : null}
        </div>
    );
}

interface BrowseControlsProps {
    mode: 'images' | 'clusters';
    query: string;
    resultCount: number;
    totalCount: number;
    onModeChange: (mode: 'images' | 'clusters') => void;
    onQueryChange: (query: string) => void;
}

export function BrowseControls({
    mode,
    query,
    resultCount,
    totalCount,
    onModeChange,
    onQueryChange,
}: BrowseControlsProps) {
    const searchScope = mode === 'images' ? 'Photos' : 'People';
    return (
        <div className="space-y-2">
            <div className="grid min-h-11 grid-cols-2 rounded-lg border border-white/10 bg-white/[0.04] p-1" aria-label="Primary view">
                <button type="button" aria-pressed={mode === 'images'} onClick={() => onModeChange('images')} className={`min-h-9 rounded-md px-3 text-xs font-medium ${mode === 'images' ? 'bg-white/12 text-white' : 'text-white/55 hover:text-white'}`}>Photos</button>
                <button type="button" aria-pressed={mode === 'clusters'} onClick={() => onModeChange('clusters')} className={`min-h-9 rounded-md px-3 text-xs font-medium ${mode === 'clusters' ? 'bg-white/12 text-white' : 'text-white/55 hover:text-white'}`}>People</button>
            </div>
            <label className="flex min-h-11 items-center gap-2 rounded-lg border border-white/12 bg-black/30 px-3 focus-within:border-[#ff9db0]/70">
                <Search className="h-4 w-4 shrink-0 text-white/55" />
                <input
                    type="search"
                    value={query}
                    onChange={event => onQueryChange(event.target.value)}
                    placeholder={`Search ${searchScope.toLowerCase()}…`}
                    aria-label={`Search ${searchScope.toLowerCase()}`}
                    className="min-w-0 flex-1 bg-transparent py-2 text-sm text-white outline-none placeholder:text-white/55"
                />
                <span className="whitespace-nowrap text-[12px] tabular-nums text-white/50" aria-live="polite">{resultCount}/{totalCount}</span>
            </label>
        </div>
    );
}
