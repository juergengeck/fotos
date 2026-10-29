import type {PhotoGridProps as SharedPhotoGridProps} from '@refinio/fotos.ui';
import {PhotoGrid as SharedPhotoGrid} from '@refinio/fotos.ui';
import {getMediaPlaybackKind} from '@refinio/media.core/media-types';
import {InlineMediaPlayer} from './InlineMediaPlayer.js';
import type {PhotoEntry} from '@/types/fotos';

export function PhotoGrid({getFileUrl, ...props}: SharedPhotoGridProps<PhotoEntry> & {
    getFileUrl?: (path: string) => Promise<string>;
}) {
    return (
        <SharedPhotoGrid
            {...props}
            canPlayInline={photo => getMediaPlaybackKind(photo.name, photo.mimeType) !== 'image'}
            renderInlinePlayer={getFileUrl ? photo => <InlineMediaPlayer photo={photo} getFileUrl={getFileUrl} /> : undefined}
            loadingLabel="Scanning one/ folders..."
        />
    );
}
