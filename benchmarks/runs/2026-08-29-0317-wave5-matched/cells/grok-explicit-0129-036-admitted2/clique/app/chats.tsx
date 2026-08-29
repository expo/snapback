import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSnapbackQuery } from '@expo/snapback-expo';
import { ChatListRow, palette, spacing, typeScale } from '@snapback-bench/social-ui';
import api from '../snapback/generated/api.mjs';
import { EMPTY } from '../src/lib/empty';
import { formatTime } from '../src/lib/snapback';

function counterpartHandle(clientId: string, myHandle: string) {
  const parts = String(clientId).replace(/^d-/, '').split('-').filter(Boolean);
  return parts.find((part) => part !== myHandle) ?? parts[parts.length - 1] ?? clientId;
}

export default function ChatsScreen() {
  const router = useRouter();
  const chats = useSnapbackQuery(api.myChats, EMPTY);
  const mine = useSnapbackQuery(api.getMine, EMPTY);
  const myHandle = mine.data?.[0]?.handle ?? '';
  const rows = myHandle ? (chats.data ?? []) : [];
  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <Text style={styles.title}>Chats</Text>
        <Pressable onPress={() => router.push('/new')} style={styles.newBtn}>
          <Text style={styles.newText}>New</Text>
        </Pressable>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.chatId}
        renderItem={({ item }) => {
          const other = item.kind === 'dm' ? counterpartHandle(item.clientId, myHandle) : item.clientId;
          return (
            <ChatListRow
              title={item.name || other}
              preview={item.lastPreview}
              timestamp={formatTime(item.lastMessageAt)}
              unreadCount={item.unreadCount ?? 0}
              identity={item.kind === 'dm' ? `dm:${other}` : `group:${item.clientId}`}
              onPress={() => {
                if (item.kind === 'dm') {
                  router.push(`/conversation/${other}`);
                } else {
                  router.push(`/conversation/group/${item.name || item.clientId}`);
                }
              }}
            />
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', padding: spacing.lg },
  title: { ...typeScale.title, color: palette.text },
  newBtn: { padding: spacing.sm },
  newText: { ...typeScale.body, color: palette.primary, fontWeight: '700' },
});
