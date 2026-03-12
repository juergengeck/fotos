export interface FotosRuntimeSnapshot {
    isOpen: boolean;
    folderName: string | null;
    entryCount: number;
    photoCount: number;
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

let currentSnapshot: FotosRuntimeSnapshot = {
    isOpen: false,
    folderName: null,
    entryCount: 0,
    photoCount: 0,
    pendingFaces: 0,
    loading: false,
    selectedIndex: null,
    searchFaceActive: false,
    ingestProgress: null,
};

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
