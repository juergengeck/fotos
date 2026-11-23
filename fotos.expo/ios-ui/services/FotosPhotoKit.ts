import {requireOptionalNativeModule} from 'expo';
import type {FotosMediaSubtype} from '@refinio/fotos.core';
import type {FotosPhotoKitContinuation} from './FotosPhotoKitPaging';

export interface FotosPhotoKitAsset {
    id: string;
    filename: string;
    mimeType?: string;
    creationTime?: number;
    modificationTime?: number;
    width: number;
    height: number;
    mediaType: 'photo' | 'video';
    mediaSubtypes: FotosMediaSubtype[];
    duration: number;
    favorite: boolean;
    location?: {latitude: number; longitude: number; altitude?: number};
    burstIdentifier?: string;
    exif?: Record<string, unknown>;
}

export type FotosPhotoKitOriginal =
    | {asset: FotosPhotoKitAsset; status: 'available'; contentHash: string; byteSize: number; thumbnailUri?: string}
    | {asset: FotosPhotoKitAsset; status: 'icloud-deferred'};

export interface FotosPhotoKitChange {
    inserted: string[];
    changed: string[];
    removed: string[];
    albumsChanged: boolean;
    requiresReload: boolean;
}

export interface FotosPhotoKitNative {
    listAssets(offset: number, limit: number, cursor?: string): Promise<FotosPhotoKitContinuation & {assets: FotosPhotoKitAsset[]}>;
    inspectOriginal(id: string, allowNetworkAccess: boolean, previewMaxEdge?: number): Promise<FotosPhotoKitOriginal>;
    thumbnailFile(id: string, maxEdge: number, allowNetworkAccess: boolean): Promise<string | null>;
    originalFile(id: string, allowNetworkAccess: boolean): Promise<string>;
    listAlbums(offset: number, limit: number, cursor?: string): Promise<FotosPhotoKitContinuation & {
        albums: Array<{id: string; name: string; kind: 'user' | 'smart'}>;
    }>;
    listAlbumMembers(id: string, offset: number, limit: number, cursor?: string):
        Promise<FotosPhotoKitContinuation & {assetIds: string[]}>;
    releaseCursor(cursor: string): void | Promise<void>;
    addListener(name: 'onLibraryChange', listener: (change: FotosPhotoKitChange) => void): {remove(): void};
}

export function getFotosPhotoKit(): FotosPhotoKitNative {
    const module = requireOptionalNativeModule<FotosPhotoKitNative>('FotosPhotoKit');
    if (!module?.releaseCursor) throw new Error('Photo-library sync requires the current Fotos native iOS build');
    return module;
}
