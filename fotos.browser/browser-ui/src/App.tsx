import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Impressum } from '@/components/Impressum';
import { GalleryBreadcrumbs } from '@/components/GalleryBreadcrumbs';
import { PhotoGrid } from '@/components/PhotoGrid';
import { Lightbox } from '@/components/Lightbox';
import { Sidebar } from '@/components/Sidebar';
import { ConfirmModal } from '@/components/ConfirmModal';
import { ContextMenu } from '@/components/ContextMenu';
import { RenameModal } from '@/components/RenameModal';
import { TimelineScrubber } from '@/components/TimelineScrubber';
import { ClusterGallery } from '@/components/ClusterGallery';
import { useGallery } from '@/hooks/useGallery';
import { useHeadlessSource } from '@/hooks/useHeadlessSource';
import { useBreadcrumbHistory } from '@/hooks/useBreadcrumbHistory';
import { useFotosCollections } from '@/hooks/useFotosCollections';
import { useSettings } from '@/hooks/useSettings';
import { shareFile, shareFiles } from '@/lib/platform';
import { UpdatePrompt } from '@/components/UpdatePrompt';
import {
    DEFAULT_GLUE_CONNECTION_BINDING_ID,
} from '@glueone/glue.core';
import { getFaceCount, resolveProgressDisplay } from '@refinio/fotos.ui';
import type { PhotoEntry } from '@refinio/fotos.ui';
import type { FotosModel } from './lib/onecore-boot';
import { setModelUpdater } from './lib/onecore-boot';
import { traceHang } from './lib/hangTrace';
import type { SimilarFaceMatch } from '@/lib/cluster-gallery';
import { shouldExposeFotosDebugApi } from '@/lib/fotosLiveDiagnostics';
import { fotosShareController, type FotosShareSnapshot } from '@/lib/fotosShareController';
import { buildFotosCollectionSummaries } from '@/lib/fotosCollections';
import {
    buildAcceptedIncomingSharingPeerIds,
    collectSharedPersonIds,
    shouldAdvertiseSharingIdentity,
} from '@/lib/fotosSharingPolicy';
import { isSnapshotEqual, type FotosBreadcrumbSnapshot } from '@/lib/fotosHistorySettings';
import {
    grantFotosAccess,
    retainFotosManifestConvergence,
    revokeLegacyFotosManifestAccess,
} from '@/lib/fotos-manifest';
import { resolveShareGrantPersonIds } from '@/lib/shareGrantTargets';
import {
    ensureConfiguredGlueIdentity,
    publishLocalGlueProfileCredential,
} from '@/lib/glueIdentity';
import {
    buildPersistentPhotoPath,
    parsePersistentPhotoRouteTarget,
} from '@/lib/photoRoute';
import { resolveGlueIdentityState } from '@/lib/glueIdentityState';
import { resolveTokenToPersonId, type SharePeerOption } from '@/components/ShareWithField';
import { writeStoredSidebarTab } from '@/lib/authFlowState';
import {
    createFotosShareInvite,
    parseFotosShareInviteUrl,
    type CreatedFotosShareInvite,
    type FotosShareInvitePayload,
} from '@/lib/fotosShareInvite';
import { DEBUG_REGISTRATION_TOKEN, DEBUG_REGISTRATION_TTL_MS } from './config';
import { setFotosRuntimeSnapshot, setFotosRuntimeVisiblePhotos } from './lib/runtimeDiagnostics';
import { determineAccessibleHashes } from '@refinio/one.core/lib/util/determine-accessible-hashes.js';
import { commitFotosShareScope } from '@/lib/fotosShareCertificates';
import type { FotosShareScope } from '@refinio/fotos.core';

interface AppProps {
    fotosModel?: FotosModel;
}

interface RouteLocationSnapshot {
    pathname: string;
    search: string;
    hash: string;
}

interface PersistedShareContact {
    personId: string;
    displayName: string | null;
    glueIdentity: string | null;
}

type IncomingShareInviteStatus = 'idle' | 'choosing-folder' | 'preparing' | 'connecting' | 'accepted' | 'error';
type CreatedGalleryShareInvite = CreatedFotosShareInvite & {
    sharedCount: number;
};

function getCurrentRouteLocation(): RouteLocationSnapshot {
    if (typeof window === 'undefined') {
        return {
            pathname: '/',
            search: '',
            hash: '',
        };
    }

    return {
        pathname: window.location.pathname,
        search: window.location.search,
        hash: window.location.hash,
    };
}

function areRouteLocationsEqual(
    left: RouteLocationSnapshot,
    right: RouteLocationSnapshot,
): boolean {
    return left.pathname === right.pathname
        && left.search === right.search
        && left.hash === right.hash;
}

function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name} as data URL.`));
        reader.onload = () => {
            if (typeof reader.result !== 'string') {
                reject(new Error(`Unexpected FileReader result for ${file.name}.`));
                return;
            }
            resolve(reader.result);
        };
        reader.readAsDataURL(file);
    });
}

interface FotosDebugApi {
    getStatus: () => {
        initialized: boolean;
        ownerId: string | null;
        publicationIdentity: string | null;
        headlessConnected: boolean;
        isOpen: boolean;
        folderName: string | null;
        entryCount: number;
        visiblePhotoCount: number;
    };
    getLocalIdentitySnapshot: () => Promise<{
        ownerId: string | null;
        publicationIdentity: string | null;
        glueDisplayName: string | null;
        syncEnabled: boolean;
        headlessConnected: boolean;
    }>;
    prepareIdentity: (displayName: string) => Promise<{
        personId: string;
        created: boolean;
        syncEnabled: boolean;
        reloadRequired: boolean;
    }>;
    registerPreparedIdentity: (displayName?: string) => Promise<{
        personId: string;
        identity: string;
        cert: Record<string, unknown> | null;
    }>;
    getPresenceSnapshot: () => Promise<unknown | null>;
    getOnlinePeers: () => Array<{
        personId: string;
        displayName: string | null;
        hasVerifiedIdentity: boolean;
        transportCapabilities: string[];
    }>;
    getSharePeerOptions: () => Array<{
        personId: string;
        displayName: string | null;
        glueIdentity: string | null;
        online: boolean;
        hasVerifiedIdentity: boolean;
        persistent: boolean;
    }>;
    resolveShareToken: (token: string) => Promise<{
        personId: string | null;
        persistent: boolean;
        displayName: string | null;
        glueIdentity: string | null;
    }>;
    getWantedPeerIds: () => string[];
    getConnectablePeerIds: () => string[];
    getPeerConnectionCoordinatorDebug: () => Array<{
        personId: string;
        state: string;
        routeKey?: string;
        retryAt?: number;
        directInFlight: boolean;
        forceRetry: boolean;
        manualRequested: boolean;
        hasRelayLane: boolean;
        hasDirectLane: boolean;
        advertisedKey?: string;
        isDemandedPeer: boolean;
        isAutoConnectPeer: boolean;
        transportCapabilities?: string[];
    }>;
    getPeerConnectionInfo: (personId: string) => {
        online: boolean;
        advertisedDisplayName: string | null;
        certifiedDisplayName: string | null;
        advertisedEncryptionKey: string | null;
        coordinatorState: string | null;
        encryptionKey: string | null;
        certifiedEncryptionKeys: string[];
        certifiedCredentialIssuedAt: number | null;
        transportCapabilities: string[];
        hasVerifiedIdentity: boolean;
    };
    requestPeerConnection: (personId: string) => {
        requested: boolean;
        state: string | null;
    };
    createGalleryShareInvite: () => Promise<{
        url: string;
        pin: string;
        expiresAt: string;
    }>;
    acceptGalleryShareInvite: (pin?: string) => Promise<{
        accepted: true;
        senderPersonId: string;
    }>;
    forceRouteKeyConnect: (personId: string, keySource?: 'advertised' | 'certified') => Promise<{
        started: true;
        encryptionKey: string;
        transportCapabilities: string[];
        keySource: 'advertised' | 'certified';
    }>;
    grantFotosAccess: (personId: string) => Promise<{ granted: true; personId: string }>;
    getAccessibleRootSummary: (personId: string) => Promise<Array<{
        type: string;
        oneType: string | null;
        hash: string | null;
        idHash: string | null;
        node: string | null;
        dataType: string | null;
        dataIdHash: string | null;
    }>>;
    getFotosSyncState: () => Promise<FotosShareSnapshot>;
    getShareState: () => Promise<FotosShareSnapshot>;
    getGalleryState: () => {
        isOpen: boolean;
        folderName: string | null;
        totalCount: number;
        visibleCount: number;
        items: Array<{
            hash: string;
            name: string;
            sourcePath?: string;
            thumb?: string;
            capturedAt?: string;
            updatedAt?: string;
            faceCount: number;
        }>;
    };
    openLocalPicker: () => boolean;
}

async function getLocalIdentitySnapshot(
    targetModel: FotosModel | null | undefined,
): Promise<Awaited<ReturnType<FotosDebugApi['getLocalIdentitySnapshot']>>> {
    if (!targetModel?.initialized) {
        return {
            ownerId: null,
            publicationIdentity: null,
            glueDisplayName: null,
            syncEnabled: false,
            headlessConnected: false,
        };
    }

    const { values } = await targetModel.settingsPlan
        .getSection({ moduleId: 'glue' })
        .catch(() => ({ values: {} as Record<string, unknown> }));
    const resolvedIdentity = resolveGlueIdentityState(
        values,
        targetModel.publicationIdentity ? String(targetModel.publicationIdentity) : null,
        DEFAULT_GLUE_CONNECTION_BINDING_ID,
    );

    return {
        ownerId: targetModel.ownerId ? String(targetModel.ownerId) : null,
        publicationIdentity: resolvedIdentity.publicationIdentity,
        glueDisplayName: resolvedIdentity.displayName,
        syncEnabled: values.syncEnabled === true,
        headlessConnected: Boolean(targetModel.headlessConnected),
    };
}

export function App({ fotosModel: initialModel }: AppProps) {
    const [fotosModel, setFotosModel] = useState<FotosModel | null>(initialModel ?? null);
    const [headlessUrl, setHeadlessUrl] = useState<string | null>(null);
    const [headlessInput, setHeadlessInput] = useState('');
    const [showHeadlessConnect, setShowHeadlessConnect] = useState(false);
    const [clusterSelectionEnabled, setClusterSelectionEnabled] = useState(false);
    const [selectedPhotoHashes, setSelectedPhotoHashes] = useState<string[]>([]);
    const [selectedClusterIds, setSelectedClusterIds] = useState<string[]>([]);
    const [sharePeerOptions, setSharePeerOptions] = useState<SharePeerOption[]>([]);
    const [contactPersonIds, setContactPersonIds] = useState<string[]>([]);
    const [exportingPhotos, setExportingPhotos] = useState(false);
    const [shareManifestHash, setShareManifestHash] = useState<string | null>(null);
    const [createdShareInvite, setCreatedShareInvite] = useState<CreatedGalleryShareInvite | null>(null);
    const [creatingShareInvite, setCreatingShareInvite] = useState(false);
    const [incomingShareInvite, setIncomingShareInvite] = useState<FotosShareInvitePayload | null>(() =>
        typeof window === 'undefined' ? null : parseFotosShareInviteUrl(window.location.href),
    );
    const [incomingShareStatus, setIncomingShareStatus] = useState<IncomingShareInviteStatus>('idle');
    const [incomingShareError, setIncomingShareError] = useState<string | null>(null);
    const [shareSnapshot, setShareSnapshot] = useState<FotosShareSnapshot | null>(null);
    const [confirmState, setConfirmState] = useState<{
        open: boolean;
        title: string;
        message: string;
        confirmLabel?: string;
        isDestructive?: boolean;
        onConfirm: () => void | Promise<void>;
    } | null>(null);
    const [renameState, setRenameState] = useState<{
        kind: 'cluster' | 'collection';
        id: string;
        title: string;
        label: string;
        initialValue: string;
    } | null>(null);
    const showConfirm = useCallback((opts: {
        title: string;
        message: string;
        confirmLabel?: string;
        isDestructive?: boolean;
        onConfirm: () => void | Promise<void>;
    }) => {
        setConfirmState({ open: true, ...opts });
    }, []);

    // Wire up model updater so async state changes (e.g. headlessConnected) trigger re-renders
    useEffect(() => {
        setModelUpdater(setFotosModel);
        return () => setModelUpdater(null);
    }, []);
    const {
        settings,
        acceptSharing,
        updateStorage,
        updateDisplay,
        updateDeviceName,
        updateAnalysis,
        updateAcceptSharing,
    } = useSettings(fotosModel);
    const fotosCollections = useFotosCollections(fotosModel);
    const headlessFolder = useHeadlessSource(headlessUrl);
    const gallery = useGallery({
        faceAnalyticsEnabled: settings.analysis.faceAnalyticsEnabled,
        semanticSearchEnabled: settings.analysis.semanticSearchEnabled,
        clusterSensitivity: settings.analysis.clusterSensitivity,
        collections: fotosCollections.collections,
        folder: headlessUrl ? headlessFolder : undefined,
    });
    const scrollRef = useRef<HTMLDivElement>(null);
    const pendingGalleryInviteTokensRef = useRef(new Set<string>());
    const certificateBackfilledScopesRef = useRef(new Set<string>());
    const legacyFotosAccessRetiredRef = useRef(false);
    const [routeLocation, setRouteLocation] = useState<RouteLocationSnapshot>(getCurrentRouteLocation);
    const selectedPhotoHashSet = useMemo(() => new Set(selectedPhotoHashes), [selectedPhotoHashes]);
    // Selection is implicit: the grid is "selecting" whenever anything is selected.
    const photoSelectionActive = selectedPhotoHashes.length > 0;
    const selectedClusterIdSet = useMemo(() => new Set(selectedClusterIds), [selectedClusterIds]);
    const ownKnownPersonIds = useMemo(
        () => new Set(
            [fotosModel?.ownerId, fotosModel?.publicationIdentity]
                .map(personId => typeof personId === 'string' ? personId.trim() : '')
                .filter(personId => personId.length > 0),
        ),
        [fotosModel?.ownerId, fotosModel?.publicationIdentity],
    );
    const collectionSummaries = useMemo(
        () => buildFotosCollectionSummaries(fotosCollections.collections, gallery.folder.entries),
        [fotosCollections.collections, gallery.folder.entries],
    );
    const selectedPhotosForCollections = useMemo(
        () => gallery.folder.entries.filter(photo => selectedPhotoHashSet.has(photo.hash)),
        [gallery.folder.entries, selectedPhotoHashSet],
    );
    const selectedClustersForCollections = useMemo(
        () => gallery.allClusters.filter(cluster => selectedClusterIdSet.has(cluster.clusterId)),
        [gallery.allClusters, selectedClusterIdSet],
    );
    const sharedPersonIds = useMemo(
        () => collectSharedPersonIds(fotosCollections.sharing).filter(personId => !ownKnownPersonIds.has(personId)),
        [fotosCollections.sharing, ownKnownPersonIds],
    );
    const acceptedIncomingPeerIds = useMemo(
        () => buildAcceptedIncomingSharingPeerIds({
            sharing: fotosCollections.sharing,
            contactPersonIds,
            acceptSharing,
        }).filter(personId => !ownKnownPersonIds.has(personId)),
        [acceptSharing, contactPersonIds, fotosCollections.sharing, ownKnownPersonIds],
    );
    const advertiseSharingIdentity = useMemo(
        () => shouldAdvertiseSharingIdentity({
            sharing: fotosCollections.sharing,
            acceptSharing,
        }),
        [acceptSharing, fotosCollections.sharing],
    );
    const visiblePhotos = gallery.galleryMode === 'clusters' && gallery.activeClusterId
        ? gallery.clusterPhotos
        : gallery.galleryMode === 'images' && gallery.activeCollectionId
            ? gallery.collectionPhotos
        : gallery.photos;
    const comparisonPhoto = gallery.selectedIndex !== null
        ? visiblePhotos[gallery.selectedIndex] ?? null
        : visiblePhotos[0] ?? null;
    const comparisonPhotoLabel = gallery.selectedIndex !== null
        ? 'selected photo'
        : 'first visible photo';
    const visibleDayGroups = gallery.galleryMode === 'clusters' && gallery.activeClusterId
        ? gallery.clusterDayGroups
        : gallery.galleryMode === 'images' && gallery.activeCollectionId
            ? gallery.collectionDayGroups
        : gallery.dayGroups;
    const showClusterGallery = gallery.galleryMode === 'clusters' && !gallery.activeClusterId;
    const trimmedSearchQuery = gallery.searchQuery.trim();

    const [contextMenu, setContextMenu] = useState<{
        x: number;
        y: number;
        type: 'photo' | 'cluster' | 'collection';
        visible: boolean;
        data: any;
    } | null>(null);

    const [showOnboarding, setShowOnboarding] = useState(false);

    useEffect(() => {
        const dismissed = localStorage.getItem('onboarding_dismissed') === 'true';
        if (!dismissed && gallery.folder.isOpen && !gallery.loading && visiblePhotos.length > 0) {
            setShowOnboarding(true);
        } else {
            setShowOnboarding(false);
        }
    }, [gallery.folder.isOpen, gallery.loading, visiblePhotos.length]);

    const handleDismissOnboarding = useCallback(() => {
        localStorage.setItem('onboarding_dismissed', 'true');
        setShowOnboarding(false);
    }, []);

    const handlePhotoContextMenu = useCallback((photo: PhotoEntry, _index: number, event: React.MouseEvent | React.TouchEvent) => {
        event.preventDefault();
        event.stopPropagation();
        
        let clientX = 0;
        let clientY = 0;
        if ('touches' in event) {
            const touch = event.touches[0];
            if (touch) {
                clientX = touch.clientX;
                clientY = touch.clientY;
            }
        } else {
            clientX = event.clientX;
            clientY = event.clientY;
        }
        
        setContextMenu({
            visible: true,
            x: clientX,
            y: clientY,
            type: 'photo',
            data: photo,
        });
    }, []);

    const handleClusterContextMenu = useCallback((cluster: any, event: React.MouseEvent | React.TouchEvent) => {
        event.preventDefault();
        event.stopPropagation();
        
        let clientX = 0;
        let clientY = 0;
        if ('touches' in event) {
            const touch = event.touches[0];
            if (touch) {
                clientX = touch.clientX;
                clientY = touch.clientY;
            }
        } else {
            clientX = event.clientX;
            clientY = event.clientY;
        }
        
        setContextMenu({
            visible: true,
            x: clientX,
            y: clientY,
            type: 'cluster',
            data: cluster,
        });
    }, []);

    const handleCollectionContextMenu = useCallback((collection: any, event: React.MouseEvent | React.TouchEvent) => {
        event.preventDefault();
        event.stopPropagation();
        
        let clientX = 0;
        let clientY = 0;
        if ('touches' in event) {
            const touch = event.touches[0];
            if (touch) {
                clientX = touch.clientX;
                clientY = touch.clientY;
            }
        } else {
            clientX = event.clientX;
            clientY = event.clientY;
        }
        
        setContextMenu({
            visible: true,
            x: clientX,
            y: clientY,
            type: 'collection',
            data: collection,
        });
    }, []);


    const hasGalleryDetail = gallery.galleryMode === 'clusters'
        || gallery.activeCollectionId !== null
        || gallery.activeTag !== null
        || trimmedSearchQuery.length > 0
        || gallery.searchFace !== null
        || gallery.activeClusterId !== null;

    const handleRenameFace = useCallback(
        (clusterId: string, name: string) => gallery.folder.renameFace(clusterId, name),
        [gallery.folder],
    );

    const handleDeleteFace = useCallback((clusterId: string) => {
        if ((fotosCollections.sharing.clusterPersonIds[clusterId]?.length ?? 0) > 0) {
            showConfirm({
                title: 'Stop sharing first',
                message: 'This person scope is still shared. Remove every recipient in Sharing before deleting the face cluster so revocation can be published.',
                confirmLabel: 'Okay',
                onConfirm: () => {},
            });
            return;
        }
        showConfirm({
            title: 'Delete face cluster',
            message: 'This will permanently remove the face cluster and all its associations. This cannot be undone.',
            isDestructive: true,
            onConfirm: () => {
                void gallery.folder.deleteFace(clusterId);
            },
        });
    }, [fotosCollections.sharing.clusterPersonIds, gallery.folder, showConfirm]);

    const handleRenameCluster = useCallback((clusterId: string) => {
        const currentName = gallery.allClusters.find(c => c.clusterId === clusterId)?.label || '';
        setRenameState({
            kind: 'cluster',
            id: clusterId,
            title: 'Rename face cluster',
            label: 'Name',
            initialValue: currentName,
        });
    }, [gallery.allClusters]);

    const handleRenameCollectionAction = useCallback((collectionId: string) => {
        const currentName = collectionSummaries.find(c => c.id === collectionId)?.name || '';
        setRenameState({
            kind: 'collection',
            id: collectionId,
            title: 'Rename collection',
            label: 'Collection name',
            initialValue: currentName,
        });
    }, [collectionSummaries]);

    const handleDeleteCollection = useCallback((collectionId: string) => {
        const collectionName = collectionSummaries.find(collection => collection.id === collectionId)?.name
            ?? 'this collection';
        if ((fotosCollections.sharing.collectionPersonIds[collectionId]?.length ?? 0) > 0) {
            showConfirm({
                title: 'Stop sharing first',
                message: `“${collectionName}” is still shared. Remove every recipient in Sharing before deleting it so revocation can be published.`,
                confirmLabel: 'Okay',
                onConfirm: () => {},
            });
            return;
        }
        showConfirm({
            title: 'Delete collection',
            message: `Delete “${collectionName}”? Its photos remain in the library. This cannot be undone.`,
            confirmLabel: 'Delete collection',
            isDestructive: true,
            onConfirm: () => fotosCollections.deleteCollection(collectionId),
        });
    }, [collectionSummaries, fotosCollections, showConfirm]);

    const handleRemoveFolder = useCallback((folderId: string) => {
        const folderName = gallery.folder.folders.find(folder => folder.id === folderId)?.name ?? 'this folder';
        showConfirm({
            title: 'Remove folder',
            message: `Remove “${folderName}” from fotos? Original files and the folder on disk are not deleted.`,
            confirmLabel: 'Remove folder',
            isDestructive: true,
            onConfirm: () => gallery.folder.removeFolder(folderId),
        });
    }, [gallery.folder, showConfirm]);

    const handleAssociateFaceWithCluster = useCallback((photoHash: string, faceIndex: number, clusterId: string) => {
        void gallery.folder.associateFaceWithCluster(photoHash, faceIndex, clusterId);
    }, [gallery.folder]);

    const handleMergeFaceClusters = useCallback((targetClusterId: string, sourceClusterIds: string[]) => {
        const uniqueSourceIds = Array.from(new Set(sourceClusterIds.filter(id => id !== targetClusterId)));
        if (uniqueSourceIds.length === 0) return;
        showConfirm({
            title: 'Merge face clusters',
            message: `Merge ${uniqueSourceIds.length} face cluster${uniqueSourceIds.length === 1 ? '' : 's'} into the selected person? This changes face associations and cannot currently be undone.`,
            confirmLabel: 'Merge clusters',
            isDestructive: true,
            onConfirm: () => {
                void gallery.folder.mergeFaceClusters(targetClusterId, uniqueSourceIds);
            },
        });
    }, [gallery.folder, showConfirm]);

    const handleGroupFaceClustersAsPerson = useCallback((clusterIds: string[]) => {
        const uniqueIds = Array.from(new Set(clusterIds));
        if (uniqueIds.length < 2) return;
        showConfirm({
            title: 'Group as one person',
            message: `Group ${uniqueIds.length} face clusters as one person? You can separate them again later.`,
            confirmLabel: 'Group as one person',
            onConfirm: () => {
                void gallery.folder.groupFaceClustersAsPerson(uniqueIds);
            },
        });
    }, [gallery.folder, showConfirm]);

    // Name (and, when more than one is involved, group) face clusters under a
    // single identity. Powers the implicit "select faces → name them" flow.
    const handleNameClusters = useCallback(async (memberClusterIds: string[], name: string) => {
        const ids = Array.from(new Set(
            memberClusterIds.map(id => id.trim()).filter(Boolean),
        ));
        if (ids.length === 0) return;
        if (ids.length > 1) {
            await gallery.folder.groupFaceClustersAsPerson(ids);
        }
        const trimmed = name.trim();
        if (trimmed) {
            await gallery.folder.renameFace(ids[0], trimmed);
        }
    }, [gallery.folder]);

    const handleSeparatePersonGroup = useCallback((personId: string) => {
        showConfirm({
            title: 'Separate person group',
            message: 'Separate this person back into individual face clusters? Existing person grouping will be removed.',
            confirmLabel: 'Separate clusters',
            isDestructive: true,
            onConfirm: () => {
                void gallery.folder.separatePersonGroup(personId);
            },
        });
    }, [gallery.folder, showConfirm]);

    useEffect(() => {
        const activePresenceService = fotosModel?.glueModule?.presenceTrieService;
        const activeContactsPlan = fotosModel?.contactsPlan;
        if (!activePresenceService && !activeContactsPlan) {
            setSharePeerOptions([]);
            setContactPersonIds([]);
            return;
        }

        let cancelled = false;

        const refreshPeers = async () => {
            const peerOptionsByPersonId = new Map<string, SharePeerOption>();
            const onlinePersonIds = activePresenceService?.getOnlinePeerIds() ?? [];
            for (const personId of onlinePersonIds) {
                if (ownKnownPersonIds.has(personId)) {
                    continue;
                }

                peerOptionsByPersonId.set(personId, {
                    personId,
                    displayName: activePresenceService?.getDisplayName(personId) ?? null,
                    online: true,
                    hasVerifiedIdentity: activePresenceService?.hasVerifiedIdentity(personId) ?? false,
                    persistent: false,
                });
            }

            if (activeContactsPlan) {
                try {
                    const listResult = activeContactsPlan.listContacts
                        ? await activeContactsPlan.listContacts({ limit: 500, sortBy: 'name', sortOrder: 'asc' })
                        : null;
                    const getResult = !listResult?.success && activeContactsPlan.getContacts
                        ? await activeContactsPlan.getContacts()
                        : null;
                    const rawContacts = listResult?.success
                        ? (listResult.contacts ?? [])
                        : getResult?.success
                            ? (getResult.data ?? [])
                            : [];
                    const contacts: PersistedShareContact[] = rawContacts.map((contact) => {
                            const personId = typeof contact.personId === 'string' ? contact.personId.trim() : '';
                            const displayName = typeof contact.name === 'string' ? contact.name.trim() : '';
                            const contactEmail = typeof contact.email === 'string' ? contact.email.trim().toLowerCase() : '';
                            const contactIdentity = typeof contact.identity === 'string' ? contact.identity.trim().toLowerCase() : '';
                            const glueIdentity = (
                                contactIdentity
                                || contactEmail
                            ) || null;
                            if (!personId || ownKnownPersonIds.has(personId)) {
                                return null;
                            }

                            return {
                                personId,
                                displayName: displayName || null,
                                glueIdentity,
                            };
                        }).filter((contact): contact is PersistedShareContact => contact !== null);

                    for (const contact of contacts) {
                        const existing = peerOptionsByPersonId.get(contact.personId);
                        peerOptionsByPersonId.set(contact.personId, {
                            personId: contact.personId,
                            displayName: existing?.displayName ?? contact.displayName,
                            glueIdentity: existing?.glueIdentity ?? contact.glueIdentity,
                            online: existing?.online ?? false,
                            hasVerifiedIdentity: existing?.hasVerifiedIdentity ?? false,
                            persistent: true,
                        });
                    }

                    if (!cancelled) {
                        setContactPersonIds(contacts.map(contact => contact.personId));
                    }
                } catch (error) {
                    console.warn('[fotos.share] Failed to load glue contacts for sharing:', error);
                    if (!cancelled) {
                        setContactPersonIds([]);
                    }
                }
            } else if (!cancelled) {
                setContactPersonIds([]);
            }

            const nextPeers = Array.from(peerOptionsByPersonId.values())
                .sort((left, right) => {
                    if (left.persistent !== right.persistent) {
                        return left.persistent ? -1 : 1;
                    }

                    if (left.online !== right.online) {
                        return left.online ? -1 : 1;
                    }

                    const leftLabel = left.displayName ?? left.personId;
                    const rightLabel = right.displayName ?? right.personId;
                    return leftLabel.localeCompare(rightLabel);
                });

            if (!cancelled) {
                setSharePeerOptions(nextPeers);
            }
        };

        void refreshPeers();
        const intervalId = window.setInterval(() => {
            void refreshPeers();
        }, 5_000);
        return () => {
            cancelled = true;
            window.clearInterval(intervalId);
        };
    }, [
        fotosModel?.contactsPlan,
        fotosModel?.glueModule?.presenceTrieService,
        fotosModel?.ownerId,
        fotosModel?.publicationIdentity,
        ownKnownPersonIds,
    ]);

    useEffect(() => {
        const activeGlueModule = fotosModel?.glueModule as (FotosModel['glueModule'] & {
            setRouteWantedPeerIds?: (personIds: string[]) => void;
            setAcceptedIncomingPeerIds?: (personIds: string[]) => void;
            setOwnPresencePublishingEnabled?: (enabled: boolean) => Promise<void>;
        }) | null;
        if (!activeGlueModule) {
            return;
        }

        activeGlueModule.setRouteWantedPeerIds?.(sharedPersonIds);
        activeGlueModule.setAcceptedIncomingPeerIds?.(acceptedIncomingPeerIds);
        void activeGlueModule.setOwnPresencePublishingEnabled?.(advertiseSharingIdentity);
    }, [
        acceptedIncomingPeerIds,
        advertiseSharingIdentity,
        fotosModel?.glueModule,
        sharedPersonIds,
    ]);

    useEffect(() => {
        const availableHashes = new Set(gallery.folder.entries.map(photo => photo.hash));
        setSelectedPhotoHashes(currentHashes => (
            currentHashes.filter(hash => availableHashes.has(hash))
        ));
    }, [gallery.folder.entries]);

    useEffect(() => {
        const availableClusterIds = new Set(gallery.allClusters.map(cluster => cluster.clusterId));
        setSelectedClusterIds(currentIds => (
            currentIds.filter(clusterId => availableClusterIds.has(clusterId))
        ));
    }, [gallery.allClusters]);

    const toggleSelectedPhotoHash = useCallback((photoHash: string) => {
        setSelectedPhotoHashes(currentHashes => (
            currentHashes.includes(photoHash)
                ? currentHashes.filter(hash => hash !== photoHash)
                : [...currentHashes, photoHash]
        ));
    }, []);

    const toggleSelectedClusterId = useCallback((clusterId: string) => {
        setSelectedClusterIds(currentIds => (
            currentIds.includes(clusterId)
                ? currentIds.filter(id => id !== clusterId)
                : [...currentIds, clusterId]
        ));
    }, []);

    const clearCollectionSelection = useCallback(() => {
        setSelectedPhotoHashes([]);
        setSelectedClusterIds([]);
    }, []);

    const selectAllVisiblePhotos = useCallback(() => {
        setSelectedPhotoHashes(currentHashes => {
            const nextHashes = new Set(currentHashes);
            for (const photo of visiblePhotos) {
                nextHashes.add(photo.hash);
            }
            return [...nextHashes];
        });
    }, [visiblePhotos]);

    const handleGalleryModeChange = useCallback((mode: 'images' | 'clusters') => {
        if (mode === 'clusters') {
            gallery.setActiveCollectionId(null);
        }
        gallery.setGalleryMode(mode);
    }, [gallery]);

    const handleCollectionSelect = useCallback((collectionId: string | null) => {
        gallery.setGalleryMode('images');
        gallery.setActiveClusterId(null);
        gallery.setActiveCollectionId(collectionId);
    }, [gallery]);

    const handleClusterSelect = useCallback((clusterId: string | null) => {
        if (clusterId) {
            gallery.setActiveCollectionId(null);
            gallery.setGalleryMode('clusters');
        }
        gallery.setActiveClusterId(clusterId);
    }, [gallery]);

    const handleCreateCollection = useCallback((name: string) => {
        if (selectedPhotosForCollections.length === 0 && selectedClustersForCollections.length === 0) {
            return false;
        }

        const nextCollection = fotosCollections.createCollection(
            name,
            selectedPhotosForCollections,
            selectedClustersForCollections,
        );
        clearCollectionSelection();
        setClusterSelectionEnabled(false);
        handleCollectionSelect(nextCollection.id);
        return true;
    }, [
        clearCollectionSelection,
        fotosCollections,
        handleCollectionSelect,
        selectedClustersForCollections,
        selectedPhotosForCollections,
    ]);

    const expandSharePersonIds = useCallback((personIds: readonly string[]) => (
        Array.from(new Set(personIds.flatMap(personId =>
            resolveShareGrantPersonIds(personId, sharePeerOptions)
        )))
    ), [sharePeerOptions]);

    const commitShareAssignment = useCallback(async (params: {
        scope: FotosShareScope;
        previousPersonIds: readonly string[];
        nextPersonIds: readonly string[];
        contentHashes: readonly string[];
        persist: () => void;
    }) => {
        const issuer = fotosModel?.publicationIdentity;
        if (!issuer) {
            throw new Error('Prepare your fotos identity before changing sharing.');
        }
        if (params.contentHashes.length === 0) {
            throw new Error('This scope has no photos to share.');
        }

        await gallery.folder.ensureSyncedToOneCore();
        const snapshot = await fotosShareController.refreshManifest();
        const entryHashByContentHash = new Map(
            (snapshot?.resolvedEntries ?? []).map(entry => [entry.contentHash, entry.entryHash]),
        );
        const missingHashes = params.contentHashes.filter(hash => !entryHashByContentHash.has(hash));
        if (missingHashes.length > 0) {
            throw new Error(`${missingHashes.length} photo${missingHashes.length === 1 ? '' : 's'} could not be prepared for sharing.`);
        }

        const result = await commitFotosShareScope({
            issuer: issuer as any,
            scope: params.scope,
            previousPersonIds: expandSharePersonIds(params.previousPersonIds),
            nextPersonIds: expandSharePersonIds(params.nextPersonIds),
            entryHashes: params.contentHashes.map(hash => entryHashByContentHash.get(hash) as any),
        });
        certificateBackfilledScopesRef.current.add(`${params.scope.kind}:${params.scope.id}`);
        params.persist();
        for (const transition of result.transitions) {
            if (transition.status === 'active') fotosShareController.recordGrant(transition.personId);
        }
    }, [expandSharePersonIds, fotosModel?.publicationIdentity, gallery.folder.ensureSyncedToOneCore]);

    const requestShareAssignment = useCallback((params: {
        scope: FotosShareScope;
        scopeLabel: string;
        previousPersonIds: readonly string[];
        nextPersonIds: readonly string[];
        contentHashes: readonly string[];
        persist: () => void;
    }) => {
        const previousSet = new Set(params.previousPersonIds);
        const nextSet = new Set(params.nextPersonIds);
        const added = params.nextPersonIds.filter(personId => !previousSet.has(personId));
        const removed = params.previousPersonIds.filter(personId => !nextSet.has(personId));
        if (added.length === 0 && removed.length === 0) return;
        const peerLabel = (personId: string) => {
            const peer = sharePeerOptions.find(option => option.personId === personId);
            return peer?.displayName?.trim() || peer?.glueIdentity?.trim() || `${personId.slice(0, 10)}…`;
        };
        const changes = [
            added.length > 0 ? `Share with ${added.map(peerLabel).join(', ')}.` : null,
            removed.length > 0
                ? `Stop sharing with ${removed.map(peerLabel).join(', ')}. They will no longer receive new photos or updates. Photos already stored on their device are not deleted.`
                : null,
        ].filter(Boolean).join(' ');
        showConfirm({
            title: `Review ${params.scopeLabel} sharing`,
            message: `${params.contentHashes.length} photo${params.contentHashes.length === 1 ? '' : 's'} in scope. ${changes}`,
            confirmLabel: 'Apply sharing',
            isDestructive: removed.length > 0,
            onConfirm: () => commitShareAssignment(params),
        });
    }, [commitShareAssignment, sharePeerOptions, showConfirm]);

    const handleGalleryShareChange = useCallback(async (nextPersonIds: string[]) => {
        const previousIds = fotosCollections.sharing.galleryPersonIds;
        requestShareAssignment({
            scope: {kind: 'gallery', id: 'main'},
            scopeLabel: 'gallery',
            previousPersonIds: previousIds,
            nextPersonIds,
            contentHashes: gallery.folder.entries.map(photo => photo.hash),
            persist: () => fotosCollections.setGallerySharePersonIds(nextPersonIds),
        });
    }, [fotosCollections, gallery.folder.entries, requestShareAssignment]);

    const handleCollectionShareChange = useCallback(async (collectionId: string, nextPersonIds: string[]) => {
        const previousIds = fotosCollections.sharing.collectionPersonIds[collectionId] ?? [];
        const collection = collectionSummaries.find(candidate => candidate.id === collectionId);
        requestShareAssignment({
            scope: {kind: 'collection', id: collectionId},
            scopeLabel: collection?.name ?? 'collection',
            previousPersonIds: previousIds,
            nextPersonIds,
            contentHashes: collection?.matchedPhotoHashes ?? [],
            persist: () => fotosCollections.setCollectionSharePersonIds(collectionId, nextPersonIds),
        });
    }, [collectionSummaries, fotosCollections, requestShareAssignment]);

    const handleClusterShareChange = useCallback(async (clusterId: string, nextPersonIds: string[]) => {
        const previousIds = fotosCollections.sharing.clusterPersonIds[clusterId] ?? [];
        const cluster = gallery.allClusters.find(candidate => candidate.clusterId === clusterId);
        const memberIds = new Set(cluster?.memberClusterIds ?? [clusterId]);
        const contentHashes = gallery.folder.entries
            .filter(photo => (
                photo.faces?.clusterIds?.some(memberId => memberIds.has(memberId))
                || (cluster?.personId && photo.faces?.personIds?.includes(cluster.personId))
            ))
            .map(photo => photo.hash);
        requestShareAssignment({
            scope: {kind: 'person', id: clusterId},
            scopeLabel: cluster?.label ?? 'person',
            previousPersonIds: previousIds,
            nextPersonIds,
            contentHashes,
            persist: () => fotosCollections.setClusterSharePersonIds(clusterId, nextPersonIds),
        });
    }, [fotosCollections, gallery.allClusters, gallery.folder.entries, requestShareAssignment]);

    useEffect(() => {
        const pairing = fotosModel?.connectionsModel?.pairing;
        if (!pairing) {
            return;
        }

        const disconnect = pairing.onPairingSuccess(async (
            _initiatedLocally,
            _localPersonId,
            _localInstanceId,
            remotePersonId,
            _remoteInstanceId,
            token,
        ) => {
            if (!token || !pendingGalleryInviteTokensRef.current.has(token)) {
                return;
            }

            const normalizedRemotePersonId = String(remotePersonId);
            pendingGalleryInviteTokensRef.current.delete(token);
            const previousIds = fotosCollections.sharing.galleryPersonIds;
            const nextPersonIds = previousIds.includes(normalizedRemotePersonId)
                ? previousIds
                : [...previousIds, normalizedRemotePersonId];
            await commitShareAssignment({
                scope: {kind: 'gallery', id: 'main'},
                previousPersonIds: previousIds,
                nextPersonIds,
                contentHashes: gallery.folder.entries.map(photo => photo.hash),
                persist: () => fotosCollections.setGallerySharePersonIds(nextPersonIds),
            });
            (fotosModel.glueModule as { requestPeerConnection?: (targetPersonId: string) => boolean } | null)
                ?.requestPeerConnection?.(normalizedRemotePersonId);
        });

        return () => {
            disconnect();
        };
    }, [
        fotosCollections,
        fotosModel?.connectionsModel?.pairing,
        fotosModel?.glueModule,
        commitShareAssignment,
        gallery.folder.entries,
    ]);

    const createGalleryShareInvite = useCallback(async (): Promise<CreatedGalleryShareInvite> => {
        if (!fotosModel?.connectionsModel?.pairing || !fotosModel.publicationIdentity) {
            throw new Error('Enable sync and prepare your fotos identity before creating a share link.');
        }
        if (!gallery.folder.isOpen || gallery.folder.entries.length === 0) {
            throw new Error('Open a gallery with photos before creating a share link.');
        }

        await gallery.folder.ensureSyncedToOneCore();
        const manifestSnapshot = await fotosShareController.refreshManifest();
        const sharedCount = manifestSnapshot?.entryCount ?? 0;
        if (sharedCount === 0) {
            throw new Error('No photos are ready to share yet.');
        }

        const pairingInvitation = await fotosModel.connectionsModel.pairing.createInvitation(
            fotosModel.publicationIdentity,
            undefined,
            { mode: 'primed' },
        );
        const shareBaseUrl = new URL(window.location.href);
        shareBaseUrl.searchParams.delete('fotosShare');
        shareBaseUrl.searchParams.delete('fotosAccount');
        shareBaseUrl.searchParams.delete('fotosAcceptAsNew');
        shareBaseUrl.searchParams.delete('one_token');
        shareBaseUrl.hash = '';
        const invite = await createFotosShareInvite({
            baseUrl: shareBaseUrl.toString(),
            pairingInvitation,
            senderPersonId: String(fotosModel.publicationIdentity),
            galleryName: gallery.folder.folderName,
            openInNewAccount: true,
        });
        pendingGalleryInviteTokensRef.current.add(pairingInvitation.token);
        const galleryInvite = {
            ...invite,
            sharedCount,
        };
        setCreatedShareInvite(galleryInvite);
        return galleryInvite;
    }, [
        fotosModel?.connectionsModel?.pairing,
        fotosModel?.publicationIdentity,
        gallery.folder.entries.length,
        gallery.folder.folderName,
        gallery.folder.isOpen,
        gallery.folder.ensureSyncedToOneCore,
    ]);

    const handleCreateGalleryShareInvite = useCallback(async () => {
        setCreatingShareInvite(true);
        try {
            await createGalleryShareInvite();
        } catch (error) {
            console.warn('[fotos.share] Failed to create gallery invite:', error);
        } finally {
            setCreatingShareInvite(false);
        }
    }, [createGalleryShareInvite]);

    const acceptIncomingGalleryShareInvite = useCallback(async (
        options: { requireDestination?: boolean } = {},
    ) => {
        if (!incomingShareInvite) {
            throw new Error('No fotos share invite is pending.');
        }

        if (
            Number.isNaN(Date.parse(incomingShareInvite.expiresAt))
            || Date.now() > Date.parse(incomingShareInvite.expiresAt)
        ) {
            throw new Error('This share link has expired.');
        }

        if (options.requireDestination ?? true) {
            setIncomingShareStatus('choosing-folder');
            const destinationReady = await gallery.folder.chooseSharedGalleryDestination();
            if (!destinationReady) {
                setIncomingShareStatus('idle');
                throw new Error('Choose a folder to store the shared gallery.');
            }
        }

        if (!fotosModel?.initialized) {
            throw new Error('fotos is still opening the share.');
        }

        if (!fotosModel.connectionsModel?.pairing) {
            setIncomingShareStatus('preparing');
            const guestSuffix = typeof crypto?.randomUUID === 'function'
                ? crypto.randomUUID().slice(0, 8)
                : Math.random().toString(16).slice(2, 10);
            await ensureConfiguredGlueIdentity(
                fotosModel.settingsPlan,
                fotosModel.leuteModel,
                `Fotos Guest ${guestSuffix}`,
                fotosModel.ownerId,
            );
            await fotosModel.settingsPlan.updateSection({
                moduleId: 'glue',
                values: { syncEnabled: true },
            });
            window.location.reload();
            return {
                accepted: true as const,
                senderPersonId: incomingShareInvite.senderPersonId,
            };
        }

        const localPersonId = fotosModel.publicationIdentity ?? fotosModel.ownerId;
        if (!localPersonId) {
            throw new Error('No local fotos identity is available for accepting the share.');
        }

        setIncomingShareStatus('connecting');
        await fotosModel.connectionsModel.pairing.connectUsingInvitation(
            incomingShareInvite.pairingInvitation,
            localPersonId,
            { mode: 'primed' },
        );
        (fotosModel.glueModule as { requestPeerConnection?: (targetPersonId: string) => boolean } | null)
            ?.requestPeerConnection?.(incomingShareInvite.senderPersonId);
        setIncomingShareStatus('accepted');
        return {
            accepted: true as const,
            senderPersonId: incomingShareInvite.senderPersonId,
        };
    }, [
        fotosModel?.connectionsModel?.pairing,
        fotosModel?.initialized,
        fotosModel?.leuteModel,
        fotosModel?.ownerId,
        fotosModel?.publicationIdentity,
        fotosModel?.settingsPlan,
        gallery.folder,
        incomingShareInvite,
    ]);

    const handleAcceptIncomingGalleryShareInvite = useCallback(async () => {
        setIncomingShareError(null);
        try {
            await acceptIncomingGalleryShareInvite({ requireDestination: true });
        } catch (error) {
            setIncomingShareStatus('error');
            setIncomingShareError(error instanceof Error ? error.message : String(error));
        }
    }, [acceptIncomingGalleryShareInvite]);

    const mobile = gallery.folder.mobile;
    const intakePlan = gallery.folder.defaultIntakePlan;
    const pendingImportCount = gallery.folder.pendingImportCount;
    const canClaimAuthorshipOnIngest = gallery.folder.canClaimAuthorshipOnIngest;
    const claimAuthorshipOnIngest = gallery.folder.claimAuthorshipOnIngest;
    const primaryIntakeActionLabel = pendingImportCount > 0
        ? `Choose folder for ${pendingImportCount} shared photo${pendingImportCount === 1 ? '' : 's'}`
        : intakePlan.actionLabel;
    const primaryIntakeSummary = pendingImportCount > 0
        ? 'Shared photos are waiting for a destination folder. Choose where to store them and fotos will ingest them into the local library.'
        : intakePlan.summary;
    const canRunFaceAnalytics = settings.analysis.faceAnalyticsEnabled
        && intakePlan.faceEnrichment === 'local';
    const canReanalyze = canRunFaceAnalytics || settings.analysis.semanticSearchEnabled;

    useEffect(() => {
        const handlePopState = () => {
            setRouteLocation(getCurrentRouteLocation());
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    useEffect(() => {
        const nextLocation = getCurrentRouteLocation();
        setRouteLocation((current) => (
            areRouteLocationsEqual(current, nextLocation) ? current : nextLocation
        ));
    });

    const photoRouteTarget = useMemo(
        () => parsePersistentPhotoRouteTarget(routeLocation.search),
        [routeLocation.search],
    );
    const buildPhotoRoutePath = useCallback(
        (photoHash?: string | null) => buildPersistentPhotoPath(
            routeLocation.pathname,
            routeLocation.search,
            photoHash ? { photoHash } : null,
        ),
        [routeLocation.pathname, routeLocation.search],
    );
    const navigatePhotoRoute = useCallback((photoHash?: string | null, options?: { replace?: boolean }) => {
        const nextPath = buildPhotoRoutePath(photoHash);
        const nextUrl = new URL(window.location.href);
        const [nextPathname, nextSearch = ''] = nextPath.split('?');
        nextUrl.pathname = nextPathname;
        nextUrl.search = nextSearch ? `?${nextSearch}` : '';

        const currentRoute = `${routeLocation.pathname}${routeLocation.search}${routeLocation.hash}`;
        const nextRoute = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
        if (currentRoute === nextRoute) {
            return;
        }

        const historyMethod = options?.replace ? 'replaceState' : 'pushState';
        window.history[historyMethod]({}, '', nextUrl.toString());
        setRouteLocation({
            pathname: nextUrl.pathname,
            search: nextUrl.search,
            hash: nextUrl.hash,
        });
    }, [buildPhotoRoutePath, routeLocation.hash, routeLocation.pathname, routeLocation.search]);
    const openPhotoRoute = useCallback((photoHash: string, options?: { replace?: boolean }) => {
        const nextIndex = visiblePhotos.findIndex((photo) => photo.hash === photoHash);
        if (nextIndex >= 0) {
            gallery.setSelectedIndex(nextIndex);
        }
        navigatePhotoRoute(photoHash, options);
    }, [gallery, navigatePhotoRoute, visiblePhotos]);
    const openPhotoRouteIndex = useCallback((index: number, options?: { replace?: boolean }) => {
        const photo = visiblePhotos[index];
        if (!photo) {
            return;
        }
        openPhotoRoute(photo.hash, options);
    }, [openPhotoRoute, visiblePhotos]);
    const closePhotoRoute = useCallback((options?: { replace?: boolean }) => {
        gallery.setSelectedIndex(null);
        navigatePhotoRoute(null, options);
    }, [gallery, navigatePhotoRoute]);

    const handleDelete = useCallback((hash: string) => {
        const targetPhoto = gallery.folder.entries.find(photo => photo.hash === hash)
            ?? visiblePhotos.find(photo => photo.hash === hash)
            ?? null;
        const isRemotePhoto = targetPhoto?.sourcePath?.startsWith('remote:') === true
            || targetPhoto?.thumb?.startsWith('remote:') === true;
        const photoName = targetPhoto?.name ?? 'this photo';
        const deleteMessage = isRemotePhoto || !targetPhoto?.sourcePath
            ? `Remove “${photoName}” from this fotos library? The sender's original is not deleted. This cannot be undone on this device.`
            : `Delete “${photoName}” from its folder and remove it from fotos? This deletes the original file on disk and cannot be undone.`;
        showConfirm({
            title: 'Delete photo',
            message: deleteMessage,
            confirmLabel: 'Delete photo',
            isDestructive: true,
            onConfirm: () => {
                if (photoRouteTarget?.photoHash === hash) {
                    const currentIndex = gallery.selectedIndex;
                    const fallbackPhoto = currentIndex !== null
                        ? visiblePhotos[currentIndex + 1] ?? visiblePhotos[currentIndex - 1] ?? null
                        : null;

                    if (fallbackPhoto) {
                        openPhotoRoute(fallbackPhoto.hash, { replace: true });
                    } else {
                        closePhotoRoute({ replace: true });
                    }
                }

                gallery.deletePhoto(hash);
                if (!photoRouteTarget?.photoHash && gallery.selectedIndex !== null) {
                    const remaining = visiblePhotos.length - 1;
                    if (remaining <= 0) {
                        gallery.setSelectedIndex(null);
                    } else if (gallery.selectedIndex >= remaining) {
                        gallery.setSelectedIndex(remaining - 1);
                    }
                }
            },
        });
    }, [
        closePhotoRoute,
        gallery,
        openPhotoRoute,
        photoRouteTarget?.photoHash,
        showConfirm,
        visiblePhotos,
        visiblePhotos.length,
    ]);

    const handleFaceSearch = useCallback((embedding: Float32Array) => {
        closePhotoRoute({ replace: true });
        gallery.setGalleryMode('images');
        gallery.setActiveClusterId(null);
        gallery.setSearchFace(embedding);
    }, [closePhotoRoute, gallery]);

    const exportPhotosToNativeShare = useCallback(async (photos: readonly PhotoEntry[]) => {
        const exportablePhotos = photos.filter((photo): photo is PhotoEntry & { sourcePath: string } => Boolean(photo.sourcePath));
        if (exportablePhotos.length === 0) {
            return false;
        }

        setExportingPhotos(true);
        try {
            const files = await Promise.all(
                exportablePhotos.map(photo => gallery.folder.readFile(photo.sourcePath)),
            );
            return await shareFiles(files);
        } finally {
            setExportingPhotos(false);
        }
    }, [gallery.folder]);

    const handleExportSelectedPhotos = useCallback(async () => {
        await exportPhotosToNativeShare(selectedPhotosForCollections);
    }, [exportPhotosToNativeShare, selectedPhotosForCollections]);

    const handleExportPhoto = useCallback(async (photo: PhotoEntry) => {
        await exportPhotosToNativeShare([photo]);
    }, [exportPhotosToNativeShare]);

    const handleSharePhoto = useCallback(async (photo: PhotoEntry) => {
        if (!photo.sourcePath) return;
        try {
            const file = await gallery.folder.readFile(photo.sourcePath);
            await shareFile(file);
        } catch (err) {
            console.error('Error sharing photo:', err);
        }
    }, [gallery]);

    // On mobile, tap a photo → open lightbox (same as desktop)
    const handlePhotoClick = useCallback((index: number) => {
        traceHang('photo-click', {
            index,
            hash: visiblePhotos[index]?.hash,
            mobile,
        });
        openPhotoRouteIndex(index);
    }, [mobile, openPhotoRouteIndex, visiblePhotos]);

    const progress = gallery.folder.ingestProgress;
    const totalDetectedFaces = gallery.folder.entries.reduce(
        (count, photo) => count + getFaceCount(photo.faces),
        0,
    );
    const analysisProgress = progress
        && (
            progress.phase === 'faces'
            || progress.phase === 'preparing-faces'
            || progress.phase === 'semantic'
            || progress.phase === 'preparing-semantic'
        )
        ? progress
        : null;
    const breadcrumbItems = useMemo(() => {
        const items: Array<{ key: string; label: string; onClick?: () => void }> = [];

        if (gallery.galleryMode === 'clusters') {
            items.push({
                key: 'mode',
                label: 'Faces',
                onClick: gallery.activeClusterId !== null || trimmedSearchQuery.length > 0
                    ? () => {
                        gallery.setActiveClusterId(null);
                        gallery.setSearchQuery('');
                    }
                    : undefined,
            });

            if (trimmedSearchQuery.length > 0) {
                items.push({
                    key: 'query',
                    label: `Search: ${trimmedSearchQuery}`,
                    onClick: gallery.activeClusterId !== null
                        ? () => {
                            gallery.setActiveClusterId(null);
                        }
                        : undefined,
                });
            }

            if (gallery.activeCluster) {
                items.push({
                    key: 'cluster',
                    label: gallery.activeCluster.label,
                });
            }
        } else {
            if (!hasGalleryDetail) {
                return items;
            }

            items.push({
                key: 'mode',
                label: 'Photos',
                onClick: gallery.activeCollectionId !== null || gallery.activeTag !== null || trimmedSearchQuery.length > 0 || gallery.searchFace !== null
                    ? () => {
                        gallery.setActiveCollectionId(null);
                        gallery.setActiveTag(null);
                        gallery.setSearchQuery('');
                        gallery.setSearchFace(null);
                    }
                    : undefined,
            });

            if (gallery.activeCollection) {
                items.push({
                    key: 'collection',
                    label: gallery.activeCollection.name,
                    onClick: trimmedSearchQuery.length > 0 || gallery.searchFace !== null
                        ? () => {
                            gallery.setSearchQuery('');
                            gallery.setSearchFace(null);
                        }
                        : undefined,
                });
            }

            if (gallery.activeTag !== null) {
                items.push({
                    key: 'tag',
                    label: gallery.activeTag,
                    onClick: trimmedSearchQuery.length > 0 || gallery.searchFace !== null
                        ? () => {
                            gallery.setSearchQuery('');
                            gallery.setSearchFace(null);
                        }
                        : undefined,
                });
            }

            if (trimmedSearchQuery.length > 0) {
                items.push({
                    key: 'query',
                    label: `Search: ${trimmedSearchQuery}`,
                    onClick: gallery.searchFace !== null
                        ? () => {
                            gallery.setSearchFace(null);
                        }
                        : undefined,
                });
            }

            if (gallery.searchFace !== null) {
                items.push({
                    key: 'face-search',
                    label: 'Similar faces',
                });
            }
        }

        return items;
    }, [
        gallery.activeCluster,
        gallery.activeClusterId,
        gallery.activeCollection,
        gallery.activeCollectionId,
        gallery.activeTag,
        gallery.folder.folderName,
        gallery.galleryMode,
        gallery.searchFace,
        gallery.setActiveCollectionId,
        gallery.setActiveClusterId,
        gallery.setActiveTag,
        gallery.setGalleryMode,
        gallery.setSearchFace,
        gallery.setSearchQuery,
        trimmedSearchQuery.length,
        trimmedSearchQuery,
        hasGalleryDetail,
    ]);
    const breadcrumbSummary = useMemo(() => {
        if (showClusterGallery) {
            return `${gallery.clusters.length} clusters`;
        }
        if (gallery.galleryMode === 'clusters' && gallery.activeCluster) {
            return `${gallery.clusterPhotos.length} photos`;
        }
        if (gallery.searchFace !== null) {
            return `${visiblePhotos.length} matches`;
        }
        return `${visiblePhotos.length} photos`;
    }, [
        gallery.activeCluster,
        gallery.clusterPhotos.length,
        gallery.clusters.length,
        gallery.galleryMode,
        gallery.searchFace,
        showClusterGallery,
        visiblePhotos.length,
    ]);
    const historySnapshot = useMemo<FotosBreadcrumbSnapshot | null>(() => {
        if (!gallery.folder.isOpen) {
            return null;
        }

        return {
            version: 1,
            ...(gallery.folder.folderName ? { folderName: gallery.folder.folderName } : {}),
            galleryMode: gallery.galleryMode,
            ...(gallery.activeCollectionId ? { activeCollectionId: gallery.activeCollectionId } : {}),
            ...(gallery.activeTag ? { activeTag: gallery.activeTag } : {}),
            ...(gallery.activeClusterId ? { activeClusterId: gallery.activeClusterId } : {}),
            ...(trimmedSearchQuery.length > 0 ? { searchQuery: trimmedSearchQuery } : {}),
            ...(gallery.searchFace ? { searchFace: Array.from(gallery.searchFace) } : {}),
        };
    }, [
        gallery.activeCollectionId,
        gallery.activeClusterId,
        gallery.activeTag,
        gallery.folder.folderName,
        gallery.folder.isOpen,
        gallery.galleryMode,
        gallery.searchFace,
        trimmedSearchQuery,
    ]);
    const historyBreadcrumbs = useMemo(
        () => breadcrumbItems.map(item => item.label),
        [breadcrumbItems],
    );
    const showBreadcrumbs = breadcrumbItems.length > 0;
    const breadcrumbHistory = useBreadcrumbHistory({
        model: fotosModel,
        snapshot: historySnapshot,
        breadcrumbs: historyBreadcrumbs,
    });
    const handleDeleteHistoryEntry = useCallback((eventId: string) => {
        showConfirm({
            title: 'Delete saved history entry',
            message: 'Delete this saved place from breadcrumb history? Photos, folders, and collections are not deleted.',
            confirmLabel: 'Delete history entry',
            isDestructive: true,
            onConfirm: () => breadcrumbHistory.deleteEntry(eventId),
        });
    }, [breadcrumbHistory.deleteEntry, showConfirm]);

    useEffect(() => {
        const restoreEntry = breadcrumbHistory.restoreEntry;
        if (!restoreEntry || !gallery.folder.isOpen) {
            return;
        }

        const currentFolderName = gallery.folder.folderName ?? '';
        const targetFolderName = restoreEntry.folderName ?? restoreEntry.state.folderName ?? '';
        if (targetFolderName !== currentFolderName) {
            return;
        }

        const targetState = restoreEntry.state;
        const currentSnapshot = historySnapshot;
        if (currentSnapshot && isSnapshotEqual(currentSnapshot, targetState)) {
            return;
        }

        closePhotoRoute({ replace: true });
        gallery.setGalleryMode(targetState.galleryMode);
        gallery.setActiveCollectionId(targetState.activeCollectionId ?? null);
        gallery.setActiveTag(targetState.activeTag ?? null);
        gallery.setActiveClusterId(targetState.activeClusterId ?? null);
        gallery.setSearchQuery(targetState.searchQuery ?? '');
        gallery.setSearchFace(targetState.searchFace?.length
            ? new Float32Array(targetState.searchFace)
            : null);
    }, [
        breadcrumbHistory.restoreEntry,
        gallery.folder.isOpen,
        gallery.folder.folderName,
        gallery.setActiveCollectionId,
        gallery.setActiveClusterId,
        gallery.setActiveTag,
        gallery.setGalleryMode,
        gallery.setSearchFace,
        gallery.setSearchQuery,
        gallery.setSelectedIndex,
        historySnapshot,
        closePhotoRoute,
    ]);

    useEffect(() => {
        if (!gallery.folder.isOpen) {
            if (gallery.selectedIndex !== null) {
                gallery.setSelectedIndex(null);
            }
            return;
        }

        const nextPhotoHash = photoRouteTarget?.photoHash ?? null;
        if (!nextPhotoHash) {
            gallery.setSelectedIndex((current) => current === null ? current : null);
            return;
        }

        const nextIndex = visiblePhotos.findIndex((photo) => photo.hash === nextPhotoHash);
        if (nextIndex === -1) {
            gallery.setSelectedIndex((current) => current === null ? current : null);
            return;
        }

        gallery.setSelectedIndex((current) => current === nextIndex ? current : nextIndex);
    }, [
        gallery.folder.isOpen,
        gallery.selectedIndex,
        gallery.setSelectedIndex,
        photoRouteTarget?.photoHash,
        visiblePhotos,
    ]);

    useEffect(() => {
        traceHang('app-state', {
            isOpen: gallery.folder.isOpen,
            photoCount: visiblePhotos.length,
            selectedIndex: gallery.selectedIndex,
            analysisProgress: analysisProgress
                ? {
                    current: analysisProgress.current,
                    total: analysisProgress.total,
                    fileName: analysisProgress.fileName,
                    statusLabel: analysisProgress.statusLabel,
                }
                : null,
        });
    }, [
        gallery.folder.isOpen,
        visiblePhotos.length,
        gallery.selectedIndex,
        analysisProgress?.current,
        analysisProgress?.total,
        analysisProgress?.fileName,
        analysisProgress?.statusLabel,
    ]);

    const handleOpenSimilarFace = useCallback((match: SimilarFaceMatch) => {
        gallery.setGalleryMode('images');
        gallery.setActiveClusterId(null);
        openPhotoRoute(match.photo.hash);
    }, [gallery, openPhotoRoute]);

    const debugRuntimeRef = useRef({
        model: fotosModel,
        folder: gallery.folder,
        visiblePhotos,
        entries: gallery.folder.entries,
        sharePeerOptions,
    });
    debugRuntimeRef.current = {
        model: fotosModel,
        folder: gallery.folder,
        visiblePhotos,
        entries: gallery.folder.entries,
        sharePeerOptions,
    };

    useEffect(() => {
        if (!fotosModel?.initialized) {
            fotosShareController.reset();
            return;
        }

        void fotosShareController.start();

        return () => {
            fotosShareController.stop();
        };
    }, [fotosModel?.initialized]);

    useEffect(() => {
        if (!fotosModel?.initialized) {
            return;
        }

        return retainFotosManifestConvergence();
    }, [fotosModel?.initialized]);

    useEffect(() => {
        if (!fotosModel?.initialized) {
            setShareManifestHash(null);
            setShareSnapshot(null);
            return;
        }

        const syncManifestHash = () => {
            const snapshot = fotosShareController.getSnapshot();
            setShareManifestHash(snapshot.manifest?.hash ?? null);
            setShareSnapshot(snapshot);
        };

        syncManifestHash();
        return fotosShareController.subscribe(syncManifestHash);
    }, [fotosModel?.initialized]);

    useEffect(() => {
        fotosShareController.updateState({
            isOpen: gallery.folder.isOpen,
            folderName: gallery.folder.folderName,
            entries: gallery.folder.entries,
            visibleHashes: visiblePhotos.map(photo => photo.hash),
        });
    }, [
        gallery.folder.entries,
        gallery.folder.folderName,
        gallery.folder.isOpen,
        visiblePhotos,
    ]);

    useEffect(() => {
        const totalFaceCount = gallery.folder.entries.reduce(
            (count, photo) => count + getFaceCount(photo.faces),
            0,
        );
        const visibleFaceCount = visiblePhotos.reduce(
            (count, photo) => count + getFaceCount(photo.faces),
            0,
        );
        const pendingFaces = gallery.folder.entries.reduce((count, photo) => {
            return count + Math.max(
                0,
                getFaceCount(photo.faces) - (photo.faces?.names?.filter(Boolean).length ?? 0),
            );
        }, 0);
        const selectedPhotoHash = gallery.selectedIndex !== null
            ? visiblePhotos[gallery.selectedIndex]?.hash ?? null
            : null;

        setFotosRuntimeSnapshot({
            isOpen: gallery.folder.isOpen,
            folderName: gallery.folder.folderName,
            entryCount: gallery.folder.entries.length,
            photoCount: visiblePhotos.length,
            visibleHashes: visiblePhotos.map(photo => photo.hash),
            galleryMode: gallery.galleryMode,
            activeClusterId: gallery.activeClusterId,
            activeCollectionId: gallery.activeCollectionId,
            clusterCount: gallery.allClusters.length,
            visibleClusterCount: gallery.galleryMode === 'clusters'
                ? (gallery.searchFace !== null ? gallery.searchClusters.length : gallery.clusters.length)
                : 0,
            collectionCount: collectionSummaries.length,
            searchQuery: gallery.searchQuery,
            totalFaceCount,
            visibleFaceCount,
            selectedPhotoHash,
            topClusters: gallery.allClusters.slice(0, 12).map(cluster => ({
                clusterId: cluster.clusterId,
                label: cluster.label,
                faceCount: cluster.faceCount,
                photoCount: cluster.photoCount,
                ...(cluster.personId ? { personId: cluster.personId } : {}),
                ...(cluster.personName ? { personName: cluster.personName } : {}),
            })),
            collections: collectionSummaries.map(collection => ({
                id: collection.id,
                name: collection.name,
                photoCount: collection.photoCount,
                faceCount: collection.faceCount,
                coverPhotoHash: collection.coverPhotoHash,
            })),
            pendingFaces,
            loading: gallery.loading,
            selectedIndex: gallery.selectedIndex,
            searchFaceActive: gallery.searchFace !== null,
            ingestProgress: gallery.folder.ingestProgress,
        });
    }, [
        collectionSummaries,
        gallery.activeClusterId,
        gallery.activeCollectionId,
        gallery.allClusters,
        gallery.clusters,
        gallery.folder.entries,
        gallery.folder.folderName,
        gallery.folder.ingestProgress,
        gallery.folder.isOpen,
        gallery.galleryMode,
        gallery.loading,
        gallery.searchClusters,
        gallery.searchFace,
        gallery.searchQuery,
        gallery.selectedIndex,
        visiblePhotos,
    ]);

    useEffect(() => {
        const photosByHash = new Map(visiblePhotos.map((photo) => [photo.hash, photo]));

        setFotosRuntimeVisiblePhotos(
            visiblePhotos.map((photo) => ({
                hash: photo.hash,
                name: photo.name,
                sourcePath: photo.sourcePath ?? null,
                mimeType: photo.mimeType ?? null,
                thumb: photo.thumb ?? null,
                size: photo.size,
                managed: photo.managed,
                capturedAt: photo.capturedAt ?? null,
            })),
            async (hash) => {
                const photo = photosByHash.get(hash);
                if (!photo) {
                    throw new Error(`Visible photo ${hash} was not found in the current gallery view.`);
                }
                if (!photo.sourcePath) {
                    throw new Error(`Visible photo ${photo.name} has no readable source path.`);
                }

                const file = await gallery.folder.readFile(photo.sourcePath);
                return {
                    hash: photo.hash,
                    name: file.name || photo.name,
                    mimeType: file.type || photo.mimeType || 'application/octet-stream',
                    size: file.size,
                    dataUrl: await readFileAsDataUrl(file),
                };
            },
        );
    }, [gallery.folder.readFile, visiblePhotos]);

    useEffect(() => {
        const pendingFaces = gallery.folder.entries.reduce((count, photo) => {
            return count + Math.max(
                0,
                getFaceCount(photo.faces) - (photo.faces?.names?.filter(Boolean).length ?? 0),
            );
        }, 0);

        setFotosRuntimeSnapshot({
            isOpen: gallery.folder.isOpen,
            folderName: gallery.folder.folderName,
            entryCount: gallery.folder.entries.length,
            photoCount: visiblePhotos.length,
            visibleHashes: visiblePhotos.map(photo => photo.hash),
            galleryMode: gallery.galleryMode,
            activeClusterId: gallery.activeClusterId,
            activeCollectionId: gallery.activeCollectionId,
            clusterCount: gallery.allClusters.length,
            visibleClusterCount: gallery.galleryMode === 'clusters'
                ? (gallery.searchFace !== null ? gallery.searchClusters.length : gallery.clusters.length)
                : 0,
            collectionCount: collectionSummaries.length,
            searchQuery: gallery.searchQuery,
            pendingFaces,
            loading: gallery.loading,
            selectedIndex: gallery.selectedIndex,
            searchFaceActive: gallery.searchFace !== null,
            ingestProgress: gallery.folder.ingestProgress,
        });
    }, [
        collectionSummaries.length,
        gallery.activeClusterId,
        gallery.activeCollectionId,
        gallery.allClusters.length,
        gallery.folder.entries,
        gallery.folder.folderName,
        gallery.folder.ingestProgress,
        gallery.folder.isOpen,
        gallery.galleryMode,
        gallery.loading,
        gallery.searchFace,
        gallery.searchQuery,
        gallery.selectedIndex,
        gallery.searchClusters.length,
        gallery.clusters.length,
        visiblePhotos,
    ]);

    useEffect(() => {
        if (!fotosModel?.initialized || !shareManifestHash) return;
        let cancelled = false;

        void (async () => {
            const refreshScope = async (params: Parameters<typeof commitShareAssignment>[0]) => {
                if (cancelled || params.nextPersonIds.length === 0 || params.contentHashes.length === 0) return;
                const scopeKey = `${params.scope.kind}:${params.scope.id}`;
                await commitShareAssignment({
                    ...params,
                    previousPersonIds: certificateBackfilledScopesRef.current.has(scopeKey)
                        ? params.previousPersonIds
                        : [],
                });
            };
            await refreshScope({
                scope: {kind: 'gallery', id: 'main'},
                previousPersonIds: fotosCollections.sharing.galleryPersonIds,
                nextPersonIds: fotosCollections.sharing.galleryPersonIds,
                contentHashes: gallery.folder.entries.map(photo => photo.hash),
                persist: () => {},
            });
            for (const collection of collectionSummaries) {
                const personIds = fotosCollections.sharing.collectionPersonIds[collection.id] ?? [];
                await refreshScope({
                    scope: {kind: 'collection', id: collection.id},
                    previousPersonIds: personIds,
                    nextPersonIds: personIds,
                    contentHashes: collection.matchedPhotoHashes,
                    persist: () => {},
                });
            }
            for (const cluster of gallery.allClusters) {
                const personIds = fotosCollections.sharing.clusterPersonIds[cluster.clusterId] ?? [];
                const memberIds = new Set(cluster.memberClusterIds);
                const contentHashes = gallery.folder.entries
                    .filter(photo => (
                        photo.faces?.clusterIds?.some(memberId => memberIds.has(memberId))
                        || (cluster.personId && photo.faces?.personIds?.includes(cluster.personId))
                    ))
                    .map(photo => photo.hash);
                await refreshScope({
                    scope: {kind: 'person', id: cluster.clusterId},
                    previousPersonIds: personIds,
                    nextPersonIds: personIds,
                    contentHashes,
                    persist: () => {},
                });
            }
            if (!cancelled && !legacyFotosAccessRetiredRef.current) {
                await revokeLegacyFotosManifestAccess();
                legacyFotosAccessRetiredRef.current = true;
            }
            if (!cancelled) {
                fotosShareController.replaceGrants(expandSharePersonIds(sharedPersonIds));
            }
        })().catch(error => {
            if (!cancelled) console.warn('[fotos.share] Failed to refresh certificate-backed scope:', error);
        });

        return () => { cancelled = true; };
    }, [
        collectionSummaries,
        commitShareAssignment,
        expandSharePersonIds,
        fotosCollections.sharing,
        fotosModel?.initialized,
        gallery.allClusters,
        gallery.folder.entries,
        shareManifestHash,
        sharedPersonIds,
    ]);

    useEffect(() => {
        if (!shouldExposeFotosDebugApi(import.meta.env.DEV, window.location.search)) {
            return;
        }

        const debugWindow = window as Window & { __fotosDebug?: FotosDebugApi };
        const debugApi: FotosDebugApi = {
            getStatus: () => {
                const { model: activeModel, folder, visiblePhotos: activeVisiblePhotos, entries: activeEntries } = debugRuntimeRef.current;
                return {
                    initialized: Boolean(activeModel?.initialized),
                    ownerId: activeModel?.ownerId ? String(activeModel.ownerId) : null,
                    publicationIdentity: activeModel?.publicationIdentity ? String(activeModel.publicationIdentity) : null,
                    headlessConnected: Boolean(activeModel?.headlessConnected),
                    isOpen: folder.isOpen,
                    folderName: folder.folderName,
                    entryCount: activeEntries.length,
                    visiblePhotoCount: activeVisiblePhotos.length,
                };
            },
            getLocalIdentitySnapshot: async () => await getLocalIdentitySnapshot(debugRuntimeRef.current.model),
            prepareIdentity: async (displayName: string) => {
                const activeModel = debugRuntimeRef.current.model;
                if (!activeModel?.settingsPlan) {
                    throw new Error('fotos.one model is not initialized');
                }

                const snapshot = await getLocalIdentitySnapshot(activeModel);
                const result = await ensureConfiguredGlueIdentity(
                    activeModel.settingsPlan,
                    activeModel.leuteModel,
                    displayName,
                    activeModel.ownerId,
                );

                if (!snapshot.syncEnabled) {
                    await activeModel.settingsPlan.updateSection({
                        moduleId: 'glue',
                        values: { syncEnabled: true },
                    });
                }

                const reloadRequired = !snapshot.syncEnabled || snapshot.publicationIdentity !== result.personId;
                return {
                    personId: String(result.personId),
                    created: result.created,
                    syncEnabled: true,
                    reloadRequired,
                };
            },
            registerPreparedIdentity: async (displayName?: string) => {
                const activeModel = debugRuntimeRef.current.model;
                if (!activeModel?.settingsPlan) {
                    throw new Error('fotos.one model is not initialized');
                }

                const snapshot = await getLocalIdentitySnapshot(activeModel);
                const trimmedDisplayName = displayName?.trim() ?? snapshot.glueDisplayName?.trim() ?? '';
                if (!trimmedDisplayName) {
                    throw new Error('Prepare the identity with a display name before registering it.');
                }

                if (!snapshot.syncEnabled) {
                    throw new Error('Prepare the identity and reload with sync enabled before registering it.');
                }

                if (!snapshot.publicationIdentity) {
                    throw new Error('No prepared publication identity is available for registration.');
                }

                const {
                    debugRegisterNameOnServer,
                    nameToIdentity,
                    registerNameOnServer,
                } = await import('@glueone/glue.core');
                const result = DEBUG_REGISTRATION_TOKEN
                    ? await debugRegisterNameOnServer(
                        snapshot.publicationIdentity as any,
                        trimmedDisplayName,
                        {
                            token: DEBUG_REGISTRATION_TOKEN,
                            ttlMs: DEBUG_REGISTRATION_TTL_MS,
                        },
                    )
                    : await registerNameOnServer(
                        snapshot.publicationIdentity as any,
                        trimmedDisplayName,
                        'user',
                    );
                if (!result.success) {
                    throw new Error(result.error || `Failed to register ${nameToIdentity(trimmedDisplayName)}`);
                }

                await publishLocalGlueProfileCredential(activeModel.settingsPlan);

                const connectionModule = activeModel.connectionModule as {
                    connectToGlueServer?: (localPersonId?: string) => Promise<void>;
                } | null | undefined;
                if (typeof connectionModule?.connectToGlueServer === 'function') {
                    try {
                        await connectionModule.connectToGlueServer(snapshot.publicationIdentity);
                    } catch (error) {
                        const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
                        if (
                            !message.includes('duplicate connection')
                            && !message.includes('already connected')
                        ) {
                            throw error;
                        }
                    }
                }

                return {
                    personId: snapshot.publicationIdentity,
                    identity: nameToIdentity(trimmedDisplayName),
                    cert: (result.data?.cert as Record<string, unknown> | undefined) ?? null,
                };
            },
            getPresenceSnapshot: async () => {
                const activeModel = debugRuntimeRef.current.model;
                if (!activeModel?.glueModule?.presenceTrieService) {
                    return null;
                }

                return await activeModel.glueModule.presenceTrieService.getDebugSnapshot(24);
            },
            getOnlinePeers: () => {
                const activeModel = debugRuntimeRef.current.model;
                const presenceService = activeModel?.glueModule?.presenceTrieService;
                if (!presenceService) {
                    return [];
                }

                return presenceService.getOnlinePeerIds().map(personId => ({
                    personId,
                    displayName: presenceService.getDisplayName(personId) ?? null,
                    hasVerifiedIdentity: presenceService.hasVerifiedIdentity(personId) ?? false,
                    transportCapabilities: presenceService.getTransportCapabilities(personId) ?? [],
                }));
            },
            getSharePeerOptions: () => (
                debugRuntimeRef.current.sharePeerOptions.map(peer => ({
                    personId: peer.personId,
                    displayName: peer.displayName,
                    glueIdentity: peer.glueIdentity ?? null,
                    online: peer.online,
                    hasVerifiedIdentity: peer.hasVerifiedIdentity,
                    persistent: peer.persistent === true,
                }))
            ),
            resolveShareToken: async (token: string) => {
                const personId = await resolveTokenToPersonId(token, debugRuntimeRef.current.sharePeerOptions);
                const match = personId
                    ? debugRuntimeRef.current.sharePeerOptions.find(peer => peer.personId === personId) ?? null
                    : null;

                return {
                    personId,
                    persistent: match?.persistent === true,
                    displayName: match?.displayName ?? null,
                    glueIdentity: match?.glueIdentity ?? null,
                };
            },
            getWantedPeerIds: () => {
                const activeGlueModule = debugRuntimeRef.current.model?.glueModule as {
                    getWantedPeerIds?: () => string[];
                } | null | undefined;
                return activeGlueModule?.getWantedPeerIds?.() ?? [];
            },
            getConnectablePeerIds: () => {
                const activeGlueModule = debugRuntimeRef.current.model?.glueModule as {
                    getConnectablePeerIds?: () => string[];
                } | null | undefined;
                return activeGlueModule?.getConnectablePeerIds?.() ?? [];
            },
            getPeerConnectionCoordinatorDebug: () => {
                const activeGlueModule = debugRuntimeRef.current.model?.glueModule as {
                    getPeerConnectionCoordinatorDebug?: () => Array<{
                        personId: string;
                        state: string;
                        routeKey?: string;
                        retryAt?: number;
                        directInFlight: boolean;
                        forceRetry: boolean;
                        manualRequested: boolean;
                        hasRelayLane: boolean;
                        hasDirectLane: boolean;
                        advertisedKey?: string;
                        isDemandedPeer: boolean;
                        isAutoConnectPeer: boolean;
                        transportCapabilities?: string[];
                    }>;
                } | null | undefined;
                return activeGlueModule?.getPeerConnectionCoordinatorDebug?.() ?? [];
            },
            getPeerConnectionInfo: (personId: string) => {
                const activeModel = debugRuntimeRef.current.model;
                const presenceService = activeModel?.glueModule?.presenceTrieService;
                const peerDebugInfo = presenceService?.getPeerDebugInfo(personId);
                const glueModuleWithPeerState = activeModel?.glueModule as {
                    getPeerConnectionState?: (targetPersonId: string) => string | undefined;
                } | undefined;

                return {
                    online: peerDebugInfo?.online ?? false,
                    advertisedDisplayName: peerDebugInfo?.advertisedDisplayName ?? null,
                    certifiedDisplayName: peerDebugInfo?.certifiedDisplayName ?? null,
                    advertisedEncryptionKey: peerDebugInfo?.advertisedEncryptionKey ?? null,
                    coordinatorState: glueModuleWithPeerState?.getPeerConnectionState?.(personId) ?? null,
                    encryptionKey: presenceService?.getEncryptionKey(personId) ?? null,
                    certifiedEncryptionKeys: peerDebugInfo?.certifiedEncryptionKeys ?? [],
                    certifiedCredentialIssuedAt: peerDebugInfo?.certifiedCredentialIssuedAt ?? null,
                    transportCapabilities: presenceService?.getTransportCapabilities(personId) ?? [],
                    hasVerifiedIdentity: presenceService?.hasVerifiedIdentity(personId) ?? false,
                };
            },
            requestPeerConnection: (personId: string) => {
                const activeModel = debugRuntimeRef.current.model;
                if (!activeModel?.initialized) {
                    throw new Error('fotos.one glue runtime is not initialized');
                }

                const glueModuleWithRequest = activeModel.glueModule as {
                    requestPeerConnection?: (targetPersonId: string) => boolean;
                    getPeerConnectionState?: (targetPersonId: string) => string | undefined;
                } | undefined;

                const requested =
                    typeof glueModuleWithRequest?.requestPeerConnection === 'function'
                    && glueModuleWithRequest.requestPeerConnection(personId);

                return {
                    requested,
                    state: glueModuleWithRequest?.getPeerConnectionState?.(personId) ?? null,
                };
            },
            createGalleryShareInvite: async () => {
                const invite = await createGalleryShareInvite();
                return {
                    url: invite.url,
                    pin: invite.pin,
                    expiresAt: invite.payload.expiresAt,
                };
            },
            acceptGalleryShareInvite: async () => await acceptIncomingGalleryShareInvite({ requireDestination: false }),
            forceRouteKeyConnect: async (personId: string, keySource: 'advertised' | 'certified' = 'advertised') => {
                const activeModel = debugRuntimeRef.current.model;
                if (
                    !activeModel?.initialized ||
                    !activeModel.publicationIdentity ||
                    !activeModel.glueModule?.presenceTrieService
                ) {
                    throw new Error('fotos.one glue runtime is not initialized');
                }

                const presenceService = activeModel.glueModule.presenceTrieService;
                const peerDebugInfo = presenceService.getPeerDebugInfo(personId);
                const advertisedEncryptionKey = peerDebugInfo?.advertisedEncryptionKey ?? null;
                const certifiedEncryptionKey =
                    presenceService.getEncryptionKey(personId)
                    ?? peerDebugInfo?.certifiedEncryptionKeys?.find((key): key is string =>
                        typeof key === 'string' && key.trim().length > 0,
                    )
                    ?? null;
                const encryptionKey =
                    keySource === 'certified'
                        ? certifiedEncryptionKey
                        : advertisedEncryptionKey ?? certifiedEncryptionKey;

                if (!encryptionKey) {
                    throw new Error(`No ${keySource} encryption key available for ${personId}`);
                }

                const glueModuleWithRequest = activeModel.glueModule as {
                    requestPeerConnection?: (targetPersonId: string) => boolean;
                };
                const transportCapabilities = presenceService.getTransportCapabilities(personId) ?? ['webrtc', 'commserver-relay'];
                const requested =
                    keySource !== 'certified' &&
                    typeof glueModuleWithRequest.requestPeerConnection === 'function'
                        ? glueModuleWithRequest.requestPeerConnection(personId)
                        : false;

                await activeModel.connectionModule?.connectToPeerByKey(
                    encryptionKey,
                    activeModel.publicationIdentity,
                    transportCapabilities,
                    personId as any,
                );

                return {
                    started: true as const,
                    requested,
                    encryptionKey,
                    transportCapabilities,
                    keySource:
                        keySource === 'advertised' && advertisedEncryptionKey
                            ? 'advertised'
                            : 'certified',
                };
            },
            grantFotosAccess: async (personId: string) => {
                await grantFotosAccess(personId as any);
                fotosShareController.recordGrant(personId);
                return {
                    granted: true as const,
                    personId,
                };
            },
            getAccessibleRootSummary: async (personId: string) => {
                const roots = await determineAccessibleHashes(personId as any, false, undefined);
                return roots.map(root => ({
                    type: String(root.type),
                    oneType: typeof (root as any).oneType === 'string' ? (root as any).oneType : null,
                    hash: typeof (root as any).hash === 'string' ? (root as any).hash : null,
                    idHash: typeof (root as any).idHash === 'string' ? (root as any).idHash : null,
                    node: typeof (root as any).node === 'string' ? (root as any).node : null,
                    dataType: typeof (root as any).dataType === 'string' ? (root as any).dataType : null,
                    dataIdHash: typeof (root as any).dataIdHash === 'string' ? (root as any).dataIdHash : null,
                }));
            },
            getFotosSyncState: async () => {
                await fotosShareController.refreshManifest();
                return fotosShareController.getSnapshot();
            },
            getShareState: async () => {
                await fotosShareController.refreshManifest();
                return fotosShareController.getSnapshot();
            },
            getGalleryState: () => {
                const { folder, visiblePhotos: activeVisiblePhotos, entries: activeEntries } = debugRuntimeRef.current;
                return {
                    isOpen: folder.isOpen,
                    folderName: folder.folderName,
                    totalCount: activeEntries.length,
                    visibleCount: activeVisiblePhotos.length,
                    items: activeEntries.map(photo => ({
                        hash: photo.hash,
                        name: photo.name,
                        ...(photo.sourcePath ? { sourcePath: photo.sourcePath } : {}),
                        ...(photo.thumb ? { thumb: photo.thumb } : {}),
                        ...(photo.capturedAt ? { capturedAt: photo.capturedAt } : {}),
                        ...(photo.updatedAt ? { updatedAt: photo.updatedAt } : {}),
                        faceCount: getFaceCount(photo.faces),
                    })),
                };
            },
            openLocalPicker: () => {
                debugRuntimeRef.current.folder.openLocalFiles();
                return true;
            },
        };

        debugWindow.__fotosDebug = debugApi;

        return () => {
            if (debugWindow.__fotosDebug === debugApi) {
                delete debugWindow.__fotosDebug;
            }
        };
    }, []);

    const incomingShareBusy = incomingShareStatus === 'choosing-folder'
        || incomingShareStatus === 'preparing'
        || incomingShareStatus === 'connecting';
    const incomingShareStatusLabel = incomingShareStatus === 'choosing-folder'
        ? 'Waiting for a destination folder...'
        : incomingShareStatus === 'preparing'
        ? 'Preparing secure sync...'
        : incomingShareStatus === 'connecting'
            ? 'Syncing shared gallery...'
            : null;
    const waitingForIncomingShareContent = Boolean(incomingShareInvite)
        && (incomingShareStatus === 'accepted' || incomingShareBusy);
    const incomingShareExpectedCount = shareSnapshot?.manifestEntries.length ?? 0;
    const incomingShareReceivedCount = shareSnapshot?.remoteItems.length ?? 0;
    const incomingShareProgressPercent = incomingShareExpectedCount > 0
        ? Math.min(100, Math.round((incomingShareReceivedCount / incomingShareExpectedCount) * 100))
        : null;
    const incomingShareProgressLabel = incomingShareExpectedCount > 0
        ? `${incomingShareReceivedCount}/${incomingShareExpectedCount} photos received`
        : incomingShareReceivedCount > 0
            ? `${incomingShareReceivedCount} photos received`
            : 'Waiting for shared photos...';

    const appContent = (() => {
        // Before the first library exists there is nothing to browse yet. Rescans and
        // later phases stay in the gallery and use its canonical status strip.
        if (progress && !analysisProgress && !gallery.folder.isOpen) {
            const progressDisplay = resolveProgressDisplay(progress);
            const progressDetail = progress.statusLabel ?? progress.fileName;
            return (
                <div className="h-screen flex flex-col items-center justify-center bg-[#111] text-white/70 view-enter">
                    <div style={{ width: 'min(480px, 80vw)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <div
                            role="progressbar"
                            aria-label={progressDisplay.label}
                            aria-valuemin={progressDisplay.measured ? 0 : undefined}
                            aria-valuemax={progressDisplay.measured ? 100 : undefined}
                            aria-valuenow={progressDisplay.percent ?? undefined}
                            style={{ width: '100%', height: 6, borderRadius: 3, background: '#333', overflow: 'hidden' }}
                        >
                            <div
                                className={progressDisplay.measured ? '' : 'fotos-progress-indeterminate'}
                                style={{
                                    height: '100%', borderRadius: 3, background: '#e94560',
                                    width: progressDisplay.measured ? `${progressDisplay.percent}%` : '35%',
                                    transition: progressDisplay.measured ? 'width 0.3s ease' : undefined,
                                }}
                            />
                        </div>
                        <p role="status" aria-live="polite" style={{ fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {progressDisplay.label}{progressDisplay.countLabel ? ` ${progressDisplay.countLabel}` : ''}
                        </p>
                        {progressDetail && (
                            <p aria-hidden="true" className="truncate text-xs text-white/45">{progressDetail}</p>
                        )}
                    </div>
                </div>
            );
        }

        // Incoming share accepted — wait for CHUM to download remote media.
        if (!gallery.folder.isOpen && waitingForIncomingShareContent) {
            return (
                <div className="h-screen flex flex-col bg-[#111] view-enter">
                    <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-5 p-6 text-center">
                        <img src="/cam.svg" className="h-40 w-40 invert opacity-15" style={{ objectFit: 'contain' }} />
                        <div className="space-y-2">
                            <div className="text-lg font-medium text-white/82">Downloading shared gallery</div>
                            <p className="max-w-md text-sm leading-relaxed text-white/42">
                                Photos will appear here as soon as they arrive. No local upload or folder selection is needed.
                            </p>
                        </div>
                        <div className="h-1.5 w-full max-w-md overflow-hidden rounded-full bg-white/8">
                            <div className="fotos-progress-indeterminate h-full w-[35%] rounded-full bg-[#e94560]" />
                        </div>
                    </div>
                    <Impressum />
                </div>
            );
        }

        // No folder open yet — show landing page
        if (!gallery.folder.isOpen) {
            return (
                <div className="h-screen flex flex-col bg-[#111] view-enter">
                    <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-6 p-6">
                        <img src="/cam.svg" className="flex-1 min-h-0 invert opacity-20" style={{ maxWidth: '80vw', objectFit: 'contain' }} />
                        <div className="w-full max-w-lg space-y-3 rounded-2xl border border-white/10 bg-white/[0.035] p-4 backdrop-blur-sm">
                            <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-3">
                                <input
                                    type="checkbox"
                                    checked={settings.analysis.faceAnalyticsEnabled}
                                    onChange={event => updateAnalysis({ faceAnalyticsEnabled: event.target.checked })}
                                    className="mt-0.5 h-4 w-4 accent-[#e94560]"
                                />
                                <div className="space-y-1">
                                    <div className="text-sm font-medium text-white/80">Enable face analytics</div>
                                    <p className="text-xs leading-relaxed text-white/38">
                                        Downloads on-device face detection and recognition weights when needed for people clustering and similar-face search.
                                    </p>
                                </div>
                            </label>

                            <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-3">
                                <input
                                    type="checkbox"
                                    checked={settings.analysis.semanticSearchEnabled}
                                    onChange={event => updateAnalysis({ semanticSearchEnabled: event.target.checked })}
                                    className="mt-0.5 h-4 w-4 accent-[#e94560]"
                                />
                                <div className="space-y-1">
                                    <div className="text-sm font-medium text-white/80">Enable semantic search</div>
                                    <p className="text-xs leading-relaxed text-white/38">
                                        Downloads the multimodal search model when you search by meaning instead of exact words.
                                    </p>
                                </div>
                            </label>
                        </div>
                        {pendingImportCount > 0 && (
                            <div className="w-full max-w-lg rounded-2xl border border-[#e94560]/30 bg-[#2b0f16]/80 px-4 py-3 text-sm text-white/80 shadow-[0_16px_40px_rgba(0,0,0,0.25)]">
                                {pendingImportCount} shared photo{pendingImportCount === 1 ? ' is' : 's are'} ready to be stored locally.
                            </div>
                        )}
                        {canClaimAuthorshipOnIngest && (
                            <label className="flex w-full max-w-lg items-start gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-left">
                                <input
                                    type="checkbox"
                                    checked={claimAuthorshipOnIngest}
                                    onChange={event => gallery.folder.setClaimAuthorshipOnIngest(event.target.checked)}
                                    className="mt-0.5 h-4 w-4 accent-[#e94560]"
                                />
                                <div className="space-y-1">
                                    <div className="text-sm font-medium text-white/80">Claim authorship on ingest</div>
                                    <p className="text-xs leading-relaxed text-white/38">
                                        Sign each imported image hash with this fotos identity so authenticity proof can travel with shared photos.
                                    </p>
                                </div>
                            </label>
                        )}
                        <button
                            onClick={gallery.folder.openFolder}
                            className="px-5 py-2.5 rounded-lg bg-[#e94560] text-white text-sm font-medium hover:bg-[#d13354] transition-colors"
                        >
                            {primaryIntakeActionLabel}
                        </button>

                        <div className="flex items-center gap-3 w-full max-w-lg">
                            <div className="flex-1 h-px bg-white/10" />
                            <span className="text-xs text-white/30">or</span>
                            <div className="flex-1 h-px bg-white/10" />
                        </div>

                        {!showHeadlessConnect ? (
                            <button
                                onClick={() => setShowHeadlessConnect(true)}
                                className="px-5 py-2.5 rounded-lg border border-white/15 text-white/60 text-sm font-medium hover:border-white/25 hover:text-white/80 transition-colors"
                            >
                                Connect to server
                            </button>
                        ) : (
                            <div className="flex gap-2 w-full max-w-lg">
                                <input
                                    type="text"
                                    value={headlessInput}
                                    onChange={e => setHeadlessInput(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter' && headlessInput.trim()) {
                                            setHeadlessUrl(headlessInput.trim().replace(/\/+$/, ''));
                                        }
                                    }}
                                    placeholder="http://192.168.1.100:3000"
                                    className="flex-1 px-3 py-2 rounded-lg border border-white/15 bg-black/30 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-white/30"
                                    autoFocus
                                />
                                <button
                                    onClick={() => {
                                        if (headlessInput.trim()) {
                                            setHeadlessUrl(headlessInput.trim().replace(/\/+$/, ''));
                                        }
                                    }}
                                    disabled={!headlessInput.trim()}
                                    className="px-4 py-2 rounded-lg bg-white/10 text-white/70 text-sm font-medium hover:bg-white/15 hover:text-white/90 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                    Connect
                                </button>
                            </div>
                        )}

                        <p className="max-w-md text-center text-xs text-white/45">
                            {primaryIntakeSummary}
                        </p>
                    </div>
                    <Impressum />
                </div>
            );
        }

        return (
            <>
                {/* Portrait mobile: column (grid above, sidebar below)
                     Landscape mobile + desktop: row (grid left, sidebar right) */}
                <div className={`h-screen flex ${mobile ? 'flex-col landscape:flex-row' : ''}`}>
                    {/* Main content area */}
                    <div className="flex-1 min-w-0 min-h-0 relative">
                        <div ref={scrollRef} className={`h-full overflow-y-auto hide-scrollbar ${mobile ? 'pb-20 landscape:pb-0' : ''}`}>
                            {showBreadcrumbs ? (
                                <GalleryBreadcrumbs items={breadcrumbItems} summary={breadcrumbSummary} />
                            ) : null}
                            {showClusterGallery ? (
                                <ClusterGallery
                                    clusters={gallery.clusters}
                                    activeClusterId={gallery.activeClusterId}
                                    onSelectCluster={gallery.setActiveClusterId}
                                    getFileUrl={gallery.folder.getFileUrl}
                                    onRenameCluster={handleRenameFace}
                                    people={gallery.people}
                                    onNameClusters={handleNameClusters}
                                />
                            ) : (
                                <PhotoGrid
                                    dayGroups={visibleDayGroups}
                                    photos={visiblePhotos}
                                    thumbScale={settings.display.thumbScale}
                                    onPhotoClick={(index) => { void handlePhotoClick(index); }}
                                    onPhotoContextMenu={handlePhotoContextMenu}
                                    selectionActive={photoSelectionActive}
                                    selectedPhotoHashes={selectedPhotoHashSet}
                                    onPhotoToggleSelection={(photo) => toggleSelectedPhotoHash(photo.hash)}
                                    onClearSelection={() => setSelectedPhotoHashes([])}
                                    loading={gallery.loading}
                                    getThumbUrl={gallery.folder.getThumbUrl}
                                    mobile={mobile}
                                    analysisProgress={progress}
                                    emptyTitle={
                                        trimmedSearchQuery.length > 0
                                            ? 'No matching photos'
                                            : gallery.searchFace !== null
                                                ? 'No similar faces found'
                                                : gallery.activeCollectionId
                                                    ? 'This collection is empty'
                                                    : gallery.activeTag
                                                        ? 'No photos with this tag'
                                                        : gallery.activeClusterId
                                                            ? 'No photos in this cluster'
                                                            : 'No photos found'
                                    }
                                    emptyHint={
                                        trimmedSearchQuery.length > 0
                                            ? 'Try a different search term or clear the current filter.'
                                            : gallery.searchFace !== null
                                                ? 'Try with a different face or lower the similarity threshold.'
                                                : gallery.activeCollectionId
                                                    ? 'Select photos and add them to this collection from the sidebar.'
                                                    : gallery.activeTag
                                                        ? 'No photos are tagged with this label yet.'
                                                        : gallery.activeClusterId
                                                            ? 'This face cluster has no associated photos.'
                                                            : 'Open a photo folder to get started.'
                                    }
                                />
                            )}
                        </div>
                        {!showClusterGallery && (
                            <>
                                <TimelineScrubber
                                    scrollRef={scrollRef}
                                    dayGroups={visibleDayGroups}
                                />
                                {showOnboarding && (
                                    <div className="absolute right-12 top-1/2 -translate-y-1/2 z-50 bg-[#e94560] text-white p-3 rounded-lg shadow-xl max-w-[200px] animate-[viewFadeIn_300ms_ease]">
                                        <div className="flex items-start justify-between gap-2">
                                            <div>
                                                <p className="font-semibold text-xs mb-0.5">📅 Timeline Scrubber</p>
                                                <p className="text-[11px] text-white/95 leading-tight">Drag this scrubber to jump to different dates in your library.</p>
                                            </div>
                                            <button type="button" onClick={handleDismissOnboarding} className="text-white/60 hover:text-white text-xs font-bold shrink-0">✕</button>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                        {/* Selection toolbar — appears whenever photos are selected */}
                        {selectedPhotoHashes.length > 0 && (
                            <div className={`absolute ${mobile ? 'bottom-20 landscape:bottom-3' : 'bottom-3'} left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 rounded-xl border border-white/10 bg-black/80 px-3 py-2 shadow-2xl backdrop-blur-md view-enter`}>
                                <span className="text-xs font-medium text-white/80 tabular-nums whitespace-nowrap">
                                    {selectedPhotoHashes.length} selected
                                </span>
                                <div className="h-4 w-px bg-white/10" />
                                <button
                                    type="button"
                                    onClick={() => { setSelectedPhotoHashes([]); }}
                                    className="rounded-md px-2 py-1 text-[11px] text-white/45 transition-colors hover:bg-white/10 hover:text-white/75"
                                >
                                    Clear
                                </button>
                                <button
                                    type="button"
                                    onClick={selectAllVisiblePhotos}
                                    className="rounded-md px-2 py-1 text-[11px] text-white/45 transition-colors hover:bg-white/10 hover:text-white/75"
                                >
                                    Select all
                                </button>
                                {mobile && (
                                    <button
                                        type="button"
                                        onClick={() => { void handleExportSelectedPhotos(); }}
                                        disabled={exportingPhotos}
                                        className="rounded-md bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white/80 transition-colors hover:bg-white/15 disabled:opacity-30"
                                    >
                                        Export
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Sidebar — on mobile: below grid (portrait) or right (landscape) */}
                    <Sidebar
                        tags={gallery.tags}
                        activeTag={gallery.activeTag}
                        onTagClick={gallery.setActiveTag}
                        searchQuery={gallery.searchQuery}
                        onSearchChange={gallery.setSearchQuery}
                        browseSummary={gallery.galleryMode === 'clusters'
                            ? gallery.activeCluster
                                ? `${gallery.clusterPhotos.length} photos in ${gallery.activeCluster.label}`
                                : `${gallery.clusters.length} clusters`
                            : gallery.activeCollection
                                ? `${visiblePhotos.length} photos in ${gallery.activeCollection.name}`
                            : `${gallery.totalCount} photos` + (totalDetectedFaces > 0 ? ` · ${totalDetectedFaces} faces` : '')}
                        settings={settings}
                        acceptSharing={acceptSharing}
                        onUpdateStorage={updateStorage}
                        onUpdateDisplay={updateDisplay}
                        onUpdateDeviceName={updateDeviceName}
                        onUpdateAnalysis={updateAnalysis}
                        onAcceptSharingChange={updateAcceptSharing}
                        historyEnabled={breadcrumbHistory.enabled}
                        historyReady={breadcrumbHistory.ready}
                        historyCurrentEventId={breadcrumbHistory.currentEventId}
                        historyBranchTree={breadcrumbHistory.branchTree}
                        historyVisibleEntryCount={breadcrumbHistory.visibleEntryCount}
                        historyBranchCount={breadcrumbHistory.branchCount}
                        onHistoryEnabledChange={breadcrumbHistory.setEnabled}
                        onHistoryNavigate={breadcrumbHistory.navigateTo}
                        onHistoryDelete={handleDeleteHistoryEntry}
                        currentFolderName={gallery.folder.folderName}
                        folderName={gallery.folder.folderName}
                        folders={gallery.folder.folders}
                        onOpenFolder={gallery.folder.openFolder}
                        onSelectFolder={gallery.folder.selectFolder}
                        onRemoveFolder={handleRemoveFolder}
                        onRescan={gallery.folder.rescan}
                        onReanalyze={canReanalyze ? gallery.folder.reanalyzeFaces : undefined}
                        canClaimAuthorshipOnIngest={gallery.folder.canClaimAuthorshipOnIngest}
                        claimAuthorshipOnIngest={gallery.folder.claimAuthorshipOnIngest}
                        onClaimAuthorshipOnIngestChange={gallery.folder.setClaimAuthorshipOnIngest}
                        llmComparisonPhoto={comparisonPhoto}
                        llmComparisonPhotoLabel={comparisonPhotoLabel}
                        faceSearchActive={gallery.searchFace !== null}
                        onClearFaceSearch={() => gallery.setSearchFace(null)}
                        fotosModel={fotosModel}
                        mobile={mobile}
                        galleryMode={gallery.galleryMode}
                        onGalleryModeChange={handleGalleryModeChange}
                        collections={collectionSummaries}
                        activeCollectionId={gallery.activeCollectionId}
                        onCollectionSelect={handleCollectionSelect}
                        selectedPhotoCount={selectedPhotoHashes.length}
                        onSelectAllVisiblePhotos={selectAllVisiblePhotos}
                        onExportSelectedPhotos={mobile ? handleExportSelectedPhotos : undefined}
                        exportSelectedPhotosDisabled={exportingPhotos}
                        clusterSelectionEnabled={clusterSelectionEnabled}
                        onClusterSelectionModeChange={setClusterSelectionEnabled}
                        selectedClusterIds={selectedClusterIds}
                        selectedClusterCount={selectedClusterIds.length}
                        onToggleSelectedCluster={toggleSelectedClusterId}
                        onClearCollectionSelection={clearCollectionSelection}
                        onCreateCollection={handleCreateCollection}
                        onRenameCollection={fotosCollections.renameCollection}
                        onDeleteCollection={handleDeleteCollection}
                        clusters={gallery.clusters}
                        allClusters={gallery.allClusters}
                        people={gallery.people}
                        groups={gallery.groups}
                        similarFaces={gallery.similarFaces}
                        searchClusters={gallery.searchClusters}
                        activeClusterId={gallery.activeClusterId}
                        onClusterSelect={handleClusterSelect}
                        getFileUrl={gallery.folder.getFileUrl}
                        onAssociateFaceWithCluster={handleAssociateFaceWithCluster}
                        onMergeFaceClusters={handleMergeFaceClusters}
                        onGroupFaceClustersAsPerson={handleGroupFaceClustersAsPerson}
                        onSeparatePersonGroup={handleSeparatePersonGroup}
                        onOpenSimilarFace={handleOpenSimilarFace}
                        onDeletePhoto={handleDelete}
                        onRenameFace={handleRenameFace}
                        onDeleteFace={handleDeleteFace}
                        galleryShareInvite={createdShareInvite}
                        creatingGalleryShareInvite={creatingShareInvite}
                        onCreateGalleryShareInvite={handleCreateGalleryShareInvite}
                        sharePeerOptions={sharePeerOptions}
                        gallerySharePersonIds={fotosCollections.sharing.galleryPersonIds}
                        collectionSharePersonIds={fotosCollections.sharing.collectionPersonIds}
                        clusterSharePersonIds={fotosCollections.sharing.clusterPersonIds}
                        onGalleryShareChange={handleGalleryShareChange}
                        onCollectionShareChange={handleCollectionShareChange}
                        onClusterShareChange={handleClusterShareChange}
                        onClusterContextMenu={handleClusterContextMenu}
                        onCollectionContextMenu={handleCollectionContextMenu}
                        showOnboarding={showOnboarding}
                        onDismissOnboarding={handleDismissOnboarding}
                    />
                </div>

                {!showClusterGallery && gallery.selectedIndex !== null && (
                    <Lightbox
                        photos={visiblePhotos}
                        index={gallery.selectedIndex}
                        onIndexChange={(index) => openPhotoRouteIndex(index, { replace: true })}
                        onClose={() => closePhotoRoute({ replace: true })}
                        onDelete={handleDelete}
                        onExport={mobile ? handleExportPhoto : undefined}
                        onFaceSearch={handleFaceSearch}
                        onRenameFace={handleRenameFace}
                        onDeleteFace={handleDeleteFace}
                        people={gallery.people}
                        onAssociateFace={handleAssociateFaceWithCluster}
                        getFileUrl={gallery.folder.getFileUrl}
                        mobile={mobile}
                    />
                )}
            </>
        );
    })();

    return (
        <>
            {appContent}
            {incomingShareInvite && incomingShareStatus !== 'accepted' && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#141414] p-4 shadow-2xl">
                        <div className="space-y-1">
                            <div className="text-sm font-medium text-white/85">Open shared gallery</div>
                            <div className="text-xs leading-relaxed text-white/38">
                                {incomingShareInvite.galleryName ?? 'Shared gallery'} from {incomingShareInvite.senderPersonId.slice(0, 12)}
                            </div>
                        </div>
                        <div className="mt-4 space-y-3">
                            <div className="rounded-md border border-white/10 bg-black/25 px-3 py-2 text-xs leading-relaxed text-white/45">
                                Choose a local folder for this shared gallery. fotos will use it as the destination while shared photos sync.
                            </div>
                            {incomingShareError && (
                                <div className="rounded-md border border-[#e94560]/25 bg-[#e94560]/10 px-2.5 py-2 text-xs text-[#ffb5c3]">
                                    {incomingShareError}
                                </div>
                            )}
                            <button
                                type="button"
                                disabled={incomingShareBusy}
                                onClick={() => {
                                    void handleAcceptIncomingGalleryShareInvite();
                                }}
                                className={`w-full rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                                    incomingShareBusy
                                        ? 'bg-white/5 text-white/22 cursor-wait'
                                        : 'bg-[#e94560] text-white hover:bg-[#d13354]'
                                }`}
                            >
                                {incomingShareBusy ? 'Opening gallery...' : 'Choose folder and open'}
                            </button>
                            {incomingShareStatusLabel && (
                                <div className="space-y-1.5" role="status" aria-live="polite">
                                    <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
                                        <div className="fotos-progress-indeterminate h-full w-[35%] rounded-full bg-[#e94560]" />
                                    </div>
                                    <div className="text-center text-[11px] text-white/35">
                                        {incomingShareStatusLabel}
                                    </div>
                                </div>
                            )}
                            <button
                                type="button"
                                onClick={() => setIncomingShareInvite(null)}
                                className="w-full rounded-md px-3 py-1.5 text-xs text-white/30 transition-colors hover:text-white/55"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {incomingShareInvite && incomingShareStatus === 'accepted' && (
                <div className="fixed bottom-4 left-1/2 z-40 w-[min(92vw,520px)] -translate-x-1/2 rounded-xl border border-white/10 bg-[#141414]/95 p-3 shadow-2xl backdrop-blur">
                    <div className="flex flex-col gap-3">
                        <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium text-white/80">Shared gallery is syncing</div>
                            <div className="text-[11px] text-white/35">{incomingShareProgressLabel}</div>
                            <div
                                className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/8"
                                role="progressbar"
                                aria-label="Incoming shared photos"
                                aria-valuemin={incomingShareProgressPercent === null ? undefined : 0}
                                aria-valuemax={incomingShareProgressPercent === null ? undefined : 100}
                                aria-valuenow={incomingShareProgressPercent ?? undefined}
                            >
                                <div
                                    className={`${incomingShareProgressPercent === null ? 'fotos-progress-indeterminate w-[35%]' : ''} h-full rounded-full bg-[#e94560] transition-all`}
                                    style={incomingShareProgressPercent === null
                                        ? undefined
                                        : {width: `${incomingShareProgressPercent}%`}}
                                />
                            </div>
                        </div>
                        <div className="flex gap-2 sm:justify-end">
                            <button
                                type="button"
                                onClick={() => setIncomingShareInvite(null)}
                                className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] text-white/55 transition-colors hover:bg-white/10 hover:text-white/75"
                            >
                                Later
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    writeStoredSidebarTab('settings');
                                    setIncomingShareInvite(null);
                                }}
                                className="rounded-md bg-[#e94560] px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-[#d13354]"
                            >
                                Use my ID
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <UpdatePrompt />
            <ContextMenu
                x={contextMenu?.x ?? 0}
                y={contextMenu?.y ?? 0}
                type={contextMenu?.type ?? 'photo'}
                visible={contextMenu?.visible ?? false}
                data={contextMenu?.data}
                onClose={() => setContextMenu(null)}
                mobile={mobile}
                onDeletePhoto={handleDelete}
                onToggleSelectPhoto={toggleSelectedPhotoHash}
                isPhotoSelected={(hash) => selectedPhotoHashSet.has(hash)}
                onSharePhoto={handleSharePhoto}
                onRenameCluster={handleRenameCluster}
                onDeleteCluster={handleDeleteFace}
                onRenameCollection={handleRenameCollectionAction}
                onDeleteCollection={handleDeleteCollection}
            />
            <ConfirmModal
                open={confirmState?.open ?? false}
                title={confirmState?.title ?? ''}
                message={confirmState?.message ?? ''}
                isDestructive={confirmState?.isDestructive}
                confirmLabel={confirmState?.confirmLabel ?? (confirmState?.isDestructive ? 'Delete' : 'Confirm')}
                onConfirm={async () => {
                    const pendingConfirmation = confirmState;
                    if (!pendingConfirmation) return;
                    await pendingConfirmation.onConfirm();
                    setConfirmState(current => current === pendingConfirmation ? null : current);
                }}
                onCancel={() => setConfirmState(null)}
            />
            <RenameModal
                open={renameState !== null}
                title={renameState?.title ?? ''}
                label={renameState?.label ?? 'Name'}
                initialValue={renameState?.initialValue ?? ''}
                onSubmit={value => {
                    if (!renameState) return;
                    if (renameState.kind === 'cluster') {
                        void handleRenameFace(renameState.id, value);
                    } else {
                        fotosCollections.renameCollection(renameState.id, value);
                    }
                    setRenameState(null);
                }}
                onCancel={() => setRenameState(null)}
            />
        </>
    );
}
