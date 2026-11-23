import type {FotosEntry} from './recipes/FotosRecipes.js';

const galleryFields = [
    'capturedAt', 'updatedAt', 'exifDate', 'exifCamera', 'exifLens', 'exifFocalLength',
    'exifAperture', 'exifShutter', 'exifIso', 'exifGpsLat', 'exifGpsLon', 'exifGpsAlt',
    'exifWidth', 'exifHeight', 'orientation', 'originalFilename', 'duration', 'favorite', 'mediaSubtypes',
] as const;

type GalleryField = typeof galleryFields[number];
type GalleryObservation = Pick<FotosEntry, GalleryField | 'contentHash' | 'streamId' | 'mime' | 'size' | 'sourcePath' | 'folderPath'>;

export interface FotosGalleryDelta {
    observed: GalleryObservation;
    /** An authoritative gallery observation explicitly removed these values. */
    cleared?: readonly GalleryField[];
}

/** Apply OS gallery metadata to the same content identity. Unobserved fields retain their values. */
export function applyGalleryDelta(current: FotosEntry | undefined, {observed, cleared = []}: FotosGalleryDelta): FotosEntry {
    if (current && current.contentHash !== observed.contentHash) {
        throw new Error('A gallery update requires the same Fotos content hash.');
    }
    const updates = Object.fromEntries(galleryFields
        .filter(field => observed[field] !== undefined)
        .map(field => [field, observed[field]]));
    const sourcePath = current?.sourcePath ?? observed.sourcePath;
    const folderPath = current?.folderPath ?? observed.folderPath;
    const next: FotosEntry = {
        ...current, ...updates,
        $type$: 'FotosEntry',
        contentHash: observed.contentHash,
        streamId: current?.streamId ?? observed.streamId,
        mime: observed.mime,
        size: observed.size,
        ...(sourcePath === undefined ? {} : {sourcePath}),
        ...(folderPath === undefined ? {} : {folderPath}),
    };
    for (const field of cleared) {
        if (galleryFields.includes(field)) delete next[field];
    }
    return next;
}
