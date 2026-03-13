import { DEFAULT_FOTOS_CONFIG, EMBEDDING_DIM } from '@refinio/fotos.core';

export type StorageMode = 'reference' | 'metadata' | 'ingest';

export interface FaceInfo {
    count: number;
    bboxes: Array<[number, number, number, number]>;
    scores: number[];
    embeddings: Float32Array | null;
    crops: string[];
    clusterIds?: string[];
    names?: string[];
    qrPaths?: string[];
}

export interface SemanticInfo {
    modelId: string;
    embedding: Float32Array;
}

export interface PhotoEntry {
    hash: string;
    name: string;
    managed: StorageMode;
    sourcePath?: string;
    folderPath?: string;
    mimeType?: string;
    thumb?: string;
    tags: string[];
    capturedAt?: string;
    updatedAt?: string;
    exif?: ExifData;
    addedAt: string;
    size: number;
    copies?: string[];
    faces?: FaceInfo;
    semantic?: SemanticInfo | null;
}

export interface ExifData {
    date?: string;
    camera?: string;
    lens?: string;
    focalLength?: string;
    aperture?: string;
    shutter?: string;
    iso?: number;
    gps?: {lat: number; lon: number};
    width?: number;
    height?: number;
}

export interface FotosSettings {
    storage: StorageSettings;
    device: DeviceSettings;
    display: DisplaySettings;
    analysis: AnalysisSettings;
}

export interface StorageSettings {
    defaultMode: StorageMode;
    blobDir: string;
    thumbDir: string;
    thumbSize: number;
    quotaMb: number;
    minCopies: number;
}

export interface DeviceSettings {
    name: string;
}

export interface DisplaySettings {
    gridSize: 'small' | 'large';
    thumbScale: number;
    sortBy: 'date' | 'name' | 'added';
    sortOrder: 'asc' | 'desc';
}

export interface AnalysisSettings {
    faceAnalyticsEnabled: boolean;
    semanticSearchEnabled: boolean;
    clusterSensitivity: number;
}

export function getFaceCount(faces?: FaceInfo): number {
    if (!faces) {
        return 0;
    }

    const derivedCounts = [
        faces.count,
        faces.bboxes.length,
        faces.scores.length,
        faces.crops.filter(Boolean).length,
        faces.clusterIds?.filter(Boolean).length ?? 0,
        faces.names?.filter(Boolean).length ?? 0,
    ];

    if (faces.embeddings) {
        derivedCounts.push(Math.floor(faces.embeddings.length / EMBEDDING_DIM));
    }

    return Math.max(
        0,
        ...derivedCounts.filter((value): value is number => Number.isFinite(value)),
    );
}

export const DEFAULT_SETTINGS: FotosSettings = {
    storage: {
        defaultMode: 'metadata',
        blobDir: DEFAULT_FOTOS_CONFIG.blobDir,
        thumbDir: DEFAULT_FOTOS_CONFIG.thumbDir,
        thumbSize: DEFAULT_FOTOS_CONFIG.thumbSize,
        quotaMb: 0,
        minCopies: 1,
    },
    device: {
        name: 'browser',
    },
    display: {
        gridSize: 'small',
        thumbScale: 160,
        sortBy: 'date',
        sortOrder: 'desc',
    },
    analysis: {
        faceAnalyticsEnabled: false,
        semanticSearchEnabled: false,
        clusterSensitivity: 50,
    },
};
