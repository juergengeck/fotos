/**
 * Server-backed photo access hook.
 * HTTP equivalent of fotos.browser's useFolderAccess.
 * Same FolderAccess interface so useGallery works unchanged.
 *
 * Uses fotos:status/browse/ingest/pause/resume instead of fotos:scan.
 * Listens for fotos:progress WebSocket events for real-time ingestion updates.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { PhotoEntry } from '@/types/fotos';
import { dataAttrsToFaces, EMBEDDING_DIM } from '@refinio/fotos.core/faces';
import { invoke } from '@/api/client';

export interface IngestStatus {
    state: 'idle' | 'running' | 'paused';
    currentFolder?: string;
    folderIndex: number;
    totalFolders: number;
    photoIndex: number;
    photosInFolder: number;
    totalProcessed: number;
    totalFound: number;
    trieCount?: number;
    dir?: string;
}

export interface FolderAccess {
    isOpen: boolean;
    folderName: string | null;
    entries: PhotoEntry[];
    loading: boolean;
    ingestProgress: null; // kept for FotosViewerSource compat — legacy field, always null
    ingestStatus: IngestStatus | null;
    openFolder: () => Promise<void>;
    startIngest: () => Promise<void>;
    pauseIngest: () => Promise<void>;
    resumeIngest: () => Promise<void>;
    rescan: () => Promise<void>;
    getFileUrl: (relativePath: string) => Promise<string>;
    getThumbUrl: (entry: PhotoEntry) => Promise<string | null>;
}

/**
 * Convert server entry (with raw faceData) to PhotoEntry with decoded FaceInfo.
 */
function serverEntryToPhotoEntry(raw: any): PhotoEntry {
    const entry: PhotoEntry = {
        hash: raw.hash ?? '',
        name: raw.name ?? '',
        managed: raw.managed ?? 'metadata',
        sourcePath: raw.sourcePath,
        thumb: raw.thumb,
        tags: raw.tags ?? [],
        exif: raw.exif,
        addedAt: raw.addedAt ?? new Date().toISOString(),
        size: raw.size ?? 0,
    };

    // Decode face data from raw data-* attribute map
    if (raw.faceData) {
        const result = dataAttrsToFaces(raw.faceData);
        const count = result.faces.length;
        if (count > 0) {
            const flat = new Float32Array(count * EMBEDDING_DIM);
            for (let i = 0; i < count; i++) flat.set(result.faces[i].embedding, i * EMBEDDING_DIM);

            entry.faces = {
                count,
                bboxes: result.faces.map(f => f.detection.bbox),
                scores: result.faces.map(f => f.detection.score),
                embeddings: flat,
                crops: result.faces.map(f => f.cropPath ?? ''),
            };
        }
    }

    return entry;
}

export function useServerAccess(): FolderAccess {
    const [isOpen, setIsOpen] = useState(false);
    const [folderName, setFolderName] = useState<string | null>(null);
    const [entries, setEntries] = useState<PhotoEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [ingestStatus, setIngestStatus] = useState<IngestStatus | null>(null);
    const wsRef = useRef<WebSocket | null>(null);

    // Fetch gallery entries from trie via fotos:browse
    const loadGallery = useCallback(async () => {
        const result = await invoke('fotos:browse', {});
        if (result?.success && result.data?.entries) {
            const parsed = result.data.entries.map(serverEntryToPhotoEntry);
            setEntries(parsed);
            setIsOpen(parsed.length > 0);
        }
        setLoading(false);
    }, []);

    // Check server status + load gallery
    const checkStatus = useCallback(async () => {
        const result = await invoke('fotos:status');
        if (result?.success) {
            setIngestStatus(result.data);
            if (result.data.dir) {
                const parts = result.data.dir.split('/');
                setFolderName(parts[parts.length - 1]);
            }
        }
        await loadGallery();
    }, [loadGallery]);

    // Start ingestion
    const startIngest = useCallback(async () => {
        const result = await invoke('fotos:ingest');
        if (result?.success) setIngestStatus(result.data);
    }, []);

    // Pause ingestion
    const pauseIngest = useCallback(async () => {
        const result = await invoke('fotos:pause');
        if (result?.success) setIngestStatus(result.data);
    }, []);

    // Resume ingestion
    const resumeIngest = useCallback(async () => {
        const result = await invoke('fotos:resume');
        if (result?.success) setIngestStatus(result.data);
    }, []);

    // On mount: check status + load gallery
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
                        if (status.state === 'idle' && status.totalProcessed > 0) {
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
        return `/fotos/file/${encodeURIComponent(relativePath)}`;
    }, []);

    const getThumbUrl = useCallback(async (entry: PhotoEntry): Promise<string | null> => {
        if (!entry.thumb) return null;
        return `/fotos/thumb/${encodeURIComponent(entry.thumb)}`;
    }, []);

    return {
        isOpen,
        folderName,
        entries,
        loading,
        ingestProgress: null, // legacy — always null, replaced by ingestStatus
        ingestStatus,
        openFolder,
        startIngest,
        pauseIngest,
        resumeIngest,
        rescan,
        getFileUrl,
        getThumbUrl,
    };
}
