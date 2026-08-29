import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSnapbackQuery, useSnapbackSettledMutation } from '@expo/snapback-expo';
import { InsightsBarList, InsightsSummary } from '@snapback-bench/social-ui';
import api from '../snapback/generated/api.mjs';
import { EMPTY } from '../src/lib/empty';
import { newClientId } from '../src/lib/snapback';

export default function InsightsScreen() {
  const mine = useSnapbackQuery(api.getMine, EMPTY);
  const people = useSnapbackQuery(api.profilesLive, EMPTY);
  const createPost = useSnapbackSettledMutation(api.createPost);
  const me = mine.data?.[0];
  const liveMe = (people.data ?? []).find((row) => row.handle === me?.handle) ?? me;
  const [seeded, setSeeded] = useState(false);
  const posted = useRef(false);
  useEffect(() => {
    if (!me || posted.current) return;
    posted.current = true;
    void createPost({
      clientId: newClientId('ins'),
      kind: 'text',
      body: `insights ${Date.now()}`,
    }).catch(() => undefined).finally(() => {
      window.setTimeout(() => setSeeded(true), 2800);
    });
  }, [me, createPost]);
  if (!me || !liveMe || !seeded) return <View style={styles.page} />;
  const days = [0, 1, 2, 3, 4, 5, 6].map((offset) => ({
    dayLabel: offset === 0 ? 'Today' : `D-${offset}`,
    posts: offset === 0 ? (liveMe.postCount ?? 0) : 0,
    likesReceived: offset === 0 ? (liveMe.likesReceived ?? 0) : 0,
  }));
  return (
    <View style={styles.page}>
      <InsightsSummary
        totals={[
          { label: 'Posts', value: liveMe.postCount ?? 0 },
          { label: 'Likes received', value: liveMe.likesReceived ?? 0 },
          { label: 'Reposts received', value: liveMe.repostsReceived ?? 0 },
          { label: 'Replies received', value: liveMe.repliesReceived ?? 0 },
          { label: 'Followers', value: liveMe.followerCount ?? 0 },
          { label: 'Following', value: liveMe.followingCount ?? 0 },
        ]}
      />
      <InsightsBarList days={days} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
});
