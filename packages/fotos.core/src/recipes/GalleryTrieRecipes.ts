import {
    createPersistedTrieNodeRecipe,
    createPersistedTrieRootRecipe,
} from '@refinio/trie.core';
import type {Recipe} from '@refinio/one.core/lib/recipes.js';

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
