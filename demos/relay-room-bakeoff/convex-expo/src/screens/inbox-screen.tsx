import { useNetInfo } from '@react-native-community/netinfo';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import { api } from '../../convex/_generated/api';
import { Avatar } from '@/components/avatar';
import { useCachedQuery } from '@/lib/cache';
import { usePersona } from '@/providers/convex-provider';
import { colors } from '@/theme/colors';

export default function InboxScreen() {
  const router = useRouter();
  const network = useNetInfo();
  const online = network.isConnected !== false;
  const { activeHandle, setActiveHandle } = usePersona();
  const [showPeople, setShowPeople] = useState(false);
  const users = useCachedQuery(api.relay.users, {}, 'relay.convex.users');
  const activeUser = users.data?.find((user) => user.handle === activeHandle) ?? users.data?.[0];
  const conversations = useCachedQuery(
    api.relay.conversationsForUser,
    activeUser ? { userId: activeUser._id } : 'skip',
    `relay.convex.conversations.${activeUser?._id ?? 'pending'}`,
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <View><Text style={styles.eyebrow}>RELAY ROOM · CONVEX</Text><Text style={styles.heading}>Messages</Text></View>
        <Pressable onPress={() => setShowPeople((value) => !value)} style={({ pressed }) => [styles.identity, pressed && styles.pressed]}>
          <Avatar name={activeUser?.name ?? 'Ada'} color={activeUser?.color ?? colors.accent} size={34} />
          <View><Text style={styles.testMode}>TEST MODE</Text><Text style={styles.identityName}>{activeUser?.name ?? 'Ada'}</Text></View>
        </Pressable>
      </View>

      {showPeople ? (
        <View style={styles.peoplePanel}>
          <Text style={styles.peopleHint}>Switch personas without signing out</Text>
          <View style={styles.peopleRow}>
            {(users.data ?? []).map((user) => (
              <Pressable
                key={user._id}
                onPress={() => { void Haptics.selectionAsync(); setActiveHandle(user.handle); setShowPeople(false); }}
                style={[styles.personButton, user.handle === activeHandle && styles.personButtonActive]}
              >
                <Avatar name={user.name} color={user.color} size={32} />
                <Text style={styles.personName}>{user.name.split(' ')[0]}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      <View style={[styles.banner, online ? styles.online : styles.offline]}>
        <View style={[styles.dot, { backgroundColor: online ? colors.success : colors.warning }]} />
        <Text style={styles.bannerTitle}>{online ? 'Connected' : 'Offline'}</Text>
        {conversations.freshness === 'cached' ? <Text style={styles.cached}>App-owned cached snapshot</Text> : null}
      </View>

      <FlatList
        contentContainerStyle={(conversations.data?.length ?? 0) ? styles.list : styles.emptyList}
        data={conversations.data ?? []}
        keyExtractor={(item) => item._id}
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push({ pathname: '/chat/[id]', params: { id: item._id, title: item.title } })} style={({ pressed }) => [styles.conversation, pressed && styles.pressed]}>
            <View style={[styles.chatAvatar, { backgroundColor: item.kind === 'group' ? '#264653' : colors.accent }]}><Text style={styles.chatAvatarText}>{item.kind === 'group' ? '•••' : item.title.slice(0, 1)}</Text></View>
            <View style={styles.copy}>
              <View style={styles.topRow}><Text numberOfLines={1} style={styles.title}>{item.title}</Text><Text style={styles.time}>{formatTime(item.updatedAt)}</Text></View>
              <Text numberOfLines={1} style={styles.preview}>{item.lastPreview}</Text>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={<View style={styles.empty}>{!users.data ? <ActivityIndicator color={colors.accent} /> : null}<Text style={styles.emptyTitle}>No conversations yet</Text><Text style={styles.emptyCopy}>The idempotent seed creates three sample chats.</Text></View>}
      />
    </SafeAreaView>
  );
}

function formatTime(value: number) {
  const date = new Date(value);
  if (date.toDateString() === new Date().toDateString()) return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

const styles = StyleSheet.create({
  safe: { backgroundColor: colors.canvas, flex: 1 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 14, paddingHorizontal: 18, paddingTop: 10 },
  eyebrow: { color: colors.accent, fontSize: 11, fontWeight: '900', letterSpacing: 1.1 },
  heading: { color: colors.ink, fontSize: 34, fontWeight: '900', letterSpacing: -1.2 },
  identity: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.line, borderRadius: 18, borderWidth: 1, flexDirection: 'row', gap: 9, maxWidth: 175, padding: 7 },
  testMode: { color: colors.accent, fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  identityName: { color: colors.ink, fontSize: 12, fontWeight: '700' },
  peoplePanel: { backgroundColor: colors.surface, borderColor: colors.line, borderWidth: StyleSheet.hairlineWidth, gap: 10, padding: 14 },
  peopleHint: { color: colors.muted, fontSize: 11, fontWeight: '600' },
  peopleRow: { flexDirection: 'row', gap: 8 },
  personButton: { alignItems: 'center', borderColor: 'transparent', borderRadius: 14, borderWidth: 2, gap: 4, minWidth: 64, padding: 6 },
  personButtonActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  personName: { color: colors.ink, fontSize: 11, fontWeight: '700' },
  banner: { alignItems: 'center', borderRadius: 12, flexDirection: 'row', gap: 7, marginBottom: 10, marginHorizontal: 18, paddingHorizontal: 12, paddingVertical: 8 },
  online: { backgroundColor: '#E4F5EF' },
  offline: { backgroundColor: '#FFF0D9' },
  dot: { borderRadius: 4, height: 8, width: 8 },
  bannerTitle: { color: colors.ink, fontSize: 12, fontWeight: '800' },
  cached: { color: colors.muted, fontSize: 11, marginLeft: 'auto' },
  list: { paddingBottom: 24 },
  emptyList: { flexGrow: 1 },
  conversation: { alignItems: 'center', backgroundColor: colors.surface, borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 13, paddingHorizontal: 18, paddingVertical: 15 },
  chatAvatar: { alignItems: 'center', borderRadius: 24, height: 48, justifyContent: 'center', width: 48 },
  chatAvatarText: { color: '#FFFFFF', fontSize: 17, fontWeight: '900' },
  copy: { flex: 1, gap: 5 },
  topRow: { alignItems: 'baseline', flexDirection: 'row', gap: 8 },
  title: { color: colors.ink, flex: 1, fontSize: 16, fontWeight: '800' },
  time: { color: colors.muted, fontSize: 11 },
  preview: { color: colors.muted, fontSize: 14 },
  empty: { alignItems: 'center', flex: 1, gap: 8, justifyContent: 'center', padding: 30 },
  emptyTitle: { color: colors.ink, fontSize: 18, fontWeight: '800' },
  emptyCopy: { color: colors.muted, textAlign: 'center' },
  pressed: { opacity: 0.66 },
});
