import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  useSnapbackAssetImage,
  useSnapbackAssetUpload,
  useSnapbackCommand,
  useSnapbackQuery,
  useSnapbackSettledMutation,
} from '@expo/snapback-expo';
import {
  Composer,
  FeedCard,
  TrendingEmpty,
  TrendingRow,
} from '@snapback-bench/social-ui';
import { app } from '../snapback/generated/app.mjs';
import api from '../snapback/generated/api.mjs';
import { EMPTY, EMPTY_CURSOR } from '../src/lib/empty';
import { assetUrl, newClientId } from '../src/lib/snapback';
import { extractAssetId } from '../src/ui/asset-src';

async function waitAsset(task: { done: Promise<any>; snapshot: () => { status: string; assetRef?: string | null; assetId?: string | null } }) {
  const snap = await task.done;
  if (snap.status !== 'ready') throw new Error(`upload ${snap.status}`);
  return snap.assetRef ?? snap.assetId;
}

function FeedItem({ event, liked, reposted, avatarUri, onAuthor, onOpen, onLike, onRepost }: {
  event: any;
  liked: boolean;
  reposted: boolean;
  avatarUri?: string;
  onAuthor: (handle: string) => void;
  onOpen: (id: string) => void;
  onLike: () => void;
  onRepost: () => void;
}) {
  const mediaArgs = useMemo(() => ({ postId: event.postId }), [event.postId]);
  const media = useSnapbackQuery(api.postMediaForPost, mediaArgs);
  const imageRows = (media.data ?? []).filter((row) => row.kind === 'image');
  const videoRow = (media.data ?? []).find((row) => row.kind === 'video');
  const image0 = useSnapbackAssetImage({ assetId: extractAssetId(imageRows[0]?.image), maxWidth: 1440 });
  const image1 = useSnapbackAssetImage({ assetId: extractAssetId(imageRows[1]?.image), maxWidth: 1440 });
  const image2 = useSnapbackAssetImage({ assetId: extractAssetId(imageRows[2]?.image), maxWidth: 1440 });
  const image3 = useSnapbackAssetImage({ assetId: extractAssetId(imageRows[3]?.image), maxWidth: 1440 });
  const videoAsset = useSnapbackAssetImage({ assetId: extractAssetId(videoRow?.video), maxWidth: 1440 });
  const imageUris = [image0, image1, image2, image3]
    .map((row) => row.src ?? row.strictSrc)
    .filter((uri): uri is string => !!uri);
  return (
    <FeedCard
      authorName={event.authorName}
      authorIdentity={event.authorHandle}
      authorHandle={event.authorHandle}
      authorAvatarUri={avatarUri}
      text={event.body}
      likeCount={event.likeCount}
      liked={liked}
      repostCount={event.repostCount}
      reposted={reposted}
      replyCount={event.replyCount}
      imageUris={imageUris}
      videoUri={videoAsset.src ?? videoAsset.strictSrc ?? undefined}
      repostedByName={event.kind === 'repost' ? event.actorName : undefined}
      repostedByIdentity={event.kind === 'repost' ? event.actorHandle : undefined}
      onPress={() => onOpen(event.postId)}
      onPressLike={onLike}
      onPressRepost={onRepost}
      onPressReply={() => onOpen(event.postId)}
      onPressAuthor={() => onAuthor(event.authorHandle)}
    />
  );
}

export default function FeedScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ feed?: string }>();
  const tab = params.feed === 'global' || params.feed === 'trending' ? params.feed : 'following';
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const filesRef = useRef<File[]>([]);
  filesRef.current = files;
  const [likedLocal, setLikedLocal] = useState<Record<string, boolean>>({});
  const [repostedLocal, setRepostedLocal] = useState<Record<string, boolean>>({});
  const following = useSnapbackQuery(api.followingFeed, EMPTY_CURSOR);
  const global = useSnapbackQuery(api.globalFeed, EMPTY_CURSOR);
  const likes = useSnapbackQuery(api.myLikes, EMPTY);
  const reposts = useSnapbackQuery(api.myReposts, EMPTY);
  const people = useSnapbackQuery(api.profilesLive, EMPTY);
  const createPost = useSnapbackSettledMutation(api.createPost);
  const setLike = useSnapbackSettledMutation(api.setLike);
  const setRepost = useSnapbackSettledMutation(api.setRepost);
  const imageUpload = useSnapbackAssetUpload({ upload: api.publicImageUpload });
  const sendVideo = useSnapbackCommand(app.commands.sendVideoPost);
  const items = tab === 'following' ? following.data ?? [] : tab === 'global' ? global.data ?? [] : [];
  const trendingCutoff = Date.now() - 86400000;
  const trendingItems = [...(global.data ?? [])]
    .filter((row) => row.kind === 'original' && row.createdAt > trendingCutoff)
    .sort((a, b) => b.likeCount - a.likeCount || b.createdAt - a.createdAt)
    .slice(0, 10);
  const likedIds = new Set((likes.data ?? []).map((row) => row.postId));
  const repostedIds = new Set((reposts.data ?? []).map((row) => row.postId));
  const avatarByHandle = new Map((people.data ?? []).map((row) => [row.handle, assetUrl(row.avatar)]));
  const isLiked = (id: string) => (id in likedLocal ? likedLocal[id] : likedIds.has(id));
  const isReposted = (id: string) => (id in repostedLocal ? repostedLocal[id] : repostedIds.has(id));

  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    const sync = () => {
      const node = document.querySelector('[data-testid="sm-compose-file"]') as HTMLInputElement | null;
      if (!node?.files || node.files.length === 0) return;
      const next = Array.from(node.files);
      setFiles((current) => {
        if (current.length === next.length && current.every((file, index) => file.name === next[index].name && file.size === next[index].size)) {
          return current;
        }
        return next;
      });
    };
    const id = window.setInterval(sync, 250);
    document.addEventListener('change', sync, true);
    document.addEventListener('input', sync, true);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('change', sync, true);
      document.removeEventListener('input', sync, true);
    };
  }, []);

  const submit = async (text: string) => {
    const clientId = newClientId('post');
    const pending = filesRef.current;
    const videoFile = pending.find((file) => file.type.startsWith('video/') || file.name.endsWith('.mp4'));
    const imageFiles = pending.filter((file) => file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name)).slice(0, 4);
    if (videoFile) {
      const task = sendVideo({
        clientId,
        kind: 'video',
        body: text,
        video: videoFile,
      });
      const outcome = await task.done;
      if (outcome?.kind === 'failed' || outcome?.kind === 'cancelled' || outcome?.kind === 'ambiguous') {
        throw new Error(outcome.diagnostic?.message ?? `video ${outcome.kind}`);
      }
    } else if (imageFiles.length > 0) {
      const images = [];
      for (const file of imageFiles) {
        images.push(await waitAsset(imageUpload.start(file, {
          declaredFilename: file.name,
          declaredContentType: file.type || 'image/png',
        })));
      }
      await createPost({ clientId, kind: 'images', body: text, images });
    } else {
      await createPost({ clientId, kind: 'text', body: text });
    }
    setDraft('');
    setFiles([]);
  };

  return (
    <View style={styles.page}>
      {tab === 'trending' ? (
        trendingItems.length === 0 ? (
          <TrendingEmpty />
        ) : (
          <ScrollView>
            {trendingItems.map((item, index) => (
              <TrendingRow
                key={item.postId}
                rank={index + 1}
                post={{
                  authorName: item.authorName,
                  authorIdentity: item.authorHandle,
                  authorHandle: item.authorHandle,
                  authorAvatarUri: avatarByHandle.get(item.authorHandle),
                  text: item.body,
                  likeCount: item.likeCount,
                  liked: isLiked(item.postId),
                  repostCount: item.repostCount,
                  reposted: isReposted(item.postId),
                  replyCount: item.replyCount,
                  onPressLike: () => undefined,
                  onPressRepost: () => undefined,
                  onPressReply: () => router.push(`/post/${item.postId}`),
                  onPress: () => router.push(`/post/${item.postId}`),
                }}
              />
            ))}
          </ScrollView>
        )
      ) : (
        <ScrollView>
          {items.map((item) => (
            <FeedItem
              key={item.eventId}
              event={item}
              liked={isLiked(item.postId)}
              reposted={isReposted(item.postId)}
              avatarUri={avatarByHandle.get(item.authorHandle)}
              onAuthor={(handle) => router.push(`/profile/${handle}`)}
              onOpen={(id) => router.push(`/post/${id}`)}
              onLike={() => {
                const next = !isLiked(item.postId);
                setLikedLocal((current) => ({ ...current, [item.postId]: next }));
                void setLike({
                  postId: item.postId,
                  op: next ? 'set' : 'clear',
                  mutationId: newClientId('like'),
                }).catch(() => undefined);
              }}
              onRepost={() => {
                const next = !isReposted(item.postId);
                setRepostedLocal((current) => ({ ...current, [item.postId]: next }));
                void setRepost({
                  postId: item.postId,
                  op: next ? 'set' : 'clear',
                  mutationId: newClientId('repost'),
                });
              }}
            />
          ))}
        </ScrollView>
      )}
      {Platform.OS === 'web' ? (
        <input
          type="file"
          multiple
          accept="image/*,video/mp4"
          data-testid="sm-compose-file"
          style={{ display: 'block', width: '100%', marginBottom: 8 }}
          onInput={(event) => {
            const list = (event.currentTarget as HTMLInputElement).files;
            if (list && list.length > 0) setFiles(Array.from(list));
          }}
          onChange={(event) => {
            const list = event.currentTarget.files;
            if (list && list.length > 0) setFiles(Array.from(list));
          }}
        />
      ) : null}
      <Composer
        variant="post"
        value={draft}
        onChangeText={setDraft}
        onSend={(text) => void submit(text)}
        attachments={files.map((file) => ({
          uri: URL.createObjectURL(file),
          kind: file.type.startsWith('video/') ? 'video' : 'image',
        }))}
        onPressAttach={() => {
          if (Platform.OS === 'web') {
            const node = document.querySelector('[data-testid="sm-compose-file"]') as HTMLInputElement | null;
            node?.click();
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
});
