import type { PhotoEntry } from '@/types/fotos';
import { useFotosGalleryState } from '@refinio/fotos.ui';
import { useServerAccess } from './useServerAccess';

export function useGallery() {
    const folder = useServerAccess();
    const gallery = useFotosGalleryState<PhotoEntry>({source: folder});

    return {
        ...gallery,
        // Folder access
        folder,
    };
}
