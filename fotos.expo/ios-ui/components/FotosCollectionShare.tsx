import {useState} from 'react';
import {ActivityIndicator, Pressable, StyleSheet, Text, View} from 'react-native';
import {Share2} from 'lucide-react-native';
import type {FotosCollection} from '@refinio/fotos.core';
import {useModel} from '../hooks/ModelContext';
import {mutedTextColor, palette, textColor} from '../../src/theme';

export function FotosCollectionShare({collections, dark}: {collections: FotosCollection[]; dark: boolean}) {
    const model = useModel();
    const [open, setOpen] = useState(false);
    const [collectionId, setCollectionId] = useState<string>();
    const [peerId, setPeerId] = useState<string>();
    const [peers, setPeers] = useState<Array<{id: string; name: string}>>([]);
    const [loading, setLoading] = useState(false);
    const [publishing, setPublishing] = useState(false);
    const [message, setMessage] = useState<string>();
    const collection = collections.find(item => item.id === collectionId);
    const peer = peers.find(item => item.id === peerId);

    async function openPicker() {
        setOpen(true);
        setLoading(true);
        setCollectionId(collections.length === 1 ? collections[0].id : undefined);
        setPeerId(undefined);
        setPeers([]);
        setMessage(undefined);
        try {
            setPeers(await model.listTrustedFotosPeers());
        } catch (error) {
            setMessage(error instanceof Error ? error.message : String(error));
        } finally {
            setLoading(false);
        }
    }

    async function publish() {
        if (!collection || !peer || publishing) return;
        setPublishing(true);
        setMessage(undefined);
        try {
            await model.shareFotosCollection(collection.id, peer.id);
            setMessage(`${collection.name} shared with ${peer.name}.`);
            setOpen(false);
        } catch (error) {
            setMessage(error instanceof Error ? error.message : String(error));
        } finally {
            setPublishing(false);
        }
    }

    if (collections.length === 0) return null;
    return (
        <View style={styles.group}>
            {!open ? (
                <Pressable accessibilityRole="button" onPress={() => void openPicker()} style={styles.actionRow}>
                    <Share2 size={18} color={palette.accent} />
                    <Text style={styles.action}>Share a collection</Text>
                </Pressable>
            ) : (
                <>
                    {collections.length > 1 ? (
                        <View style={styles.group}>
                            <Text style={{color: mutedTextColor(dark)}}>Collection</Text>
                            {collections.map(item => (
                                <Pressable key={item.id} accessibilityRole="radio" accessibilityState={{checked: item.id === collectionId}}
                                    onPress={() => setCollectionId(item.id)} disabled={publishing} style={styles.option}>
                                    <Text style={{color: item.id === collectionId ? palette.accent : textColor(dark)}}>{item.name}</Text>
                                </Pressable>
                            ))}
                        </View>
                    ) : <Text style={{color: textColor(dark)}}>{collection?.name}</Text>}
                    <Text style={{color: mutedTextColor(dark)}}>Trusted peer</Text>
                    {loading ? <ActivityIndicator color={palette.accent} /> : peers.map(item => (
                        <Pressable key={item.id} accessibilityRole="radio" accessibilityState={{checked: item.id === peerId}}
                            onPress={() => setPeerId(item.id)} disabled={publishing} style={styles.option}>
                            <Text style={{color: item.id === peerId ? palette.accent : textColor(dark)}}>{item.name}</Text>
                        </Pressable>
                    ))}
                    {!loading && !peers.length && !message ? <Text style={{color: mutedTextColor(dark)}}>No trusted peers are available.</Text> : null}
                    <View style={styles.actionRow}>
                        <Pressable accessibilityRole="button" disabled={!collection || !peer || publishing} onPress={() => void publish()}>
                            <Text style={[styles.action, (!collection || !peer || publishing) && {color: mutedTextColor(dark)}]}>
                                {publishing ? 'Sharing…' : 'Share collection'}
                            </Text>
                        </Pressable>
                        <Pressable accessibilityRole="button" disabled={loading || publishing} onPress={() => setOpen(false)}>
                            <Text style={{color: textColor(dark)}}>Cancel</Text>
                        </Pressable>
                    </View>
                </>
            )}
            {message ? <Text accessibilityLiveRegion="polite" style={{color: textColor(dark)}}>{message}</Text> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    group: {gap: 8},
    option: {minHeight: 32, justifyContent: 'center'},
    actionRow: {flexDirection: 'row', alignItems: 'center', gap: 10},
    action: {color: palette.accent, fontWeight: '700'},
});
