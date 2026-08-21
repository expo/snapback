import { Link } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSnapbackConnection, useSnapbackQuery } from '@messenger/snapback-react';
import { ConversationRow } from '@/components/conversation-row';
import { QueryState } from '@/components/query-state';
import { Avatar } from '@/components/avatar';
import { api } from '@/lib/snapback';
import { useIdentity } from '@/lib/identity';
import { colors } from '@/theme/colors';

export default function ChatsScreen() {
  const { self } = useIdentity();
  const query = useSnapbackQuery(api.myConversations, {});
  const connection = useSnapbackConnection();
  const ready = query.status === 'ready' || query.status === 'refreshing';
  const data = ready ? query.data : [];

  return (
    <View style={styles.flex}>
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        data={data}
        keyExtractor={(item) => item._id}
        renderItem={({ item }) => <ConversationRow conversation={item} />}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.headerRow}>
              <View style={styles.selfRow}>
                <Avatar handle={self.handle} size={36} />
                <Text style={styles.selfLabel}>You're {self.name}</Text>
              </View>
              <Text selectable style={[styles.connectionPill, connection.status === 'live' ? styles.live : styles.notLive]}>
                ● {connection.status}
              </Text>
            </View>
          </View>
        }
        ListEmptyComponent={<QueryState message="Loading your conversations…" error={query.status === 'error' ? query.error : undefined} />}
      />
      <Link href="/new-group" asChild>
        <Pressable accessibilityLabel="New group" style={styles.fab}>
          <Text style={styles.fabText}>＋</Text>
        </Pressable>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { gap: 8, paddingBottom: 4, paddingHorizontal: 16, paddingTop: 8 },
  headerRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  selfRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  selfLabel: { color: colors.label, fontSize: 15, fontWeight: '700' },
  connectionPill: { fontSize: 12 },
  live: { color: colors.online },
  notLive: { color: colors.secondary },
  separator: { backgroundColor: colors.border, height: StyleSheet.hairlineWidth, marginLeft: 76 },
  fab: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 29,
    bottom: 20,
    height: 58,
    justifyContent: 'center',
    position: 'absolute',
    right: 20,
    width: 58,
  },
  fabText: { color: colors.white, fontSize: 28, fontWeight: '300' },
});
