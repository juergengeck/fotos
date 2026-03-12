export type GallerySurface =
    | 'one.fotos'
    | 'fotos-browser-desktop'
    | 'fotos-browser-mobile'
    | 'lama-fire';

export type GallerySurfaceRole = 'authority' | 'attach' | 'consumer';

export type GallerySourceKind =
    | 'filesystem'
    | 'photo-library'
    | 'shared-files'
    | 'bundle'
    | 'remote-manifest';

export type GalleryIntakeMode =
    | 'attach-library'
    | 'capture-selection'
    | 'import-bundle'
    | 'consume-feed';

export type FaceEnrichmentMode = 'local' | 'remote' | 'none';

export interface GallerySurfaceProfile {
    surface: GallerySurface;
    role: GallerySurfaceRole;
    defaultSource: GallerySourceKind;
    writesSidecars: boolean;
    runsFaceEnrichment: boolean;
    supportsShareTarget: boolean;
    summary: string;
    primaryActionLabel: string;
}

export interface GallerySourceCapabilities {
    kind: GallerySourceKind;
    canEnumerateLibrary: boolean;
    canReadOriginals: boolean;
    canWriteMetadataInPlace: boolean;
    portable: boolean;
}

export interface GalleryIntakePlan {
    surface: GallerySurface;
    source: GallerySourceKind;
    supported: boolean;
    mode?: GalleryIntakeMode;
    writesSidecars: boolean;
    faceEnrichment: FaceEnrichmentMode;
    actionLabel: string;
    summary: string;
    reason?: string;
}

export function getGallerySourceCapabilities(source: GallerySourceKind): GallerySourceCapabilities {
    switch (source) {
    case 'filesystem':
        return {
            kind: source,
            canEnumerateLibrary: true,
            canReadOriginals: true,
            canWriteMetadataInPlace: true,
            portable: false,
        };
    case 'photo-library':
        return {
            kind: source,
            canEnumerateLibrary: false,
            canReadOriginals: true,
            canWriteMetadataInPlace: false,
            portable: false,
        };
    case 'shared-files':
        return {
            kind: source,
            canEnumerateLibrary: false,
            canReadOriginals: true,
            canWriteMetadataInPlace: false,
            portable: false,
        };
    case 'bundle':
        return {
            kind: source,
            canEnumerateLibrary: true,
            canReadOriginals: true,
            canWriteMetadataInPlace: false,
            portable: true,
        };
    case 'remote-manifest':
        return {
            kind: source,
            canEnumerateLibrary: true,
            canReadOriginals: false,
            canWriteMetadataInPlace: false,
            portable: false,
        };
    }
}

export function getGallerySurfaceProfile(surface: GallerySurface): GallerySurfaceProfile {
    switch (surface) {
    case 'one.fotos':
        return {
            surface,
            role: 'authority',
            defaultSource: 'filesystem',
            writesSidecars: true,
            runsFaceEnrichment: true,
            supportsShareTarget: false,
            summary: 'Authoritative ingest surface for writable libraries and repair.',
            primaryActionLabel: 'ingest library',
        };
    case 'fotos-browser-desktop':
        return {
            surface,
            role: 'attach',
            defaultSource: 'filesystem',
            writesSidecars: true,
            runsFaceEnrichment: true,
            supportsShareTarget: false,
            summary: 'Open a photo folder and materialize metadata in place.',
            primaryActionLabel: 'Open photo folder',
        };
    case 'fotos-browser-mobile':
        return {
            surface,
            role: 'attach',
            defaultSource: 'photo-library',
            writesSidecars: false,
            runsFaceEnrichment: false,
            supportsShareTarget: true,
            summary: 'Capture a lightweight photo selection and let desktop enrich later.',
            primaryActionLabel: 'select photos',
        };
    case 'lama-fire':
        return {
            surface,
            role: 'consumer',
            defaultSource: 'remote-manifest',
            writesSidecars: false,
            runsFaceEnrichment: false,
            supportsShareTarget: false,
            summary: 'Consume shared gallery feeds only.',
            primaryActionLabel: 'browse shared gallery',
        };
    }
}

function unsupportedPlan(
    surface: GallerySurface,
    source: GallerySourceKind,
    actionLabel: string,
    reason: string
): GalleryIntakePlan {
    return {
        surface,
        source,
        supported: false,
        writesSidecars: false,
        faceEnrichment: 'none',
        actionLabel,
        summary: reason,
        reason,
    };
}

export function planGalleryIntake(
    surface: GallerySurface,
    source: GallerySourceKind
): GalleryIntakePlan {
    const profile = getGallerySurfaceProfile(surface);
    const sourceCapabilities = getGallerySourceCapabilities(source);

    switch (surface) {
    case 'one.fotos':
        if (source === 'filesystem') {
            return {
                surface,
                source,
                supported: true,
                mode: 'attach-library',
                writesSidecars: true,
                faceEnrichment: 'local',
                actionLabel: 'ingest library',
                summary: 'Scan the library, write sidecars, and enrich media locally.',
            };
        }
        if (source === 'bundle') {
            return {
                surface,
                source,
                supported: true,
                mode: 'import-bundle',
                writesSidecars: true,
                faceEnrichment: 'local',
                actionLabel: 'import gallery bundle',
                summary: 'Adopt a portable gallery bundle into a writable library.',
            };
        }
        return unsupportedPlan(
            surface,
            source,
            profile.primaryActionLabel,
            'one.fotos only ingests writable libraries or portable bundles.'
        );

    case 'fotos-browser-desktop':
        if (source === 'filesystem') {
            return {
                surface,
                source,
                supported: true,
                mode: 'attach-library',
                writesSidecars: sourceCapabilities.canWriteMetadataInPlace,
                faceEnrichment: 'local',
                actionLabel: profile.primaryActionLabel,
                summary: 'Open a photo folder and materialize gallery metadata in place.',
            };
        }
        if (source === 'bundle') {
            return {
                surface,
                source,
                supported: true,
                mode: 'import-bundle',
                writesSidecars: false,
                faceEnrichment: 'local',
                actionLabel: 'import gallery bundle',
                summary: 'Open a portable gallery bundle and enrich it on desktop.',
            };
        }
        return unsupportedPlan(
            surface,
            source,
            profile.primaryActionLabel,
            'Desktop browser ingest expects a writable library or a portable bundle.'
        );

    case 'fotos-browser-mobile':
        if (source === 'photo-library') {
            return {
                surface,
                source,
                supported: true,
                mode: 'capture-selection',
                writesSidecars: false,
                faceEnrichment: 'remote',
                actionLabel: profile.primaryActionLabel,
                summary: 'Capture a selected set of photos without taking ownership of a folder.',
            };
        }
        if (source === 'shared-files') {
            return {
                surface,
                source,
                supported: true,
                mode: 'capture-selection',
                writesSidecars: false,
                faceEnrichment: 'remote',
                actionLabel: 'receive shared photos',
                summary: 'Accept photos from the share sheet and sync them for later enrichment.',
            };
        }
        if (source === 'bundle') {
            return {
                surface,
                source,
                supported: true,
                mode: 'import-bundle',
                writesSidecars: false,
                faceEnrichment: 'remote',
                actionLabel: 'open gallery bundle',
                summary: 'Open a portable bundle without claiming filesystem ownership.',
            };
        }
        return unsupportedPlan(
            surface,
            source,
            profile.primaryActionLabel,
            'Mobile browser capture works from selections, shared files, or bundles.'
        );

    case 'lama-fire':
        if (source === 'remote-manifest') {
            return {
                surface,
                source,
                supported: true,
                mode: 'consume-feed',
                writesSidecars: false,
                faceEnrichment: 'none',
                actionLabel: profile.primaryActionLabel,
                summary: 'Read a remote shared gallery projection without local ingest.',
            };
        }
        return unsupportedPlan(
            surface,
            source,
            profile.primaryActionLabel,
            'lama.fire is consumer-only and does not ingest local galleries.'
        );
    }
}
