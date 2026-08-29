import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSnapbackQuery, useSnapbackSettledMutation } from '@expo/snapback-expo';
import { Composer, FeedCard } from '@snapback-bench/social-ui';
import api from '../../snapback/generated/api.mjs';
import { EMPTY } from '../../src/lib/empty';
import { assetUrl, newClientId } from '../../src/lib/snapback';

export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const args = useMemo(() => ({ postId: id as any }), [id]);
  const thread = useSnapbackQuery(api.thread, args);
  const people = useSnapbackQuery(api.profilesLive, EMPTY);
  const likes = useSnapbackQuery(api.myLikes, EMPTY);
  const reply = useSnapbackSettledMutation(api.createReply);
  const like = useSnapbackSettledMutation(api.setLike);
  const [draft, setDraft] = useState('');
  const rows = thread.data ?? [];
  const likedIds = new Set((likes.data ?? []).map((row) => row.postId));
  const profileByUser = new Map((people.data ?? []).map((row) => [row.userId, row]));

  return (
    <View style={styles.page}>
      <FlatList
        data={rows}
        keyExtractor={(item) => item._id}
        renderItem={({ item }) => {
          const author = profileByUser.get(item.authorId);
          return (
            <FeedCard
              authorName={author?.displayName ?? item.authorId}
              authorIdentity={author?.handle}
              authorHandle={author?.handle}
              authorAvatarUri={assetUrl(author?.avatar)}
              text={item.body}
              likeCount={item.likeCount}
              liked={likedIds.has(item._id)}
              repostCount={item.repostCount}
              reposted={false}
              replyCount={item.replyCount}
              onPressLike={() => void like({
                postId: item._id,
                op: likedIds.has(item._id) ? 'clear' : 'set',
                mutationId: newClientId('like'),
              })}
              onPressRepost={() => undefined}
              onPressReply={() => undefined}
              onPressAuthor={author?.handle ? () => router.push(`/profile/${author.handle}`) : undefined}
            />
          );
        }}
      />
      <Composer
        variant="post"
        value={draft}
        onChangeText={setDraft}
        onSend={(text) => {
          void reply({ clientId: newClientId('reply'), parentId: id as any, body: text }).then(() => setDraft(''));
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
});
