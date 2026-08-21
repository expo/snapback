import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useSnapbackMutation } from '@knockoff/snapback-react';
import { api } from '@/lib/snapback';
import { colors } from '@/theme/colors';
import type { Id } from '@generated/api.d.ts';

type PostId = NonNullable<typeof api.toggleLike.__args>['postId'];

type Post = {
  _id: PostId; authorId: Id<'profiles'>; authorHandle: string; displayName: string; avatarUrl: string;
  verified: boolean; body: string; createdAt: number; likeCount: number; replyCount: number; liked: boolean;
};

const compact = (value: number) => Intl.NumberFormat('en', { notation: 'compact' }).format(value);

function PostCard({ post, toggleLike }: { post: Post; toggleLike: () => Promise<unknown> }) {
  const onLike = async () => {
    if (process.env.EXPO_OS === 'ios') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try { await toggleLike(); }
    catch (error) { console.warn('Like did not reach Snapback; optimistic state was rolled back.', error); }
  };

  return (
    <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.separator }}>
      <Link href={{ pathname: '/profile/[handle]', params: { handle: post.authorHandle } }} asChild>
        <Pressable accessibilityLabel={`Open ${post.displayName}'s profile`}>
          <Image source={post.avatarUrl} style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: colors.elevated }} contentFit="cover" />
        </Pressable>
      </Link>
      <View style={{ flex: 1, gap: 5 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text selectable numberOfLines={1} style={{ color: colors.label, fontWeight: '700', fontSize: 15 }}>{post.displayName}</Text>
          {post.verified ? <Text style={{ color: colors.blue, fontSize: 13 }}>●</Text> : null}
          <Text selectable numberOfLines={1} style={{ color: colors.secondary, flexShrink: 1 }}>@{post.authorHandle} · {new Date(post.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</Text>
        </View>
        <Text selectable style={{ color: colors.label, fontSize: 16, lineHeight: 22 }}>{post.body}</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', maxWidth: 290, paddingTop: 7 }}>
          <Link href={{ pathname: '/compose', params: { replyToId: post._id, replyTo: post.authorHandle } }} asChild>
            <Pressable accessibilityLabel="Reply" hitSlop={10}><Text style={{ color: colors.secondary, fontVariant: ['tabular-nums'] }}>◯  {compact(post.replyCount)}</Text></Pressable>
          </Link>
          <Pressable accessibilityLabel={post.liked ? 'Unlike' : 'Like'} onPress={onLike} hitSlop={10}>
            <Text style={{ color: post.liked ? colors.pink : colors.secondary, fontVariant: ['tabular-nums'] }}>{post.liked ? '♥' : '♡'}  {compact(post.likeCount)}</Text>
          </Pressable>
          <Pressable accessibilityLabel="Share" hitSlop={10}><Text style={{ color: colors.secondary }}>↗</Text></Pressable>
        </View>
      </View>
    </View>
  );
}

function projectLike(postId: PostId, liked: boolean, likeCount: number) {
  // A projection is replayed over every newer authoritative base. Capture the
  // intended outcome; toggling the incoming row would repeat the user action
  // during a rebase and visibly invert it.
  return (current: readonly Post[]) => current.map((item) => item._id === postId
    ? { ...item, liked, likeCount }
    : item);
}

function authoritativeLike(postId: PostId) {
  return (current: readonly Post[], result: { liked: boolean; likeCount: number }) => current.some((item) =>
    item._id === postId && item.liked === result.liked && item.likeCount === result.likeCount);
}

export function TimelinePostCard({ post }: { post: Post }) {
  const liked = !post.liked;
  const likeCount = Math.max(0, post.likeCount + (post.liked ? -1 : 1));
  // @ref LLP 0114#mutation-hook-and-optimistic-rollback — install one replayable projection over the
  // exact canonical feed store so query delivery and mutation response order
  // cannot double-apply the like.
  const toggleLike = useSnapbackMutation(api.toggleLike, {
    optimistic: {
      query: api.timeline,
      args: { limit: 50 },
      update: projectLike(post._id, liked, likeCount),
      isAuthoritative: authoritativeLike(post._id),
    },
  });
  return <PostCard post={post} toggleLike={() => toggleLike({ postId: post._id })} />;
}

export function ProfilePostCard({ post, handle }: { post: Post; handle: string }) {
  const liked = !post.liked;
  const likeCount = Math.max(0, post.likeCount + (post.liked ? -1 : 1));
  const toggleLike = useSnapbackMutation(api.toggleLike, {
    optimistic: {
      query: api.profilePosts,
      args: { handle },
      update: projectLike(post._id, liked, likeCount),
      isAuthoritative: authoritativeLike(post._id),
    },
  });
  return <PostCard post={post} toggleLike={() => toggleLike({ postId: post._id })} />;
}
