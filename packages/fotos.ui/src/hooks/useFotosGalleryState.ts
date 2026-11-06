import {useCallback, useEffect, useMemo, useState} from 'react';
import type {PhotoEntry, SemanticInfo} from '../types/fotos.js';
import {
    collectTagCounts,
    filterGalleryPhotos,
    flattenDayGroups,
    groupPhotosByDay,
    type DayGroup,
} from '../lib/gallery.js';

export interface GalleryAccessSource<TPhoto extends PhotoEntry = PhotoEntry> {
    entries: TPhoto[];
    loading: boolean;
    folderName: string | null;
    rescan: () => void | Promise<void>;
}

export interface UseFotosGalleryStateOptions<TPhoto extends PhotoEntry = PhotoEntry> {
    source: GalleryAccessSource<TPhoto>;
    resolveDayGroups?: (photos: TPhoto[]) => Promise<Array<DayGroup<TPhoto>>> | Array<DayGroup<TPhoto>>;
    addPhoto?: (entry: TPhoto) => void;
    deletePhoto?: (hash: string) => void;
    tagPhoto?: (hash: string, tag: string) => void;
    untagPhoto?: (hash: string, tag: string) => void;
}

export function useFotosGalleryState<TPhoto extends PhotoEntry = PhotoEntry>({
    source,
    resolveDayGroups,
    addPhoto,
    deletePhoto,
    tagPhoto,
    untagPhoto,
}: UseFotosGalleryStateOptions<TPhoto>) {
    const [activeTag, setActiveTag] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
    const [searchFace, setSearchFace] = useState<Float32Array | null>(null);
    const [searchEmbedding, setSearchEmbedding] = useState<SemanticInfo | null>(null);
    const [resolvedDayGroups, setResolvedDayGroups] = useState<Array<DayGroup<TPhoto>> | null>(null);

    const photos = source.entries;
    const tags = useMemo(() => collectTagCounts(photos), [photos]);
    const filtered = useMemo(() => filterGalleryPhotos(photos, {
        activeTag,
        searchQuery,
        searchFace,
        searchEmbedding,
    }) as TPhoto[], [photos, activeTag, searchQuery, searchFace, searchEmbedding]);
    const fallbackDayGroups = useMemo(
        () => groupPhotosByDay(filtered) as Array<DayGroup<TPhoto>>,
        [filtered]
    );

    useEffect(() => {
        if (!resolveDayGroups) {
            setResolvedDayGroups(null);
            return;
        }

        if (filtered.length === 0) {
            setResolvedDayGroups([]);
            return;
        }

        let cancelled = false;
        setResolvedDayGroups(null);

        void Promise.resolve(resolveDayGroups(filtered))
            .then(groups => {
                if (!cancelled) {
                    setResolvedDayGroups(groups);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setResolvedDayGroups(null);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [filtered, resolveDayGroups]);

    const dayGroups = resolvedDayGroups ?? fallbackDayGroups;
    const orderedPhotos = useMemo(() => flattenDayGroups(dayGroups), [dayGroups]);

    const handleAddPhoto = useCallback((entry: TPhoto) => {
        if (addPhoto) {
            addPhoto(entry);
            return;
        }

        void source.rescan();
    }, [addPhoto, source]);

    const handleDeletePhoto = useCallback((hash: string) => {
        deletePhoto?.(hash);
    }, [deletePhoto]);

    const handleTagPhoto = useCallback((hash: string, tag: string) => {
        tagPhoto?.(hash, tag);
    }, [tagPhoto]);

    const handleUntagPhoto = useCallback((hash: string, tag: string) => {
        untagPhoto?.(hash, tag);
    }, [untagPhoto]);

    return {
        photos: orderedPhotos,
        dayGroups,
        totalCount: photos.length,
        tags,
        activeTag,
        setActiveTag,
        searchQuery,
        setSearchQuery,
        searchFace,
        setSearchFace,
        searchEmbedding,
        setSearchEmbedding,
        selectedIndex,
        setSelectedIndex,
        addPhoto: handleAddPhoto,
        deletePhoto: handleDeletePhoto,
        tagPhoto: handleTagPhoto,
        untagPhoto: handleUntagPhoto,
        loading: source.loading,
        catalogName: source.folderName,
        syncRoot: null,
    };
}
