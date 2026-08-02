import {CircleHelp, FolderOpen, PanelRight, Search, Settings, Share2} from 'lucide-react';

interface AppHeaderProps {
    folderName: string;
    mode: 'images' | 'clusters';
    query: string;
    resultCount: number;
    totalCount: number;
    identityReady: boolean;
    identityLabel?: string | null;
    backgroundStatus?: string | null;
    galleryShareCount?: number;
    facetsOpen: boolean;
    onModeChange: (mode: 'images' | 'clusters') => void;
    onQueryChange: (query: string) => void;
    onToggleFacets: () => void;
    onOpenSharing: () => void;
    onOpenSettings: () => void;
    onOpenShortcuts: () => void;
}

export function AppHeader({
    folderName,
    mode,
    query,
    resultCount,
    totalCount,
    identityReady,
    identityLabel,
    backgroundStatus,
    galleryShareCount = 0,
    facetsOpen,
    onModeChange,
    onQueryChange,
    onToggleFacets,
    onOpenSharing,
    onOpenSettings,
    onOpenShortcuts,
}: AppHeaderProps) {
    const searchScope = mode === 'images' ? 'Photos' : 'People';
    return (
        <header className="shrink-0 border-b border-white/10 bg-[#0d0d0d]/95 px-2 py-2 text-white backdrop-blur-md sm:px-3">
            <div className="flex min-h-11 flex-wrap items-center gap-2">
                <button type="button" onClick={onToggleFacets} className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg px-2 text-left hover:bg-white/8" aria-expanded={facetsOpen} aria-label={`${facetsOpen ? 'Hide' : 'Show'} filters and libraries`}>
                    <FolderOpen className="h-4 w-4 shrink-0 text-white/55" />
                    <span className="max-w-36 truncate text-sm font-medium text-white/85">{folderName}</span>
                </button>

                <div className="flex min-h-11 items-center rounded-lg border border-white/10 bg-white/[0.04] p-1" aria-label="Primary view">
                    <button type="button" aria-pressed={mode === 'images'} onClick={() => onModeChange('images')} className={`min-h-9 rounded-md px-3 text-xs font-medium ${mode === 'images' ? 'bg-white/12 text-white' : 'text-white/55 hover:text-white'}`}>Photos</button>
                    <button type="button" aria-pressed={mode === 'clusters'} onClick={() => onModeChange('clusters')} className={`min-h-9 rounded-md px-3 text-xs font-medium ${mode === 'clusters' ? 'bg-white/12 text-white' : 'text-white/55 hover:text-white'}`}>People</button>
                </div>

                <label className="order-3 flex min-h-11 min-w-[min(100%,18rem)] flex-1 items-center gap-2 rounded-lg border border-white/12 bg-black/30 px-3 focus-within:border-[#ff9db0]/70 sm:order-none">
                    <Search className="h-4 w-4 shrink-0 text-white/55" />
                    <span className="rounded bg-white/8 px-1.5 py-1 text-[12px] text-white/55">{searchScope}</span>
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

                <div className="ml-auto flex items-center gap-1">
                    <span className={`hidden min-h-9 items-center rounded-full border px-2.5 text-[12px] sm:flex ${identityReady ? 'border-emerald-400/25 bg-emerald-400/8 text-emerald-100' : 'border-white/10 bg-white/5 text-white/55'}`} title={identityLabel ?? undefined}>
                        {identityReady ? 'Sync ready' : 'Local only'}
                    </span>
                    <button type="button" onClick={onOpenSharing} className={`relative flex h-11 min-w-11 items-center justify-center rounded-lg px-2 hover:bg-white/10 ${galleryShareCount > 0 ? 'text-emerald-200' : 'text-white/60 hover:text-white'}`} aria-label={galleryShareCount > 0 ? `Open sharing, gallery shared with ${galleryShareCount} ${galleryShareCount === 1 ? 'person' : 'people'}` : 'Open sharing'}>
                        <Share2 className="h-4 w-4" />
                        {galleryShareCount > 0 ? <span className="ml-1 text-xs tabular-nums">{galleryShareCount}</span> : null}
                    </button>
                    <button type="button" onClick={onOpenShortcuts} className="flex h-11 w-11 items-center justify-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white" aria-label="Open keyboard shortcuts" title="Keyboard shortcuts (?)"><CircleHelp className="h-4 w-4" /></button>
                    <button type="button" onClick={onOpenSettings} className="flex h-11 w-11 items-center justify-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white" aria-label="Open settings"><Settings className="h-4 w-4" /></button>
                    <button type="button" onClick={onToggleFacets} className="flex h-11 w-11 items-center justify-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white" aria-label={`${facetsOpen ? 'Hide' : 'Show'} filters`} aria-expanded={facetsOpen}><PanelRight className="h-4 w-4" /></button>
                </div>
            </div>
            {backgroundStatus ? <div role="status" aria-live="polite" className="mt-1 truncate px-2 text-[12px] text-white/60">{backgroundStatus}</div> : null}
        </header>
    );
}
