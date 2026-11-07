import {
    createPersistedTrieNodeRecipe,
    createPersistedTrieRootRecipe,
    type PersistedTrieNode,
    type PersistedTrieRoot,
} from '@refinio/trie.core';
import type {Recipe} from '@refinio/one.core/lib/recipes.js';

type GalleryTrieKind = 'Capture' | 'Updated' | 'Folder' | 'Tag' | 'Person' | 'FaceGroup' | 'DetectedFace';
type GalleryTrieNodeType = `Gallery${GalleryTrieKind}TrieNode`;
type GalleryTrieRootType = `Gallery${GalleryTrieKind}TrieRoot`;

export type GalleryTrieNode<Name extends GalleryTrieNodeType = GalleryTrieNodeType> =
    PersistedTrieNode & {$type$: Name};
export type GalleryTrieRoot<Name extends GalleryTrieRootType = GalleryTrieRootType> =
    PersistedTrieRoot & {$type$: Name};

type GalleryTrieNodeObjects = {[Name in GalleryTrieNodeType]: GalleryTrieNode<Name>};
type GalleryTrieRootObjects = {[Name in GalleryTrieRootType]: GalleryTrieRoot<Name>};
type GalleryTrieIdObjects = {
    [Name in GalleryTrieNodeType | GalleryTrieRootType]: {$type$: Name; id: string};
};

declare module '@OneObjectInterfaces' {
    interface OneIdObjectInterfaces extends GalleryTrieIdObjects {}
    interface OneVersionedObjectInterfaces extends GalleryTrieNodeObjects, GalleryTrieRootObjects {}
}

export const GalleryCaptureTrieNodeRecipe = createPersistedTrieNodeRecipe(
    'GalleryCaptureTrieNode',
    new Set(['FotosEntry'])
);

export const GalleryCaptureTrieRootRecipe = createPersistedTrieRootRecipe('GalleryCaptureTrieRoot');

export const GalleryUpdatedTrieNodeRecipe = createPersistedTrieNodeRecipe(
    'GalleryUpdatedTrieNode',
    new Set(['FotosEntry'])
);

export const GalleryUpdatedTrieRootRecipe = createPersistedTrieRootRecipe('GalleryUpdatedTrieRoot');

export const GalleryFolderTrieNodeRecipe = createPersistedTrieNodeRecipe(
    'GalleryFolderTrieNode',
    new Set(['FotosEntry'])
);

export const GalleryFolderTrieRootRecipe = createPersistedTrieRootRecipe('GalleryFolderTrieRoot');

export const GalleryTagTrieNodeRecipe = createPersistedTrieNodeRecipe(
    'GalleryTagTrieNode',
    new Set(['FotosEntry'])
);

export const GalleryTagTrieRootRecipe = createPersistedTrieRootRecipe('GalleryTagTrieRoot');

export const GalleryPersonTrieNodeRecipe = createPersistedTrieNodeRecipe(
    'GalleryPersonTrieNode',
    new Set(['FotosEntry'])
);

export const GalleryPersonTrieRootRecipe = createPersistedTrieRootRecipe('GalleryPersonTrieRoot');

export const GalleryFaceGroupTrieNodeRecipe = createPersistedTrieNodeRecipe(
    'GalleryFaceGroupTrieNode',
    new Set(['FotosEntry'])
);

export const GalleryFaceGroupTrieRootRecipe = createPersistedTrieRootRecipe('GalleryFaceGroupTrieRoot');

export const GalleryDetectedFaceTrieNodeRecipe = createPersistedTrieNodeRecipe(
    'GalleryDetectedFaceTrieNode',
    new Set(['FotosEntry'])
);

export const GalleryDetectedFaceTrieRootRecipe = createPersistedTrieRootRecipe('GalleryDetectedFaceTrieRoot');

export const GalleryTrieRecipes: Recipe[] = [
    GalleryCaptureTrieNodeRecipe,
    GalleryCaptureTrieRootRecipe,
    GalleryUpdatedTrieNodeRecipe,
    GalleryUpdatedTrieRootRecipe,
    GalleryFolderTrieNodeRecipe,
    GalleryFolderTrieRootRecipe,
    GalleryTagTrieNodeRecipe,
    GalleryTagTrieRootRecipe,
    GalleryPersonTrieNodeRecipe,
    GalleryPersonTrieRootRecipe,
    GalleryFaceGroupTrieNodeRecipe,
    GalleryFaceGroupTrieRootRecipe,
    GalleryDetectedFaceTrieNodeRecipe,
    GalleryDetectedFaceTrieRootRecipe,
];
