import type {PhotoGridProps as SharedPhotoGridProps} from '@refinio/fotos.ui';
import {PhotoGrid as SharedPhotoGrid} from '@refinio/fotos.ui';
import type {PhotoEntry} from '@/types/fotos';

export function PhotoGrid(props: SharedPhotoGridProps<PhotoEntry>) {
    return (
        <SharedPhotoGrid
            {...props}
            loadingLabel="Scanning .one/ folders..."
        />
    );
}
