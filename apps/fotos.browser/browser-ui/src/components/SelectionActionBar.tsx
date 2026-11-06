import {useState} from 'react';
import {Download, FolderPlus, Share2, Users, X} from 'lucide-react';

interface SelectionActionBarProps {
    photoCount: number;
    peopleCount: number;
    hiddenCount: number;
    visibleDomain: 'photos' | 'people';
    mobile?: boolean;
    exporting?: boolean;
    collections: Array<{id: string; name: string}>;
    onClear: () => void;
    onClearHidden: () => void;
    onSelectAllVisible: () => void;
    onCreateCollection: (name: string) => boolean;
    onAddToCollection: (collectionId: string) => void;
    onShareSelection: () => void;
    onExportPhotos?: () => Promise<void> | void;
    onNamePeople: (name: string) => Promise<void> | void;
    onGroupPeople: () => void;
    mergeTargetLabel?: string;
    onMergePeople?: () => void;
}

export function SelectionActionBar({
    photoCount,
    peopleCount,
    hiddenCount,
    visibleDomain,
    mobile = false,
    exporting = false,
    collections,
    onClear,
    onClearHidden,
    onSelectAllVisible,
    onCreateCollection,
    onAddToCollection,
    onShareSelection,
    onExportPhotos,
    onNamePeople,
    onGroupPeople,
    mergeTargetLabel,
    onMergePeople,
}: SelectionActionBarProps) {
    const [panel, setPanel] = useState<'collection' | 'name' | null>(null);
    const [draft, setDraft] = useState('');
    const total = photoCount + peopleCount;
    if (total === 0) return null;

    const submitDraft = () => {
        const value = draft.trim();
        if (!value) return;
        if (panel === 'collection') {
            if (!onCreateCollection(value)) return;
        } else if (panel === 'name') {
            void onNamePeople(value);
        }
        setDraft('');
        setPanel(null);
    };

    return (
        <section
            aria-label="Selection actions"
            className={`absolute ${mobile ? 'bottom-20 landscape:bottom-3' : 'bottom-3'} left-1/2 z-40 w-[min(94vw,760px)] -translate-x-1/2 rounded-xl border border-white/15 bg-black/90 p-2.5 shadow-2xl backdrop-blur-md view-enter`}
        >
            <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1 text-xs font-medium text-white/85" aria-live="polite">
                    {photoCount > 0 ? `${photoCount} photo${photoCount === 1 ? '' : 's'}` : ''}
                    {photoCount > 0 && peopleCount > 0 ? ', ' : ''}
                    {peopleCount > 0 ? `${peopleCount} ${peopleCount === 1 ? 'person' : 'people'}` : ''}
                    <span className="text-white/55"> selected</span>
                    {hiddenCount > 0 ? <span className="ml-1 text-amber-200/85">· {hiddenCount} hidden</span> : null}
                </div>
                {hiddenCount > 0 ? (
                    <button type="button" onClick={onClearHidden} className="min-h-11 rounded-md px-3 text-xs text-amber-100 hover:bg-amber-500/15">
                        Clear hidden
                    </button>
                ) : null}
                <button type="button" onClick={onSelectAllVisible} className="min-h-11 rounded-md px-3 text-xs text-white/70 hover:bg-white/10 hover:text-white">
                    Select all visible {visibleDomain}
                </button>
                <button type="button" onClick={onClear} aria-label="Clear selection" className="flex h-11 w-11 items-center justify-center rounded-md text-white/65 hover:bg-white/10 hover:text-white">
                    <X className="h-4 w-4" />
                </button>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-white/10 pt-2">
                <button type="button" onClick={onShareSelection} className="flex min-h-11 items-center gap-2 rounded-md bg-[#e94560] px-3 text-xs font-medium text-white hover:bg-[#d13354]">
                    <Share2 className="h-4 w-4" /> Share selection…
                </button>
                <button type="button" onClick={() => { setPanel(panel === 'collection' ? null : 'collection'); setDraft(''); }} className="flex min-h-11 items-center gap-2 rounded-md bg-white/10 px-3 text-xs text-white/85 hover:bg-white/15">
                    <FolderPlus className="h-4 w-4" /> Add to collection
                </button>
                {peopleCount > 0 ? (
                    <>
                        <button type="button" onClick={() => { setPanel(panel === 'name' ? null : 'name'); setDraft(''); }} className="flex min-h-11 items-center gap-2 rounded-md bg-white/10 px-3 text-xs text-white/85 hover:bg-white/15">
                            <Users className="h-4 w-4" /> Name…
                        </button>
                        {peopleCount > 1 ? (
                            <button type="button" onClick={onGroupPeople} className="min-h-11 rounded-md px-3 text-xs text-white/70 hover:bg-white/10 hover:text-white">
                                Group as one person
                            </button>
                        ) : null}
                        {onMergePeople && mergeTargetLabel ? (
                            <button type="button" onClick={onMergePeople} className="min-h-11 rounded-md px-3 text-xs text-white/70 hover:bg-white/10 hover:text-white">
                                Merge into {mergeTargetLabel}
                            </button>
                        ) : null}
                    </>
                ) : null}
                {onExportPhotos ? (
                    <button
                        type="button"
                        onClick={() => { void onExportPhotos(); }}
                        disabled={exporting || peopleCount > 0 || photoCount === 0}
                        title={peopleCount > 0 ? 'Export applies only to photo-only selections.' : undefined}
                        className="flex min-h-11 items-center gap-2 rounded-md px-3 text-xs text-white/70 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                    >
                        <Download className="h-4 w-4" /> Export
                    </button>
                ) : null}
            </div>

            {panel ? (
                <form className="mt-2 flex flex-wrap gap-2 rounded-lg border border-white/10 bg-white/[0.04] p-2" onSubmit={event => { event.preventDefault(); submitDraft(); }}>
                    {panel === 'collection' && collections.length > 0 ? (
                        <select
                            aria-label="Existing collection"
                            defaultValue=""
                            onChange={event => {
                                if (!event.target.value) return;
                                onAddToCollection(event.target.value);
                                setPanel(null);
                            }}
                            className="min-h-11 rounded-md border border-white/15 bg-[#151515] px-3 text-xs text-white"
                        >
                            <option value="" disabled>Add to existing…</option>
                            {collections.map(collection => <option key={collection.id} value={collection.id}>{collection.name}</option>)}
                        </select>
                    ) : null}
                    <input
                        autoFocus
                        value={draft}
                        onChange={event => setDraft(event.target.value)}
                        placeholder={panel === 'collection' ? 'New collection name' : peopleCount > 1 ? 'Name selected people' : 'Name selected person'}
                        aria-label={panel === 'collection' ? 'New collection name' : 'Name selected people'}
                        className="min-h-11 min-w-48 flex-1 rounded-md border border-white/15 bg-black/35 px-3 text-sm text-white placeholder:text-white/55 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ff9db0]"
                    />
                    <button type="submit" disabled={!draft.trim()} className="min-h-11 rounded-md bg-[#e94560] px-4 text-xs font-medium text-white disabled:opacity-35">
                        {panel === 'collection' ? 'Create' : 'Apply name'}
                    </button>
                </form>
            ) : null}
        </section>
    );
}
