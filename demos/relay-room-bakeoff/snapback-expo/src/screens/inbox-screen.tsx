import { useSnapbackConnection, useSnapbackQuery } from '@expo/snapback-react';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { snapbackApi, useRelay } from '@/providers/relay-provider';
import { palette } from '@/theme/colors';
import { inboxTime } from '@/lib/time';

export default function InboxScreen() {
  const router = useRouter();
  const { activeUserId, setActiveUserId } = useRelay();
  const [showPeople, setShowPeople] = useState(false);
  const users = useSnapbackQuery(snapbackApi.users, {});
  const conversations = useSnapbackQuery(snapbackApi.conversations, {});
  const memberships = useSnapbackQuery(snapbackApi.membershipsForUser, { userId: activeUserId });
  const connection = useSnapbackConnection();

  const activeUser = users.data?.find((user) => user._id === activeUserId);
  const memberIds = useMemo(() => new Set((memberships.data ?? []).map((row) => row.conversationId)), [memberships.data]);
  const rows = [...(conversations.data ?? [])]
    .filter((conversation) => memberIds.has(conversation._id))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const retained = conversations.freshness === 'retained' || memberships.freshness === 'retained';
  const online = connection.status === 'live' || connection.status === 'polling';

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>RELAY ROOM · SNAPBACK</Text>
          <Text style={styles.heading}>Messages</Text>
        </View>
        <Pressable
          accessibilityLabel="Switch test user"
          onPress={() => setShowPeople((value) => !value)}
          style={({ pressed }) => [styles.identity, pressed && styles.pressed]}
        >
          <Avatar name={activeUser?.name ?? 'Ada'} color={activeUser?.color ?? palette.accent} size={34} />
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
                onPress={() => {
                  void Haptics.selectionAsync();
                  setActiveUserId(user._id);
                  setShowPeople(false);
                }}
                style={[styles.personButton, user._id === activeUserId && styles.personButtonActive]}
              >
                <Avatar name={user.name} color={user.color} size={32} />
                <Text numberOfLines={1} style={styles.personName}>{user.name.split(' ')[0]}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      <View style={[styles.networkBanner, online ? styles.networkOnline : styles.networkOffline]}>
        <View style={[styles.dot, { backgroundColor: online ? palette.success : palette.warning }]} />
        <Text style={styles.networkText}>{online ? 'Live sync' : 'Offline'}</Text>
        {retained ? <Text style={styles.savedText}>Showing saved conversations</Text> : null}
      </View>

      <FlatList
        contentContainerStyle={rows.length ? styles.list : styles.emptyList}
        data={rows}
        keyExtractor={(item) => item._id}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/chat/[id]', params: { id: item._id, title: item.title } })}
            style={({ pressed }) => [styles.conversation, pressed && styles.pressed]}
          >
            <View style={[styles.chatAvatar, { backgroundColor: item.kind === 'group' ? '#264653' : '#7C5CFC' }]}>
              <Text style={styles.chatAvatarText}>{item.kind === 'group' ? '•••' : item.title.slice(0, 1)}</Text>
            </View>
            <View style={styles.conversationCopy}>
              <View style={styles.conversationTop}>
                <Text numberOfLines={1} style={styles.conversationTitle}>{item.title}</Text>
                <Text style={styles.time}>{inboxTime(item.updatedAt)}</Text>
              </View>
              <Text numberOfLines={1} style={styles.preview}>{item.lastPreview}</Text>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={(
          <View style={styles.empty}>
            {conversations.status === 'pending' || memberships.status === 'pending' ? <ActivityIndicator color={palette.accent} /> : null}
            <Text style={styles.emptyTitle}>No conversations yet</Text>
            <Text style={styles.emptyCopy}>Seed data appears after the first backend connection.</Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: palette.canvas, flex: 1 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 14, paddingTop: 10 },
  eyebrow: { color: palette.accent, fontSize: 11, fontWeight: '900', letterSpacing: 1.1 },
  heading: { color: palette.ink, fontSize: 34, fontWeight: '900', letterSpacing: -1.2 },
  identity: { alignItems: 'center', backgroundColor: palette.surface, borderColor: palette.line, borderRadius: 18, borderWidth: 1, flexDirection: 'row', gap: 9, maxWidth: 175, padding: 7 },
  testMode: { color: palette.accent, fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  identityName: { color: palette.ink, fontSize: 12, fontWeight: '700' },
  peoplePanel: { backgroundColor: palette.surface, borderBottomColor: palette.line, borderTopColor: palette.line, borderWidth: StyleSheet.hairlineWidth, gap: 10, padding: 14 },
  peopleHint: { color: palette.muted, fontSize: 11, fontWeight: '600' },
  peopleRow: { flexDirection: 'row', gap: 8 },
  personButton: { alignItems: 'center', borderColor: 'transparent', borderRadius: 14, borderWidth: 2, gap: 4, minWidth: 64, padding: 6 },
  personButtonActive: { backgroundColor: palette.accentSoft, borderColor: palette.accent },
  personName: { color: palette.ink, fontSize: 11, fontWeight: '700' },
  networkBanner: { alignItems: 'center', flexDirection: 'row', gap: 7, marginHorizontal: 18, marginBottom: 10, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
  networkOnline: { backgroundColor: '#E5F4EE' },
  networkOffline: { backgroundColor: '#FFF0D9' },
  dot: { borderRadius: 4, height: 8, width: 8 },
  networkText: { color: palette.ink, fontSize: 12, fontWeight: '800' },
  savedText: { color: palette.muted, fontSize: 11, marginLeft: 'auto' },
  list: { paddingBottom: 24 },
  emptyList: { flexGrow: 1 },
  conversation: { alignItems: 'center', backgroundColor: palette.surface, borderBottomColor: palette.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 13, paddingHorizontal: 18, paddingVertical: 15 },
  chatAvatar: { alignItems: 'center', borderRadius: 24, height: 48, justifyContent: 'center', width: 48 },
  chatAvatarText: { color: '#FFFFFF', fontSize: 17, fontWeight: '900' },
  conversationCopy: { flex: 1, gap: 5 },
  conversationTop: { alignItems: 'baseline', flexDirection: 'row', gap: 10 },
  conversationTitle: { color: palette.ink, flex: 1, fontSize: 16, fontWeight: '800' },
  time: { color: palette.muted, fontSize: 11 },
  preview: { color: palette.muted, fontSize: 14 },
  empty: { alignItems: 'center', flex: 1, gap: 8, justifyContent: 'center', padding: 30 },
  emptyTitle: { color: palette.ink, fontSize: 18, fontWeight: '800' },
  emptyCopy: { color: palette.muted, textAlign: 'center' },
  pressed: { opacity: 0.66 },
});
