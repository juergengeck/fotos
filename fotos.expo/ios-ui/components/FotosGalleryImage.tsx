import {useEffect, useState, type ComponentType} from 'react';
import {Image, StyleSheet, type ViewProps} from 'react-native';
import {requireNativeView} from 'expo';
import {readBlobAsBase64} from '@refinio/one.core/lib/storage-blob.js';
import type {FotosGalleryItem} from '../services/FotosMobileGallery';

type PhotoKitImageProps = ViewProps & {
    assetId: string;
    resizeMode: 'cover' | 'contain';
    allowNetworkAccess?: boolean;
};
let PhotoKitImage: ComponentType<PhotoKitImageProps> | undefined;

export function FotosGalleryImage({
    item, resizeMode = 'cover', allowNetworkAccess = false,
}: {
    item: {asset?: Pick<NonNullable<FotosGalleryItem['asset']>, 'id'>; entry?: FotosGalleryItem['entry']};
    resizeMode?: 'cover' | 'contain';
    allowNetworkAccess?: boolean;
}) {
    const thumb = item.entry?.thumb;
    const assetId = item.asset?.id;
    const [thumbnail, setThumbnail] = useState<{hash: string; uri: string}>();
    useEffect(() => {
        if (!thumb || assetId) return;
        let disposed = false;
        void readBlobAsBase64(thumb).then(bytes => {
            const mime = bytes.startsWith('iVBORw') ? 'png' : bytes.startsWith('UklGR') ? 'webp' : 'jpeg';
            if (!disposed) setThumbnail({hash: thumb, uri: `data:image/${mime};base64,${bytes}`});
        }).catch(() => {});
        return () => { disposed = true; };
    }, [thumb, assetId]);

    if (assetId) {
        PhotoKitImage ??= requireNativeView<PhotoKitImageProps>('FotosPhotoKit');
        return <PhotoKitImage style={StyleSheet.absoluteFill} assetId={assetId} resizeMode={resizeMode} allowNetworkAccess={allowNetworkAccess} />;
    }
    if (thumbnail && thumbnail.hash === thumb) {
        return <Image accessible={false} style={StyleSheet.absoluteFill} source={{uri: thumbnail.uri}} resizeMode={resizeMode} />;
    }
    return null;
}
