import { useEffect, useMemo, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { registerExpoFileSystemRqsFiles } from '@expo/snapback-client';
import {
  SnapbackExpoProvider,
  skip,
  useSnapbackAssetImage,
  useSnapbackCommand,
  useSnapbackConnection,
  useSnapbackQuery,
} from '@expo/snapback-expo';
import type { ExpoBootState } from '@expo/snapback-expo';
import { app } from './snapback/generated/app.mjs';
import api from './snapback/generated/api.mjs';
import { mergePagedArchive } from './pagination.mjs';
import type { GeneratedDataModel } from './snapback/generated/api.d.ts';

type Entry = GeneratedDataModel['entries'];

if (Platform.OS !== 'web') {
  registerExpoFileSystemRqsFiles(FileSystem, { crypto: Crypto });
}

function BootFallback({ state }: Readonly<{ state: ExpoBootState }>) {
  const diagnostic = 'diagnostic' in state ? state.diagnostic : null;
  return <SafeAreaView style={styles.fallback}><Text style={styles.brand}>FIELD NOTES</Text><Text style={styles.boot}>{state.status === 'starting' ? 'Opening journal…' : "Journal couldn't start"}</Text>{diagnostic ? <Text style={styles.error}>{diagnostic.code}: {diagnostic.message}</Text> : null}</SafeAreaView>;
}

function FeedImage({ assetId }: Readonly<{ assetId: string }>) {
  const image = useSnapbackAssetImage({ assetId, maxWidth: 1440 });
  if (!image.src) return <View style={styles.photoPlaceholder}><ActivityIndicator color="#fff" /></View>;
  return <Image accessibilityLabel="Journal photo" resizeMode="cover" source={{ uri: image.src }} style={[styles.photo, image.aspectRatio ? { aspectRatio: image.aspectRatio } : null]} />;
}

function Card({ entry }: Readonly<{ entry: Entry }>) {
  return (
    <View style={styles.card}>
      {entry.photo ? <FeedImage assetId={entry.photo} /> : <View style={styles.seedPlaceholder}><Text style={styles.seedMark}>✦</Text></View>}
      <View style={styles.cardCopy}><Text style={styles.author}>{entry.authorName.toUpperCase()}</Text><Text style={styles.caption}>{entry.caption}</Text><Text style={styles.date}>{new Date(entry.createdAt).toLocaleDateString()}</Text></View>
    </View>
  );
}

function Feed() {
  const connection = useSnapbackConnection();
  const first = useSnapbackQuery(api.liveFeed, {});
  const [before, setBefore] = useState<string | null>(null);
  const [archive, setArchive] = useState<readonly Entry[]>([]);
  const previousFirstRows = useRef<readonly Entry[]>([]);
  const [exhausted, setExhausted] = useState(false);
  const older = useSnapbackQuery(api.olderFeedPage, before === null ? skip : { before });
  const publishEntry = useSnapbackCommand(app.commands.publishEntry);
  const [caption, setCaption] = useState('');
  const [authorName, setAuthorName] = useState('You');
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [taskStatus, setTaskStatus] = useState('ready');
  const [error, setError] = useState<string | null>(null);
  const firstReady = first.status === 'ready' || first.status === 'refreshing';
  const firstRows = firstReady ? first.data : [];

  useEffect(() => {
    if (!firstReady) return;
    setArchive((current) => mergePagedArchive({
      archive: current,
      head: firstRows,
      previousHead: previousFirstRows.current,
    }));
    previousFirstRows.current = firstRows;
  }, [firstReady, firstRows]);

  useEffect(() => {
    if (older.status !== 'ready' && older.status !== 'refreshing') return;
    setArchive((current) => mergePagedArchive({ archive: current, head: firstRows, page: older.data }));
    setExhausted(older.data.length < 6);
  }, [firstRows, older]);

  const entries = useMemo(() => {
    const seen = new Set<string>();
    return [...firstRows, ...archive].filter((entry) => {
      if (seen.has(entry._id)) return false;
      seen.add(entry._id);
      return true;
    });
  }, [firstRows, archive]);

  const choosePhoto = async () => {
    setError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError('Photo library access is required.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.88 });
    if (!result.canceled && result.assets[0]) setPhoto(result.assets[0]);
  };

  const publish = async () => {
    if (!photo || !caption.trim() || !authorName.trim()) return;
    setError(null);
    const task = publishEntry({ authorName: authorName.trim(), caption: caption.trim(), photo });
    const off = task.subscribe(() => setTaskStatus(task.snapshot().status));
    setTaskStatus(task.snapshot().status);
    try {
      const outcome = await task.done;
      if (outcome.kind === 'committed') { setCaption(''); setPhoto(null); }
      else if (outcome.kind === 'failed' || outcome.kind === 'ambiguous') setError(outcome.diagnostic.message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { off(); }
  };

  const loadOlder = () => {
    if (exhausted || older.status === 'pending') return;
    const oldest = entries.at(-1);
    if (oldest && oldest.pageKey !== before) setBefore(oldest.pageKey);
  };

  return (
    <SafeAreaView style={styles.screen}>
      <FlatList
        contentContainerStyle={styles.list}
        data={entries}
        keyExtractor={(entry) => entry._id}
        onEndReached={loadOlder}
        onEndReachedThreshold={0.5}
        renderItem={({ item }) => <Card entry={item} />}
        ListHeaderComponent={<>
          <View style={styles.header}><View><Text style={styles.brand}>FIELD NOTES</Text><Text style={styles.title}>Shared journal</Text></View><View style={styles.liveDot}><Text style={styles.live}>{first.freshness === 'retained' ? 'SAVED' : connection.status.toUpperCase()}</Text></View></View>
          <View style={styles.composer}>
            <Text style={styles.composerTitle}>Add a field note</Text>
            <View style={styles.authorRow}><Text style={styles.label}>BY</Text><TextInput accessibilityLabel="Author name" onChangeText={setAuthorName} style={styles.authorInput} value={authorName} /></View>
            <TextInput accessibilityLabel="Caption" multiline onChangeText={setCaption} placeholder="What should you remember?" placeholderTextColor="#8c8276" style={styles.input} value={caption} />
            {photo ? <Image source={{ uri: photo.uri }} style={styles.preview} /> : null}
            <View style={styles.composerActions}><Pressable onPress={() => void choosePhoto()} style={styles.secondary}><Text style={styles.secondaryText}>{photo ? 'Change photo' : 'Choose photo'}</Text></Pressable><Pressable disabled={!photo || !caption.trim()} onPress={() => void publish()} style={[styles.publish, (!photo || !caption.trim()) && styles.disabled]}><Text style={styles.publishText}>Publish</Text></Pressable></View>
            {taskStatus !== 'ready' ? <Text style={styles.status}>upload task · {taskStatus}</Text> : null}{error ? <Text style={styles.error}>{error}</Text> : null}
          </View>
          <Text style={styles.sectionTitle}>RECENT NOTES</Text>
        </>}
        ListFooterComponent={older.status === 'pending' ? <ActivityIndicator color="#c2593b" style={styles.loader} /> : <Text style={styles.end}>{exhausted ? 'End of journal' : 'Scroll for older notes'}</Text>}
      />
    </SafeAreaView>
  );
}

export default function App() {
  return <SnapbackExpoProvider app={app} url={process.env.EXPO_PUBLIC_SNAPBACK_URL} fallback={(state: ExpoBootState) => <BootFallback state={state} />}><Feed /></SnapbackExpoProvider>;
}

const styles = StyleSheet.create({
  screen: { backgroundColor: '#ece8df', flex: 1 }, fallback: { backgroundColor: '#ece8df', flex: 1, justifyContent: 'center', padding: 28 }, boot: { color: '#292720', fontFamily: Platform.select({ ios: 'Georgia', default: 'serif' }), fontSize: 34, marginTop: 8 },
  list: { padding: 18, paddingBottom: 50 }, header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 22, marginTop: 8 }, brand: { color: '#c2593b', fontSize: 11, fontWeight: '900', letterSpacing: 3 }, title: { color: '#292720', fontFamily: Platform.select({ ios: 'Georgia', default: 'serif' }), fontSize: 42, letterSpacing: -1.5 }, liveDot: { backgroundColor: '#d8dfc3', borderRadius: 99, paddingHorizontal: 11, paddingVertical: 7 }, live: { color: '#435036', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  composer: { backgroundColor: '#292720', borderRadius: 20, gap: 12, marginBottom: 28, padding: 18 }, composerTitle: { color: '#fffaf0', fontFamily: Platform.select({ ios: 'Georgia', default: 'serif' }), fontSize: 25 }, authorRow: { alignItems: 'center', flexDirection: 'row', gap: 9 }, label: { color: '#b9b0a3', fontSize: 9, fontWeight: '900', letterSpacing: 2 }, authorInput: { borderBottomColor: '#6b6258', borderBottomWidth: 1, color: '#fffaf0', flex: 1, paddingVertical: 5 }, input: { backgroundColor: '#3a3730', borderRadius: 11, color: '#fffaf0', minHeight: 72, padding: 12, textAlignVertical: 'top' }, preview: { borderRadius: 10, height: 160, width: '100%' }, composerActions: { flexDirection: 'row', gap: 10 }, secondary: { borderColor: '#84796d', borderRadius: 9, borderWidth: 1, padding: 11 }, secondaryText: { color: '#fffaf0', fontWeight: '800' }, publish: { backgroundColor: '#c2593b', borderRadius: 9, flex: 1, padding: 11 }, publishText: { color: '#fff', fontWeight: '900', textAlign: 'center' }, disabled: { opacity: 0.35 }, status: { color: '#d9c487', fontSize: 11 }, error: { color: '#f39b87', fontSize: 11 },
  sectionTitle: { color: '#796f63', fontSize: 10, fontWeight: '900', letterSpacing: 2.4, marginBottom: 11 }, card: { backgroundColor: '#faf7ef', borderColor: '#d8d0c4', borderRadius: 17, borderWidth: 1, marginBottom: 17, overflow: 'hidden' }, photo: { minHeight: 260, width: '100%' }, photoPlaceholder: { alignItems: 'center', backgroundColor: '#827a70', height: 260, justifyContent: 'center' }, seedPlaceholder: { alignItems: 'center', backgroundColor: '#d8dfc3', height: 120, justifyContent: 'center' }, seedMark: { color: '#71804e', fontSize: 32 }, cardCopy: { gap: 7, padding: 16 }, author: { color: '#c2593b', fontSize: 9, fontWeight: '900', letterSpacing: 2 }, caption: { color: '#292720', fontFamily: Platform.select({ ios: 'Georgia', default: 'serif' }), fontSize: 22, lineHeight: 29 }, date: { color: '#8b8175', fontSize: 10 }, loader: { margin: 24 }, end: { color: '#877d72', fontSize: 11, padding: 20, textAlign: 'center' },
});
