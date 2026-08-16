import { useEffect, useMemo, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  useSnapbackCommand,
  useSnapbackConnection,
  useSnapbackMedia,
  useSnapbackMediaCollection,
  useSnapbackMutation,
  useSnapbackQuery,
} from '@expo/snapback-expo';
import type { MediaCommandTaskSnapshot, MediaRef } from '@expo/snapback-expo';

import type { MediaPostPersona } from '../personas.mjs';
import api from '../snapback/generated/api.mjs';
import { app } from '../snapback/generated/app.mjs';
import type { GeneratedDataModel, Id } from '../snapback/generated/api.d.ts';

type Profile = GeneratedDataModel['profiles'];
type Post = GeneratedDataModel['posts'];

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function diagnosticMessage(outcome: unknown, fallback: string) {
  if (!outcome || typeof outcome !== 'object') return fallback;
  const diagnostic = 'diagnostic' in outcome ? outcome.diagnostic : null;
  if (diagnostic && typeof diagnostic === 'object' && 'message' in diagnostic) {
    return String(diagnostic.message);
  }
  return fallback;
}

// The runtime returns LLP 0244's projected shape. The current generated
// document model still names the physical asset-id column as string, so keep
// this boundary defensive until generated query result types project mediaRef.
function projectedAvatar(value: unknown): MediaRef<'image'> | null {
  if (typeof value === 'string' && value.length > 0) {
    return { assetId: value, kind: 'image' };
  }
  if (
    value !== null
    && typeof value === 'object'
    && 'assetId' in value
    && typeof value.assetId === 'string'
    && 'kind' in value
    && value.kind === 'image'
  ) {
    return { assetId: value.assetId, kind: value.kind };
  }
  return null;
}

function Avatar({ profile, accent, changing }: Readonly<{
  profile: Profile | undefined;
  accent: string;
  changing: boolean;
}>) {
  const avatar = useSnapbackMedia(projectedAvatar(profile?.avatar), { widthPx: 240 });
  return (
    <View style={styles.avatarFrame}>
      {avatar.status === 'ready' || avatar.status === 'refreshing' ? (
        <Image
          accessibilityLabel={`${profile?.displayName ?? 'Persona'} avatar`}
          source={{ uri: avatar.url }}
          style={styles.avatar}
        />
      ) : (
        <View
          style={[styles.avatar, styles.avatarFallback, { backgroundColor: accent }]}
        >
          {avatar.status === 'issuing' ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.avatarInitial}>{profile?.displayName.slice(0, 1) ?? '·'}</Text>
          )}
        </View>
      )}
      {changing ? (
        <View style={styles.avatarBusy}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : null}
    </View>
  );
}

function SelectedMedia({ assets, onClear }: Readonly<{
  assets: readonly ImagePicker.ImagePickerAsset[];
  onClear: () => void;
}>) {
  if (assets.length === 0) return null;
  return (
    <View style={styles.selectionBlock}>
      <View style={styles.selectionHeader}>
        <Text style={styles.selectionLabel}>{assets.length} selected · order preserved</Text>
        <Pressable onPress={onClear}><Text style={styles.clear}>Clear</Text></Pressable>
      </View>
      <View style={styles.selectionRow}>
        {assets.map((asset, index) => asset.type === 'video' ? (
          <View key={`${asset.uri}:${index}`} style={[styles.selectedTile, styles.selectedVideo]}>
            <Text style={styles.videoMark}>▶</Text>
            <Text style={styles.videoLabel}>VIDEO</Text>
          </View>
        ) : (
          <Image key={`${asset.uri}:${index}`} source={{ uri: asset.uri }} style={styles.selectedTile} />
        ))}
      </View>
    </View>
  );
}

function TaskProgress({ snapshot }: Readonly<{ snapshot: MediaCommandTaskSnapshot<unknown> | null }>) {
  if (!snapshot) return null;
  const overall = snapshot.progress.totalBytes > 0
    ? Math.round((snapshot.progress.bytesTransferred / snapshot.progress.totalBytes) * 100)
    : snapshot.status === 'committed' ? 100 : 0;
  return (
    <View style={styles.taskCard}>
      <View style={styles.taskHeading}>
        <Text style={styles.taskPhase}>task · {snapshot.status}</Text>
        <Text style={styles.taskPhase}>{overall}%</Text>
      </View>
      <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${overall}%` }]} /></View>
      {snapshot.items.map((item) => {
        const itemPercent = item.asset && item.asset.totalBytes > 0
          ? Math.round((item.asset.bytesTransferred / item.asset.totalBytes) * 100)
          : item.asset?.status === 'ready' ? 100 : 0;
        return (
          <View key={item.ordinal} style={styles.itemProgress}>
            <Text style={styles.itemProgressText}>#{item.ordinal + 1} · {item.status}</Text>
            <Text style={styles.itemProgressText}>{itemPercent}%</Text>
          </View>
        );
      })}
    </View>
  );
}

function PostMedia({ postId }: Readonly<{ postId: Id<'posts'> }>) {
  const [gridWidth, setGridWidth] = useState<number | null>(null);
  const collection = useSnapbackQuery(api.postMediaList, { parentId: postId });
  const children = collection.status === 'ready' || collection.status === 'refreshing'
    ? collection.data[0]?.children ?? []
    : [];
  // @ref LLP 0239#d5-one-media-projection-handles-empty-image-video-denial-and-refresh — one
  // collection store keeps delivery state keyed by durable child itemId.
  const media = useSnapbackMediaCollection(children, { widthPx: 960 });


  if (collection.status === 'pending') {
    return <ActivityIndicator color="#9d5039" style={styles.mediaPending} />;
  }
  if (collection.status === 'error') {
    return <Text style={styles.mediaError}>{collection.error.message}</Text>;
  }
  if (media.length === 0) return null;

  return (
    <View
      style={styles.mediaGrid}
      onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}
    >
      {media.map((item) => {
        const state = item.state;
        // Explicit pixel tiles: aspectRatio + percent width collapses to
        // content height on this RN/Yoga version, which blanks a bare Image.
        const side = gridWidth === null ? 160 : Math.floor((gridWidth - 7) / 2);
        const tileSize = { width: side, height: side };
        const kind = state.status === 'empty' ? null : state.media.kind;
        if (state.status === 'denied' || state.status === 'unavailable') {
          return (
            <View key={item.itemId} style={[styles.mediaTile, tileSize, styles.mediaUnavailable]}>
              <Text style={styles.unavailableTitle}>{state.status.toUpperCase()}</Text>
              <Text style={styles.unavailableCopy}>Only this attachment is unavailable.</Text>
            </View>
          );
        }
        if ((state.status === 'ready' || state.status === 'refreshing') && kind === 'image') {
          return (
            <Image
              accessibilityLabel={`Post image ${item.ordinal + 1}`}
              key={item.itemId}
              resizeMode="cover"
              source={{ uri: state.url }}
              style={[styles.mediaTile, tileSize]}
            />
          );
        }
        if (kind === 'video') {
          return (
            <View key={item.itemId} style={[styles.mediaTile, tileSize, styles.videoTile]}>
              <Text style={styles.videoTileMark}>▶</Text>
              <Text style={styles.videoTileTitle}>VIDEO</Text>
              <Text style={styles.videoTileCopy}>
                {state.status === 'ready' || state.status === 'refreshing'
                  ? 'Delivered · playback not claimed'
                  : 'Preparing delivery'}
              </Text>
            </View>
          );
        }
        return (
          <View key={item.itemId} style={[styles.mediaTile, tileSize, styles.mediaLoading]}>
            <ActivityIndicator color="#fff" />
            <Text style={styles.mediaLoadingText}>{state.status}</Text>
          </View>
        );
      })}
    </View>
  );
}

function PostCard({ post, persona }: Readonly<{ post: Post; persona: MediaPostPersona }>) {
  return (
    <View style={styles.postCard}>
      <View style={styles.postMeta}>
        <View style={[styles.postDot, { backgroundColor: persona.accent }]} />
        <Text style={styles.postAuthor}>{persona.displayName}</Text>
        <Text style={styles.postTime}>{new Date(post._createdAt).toLocaleString()}</Text>
      </View>
      <Text style={styles.postBody}>{post.body}</Text>
      <PostMedia postId={post._id} />
    </View>
  );
}

export default function MediaPostScreen({ persona, onSignOut }: Readonly<{
  persona: MediaPostPersona;
  onSignOut: () => void;
}>) {
  const connection = useSnapbackConnection();
  const profiles = useSnapbackQuery(api.listProfiles, {});
  const posts = useSnapbackQuery(api.listPosts, {});
  const ensureProfile = useSnapbackMutation(api.ensureProfile);
  const changeAvatar = useSnapbackCommand(app.commands.changeAvatar);
  const createPost = useSnapbackCommand(app.commands.createPost);
  const [body, setBody] = useState('');
  const [selection, setSelection] = useState<readonly ImagePicker.ImagePickerAsset[]>([]);
  const [task, setTask] = useState<MediaCommandTaskSnapshot<unknown> | null>(null);
  const [avatarStatus, setAvatarStatus] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const profile = profiles.status === 'ready' || profiles.status === 'refreshing'
    ? profiles.data[0]
    : undefined;
  const feed = posts.status === 'ready' || posts.status === 'refreshing'
    ? posts.data
    : [];
  const posting = task !== null && ['validating', 'uploading', 'committing'].includes(task.status);

  useEffect(() => {
    void ensureProfile({ displayName: persona.displayName }).catch((cause) => setError(errorText(cause)));
  }, [ensureProfile, persona.displayName]);

  const pickAvatar = async () => {
    setAvatarError(null);
    let unsubscribe: (() => void) | undefined;
    try {
      if (!profile) {
        setAvatarError('Your profile is still loading. Please try changing the avatar again.');
        return;
      }
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setAvatarError('Photo library access is required to change the avatar.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsMultipleSelection: false,
        mediaTypes: ['images'],
        quality: 0.9,
        // iPhone libraries are HEIC-first; compatible mode transcodes to JPEG.
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      if (result.canceled) {
        // Explicit picker cancellation is the only intentionally silent exit.
        return;
      }
      const asset = result.assets[0];
      if (!asset) {
        setAvatarError('The photo picker returned no image. Please try again.');
        return;
      }
      const command = changeAvatar({ profileId: profile._id, avatar: asset });
      unsubscribe = command.subscribe(() => setAvatarStatus(command.snapshot().status));
      setAvatarStatus(command.snapshot().status);
      const outcome = await command.done;
      if (outcome.kind !== 'committed') {
        setAvatarError(diagnosticMessage(outcome, 'Avatar update did not commit.'));
      }
    } catch (cause) {
      setAvatarError(`Avatar change failed: ${errorText(cause)}`);
    } finally {
      unsubscribe?.();
      setAvatarStatus(null);
    }
  };

  const pickPostMedia = async () => {
    setError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Photo library access is required to choose post media.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: true,
      mediaTypes: ['images', 'videos'],
      selectionLimit: 4,
      quality: 0.88,
      preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (!result.canceled) setSelection(result.assets.slice(0, 4));
  };

  const publish = async () => {
    const text = body.trim();
    if (!text || posting) return;
    setError(null);
    const command = createPost({
      body: text,
      ...(selection.length > 0 ? { media: selection } : {}),
    });
    const unsubscribe = command.subscribe(() => setTask(command.snapshot()));
    setTask(command.snapshot());
    try {
      const outcome = await command.done;
      setTask(command.snapshot());
      if (outcome.kind === 'committed') {
        setBody('');
        setSelection([]);
      } else {
        setError(diagnosticMessage(outcome, 'Post did not commit.'));
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      unsubscribe();
    }
  };

  const feedHeader = useMemo(() => (
    <View>
      <View style={styles.header}>
        <View style={styles.identity}>
          <Pressable accessibilityRole="button" disabled={!profile || avatarStatus !== null} onPress={() => void pickAvatar()}>
            <Avatar accent={persona.accent} changing={avatarStatus !== null} profile={profile} />
            <View style={styles.cameraBadge}><Text style={styles.cameraBadgeText}>＋</Text></View>
          </Pressable>
          <View style={styles.identityCopy}>
            <Text style={styles.eyebrow}>PRIVATE MEDIA FEED</Text>
            <Text style={styles.name}>{profile?.displayName ?? persona.displayName}</Text>
            <Text style={styles.identityStatus}>
              {avatarStatus ? `avatar · ${avatarStatus}` : `${connection.status} · tap avatar to change`}
            </Text>
            {avatarError ? <Text style={styles.error}>{avatarError}</Text> : null}
          </View>
        </View>
        <Pressable onPress={onSignOut} style={styles.switchButton}>
          <Text style={styles.switchText}>Switch</Text>
        </Pressable>
      </View>

      <View style={styles.composer}>
        <Text style={styles.composerTitle}>Make a post</Text>
        <TextInput
          accessibilityLabel="Post text"
          maxLength={280}
          multiline
          onChangeText={setBody}
          placeholder="A photo, a clip, or just a thought…"
          placeholderTextColor="#8c8277"
          style={styles.input}
          value={body}
        />
        <SelectedMedia assets={selection} onClear={() => setSelection([])} />
        <View style={styles.composerActions}>
          <Pressable disabled={posting} onPress={() => void pickPostMedia()} style={styles.mediaButton}>
            <Text style={styles.mediaButtonText}>＋ Images / video</Text>
          </Pressable>
          <Pressable
            disabled={!body.trim() || posting}
            onPress={() => void publish()}
            style={[styles.publishButton, (!body.trim() || posting) && styles.disabled]}
          >
            <Text style={styles.publishText}>Post</Text>
          </Pressable>
        </View>
        <TaskProgress snapshot={task} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
      <View style={styles.feedHeading}>
        <Text style={styles.feedTitle}>YOUR POSTS</Text>
        <Text style={styles.feedCount}>{feed.length}</Text>
      </View>
    </View>
  ), [avatarError, avatarStatus, body, connection.status, error, feed.length, onSignOut, persona, posting, profile, selection, task]);

  return (
    <FlatList
      ListEmptyComponent={posts.status === 'pending'
        ? <ActivityIndicator color={persona.accent} style={styles.empty} />
        : <Text style={styles.empty}>No posts yet. Text-only works too.</Text>}
      ListHeaderComponent={feedHeader}
      contentContainerStyle={styles.list}
      data={feed}
      keyExtractor={(post) => post._id}
      keyboardShouldPersistTaps="handled"
      renderItem={({ item }) => <PostCard persona={persona} post={item} />}
      style={styles.screen}
    />
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: '#f4efe6', flex: 1 },
  list: { padding: 18, paddingBottom: 56 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20, marginTop: 8 },
  identity: { alignItems: 'center', flexDirection: 'row', flex: 1, gap: 12 },
  identityCopy: { flex: 1, gap: 2 },
  avatarFrame: { height: 62, position: 'relative', width: 62 },
  avatar: { borderColor: '#fff', borderRadius: 99, borderWidth: 3, height: 62, width: 62 },
  avatarBusy: { alignItems: 'center', backgroundColor: 'rgba(24, 22, 20, 0.58)', borderRadius: 99, bottom: 3, justifyContent: 'center', left: 3, position: 'absolute', right: 3, top: 3 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: '#fff', fontSize: 25, fontWeight: '900' },
  cameraBadge: { alignItems: 'center', backgroundColor: '#23221f', borderColor: '#fff', borderRadius: 99, borderWidth: 2, bottom: -1, height: 22, justifyContent: 'center', position: 'absolute', right: -1, width: 22 },
  cameraBadgeText: { color: '#fff', fontSize: 14, fontWeight: '900', lineHeight: 17 },
  eyebrow: { color: '#a34931', fontSize: 9, fontWeight: '900', letterSpacing: 1.8 },
  name: { color: '#24221f', fontFamily: Platform.select({ ios: 'Georgia', default: 'serif' }), fontSize: 25 },
  identityStatus: { color: '#81786d', fontSize: 10 },
  switchButton: { borderColor: '#cfc4b5', borderRadius: 99, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  switchText: { color: '#5d554c', fontSize: 11, fontWeight: '800' },
  composer: { backgroundColor: '#24231f', borderRadius: 22, gap: 12, marginBottom: 24, padding: 17 },
  composerTitle: { color: '#fffaf0', fontFamily: Platform.select({ ios: 'Georgia', default: 'serif' }), fontSize: 26 },
  input: { backgroundColor: '#35332e', borderColor: '#4a463f', borderRadius: 13, borderWidth: 1, color: '#fffaf0', fontSize: 16, minHeight: 86, padding: 13, textAlignVertical: 'top' },
  composerActions: { flexDirection: 'row', gap: 10 },
  mediaButton: { borderColor: '#756d63', borderRadius: 11, borderWidth: 1, paddingHorizontal: 13, paddingVertical: 12 },
  mediaButtonText: { color: '#f2eade', fontSize: 12, fontWeight: '800' },
  publishButton: { alignItems: 'center', backgroundColor: '#d86545', borderRadius: 11, flex: 1, justifyContent: 'center', paddingHorizontal: 16 },
  publishText: { color: '#fff', fontSize: 13, fontWeight: '900' },
  disabled: { opacity: 0.38 },
  selectionBlock: { gap: 8 },
  selectionHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  selectionLabel: { color: '#bbb1a4', fontSize: 10, fontWeight: '700' },
  clear: { color: '#ef9b83', fontSize: 10, fontWeight: '800' },
  selectionRow: { flexDirection: 'row', gap: 7 },
  selectedTile: { backgroundColor: '#4a4640', borderRadius: 8, height: 62, overflow: 'hidden', width: 62 },
  selectedVideo: { alignItems: 'center', justifyContent: 'center' },
  videoMark: { color: '#fff', fontSize: 17 },
  videoLabel: { color: '#d8cec1', fontSize: 7, fontWeight: '900', marginTop: 3 },
  taskCard: { backgroundColor: '#35332e', borderRadius: 11, gap: 7, padding: 10 },
  taskHeading: { flexDirection: 'row', justifyContent: 'space-between' },
  taskPhase: { color: '#e4c28e', fontSize: 10, fontWeight: '800' },
  progressTrack: { backgroundColor: '#59544c', borderRadius: 99, height: 4, overflow: 'hidden' },
  progressFill: { backgroundColor: '#e17a5d', height: '100%' },
  itemProgress: { flexDirection: 'row', justifyContent: 'space-between' },
  itemProgressText: { color: '#bdb3a7', fontSize: 9 },
  error: { backgroundColor: '#583129', borderRadius: 9, color: '#ffb7a2', fontSize: 11, lineHeight: 16, padding: 9 },
  feedHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  feedTitle: { color: '#746a5e', fontSize: 10, fontWeight: '900', letterSpacing: 2 },
  feedCount: { backgroundColor: '#ddd4c6', borderRadius: 99, color: '#655d54', fontSize: 9, fontWeight: '900', minWidth: 24, paddingHorizontal: 8, paddingVertical: 5, textAlign: 'center' },
  postCard: { backgroundColor: '#fffaf1', borderColor: '#ddd3c4', borderRadius: 18, borderWidth: 1, gap: 12, marginBottom: 14, overflow: 'hidden', padding: 15 },
  postMeta: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  postDot: { borderRadius: 99, height: 8, width: 8 },
  postAuthor: { color: '#3c3934', fontSize: 11, fontWeight: '900' },
  postTime: { color: '#938a7e', fontSize: 9, marginLeft: 'auto' },
  postBody: { color: '#292621', fontFamily: Platform.select({ ios: 'Georgia', default: 'serif' }), fontSize: 20, lineHeight: 28 },
  mediaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  mediaTile: { backgroundColor: '#d8d0c4', borderRadius: 11, overflow: 'hidden' },
  videoTile: { alignItems: 'center', backgroundColor: '#344557', justifyContent: 'center', padding: 10 },
  videoTileMark: { color: '#fff', fontSize: 25 },
  videoTileTitle: { color: '#fff', fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginTop: 6 },
  videoTileCopy: { color: '#cbd7e0', fontSize: 8, lineHeight: 12, marginTop: 4, textAlign: 'center' },
  mediaUnavailable: { alignItems: 'center', backgroundColor: '#eee7dc', borderColor: '#cfc4b6', borderStyle: 'dashed', borderWidth: 1, justifyContent: 'center', padding: 12 },
  unavailableTitle: { color: '#885342', fontSize: 10, fontWeight: '900' },
  unavailableCopy: { color: '#81776c', fontSize: 9, lineHeight: 13, marginTop: 5, textAlign: 'center' },
  mediaLoading: { alignItems: 'center', backgroundColor: '#8b8175', justifyContent: 'center' },
  mediaLoadingText: { color: '#fff', fontSize: 9, marginTop: 6 },
  mediaPending: { marginVertical: 14 },
  mediaError: { color: '#a23c2b', fontSize: 10 },
  empty: { color: '#83796d', fontSize: 13, padding: 28, textAlign: 'center' },
});
