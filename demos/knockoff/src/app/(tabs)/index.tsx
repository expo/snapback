import { Link } from 'expo-router';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useSnapbackConnection, useSnapbackQuery } from '@knockoff/snapback-react';
import { TimelinePostCard } from '@/components/post-card';
import { QueryState } from '@/components/query-state';
import { api } from '@/lib/snapback';
import { colors } from '@/theme/colors';

export default function TimelineScreen() {
  const query = useSnapbackQuery(api.timeline, { limit: 50 });
  const connection = useSnapbackConnection();
  const ready = query.status === 'ready' || query.status === 'refreshing';
  return <View style={{ flex: 1 }}>
    <FlatList contentInsetAdjustmentBehavior="automatic" data={ready ? query.data : []} keyExtractor={(item) => item._id} renderItem={({ item }) => <TimelinePostCard post={item} />} ListHeaderComponent={<View style={{ paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', justifyContent: 'center' }}><Text selectable style={{ color: connection.status === 'live' ? '#00a86b' : colors.secondary, fontSize: 12 }}>● {connection.status}</Text></View>} ListEmptyComponent={<QueryState message="Loading your timeline…" error={query.status === 'error' ? query.error : undefined} />} />
    <Link href="/compose" asChild><Pressable accessibilityLabel="Compose post" style={{ position: 'absolute', right: 20, bottom: 20, width: 58, height: 58, borderRadius: 29, backgroundColor: colors.blue, alignItems: 'center', justifyContent: 'center', boxShadow: '0 5px 16px rgba(29,155,240,.35)' }}><Text style={{ color: colors.white, fontSize: 30, fontWeight: '300' }}>＋</Text></Pressable></Link>
  </View>;
}
