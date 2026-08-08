import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { useSnapbackConnection, useSnapbackQuery } from '@expo/snapback-expo';

import api from '../../snapback/generated/api.mjs';
import type { Id } from '../../snapback/generated/api.d.ts';
import { Avatar } from '../avatar';
import { palette } from '../palette';
import { useTestPersona } from '../test-persona-context';
import { inboxTime } from '../time';

function diagnosticText(value: unknown) {
  if (!value) return null;
  if (value instanceof Error) return value.message;
  if (typeof value === 'object' && 'message' in value) return String(value.message);
  return String(value);
}

export default function InboxScreen({ onOpen }: Readonly<{
  onOpen(id: Id<'conversations'>, title: string): void;
}>) {
  const { activeUserId, setActiveUserId } = useTestPersona();
  const [showPeople, setShowPeople] = useState(false);
  const users = useSnapbackQuery(api.users, {});
  const conversations = useSnapbackQuery(api.conversations, {});
  const memberships = useSnapbackQuery(api.membershipsForUser, { userId: activeUserId });
  const connection = useSnapbackConnection();
  const activeUser = users.data?.find((user) => user._id === activeUserId);
  const memberIds = useMemo(
    () => new Set((memberships.data ?? []).map((row) => row.conversationId)),
    [memberships.data],
  );
  const rows = [...(conversations.data ?? [])]
    .filter((row) => memberIds.has(row._id))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const retained = conversations.freshness === 'retained' || memberships.freshness === 'retained';
  const online = connection.status === 'live' || connection.status === 'polling';
  const pending = conversations.status === 'pending' || memberships.status === 'pending';
  const queryError = diagnosticText(conversations.error ?? memberships.error ?? users.error);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>RELAY ROOM · SNAPBACK</Text>
          <Text style={styles.heading}>Messages</Text>
        </View>
        <Pressable accessibilityLabel="Switch test persona" onPress={() => setShowPeople((value) => !value)} style={styles.identity}>
          <Avatar name={activeUser?.name ?? 'Ada'} color={activeUser?.color ?? palette.accent} size={34} />
          <View><Text style={styles.testMode}>TEST PERSONA</Text><Text style={styles.identityName}>{activeUser?.name ?? 'Ada'}</Text></View>
        </Pressable>
      </View>
      {showPeople ? (
        <View style={styles.peoplePanel}>
          <Text style={styles.peopleHint}>Seeded demo identities only — production identity comes from the session.</Text>
          <View style={styles.peopleRow}>{(users.data ?? []).map((user) => (
            <Pressable
              key={user._id}
              onPress={() => { setActiveUserId(user._id); setShowPeople(false); }}
              style={[styles.person, user._id === activeUserId && styles.personActive]}
            >
              <Avatar name={user.name} color={user.color} size={32} />
              <Text numberOfLines={1} style={styles.personName}>{user.name.split(' ')[0]}</Text>
            </Pressable>
          ))}</View>
        </View>
      ) : null}
      <View style={[styles.network, online ? styles.online : styles.offline]}>
        <View style={[styles.dot, { backgroundColor: online ? palette.success : palette.warning }]} />
        <Text style={styles.networkText}>{online ? 'Live sync' : 'Offline'}</Text>
        {retained ? <Text style={styles.saved}>Showing saved conversations</Text> : null}
      </View>
      {queryError ? <Text style={styles.error}>{queryError}</Text> : null}
      <FlatList
        contentContainerStyle={rows.length ? styles.list : styles.emptyList}
        data={rows}
        keyExtractor={(item) => item._id}
        renderItem={({ item }) => (
          <Pressable accessibilityRole="button" onPress={() => onOpen(item._id, item.title)} style={styles.conversation}>
            <View style={[styles.chatAvatar, { backgroundColor: item.kind === 'group' ? '#264653' : palette.accent }]}>
              <Text style={styles.chatAvatarText}>{item.kind === 'group' ? '•••' : item.title.slice(0, 1)}</Text>
            </View>
            <View style={styles.copy}>
              <View style={styles.top}><Text numberOfLines={1} style={styles.conversationTitle}>{item.title}</Text><Text style={styles.time}>{inboxTime(item.updatedAt)}</Text></View>
              <Text style={styles.kind}>{item.kind === 'group' ? 'GROUP' : 'DIRECT MESSAGE'}</Text>
              <Text numberOfLines={1} style={styles.preview}>{item.lastPreview}</Text>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={<View style={styles.empty}>{pending ? <ActivityIndicator color={palette.accent} /> : null}<Text style={styles.emptyTitle}>No conversations yet</Text><Text style={styles.emptyCopy}>Seed data appears after the first backend connection.</Text></View>}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: palette.canvas, flex: 1 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', padding: 18 },
  eyebrow: { color: palette.accent, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  heading: { color: palette.ink, fontSize: 34, fontWeight: '900' },
  identity: { alignItems: 'center', backgroundColor: palette.surface, borderColor: palette.line, borderRadius: 18, borderWidth: 1, flexDirection: 'row', gap: 8, padding: 7 },
  testMode: { color: palette.accent, fontSize: 8, fontWeight: '900' },
  identityName: { color: palette.ink, fontSize: 12, fontWeight: '700' },
  peoplePanel: { backgroundColor: palette.surface, borderColor: palette.line, borderWidth: StyleSheet.hairlineWidth, gap: 9, padding: 12 },
  peopleHint: { color: palette.muted, fontSize: 11 },
  peopleRow: { flexDirection: 'row', gap: 8 },
  person: { alignItems: 'center', borderRadius: 14, gap: 4, minWidth: 62, padding: 5 },
  personActive: { backgroundColor: palette.accentSoft },
  personName: { color: palette.ink, fontSize: 11, fontWeight: '700' },
  network: { alignItems: 'center', borderRadius: 12, flexDirection: 'row', gap: 7, marginBottom: 10, marginHorizontal: 18, padding: 9 },
  online: { backgroundColor: '#E5F4EE' },
  offline: { backgroundColor: '#FFF0D9' },
  dot: { borderRadius: 4, height: 8, width: 8 },
  networkText: { color: palette.ink, fontSize: 12, fontWeight: '800' },
  saved: { color: palette.muted, fontSize: 11, marginLeft: 'auto' },
  error: { color: palette.danger, fontSize: 12, marginBottom: 8, marginHorizontal: 18 },
  list: { paddingBottom: 24 },
  emptyList: { flexGrow: 1 },
  conversation: { alignItems: 'center', backgroundColor: palette.surface, borderBottomColor: palette.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 13, padding: 15 },
  chatAvatar: { alignItems: 'center', borderRadius: 24, height: 48, justifyContent: 'center', width: 48 },
  chatAvatarText: { color: '#FFF', fontWeight: '900' },
  copy: { flex: 1, gap: 3 },
  top: { alignItems: 'baseline', flexDirection: 'row', gap: 10 },
  conversationTitle: { color: palette.ink, flex: 1, fontSize: 16, fontWeight: '800' },
  time: { color: palette.muted, fontSize: 11 },
  kind: { color: palette.accent, fontSize: 9, fontWeight: '900', letterSpacing: 0.7 },
  preview: { color: palette.muted, fontSize: 14 },
  empty: { alignItems: 'center', flex: 1, gap: 8, justifyContent: 'center', padding: 30 },
  emptyTitle: { color: palette.ink, fontSize: 18, fontWeight: '800' },
  emptyCopy: { color: palette.muted, textAlign: 'center' },
});
