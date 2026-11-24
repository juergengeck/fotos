import {useCallback, useMemo, useRef, useState} from 'react';
import {
    ActivityIndicator,
    Linking,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
    useColorScheme,
    useWindowDimensions,
    type NativeScrollEvent,
    type NativeSyntheticEvent,
} from 'react-native';
import {FlashList, type FlashListRef} from '@shopify/flash-list';
import {useRouter} from 'expo-router';
import {Check, Cloud, FolderOpen, Images, Search, Tag, Users} from 'lucide-react-native';
import {useModel} from '../../ios-ui';
import {FotosGalleryImage} from '../../ios-ui/components/FotosGalleryImage';
import {FotosTimelineScrubber} from '../../ios-ui/components/FotosTimelineScrubber';
import {useFotosLibraryAutoSyncStatus} from '../../ios-ui/hooks/useFotosLibraryAutoSync';
import {useFotosMobileGallery} from '../../ios-ui/hooks/useFotosMobileGallery';
import {useFotosShareInboxAutoDrainStatus} from '../../ios-ui/hooks/useFotosShareInboxAutoDrain';
import type {FotosGalleryItem} from '../../ios-ui/services/FotosMobileGallery';
import {
    buildFotosTimelineLayout,
    clampUnit,
    resolveActiveTimelineSection,
    type FotosTimelineRowDescriptor,
} from '../../ios-ui/services/FotosTimelineScrubberModel';
import {borderColor, cardBackground, mutedCardBackground, mutedTextColor, palette, screenBackground, textColor} from '../../src/theme';

const filters = ['All', 'Local', 'Shared', 'Albums', 'People'] as const;
type Filter = typeof filters[number];
type Row =
    | {kind: 'day'; id: string; label: string; shortLabel: string}
    | {kind: 'photos'; id: string; items: FotosGalleryItem[]};
const dateLabel = new Intl.DateTimeFormat(undefined, {dateStyle: 'long'});
const shortDayMonth = new Intl.DateTimeFormat(undefined, {day: 'numeric', month: 'short'});
const shortMonthYear = new Intl.DateTimeFormat(undefined, {month: 'short', year: '2-digit'});
const numberOfColumns = 3;
const DAY_ROW_HEIGHT = 44;

function formatShortDayLabel(timestamp: number, currentYear: number): string {
    const date = new Date(timestamp);
    return date.getFullYear() === currentYear
        ? shortDayMonth.format(date)
        : shortMonthYear.format(date);
}

function makeRows(items: FotosGalleryItem[], filter: Filter, search: string, people?: ReadonlyMap<string, string[]>): Row[] {
    const groups = new Map<string | undefined, {shortLabel: string; photos: FotosGalleryItem[]}>();
    const query = search.trim().toLocaleLowerCase();
    const currentYear = new Date().getFullYear();
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
        let group = groups.get(day);
        if (!group) {
            group = {
                shortLabel: Number.isFinite(timestamp) ? formatShortDayLabel(timestamp, currentYear) : 'Undated',
                photos: [],
            };
            groups.set(day, group);
        }
        group.photos.push(item);
    }
    return [...groups].flatMap(([day, {shortLabel, photos}]) => {
        const rows: Row[] = [{kind: 'day', id: `day:${day}`, label: day ?? 'Undated', shortLabel}];
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
    const librarySync = useFotosLibraryAutoSyncStatus(model);
    const router = useRouter();
    const dark = useColorScheme() === 'dark';
    const window = useWindowDimensions();
    const listRef = useRef<FlashListRef<Row>>(null);
    const [filter, setFilter] = useState<Filter>('All');
    const [search, setSearch] = useState('');
    const [listSize, setListSize] = useState({width: window.width, height: 0});
    const [contentHeight, setContentHeight] = useState(0);
    const [scrollOffset, setScrollOffset] = useState(0);
    const searchPeople = filter === 'People' || Boolean(search.trim());
    const gallery = useFotosMobileGallery(model, searchPeople);
    const rows = useMemo(() => makeRows(gallery.items, filter, search, gallery.people), [gallery.items, filter, search, gallery.people]);
    const error = gallery.localError ?? gallery.entryError;
    const indexingEmpty = librarySync.running && (filter === 'Albums' || filter === 'People' || gallery.items.length === 0);
    const loading = gallery.loadingEntries || gallery.loadingPhotos || indexingEmpty || (searchPeople && !gallery.people);
    const syncIssue = librarySync.lastError ?? inbox.lastError;
    const syncLabel = librarySync.running
        ? (librarySync.discoveredCount > 0 ? `${librarySync.processedCount}/${librarySync.discoveredCount}` : 'Syncing…')
        : inbox.running ? 'Importing' : syncIssue ? 'Sync issue' : 'Sync';
    const showLocalPaging = filter === 'All' || filter === 'Local';

    const photoRowHeight = useMemo(() => {
        const availableWidth = Math.max(120, (listSize.width || window.width) - 12 - (numberOfColumns - 1) * 3);
        return availableWidth / numberOfColumns + 3;
    }, [listSize.width, window.width]);

    const timelineLayout = useMemo(() => {
        const descriptors: FotosTimelineRowDescriptor[] = rows.map(row =>
            row.kind === 'day'
                ? {kind: 'day', label: row.label, shortLabel: row.shortLabel}
                : {kind: 'photos'},
        );
        return buildFotosTimelineLayout({
            rows: descriptors,
            dayRowHeight: DAY_ROW_HEIGHT,
            photoRowHeight,
            viewportHeight: listSize.height,
        });
    }, [rows, photoRowHeight, listSize.height]);

    const effectiveMaxScroll = useMemo(() => {
        const measuredMax = contentHeight > 0 && listSize.height > 0
            ? Math.max(0, contentHeight - listSize.height)
            : 0;
        return Math.max(measuredMax, timelineLayout.maxScroll);
    }, [contentHeight, listSize.height, timelineLayout.maxScroll]);

    const scrollProgress = effectiveMaxScroll > 0 ? clampUnit(scrollOffset / effectiveMaxScroll) : 0;
    const activeSection = useMemo(
        () => resolveActiveTimelineSection(timelineLayout.sections, scrollOffset),
        [timelineLayout.sections, scrollOffset],
    );

    const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const nextOffset = Math.max(0, event.nativeEvent.contentOffset.y);
        setScrollOffset(nextOffset);
    }, []);

    const handleScrubToRatio = useCallback((ratio: number) => {
        const clamped = clampUnit(ratio);
        const targetOffset = clamped * effectiveMaxScroll;
        setScrollOffset(targetOffset);
        listRef.current?.scrollToOffset({offset: targetOffset, animated: false});
        if (clamped >= 0.92 && rows.length > 0 && gallery.canLoadMore && showLocalPaging && !search.trim()) {
            gallery.loadMore();
        }
    }, [effectiveMaxScroll, rows.length, gallery, showLocalPaging, search]);

    const handleScrollToTop = useCallback(() => {
        setScrollOffset(0);
        listRef.current?.scrollToOffset({offset: 0, animated: true});
    }, []);

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
                        style={[styles.pill, {backgroundColor: syncIssue ? cardBackground(dark) : mutedCardBackground(dark)}]}>
                        <Cloud size={15} color={syncIssue ? palette.danger : palette.accent} />
                        <Text numberOfLines={1} style={{color: textColor(dark), fontWeight: '600', fontSize: 12}}>
                            {syncLabel}
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
                        <Text style={styles.action}>{gallery.permission.canAskAgain ? 'Show photos from this device' : 'Open photo permission settings'}</Text>
                    </Pressable>
                ) : null}
                {error ? (
                    <Pressable accessibilityRole="button" accessibilityLabel="Refresh library" onPress={gallery.reload}>
                        <Text style={{color: palette.danger}}>{error} Tap to retry.</Text>
                    </Pressable>
                ) : null}
            </View>
            <View
                style={styles.listContainer}
                onLayout={event => {
                    const {width, height} = event.nativeEvent.layout;
                    setListSize(current =>
                        Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1
                            ? current
                            : {width, height},
                    );
                }}
            >
                <FlashList<Row>
                    ref={listRef}
                    data={rows}
                    keyExtractor={row => row.id}
                    getItemType={row => row.kind}
                    contentContainerStyle={styles.grid}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                    scrollEventThrottle={16}
                    onScroll={handleScroll}
                    onContentSizeChange={(_width, height) => setContentHeight(height)}
                    onEndReached={() => { if (rows.length > 0 && gallery.canLoadMore && showLocalPaging && !search.trim()) gallery.loadMore(); }}
                    onEndReachedThreshold={0.55}
                    ListEmptyComponent={(
                        <View style={styles.empty}>
                            {loading ? <ActivityIndicator color={palette.accent} /> : <Images color={mutedTextColor(dark)} size={32} />}
                            <Text style={{color: mutedTextColor(dark)}}>
                                {indexingEmpty
                                    ? (librarySync.discoveredCount > 0
                                        ? `Indexing local photos and albums… (${librarySync.processedCount}/${librarySync.discoveredCount})`
                                        : 'Indexing local photos and albums…')
                                    : loading ? 'Loading photos…' : search ? 'No photos match your search' : 'No photos to show'}
                            </Text>
                        </View>
                    )}
                    ListFooterComponent={rows.length > 0 && gallery.canLoadMore && showLocalPaging ? (
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
                <FotosTimelineScrubber
                    layout={timelineLayout}
                    progress={scrollProgress}
                    activeLabel={activeSection?.label}
                    onScrubToRatio={handleScrubToRatio}
                    onScrollToTop={handleScrollToTop}
                />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: {flex: 1},
    listContainer: {flex: 1},
    controls: {paddingVertical: 10, paddingHorizontal: 12, gap: 10},
    toolbar: {flexDirection: 'row', alignItems: 'center', gap: 8},
    search: {flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 10},
    searchInput: {flex: 1, minHeight: 40, fontSize: 15},
    pill: {flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 16, paddingVertical: 8, paddingHorizontal: 10, flexShrink: 0},
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
