import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Image,
  Modal,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useTVEventHandler,
  useWindowDimensions,
} from 'react-native';
import {PairingCode} from './PairingCode';
import {adjacentPhotoId, canShowPhoto} from './navigation';
import type {FirePhoto, FireTvAppProps} from './types';

const SLIDE_DURATION_MS = 8000;
const COLUMNS = 4;

function TvButton({label, onPress, preferred = false, disabled = false, compact = false, scale = 1}: {
  label: string;
  onPress: () => void;
  preferred?: boolean;
  disabled?: boolean;
  compact?: boolean;
  scale?: number;
}) {
  const [focused, setFocused] = useState(false);
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={{disabled}}
    disabled={disabled}
    focusable={!disabled}
    hasTVPreferredFocus={preferred}
    onFocus={() => setFocused(true)}
    onBlur={() => setFocused(false)}
    onPress={onPress}
    style={{
      minHeight: (compact ? 42 : 50) * scale,
      paddingHorizontal: 22 * scale,
      justifyContent: 'center',
      borderRadius: 10 * scale,
      borderWidth: 2 * scale,
      borderColor: focused ? '#d4ffc1' : '#34414b',
      backgroundColor: focused ? '#c5f5ae' : '#1b2933',
      opacity: disabled ? 0.4 : 1,
      transform: [{scale: focused ? 1.035 : 1}],
    }}>
    <Text style={{color: focused ? '#122219' : '#edf1f0', fontSize: 17 * scale, fontWeight: '600'}}>{label}</Text>
  </Pressable>;
}

function PhotoTile({photo, width, scale, preferred, onPress}: {
  photo: FirePhoto;
  width: number;
  scale: number;
  preferred: boolean;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const [failedUri, setFailedUri] = useState<string>();
  const uri = photo.thumbnailUri || (canShowPhoto(photo) ? photo.mediaUri : undefined);
  const video = photo.mimeType?.startsWith('video/');
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={`${photo.name}${video ? ', video, playback unavailable' : ''}`}
    hasTVPreferredFocus={preferred}
    onFocus={() => setFocused(true)}
    onBlur={() => setFocused(false)}
    onPress={onPress}
    style={{width, borderRadius: 11 * scale, padding: 3 * scale, borderWidth: 2 * scale, borderColor: focused ? '#c5f5ae' : 'transparent', backgroundColor: focused ? '#1e352a' : '#111b24'}}>
    <View style={{height: (width - 10 * scale) * 0.61, borderRadius: 6 * scale, overflow: 'hidden', backgroundColor: '#1d2a34', justifyContent: 'center', alignItems: 'center'}}>
      {uri && failedUri !== uri
        ? <Image source={{uri}} resizeMode="cover" onError={() => setFailedUri(uri)} style={StyleSheet.absoluteFill} />
        : <Text style={{fontSize: 14 * scale, color: '#b4c1c9'}}>{video ? 'Video' : 'Preview unavailable'}</Text>}
      {video && <View style={{position: 'absolute', bottom: 8 * scale, right: 8 * scale, paddingHorizontal: 7 * scale, paddingVertical: 3 * scale, borderRadius: 4 * scale, backgroundColor: '#0c141de6'}}>
        <Text style={{fontSize: 10 * scale, color: '#ffffff', fontWeight: '700'}}>VIDEO</Text>
      </View>}
    </View>
    <Text numberOfLines={1} style={{fontSize: 14 * scale, lineHeight: 18 * scale, color: focused ? '#e0ffd1' : '#dce4e7', marginHorizontal: 7 * scale, marginTop: 9 * scale, marginBottom: 8 * scale}}>{photo.name || 'Untitled photo'}</Text>
  </Pressable>;
}

function formatDate(value?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toLocaleDateString(undefined, {year: 'numeric', month: 'long', day: 'numeric'});
}

function PhotoViewer({photo, index, count, playing, scale, onToggle}: {
  photo: FirePhoto;
  index: number;
  count: number;
  playing: boolean;
  scale: number;
  onToggle: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const supported = canShowPhoto(photo);
  const date = formatDate(photo.takenAt);
  return <Pressable
    style={styles.viewer}
    hasTVPreferredFocus
    accessibilityRole="button"
    accessibilityLabel={`${photo.name}. ${index + 1} of ${count}. ${playing ? 'Pause' : 'Start'} slideshow. Use left and right to browse, Back for gallery.`}
    onPress={onToggle}>
    {supported && !failed && <Image
      source={{uri: photo.mediaUri}}
      resizeMode="contain"
      style={StyleSheet.absoluteFill}
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
    />}
    {supported && !loaded && !failed && <View style={styles.viewerMessage}><ActivityIndicator color="#c5f5ae" size="large" /><Text style={[styles.muted, {fontSize: 17 * scale, marginTop: 16 * scale}]}>Loading photo…</Text></View>}
    {(!supported || failed) && <View style={styles.viewerMessage}>
      <Text style={{color: '#f2f5f3', fontSize: 30 * scale, fontWeight: '600'}}>{photo.mimeType?.startsWith('video/') ? 'Video playback unavailable' : 'Photo unavailable'}</Text>
      <Text style={{color: '#b4c1c9', fontSize: 17 * scale, marginTop: 12 * scale, textAlign: 'center'}}>{photo.mimeType?.startsWith('video/') ? 'Open this video on your connected Fotos device.' : failed ? 'This image could not be opened. Try another photo.' : 'The original image is not available on this TV yet.'}</Text>
    </View>}
    <View pointerEvents="none" style={{position: 'absolute', left: 48 * scale, right: 48 * scale, bottom: 30 * scale, gap: 14 * scale}}>
      <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 24 * scale, backgroundColor: '#09111be8', padding: 16 * scale, borderRadius: 10 * scale}}>
        <View style={{flex: 1, gap: 5 * scale}}>
          <Text numberOfLines={1} style={{color: '#f5f7f4', fontSize: 20 * scale, fontWeight: '600'}}>{photo.name || 'Untitled photo'}</Text>
          {date && <Text style={{color: '#b4c1c9', fontSize: 13 * scale}}>{date}</Text>}
        </View>
        <Text style={{fontSize: 14 * scale, color: playing ? '#c5f5ae' : '#b4c1c9'}}>{playing ? 'SLIDESHOW  •  8 SEC' : 'PAUSED'}   {index + 1} / {count}</Text>
      </View>
      <Text style={{color: '#c5ced3', fontSize: 13 * scale, textAlign: 'center'}}>← →  Browse     ·     Select / Play  {playing ? 'Pause' : 'Slideshow'}     ·     Back  Gallery</Text>
    </View>
  </Pressable>;
}

export function FireTvApp({status, error, photos, deviceName, pairingUrl, pairingBusy, pairingError, onPair, onClosePairing, onRetry}: FireTvAppProps) {
  const {width, height} = useWindowDimensions();
  const scale = Math.min(width / 960, height / 540);
  const safe = 48 * scale;
  const gap = 14 * scale;
  const tileWidth = (width - 2 * safe - gap * (COLUMNS - 1)) / COLUMNS;
  const tileHeight = (tileWidth - 10 * scale) * 0.61 + 45 * scale;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pairingOpen, setPairingOpen] = useState(false);
  const selectedIndex = photos.findIndex(photo => photo.id === selectedId);
  const selected = selectedIndex >= 0 ? photos[selectedIndex] : undefined;
  const restoredIndex = Math.max(0, photos.findIndex(photo => photo.id === lastSelectedId));
  const playable = useMemo(() => photos.filter(canShowPhoto), [photos]);
  const showPairing = pairingOpen || pairingBusy || Boolean(pairingUrl);

  const closeViewer = useCallback(() => {setLastSelectedId(selectedId); setSelectedId(null); setPlaying(false);}, [selectedId]);
  const closePairing = useCallback(() => {setPairingOpen(false); onClosePairing();}, [onClosePairing]);
  const openPairing = useCallback(() => {setPairingOpen(true); setPlaying(false); onPair();}, [onPair]);
  const openPhoto = useCallback((id: string) => {setLastSelectedId(id); setSelectedId(id); setPlaying(false);}, []);
  const toggleSlideshow = useCallback(() => {
    if (playable.length === 0) return;
    if (playing) {setPlaying(false); return;}
    if (!selected || !canShowPhoto(selected)) setSelectedId(playable[0].id);
    setPlaying(true);
  }, [playable, playing, selected]);

  useEffect(() => {
    if (selectedId !== null && !selected) closeViewer();
  }, [selectedId, selected, closeViewer]);

  useEffect(() => {
    if (!playing || showPairing || !selected || playable.length < 2) return;
    const timeout = setTimeout(() => {
      setSelectedId(adjacentPhotoId(photos, selected.id, 1, true));
    }, SLIDE_DURATION_MS);
    return () => clearTimeout(timeout);
  }, [playing, showPairing, selected, photos, playable.length]);

  useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (showPairing) {closePairing(); return true;}
      if (selectedId !== null) {closeViewer(); return true;}
      return false;
    });
    return () => handler.remove();
  }, [closePairing, closeViewer, selectedId, showPairing]);

  useTVEventHandler(event => {
    if (showPairing || event.eventKeyAction === 1) return;
    if (event.eventType === 'playPause') {toggleSlideshow(); return;}
    if (!selected || (event.eventType !== 'left' && event.eventType !== 'right')) return;
    setPlaying(false);
    const id = adjacentPhotoId(photos, selected.id, event.eventType === 'left' ? -1 : 1);
    setSelectedId(id);
    setLastSelectedId(id);
  });

  return <View style={styles.root}>
    <StatusBar hidden />
    {selected ? <PhotoViewer key={`${selected.id}:${selected.mediaUri || ''}`} photo={selected} index={selectedIndex} count={photos.length} playing={playing} scale={scale} onToggle={toggleSlideshow} /> : <View style={{flex: 1, paddingHorizontal: safe, paddingTop: 30 * scale, paddingBottom: 22 * scale}}>
      <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 24 * scale, marginBottom: 26 * scale}}>
        <View style={{flex: 1}}>
          <Text style={{color: '#c5f5ae', fontSize: 12 * scale, fontWeight: '700', letterSpacing: 3 * scale}}>FOTOS / TV</Text>
          <Text style={{color: '#f1f5f1', fontSize: 32 * scale, fontWeight: '600', marginTop: 5 * scale}}>Your photos. A bigger view.</Text>
        </View>
        <TvButton label="Pair a device" onPress={openPairing} disabled={status !== 'ready'} preferred={status === 'ready' && photos.length === 0} compact scale={scale} />
      </View>
      {photos.length > 0 ? <>
        <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 * scale}}>
          <View style={{gap: 4 * scale, flex: 1}}>
            <Text style={{color: '#eef3ef', fontSize: 19 * scale, fontWeight: '600'}}>Your gallery <Text style={{color: '#8c9ca7', fontWeight: '400'}}> / {photos.length}</Text></Text>
            <Text style={{color: '#8c9ca7', fontSize: 12 * scale}}>{status === 'error' ? error || 'Connection interrupted. Your downloaded photos are still here.' : status === 'starting' ? 'Connecting to your Fotos library…' : 'Choose a photo to fill the screen.'}</Text>
          </View>
          {status === 'error' ? <TvButton label="Reconnect" onPress={onRetry} compact scale={scale} /> : <TvButton label="Play slideshow" onPress={toggleSlideshow} disabled={playable.length === 0} compact scale={scale} />}
        </View>
        <FlatList
          data={photos}
          keyExtractor={photo => photo.id}
          numColumns={COLUMNS}
          extraData={lastSelectedId}
          columnWrapperStyle={{gap}}
          contentContainerStyle={{gap, paddingBottom: 12 * scale}}
          showsVerticalScrollIndicator={false}
          // FlatList virtualizes rows when numColumns is set. Restore the row
          // containing the preferred tile, including selections far down the list.
          initialScrollIndex={Math.floor(restoredIndex / COLUMNS)}
          getItemLayout={(_, row) => ({length: tileHeight, offset: row * (tileHeight + gap), index: row})}
          initialNumToRender={4}
          maxToRenderPerBatch={8}
          windowSize={5}
          renderItem={({item, index}) => <PhotoTile photo={item} width={tileWidth} scale={scale} preferred={index === restoredIndex} onPress={() => openPhoto(item.id)} />}
        />
      </> : <View style={styles.empty}>
        {status === 'starting' ? <>
          <ActivityIndicator color="#c5f5ae" size="large" />
          <Text style={{color: '#f2f5f3', fontSize: 28 * scale, fontWeight: '600', marginTop: 22 * scale}}>Opening your library</Text>
          <Text style={{color: '#9eafb9', fontSize: 17 * scale, marginTop: 10 * scale}}>Getting Fotos ready on this TV…</Text>
        </> : status === 'error' ? <>
          <Text style={{color: '#f2f5f3', fontSize: 28 * scale, fontWeight: '600'}}>Fotos could not connect</Text>
          <Text style={{color: '#b4c1c9', fontSize: 17 * scale, marginTop: 12 * scale, textAlign: 'center', maxWidth: 610 * scale}}>{error || 'Please try connecting again.'}</Text>
          <View style={{marginTop: 24 * scale}}><TvButton label="Try again" onPress={onRetry} preferred scale={scale} /></View>
        </> : <>
          <View style={{width: 66 * scale, height: 54 * scale, borderWidth: 2 * scale, borderColor: '#51695c', borderRadius: 10 * scale, justifyContent: 'center', alignItems: 'center', marginBottom: 22 * scale}}><Text style={{color: '#c5f5ae', fontSize: 29 * scale}}>＋</Text></View>
          <Text style={{color: '#f2f5f3', fontSize: 31 * scale, fontWeight: '600'}}>Bring your photos to the big screen</Text>
          <Text style={{color: '#a9b8c0', fontSize: 17 * scale, lineHeight: 26 * scale, textAlign: 'center', maxWidth: 610 * scale, marginTop: 14 * scale}}>Pair this TV with an existing Fotos device.{"\n"}Your shared photos will appear here.</Text>
          <Text style={{color: '#708794', fontSize: 13 * scale, marginTop: 20 * scale}}>Choose “Pair a device” above to get started.</Text>
        </>}
      </View>}
      <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 15 * scale, gap: 24 * scale}}>
        <Text numberOfLines={1} style={{color: '#718591', fontSize: 12 * scale, flex: 1}}>{deviceName || 'Fotos TV'}</Text>
        <Text style={{color: '#718591', fontSize: 12 * scale}}>D-pad  Explore     ·     Select  Open     ·     Play  Slideshow</Text>
      </View>
    </View>}
    <Modal visible={showPairing} transparent animationType="fade" onRequestClose={closePairing} supportedOrientations={['landscape']}>
      <View style={styles.modalBackdrop}>
        <View style={{width: Math.min(width - 96 * scale, 780 * scale), padding: 30 * scale, borderRadius: 18 * scale, backgroundColor: '#14212b', borderColor: '#33444f', borderWidth: scale}}>
          <Text style={{color: '#c5f5ae', fontSize: 12 * scale, fontWeight: '700', letterSpacing: 2 * scale}}>CONNECT YOUR LIBRARY</Text>
          <Text style={{color: '#f2f5f3', fontSize: 28 * scale, fontWeight: '600', marginTop: 8 * scale}}>Pair with Fotos</Text>
          <View style={{flexDirection: 'row', gap: 28 * scale, marginTop: 22 * scale, alignItems: 'center'}}>
            <View style={{width: 198 * scale, height: 198 * scale, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1d303c', borderRadius: 8 * scale, overflow: 'hidden'}}>
              {pairingUrl ? <PairingCode url={pairingUrl} size={198 * scale} /> : pairingError ? <Text style={{color: '#edbba9', fontSize: 15 * scale, padding: 20 * scale, textAlign: 'center'}}>Invitation unavailable</Text> : <ActivityIndicator size="large" color="#c5f5ae" />}
            </View>
            <View style={{flex: 1, gap: 13 * scale}}>
              <Text style={{color: '#edf3ef', fontSize: 19 * scale, fontWeight: '600'}}>{pairingError ? 'Please try again' : pairingUrl ? 'Use this invitation in Fotos' : 'Preparing your invitation…'}</Text>
              <Text style={{color: '#b1c0c8', fontSize: 15 * scale, lineHeight: 22 * scale}}>{pairingError || 'Scan this code with your phone and copy the complete link, including everything after #. In Fotos on that device, open Settings → Devices → Use an invitation. Paste the link, then choose “Pair this device”.'}</Text>
              <Text style={{color: '#7e97a5', fontSize: 13 * scale, lineHeight: 20 * scale}}>Pairing connects the devices. To show photos here, share your gallery with this TV from your existing Fotos device.</Text>
            </View>
          </View>
          {pairingUrl && <Text numberOfLines={3} selectable={false} style={{fontSize: 11 * scale, lineHeight: 15 * scale, color: '#94a9b5', marginTop: 16 * scale}}>{pairingUrl}</Text>}
          <View style={{flexDirection: 'row', justifyContent: 'flex-end', gap: 12 * scale, marginTop: 22 * scale}}>
            {pairingError && <TvButton label="Try again" onPress={onPair} disabled={pairingBusy} scale={scale} />}
            <TvButton label="Done" onPress={closePairing} preferred scale={scale} />
          </View>
        </View>
      </View>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#0b141d'},
  viewer: {flex: 1, backgroundColor: '#000000'},
  viewerMessage: {flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: '10%', paddingBottom: 70},
  muted: {color: '#b4c1c9'},
  empty: {flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 20},
  modalBackdrop: {flex: 1, backgroundColor: '#040a12e8', alignItems: 'center', justifyContent: 'center'},
});
