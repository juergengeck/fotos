import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {AppState} from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import type {ModelType} from '..';
import {getFotosPhotoKit, type FotosPhotoKitAsset} from '../services/FotosPhotoKit';
import {getFotosFaceNames, readFotosMobileFaceDetections} from '../services/FotosMobileFaces';
import {
    emptyFotosGallery, mergeFotosMobileGallery, observeFotosMobileGallery, readFotosMobileGallery, type FotosGalleryLibrary,
} from '../services/FotosMobileGallery';

const PAGE_SIZE = 90;

export function useFotosGalleryEntries(model: ModelType) {
    const [library, setLibrary] = useState(emptyFotosGallery);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string>();
    const refresh = useRef<() => void>(() => {});
    useEffect(() => {
        let disposed = false;
        let pending = false;
        let running = false;
        let shareRevision = 0;
        const load = async () => {
            if (running) {
                pending = true;
                return;
            }
            running = true;
            const revision = shareRevision;
            try {
                const next = await readFotosMobileGallery(model);
                if (!disposed) {
                    setLibrary(revision === shareRevision ? next : {...next, shared: []});
                    setError(undefined);
                }
            } catch (reason) {
                if (!disposed) {
                    setLibrary(emptyFotosGallery);
                    setError(reason instanceof Error ? reason.message : String(reason));
                }
            } finally {
                running = false;
                if (!disposed) setLoading(false);
                if (pending && !disposed) {
                    pending = false;
                    void load();
                }
            }
        };
        refresh.current = () => void load();
        const invalidateShared = () => {
            shareRevision++;
            setLibrary(current => current.shared.length ? {...current, shared: []} : current);
            void load();
        };
        const stop = observeFotosMobileGallery(refresh.current, invalidateShared);
        const trust = model.leuteModel.trust;
        const stopKeys = trust.onTrustedKeysChanged.listen(invalidateShared);
        const stopRights = trust.onPersonRightsChanged.listen(invalidateShared);
        void load();
        return () => {
            disposed = true;
            stop();
            stopKeys();
            stopRights();
        };
    }, [model]);
    return {library, loading, error, refresh: useCallback(() => refresh.current(), [])};
}

function useGalleryPeople(library: FotosGalleryLibrary, enabled: boolean) {
    const [snapshot, setSnapshot] = useState<{library: FotosGalleryLibrary; names: ReadonlyMap<string, string[]>}>();
    useEffect(() => {
        if (!enabled) return;
        let disposed = false;
        const entries = new Map([...library.shared, ...library.owned]
            .filter(entry => Boolean(entry.faceCount && entry.variants?.size)).map(entry => [entry.contentHash, entry]));
        const scan = async () => {
            const candidates = [...entries.values()];
            const names = new Map<string, string[]>();
            for (let index = 0; index < candidates.length && !disposed; index += 8) {
                await Promise.all(candidates.slice(index, index + 8).map(async entry => {
                    const detections = await readFotosMobileFaceDetections(entry).catch(() => undefined);
                    const labels = getFotosFaceNames(detections);
                    if (labels.length) names.set(entry.contentHash, labels);
                }));
            }
            if (!disposed) setSnapshot({library, names});
        };
        void scan();
        return () => { disposed = true; };
    }, [library, enabled]);
    return enabled && snapshot?.library === library ? snapshot.names : undefined;
}

export function useFotosMobileGallery(model: ModelType, searchPeople: boolean) {
    const {library, loading: loadingEntries, error: entryError, refresh} = useFotosGalleryEntries(model);
    const people = useGalleryPeople(library, searchPeople);
    const supportsPhotos = model.platformCapabilities.supportsPhotoLibrarySync;
    const [assets, setAssets] = useState<FotosPhotoKitAsset[]>([]);
    const [permission, setPermission] = useState<MediaLibrary.PermissionResponse>();
    const [localError, setLocalError] = useState<string>();
    const [loadingPhotos, setLoadingPhotos] = useState(false);
    const [canLoadMore, setCanLoadMore] = useState(false);
    const [revision, setRevision] = useState(0);
    const nextPage = useRef<() => void>(() => {});
    const requestPermission = useCallback(async () => {
        try {
            await MediaLibrary.requestPermissionsAsync(false, ['photo', 'video']);
            setRevision(value => value + 1);
        } catch (reason) {
            setLocalError(reason instanceof Error ? reason.message : String(reason));
        }
    }, []);

    useEffect(() => {
        if (!supportsPhotos) return;
        const session = AppState.addEventListener('change', state => {
            if (state === 'active') {
                setRevision(value => value + 1);
                refresh();
            }
        });
        return () => session.remove();
    }, [supportsPhotos, refresh]);

    useEffect(() => {
        if (!supportsPhotos) return;
        let disposed = false;
        let inFlight = false;
        let offset: number | undefined = 0;
        let cursor: string | undefined;
        let native: ReturnType<typeof getFotosPhotoKit> | undefined;
        let subscription: ReturnType<NonNullable<typeof native>['addListener']> | undefined;
        const load = async () => {
            if (disposed || inFlight || offset === undefined) return;
            inFlight = true;
            setLoadingPhotos(true);
            try {
                if (!native) {
                    const access = await MediaLibrary.getPermissionsAsync(false, ['photo', 'video']);
                    if (disposed) return;
                    setPermission(access);
                    if (!access.granted) {
                        setAssets([]);
                        setCanLoadMore(false);
                        return;
                    }
                    native = getFotosPhotoKit();
                    subscription = native.addListener('onLibraryChange', () => setRevision(value => value + 1));
                }
                const first = offset === 0;
                const page = await native.listAssets(offset, PAGE_SIZE, cursor);
                if (disposed) {
                    if (page.cursor) await native.releaseCursor(page.cursor);
                    return;
                }
                cursor = page.cursor;
                offset = page.nextOffset;
                setAssets(previous => first ? page.assets : previous.concat(page.assets));
                setCanLoadMore(offset !== undefined);
                setLocalError(undefined);
            } catch (reason) {
                if (!disposed) setLocalError(reason instanceof Error ? reason.message : String(reason));
            } finally {
                inFlight = false;
                if (!disposed) setLoadingPhotos(false);
            }
        };
        nextPage.current = () => void load();
        void load();
        return () => {
            disposed = true;
            subscription?.remove();
            if (cursor) void native?.releaseCursor(cursor);
        };
    }, [supportsPhotos, revision]);

    const items = useMemo(() => mergeFotosMobileGallery(assets, library), [assets, library]);
    const reload = useCallback(() => {
        refresh();
        setRevision(value => value + 1);
    }, [refresh]);
    return {
        items, people, loadingEntries, loadingPhotos, entryError, localError, supportsPhotos, permission, canLoadMore,
        reload, requestPermission, loadMore: useCallback(() => nextPage.current(), []),
    };
}
