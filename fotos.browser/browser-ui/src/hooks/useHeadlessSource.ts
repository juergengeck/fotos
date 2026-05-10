import { useState, useCallback, useRef, useEffect } from 'react';
import { getGallerySurfaceProfile, planGalleryIntake } from '@refinio/fotos.core';
import type { GallerySurface } from '@refinio/fotos.core';
import {
    buildFotosBinaryUrl,
    decodeFotosServiceFaceData,
    invokeFotosService,
    normalizeFotosServiceManagedMode,
} from '../../../../fotos.core/src/service-contract.js';
import type {
    FotosServiceChannel,
    FotosServiceEntry,
} from '../../../../fotos.core/src/service-contract.js';
import type { PhotoEntry } from '@/types/fotos';
import type { FolderAccess } from './useFolderAccess';

// ── Headless API helper ──────────────────────────────────────────────

async function invoke(
    headlessUrl: string,
    channel: FotosServiceChannel,
    params: Record<string, unknown> = {},
) {
    const res = await fetch(`${headlessUrl}/api/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, params }),
    });
    return res.json();
}

function serviceEntryToPhotoEntry(raw: FotosServiceEntry): PhotoEntry {
    const decodedFaces = decodeFotosServiceFaceData(raw.faceData);

    return {
        hash: raw.hash ?? raw.streamId ?? raw.contentHash ?? '',
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
        faces: decodedFaces ? {
            count: decodedFaces.count,
            bboxes: decodedFaces.bboxes,
            scores: decodedFaces.scores,
            embeddings: decodedFaces.embeddings,
            crops: decodedFaces.crops,
        } : undefined,
    };
}

// ── Hook ─────────────────────────────────────────────────────────────

/**
 * Provides the same FolderAccess interface backed by a headless VGER server
 * instead of the local filesystem.
 */
export function useHeadlessSource(headlessUrl: string | null): FolderAccess {
    const [isOpen, setIsOpen] = useState(false);
    const [folderName, setFolderName] = useState<string | null>(null);
    const [entries, setEntries] = useState<PhotoEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [claimAuthorshipOnIngest, setClaimAuthorshipOnIngest] = useState(true);
    const urlCacheRef = useRef<Map<string, string>>(new Map());
    const headlessUrlRef = useRef(headlessUrl);
    headlessUrlRef.current = headlessUrl;

    const surface: GallerySurface = 'fotos-browser-desktop';
    const surfaceProfile = getGallerySurfaceProfile(surface);
    const defaultIntakePlan = planGalleryIntake(surface, surfaceProfile.defaultSource);
    const shareIntakePlan = planGalleryIntake(surface, 'shared-files');

    // Cleanup cached object URLs on unmount
    useEffect(() => {
        return () => {
            for (const url of urlCacheRef.current.values()) {
                URL.revokeObjectURL(url);
            }
            urlCacheRef.current.clear();
        };
    }, []);

    // Fetch entries when headlessUrl changes
    useEffect(() => {
        if (!headlessUrl) {
            setIsOpen(false);
            setFolderName(null);
            setEntries([]);
            return;
        }

        let cancelled = false;
        void (async () => {
            setLoading(true);
            try {
                const [browseResult, statusResult] = await Promise.all([
                    invokeFotosService(
                        (channel, params) => invoke(headlessUrl, channel, params),
                        'browse',
                        { limit: 500 },
                    ),
                    invokeFotosService(
                        (channel, params) => invoke(headlessUrl, channel, params),
                        'status',
                        {},
                    ),
                ]);

                if (cancelled) return;

                const photos = browseResult.success
                    ? browseResult.data.entries.map(serviceEntryToPhotoEntry)
                    : [];
                const name: string = statusResult.success
                    ? statusResult.data.folderName
                        ?? statusResult.data.dir?.split('/').filter(Boolean).pop()
                        ?? new URL(headlessUrl).hostname
                    : new URL(headlessUrl).hostname;

                setEntries(photos);
                setFolderName(name);
                setIsOpen(browseResult.success || statusResult.success);
            } catch (err) {
                console.error('[useHeadlessSource] Failed to fetch entries:', err);
                if (!cancelled) {
                    setIsOpen(false);
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [headlessUrl]);

    const rescan = useCallback(async () => {
        const url = headlessUrlRef.current;
        if (!url) return;

        setLoading(true);
        try {
            const result = await invokeFotosService(
                (channel, params) => invoke(url, channel, params),
                'browse',
                { limit: 500 },
            );
            if (result.success) {
                setEntries(result.data.entries.map(serviceEntryToPhotoEntry));
            }
        } catch (err) {
            console.error('[useHeadlessSource] Rescan failed:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    const getThumbUrl = useCallback(async (entry: PhotoEntry): Promise<string | null> => {
        const url = headlessUrlRef.current;
        if (!url) return null;

        const cacheKey = `thumb:${entry.thumb ?? entry.sourcePath}`;
        const cached = urlCacheRef.current.get(cacheKey);
        if (cached) return cached;

        const endpoint = entry.thumb
            ? buildFotosBinaryUrl(url, 'thumb', entry.thumb)
            : entry.sourcePath
                ? buildFotosBinaryUrl(url, 'file', entry.sourcePath)
                : null;
        if (!endpoint) return null;

        try {
            const res = await fetch(endpoint);
            if (!res.ok) return null;
            const blob = await res.blob();
            const objectUrl = URL.createObjectURL(blob);
            urlCacheRef.current.set(cacheKey, objectUrl);
            return objectUrl;
        } catch {
            return null;
        }
    }, []);

    const getFileUrl = useCallback(async (relativePath: string): Promise<string> => {
        const url = headlessUrlRef.current;
        if (!url) throw new Error('Not connected to headless server');

        const cacheKey = `file:${relativePath}`;
        const cached = urlCacheRef.current.get(cacheKey);
        if (cached) return cached;

        const res = await fetch(buildFotosBinaryUrl(url, 'file', relativePath));
        if (!res.ok) throw new Error(`Failed to fetch file: ${res.status}`);
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        urlCacheRef.current.set(cacheKey, objectUrl);
        return objectUrl;
    }, []);

    const readFile = useCallback(async (relativePath: string): Promise<File> => {
        const url = headlessUrlRef.current;
        if (!url) throw new Error('Not connected to headless server');

        const res = await fetch(buildFotosBinaryUrl(url, 'file', relativePath));
        if (!res.ok) throw new Error(`Failed to fetch file: ${res.status}`);
        const blob = await res.blob();
        const fileName = relativePath.split('/').pop() ?? 'unknown';
        return new File([blob], fileName, { type: blob.type });
    }, []);

    // Stubs for face operations — headless handles these server-side
    const openFolder = useCallback(() => {
        // No-op: already connected to headless
    }, []);

    const openLocalFiles = useCallback(() => false, []);

    const reanalyzeFaces = useCallback(async () => {
        // Future: trigger server-side face analysis
    }, []);

    const ensureSemanticEmbeddings = useCallback(async () => {
        // Future: trigger server-side semantic embedding
    }, []);

    const renameFace = useCallback(async (_clusterId: string, _name: string) => {
        // Future: POST to headless
    }, []);

    const deleteFace = useCallback(async (_clusterId: string) => {
        // Future: POST to headless
    }, []);

    const associateFaceWithCluster = useCallback(async (_photoHash: string, _faceIndex: number, _clusterId: string) => {
        // Future: POST to headless
    }, []);

    const mergeFaceClusters = useCallback(async (_targetClusterId: string, _sourceClusterIds: string[]) => {
        // Future: POST to headless
    }, []);

    const groupFaceClustersAsPerson = useCallback(async (_clusterIds: string[]) => {
        // Future: POST to headless
    }, []);

    const separatePersonGroup = useCallback(async (_personId: string) => {
        // Future: POST to headless
    }, []);

    return {
        isOpen,
        surface,
        surfaceProfile,
        defaultIntakePlan,
        shareIntakePlan,
        folderName,
        entries,
        loading,
        ingestProgress: null,
        pendingImportCount: 0,
        mobile: false,
        canClaimAuthorshipOnIngest: false,
        claimAuthorshipOnIngest,
        setClaimAuthorshipOnIngest,
        openFolder,
        openLocalFiles,
        rescan,
        reanalyzeFaces,
        ensureSemanticEmbeddings,
        getFileUrl,
        getThumbUrl,
        readFile,
        renameFace,
        deleteFace,
        associateFaceWithCluster,
        mergeFaceClusters,
        groupFaceClustersAsPerson,
        separatePersonGroup,
    };
}
