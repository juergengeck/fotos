import {
    createPersistedTrieNodeRecipe,
    createPersistedTrieRootRecipe,
} from '@refinio/trie.core';
import type {PersistedTrieNode, PersistedTrieRoot} from '@refinio/trie.core';
import type {Recipe} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {FotosEntry} from './FotosRecipes.js';

interface GalleryCaptureTrieNode extends PersistedTrieNode<
    'GalleryCaptureTrieNode',
    SHA256IdHash<GalleryCaptureTrieNode>,
    SHA256Hash<GalleryCaptureTrieNode>
> {
    entryRefs?: Set<SHA256Hash<FotosEntry>>;
}

interface GalleryUpdatedTrieNode extends PersistedTrieNode<
    'GalleryUpdatedTrieNode',
    SHA256IdHash<GalleryUpdatedTrieNode>,
    SHA256Hash<GalleryUpdatedTrieNode>
> {
    entryRefs?: Set<SHA256Hash<FotosEntry>>;
}

interface GalleryFolderTrieNode extends PersistedTrieNode<
    'GalleryFolderTrieNode',
    SHA256IdHash<GalleryFolderTrieNode>,
    SHA256Hash<GalleryFolderTrieNode>
> {
    entryRefs?: Set<SHA256Hash<FotosEntry>>;
}

interface GalleryTagTrieNode extends PersistedTrieNode<
    'GalleryTagTrieNode',
    SHA256IdHash<GalleryTagTrieNode>,
    SHA256Hash<GalleryTagTrieNode>
> {
    entryRefs?: Set<SHA256Hash<FotosEntry>>;
}

interface GalleryPersonTrieNode extends PersistedTrieNode<
    'GalleryPersonTrieNode',
    SHA256IdHash<GalleryPersonTrieNode>,
    SHA256Hash<GalleryPersonTrieNode>
> {
    entryRefs?: Set<SHA256Hash<FotosEntry>>;
}

interface GalleryFaceGroupTrieNode extends PersistedTrieNode<
    'GalleryFaceGroupTrieNode',
    SHA256IdHash<GalleryFaceGroupTrieNode>,
    SHA256Hash<GalleryFaceGroupTrieNode>
> {
    entryRefs?: Set<SHA256Hash<FotosEntry>>;
}

interface GalleryDetectedFaceTrieNode extends PersistedTrieNode<
    'GalleryDetectedFaceTrieNode',
    SHA256IdHash<GalleryDetectedFaceTrieNode>,
    SHA256Hash<GalleryDetectedFaceTrieNode>
> {
    entryRefs?: Set<SHA256Hash<FotosEntry>>;
}

declare module '@OneObjectInterfaces' {
    export interface OneIdObjectInterfaces {
        GalleryCaptureTrieNode: Pick<OneVersionedObjectInterfaces['GalleryCaptureTrieNode'], '$type$' | 'id'>;
        GalleryCaptureTrieRoot: Pick<OneVersionedObjectInterfaces['GalleryCaptureTrieRoot'], '$type$' | 'id'>;
        GalleryUpdatedTrieNode: Pick<OneVersionedObjectInterfaces['GalleryUpdatedTrieNode'], '$type$' | 'id'>;
        GalleryUpdatedTrieRoot: Pick<OneVersionedObjectInterfaces['GalleryUpdatedTrieRoot'], '$type$' | 'id'>;
        GalleryFolderTrieNode: Pick<OneVersionedObjectInterfaces['GalleryFolderTrieNode'], '$type$' | 'id'>;
        GalleryFolderTrieRoot: Pick<OneVersionedObjectInterfaces['GalleryFolderTrieRoot'], '$type$' | 'id'>;
        GalleryTagTrieNode: Pick<OneVersionedObjectInterfaces['GalleryTagTrieNode'], '$type$' | 'id'>;
        GalleryTagTrieRoot: Pick<OneVersionedObjectInterfaces['GalleryTagTrieRoot'], '$type$' | 'id'>;
        GalleryPersonTrieNode: Pick<OneVersionedObjectInterfaces['GalleryPersonTrieNode'], '$type$' | 'id'>;
        GalleryPersonTrieRoot: Pick<OneVersionedObjectInterfaces['GalleryPersonTrieRoot'], '$type$' | 'id'>;
        GalleryFaceGroupTrieNode: Pick<OneVersionedObjectInterfaces['GalleryFaceGroupTrieNode'], '$type$' | 'id'>;
        GalleryFaceGroupTrieRoot: Pick<OneVersionedObjectInterfaces['GalleryFaceGroupTrieRoot'], '$type$' | 'id'>;
        GalleryDetectedFaceTrieNode: Pick<OneVersionedObjectInterfaces['GalleryDetectedFaceTrieNode'], '$type$' | 'id'>;
        GalleryDetectedFaceTrieRoot: Pick<OneVersionedObjectInterfaces['GalleryDetectedFaceTrieRoot'], '$type$' | 'id'>;
    }

    export interface OneVersionedObjectInterfaces {
        GalleryCaptureTrieNode: GalleryCaptureTrieNode;
        GalleryCaptureTrieRoot: PersistedTrieRoot<
            'GalleryCaptureTrieRoot',
            SHA256IdHash<GalleryCaptureTrieNode>,
            SHA256Hash<GalleryCaptureTrieNode>
        >;
        GalleryUpdatedTrieNode: GalleryUpdatedTrieNode;
        GalleryUpdatedTrieRoot: PersistedTrieRoot<
            'GalleryUpdatedTrieRoot',
            SHA256IdHash<GalleryUpdatedTrieNode>,
            SHA256Hash<GalleryUpdatedTrieNode>
        >;
        GalleryFolderTrieNode: GalleryFolderTrieNode;
        GalleryFolderTrieRoot: PersistedTrieRoot<
            'GalleryFolderTrieRoot',
            SHA256IdHash<GalleryFolderTrieNode>,
            SHA256Hash<GalleryFolderTrieNode>
        >;
        GalleryTagTrieNode: GalleryTagTrieNode;
        GalleryTagTrieRoot: PersistedTrieRoot<
            'GalleryTagTrieRoot',
            SHA256IdHash<GalleryTagTrieNode>,
            SHA256Hash<GalleryTagTrieNode>
        >;
        GalleryPersonTrieNode: GalleryPersonTrieNode;
        GalleryPersonTrieRoot: PersistedTrieRoot<
            'GalleryPersonTrieRoot',
            SHA256IdHash<GalleryPersonTrieNode>,
            SHA256Hash<GalleryPersonTrieNode>
        >;
        GalleryFaceGroupTrieNode: GalleryFaceGroupTrieNode;
        GalleryFaceGroupTrieRoot: PersistedTrieRoot<
            'GalleryFaceGroupTrieRoot',
            SHA256IdHash<GalleryFaceGroupTrieNode>,
            SHA256Hash<GalleryFaceGroupTrieNode>
        >;
        GalleryDetectedFaceTrieNode: GalleryDetectedFaceTrieNode;
        GalleryDetectedFaceTrieRoot: PersistedTrieRoot<
            'GalleryDetectedFaceTrieRoot',
            SHA256IdHash<GalleryDetectedFaceTrieNode>,
            SHA256Hash<GalleryDetectedFaceTrieNode>
        >;
    }
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
