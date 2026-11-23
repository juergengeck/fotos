import {useEffect, useRef, useState} from 'react';
import {Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useColorScheme} from 'react-native';
import {useLocalSearchParams, useRouter} from 'expo-router';
import {File, Paths} from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import {ArrowLeft, Download, Info} from 'lucide-react-native';
import {MAX_FOTOS_TAG_LENGTH, traceFotosAcquisitions, type FotosEntry, type FotosFaceDetections} from '@refinio/fotos.core';
import {readFotosOriginal} from '@refinio/fotos.core/filesystem';
import {useModel} from '../../ios-ui';
import {FotosGalleryImage} from '../../ios-ui/components/FotosGalleryImage';
import {FotosCollectionShare} from '../../ios-ui/components/FotosCollectionShare';
import {useFotosGalleryEntries} from '../../ios-ui/hooks/useFotosMobileGallery';
import {getFotosPhotoKit, type FotosPhotoKitOriginal} from '../../ios-ui/services/FotosPhotoKit';
import {getFotosFaceNames, readFotosMobileFaceDetections} from '../../ios-ui/services/FotosMobileFaces';
import {buildEntryFromAsset, isEditableFotosCollection} from '../../ios-ui/services/FotosMediaLibrarySync';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {mutedTextColor, palette, screenBackground, textColor} from '../../src/theme';

const extensions: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/heif': 'heif',
    'image/avif': 'avif', 'image/webp': 'webp', 'image/gif': 'gif', 'image/tiff': 'tiff',
    'video/quicktime': 'mov', 'video/mp4': 'mp4',
};

export default function PhotoLightbox() {
    const {contentHash, assetId, title} = useLocalSearchParams<{contentHash: string; assetId?: string; title?: string}>();
    const router = useRouter();
    const model = useModel();
    const dark = useColorScheme() === 'dark';
    const insets = useSafeAreaInsets();
    const {library, loading, error: libraryError} = useFotosGalleryEntries(model);
    const [details, setDetails] = useState(false);
    const [local, setLocal] = useState<FotosPhotoKitOriginal>();
    const [networkAccess, setNetworkAccess] = useState(false);
    const [viewport, setViewport] = useState({width: 1, height: 1});
    const [original, setOriginal] = useState<{entry: FotosEntry; uri: string}>();
    const [traces, setTraces] = useState<Awaited<ReturnType<typeof traceFotosAcquisitions>>>();
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string>();
    const [showCollections, setShowCollections] = useState(false);
    const [collectionName, setCollectionName] = useState('');
    const [tag, setTag] = useState('');
    const [faceAnalysis, setFaceAnalysis] = useState<{entry: FotosEntry; detections: FotosFaceDetections}>();
    const files = useRef(new Set<File>());
    const alive = useRef(true);
    const ownedEntry = library.owned.find(item => item.contentHash === contentHash);
    const entry = ownedEntry ?? library.shared.find(item => item.contentHash === contentHash);
    const currentEntry = useRef(entry);
    currentEntry.current = entry;
    const collections = library.collections.filter(collection => collection.photoHashes.has(contentHash));
    const hash = local?.status === 'available' ? local.contentHash : contentHash === 'local' ? undefined : contentHash;
    const name = entry?.originalFilename ?? local?.asset.filename ?? title ?? 'Photo';

    useEffect(() => {
        alive.current = true;
        const temporary = files.current;
        return () => {
            alive.current = false;
            for (const file of temporary) {
                if (file.exists) file.delete();
            }
            temporary.clear();
        };
    }, []);

    useEffect(() => {
        if (!assetId || (!details && !networkAccess)) return;
        let disposed = false;
        void (async () => {
            try {
                const result = await getFotosPhotoKit().inspectOriginal(assetId, networkAccess);
                if (!disposed) setLocal(result);
            } catch (error) {
                if (!disposed) setMessage(error instanceof Error ? error.message : String(error));
            }
        })();
        return () => { disposed = true; };
    }, [assetId, details, networkAccess]);

    useEffect(() => {
        setTraces(undefined);
        if (!details || !entry?.acquisitionObservations?.size) return;
        let disposed = false;
        void traceFotosAcquisitions(entry, {maxDepth: 4, maxNodes: 24, maxResources: 48}).then(result => {
            if (!disposed) setTraces(result);
        }).catch(error => {
            if (!disposed) setMessage(error instanceof Error ? error.message : String(error));
        });
        return () => { disposed = true; };
    }, [details, entry]);

    useEffect(() => {
        if (!details || !entry?.faceCount) return;
        let disposed = false;
        void readFotosMobileFaceDetections(entry).then(detections => {
            if (!disposed && detections) setFaceAnalysis({entry, detections});
        }).catch(error => {
            if (!disposed) setMessage(error instanceof Error ? error.message : String(error));
        });
        return () => { disposed = true; };
    }, [details, entry]);

    async function loadOriginal(save: boolean) {
        if (!entry || busy) return;
        const ext = extensions[entry.mime];
        if (!ext) {
            setMessage('This original format is unavailable for export.');
            return;
        }
        setBusy(true);
        setMessage(undefined);
        try {
            let uri = original?.entry === entry ? original.uri : undefined;
            if (!uri) {
                const {content} = await readFotosOriginal(entry);
                if (!alive.current || currentEntry.current !== entry) return;
                const file = new File(Paths.cache, `fotos-${entry.contentHash}-${Date.now()}.${ext}`);
                files.current.add(file);
                file.create();
                file.write(new Uint8Array(content));
                uri = file.uri;
                setOriginal({entry, uri});
            }
            if (save) {
                const existing = await MediaLibrary.getPermissionsAsync(true);
                const access = existing.granted ? existing : await MediaLibrary.requestPermissionsAsync(true);
                if (!access.granted) throw new Error('Allow fotos to add photos to your library to save this original.');
                await MediaLibrary.Asset.create(uri);
                if (alive.current) setMessage('Saved to Apple Photos.');
            }
        } catch (error) {
            if (alive.current) setMessage(error instanceof Error ? error.message : String(error));
        } finally {
            if (alive.current) setBusy(false);
        }
    }

    async function addToCollection(target: {id: string} | {name: string}) {
        if (!ownedEntry || busy) return;
        setBusy(true);
        try {
            const service = model.fotosMediaLibrarySync;
            if (!service) throw new Error('Your Fotos library is unavailable.');
            await service.addPhotoToCollection(ownedEntry.contentHash, target);
            if (!alive.current) return;
            setShowCollections(false);
            setCollectionName('');
            setMessage('Added to collection.');
        } catch (error) {
            if (alive.current) setMessage(error instanceof Error ? error.message : String(error));
        } finally {
            if (alive.current) setBusy(false);
        }
    }

    async function addTag() {
        if (!ownedEntry || busy || !tag.trim()) return;
        setBusy(true);
        setMessage(undefined);
        try {
            const service = model.fotosMediaLibrarySync;
            if (!service) throw new Error('Your Fotos library is unavailable.');
            await service.addPhotoTag(ownedEntry.contentHash, tag);
            if (alive.current) setTag('');
        } catch (error) {
            if (alive.current) setMessage(error instanceof Error ? error.message : String(error));
        } finally {
            if (alive.current) setBusy(false);
        }
    }

    async function addToLibrary() {
        if (!assetId || busy) return;
        setBusy(true);
        setMessage(undefined);
        try {
            const summary = await model.syncPhotoLibraryAssetsById([assetId], networkAccess);
            if (!alive.current) return;
            const saved = summary.syncedEntries.find(item => item.assetId === assetId);
            if (!saved) {
                const reason = summary.deferredAssets.length ? 'Load the original from iCloud to add it to Fotos.' : 'This photo could not be added to Fotos.';
                setMessage(summary.issues[0]?.reason ?? reason);
                return;
            }
            router.replace({pathname: '/photo/[contentHash]', params: {contentHash: saved.contentHash, assetId, title: name}});
        } catch (error) {
            if (alive.current) setMessage(error instanceof Error ? error.message : String(error));
        } finally {
            if (alive.current) setBusy(false);
        }
    }

    const photoDetails = entry ?? (local?.status === 'available' ? buildEntryFromAsset(local) : undefined);
    const names = getFotosFaceNames(faceAnalysis?.entry === entry ? faceAnalysis?.detections : undefined);
    const metadata: Array<[string, string | number | undefined]> = [
        ['Content hash', hash], ['Captured', photoDetails?.capturedAt ?? photoDetails?.exifDate],
        ['Camera', photoDetails?.exifCamera], ['Lens', photoDetails?.exifLens], ['Focal length', photoDetails?.exifFocalLength],
        ['Aperture', photoDetails?.exifAperture], ['Shutter', photoDetails?.exifShutter], ['ISO', photoDetails?.exifIso],
        ['Latitude', photoDetails?.exifGpsLat ?? local?.asset.location?.latitude], ['Longitude', photoDetails?.exifGpsLon ?? local?.asset.location?.longitude],
        ['Albums', collections.map(collection => collection.name).join(', ') || undefined],
        ['Tags', photoDetails?.tags?.size ? [...photoDetails.tags].sort().join(', ') : undefined],
        ['Local gallery locator', assetId], ['Faces detected', entry?.faceCount],
        ['People', names.join(', ') || undefined],
    ];
    const preview = original && original.entry === entry && entry.mime.startsWith('image/') ? original.uri : undefined;

    return (
        <View style={[styles.screen, {paddingTop: insets.top, paddingBottom: insets.bottom}]}>
            <View style={styles.bar}>
                <Pressable accessibilityRole="button" accessibilityLabel="Back to library" onPress={() => router.canGoBack() ? router.back() : router.replace('/library')}>
                    <ArrowLeft size={24} color="white" />
                </Pressable>
                <Text numberOfLines={1} style={styles.title}>{name}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Photo details" onPress={() => setDetails(true)}>
                    <Info size={24} color="white" />
                </Pressable>
            </View>
            <View style={styles.viewer} onLayout={({nativeEvent}) => setViewport(nativeEvent.layout)}>
                <ScrollView minimumZoomScale={1} maximumZoomScale={4} centerContent bouncesZoom showsVerticalScrollIndicator={false}
                    showsHorizontalScrollIndicator={false} contentContainerStyle={{width: viewport.width, height: viewport.height}}>
                    {preview ? <Image style={StyleSheet.absoluteFill} source={{uri: preview}} resizeMode="contain" /> : (
                        <FotosGalleryImage item={{asset: assetId ? {id: assetId} : undefined, entry}} resizeMode="contain" allowNetworkAccess={networkAccess} />
                    )}
                </ScrollView>
            </View>
            <View style={styles.footer}>
                {model.platformCapabilities.currentPlatform === 'ios' && assetId && !networkAccess && local?.status !== 'available' ? (
                    <Pressable accessibilityRole="button" onPress={() => setNetworkAccess(true)}><Text style={styles.footerText}>Load from iCloud</Text></Pressable>
                ) : null}
                {!assetId && entry && !preview ? (
                    <Pressable accessibilityRole="button" disabled={busy} onPress={() => void loadOriginal(false)}>
                        <Text style={styles.footerText}>{busy ? 'Loading original…' : 'Load original'}</Text>
                    </Pressable>
                ) : null}
                {!assetId && !entry ? <Text style={styles.footerText}>{libraryError ?? (loading ? 'Loading photo…' : 'Photo unavailable')}</Text> : null}
                {message ? <Text style={styles.footerText}>{message}</Text> : null}
            </View>
            <Modal visible={details} onRequestClose={() => setDetails(false)} animationType="slide" presentationStyle="pageSheet">
                <ScrollView style={{backgroundColor: screenBackground(dark)}} contentContainerStyle={styles.details}>
                    <View style={styles.heading}>
                        <Text style={[styles.headingText, {color: textColor(dark)}]}>Photo details</Text>
                        <Pressable accessibilityRole="button" onPress={() => setDetails(false)}><Text style={styles.action}>Done</Text></Pressable>
                    </View>
                    {metadata.filter(([, value]) => value !== undefined).map(([label, value]) => (
                        <View key={label} style={styles.metadata}>
                            <Text style={{color: mutedTextColor(dark)}}>{label}</Text>
                            <Text selectable style={{color: textColor(dark)}}>{String(value)}</Text>
                        </View>
                    ))}
                    {traces?.length ? (
                        <View style={styles.metadata}>
                            <Text style={{color: mutedTextColor(dark)}}>Acquisition provenance</Text>
                            {traces.map(trace => (
                                <Text key={trace.observation} selectable style={{color: textColor(dark)}}>
                                    {trace.complete ? 'Complete' : 'Partial'} · {trace.observations.length} observation(s){'\n'}{trace.observation}
                                </Text>
                            ))}
                        </View>
                    ) : null}
                    {ownedEntry ? (
                        <View style={styles.metadata}>
                            <TextInput accessibilityLabel="New photo tag" value={tag} onChangeText={setTag} onSubmitEditing={() => void addTag()}
                                maxLength={MAX_FOTOS_TAG_LENGTH} placeholder="New photo tag" placeholderTextColor={mutedTextColor(dark)}
                                style={[styles.collectionInput, {color: textColor(dark), borderColor: mutedTextColor(dark)}]} />
                            <Pressable accessibilityRole="button" disabled={busy || !tag.trim()} onPress={() => void addTag()} style={{marginBottom: 8}}>
                                <Text style={styles.action}>Add tag</Text>
                            </Pressable>
                            <Pressable accessibilityRole="button" onPress={() => setShowCollections(!showCollections)}>
                                <Text style={styles.action}>{showCollections ? 'Hide collections' : 'Add to collection'}</Text>
                            </Pressable>
                            {showCollections ? (
                                <>
                                    {library.collections.filter(collection => isEditableFotosCollection(model.ownerId, collection.id)).map(collection => (
                                        <Pressable key={collection.id} accessibilityRole="button"
                                            disabled={busy || collection.photoHashes.has(ownedEntry.contentHash)}
                                            onPress={() => void addToCollection({id: collection.id})}>
                                            <Text style={{color: textColor(dark)}}>{collection.name}{collection.photoHashes.has(ownedEntry.contentHash) ? ' ✓' : ''}</Text>
                                        </Pressable>
                                    ))}
                                    <TextInput accessibilityLabel="New collection name" value={collectionName} onChangeText={setCollectionName}
                                        placeholder="New collection name" placeholderTextColor={mutedTextColor(dark)}
                                        style={[styles.collectionInput, {color: textColor(dark), borderColor: mutedTextColor(dark)}]} />
                                    <Pressable accessibilityRole="button" disabled={busy || !collectionName.trim()}
                                        onPress={() => void addToCollection({name: collectionName})}>
                                        <Text style={styles.action}>Create collection</Text>
                                    </Pressable>
                                </>
                            ) : null}
                        </View>
                    ) : null}
                    {ownedEntry ? <FotosCollectionShare collections={collections} dark={dark} /> : null}
                    {assetId && !ownedEntry && !loading ? (
                        <Pressable accessibilityRole="button" disabled={busy} onPress={() => void addToLibrary()}>
                            <Text style={styles.action}>{busy ? 'Adding to Fotos…' : 'Add to Fotos'}</Text>
                        </Pressable>
                    ) : null}
                    {!assetId && entry && model.platformCapabilities.currentPlatform === 'ios' ? (
                        <Pressable accessibilityRole="button" disabled={busy} onPress={() => void loadOriginal(true)} style={styles.save}>
                            <Download size={19} color={palette.accent} />
                            <Text style={styles.action}>{busy ? 'Loading original…' : 'Save to Apple Photos'}</Text>
                        </Pressable>
                    ) : null}
                    {message ? <Text style={{color: textColor(dark)}}>{message}</Text> : null}
                </ScrollView>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: {flex: 1, backgroundColor: '#0b0b0b'},
    bar: {flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 18, minHeight: 48},
    title: {flex: 1, textAlign: 'center', color: 'white', fontSize: 16, fontWeight: '600'},
    viewer: {flex: 1},
    footer: {alignItems: 'center', padding: 12, gap: 8},
    footerText: {color: '#f0f0f0', textAlign: 'center'},
    details: {padding: 20, gap: 15},
    heading: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 8},
    headingText: {fontSize: 20, fontWeight: '700'},
    metadata: {gap: 4},
    collectionInput: {minHeight: 40, borderWidth: 1, borderRadius: 8, paddingHorizontal: 9, marginVertical: 6},
    save: {flexDirection: 'row', alignItems: 'center', gap: 10},
    action: {color: palette.accent, fontWeight: '700'},
});
