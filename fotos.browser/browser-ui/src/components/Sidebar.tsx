import { useEffect, useState, useRef, useCallback } from 'react';
import { Search, FolderOpen, Download, SlidersHorizontal, ChevronLeft, ChevronRight, ChevronDown, Trash2, Check, Plus, Link, Compass, Settings } from 'lucide-react';
import type { FotosSettings, StorageMode, DisplaySettings, PhotoEntry } from '@/types/fotos';
import type { FotosModel } from '@/lib/onecore-boot';
import type { FaceClusterSummary, SimilarFaceMatch } from '@/lib/cluster-gallery';
import type { FotosCollectionSummary } from '@/lib/fotosCollections';
import type { FotosHistoryBranchNode } from '@/lib/fotosHistorySettings';
import { useDeviceSettings, type FotosDeviceSettings } from '@/hooks/useDeviceSettings';
import { readStoredSidebarTab, writeStoredSidebarTab } from '@/lib/authFlowState';
import { FotosSettings as FotosSettingsPanel } from './FotosSettings';
import { InlineRenameField } from './InlineRenameField';
import { LLMComparisonPanel } from './LLMComparisonPanel';
import { ShareWithField, type SharePeerOption } from './ShareWithField';
import type { ManagedFolder } from '@/hooks/useFolderAccess';

type Tab = 'browse' | 'settings';

interface SidebarProps {
    tags: [string, number][];
    activeTag: string | null;
    onTagClick: (tag: string | null) => void;
    searchQuery: string;
    onSearchChange: (q: string) => void;
    browseSummary: string;
    settings: FotosSettings;
    acceptSharing: boolean;
    onUpdateStorage: (updates: Partial<FotosSettings['storage']>) => void;
    onUpdateDisplay: (updates: Partial<DisplaySettings>) => void;
    onUpdateDeviceName: (name: string) => void;
    onUpdateAnalysis: (updates: Partial<FotosSettings['analysis']>) => void;
    onAcceptSharingChange: (enabled: boolean) => void;
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
    folders?: ManagedFolder[];
    onOpenFolder?: () => void;
    onSelectFolder?: (folderId: string) => void;
    onRemoveFolder?: (folderId: string) => void;
    onRescan?: () => void;
    onReanalyze?: () => void;
    canClaimAuthorshipOnIngest: boolean;
    claimAuthorshipOnIngest: boolean;
    onClaimAuthorshipOnIngestChange: (enabled: boolean) => void;
    llmComparisonPhoto?: PhotoEntry | null;
    llmComparisonPhotoLabel?: string;
    faceSearchActive?: boolean;
    onClearFaceSearch?: () => void;
    fotosModel?: FotosModel | null;
    mobile?: boolean;
    galleryMode: 'images' | 'clusters';
    onGalleryModeChange: (mode: 'images' | 'clusters') => void;
    collections: FotosCollectionSummary[];
    activeCollectionId: string | null;
    onCollectionSelect: (collectionId: string | null) => void;
    selectedPhotoCount: number;
    onSelectAllVisiblePhotos: () => void;
    onExportSelectedPhotos?: () => Promise<void> | void;
    exportSelectedPhotosDisabled?: boolean;
    clusterSelectionEnabled: boolean;
    onClusterSelectionModeChange: (enabled: boolean) => void;
    selectedClusterIds: string[];
    selectedClusterCount: number;
    onToggleSelectedCluster: (clusterId: string) => void;
    onClearCollectionSelection: () => void;
    onCreateCollection: (name: string) => boolean;
    onRenameCollection: (collectionId: string, name: string) => void;
    onDeleteCollection: (collectionId: string) => void;
    clusters: FaceClusterSummary[];
    allClusters: FaceClusterSummary[];
    people: FaceClusterSummary[];
    groups: FaceClusterSummary[];
    similarFaces: SimilarFaceMatch[];
    searchClusters: FaceClusterSummary[];
    activeClusterId: string | null;
    onClusterSelect: (clusterId: string | null) => void;
    getFileUrl: (relativePath: string) => Promise<string>;
    onAssociateFaceWithCluster: (photoHash: string, faceIndex: number, clusterId: string) => void;
    onMergeFaceClusters: (targetClusterId: string, sourceClusterIds: string[]) => void;
    onGroupFaceClustersAsPerson: (clusterIds: string[]) => void;
    onSeparatePersonGroup: (personId: string) => void;
    onOpenSimilarFace: (match: SimilarFaceMatch) => void;
    onDeletePhoto: (hash: string) => void;
    onRenameFace: (clusterId: string, name: string) => Promise<void> | void;
    onDeleteFace: (clusterId: string) => void;
    galleryShareInvite?: {
        url: string;
        pin: string;
        sharedCount?: number;
        payload: {
            expiresAt: string;
        };
    } | null;
    creatingGalleryShareInvite?: boolean;
    onCreateGalleryShareInvite?: () => Promise<void> | void;
    sharePeerOptions: SharePeerOption[];
    gallerySharePersonIds: string[];
    collectionSharePersonIds: Record<string, string[]>;
    clusterSharePersonIds: Record<string, string[]>;
    onGalleryShareChange: (personIds: string[]) => Promise<void> | void;
    onCollectionShareChange: (collectionId: string, personIds: string[]) => Promise<void> | void;
    onClusterShareChange: (clusterId: string, personIds: string[]) => Promise<void> | void;
    onClusterContextMenu?: (cluster: FaceClusterSummary, event: React.MouseEvent | React.TouchEvent) => void;
    onCollectionContextMenu?: (collection: FotosCollectionSummary, event: React.MouseEvent | React.TouchEvent) => void;
    showOnboarding?: boolean;
    onDismissOnboarding?: () => void;
}

export function Sidebar({
    tags, activeTag, onTagClick,
    searchQuery, onSearchChange,
    browseSummary,
    settings, acceptSharing, onUpdateStorage, onUpdateDisplay, onUpdateDeviceName, onUpdateAnalysis,
    historyEnabled, historyReady, historyCurrentEventId, historyBranchTree,
    historyVisibleEntryCount, historyBranchCount,
    onHistoryEnabledChange, onHistoryNavigate, onHistoryDelete, currentFolderName,
    folderName, folders, onOpenFolder, onSelectFolder, onRemoveFolder, onRescan, onReanalyze,
    canClaimAuthorshipOnIngest, claimAuthorshipOnIngest, onClaimAuthorshipOnIngestChange,
    llmComparisonPhoto, llmComparisonPhotoLabel,
    faceSearchActive, onClearFaceSearch,
    fotosModel,
    mobile,
    galleryMode, onGalleryModeChange,
    collections,
    activeCollectionId,
    onCollectionSelect,
    selectedPhotoCount,
    onSelectAllVisiblePhotos,
    onExportSelectedPhotos,
    exportSelectedPhotosDisabled,
    clusterSelectionEnabled,
    onClusterSelectionModeChange,
    selectedClusterIds,
    selectedClusterCount,
    onToggleSelectedCluster,
    onClearCollectionSelection,
    onCreateCollection,
    onRenameCollection,
    onDeleteCollection,
    clusters, people, groups,
    allClusters,
    similarFaces, searchClusters,
    activeClusterId, onClusterSelect,
    getFileUrl,
    onAssociateFaceWithCluster,
    onMergeFaceClusters,
    onGroupFaceClustersAsPerson,
    onSeparatePersonGroup,
    onOpenSimilarFace,
    onDeletePhoto,
    onRenameFace,
    onDeleteFace,
    galleryShareInvite,
    creatingGalleryShareInvite,
    onCreateGalleryShareInvite,
    sharePeerOptions,
    gallerySharePersonIds,
    collectionSharePersonIds,
    clusterSharePersonIds,
    onGalleryShareChange,
    onCollectionShareChange,
    onClusterShareChange,
    onAcceptSharingChange,
    onCollectionContextMenu,
    showOnboarding,
    onDismissOnboarding,
}: SidebarProps) {
    const [tab, setTab] = useState<Tab>(() => readStoredSidebarTab() ?? 'browse');
    const [collapsed, setCollapsed] = useState(false);
    const [mobileSheetState, setMobileSheetState] = useState<'collapsed' | 'half' | 'full'>('collapsed');

    const startYRef = useRef(0);
    const startStateRef = useRef<'collapsed' | 'half' | 'full'>('collapsed');

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        const touch = e.touches[0];
        if (!touch) return;
        startYRef.current = touch.clientY;
        startStateRef.current = mobileSheetState;
    }, [mobileSheetState]);

    const handleTouchEnd = useCallback((e: React.TouchEvent) => {
        const touch = e.changedTouches[0];
        if (!touch) return;
        const deltaY = touch.clientY - startYRef.current;
        const threshold = 50; // 50px threshold

        if (deltaY < -threshold) {
            // Dragged up
            if (startStateRef.current === 'collapsed') {
                setMobileSheetState('half');
            } else if (startStateRef.current === 'half') {
                setMobileSheetState('full');
            }
        } else if (deltaY > threshold) {
            // Dragged down
            if (startStateRef.current === 'full') {
                setMobileSheetState('half');
            } else if (startStateRef.current === 'half') {
                setMobileSheetState('collapsed');
            }
        }
    }, []);

    const handleTabClick = useCallback((t: Tab) => {
        if (mobileSheetState === 'collapsed') {
            setTab(t);
            setMobileSheetState('half');
        } else if (tab === t) {
            setMobileSheetState('collapsed');
        } else {
            setTab(t);
        }
    }, [tab, mobileSheetState]);

    useEffect(() => {
        writeStoredSidebarTab(tab);
    }, [tab]);

    // Mobile: inline panel, no overlay/drawer
    if (mobile) {
        return (
            <>
                {/* Backdrop for mobile bottom sheet */}
                {mobileSheetState !== 'collapsed' && (
                    <div 
                        className="fixed inset-0 z-45 bg-black/50 backdrop-blur-sm transition-opacity duration-300 landscape:hidden"
                        onClick={() => setMobileSheetState('collapsed')}
                    />
                )}

                {/* Floating Onboarding Tooltip for mobile portrait tabs */}
                {showOnboarding && mobileSheetState === 'collapsed' && (
                    <div className="fixed bottom-16 left-4 right-4 bg-[#e94560] text-white p-3 rounded-lg shadow-xl z-50 landscape:hidden animate-[viewFadeIn_300ms_ease]">
                        <div className="flex items-start justify-between gap-2">
                            <div>
                                <p className="font-semibold text-xs mb-0.5">📂 Mobile Navigation</p>
                                <p className="text-[11px] text-white/95 leading-tight">Tap Browse or Settings at the bottom to explore features.</p>
                            </div>
                            <button type="button" onClick={onDismissOnboarding} className="text-white/60 hover:text-white text-xs font-bold shrink-0">✕</button>
                        </div>
                    </div>
                )}

                {/* Floating bottom tab bar (mobile portrait only) */}
                <div className="fixed bottom-0 left-0 right-0 h-14 bg-[#0d0d0d]/95 backdrop-blur-md border-t border-white/10 z-50 flex justify-around items-center px-4 landscape:hidden">
                    <TabBtnIcon active={tab === 'browse' && mobileSheetState !== 'collapsed'} onClick={() => handleTabClick('browse')} label="Browse" icon="browse" />
                    <TabBtnIcon active={tab === 'settings' && mobileSheetState !== 'collapsed'} onClick={() => handleTabClick('settings')} label="Settings" icon="settings" />
                </div>

                <aside 
                    className={`
                        fixed bottom-14 left-0 right-0 bg-[#0d0d0d] border-t border-white/10 rounded-t-2xl z-40 transition-all duration-300 ease-out flex flex-col
                        landscape:static landscape:w-64 landscape:h-full landscape:border-t-0 landscape:border-l landscape:rounded-none landscape:translate-y-0 landscape:opacity-100 landscape:pointer-events-auto
                        ${mobileSheetState === 'collapsed'
                            ? 'h-0 border-t-0 opacity-0 pointer-events-none translate-y-10'
                            : mobileSheetState === 'half'
                                ? 'h-[50vh] opacity-100 translate-y-0'
                                : 'h-[85vh] opacity-100 translate-y-0'
                        }
                    `}
                >
                    {/* Pull/Drag Handle (Mobile Portrait Only) */}
                    <div 
                        className="flex flex-col items-center py-2 shrink-0 cursor-row-resize select-none landscape:hidden border-b border-white/5"
                        onTouchStart={handleTouchStart}
                        onTouchEnd={handleTouchEnd}
                    >
                        <div className="w-12 h-1 rounded-full bg-white/20 mb-2" />
                        <div className="text-[10px] font-semibold text-white/30 uppercase tracking-wider">
                            {tab}
                        </div>
                    </div>

                    {/* Top Tab Headers (Landscape/Desktop Only) */}
                    <div className="hidden landscape:flex items-center border-b border-white/10 shrink-0">
                        <SidebarTabHeader tab={tab} setTab={setTab} />
                    </div>

                <div className="px-3 py-2 border-b border-white/10">
                    <FolderHeader folderName={folderName} onOpenFolder={onOpenFolder} />
                </div>

                {faceSearchActive && (
                    <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
                        <span className="text-[11px] text-blue-400/80 flex-1">Showing similar faces</span>
                        {onClearFaceSearch && (
                            <button onClick={onClearFaceSearch} className="text-[11px] text-white/30 hover:text-white/60">clear</button>
                        )}
                    </div>
                )}


                <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-4">
                    {tab === 'browse' && (
                        <BrowseTab
                            tags={tags} activeTag={activeTag} onTagClick={onTagClick}
                            searchQuery={searchQuery} onSearchChange={onSearchChange}
                            browseSummary={browseSummary}
                            settings={settings}
                            onUpdateAnalysis={onUpdateAnalysis}
                            thumbScale={settings.display.thumbScale}
                            onThumbScaleChange={s => onUpdateDisplay({ thumbScale: s })}
                            sortBy={settings.display.sortBy} onSortByChange={sortBy => onUpdateDisplay({ sortBy })}
                            sortOrder={settings.display.sortOrder} onSortOrderChange={sortOrder => onUpdateDisplay({ sortOrder })}
                            galleryMode={galleryMode}
                            onGalleryModeChange={onGalleryModeChange}
                            collections={collections}
                            activeCollectionId={activeCollectionId}
                            onCollectionSelect={onCollectionSelect}
                            selectedPhotoCount={selectedPhotoCount}
                            onSelectAllVisiblePhotos={onSelectAllVisiblePhotos}
                            onExportSelectedPhotos={onExportSelectedPhotos}
                            exportSelectedPhotosDisabled={exportSelectedPhotosDisabled}
                            clusterSelectionEnabled={clusterSelectionEnabled}
                            onClusterSelectionModeChange={onClusterSelectionModeChange}
                            selectedClusterIds={selectedClusterIds}
                            selectedClusterCount={selectedClusterCount}
                            onToggleSelectedCluster={onToggleSelectedCluster}
                            onClearCollectionSelection={onClearCollectionSelection}
                            onCreateCollection={onCreateCollection}
                            onRenameCollection={onRenameCollection}
                            onDeleteCollection={onDeleteCollection}
                            clusters={clusters}
                            people={people}
                            groups={groups}
                            similarFaces={similarFaces}
                            searchClusters={searchClusters}
                            activeClusterId={activeClusterId}
                            onClusterSelect={onClusterSelect}
                            getFileUrl={getFileUrl}
                            onAssociateFaceWithCluster={onAssociateFaceWithCluster}
                            onMergeFaceClusters={onMergeFaceClusters}
                            onGroupFaceClustersAsPerson={onGroupFaceClustersAsPerson}
                            onSeparatePersonGroup={onSeparatePersonGroup}
                            onOpenSimilarFace={onOpenSimilarFace}
                            onDeletePhoto={onDeletePhoto}
                            onRenameFace={onRenameFace}
                            onDeleteFace={onDeleteFace}
                            onCollectionContextMenu={onCollectionContextMenu}
                            showOnboarding={showOnboarding}
                            onDismissOnboarding={onDismissOnboarding}
                        />
                    )}
                    {tab === 'browse' && (
                        <LibrarySharingPanel
                            folderName={folderName}
                            folders={folders}
                            onOpenFolder={onOpenFolder}
                            onSelectFolder={onSelectFolder}
                            onRemoveFolder={onRemoveFolder}
                            onRescan={onRescan}
                            onReanalyze={onReanalyze}
                            collections={collections}
                            onRenameCollection={onRenameCollection}
                            onDeleteCollection={onDeleteCollection}
                            clusters={allClusters}
                            galleryShareInvite={galleryShareInvite}
                            creatingGalleryShareInvite={creatingGalleryShareInvite}
                            onCreateGalleryShareInvite={onCreateGalleryShareInvite}
                            sharePeerOptions={sharePeerOptions}
                            gallerySharePersonIds={gallerySharePersonIds}
                            collectionSharePersonIds={collectionSharePersonIds}
                            clusterSharePersonIds={clusterSharePersonIds}
                            onGalleryShareChange={onGalleryShareChange}
                            onCollectionShareChange={onCollectionShareChange}
                            onClusterShareChange={onClusterShareChange}
                        />
                    )}
                    {tab === 'settings' && (
                        <SettingsTab
                            settings={settings} onUpdateStorage={onUpdateStorage}
                            onUpdateDeviceName={onUpdateDeviceName}
                            onUpdateAnalysis={onUpdateAnalysis}
                            acceptSharing={acceptSharing}
                            onAcceptSharingChange={onAcceptSharingChange}
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
                            showOnboarding={showOnboarding}
                            onDismissOnboarding={onDismissOnboarding}
                        />
                    )}
                    {tab === 'settings' && (
                        <LibraryConfigPanel
                            settings={settings}
                            onUpdateStorage={onUpdateStorage}
                            canClaimAuthorshipOnIngest={canClaimAuthorshipOnIngest}
                            claimAuthorshipOnIngest={claimAuthorshipOnIngest}
                            onClaimAuthorshipOnIngestChange={onClaimAuthorshipOnIngestChange}
                            llmComparisonPhoto={llmComparisonPhoto ?? null}
                            llmComparisonPhotoLabel={llmComparisonPhotoLabel ?? 'photo'}
                        />
                    )}
                </div>
            </aside>
        </>
    );
}

    // Desktop: fixed-width sidebar with collapse/expand
    return (
        <>
        {/* Desktop expand toggle — lower-right */}
        {collapsed && (
            <button
                onClick={() => setCollapsed(false)}
                className="fixed bottom-[4.75rem] right-4 z-50 flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/70 text-white/50 backdrop-blur-sm transition-colors hover:text-white/70"
                aria-label="Expand sidebar"
            >
                <ChevronLeft className="w-5 h-5" />
            </button>
        )}

        <aside className={`
            w-64 h-full min-h-0 overflow-hidden flex flex-col bg-[#0d0d0d] border-l border-white/10 shrink-0
            ${collapsed ? 'hidden' : ''}
        `}>
            {/* Tabs */}
            <div className="flex items-center border-b border-white/10">
                <SidebarTabHeader tab={tab} setTab={setTab} />
            </div>

            {/* Folder controls */}
            <div className="px-3 py-2 border-b border-white/10">
                <FolderHeader folderName={folderName} onOpenFolder={onOpenFolder} />
            </div>

            {/* Face search indicator */}
            {faceSearchActive && (
                <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
                    <span className="text-[11px] text-blue-400/80 flex-1">Showing similar faces</span>
                    {onClearFaceSearch && (
                        <button onClick={onClearFaceSearch} className="text-[11px] text-white/30 hover:text-white/60">clear</button>
                    )}
                </div>
            )}


            {/* Content */}
            <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-4">
                {tab === 'browse' && (
                    <BrowseTab
                        tags={tags}
                        activeTag={activeTag}
                        onTagClick={onTagClick}
                        searchQuery={searchQuery}
                        onSearchChange={onSearchChange}
                        browseSummary={browseSummary}
                        settings={settings}
                        onUpdateAnalysis={onUpdateAnalysis}
                        thumbScale={settings.display.thumbScale}
                        onThumbScaleChange={s => onUpdateDisplay({ thumbScale: s })}
                        sortBy={settings.display.sortBy}
                        onSortByChange={sortBy => onUpdateDisplay({ sortBy })}
                        sortOrder={settings.display.sortOrder}
                        onSortOrderChange={sortOrder => onUpdateDisplay({ sortOrder })}
                        galleryMode={galleryMode}
                        onGalleryModeChange={onGalleryModeChange}
                        collections={collections}
                        activeCollectionId={activeCollectionId}
                        onCollectionSelect={onCollectionSelect}
                        selectedPhotoCount={selectedPhotoCount}
                        onSelectAllVisiblePhotos={onSelectAllVisiblePhotos}
                        onExportSelectedPhotos={onExportSelectedPhotos}
                        exportSelectedPhotosDisabled={exportSelectedPhotosDisabled}
                        clusterSelectionEnabled={clusterSelectionEnabled}
                        onClusterSelectionModeChange={onClusterSelectionModeChange}
                        selectedClusterIds={selectedClusterIds}
                        selectedClusterCount={selectedClusterCount}
                        onToggleSelectedCluster={onToggleSelectedCluster}
                        onClearCollectionSelection={onClearCollectionSelection}
                        onCreateCollection={onCreateCollection}
                        onRenameCollection={onRenameCollection}
                        onDeleteCollection={onDeleteCollection}
                        clusters={clusters}
                        people={people}
                        groups={groups}
                        similarFaces={similarFaces}
                        searchClusters={searchClusters}
                        activeClusterId={activeClusterId}
                        onClusterSelect={onClusterSelect}
                        getFileUrl={getFileUrl}
                        onAssociateFaceWithCluster={onAssociateFaceWithCluster}
                        onMergeFaceClusters={onMergeFaceClusters}
                        onGroupFaceClustersAsPerson={onGroupFaceClustersAsPerson}
                        onSeparatePersonGroup={onSeparatePersonGroup}
                        onOpenSimilarFace={onOpenSimilarFace}
                        onDeletePhoto={onDeletePhoto}
                        onRenameFace={onRenameFace}
                        onDeleteFace={onDeleteFace}
                        onCollectionContextMenu={onCollectionContextMenu}
                        showOnboarding={showOnboarding}
                        onDismissOnboarding={onDismissOnboarding}
                    />
                )}
                {tab === 'browse' && (
                    <LibrarySharingPanel
                        folderName={folderName}
                        folders={folders}
                        onOpenFolder={onOpenFolder}
                        onSelectFolder={onSelectFolder}
                        onRemoveFolder={onRemoveFolder}
                        onRescan={onRescan}
                        onReanalyze={onReanalyze}
                        collections={collections}
                        onRenameCollection={onRenameCollection}
                        onDeleteCollection={onDeleteCollection}
                        clusters={allClusters}
                        galleryShareInvite={galleryShareInvite}
                        creatingGalleryShareInvite={creatingGalleryShareInvite}
                        onCreateGalleryShareInvite={onCreateGalleryShareInvite}
                        sharePeerOptions={sharePeerOptions}
                        gallerySharePersonIds={gallerySharePersonIds}
                        collectionSharePersonIds={collectionSharePersonIds}
                        clusterSharePersonIds={clusterSharePersonIds}
                        onGalleryShareChange={onGalleryShareChange}
                        onCollectionShareChange={onCollectionShareChange}
                        onClusterShareChange={onClusterShareChange}
                    />
                )}
                {tab === 'settings' && (
                    <SettingsTab
                        settings={settings}
                        onUpdateStorage={onUpdateStorage}
                        onUpdateDeviceName={onUpdateDeviceName}
                        onUpdateAnalysis={onUpdateAnalysis}
                        acceptSharing={acceptSharing}
                        onAcceptSharingChange={onAcceptSharingChange}
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
                        showOnboarding={showOnboarding}
                        onDismissOnboarding={onDismissOnboarding}
                    />
                )}
                {tab === 'settings' && (
                    <LibraryConfigPanel
                        settings={settings}
                        onUpdateStorage={onUpdateStorage}
                        canClaimAuthorshipOnIngest={canClaimAuthorshipOnIngest}
                        claimAuthorshipOnIngest={claimAuthorshipOnIngest}
                        onClaimAuthorshipOnIngestChange={onClaimAuthorshipOnIngestChange}
                        llmComparisonPhoto={llmComparisonPhoto ?? null}
                        llmComparisonPhotoLabel={llmComparisonPhotoLabel ?? 'photo'}
                    />
                )}
            </div>
        </aside>

        {/* Collapse — fixed circle, bottom-right */}
        {!collapsed && (
            <button
                onClick={() => setCollapsed(true)}
                className="fixed bottom-6 right-4 z-50 flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/70 text-white/50 backdrop-blur-sm transition-colors hover:text-white/70"
                aria-label="Collapse sidebar"
            >
                <ChevronRight className="w-5 h-5" />
            </button>
        )}
        </>
    );
}

function SidebarTabHeader({ tab, setTab }: { tab: Tab; setTab: (tab: Tab) => void }) {
    return (
        <div className="flex flex-1 items-center px-2 py-1.5">
            {tab === 'settings' && (
                <button
                    type="button"
                    onClick={() => setTab('browse')}
                    className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium uppercase tracking-wide text-white/55 transition-colors hover:bg-white/5 hover:text-white/85"
                    aria-label="Back to browse"
                >
                    <ChevronLeft className="h-4 w-4" />
                    Back
                </button>
            )}
            <div className="flex-1" />
            <button
                type="button"
                onClick={() => setTab('settings')}
                className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                    tab === 'settings'
                        ? 'bg-[#e94560]/10 text-[#ff9db0]'
                        : 'text-white/45 hover:bg-white/5 hover:text-white/75'
                }`}
                aria-label="Settings"
                title="Settings"
            >
                <Settings className="h-4 w-4" />
            </button>
        </div>
    );
}

function TabBtnIcon({
    active,
    onClick,
    label,
    icon,
}: {
    active: boolean;
    onClick: () => void;
    label: string;
    icon: 'browse' | 'settings';
}) {
    const Icon = icon === 'browse' ? Compass : Settings;
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex flex-col items-center justify-center flex-1 h-full py-1 text-[10px] font-semibold transition-colors ${
                active ? 'text-[#e94560]' : 'text-white/40 hover:text-white/60'
            }`}
        >
            <Icon className="w-5 h-5 mb-0.5" />
            <span>{label}</span>
        </button>
    );
}

function FolderHeader({
    folderName,
    onOpenFolder,
}: {
    folderName?: string | null;
    onOpenFolder?: () => void;
}) {
    if (folderName) {
        return (
            <div className="flex items-center gap-2">
                <FolderOpen className="w-3.5 h-3.5 text-white/40 shrink-0" />
                <span className="text-xs text-white/60 truncate">{folderName}</span>
            </div>
        );
    }

    if (onOpenFolder) {
        return (
            <button type="button" onClick={onOpenFolder} className="flex min-h-11 items-center gap-2 rounded-md px-2 text-xs text-white/55 hover:bg-white/5 hover:text-white/75">
                <FolderOpen className="w-3.5 h-3.5" />
                Open folder...
            </button>
        );
    }

    return null;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
    return <div className="text-[11px] text-white/25 uppercase tracking-wider font-medium">{children}</div>;
}

function CollapsibleSection({
    label,
    defaultOpen = true,
    actions,
    children,
}: {
    label: string;
    defaultOpen?: boolean;
    actions?: React.ReactNode;
    children: React.ReactNode;
}) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div>
            <div className="flex items-center justify-between gap-2">
                <button
                    onClick={() => setOpen(o => !o)}
                    className="flex min-w-0 flex-1 items-center gap-1 text-[11px] text-white/25 uppercase tracking-wider font-medium hover:text-white/40 transition-colors"
                >
                    <ChevronDown className={`w-3 h-3 transition-transform ${open ? '' : '-rotate-90'}`} />
                    {label}
                </button>
                {actions ? <div className="flex shrink-0 items-center">{actions}</div> : null}
            </div>
            {open && <div className="mt-1.5 space-y-2">{children}</div>}
        </div>
    );
}

function SizeSlider({ value, onChange }: { value: number; onChange: (value: number) => void }) {
    // Track the value locally while dragging so the slider and label stay smooth,
    // and only commit to settings on release. Committing on every tick triggers a
    // synchronous localStorage write plus an async settings persist, which re-renders
    // the gallery mid-drag and makes the thumbnails flicker.
    const [draft, setDraft] = useState(value);
    const dragging = useRef(false);

    useEffect(() => {
        if (!dragging.current) {
            setDraft(value);
        }
    }, [value]);

    const commit = useCallback((next: number) => {
        dragging.current = false;
        if (next !== value) {
            onChange(next);
        }
    }, [onChange, value]);

    return (
        <div className="flex items-center gap-2 mt-1.5">
            <SlidersHorizontal className="w-3 h-3 text-white/25 shrink-0" />
            <input
                type="range"
                min={60}
                max={400}
                step={10}
                value={draft}
                onChange={e => { dragging.current = true; setDraft(parseInt(e.target.value)); }}
                onPointerUp={e => commit(parseInt((e.target as HTMLInputElement).value))}
                onKeyUp={e => commit(parseInt((e.target as HTMLInputElement).value))}
                onBlur={e => commit(parseInt(e.target.value))}
                className="flex-1 accent-white/50 h-1"
            />
            <span className="text-[11px] text-white/30 w-8 text-right tabular-nums">{draft}</span>
        </div>
    );
}

function BrowseTab({
    tags, activeTag, onTagClick,
    searchQuery, onSearchChange,
    browseSummary,
    settings, onUpdateAnalysis,
    thumbScale, onThumbScaleChange,
    sortBy, onSortByChange,
    sortOrder, onSortOrderChange,
    galleryMode, onGalleryModeChange,
    collections, activeCollectionId, onCollectionSelect,
    selectedPhotoCount, onSelectAllVisiblePhotos,
    onExportSelectedPhotos, exportSelectedPhotosDisabled,
    clusterSelectionEnabled, onClusterSelectionModeChange, selectedClusterIds, selectedClusterCount,
    onToggleSelectedCluster, onClearCollectionSelection, onCreateCollection, onRenameCollection, onDeleteCollection,
    clusters, people, groups,
    similarFaces, searchClusters,
    activeClusterId, onClusterSelect,
    getFileUrl,
    onAssociateFaceWithCluster,
    onMergeFaceClusters,
    onGroupFaceClustersAsPerson,
    onSeparatePersonGroup,
    onOpenSimilarFace, onDeletePhoto,
    onRenameFace, onDeleteFace,
    onCollectionContextMenu,
    showOnboarding,
    onDismissOnboarding,
}: {
    tags: [string, number][];
    activeTag: string | null;
    onTagClick: (tag: string | null) => void;
    searchQuery: string;
    onSearchChange: (q: string) => void;
    browseSummary: string;
    settings: FotosSettings;
    onUpdateAnalysis: (updates: Partial<FotosSettings['analysis']>) => void;
    thumbScale: number;
    onThumbScaleChange: (s: number) => void;
    sortBy: string;
    onSortByChange: (s: 'date' | 'name' | 'added') => void;
    sortOrder: string;
    onSortOrderChange: (o: 'asc' | 'desc') => void;
    galleryMode: 'images' | 'clusters';
    onGalleryModeChange: (mode: 'images' | 'clusters') => void;
    collections: FotosCollectionSummary[];
    activeCollectionId: string | null;
    onCollectionSelect: (collectionId: string | null) => void;
    selectedPhotoCount: number;
    onSelectAllVisiblePhotos: () => void;
    onExportSelectedPhotos?: () => Promise<void> | void;
    exportSelectedPhotosDisabled?: boolean;
    clusterSelectionEnabled: boolean;
    onClusterSelectionModeChange: (enabled: boolean) => void;
    selectedClusterIds: string[];
    selectedClusterCount: number;
    onToggleSelectedCluster: (clusterId: string) => void;
    onClearCollectionSelection: () => void;
    onCreateCollection: (name: string) => boolean;
    onRenameCollection: (collectionId: string, name: string) => void;
    onDeleteCollection: (collectionId: string) => void;
    clusters: FaceClusterSummary[];
    people: FaceClusterSummary[];
    groups: FaceClusterSummary[];
    similarFaces: SimilarFaceMatch[];
    searchClusters: FaceClusterSummary[];
    activeClusterId: string | null;
    onClusterSelect: (clusterId: string | null) => void;
    getFileUrl: (relativePath: string) => Promise<string>;
    onAssociateFaceWithCluster: (photoHash: string, faceIndex: number, clusterId: string) => void;
    onMergeFaceClusters: (targetClusterId: string, sourceClusterIds: string[]) => void;
    onGroupFaceClustersAsPerson: (clusterIds: string[]) => void;
    onSeparatePersonGroup: (personId: string) => void;
    onOpenSimilarFace: (match: SimilarFaceMatch) => void;
    onDeletePhoto: (hash: string) => void;
    onRenameFace: (clusterId: string, name: string) => Promise<void> | void;
    onDeleteFace: (clusterId: string) => void;
    onCollectionContextMenu?: (collection: FotosCollectionSummary, event: React.MouseEvent | React.TouchEvent) => void;
    showOnboarding?: boolean;
    onDismissOnboarding?: () => void;
}) {
    const activeCluster = clusters.find(cluster => cluster.clusterId === activeClusterId) ?? null;
    const selectedAssociationClusterId = activeCluster
        && activeCluster.clusterId !== 'current-match'
        && activeCluster.memberClusterIds.length === 1
        ? activeCluster.memberClusterIds[0]
        : null;
    const activePersonGroupId = activeCluster?.personId && activeCluster.memberClusterIds.length > 1
        ? activeCluster.personId
        : null;
    const [selectedClusterCandidateIds, setSelectedClusterCandidateIds] = useState<string[]>([]);
    const [collectionDraftName, setCollectionDraftName] = useState('');
    const selectedClusterIdSet = new Set(selectedClusterIds);

    useEffect(() => {
        setSelectedClusterCandidateIds([]);
    }, [activeCluster?.clusterId]);

    const toggleClusterCandidate = (clusterId: string) => {
        setSelectedClusterCandidateIds(current => (
            current.includes(clusterId)
                ? current.filter(id => id !== clusterId)
                : [...current, clusterId]
        ));
    };

    const applyClusterMerges = () => {
        if (!selectedAssociationClusterId || selectedClusterCandidateIds.length === 0) {
            return;
        }
        onMergeFaceClusters(selectedAssociationClusterId, selectedClusterCandidateIds);
        setSelectedClusterCandidateIds([]);
    };

    const collapseClustersAsPerson = () => {
        if (!selectedAssociationClusterId || selectedClusterCandidateIds.length === 0) {
            return;
        }
        onGroupFaceClustersAsPerson([selectedAssociationClusterId, ...selectedClusterCandidateIds]);
        setSelectedClusterCandidateIds([]);
    };

    const submitCollection = () => {
        const created = onCreateCollection(collectionDraftName);
        if (created) {
            setCollectionDraftName('');
        }
    };

    return (
        <>
            {showOnboarding && (
                <div className="relative bg-[#e94560] text-white p-3 rounded-lg shadow-xl mb-3 animate-[viewFadeIn_300ms_ease] z-50">
                    <div className="flex items-start justify-between gap-2">
                        <div>
                            <p className="font-semibold text-xs mb-0.5">📂 Sidebar Navigation</p>
                            <p className="text-[11px] text-white/95 leading-tight">Switch between Browse and Settings sections here.</p>
                        </div>
                        <button type="button" onClick={onDismissOnboarding} className="text-white/60 hover:text-white text-xs font-bold shrink-0">✕</button>
                    </div>
                </div>
            )}

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

            <CollapsibleSection
                label="Collections"
                defaultOpen={collections.length > 0 || selectedPhotoCount > 0 || selectedClusterCount > 0}
            >
                <div className="rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-2 space-y-2">
                    <div className="text-[11px] leading-relaxed text-white/35">
                        Build reusable groups from selected images and named people or clusters.
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        <button
                            type="button"
                            onClick={() => onClusterSelectionModeChange(!clusterSelectionEnabled)}
                            className={`rounded-md border px-2 py-1 text-[11px] uppercase tracking-[0.16em] transition-colors ${
                                clusterSelectionEnabled
                                    ? 'border-[#e94560]/35 bg-[#e94560]/10 text-[#ff9db0]'
                                    : 'border-white/10 bg-white/5 text-white/38 hover:text-white/60'
                            }`}
                        >
                            {clusterSelectionEnabled ? 'Done People' : 'Select People'}
                        </button>
                        <button
                            type="button"
                            onClick={onSelectAllVisiblePhotos}
                            className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-white/38 transition-colors hover:text-white/60"
                        >
                            Select Visible
                        </button>
                        {onExportSelectedPhotos && (
                            <button
                                type="button"
                                onClick={() => { void onExportSelectedPhotos(); }}
                                disabled={selectedPhotoCount === 0 || exportSelectedPhotosDisabled}
                                className={`rounded-md border px-2 py-1 text-[11px] uppercase tracking-[0.16em] transition-colors ${
                                    selectedPhotoCount === 0 || exportSelectedPhotosDisabled
                                        ? 'border-white/10 bg-white/5 text-white/20 cursor-not-allowed'
                                        : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/16'
                                }`}
                            >
                                <span className="inline-flex items-center gap-1">
                                    <Download className="h-3 w-3" />
                                    Export to Photos
                                </span>
                            </button>
                        )}
                        {(selectedPhotoCount > 0 || selectedClusterCount > 0) && (
                            <button
                                type="button"
                                onClick={onClearCollectionSelection}
                                className="rounded-md border border-white/10 bg-black/20 px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-white/32 transition-colors hover:text-white/58"
                            >
                                Clear
                            </button>
                        )}
                    </div>
                    <div className="text-[11px] text-white/28">
                        {selectedPhotoCount} selected image{selectedPhotoCount === 1 ? '' : 's'} · {selectedClusterCount} selected people/cluster{selectedClusterCount === 1 ? '' : 's'}
                    </div>
                    <div className="flex items-center gap-2">
                        <input
                            type="text"
                            value={collectionDraftName}
                            onChange={event => setCollectionDraftName(event.target.value)}
                            onKeyDown={event => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    submitCollection();
                                }
                            }}
                            placeholder="Collection name"
                            className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/20 px-2.5 py-1.5 text-[11px] text-white/72 placeholder:text-white/20 focus:border-white/20 focus:outline-none"
                        />
                        <button
                            type="button"
                            onClick={submitCollection}
                            disabled={selectedPhotoCount === 0 && selectedClusterCount === 0}
                            className={`rounded-md border px-2.5 py-1.5 text-[11px] uppercase tracking-[0.16em] transition-colors ${
                                selectedPhotoCount === 0 && selectedClusterCount === 0
                                    ? 'border-white/10 bg-white/5 text-white/20 cursor-not-allowed'
                                    : 'border-[#e94560]/25 bg-[#e94560]/10 text-[#ff9db0] hover:bg-[#e94560]/16'
                            }`}
                        >
                            <span className="inline-flex items-center gap-1">
                                <Plus className="h-3 w-3" />
                                Create
                            </span>
                        </button>
                    </div>
                </div>

                {collections.length === 0 ? (
                    <div className="rounded-md border border-dashed border-white/10 px-2.5 py-2 text-[11px] text-white/24">
                        Select images or people, then create your first collection here.
                    </div>
                ) : (
                    <div className="space-y-1.5">
                        {collections.map(collection => (
                            <CollectionRow
                                key={collection.id}
                                collection={collection}
                                active={collection.id === activeCollectionId}
                                onClick={() => onCollectionSelect(collection.id === activeCollectionId ? null : collection.id)}
                                onRename={onRenameCollection}
                                onDelete={onDeleteCollection}
                                onContextMenu={(e) => onCollectionContextMenu?.(collection, e)}
                            />
                        ))}
                    </div>
                )}
            </CollapsibleSection>

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
                    <div>
                        <SectionLabel>Sensitivity</SectionLabel>
                        <div className={`mt-1.5 space-y-1.5 ${settings.analysis.faceAnalyticsEnabled ? '' : 'opacity-45'}`}>
                            <div className="flex items-center gap-2">
                                <input
                                    type="range"
                                    min={0}
                                    max={100}
                                    step={1}
                                    value={settings.analysis.clusterSensitivity}
                                    onChange={e => onUpdateAnalysis({ clusterSensitivity: parseInt(e.target.value, 10) || 0 })}
                                    disabled={!settings.analysis.faceAnalyticsEnabled}
                                    className="flex-1 accent-[#e94560] h-1"
                                />
                                <span className="w-8 text-right text-[11px] text-white/35 tabular-nums">
                                    {settings.analysis.clusterSensitivity}
                                </span>
                            </div>
                            <div className="flex items-center justify-between text-[11px] text-white/25">
                                <span>Merge more</span>
                                <span>Split more</span>
                            </div>
                            <div className="text-[11px] text-white/30">
                                {clusters.length} clusters at this setting
                            </div>
                        </div>
                    </div>

                    {activeClusterId && (
                        <button
                            onClick={() => onClusterSelect(null)}
                            className="w-full text-left text-[11px] text-white/45 hover:text-white/65"
                        >
                            ← Back to all clusters
                        </button>
                    )}

                    {selectedAssociationClusterId && (
                        <div className="rounded-md border border-[#e94560]/25 bg-[#1a1115] px-2.5 py-2">
                            <div className="text-[11px] text-white/50">
                                Check thumbnails on the right, then either merge them into this cluster or manage them as one person.
                            </div>
                            <div className="mt-2 flex items-center gap-1.5">
                                <button
                                    onClick={applyClusterMerges}
                                    disabled={selectedClusterCandidateIds.length === 0}
                                    className={`rounded-md px-2 py-1 text-[11px] uppercase tracking-[0.16em] transition-colors ${
                                        selectedClusterCandidateIds.length > 0
                                            ? 'bg-[#e94560] text-white hover:bg-[#d73b56]'
                                            : 'bg-white/5 text-white/25 cursor-not-allowed'
                                    }`}
                                >
                                    Merge Selected {selectedClusterCandidateIds.length > 0 ? `(${selectedClusterCandidateIds.length})` : ''}
                                </button>
                                <button
                                    onClick={collapseClustersAsPerson}
                                    disabled={selectedClusterCandidateIds.length === 0}
                                    className={`rounded-md px-2 py-1 text-[11px] uppercase tracking-[0.16em] transition-colors ${
                                        selectedClusterCandidateIds.length > 0
                                            ? 'bg-white/10 text-[#ff9db0] hover:bg-white/15'
                                            : 'bg-white/5 text-white/25 cursor-not-allowed'
                                    }`}
                                >
                                    One Person
                                </button>
                                {selectedClusterCandidateIds.length > 0 && (
                                    <button
                                        onClick={() => setSelectedClusterCandidateIds([])}
                                        className="text-[11px] text-white/35 hover:text-white/60"
                                    >
                                        clear
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                    {activePersonGroupId && (
                        <div className="rounded-md border border-white/10 bg-white/5 px-2.5 py-2">
                            <div className="text-[11px] text-white/45">
                                This person is an explicit collapse of {activeCluster?.memberClusterIds.length ?? 0} clusters.
                            </div>
                            <button
                                onClick={() => onSeparatePersonGroup(activePersonGroupId)}
                                className="mt-2 rounded-md border border-white/10 bg-black/20 px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-white/55 transition-colors hover:bg-black/30 hover:text-white/75"
                            >
                                Separate Clusters
                            </button>
                        </div>
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
                                        showMergeCheckbox={Boolean(selectedAssociationClusterId) && cluster.memberClusterIds.length === 1 && cluster.memberClusterIds[0] !== selectedAssociationClusterId}
                                        mergeSelected={selectedClusterCandidateIds.includes(cluster.memberClusterIds[0] ?? cluster.clusterId)}
                                        onToggleMergeSelected={() => toggleClusterCandidate(cluster.memberClusterIds[0] ?? cluster.clusterId)}
                                        showSelectionCheckbox={clusterSelectionEnabled && !(selectedAssociationClusterId && cluster.memberClusterIds.length === 1 && cluster.memberClusterIds[0] !== selectedAssociationClusterId)}
                                        selectionChecked={selectedClusterIdSet.has(cluster.clusterId)}
                                        onToggleSelection={() => onToggleSelectedCluster(cluster.clusterId)}
                                        onRename={onRenameFace}
                                        onDelete={cluster.memberClusterIds.length === 1 ? onDeleteFace : undefined}
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
                                        showMergeCheckbox={Boolean(selectedAssociationClusterId) && cluster.memberClusterIds.length === 1 && cluster.memberClusterIds[0] !== selectedAssociationClusterId}
                                        mergeSelected={selectedClusterCandidateIds.includes(cluster.memberClusterIds[0] ?? cluster.clusterId)}
                                        onToggleMergeSelected={() => toggleClusterCandidate(cluster.memberClusterIds[0] ?? cluster.clusterId)}
                                        showSelectionCheckbox={clusterSelectionEnabled && !(selectedAssociationClusterId && cluster.memberClusterIds.length === 1 && cluster.memberClusterIds[0] !== selectedAssociationClusterId)}
                                        selectionChecked={selectedClusterIdSet.has(cluster.clusterId)}
                                        onToggleSelection={() => onToggleSelectedCluster(cluster.clusterId)}
                                        onRename={onRenameFace}
                                        onDelete={cluster.memberClusterIds.length === 1 ? onDeleteFace : undefined}
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
                                        showSelectionCheckbox={clusterSelectionEnabled}
                                        selectionChecked={selectedClusterIdSet.has(cluster.clusterId)}
                                        onToggleSelection={() => onToggleSelectedCluster(cluster.clusterId)}
                                        onRename={onRenameFace}
                                        onDelete={cluster.memberClusterIds.length === 1 ? onDeleteFace : undefined}
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    <div>
                            <SectionLabel>Similar Faces</SectionLabel>
                            {selectedAssociationClusterId ? (
                                <div className="mt-1 text-[11px] text-white/30">
                                    Check faces to add them to the selected cluster.
                                </div>
                            ) : null}
                        <div className="mt-1.5 space-y-1">
                            {similarFaces.slice(0, 12).map(match => {
                                const avatarKey = `${match.photo.hash}:${match.faceIndex}`;
                                return (
                                    <SimilarFaceRow
                                        key={avatarKey}
                                        match={match}
                                        getFileUrl={getFileUrl}
                                        canAssociate={selectedAssociationClusterId !== null}
                                        associated={selectedAssociationClusterId !== null && match.clusterId === selectedAssociationClusterId}
                                        onAssociate={selectedAssociationClusterId
                                            ? () => onAssociateFaceWithCluster(match.photo.hash, match.faceIndex, selectedAssociationClusterId)
                                            : undefined}
                                        onOpen={() => onOpenSimilarFace(match)}
                                        onRename={match.clusterId ? name => onRenameFace(match.clusterId!, name) : undefined}
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
                        <SizeSlider value={thumbScale} onChange={onThumbScaleChange} />
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
                        <CollapsibleSection label="Faces" defaultOpen={false}>
                            <div className="space-y-1">
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
                                        showSelectionCheckbox={clusterSelectionEnabled}
                                        selectionChecked={selectedClusterIdSet.has(cluster.clusterId)}
                                        onToggleSelection={() => onToggleSelectedCluster(cluster.clusterId)}
                                        onRename={onRenameFace}
                                        onDelete={cluster.memberClusterIds.length === 1 ? onDeleteFace : undefined}
                                    />
                                ))}
                            </div>
                        </CollapsibleSection>
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
            className={`px-2 py-0.5 rounded-full text-[11px] border transition-colors ${
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
            className={`rounded-md border px-2 py-1 text-[11px] uppercase tracking-[0.18em] transition-colors ${
                active
                    ? 'border-[#e94560]/50 bg-[#e94560]/12 text-[#ff9db0]'
                    : 'border-white/10 bg-white/5 text-white/35 hover:text-white/55'
            }`}
        >
            {label}
        </button>
    );
}

function CollectionRow({
    collection,
    active,
    onClick,
    onRename,
    onDelete,
    onContextMenu,
}: {
    collection: FotosCollectionSummary;
    active: boolean;
    onClick: () => void;
    onRename: (collectionId: string, name: string) => void;
    onDelete: (collectionId: string) => void;
    onContextMenu?: (e: React.MouseEvent | React.TouchEvent) => void;
}) {
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const hasLongPressed = useRef(false);

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        hasLongPressed.current = false;
        timerRef.current = setTimeout(() => {
            hasLongPressed.current = true;
            if (onContextMenu) {
                onContextMenu(e);
            }
        }, 600);
    }, [onContextMenu]);

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

    return (
        <div
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
            className={`group flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors ${
                active
                    ? 'border-[#e94560]/50 bg-[#e94560]/10'
                    : 'border-white/10 bg-white/5 hover:bg-white/10'
            }`}
        >
            <button
                type="button"
                onClick={onClick}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-white/10 bg-black/20 text-[11px] font-semibold text-white/45 transition-colors hover:bg-white/10 hover:text-white/70"
                aria-label={`Open collection ${collection.name}`}
            >
                {collection.photoCount}
            </button>
            <div className="min-w-0 flex-1">
                <InlineRenameField
                    value={collection.name}
                    fallback={collection.name}
                    placeholder="Name this collection"
                    onSubmit={name => onRename(collection.id, name)}
                />
                <div className="text-[11px] text-white/25">
                    {collection.photoCount} photo{collection.photoCount === 1 ? '' : 's'} · {collection.faceCount} face{collection.faceCount === 1 ? '' : 's'}
                </div>
            </div>
            <button
                type="button"
                onClick={event => {
                    event.stopPropagation();
                    onDelete(collection.id);
                }}
                onKeyDown={event => event.stopPropagation()}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-white/45 transition-colors hover:bg-red-500/10 hover:text-red-300"
                aria-label={`Delete collection ${collection.name}`}
                title="Delete collection"
            >
                <Trash2 className="h-3 w-3" />
            </button>
        </div>
    );
}

function ClusterBrowseRow({
    cluster,
    active,
    onClick,
    getFileUrl,
    showMergeCheckbox,
    mergeSelected,
    onToggleMergeSelected,
    showSelectionCheckbox,
    selectionChecked,
    onToggleSelection,
    onRename,
    onDelete,
}: {
    cluster: FaceClusterSummary;
    active: boolean;
    onClick: () => void;
    getFileUrl: (relativePath: string) => Promise<string>;
    showMergeCheckbox?: boolean;
    mergeSelected?: boolean;
    onToggleMergeSelected?: () => void;
    showSelectionCheckbox?: boolean;
    selectionChecked?: boolean;
    onToggleSelection?: () => void;
    onRename?: (clusterId: string, name: string) => Promise<void> | void;
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
        <div
            className={`group flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors ${
                active
                    ? 'border-[#e94560]/50 bg-[#e94560]/10'
                    : 'border-white/10 bg-white/5 hover:bg-white/10'
            }`}
        >
            <button
                type="button"
                onClick={onClick}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-opacity hover:opacity-80"
                aria-label={`Open ${cluster.label}`}
            >
                {avatarUrl ? (
                    <img src={avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover border border-white/10" />
                ) : (
                    <span className="h-9 w-9 rounded-full bg-white/10 border border-white/10" />
                )}
            </button>
            <div className="min-w-0 flex-1">
                {onRename ? (
                    <InlineRenameField
                        value={cluster.personName}
                        fallback={cluster.label}
                        placeholder={cluster.memberClusterIds.length > 1 ? 'Name this person' : 'Name this cluster'}
                        onSubmit={name => onRename(cluster.memberClusterIds[0] ?? cluster.clusterId, name)}
                    />
                ) : (
                    <div className="truncate text-[11px] text-white/75">{cluster.label}</div>
                )}
                <div className="text-[11px] text-white/25">
                    {cluster.faceCount} faces · {cluster.photoCount} photos
                    {cluster.memberClusterIds.length > 1 ? ` · ${cluster.memberClusterIds.length} clusters` : ''}
                </div>
            </div>
            {(showMergeCheckbox || showSelectionCheckbox || onDelete) && (
                <div className="flex shrink-0 items-center gap-1.5">
                    {onDelete && (
                        <button
                            type="button"
                            onClick={event => {
                                event.stopPropagation();
                                onDelete(cluster.memberClusterIds[0] ?? cluster.clusterId);
                            }}
                            onKeyDown={event => event.stopPropagation()}
                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-white/45 transition-colors hover:bg-red-500/10 hover:text-red-300"
                            aria-label={`Delete face cluster ${cluster.label}`}
                            title="Delete cluster"
                        >
                            <Trash2 className="h-3 w-3" />
                        </button>
                    )}
                    {showSelectionCheckbox ? (
                        <label
                            className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-white/8"
                            title={selectionChecked ? 'Remove from collection selection' : 'Add to collection selection'}
                        >
                            <input
                                type="checkbox"
                                checked={Boolean(selectionChecked)}
                                onChange={() => onToggleSelection?.()}
                                className="h-4 w-4 rounded-sm border border-white/20 bg-black/20 accent-[#e94560]"
                                aria-label={selectionChecked ? `Remove ${cluster.label} from collection selection` : `Add ${cluster.label} to collection selection`}
                            />
                        </label>
                    ) : null}
                    {showMergeCheckbox ? (
                        <label
                            className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-white/8"
                            title={mergeSelected ? 'Marked for this cluster' : 'Mark for this cluster'}
                        >
                            <input
                                type="checkbox"
                                checked={Boolean(mergeSelected)}
                                onChange={() => onToggleMergeSelected?.()}
                                className="h-4 w-4 rounded-sm border border-white/20 bg-black/20 accent-[#e94560]"
                                aria-label={mergeSelected ? `Remove ${cluster.label} from merge` : `Add ${cluster.label} to merge`}
                            />
                        </label>
                    ) : null}
                </div>
            )}
        </div>
    );
}

function SimilarFaceRow({
    match,
    getFileUrl,
    canAssociate,
    associated,
    onAssociate,
    onOpen,
    onRename,
    onDelete,
}: {
    match: SimilarFaceMatch;
    getFileUrl: (relativePath: string) => Promise<string>;
    canAssociate: boolean;
    associated: boolean;
    onAssociate?: () => void;
    onOpen: () => void;
    onRename?: (name: string) => Promise<void> | void;
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
        <div
            className="group flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-left transition-colors hover:bg-white/10"
        >
            <button
                type="button"
                onClick={onOpen}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-opacity hover:opacity-80"
                aria-label={`Open ${match.photo.name}`}
            >
                {src ? (
                    <img src={src} alt="" className="h-9 w-9 rounded-full object-cover border border-white/10" />
                ) : (
                    <span className="h-9 w-9 rounded-full bg-white/10 border border-white/10" />
                )}
            </button>
            <div className="min-w-0 flex-1" title={`Open ${match.photo.name}`}>
                <div className="truncate text-[11px] text-white/75">{match.photo.name}</div>
                <div className="text-[11px] text-white/25">{(match.similarity * 100).toFixed(0)}% match</div>
                {match.clusterId && onRename ? (
                    <div className="mt-1">
                        <InlineRenameField
                            value={match.personName}
                            fallback={match.personName?.trim() || 'Unknown'}
                            onSubmit={onRename}
                            labelClassName="truncate text-[11px] text-white/38"
                            inputClassName="min-w-0 flex-1 rounded-md border border-[#e94560]/35 bg-[#1a1115] px-2 py-1 text-[11px] text-white placeholder:text-white/20 focus:border-[#ff9db0]/60 focus:outline-none"
                        />
                    </div>
                ) : (
                    <div className="text-[11px] text-white/25">{match.personName?.trim() || 'Unknown'}</div>
                )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
                <button
                    type="button"
                    onClick={onDelete}
                    className="flex h-11 w-11 items-center justify-center rounded-md text-white/35 transition-colors hover:bg-red-500/10 hover:text-red-300"
                    aria-label={`Delete ${match.photo.name}`}
                    title={`Delete ${match.photo.name}`}
                >
                    <Trash2 className="h-3.5 w-3.5" />
                </button>
                <button
                    type="button"
                    disabled={!canAssociate || associated}
                    onClick={onAssociate}
                    className={`flex h-11 w-11 items-center justify-center rounded-md border transition-colors ${
                        associated
                            ? 'border-[#e94560]/70 bg-[#e94560] text-white'
                            : canAssociate
                                ? 'border-white/20 bg-black/20 text-white/20 hover:border-[#ff9db0]/60 hover:bg-[#e94560]/12 hover:text-[#ff9db0]'
                                : 'border-white/10 bg-black/10 text-transparent opacity-45 cursor-not-allowed'
                    }`}
                    title={
                        associated
                            ? 'Already associated with the selected cluster'
                            : canAssociate
                                ? 'Associate with the selected cluster'
                                : 'Select a cluster first'
                    }
                    aria-label={
                        associated
                            ? `${match.photo.name} is associated with the selected cluster`
                            : canAssociate
                                ? `Associate ${match.photo.name} with the selected cluster`
                                : 'Select a cluster before associating this face'
                    }
                >
                    <Check className="h-3 w-3" />
                </button>
            </div>
        </div>
    );
}

function LibrarySharingPanel({
    folderName,
    folders,
    onOpenFolder,
    onSelectFolder,
    onRemoveFolder,
    onRescan,
    onReanalyze,
    collections,
    onRenameCollection,
    onDeleteCollection,
    clusters,
    galleryShareInvite,
    creatingGalleryShareInvite,
    onCreateGalleryShareInvite,
    sharePeerOptions,
    gallerySharePersonIds,
    collectionSharePersonIds,
    clusterSharePersonIds,
    onGalleryShareChange,
    onCollectionShareChange,
    onClusterShareChange,
}: {
    folderName?: string | null;
    folders?: ManagedFolder[];
    onOpenFolder?: () => void;
    onSelectFolder?: (folderId: string) => void;
    onRemoveFolder?: (folderId: string) => void;
    onRescan?: () => void;
    onReanalyze?: () => void;
    collections: FotosCollectionSummary[];
    onRenameCollection: (collectionId: string, name: string) => void;
    onDeleteCollection: (collectionId: string) => void;
    clusters: FaceClusterSummary[];
    galleryShareInvite?: {
        url: string;
        pin: string;
        sharedCount?: number;
        payload: {
            expiresAt: string;
        };
    } | null;
    creatingGalleryShareInvite?: boolean;
    onCreateGalleryShareInvite?: () => Promise<void> | void;
    sharePeerOptions: SharePeerOption[];
    gallerySharePersonIds: string[];
    collectionSharePersonIds: Record<string, string[]>;
    clusterSharePersonIds: Record<string, string[]>;
    onGalleryShareChange: (personIds: string[]) => Promise<void> | void;
    onCollectionShareChange: (collectionId: string, personIds: string[]) => Promise<void> | void;
    onClusterShareChange: (clusterId: string, personIds: string[]) => Promise<void> | void;
}) {
    const managedFolders = folders ?? [];

    return (
        <>
            {(managedFolders.length > 0 || folderName || onOpenFolder || onRescan || onReanalyze) && (
                <CollapsibleSection
                    label="Folders"
                    actions={onOpenFolder ? (
                        <button
                            type="button"
                            onClick={onOpenFolder}
                            className="flex h-5 w-5 items-center justify-center rounded-sm border border-white/10 bg-white/5 text-[12px] leading-none text-white/45 transition-colors hover:bg-white/10 hover:text-white/75"
                            aria-label="Open folder picker"
                            title="Open folder picker"
                        >
                            +
                        </button>
                    ) : undefined}
                >
                    <div className="space-y-1.5">
                        {managedFolders.length > 0 ? (
                            <div className="space-y-1">
                                {managedFolders.map(folder => (
                                    <div
                                        key={folder.id}
                                        className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] ${
                                            folder.isCurrent
                                                ? 'border-white/12 bg-white/6 text-white/58'
                                                : 'border-white/8 bg-white/[0.025] text-white/38'
                                        }`}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => onSelectFolder?.(folder.id)}
                                            className="min-w-0 flex flex-1 items-center gap-2 text-left"
                                            title={folder.name}
                                        >
                                            <FolderOpen className="h-3 w-3 shrink-0 text-white/35" />
                                            <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                                        </button>
                                        {folder.entryCount > 0 && (
                                            <span className="text-[11px] tabular-nums text-white/20">{folder.entryCount}</span>
                                        )}
                                        {folder.isCurrent && (
                                            <span className="text-[11px] uppercase tracking-[0.16em] text-white/18">current</span>
                                        )}
                                        {onRemoveFolder && (
                                            <button
                                                type="button"
                                                onClick={() => onRemoveFolder(folder.id)}
                                                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-white/45 transition-colors hover:bg-red-500/10 hover:text-red-300"
                                                aria-label={`Remove ${folder.name}`}
                                                title={`Remove ${folder.name}`}
                                            >
                                                <Trash2 className="h-3 w-3" />
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : folderName ? (
                            <div className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2.5 py-2 text-[11px] text-white/55">
                                <FolderOpen className="h-3 w-3 shrink-0 text-white/35" />
                                <span className="min-w-0 flex-1 truncate">{folderName}</span>
                                <span className="text-[11px] uppercase tracking-[0.18em] text-white/18">current</span>
                            </div>
                        ) : (
                            <div className="rounded-md border border-dashed border-white/10 bg-white/[0.03] px-2.5 py-2 text-[11px] text-white/30">
                                No folder selected
                            </div>
                        )}

                        <div className="grid gap-1">
                            {onRescan && (
                                <ManageOptionButton onClick={onRescan}>
                                    Rescan folder
                                </ManageOptionButton>
                            )}
                            {onReanalyze && (
                                <ManageOptionButton onClick={onReanalyze} accent>
                                    Reanalyze image AI
                                </ManageOptionButton>
                            )}
                        </div>
                    </div>
                </CollapsibleSection>
            )}

            <SectionLabel>Sharing</SectionLabel>
            <CollapsibleSection label="Share gallery">
                <div className="space-y-2">
                    {onCreateGalleryShareInvite && (
                        <button
                            type="button"
                            disabled={creatingGalleryShareInvite}
                            onClick={() => {
                                void onCreateGalleryShareInvite();
                            }}
                            className={`flex w-full items-center justify-center gap-2 rounded-md border px-2.5 py-1.5 text-[11px] uppercase tracking-[0.16em] transition-colors ${
                                creatingGalleryShareInvite
                                    ? 'border-white/10 bg-white/5 text-white/20 cursor-wait'
                                    : 'border-[#e94560]/25 bg-[#e94560]/10 text-[#ff9db0] hover:bg-[#e94560]/16'
                            }`}
                        >
                            <Link className="h-3 w-3" />
                            {creatingGalleryShareInvite ? 'Creating link' : 'Create share link'}
                        </button>
                    )}
                    {galleryShareInvite && (
                        <div className="space-y-1.5 rounded-md border border-white/10 bg-black/20 p-2">
                            <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[11px]">
                                {typeof galleryShareInvite.sharedCount === 'number' && (
                                    <>
                                        <span className="text-white/25">Photos</span>
                                        <span className="text-white/55">{galleryShareInvite.sharedCount}</span>
                                    </>
                                )}
                                <span className="text-white/25">Expires</span>
                                <span className="text-white/45">
                                    {new Date(galleryShareInvite.payload.expiresAt).toLocaleString()}
                                </span>
                            </div>
                            <input
                                readOnly
                                value={galleryShareInvite.url}
                                onFocus={event => event.currentTarget.select()}
                                className="w-full rounded-sm border border-white/10 bg-white/5 px-2 py-1 font-mono text-[11px] text-white/45"
                            />
                        </div>
                    )}
                    <div className="pt-1">
                        <div className="mb-1 text-[11px] uppercase tracking-[0.16em] text-white/22">Existing people</div>
                        <ShareWithField
                            value={gallerySharePersonIds}
                            peers={sharePeerOptions}
                            onChange={onGalleryShareChange}
                            emptyLabel="No gallery peers selected"
                        />
                    </div>
                </div>
            </CollapsibleSection>

            <CollapsibleSection label="Collection Sharing" defaultOpen={collections.length > 0}>
                {collections.length === 0 ? (
                    <div className="rounded-md border border-dashed border-white/10 px-2.5 py-2 text-[11px] text-white/24">
                        Create collections in Browse to manage sharing here.
                    </div>
                ) : (
                    <div className="space-y-3">
                        {collections.map(collection => (
                            <ManageCollectionShareRow
                                key={collection.id}
                                collection={collection}
                                peers={sharePeerOptions}
                                sharePersonIds={collectionSharePersonIds[collection.id] ?? []}
                                onRename={onRenameCollection}
                                onDelete={onDeleteCollection}
                                onShareChange={personIds => onCollectionShareChange(collection.id, personIds)}
                            />
                        ))}
                    </div>
                )}
            </CollapsibleSection>

            <CollapsibleSection label="Cluster Sharing" defaultOpen={clusters.length > 0}>
                {clusters.length === 0 ? (
                    <div className="rounded-md border border-dashed border-white/10 px-2.5 py-2 text-[11px] text-white/24">
                        No face clusters yet.
                    </div>
                ) : (
                    <div className="space-y-3">
                        {clusters.map(cluster => (
                            <ManageClusterShareRow
                                key={cluster.clusterId}
                                cluster={cluster}
                                peers={sharePeerOptions}
                                sharePersonIds={clusterSharePersonIds[cluster.clusterId] ?? []}
                                onShareChange={personIds => onClusterShareChange(cluster.clusterId, personIds)}
                            />
                        ))}
                    </div>
                )}
            </CollapsibleSection>
        </>
    );
}

function LibraryConfigPanel({
    settings,
    onUpdateStorage,
    canClaimAuthorshipOnIngest,
    claimAuthorshipOnIngest,
    onClaimAuthorshipOnIngestChange,
    llmComparisonPhoto,
    llmComparisonPhotoLabel,
}: {
    settings: FotosSettings;
    onUpdateStorage: (updates: Partial<FotosSettings['storage']>) => void;
    canClaimAuthorshipOnIngest: boolean;
    claimAuthorshipOnIngest: boolean;
    onClaimAuthorshipOnIngestChange: (enabled: boolean) => void;
    llmComparisonPhoto?: PhotoEntry | null;
    llmComparisonPhotoLabel?: string;
}) {
    return (
        <>
            <SectionLabel>Ingestion</SectionLabel>

            {canClaimAuthorshipOnIngest && (
                <label className="flex items-start gap-2 rounded-md border border-white/10 bg-white/5 px-2.5 py-2">
                    <input
                        type="checkbox"
                        checked={claimAuthorshipOnIngest}
                        onChange={event => onClaimAuthorshipOnIngestChange(event.target.checked)}
                        className="mt-0.5 h-3.5 w-3.5 accent-[#e94560]"
                    />
                    <div className="space-y-1">
                        <div className="text-[11px] text-white/72">Claim authorship on ingest</div>
                        <p className="text-[11px] leading-relaxed text-white/30">
                            Sign each imported image hash with this fotos identity so authenticity proof ships with shared photos.
                        </p>
                    </div>
                </label>
            )}

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

            <div className="p-2.5 bg-white/5 rounded-md text-[11px] text-white/35 space-y-0.5">
                <p><span className="text-yellow-400/60 font-mono">R</span> Reference — pointer to file</p>
                <p><span className="text-blue-400/60 font-mono">M</span> Metadata — EXIF + thumbnail</p>
                <p><span className="text-green-400/60 font-mono">I</span> Ingest — full blob copy</p>
            </div>

            {import.meta.env.DEV && (
                <>
                    <SectionLabel>AI Audit</SectionLabel>
                    <LLMComparisonPanel
                        photo={llmComparisonPhoto ?? null}
                        photoSourceLabel={llmComparisonPhotoLabel ?? 'photo'}
                    />
                </>
            )}
        </>
    );
}

function ManageOptionButton({
    children,
    onClick,
    accent = false,
}: {
    children: React.ReactNode;
    onClick: () => void;
    accent?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`w-full rounded-md border px-2.5 py-1.5 text-left text-[11px] transition-colors ${
                accent
                    ? 'border-[#e94560]/25 bg-[#e94560]/8 text-[#ff9db0]/75 hover:bg-[#e94560]/14 hover:text-[#ffc3cf]'
                    : 'border-white/10 bg-white/5 text-white/45 hover:bg-white/10 hover:text-white/68'
            }`}
        >
            {children}
        </button>
    );
}

function ManageCollectionShareRow({
    collection,
    peers,
    sharePersonIds,
    onRename,
    onDelete,
    onShareChange,
}: {
    collection: FotosCollectionSummary;
    peers: SharePeerOption[];
    sharePersonIds: string[];
    onRename: (collectionId: string, name: string) => void;
    onDelete: (collectionId: string) => void;
    onShareChange: (personIds: string[]) => Promise<void> | void;
}) {
    return (
        <div className="space-y-2 rounded-md border border-white/10 bg-white/[0.035] px-2.5 py-2">
            <div className="flex items-start gap-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/10 bg-black/20 text-[11px] font-semibold text-white/45">
                    {collection.photoCount}
                </div>
                <div className="min-w-0 flex-1">
                    <InlineRenameField
                        value={collection.name}
                        fallback={collection.name}
                        placeholder="Name this collection"
                        onSubmit={name => onRename(collection.id, name)}
                        labelClassName="truncate text-[11px] text-white/75"
                    />
                    <div className="text-[11px] text-white/25">
                        {collection.photoCount} photo{collection.photoCount === 1 ? '' : 's'} · {collection.faceCount} face{collection.faceCount === 1 ? '' : 's'}
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => onDelete(collection.id)}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-white/45 transition-colors hover:bg-red-500/10 hover:text-red-300"
                    aria-label={`Delete collection ${collection.name}`}
                    title="Delete collection"
                >
                    <Trash2 className="h-3.5 w-3.5" />
                </button>
            </div>
            <ShareWithField
                value={sharePersonIds}
                peers={peers}
                onChange={onShareChange}
                emptyLabel="No collection peers selected"
            />
        </div>
    );
}

function ManageClusterShareRow({
    cluster,
    peers,
    sharePersonIds,
    onShareChange,
}: {
    cluster: FaceClusterSummary;
    peers: SharePeerOption[];
    sharePersonIds: string[];
    onShareChange: (personIds: string[]) => Promise<void> | void;
}) {
    return (
        <div className="space-y-2 rounded-md border border-white/10 bg-white/[0.035] px-2.5 py-2">
            <div className="space-y-0.5">
                <div className="truncate text-[11px] text-white/72">{cluster.label}</div>
                <div className="text-[11px] text-white/25">
                    {cluster.photoCount} photo{cluster.photoCount === 1 ? '' : 's'} · {cluster.faceCount} face{cluster.faceCount === 1 ? '' : 's'}
                    {cluster.memberClusterIds.length > 1 ? ` · ${cluster.memberClusterIds.length} clusters` : ''}
                </div>
            </div>
            <ShareWithField
                value={sharePersonIds}
                peers={peers}
                onChange={onShareChange}
                emptyLabel="No cluster peers selected"
            />
        </div>
    );
}

function SettingsTab({
    settings,
    onUpdateStorage,
    onUpdateDeviceName,
    onUpdateAnalysis,
    acceptSharing,
    onAcceptSharingChange,
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
    showOnboarding,
    onDismissOnboarding,
}: {
    settings: FotosSettings;
    onUpdateStorage: (updates: Partial<FotosSettings['storage']>) => void;
    onUpdateDeviceName: (name: string) => void;
    onUpdateAnalysis: (updates: Partial<FotosSettings['analysis']>) => void;
    acceptSharing: boolean;
    onAcceptSharingChange: (enabled: boolean) => void;
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
    showOnboarding?: boolean;
    onDismissOnboarding?: () => void;
}) {
    const { deviceSettings, updateDeviceSettings } = useDeviceSettings(fotosModel);

    const settingsSections = [
        { id: 'settings-identity', label: 'Identity' },
        { id: 'settings-storage', label: 'Storage' },
        { id: 'settings-imageai', label: 'Image AI' },
        { id: 'settings-history', label: 'History' },
        { id: 'settings-devices', label: 'Devices' },
    ] as const;

    const [activeSection, setActiveSection] = useState<string>(settingsSections[0].id);
    const sectionRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const scrollContainerRef = useRef<HTMLDivElement | null>(null);
    const isScrollingRef = useRef(false);

    const setSectionRef = useCallback((id: string, el: HTMLDivElement | null) => {
        if (el) {
            sectionRefs.current.set(id, el);
        } else {
            sectionRefs.current.delete(id);
        }
    }, []);

    // IntersectionObserver to track which section is in view
    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (isScrollingRef.current) return;
                // Find the topmost visible section
                const visible = entries
                    .filter(e => e.isIntersecting)
                    .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
                if (visible.length > 0) {
                    const id = visible[0].target.getAttribute('id');
                    if (id) setActiveSection(id);
                }
            },
            {
                root: container,
                rootMargin: '-8px 0px -60% 0px',
                threshold: 0,
            },
        );

        for (const [, el] of sectionRefs.current) {
            observer.observe(el);
        }

        return () => observer.disconnect();
    }, []);

    const scrollToSection = useCallback((sectionId: string) => {
        const el = sectionRefs.current.get(sectionId);
        if (!el) return;
        setActiveSection(sectionId);
        isScrollingRef.current = true;
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // Reset scrolling flag after animation completes
        setTimeout(() => { isScrollingRef.current = false; }, 500);
    }, []);

    return (
        <div className="flex flex-col -m-3 min-h-0">
            {/* Sticky pill navigation */}
            <div className="sticky top-0 z-10 bg-[#0d0d0d] border-b border-white/8 px-3 py-2">
                <div className="flex gap-1 overflow-x-auto scrollbar-none">
                    {settingsSections.map(section => (
                        <button
                            key={section.id}
                            onClick={() => scrollToSection(section.id)}
                            className={`shrink-0 text-[11px] font-medium px-2.5 py-1 rounded-full transition-colors ${
                                activeSection === section.id
                                    ? 'bg-white/10 text-white/80'
                                    : 'text-white/35 hover:text-white/55'
                            }`}
                        >
                            {section.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Scrollable settings content */}
            <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-3 space-y-4">
                <div id="settings-identity" ref={el => setSectionRef('settings-identity', el)}>
                    <FotosSettingsPanel
                        model={fotosModel}
                        acceptSharing={acceptSharing}
                        onAcceptSharingChange={onAcceptSharingChange}
                    />
                </div>

                <div className="border-t border-white/10 pt-4 mt-2" />

                <div id="settings-storage" ref={el => setSectionRef('settings-storage', el)}>
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
                </div>

                <div id="settings-imageai" ref={el => setSectionRef('settings-imageai', el)}>
                    <CollapsibleSection label="Image AI">
                        <label className="flex items-start gap-2 rounded-md border border-white/10 bg-white/5 px-2.5 py-2">
                            <input
                                type="checkbox"
                                checked={settings.analysis.faceAnalyticsEnabled}
                                onChange={event => onUpdateAnalysis({ faceAnalyticsEnabled: event.target.checked })}
                                className="mt-0.5 h-3.5 w-3.5 accent-[#e94560]"
                            />
                            <div className="space-y-1">
                                <div className="text-[11px] text-white/72">Enable face analytics</div>
                                <p className="text-[11px] leading-relaxed text-white/30">
                                    Download face models only when you choose to use people clustering and similar-face search.
                                </p>
                            </div>
                        </label>

                        {showOnboarding && (
                            <div className="relative bg-[#e94560] text-white p-3 rounded-lg shadow-xl mt-2 animate-[viewFadeIn_300ms_ease] z-50">
                                <div className="flex items-start justify-between gap-2">
                                    <div>
                                        <p className="font-semibold text-xs mb-0.5">👤 Face & AI Analytics</p>
                                        <p className="text-[11px] text-white/95 leading-tight">Enable face analytics here to cluster people and enable facial search.</p>
                                    </div>
                                    <button type="button" onClick={onDismissOnboarding} className="text-white/60 hover:text-white text-xs font-bold shrink-0">✕</button>
                                </div>
                            </div>
                        )}

                        <label className="flex items-start gap-2 rounded-md border border-white/10 bg-white/5 px-2.5 py-2">
                            <input
                                type="checkbox"
                                checked={settings.analysis.semanticSearchEnabled}
                                onChange={event => onUpdateAnalysis({ semanticSearchEnabled: event.target.checked })}
                                className="mt-0.5 h-3.5 w-3.5 accent-[#e94560]"
                            />
                            <div className="space-y-1">
                                <div className="text-[11px] text-white/72">Enable semantic search</div>
                                <p className="text-[11px] leading-relaxed text-white/30">
                                    Download the multimodal search model only when you want meaning-based search.
                                </p>
                            </div>
                        </label>

                    </CollapsibleSection>
                </div>

                <div id="settings-history" ref={el => setSectionRef('settings-history', el)}>
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
                                <p className="text-[11px] leading-relaxed text-white/30">
                                    Keep branchable gallery places in synced settings so trusted instances can resume where you left off.
                                </p>
                            </div>
                        </label>

                        <div className="rounded-md bg-white/[0.035] px-2.5 py-2 text-[11px] text-white/30">
                            {historyReady
                                ? `${historyVisibleEntryCount} saved place${historyVisibleEntryCount === 1 ? '' : 's'} across ${historyBranchCount} branch${historyBranchCount === 1 ? '' : 'es'}`
                                : 'Loading synced history...'}
                        </div>

                        {!historyEnabled && historyVisibleEntryCount > 0 && (
                            <div className="text-[11px] leading-relaxed text-white/24">
                                Recording is paused. Existing branches stay available until you delete them.
                            </div>
                        )}

                        {historyVisibleEntryCount === 0 ? (
                            <div className="rounded-md border border-dashed border-white/10 px-2.5 py-2 text-[11px] text-white/24">
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
                </div>

                <div id="settings-devices" ref={el => setSectionRef('settings-devices', el)}>
                    <DevicesSettingsSection
                        name={settings.device.name}
                        settings={deviceSettings}
                        onUpdateName={onUpdateDeviceName}
                        onUpdateSettings={updateDeviceSettings}
                    />
                </div>
            </div>
        </div>
    );
}

function DevicesSettingsSection({
    name,
    settings,
    onUpdateName,
    onUpdateSettings,
}: {
    name: string;
    settings: FotosDeviceSettings;
    onUpdateName: (name: string) => void;
    onUpdateSettings: (updates: Partial<FotosDeviceSettings>) => void;
}) {
    const discoveryDisplayName = settings.discoveryIdentity?.displayName ?? '';

    const updateDiscoveryDisplayName = (displayName: string) => {
        const nextDiscoveryIdentity = { ...(settings.discoveryIdentity ?? {}) };
        if (displayName.trim().length > 0) {
            nextDiscoveryIdentity.displayName = displayName;
        } else {
            delete nextDiscoveryIdentity.displayName;
        }

        onUpdateSettings({
            discoveryIdentity: nextDiscoveryIdentity,
        });
    };

    return (
        <CollapsibleSection label="Devices">
            <SmallField label="Device name">
                <input
                    type="text"
                    value={name}
                    onChange={e => onUpdateName(e.target.value)}
                    className="sidebar-input"
                />
            </SmallField>

            <SettingsCheckbox
                checked={settings.discoveryEnabled}
                label="Local discovery"
                detail="mDNS peer discovery on the local network."
                onChange={checked => onUpdateSettings({ discoveryEnabled: checked })}
            />

            <SettingsCheckbox
                checked={settings.autoConnect}
                label="Auto-connect"
                detail="Connect to trusted devices when discovery finds them."
                onChange={checked => onUpdateSettings({ autoConnect: checked })}
            />

            <SettingsCheckbox
                checked={settings.addOnlyConnectedDevices}
                label="Add only connected devices"
                detail="Keep device lists limited to peers that have connected."
                onChange={checked => onUpdateSettings({ addOnlyConnectedDevices: checked })}
            />

            <SettingsCheckbox
                checked={settings.showOfflineDevices}
                label="Show offline devices"
                detail="Keep known devices visible after they go offline."
                onChange={checked => onUpdateSettings({ showOfflineDevices: checked })}
            />

            <SettingsCheckbox
                checked={settings.autoTrustKnownPersonDevices}
                label="Auto-trust known devices"
                detail="Trust new devices from known people during discovery."
                onChange={checked => onUpdateSettings({ autoTrustKnownPersonDevices: checked })}
            />

            <SmallField label="Discovery timeout (ms)">
                <input
                    type="number"
                    value={settings.discoveryTimeout}
                    onChange={e => onUpdateSettings({ discoveryTimeout: Math.max(1000, parseInt(e.target.value, 10) || 1000) })}
                    className="sidebar-input w-28"
                    min={1000}
                    step={1000}
                />
            </SmallField>

            <SmallField label="Profile visibility">
                <select
                    value={settings.profileVisibility}
                    onChange={e => onUpdateSettings({
                        profileVisibility: e.target.value as FotosDeviceSettings['profileVisibility'],
                    })}
                    className="sidebar-input"
                >
                    <option value="minimal">Name only</option>
                    <option value="full">Full profile</option>
                </select>
            </SmallField>

            <SmallField label="Discovery display name">
                <input
                    type="text"
                    value={discoveryDisplayName}
                    onChange={e => updateDiscoveryDisplayName(e.target.value)}
                    className="sidebar-input"
                    placeholder={name}
                />
            </SmallField>
        </CollapsibleSection>
    );
}

function SettingsCheckbox({
    checked,
    label,
    detail,
    onChange,
}: {
    checked: boolean;
    label: string;
    detail: string;
    onChange: (checked: boolean) => void;
}) {
    return (
        <label className="flex items-start gap-2 rounded-md border border-white/10 bg-white/5 px-2.5 py-2">
            <input
                type="checkbox"
                checked={checked}
                onChange={event => onChange(event.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 accent-[#e94560]"
            />
            <div className="space-y-1">
                <div className="text-[11px] text-white/72">{label}</div>
                <p className="text-[11px] leading-relaxed text-white/30">{detail}</p>
            </div>
        </label>
    );
}

function SmallField({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="block">
            <span className="text-[11px] text-white/30 mb-0.5 block">{label}</span>
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
                        <div className="truncate text-[11px] text-white/25">
                            {trail || folderName || 'Library'}
                        </div>
                        <div className="text-[11px] text-white/18">
                            {new Date(node.entry.createdAt).toLocaleString()}
                        </div>
                        {!canNavigate && (
                            <div className="text-[11px] leading-relaxed text-white/18">
                                Open {folderName || 'this folder'} to restore this branch.
                            </div>
                        )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                        <button
                            type="button"
                            onClick={() => onNavigate(node.entry.eventId)}
                            disabled={!canNavigate || isCurrent}
                            className={`rounded-md px-2 py-1 text-[11px] transition-colors ${
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
                            className="flex h-11 w-11 items-center justify-center rounded-md text-white/45 transition-colors hover:bg-red-500/10 hover:text-red-300"
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
