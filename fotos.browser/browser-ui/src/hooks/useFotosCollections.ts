import { useCallback, useEffect, useState } from 'react';

import type { FotosModel } from '@/lib/onecore-boot';
import { FOTOS_SETTINGS_MODULE_ID } from '@/lib/fotosSettings';
import {
    EMPTY_FOTOS_LIBRARY_STATE,
    FOTOS_LIBRARY_STATE_FIELD,
    FOTOS_LIBRARY_STATE_STORAGE_KEY,
    buildFotosCollectionFromSelection,
    deserializeFotosLibraryState,
    isFotosLibraryStateEmpty,
    loadFotosLibraryState,
    normalizeFotosLibraryState,
    saveFotosLibraryState,
    serializeFotosLibraryState,
    type FotosCollectionDefinition,
    type FotosLibraryState,
} from '@/lib/fotosCollections';
import type { FaceClusterSummary } from '@/lib/cluster-gallery';
import type { PhotoEntry } from '@/types/fotos';

function readLibraryStateFromSection(values: Record<string, unknown>): FotosLibraryState {
    return deserializeFotosLibraryState(values[FOTOS_LIBRARY_STATE_FIELD]);
}

export function useFotosCollections(
    model: FotosModel | null,
    storageKey = FOTOS_LIBRARY_STATE_STORAGE_KEY,
) {
    const [libraryState, setLibraryState] = useState<FotosLibraryState>(() =>
        loadFotosLibraryState(globalThis.localStorage, storageKey),
    );

    useEffect(() => {
        if (!model?.settingsPlan) {
            return;
        }

        let cancelled = false;

        const applyState = (nextState: FotosLibraryState) => {
            if (cancelled) {
                return;
            }

            saveFotosLibraryState(nextState, globalThis.localStorage, storageKey);
            setLibraryState(nextState);
        };

        const syncState = async () => {
            try {
                const { values } = await model.settingsPlan.getSection({
                    moduleId: FOTOS_SETTINGS_MODULE_ID,
                });
                const remoteState = readLibraryStateFromSection(values);
                const localState = loadFotosLibraryState(globalThis.localStorage, storageKey);

                if (isFotosLibraryStateEmpty(remoteState) && !isFotosLibraryStateEmpty(localState)) {
                    await model.settingsPlan.updateSection({
                        moduleId: FOTOS_SETTINGS_MODULE_ID,
                        values: {
                            [FOTOS_LIBRARY_STATE_FIELD]: serializeFotosLibraryState(localState),
                        },
                    });
                    applyState(localState);
                    return;
                }

                applyState(remoteState);
            } catch (error) {
                console.warn('[fotos.collections] Failed to load library state from SettingsPlan:', error);
            }
        };

        void syncState();

        const unsubscribe = model.settingsPlan.subscribe((allSettings: Record<string, unknown>) => {
            const section = allSettings[FOTOS_SETTINGS_MODULE_ID];
            if (typeof section !== 'object' || section === null) {
                applyState({ ...EMPTY_FOTOS_LIBRARY_STATE });
                return;
            }

            applyState(readLibraryStateFromSection(section as Record<string, unknown>));
        });

        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, [model?.settingsPlan, storageKey]);

    const persist = useCallback((updater: (current: FotosLibraryState) => FotosLibraryState) => {
        setLibraryState(currentState => {
            const nextState = normalizeFotosLibraryState(updater(currentState));
            saveFotosLibraryState(nextState, globalThis.localStorage, storageKey);

            if (model?.settingsPlan) {
                void model.settingsPlan.updateSection({
                    moduleId: FOTOS_SETTINGS_MODULE_ID,
                    values: {
                        [FOTOS_LIBRARY_STATE_FIELD]: serializeFotosLibraryState(nextState),
                    },
                }).catch((error: unknown) => {
                    console.warn('[fotos.collections] Failed to persist library state via SettingsPlan:', error);
                });
            }

            return nextState;
        });
    }, [model?.settingsPlan, storageKey]);

    const createCollection = useCallback((
        name: string,
        selectedPhotos: readonly PhotoEntry[],
        selectedClusters: readonly FaceClusterSummary[],
    ): FotosCollectionDefinition => {
        const nextCollection = buildFotosCollectionFromSelection(
            name,
            selectedPhotos,
            selectedClusters,
            libraryState.collections.length,
        );

        persist(currentState => ({
            ...currentState,
            collections: [nextCollection, ...currentState.collections],
        }));

        return nextCollection;
    }, [libraryState.collections.length, persist]);

    const renameCollection = useCallback((collectionId: string, name: string) => {
        const trimmedName = name.trim();
        if (!trimmedName) {
            return;
        }

        persist(currentState => ({
            ...currentState,
            collections: currentState.collections.map(collection => (
                collection.id === collectionId
                    ? {
                        ...collection,
                        name: trimmedName,
                        updatedAt: new Date().toISOString(),
                    }
                    : collection
            )),
        }));
    }, [persist]);

    const deleteCollection = useCallback((collectionId: string) => {
        persist(currentState => {
            const nextCollectionShares = { ...currentState.sharing.collectionPersonIds };
            delete nextCollectionShares[collectionId];

            return {
                ...currentState,
                collections: currentState.collections.filter(collection => collection.id !== collectionId),
                sharing: {
                    ...currentState.sharing,
                    collectionPersonIds: nextCollectionShares,
                },
            };
        });
    }, [persist]);

    const setGallerySharePersonIds = useCallback((personIds: readonly string[]) => {
        persist(currentState => ({
            ...currentState,
            sharing: {
                ...currentState.sharing,
                galleryPersonIds: [...personIds],
            },
        }));
    }, [persist]);

    const setCollectionSharePersonIds = useCallback((collectionId: string, personIds: readonly string[]) => {
        persist(currentState => ({
            ...currentState,
            sharing: {
                ...currentState.sharing,
                collectionPersonIds: {
                    ...currentState.sharing.collectionPersonIds,
                    [collectionId]: [...personIds],
                },
            },
        }));
    }, [persist]);

    const setClusterSharePersonIds = useCallback((clusterId: string, personIds: readonly string[]) => {
        persist(currentState => ({
            ...currentState,
            sharing: {
                ...currentState.sharing,
                clusterPersonIds: {
                    ...currentState.sharing.clusterPersonIds,
                    [clusterId]: [...personIds],
                },
            },
        }));
    }, [persist]);

    return {
        libraryState,
        collections: libraryState.collections,
        sharing: libraryState.sharing,
        createCollection,
        renameCollection,
        deleteCollection,
        setGallerySharePersonIds,
        setCollectionSharePersonIds,
        setClusterSharePersonIds,
    };
}
