import { useMemo, useState } from 'react';
import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { useSnapbackQuery } from '@knockoff/snapback-react';
import { QueryState } from '@/components/query-state';
import { api } from '@/lib/snapback';
import { colors } from '@/theme/colors';

export default function SearchScreen() {
  const [term, setTerm] = useState('');
  const query = useSnapbackQuery(api.profiles, {});
  const data = useMemo(() => query.status === 'ready' || query.status === 'refreshing' ? query.data.filter((p) => `${p.displayName} ${p.handle} ${p.bio}`.toLowerCase().includes(term.toLowerCase())) : [], [query, term]);
  return <FlatList contentInsetAdjustmentBehavior="automatic" data={data} keyExtractor={(item) => item._id} ListHeaderComponent={<TextInput accessibilityLabel="Search people" value={term} onChangeText={setTerm} placeholder="Search people" placeholderTextColor={colors.secondary} style={{ margin: 16, paddingHorizontal: 16, height: 44, borderRadius: 22, backgroundColor: colors.elevated, color: colors.label }} />} ListEmptyComponent={<QueryState message="No people found" error={query.status === 'error' ? query.error : undefined} />} renderItem={({ item }) => <Link href={{ pathname: '/profile/[handle]', params: { handle: item.handle } }} asChild><Pressable style={{ flexDirection: 'row', padding: 16, gap: 12 }}><Image source={item.avatarUrl} style={{ width: 48, height: 48, borderRadius: 24 }} /><View style={{ flex: 1, gap: 2 }}><Text selectable style={{ color: colors.label, fontWeight: '700' }}>{item.displayName}</Text><Text selectable style={{ color: colors.secondary }}>@{item.handle}</Text><Text selectable style={{ color: colors.label, paddingTop: 4 }}>{item.bio}</Text></View></Pressable></Link>} />;
}
