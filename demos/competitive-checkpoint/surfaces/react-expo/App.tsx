import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

import type { GeneratedDataModel } from '../../snapback/generated/api';

import { checkpointProvider, deterministicStreamOrigin } from './provider';
import { api, useSnapbackQuery } from './generated/runtime.mjs';

type Conversation = GeneratedDataModel['conversations'];
type Message = GeneratedDataModel['messages'];
const USER_ID = 'user_checkpoint_ada';

export default function App() {
  const conversations = useSnapbackQuery<Conversation>({
    provider: checkpointProvider,
    query: api.listConversations,
    userId: USER_ID,
    authority: USER_ID,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedId && conversations.rows.some((row) => row._id === selectedId)) return;
    setSelectedId(conversations.rows[0]?._id ?? null);
  }, [conversations.rows, selectedId]);

  const createConversation = async () => {
    const suffix = Date.now().toString(36);
    const created = await conversations.mutate<Conversation>(api.createConversation, {
      slug: `chat-${suffix}`,
      title: `Chat ${conversations.rows.length + 1}`,
      model: 'deterministic-v0',
    });
    setSelectedId(created._id);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={styles.shell}>
        <View style={styles.rail}>
          <Text style={styles.brand}>Snapback</Text>
          <Text style={styles.profile}>AI chat checkpoint · {Platform.OS}</Text>
          <Pressable testID="new-conversation" style={styles.newButton} onPress={() => void createConversation()}>
            <Text style={styles.newButtonText}>＋ New chat</Text>
          </Pressable>
          {conversations.status === 'pending' ? <ActivityIndicator /> : null}
          {conversations.rows.map((row) => (
            <Pressable
              key={row._id}
              testID={`conversation-${row._id}`}
              style={[styles.conversation, row._id === selectedId && styles.conversationSelected]}
              onPress={() => setSelectedId(row._id)}
            >
              <Text numberOfLines={1} style={styles.conversationText}>{row.title}</Text>
            </Pressable>
          ))}
          <Text testID="connection" style={styles.connection}>
            {conversations.connection} · native push · fallback off
          </Text>
        </View>
        <View style={styles.main}>
          {selectedId ? <Thread conversationId={selectedId} /> : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Start a conversation</Text>
              <Text style={styles.emptyBody}>The generated owner CRUD creates the first thread.</Text>
            </View>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

function Thread({ conversationId }: { conversationId: string }) {
  const messages = useSnapbackQuery<Message>({
    provider: checkpointProvider,
    query: api.listMessages,
    args: { conversationId },
    userId: USER_ID,
    authority: USER_ID,
  });
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const activeAttempt = useRef<string | null>(null);
  const ordered = useMemo(() => [...messages.rows].sort((a, b) => a.pageKey.localeCompare(b.pageKey)), [messages.rows]);

  const send = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setDraft('');
    try {
      const started = await messages.mutate<{ attemptId: string }>(api.startReply, {
        conversationId,
        content,
        idempotencyKey: `${USER_ID}:${Date.now().toString(36)}`,
      });
      activeAttempt.current = started.attemptId;
      await checkpointProvider.action(api.streamReply, {
        attemptId: started.attemptId,
        streamUrl: `${deterministicStreamOrigin}/stream`,
        method: 'GET',
        upstreamIdempotent: true,
      }, USER_ID);
    } finally {
      activeAttempt.current = null;
      setSending(false);
    }
  };

  const cancel = async () => {
    if (!activeAttempt.current) return;
    await messages.mutate(api.cancelReply, { attemptId: activeAttempt.current });
  };

  return (
    <View style={styles.thread}>
      <FlatList
        testID="messages"
        style={styles.messages}
        contentContainerStyle={styles.messageContent}
        data={ordered}
        keyExtractor={(row) => row._id}
        renderItem={({ item }) => (
          <View style={[styles.bubble, item.role === 'user' ? styles.userBubble : styles.assistantBubble]}>
            <Text style={styles.role}>{item.role}</Text>
            <Text style={styles.messageText}>{item.content || (item.status === 'running' ? 'Thinking…' : '—')}</Text>
            <Text testID={`status-${item._id}`} style={styles.messageStatus}>{item.status} · seq {item.sequence}</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.emptyBody}>Send the deterministic 16-chunk fixture.</Text>}
      />
      <View style={styles.composer}>
        <TextInput
          testID="composer"
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Message"
          multiline
        />
        {sending ? (
          <Pressable testID="cancel" style={styles.cancelButton} onPress={() => void cancel()}>
            <Text style={styles.cancelText}>Stop</Text>
          </Pressable>
        ) : (
          <Pressable testID="send" style={styles.sendButton} onPress={() => void send()}>
            <Text style={styles.sendText}>Send</Text>
          </Pressable>
        )}
      </View>
      <Text style={styles.connection}>{messages.connection} · {messages.status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f7f5ef' },
  shell: { flex: 1, flexDirection: Platform.OS === 'web' ? 'row' : 'column' },
  rail: { width: Platform.OS === 'web' ? 280 : '100%', padding: 20, gap: 10, backgroundColor: '#17221d' },
  brand: { color: '#f8f3e7', fontSize: 24, fontWeight: '800' },
  profile: { color: '#a9baae', fontSize: 12 },
  newButton: { backgroundColor: '#d7ff72', borderRadius: 10, padding: 12 },
  newButtonText: { color: '#17221d', fontWeight: '800' },
  conversation: { padding: 10, borderRadius: 8 },
  conversationSelected: { backgroundColor: '#30453a' },
  conversationText: { color: '#eef5ed' },
  connection: { color: '#829489', fontSize: 11, marginTop: 4 },
  main: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyTitle: { fontSize: 28, fontWeight: '800', color: '#17221d' },
  emptyBody: { color: '#68736b', marginTop: 8 },
  thread: { flex: 1 },
  messages: { flex: 1 },
  messageContent: { padding: 20, gap: 12 },
  bubble: { maxWidth: 680, borderRadius: 16, padding: 14 },
  userBubble: { backgroundColor: '#d7ff72', alignSelf: 'flex-end' },
  assistantBubble: { backgroundColor: '#ffffff', alignSelf: 'flex-start' },
  role: { color: '#68736b', fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  messageText: { color: '#17221d', fontSize: 16, marginTop: 4 },
  messageStatus: { color: '#829489', fontSize: 10, marginTop: 8 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, padding: 16, backgroundColor: '#ece9df' },
  input: { flex: 1, minHeight: 46, maxHeight: 140, borderRadius: 14, backgroundColor: '#fff', padding: 12, color: '#17221d' },
  sendButton: { backgroundColor: '#17221d', borderRadius: 14, paddingHorizontal: 18, paddingVertical: 14 },
  sendText: { color: '#fff', fontWeight: '800' },
  cancelButton: { borderColor: '#a4382c', borderWidth: 1, borderRadius: 14, paddingHorizontal: 18, paddingVertical: 13 },
  cancelText: { color: '#a4382c', fontWeight: '800' },
});
