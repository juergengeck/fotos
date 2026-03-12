import type {FotosCatalogConfig} from './fotos-catalog.js';

export const FOTOS_BUNDLE_MANIFEST = 'fotos-bundle.json';

export interface FotosBundleManifest {
    version: 1;
    exportedAt: string;
    thumbDir: string;
    blobDir: string;
    includesOriginals: boolean;
}

export function createFotosBundleManifest(
    config: FotosCatalogConfig,
    includesOriginals: boolean
): FotosBundleManifest {
    return {
        version: 1,
        exportedAt: new Date().toISOString(),
        thumbDir: config.thumbDir,
        blobDir: config.blobDir,
        includesOriginals,
    };
}
