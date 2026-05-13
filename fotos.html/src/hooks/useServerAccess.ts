/**
 * Server-backed photo access hook.
 * HTTP equivalent of fotos.browser's useFolderAccess.
 * Same FolderAccess interface so useGallery works unchanged.
 *
 * Uses fotos:status/browse/ingest/pause/resume instead of fotos:scan.
 * Listens for fotos:progress WebSocket events for real-time ingestion updates.
 *
 * Supports hierarchical folder navigation via fotos:browse { folder }.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { PhotoEntry } from '@/types/fotos';
import {
    buildFotosBinaryUrl,
    decodeFotosServiceFaceData,
    decodeFotosServiceSemanticData,
    invokeFotosService,
    normalizeFotosServiceManagedMode,
} from '../../../fotos.core/src/service-contract.js';
import type {
    FotosFolderMetadata,
    FotosIngestStatus,
    FotosServiceEntry,
} from '../../../fotos.core/src/service-contract.js';
import { invoke } from '@/api/client';

export type FolderMetadata = FotosFolderMetadata;
export type IngestStatus = FotosIngestStatus;

export interface FolderAccess {
    isOpen: boolean;
    folderName: string | null;
    entries: PhotoEntry[];
    loading: boolean;
    ingestProgress: null; // kept for FotosViewerSource compat — legacy field, always null
    ingestStatus: IngestStatus | null;
    currentFolder: string;
    folderChildren: FolderMetadata[];
    openFolder: () => Promise<void>;
    startIngest: () => Promise<void>;
    pauseIngest: () => Promise<void>;
    resumeIngest: () => Promise<void>;
    rescan: () => Promise<void>;
    navigateToFolder: (path: string) => void;
    navigateUp: () => void;
    getFileUrl: (relativePath: string) => Promise<string>;
    getThumbUrl: (entry: PhotoEntry) => Promise<string | null>;
}

/**
 * Convert server entry (with raw faceData) to PhotoEntry with decoded FaceInfo.
 */
function serverEntryToPhotoEntry(raw: FotosServiceEntry): PhotoEntry {
    const decodedFaces = decodeFotosServiceFaceData(raw.faceData);
    const decodedSemantic = decodeFotosServiceSemanticData(raw.semanticData);

    const entry: PhotoEntry = {
        hash: raw.hash ?? '',
        name: raw.name ?? '',
        managed: normalizeFotosServiceManagedMode(raw.managed),
        sourcePath: raw.sourcePath,
        folderPath: raw.folderPath,
        mimeType: raw.mime,
        thumb: raw.thumb,
        tags: raw.tags ?? [],
        exif: raw.exif,
        addedAt: raw.addedAt ?? new Date().toISOString(),
        size: raw.size ?? 0,
    };

    if (decodedFaces) {
        entry.faces = {
            count: decodedFaces.count,
            bboxes: decodedFaces.bboxes,
            scores: decodedFaces.scores,
            embeddings: decodedFaces.embeddings,
            crops: decodedFaces.crops,
        };
    }

    if (decodedSemantic) {
        entry.semantic = {
            modelId: decodedSemantic.modelId,
            embedding: decodedSemantic.embedding,
        };
    } else if (raw.mime && !raw.mime.startsWith('image/')) {
        entry.semantic = null;
    }

    return entry;
}

export function useServerAccess(): FolderAccess {
    const [isOpen, setIsOpen] = useState(false);
    const [folderName, setFolderName] = useState<string | null>(null);
    const [entries, setEntries] = useState<PhotoEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [ingestStatus, setIngestStatus] = useState<IngestStatus | null>(null);
    const [currentFolder, setCurrentFolder] = useState('');
    const [folderChildren, setFolderChildren] = useState<FolderMetadata[]>([]);
    const wsRef = useRef<WebSocket | null>(null);

    // Fetch gallery entries from a specific folder via fotos:browse
    const loadGallery = useCallback(async (folder?: string) => {
        const targetFolder = folder ?? currentFolder;
        const result = await invokeFotosService(invoke, 'browse', { folder: targetFolder, limit: 200 });
        if (result.success) {
            const parsed = result.data.entries.map(serverEntryToPhotoEntry);
            const children: FolderMetadata[] = result.data.children ?? [];

            setEntries(parsed);
            setFolderChildren(children);
            setIsOpen(parsed.length > 0 || children.length > 0);
        }
        setLoading(false);
    }, [currentFolder]);

    // Check server status + load gallery
    const checkStatus = useCallback(async () => {
        const result = await invokeFotosService(invoke, 'status', {});
        if (result.success) {
            setIngestStatus(result.data);
            if (result.data.dir) {
                const parts = result.data.dir.split('/');
                setFolderName(parts[parts.length - 1]);
            }
        }
        await loadGallery('');
    }, [loadGallery]);

    // Navigate into a subfolder
    const navigateToFolder = useCallback((folderPath: string) => {
        setCurrentFolder(folderPath);
        setLoading(true);
        loadGallery(folderPath);
    }, [loadGallery]);

    // Navigate to parent folder
    const navigateUp = useCallback(() => {
        if (currentFolder === '') return;
        const segments = currentFolder.split('/');
        segments.pop();
        const parentPath = segments.join('/');
        setCurrentFolder(parentPath);
        setLoading(true);
        loadGallery(parentPath);
    }, [currentFolder, loadGallery]);

    // Start ingestion
    const startIngest = useCallback(async () => {
        const result = await invokeFotosService(invoke, 'ingest', {});
        if (result.success) setIngestStatus(result.data);
    }, []);

    // Pause ingestion
    const pauseIngest = useCallback(async () => {
        const result = await invokeFotosService(invoke, 'pause', {});
        if (result.success) setIngestStatus(result.data);
    }, []);

    // Resume ingestion
    const resumeIngest = useCallback(async () => {
        const result = await invokeFotosService(invoke, 'resume', {});
        if (result.success) setIngestStatus(result.data);
    }, []);

    // On mount: check status + load root gallery
    useEffect(() => {
        checkStatus();
    }, [checkStatus]);

    // WebSocket for fotos:progress events
    useEffect(() => {
        let ws: WebSocket | null = null;
        try {
            ws = new WebSocket(`ws://${window.location.host}/ws`);
            wsRef.current = ws;
            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'event' && data.event === 'fotos:progress') {
                        const status = data.data as IngestStatus;
                        setIngestStatus(status);
                        // Reload gallery when ingestion completes (state goes back to idle)
                        if (status.state === 'idle') {
                            loadGallery();
                        }
                    }
                } catch { /* ignore parse errors */ }
            };
            ws.onclose = () => { wsRef.current = null; };
        } catch { /* WebSocket not available */ }

        return () => { ws?.close(); };
    }, [loadGallery]);

    // Backwards compat: openFolder triggers startIngest
    const openFolder = useCallback(async () => {
        await startIngest();
    }, [startIngest]);

    const rescan = useCallback(async () => {
        await checkStatus();
    }, [checkStatus]);

    const getFileUrl = useCallback(async (relativePath: string): Promise<string> => {
        return buildFotosBinaryUrl('', 'file', relativePath);
    }, []);

    const getThumbUrl = useCallback(async (entry: PhotoEntry): Promise<string | null> => {
        if (entry.thumb) return buildFotosBinaryUrl('', 'thumb', entry.thumb);
        // No thumbnail — fall back to original file
        if (entry.sourcePath) return buildFotosBinaryUrl('', 'file', entry.sourcePath);
        return null;
    }, []);

    return {
        isOpen,
        folderName,
        entries,
        loading,
        ingestProgress: null, // legacy — always null, replaced by ingestStatus
        ingestStatus,
        currentFolder,
        folderChildren,
        openFolder,
        startIngest,
        pauseIngest,
        resumeIngest,
        rescan,
        navigateToFolder,
        navigateUp,
        getFileUrl,
        getThumbUrl,
    };
}
