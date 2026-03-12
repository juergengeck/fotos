/**
 * Server-backed photo access hook.
 * HTTP equivalent of fotos.browser's useFolderAccess.
 * Same FolderAccess interface so useGallery works unchanged.
 */

import { useState, useCallback, useEffect } from 'react';
import type { PhotoEntry } from '@/types/fotos';
import { dataAttrsToFaces, EMBEDDING_DIM } from '@refinio/fotos.core';
import { invoke } from '@/api/client';

export interface IngestProgress {
    phase: 'scanning' | 'processing' | 'writing' | 'done';
    current: number;
    total: number;
    fileName?: string;
}

export interface FolderAccess {
    isOpen: boolean;
    folderName: string | null;
    entries: PhotoEntry[];
    loading: boolean;
    ingestProgress: IngestProgress | null;
    openFolder: () => Promise<void>;
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
    const [loading, setLoading] = useState(false);
    const [ingestProgress, setIngestProgress] = useState<IngestProgress | null>(null);

    const scan = useCallback(async () => {
        setLoading(true);
        const result = await invoke('fotos:scan');
        if (result?.success && result.data?.entries) {
            const parsed = result.data.entries.map(serverEntryToPhotoEntry);
            setEntries(parsed);
            setIsOpen(parsed.length > 0);
            // Extract folder name from dir path
            if (result.data.dir) {
                const parts = result.data.dir.split('/');
                setFolderName(parts[parts.length - 1]);
            }
        }
        setLoading(false);
    }, []);

    // Auto-scan on mount
    useEffect(() => {
        scan();
    }, [scan]);

    // Listen for WebSocket progress events
    useEffect(() => {
        let ws: WebSocket | null = null;
        try {
            ws = new WebSocket(`ws://${window.location.host}/ws`);
            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'event' && data.event === 'fotos:progress') {
                        const progress = data.data as IngestProgress;
                        setIngestProgress(progress.phase === 'done' ? null : progress);
                        if (progress.phase === 'done') {
                            // Re-scan after ingestion completes
                            scan();
                        }
                    }
                } catch { /* ignore parse errors */ }
            };
            ws.onclose = () => { ws = null; };
        } catch { /* WebSocket not available */ }

        return () => { ws?.close(); };
    }, [scan]);

    const openFolder = useCallback(async () => {
        // On server mode, just rescan
        await scan();
    }, [scan]);

    const rescan = useCallback(async () => {
        await scan();
    }, [scan]);

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
        ingestProgress,
        openFolder,
        rescan,
        getFileUrl,
        getThumbUrl,
    };
}
