import { useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSnapbackCurrentPrincipal, useSnapbackMutation, useSnapbackQuery } from '@expo/snapback-expo';
import { FeedCard, ProfileForm, palette, typeScale } from '@snapback-bench/social-ui';
import api from '../../snapback/generated/api.mjs';
import { assetUrl, newClientId } from '../../src/lib/snapback';

const EMPTY = {};

export default function ProfileScreen() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const router = useRouter();
  const principal = useSnapbackCurrentPrincipal();
  const normalized = String(handle ?? '').toLowerCase();
  const args = useMemo(() => ({ handle: normalized }), [normalized]);
  const profile = useSnapbackQuery(api.profileByHandle, args);
  const posts = useSnapbackQuery(api.profilePosts, args);
  const follows = useSnapbackQuery(api.myFollows, EMPTY);
  const setFollow = useSnapbackMutation(api.setFollow);
  const like = useSnapbackMutation(api.setLike);
  const [row, setRow] = useState<any>(null);

  useEffect(() => {
    const next = profile.data?.[0];
    if (next) setRow(next);
  }, [profile.data]);

  const myId = principal.status === 'authenticated' ? principal.userId : null;
  const isOwn = !!row && !!myId && row.userId === myId;
  const following = (follows.data ?? []).some((edge) => edge.followeeId === row?.userId);

  if (!row) {
    return (
      <View style={styles.page}>
        <Text style={styles.loading}>Loading profile…</Text>
      </View>
    );
  }

  return (
    <View style={styles.page}>
      {isOwn ? (
        <ProfileForm
          mode="view-own"
          displayName={row.displayName}
          handle={row.handle}
          bio={row.bio}
          location={row.location}
          link={row.link}
          avatarUri={assetUrl(row.avatar)}
          followerCount={row.followerCount}
          followingCount={row.followingCount}
          onPressEdit={() => router.push('/profile/edit')}
          onPressFeed={() => router.push('/')}
        />
      ) : (
        <ProfileForm
          mode="view-other"
          displayName={row.displayName}
          handle={row.handle}
          bio={row.bio}
          location={row.location}
          link={row.link}
          avatarUri={assetUrl(row.avatar)}
          followerCount={row.followerCount}
          followingCount={row.followingCount}
          following={following}
          onPressFollow={() => void setFollow({
            handle: row.handle,
            op: following ? 'clear' : 'set',
            mutationId: newClientId('follow'),
          })}
          onPressFeed={() => router.push('/')}
        />
      )}
      <FlatList
        data={(posts.data ?? []) as any[]}
        keyExtractor={(item) => item._id}
        renderItem={({ item }) => (
          <FeedCard
            authorName={row.displayName}
            authorIdentity={row.handle}
            authorHandle={row.handle}
            authorAvatarUri={assetUrl(row.avatar)}
            text={item.body}
            likeCount={item.likeCount}
            liked={false}
            repostCount={item.repostCount}
            reposted={false}
            replyCount={item.replyCount}
            onPress={() => router.push(`/post/${item._id}`)}
            onPressLike={() => void like({ postId: item._id, op: 'set', mutationId: newClientId('like') })}
            onPressRepost={() => undefined}
            onPressReply={() => router.push(`/post/${item._id}`)}
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  loading: { ...typeScale.body, color: palette.textMuted, padding: 24 },
});
