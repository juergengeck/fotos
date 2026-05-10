import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUseState = vi.hoisted(() => vi.fn());
const mockUseEffect = vi.hoisted(() => vi.fn());
const mockUseMemo = vi.hoisted(() => vi.fn());
const mockUseRef = vi.hoisted(() => vi.fn());
const mockUseCallback = vi.hoisted(() => vi.fn());

const mockUseFolderAccess = vi.hoisted(() => vi.fn());
const mockUseFotosGalleryState = vi.hoisted(() => vi.fn());
const mockGroupPhotosByDay = vi.hoisted(() => vi.fn(() => []));
const mockBuildFaceClusterSummaries = vi.hoisted(() => vi.fn(() => []));
const mockBuildSimilarFaceMatches = vi.hoisted(() => vi.fn(() => []));
const mockCollectionMatchesPhoto = vi.hoisted(() => vi.fn(() => false));

vi.mock('react', async () => {
    const actual = await vi.importActual<typeof import('react')>('react');
    return {
        ...actual,
        useState: mockUseState,
        useEffect: mockUseEffect,
        useMemo: mockUseMemo,
        useRef: mockUseRef,
        useCallback: mockUseCallback,
    };
});

vi.mock('@refinio/fotos.core', () => ({
    GalleryTrieManager: class GalleryTrieManager {},
}));

vi.mock('@refinio/fotos.ui', () => ({
    groupPhotosByDay: mockGroupPhotosByDay,
    useFotosGalleryState: mockUseFotosGalleryState,
}));

vi.mock('@/lib/cluster-gallery', () => ({
    buildFaceClusterSummaries: mockBuildFaceClusterSummaries,
    buildSimilarFaceMatches: mockBuildSimilarFaceMatches,
}));

vi.mock('@/lib/fotosCollections', () => ({
    collectionMatchesPhoto: mockCollectionMatchesPhoto,
}));

vi.mock('@/lib/semanticWorkerClient', () => ({
    createSemanticWorker: vi.fn(),
}));

vi.mock('./useFolderAccess', () => ({
    useFolderAccess: mockUseFolderAccess,
}));

vi.mock('@/workers/semantic.worker.ts?worker&url', () => ({
    default: '/workers/semantic.worker.js',
}));

import { useGallery } from './useGallery';

describe('useGallery', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        mockUseState.mockImplementation((initialValue: unknown) => [
            typeof initialValue === 'function'
                ? (initialValue as () => unknown)()
                : initialValue,
            vi.fn(),
        ]);
        mockUseEffect.mockImplementation(() => {});
        mockUseMemo.mockImplementation((factory: () => unknown) => factory());
        mockUseRef.mockImplementation((initialValue: unknown) => ({ current: initialValue }));
        mockUseCallback.mockImplementation((callback: unknown) => callback);
    });

    it('passes an initialized resolveDayGroups callback into useFotosGalleryState', () => {
        const folder = {
            entries: [],
            isOpen: true,
            ingestProgress: null,
            ensureSemanticEmbeddings: vi.fn().mockResolvedValue(undefined),
        };
        const galleryState = {
            photos: [],
            searchQuery: '',
            searchFace: null,
            setSearchEmbedding: vi.fn(),
        };

        mockUseFolderAccess.mockReturnValue(folder);
        mockUseFotosGalleryState.mockReturnValue(galleryState);

        const result = useGallery();

        expect(mockUseFotosGalleryState).toHaveBeenCalledTimes(1);
        expect(mockUseFotosGalleryState).toHaveBeenCalledWith(
            expect.objectContaining({
                source: folder,
                resolveDayGroups: expect.any(Function),
            }),
        );
        expect(result.folder).toBe(folder);
    });
});
