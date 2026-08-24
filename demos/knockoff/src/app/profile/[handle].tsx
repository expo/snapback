import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Storage } from 'expo-sqlite/kv-store';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useSnapbackAuth, useSnapbackQueries } from '@knockoff/snapback-react';
import { ProfilePostCard } from '@/components/post-card';
import { QueryState } from '@/components/query-state';
import { AUTH_PROFILE_STORAGE_KEY } from '@/lib/auth-profile';
import { api } from '@/lib/snapback';
import { colors } from '@/theme/colors';

export default function ProfileScreen() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const auth = useSnapbackAuth();
  const router = useRouter();
  const group = useSnapbackQueries({ posts: { ref: api.profilePosts, args: { handle } }, profiles: { ref: api.profiles, args: {} } });
  const profile = (group.queries.profiles.status === 'ready' || group.queries.profiles.status === 'refreshing') ? group.queries.profiles.data.find((item) => item.handle === handle) : undefined;
  const posts = (group.queries.posts.status === 'ready' || group.queries.posts.status === 'refreshing') ? group.queries.posts.data : [];
  return <>
    <Stack.Title>{profile?.displayName ?? `@${handle}`}</Stack.Title>
    <Stack.Screen options={{
      headerRight: () => <Pressable
        accessibilityRole="button"
        accessibilityLabel="Sign out"
        hitSlop={10}
        onPress={() => {
          void auth.signOut().then(async () => {
            await Storage.removeItem(AUTH_PROFILE_STORAGE_KEY);
            router.replace('/');
          });
        }}
      >
        <Text style={{ color: colors.accent, fontSize: 16 }}>Sign out</Text>
      </Pressable>,
    }} />
    <FlatList contentInsetAdjustmentBehavior="automatic" data={posts} keyExtractor={(item) => item._id} renderItem={({ item }) => <ProfilePostCard post={item} handle={handle} />} ListHeaderComponent={profile ? <View><View style={{ height: 110, backgroundColor: '#c5e7fa' }} /><View style={{ padding: 16, gap: 8 }}><Image source={profile.avatarUrl} style={{ width: 82, height: 82, borderRadius: 41, borderWidth: 4, borderColor: colors.background, marginTop: -58 }} /><Text selectable style={{ color: colors.label, fontSize: 23, fontWeight: '800' }}>{profile.displayName}</Text><Text selectable style={{ color: colors.secondary }}>@{profile.handle}</Text><Text selectable style={{ color: colors.label, fontSize: 15 }}>{profile.bio}</Text><Text selectable style={{ color: colors.label, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{Intl.NumberFormat('en', { notation: 'compact' }).format(profile.followers)} <Text style={{ color: colors.secondary, fontWeight: '400' }}>followers</Text></Text></View></View> : <QueryState message="Loading profile…" />} />
  </>;
}
