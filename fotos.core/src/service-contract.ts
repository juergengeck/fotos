import { dataAttrsToFaces, EMBEDDING_DIM } from './faces.js';
import type { FotosCatalogExif } from './fotos-catalog.js';

export const FOTOS_SERVICE_METHODS = [
    'status',
    'ingest',
    'pause',
    'resume',
    'browse',
    'folders',
] as const;

export type FotosServiceMethod = typeof FOTOS_SERVICE_METHODS[number];
export type FotosServiceChannel<M extends FotosServiceMethod = FotosServiceMethod> = `fotos:${M}`;

export type FotosManagedMode = 'reference' | 'metadata' | 'ingest';
export type FotosServiceManagedMode = FotosManagedMode | 'ingested';
export type FotosIngestState = 'idle' | 'running' | 'paused';
export type FotosBinaryResourceKind = 'thumb' | 'file';
export type FotosServiceFaceData = Record<string, string>;

export interface FotosFolderMetadata {
    path: string;
    name: string;
    photoCount: number;
    localCount: number;
    dateRangeStart?: string;
    dateRangeEnd?: string;
    childCount: number;
}

export interface FotosServiceEntry {
    hash: string;
    name: string;
    contentHash?: string;
    streamId?: string;
    managed?: FotosServiceManagedMode;
    sourcePath: string;
    folderPath?: string;
    thumb?: string;
    mime?: string;
    size: number;
    tags: string[];
    addedAt: string;
    exif?: FotosCatalogExif;
    faceData?: FotosServiceFaceData;
}

export interface FotosDecodedFaceData {
    count: number;
    bboxes: Array<[number, number, number, number]>;
    scores: number[];
    embeddings: Float32Array;
    crops: string[];
}

export interface FotosIngestStatus {
    state: FotosIngestState;
    currentFolder?: string;
    folderIndex: number;
    totalFolders: number;
    photoIndex: number;
    photosInFolder: number;
    totalProcessed: number;
    totalFound: number;
    totalPhotos?: number;
    dir?: string;
}

export interface FotosServiceStatusData extends FotosIngestStatus {
    folderName?: string;
}

export interface FotosServiceBrowseParams {
    folder?: string;
    limit?: number;
    offset?: number;
}

export interface FotosServiceBrowseData {
    entries: FotosServiceEntry[];
    children: FotosFolderMetadata[];
    total: number;
    limit: number;
    offset: number;
}

export interface FotosServiceFoldersParams {
    path?: string;
}

export interface FotosServiceFoldersData {
    folders: FotosFolderMetadata[];
}

export interface FotosServiceSuccess<T> {
    success: true;
    data: T;
}

export interface FotosServiceFailure {
    success: false;
    error: string;
}

export type FotosServiceResult<T> = FotosServiceSuccess<T> | FotosServiceFailure;

export interface FotosServiceParamsByMethod {
    status: Record<string, never>;
    ingest: Record<string, never>;
    pause: Record<string, never>;
    resume: Record<string, never>;
    browse: FotosServiceBrowseParams;
    folders: FotosServiceFoldersParams;
}

export interface FotosServiceDataByMethod {
    status: FotosServiceStatusData;
    ingest: FotosIngestStatus;
    pause: FotosIngestStatus;
    resume: FotosIngestStatus;
    browse: FotosServiceBrowseData;
    folders: FotosServiceFoldersData;
}

export type FotosServiceResultByMethod = {
    [M in FotosServiceMethod]: FotosServiceResult<FotosServiceDataByMethod[M]>;
};

export type FotosServiceTransport = (
    channel: FotosServiceChannel,
    params: Record<string, unknown>,
) => Promise<unknown>;

export function isFotosServiceMethod(value: string): value is FotosServiceMethod {
    return (FOTOS_SERVICE_METHODS as readonly string[]).includes(value);
}

export function isFotosServiceChannel(value: string): value is FotosServiceChannel {
    return value.startsWith('fotos:')
        && isFotosServiceMethod(value.slice('fotos:'.length));
}

export function toFotosServiceChannel<M extends FotosServiceMethod>(method: M): FotosServiceChannel<M> {
    return `fotos:${method}` as FotosServiceChannel<M>;
}

export function parseFotosServiceChannel(channel: string): FotosServiceMethod | null {
    if (!isFotosServiceChannel(channel)) {
        return null;
    }

    return channel.slice('fotos:'.length) as FotosServiceMethod;
}

export function normalizeFotosServiceManagedMode(
    managed?: FotosServiceManagedMode | null,
): FotosManagedMode {
    if (managed === 'reference' || managed === 'metadata') {
        return managed;
    }

    if (managed === 'ingest' || managed === 'ingested') {
        return 'ingest';
    }

    return 'metadata';
}

export function decodeFotosServiceFaceData(
    faceData?: FotosServiceFaceData | null,
): FotosDecodedFaceData | null {
    if (!faceData || Object.keys(faceData).length === 0) {
        return null;
    }

    const result = dataAttrsToFaces(faceData);
    const count = result.faces.length;
    if (count === 0) {
        return null;
    }

    const embeddings = new Float32Array(count * EMBEDDING_DIM);
    for (let index = 0; index < count; index += 1) {
        embeddings.set(result.faces[index].embedding, index * EMBEDDING_DIM);
    }

    return {
        count,
        bboxes: result.faces.map((face) => face.detection.bbox),
        scores: result.faces.map((face) => face.detection.score),
        embeddings,
        crops: result.faces.map((face) => face.cropPath ?? ''),
    };
}

export function buildFotosBinaryUrl(
    baseUrl: string,
    kind: FotosBinaryResourceKind,
    relativePath: string,
): string {
    const trimmedBaseUrl = baseUrl.replace(/\/+$/, '');
    return `${trimmedBaseUrl}/fotos/${kind}/${encodeURIComponent(relativePath)}`;
}

export async function invokeFotosService<M extends FotosServiceMethod>(
    transport: FotosServiceTransport,
    method: M,
    params: FotosServiceParamsByMethod[M],
): Promise<FotosServiceResultByMethod[M]> {
    return await transport(
        toFotosServiceChannel(method),
        params as Record<string, unknown>,
    ) as FotosServiceResultByMethod[M];
}
