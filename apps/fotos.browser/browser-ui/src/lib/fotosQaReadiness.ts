export type FotosQaReadinessCollection = {
    photoHashes: readonly string[];
    matchedPhotoHashes: readonly string[];
};

/** Require the owning photo source and every explicit collection member to be hydrated. */
export function isFotosQaSurfaceReady(params: {
    modelInitialized: boolean;
    sourceInitializationComplete: boolean;
    collections: readonly FotosQaReadinessCollection[];
}): boolean {
    if (!params.modelInitialized || !params.sourceInitializationComplete) return false;
    return params.collections.every(collection => {
        const matched = new Set(collection.matchedPhotoHashes);
        return collection.photoHashes.every(hash => matched.has(hash));
    });
}
