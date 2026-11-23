import {useMemo, useState} from 'react';
import {ActivityIndicator, Linking, Pressable, StyleSheet, Text, TextInput, View, useColorScheme} from 'react-native';
import {FlashList} from '@shopify/flash-list';
import {useRouter} from 'expo-router';
import {Check, Cloud, FolderOpen, Images, Search, Tag, Users} from 'lucide-react-native';
import {useModel} from '../../ios-ui';
import {FotosGalleryImage} from '../../ios-ui/components/FotosGalleryImage';
import {useFotosMobileGallery} from '../../ios-ui/hooks/useFotosMobileGallery';
import {useFotosShareInboxAutoDrainStatus} from '../../ios-ui/hooks/useFotosShareInboxAutoDrain';
import type {FotosGalleryItem} from '../../ios-ui/services/FotosMobileGallery';
import {borderColor, cardBackground, mutedCardBackground, mutedTextColor, palette, screenBackground, textColor} from '../../src/theme';

const filters = ['All', 'Local', 'Shared', 'Albums', 'People'] as const;
type Filter = typeof filters[number];
type Row = {kind: 'day'; id: string; label: string} | {kind: 'photos'; id: string; items: FotosGalleryItem[]};
const dateLabel = new Intl.DateTimeFormat(undefined, {dateStyle: 'long'});
const numberOfColumns = 3;

function makeRows(items: FotosGalleryItem[], filter: Filter, search: string, people?: ReadonlyMap<string, string[]>): Row[] {
    const groups = new Map<string | undefined, FotosGalleryItem[]>();
    const query = search.trim().toLocaleLowerCase();
    for (const item of items) {
        if ((filter === 'Local' && !item.asset) || (filter === 'Shared' && !item.shared)
            || (filter === 'Albums' && !item.albums.length) || (filter === 'People' && !item.entry?.faceCount)) continue;
        if (query && ![
            item.name, item.entry?.folderPath, item.entry?.exifCamera, item.entry?.exifLens,
            item.date, ...(item.entry?.mediaSubtypes ?? []), ...(item.entry?.tags ?? []), ...item.albums,
            ...(people?.get(item.id) ?? []),
        ].some(value => value?.toLocaleLowerCase().includes(query))) continue;
        const timestamp = item.date ? Date.parse(item.date) : NaN;
        const day = Number.isFinite(timestamp) ? dateLabel.format(timestamp) : undefined;
        const group = groups.get(day) ?? [];
        group.push(item);
        groups.set(day, group);
    }
    return [...groups].flatMap(([day, photos]) => {
        const rows: Row[] = [{kind: 'day', id: `day:${day}`, label: day ?? 'Undated'}];
        for (let offset = 0; offset < photos.length; offset += numberOfColumns) {
            const group = photos.slice(offset, offset + numberOfColumns);
            rows.push({kind: 'photos', id: `row:${group[0].id}`, items: group});
        }
        return rows;
    });
}

export default function LibraryScreen() {
    const model = useModel();
    const inbox = useFotosShareInboxAutoDrainStatus(model);
    const router = useRouter();
    const dark = useColorScheme() === 'dark';
    const [filter, setFilter] = useState<Filter>('All');
    const [search, setSearch] = useState('');
    const searchPeople = filter === 'People' || Boolean(search.trim());
    const gallery = useFotosMobileGallery(model, searchPeople);
    const rows = useMemo(() => makeRows(gallery.items, filter, search, gallery.people), [gallery.items, filter, search, gallery.people]);
    const error = gallery.localError ?? gallery.entryError;
    const loading = gallery.loadingEntries || gallery.loadingPhotos || (searchPeople && !gallery.people);

    return (
        <View style={[styles.screen, {backgroundColor: screenBackground(dark)}]}>
            <View style={styles.controls}>
                <View style={styles.toolbar}>
                    <View style={[styles.search, {backgroundColor: cardBackground(dark), borderColor: borderColor(dark)}]}>
                        <Search size={17} color={mutedTextColor(dark)} />
                        <TextInput accessibilityLabel="Search photos" value={search} onChangeText={setSearch}
                            placeholder="Search photos" placeholderTextColor={mutedTextColor(dark)}
                            style={[styles.searchInput, {color: textColor(dark)}]} returnKeyType="search" clearButtonMode="while-editing" />
                    </View>
                    <Pressable accessibilityRole="button" accessibilityLabel="Open sync status" onPress={() => router.push('/runtime')}
                        style={[styles.pill, {backgroundColor: inbox.lastError ? cardBackground(dark) : mutedCardBackground(dark)}]}>
                        <Cloud size={15} color={inbox.lastError ? palette.danger : palette.accent} />
                        <Text style={{color: textColor(dark), fontWeight: '600', fontSize: 12}}>
                            {inbox.running ? 'Importing' : inbox.lastError ? 'Sync issue' : 'Sync'}
                        </Text>
                    </Pressable>
                </View>
                <View style={styles.filters}>
                    {filters.map(name => (
                        <Pressable key={name} accessibilityRole="button" accessibilityState={{selected: name === filter}}
                            onPress={() => setFilter(name)} style={[styles.filter, name === filter && {backgroundColor: palette.accentSoft}]}>
                            <Text style={{color: name === filter ? palette.accentStrong : mutedTextColor(dark), fontWeight: '700', fontSize: 13}}>{name}</Text>
                        </Pressable>
                    ))}
                </View>
                {gallery.supportsPhotos && gallery.permission && !gallery.permission.granted ? (
                    <Pressable accessibilityRole="button" onPress={() => void (
                        gallery.permission?.canAskAgain ? gallery.requestPermission() : Linking.openSettings()
                    )}>
                        <Text style={styles.action}>{gallery.permission.canAskAgain ? 'Show photos from Apple Photos' : 'Open Photos permission settings'}</Text>
                    </Pressable>
                ) : null}
                {error ? (
                    <Pressable accessibilityRole="button" accessibilityLabel="Refresh library" onPress={gallery.reload}>
                        <Text style={{color: palette.danger}}>{error} Tap to retry.</Text>
                    </Pressable>
                ) : null}
            </View>
            <FlashList<Row>
                data={rows}
                keyExtractor={row => row.id}
                getItemType={row => row.kind}
                contentContainerStyle={styles.grid}
                keyboardShouldPersistTaps="handled"
                onEndReached={() => { if (gallery.canLoadMore && filter !== 'Shared' && !search.trim()) gallery.loadMore(); }}
                onEndReachedThreshold={0.55}
                ListEmptyComponent={(
                    <View style={styles.empty}>
                        {loading ? <ActivityIndicator color={palette.accent} /> : <Images color={mutedTextColor(dark)} size={32} />}
                        <Text style={{color: mutedTextColor(dark)}}>{loading ? 'Loading photos…' : search ? 'No photos match your search' : 'No photos to show'}</Text>
                    </View>
                )}
                ListFooterComponent={gallery.canLoadMore && filter !== 'Shared' ? (
                    <Pressable accessibilityRole="button" onPress={gallery.loadMore} disabled={gallery.loadingPhotos} style={styles.more}>
                        <Text style={styles.action}>{gallery.loadingPhotos ? 'Loading photos…' : 'Load more local photos'}</Text>
                    </Pressable>
                ) : null}
                renderItem={({item}) => item.kind === 'day' ? (
                    <Text accessibilityRole="header" style={[styles.day, {color: textColor(dark)}]}>{item.label}</Text>
                ) : (
                    <View style={styles.photoRow}>
                        {item.items.map(photo => (
                            <Pressable key={photo.id} accessibilityRole="button" accessibilityLabel={photo.name}
                                onPress={() => router.push({pathname: '/photo/[contentHash]', params: {
                                    contentHash: photo.entry?.contentHash ?? (photo.id === photo.asset?.id ? 'local' : photo.id),
                                    assetId: photo.asset?.id, title: photo.name,
                                }})}
                                style={[styles.tile, {backgroundColor: mutedCardBackground(dark)}]}>
                                <FotosGalleryImage item={photo} />
                                <View style={styles.badges} pointerEvents="none">
                                    {photo.owned && <Check size={14} color="white" accessibilityLabel="Synced" />}
                                    {photo.shared && <Cloud size={14} color="white" accessibilityLabel="Shared" />}
                                    {photo.albums.length > 0 && <FolderOpen size={14} color="white" accessibilityLabel="In an album" />}
                                    {Boolean(photo.entry?.tags?.size) && <Tag size={14} color="white" accessibilityLabel="Tagged" />}
                                    {Boolean(photo.entry?.faceCount) && <Users size={14} color="white"
                                        accessibilityLabel={gallery.people?.get(photo.id)?.join(', ') || 'People detected'} />}
                                </View>
                            </Pressable>
                        ))}
                        {Array.from({length: numberOfColumns - item.items.length}, (_, index) => <View key={index} style={styles.tile} />)}
                    </View>
                )}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    screen: {flex: 1},
    controls: {paddingVertical: 10, paddingHorizontal: 12, gap: 10},
    toolbar: {flexDirection: 'row', alignItems: 'center', gap: 8},
    search: {flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 10},
    searchInput: {flex: 1, minHeight: 40, fontSize: 15},
    pill: {flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 16, paddingVertical: 8, paddingHorizontal: 10},
    filters: {flexDirection: 'row', flexWrap: 'wrap', gap: 5},
    filter: {paddingVertical: 7, paddingHorizontal: 11, borderRadius: 16},
    grid: {paddingHorizontal: 6, paddingBottom: 18},
    day: {marginTop: 14, marginBottom: 8, paddingHorizontal: 6, fontSize: 17, fontWeight: '700'},
    photoRow: {flexDirection: 'row', gap: 3, marginBottom: 3},
    tile: {flex: 1, aspectRatio: 1, overflow: 'hidden', borderRadius: 4, justifyContent: 'flex-end', alignItems: 'flex-start'},
    badges: {gap: 3, flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 5, margin: 4},
    empty: {alignItems: 'center', padding: 28, gap: 8},
    more: {alignItems: 'center', padding: 14},
    action: {color: palette.accent, padding: 4, fontWeight: '700'},
});
