export interface FotosRuntimeSnapshot {
    isOpen: boolean;
    folderName: string | null;
    entryCount: number;
    photoCount: number;
    visibleHashes: string[];
    galleryMode: 'images' | 'clusters';
    activeClusterId: string | null;
    activeCollectionId: string | null;
    clusterCount: number;
    visibleClusterCount: number;
    collectionCount: number;
    searchQuery: string;
    totalFaceCount: number;
    visibleFaceCount: number;
    selectedPhotoHash: string | null;
    topClusters: Array<{
        clusterId: string;
        label: string;
        faceCount: number;
        photoCount: number;
        personId?: string;
        personName?: string;
    }>;
    collections: Array<{
        id: string;
        name: string;
        photoCount: number;
        faceCount: number;
        coverPhotoHash: string | null;
    }>;
    pendingFaces: number;
    loading: boolean;
    selectedIndex: number | null;
    searchFaceActive: boolean;
    ingestProgress: {
        phase: string;
        current: number;
        total: number;
        fileName?: string;
        statusLabel?: string;
    } | null;
}

export interface FotosRuntimeVisiblePhoto {
    hash: string;
    name: string;
    sourcePath: string | null;
    mimeType: string | null;
    thumb: string | null;
    size: number;
    managed: string;
    capturedAt: string | null;
}

export interface FotosRuntimeExportedPhoto {
    hash: string;
    name: string;
    mimeType: string;
    size: number;
    dataUrl: string;
}

let currentSnapshot: FotosRuntimeSnapshot = {
    isOpen: false,
    folderName: null,
    entryCount: 0,
    photoCount: 0,
    visibleHashes: [],
    galleryMode: 'images',
    activeClusterId: null,
    activeCollectionId: null,
    clusterCount: 0,
    visibleClusterCount: 0,
    collectionCount: 0,
    searchQuery: '',
    totalFaceCount: 0,
    visibleFaceCount: 0,
    selectedPhotoHash: null,
    topClusters: [],
    collections: [],
    pendingFaces: 0,
    loading: false,
    selectedIndex: null,
    searchFaceActive: false,
    ingestProgress: null,
};

let currentVisiblePhotos: FotosRuntimeVisiblePhoto[] = [];
let currentVisiblePhotoExporter: ((hash: string) => Promise<FotosRuntimeExportedPhoto>) | null = null;

export function setFotosRuntimeSnapshot(
    updates: Partial<FotosRuntimeSnapshot>,
): FotosRuntimeSnapshot {
    currentSnapshot = {
        ...currentSnapshot,
        ...updates,
    };
    return currentSnapshot;
}

export function getFotosRuntimeSnapshot(): FotosRuntimeSnapshot {
    return currentSnapshot;
}

export function setFotosRuntimeVisiblePhotos(
    photos: FotosRuntimeVisiblePhoto[],
    exportPhoto: ((hash: string) => Promise<FotosRuntimeExportedPhoto>) | null,
): FotosRuntimeVisiblePhoto[] {
    currentVisiblePhotos = photos;
    currentVisiblePhotoExporter = exportPhoto;
    return currentVisiblePhotos;
}

export function getFotosRuntimeVisiblePhotos(): FotosRuntimeVisiblePhoto[] {
    return currentVisiblePhotos;
}

export async function exportFotosRuntimeVisiblePhoto(hash: string): Promise<FotosRuntimeExportedPhoto> {
    if (!currentVisiblePhotoExporter) {
        throw new Error('Visible photo export is unavailable because no local folder is open.');
    }
    return currentVisiblePhotoExporter(hash);
}
