import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BACKENDS, conversationTitle, type Backend, type MessageRow } from '../../shared/model';
import { KeyboardAvoiding, keyboardEngine } from './keyboard';
import { createChatSession, fetchModelCatalog, type ChatSession, type Transport } from './providers';

const DEFAULT_MODEL = 'anthropic/claude-haiku-4.5';
// Bundle-time verification hook: EXPO_PUBLIC_AUTODEMO=1 focuses the composer
// (raising the keyboard) and sends one scripted message — lets headless
// acceptance drive the full on-device loop without synthetic taps.
const AUTODEMO = process.env.EXPO_PUBLIC_AUTODEMO === '1';
const INITIAL_BACKEND: Backend = (BACKENDS as readonly string[]).includes(process.env.EXPO_PUBLIC_INITIAL_BACKEND ?? '')
  ? (process.env.EXPO_PUBLIC_INITIAL_BACKEND as Backend)
  : 'sqlite';

export function ChatApp() {
  const insets = useSafeAreaInsets();
  const [backend, setBackend] = useState<Backend>(INITIAL_BACKEND);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [transport, setTransport] = useState<Transport>('connecting');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const sessionRef = useRef<ChatSession | null>(null);

  const session = useMemo(() => {
    sessionRef.current?.dispose();
    const next = createChatSession(backend);
    sessionRef.current = next;
    return next;
  }, [backend]);

  useEffect(() => () => sessionRef.current?.dispose(), []);

  // Switching backend or conversation rewires the subscription.
  useEffect(() => {
    setMessages([]);
    if (!conversationId) return undefined;
    const dispose = session.subscribe(conversationId, (rows, nextTransport) => {
      setMessages(rows);
      setTransport(nextTransport);
    });
    return dispose;
  }, [session, conversationId]);

  const switchBackend = useCallback((next: Backend) => {
    setBackend(next);
    setConversationId(null);
    setMessages([]);
    setTransport('connecting');
  }, []);

  const send = useCallback(async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setDraft('');
    try {
      let target = conversationId;
      if (!target) {
        target = await session.createConversation(model, conversationTitle(content));
        setConversationId(target);
      }
      await session.sendMessage(target, content);
    } catch (error) {
      setDraft(content);
      console.warn('send failed', error);
    } finally {
      setSending(false);
    }
  }, [draft, sending, conversationId, session, model]);

  const inverted = useMemo(() => [...messages].reverse(), [messages]);

  const autoDemoFired = useRef(false);
  useEffect(() => {
    if (!AUTODEMO || autoDemoFired.current) return;
    autoDemoFired.current = true;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const target = await session.createConversation(model, 'autodemo');
          setConversationId(target);
          await session.sendMessage(target, `Reply with one short sentence praising the ${backend} backend.`);
        } catch (error) {
          console.warn('autodemo send failed', error);
        }
      })();
    }, 2000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Header
        backend={backend}
        model={model}
        transport={transport}
        onBackend={switchBackend}
        onPickModel={() => setPickerOpen(true)}
        onNewChat={() => { setConversationId(null); setMessages([]); }}
      />
      <KeyboardAvoiding style={styles.body}>
        <FlatList
          testID="thread"
          style={styles.list}
          contentContainerStyle={styles.listContent}
          data={inverted}
          inverted
          keyExtractor={(item) => item._id}
          renderItem={({ item }) => <MessageBubble message={item} />}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyTitle}>
                {conversationId ? 'No messages yet' : `Chat via ${backend}`}
              </Text>
              <Text style={styles.emptyBody}>
                Model: {model}{'\n'}Say something to start the conversation.
              </Text>
            </View>
          }
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
        />
        <Composer
          draft={draft}
          onDraft={setDraft}
          onSend={send}
          sending={sending}
          bottomInset={insets.bottom}
        />
      </KeyboardAvoiding>
      <ModelPicker
        open={pickerOpen}
        current={model}
        onClose={() => setPickerOpen(false)}
        onSelect={(next) => {
          setModel(next);
          setPickerOpen(false);
          setConversationId(null);
          setMessages([]);
        }}
      />
    </View>
  );
}

function Header(props: {
  backend: Backend;
  model: string;
  transport: Transport;
  onBackend: (backend: Backend) => void;
  onPickModel: () => void;
  onNewChat: () => void;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.backendRow}>
        {BACKENDS.map((candidate) => (
          <Pressable
            key={candidate}
            testID={`backend-${candidate}`}
            onPress={() => props.onBackend(candidate)}
            style={[styles.chip, props.backend === candidate && styles.chipActive]}
          >
            <Text style={[styles.chipText, props.backend === candidate && styles.chipTextActive]}>
              {candidate}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.modelRow}>
        <Pressable testID="model-button" onPress={props.onPickModel} style={styles.modelButton}>
          <Text style={styles.modelButtonText} numberOfLines={1}>{props.model}</Text>
        </Pressable>
        <Text testID="transport" style={styles.transport}>{props.transport}</Text>
        <Text testID="stack-badge" style={styles.transport}>built with Expo</Text>
        <Pressable testID="new-chat" onPress={props.onNewChat} style={styles.newChat}>
          <Text style={styles.newChatText}>＋ New</Text>
        </Pressable>
      </View>
    </View>
  );
}

function MessageBubble({ message }: { message: MessageRow }) {
  const isUser = message.role === 'user';
  const busy = message.status === 'pending' || message.status === 'streaming';
  return (
    <View
      testID={`message-${message._id}`}
      style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant, message.status === 'error' && styles.bubbleError]}
    >
      {message.content.length === 0 && busy ? (
        <ActivityIndicator size="small" color={isUser ? '#fff' : '#666'} />
      ) : (
        <Text style={[styles.bubbleText, isUser && styles.bubbleTextUser]}>
          {message.content}
          {message.status === 'streaming' ? ' ▍' : ''}
        </Text>
      )}
    </View>
  );
}

function Composer(props: {
  draft: string;
  onDraft: (value: string) => void;
  onSend: () => void;
  sending: boolean;
  bottomInset: number;
}) {
  const canSend = props.draft.trim().length > 0 && !props.sending;
  return (
    <View style={[styles.composer, { paddingBottom: Math.max(props.bottomInset, 8) }]}>
      <TextInput
        testID="composer-input"
        style={styles.input}
        value={props.draft}
        onChangeText={props.onDraft}
        placeholder="Message…"
        placeholderTextColor="#98989f"
        autoFocus={AUTODEMO}
        multiline
        submitBehavior={Platform.OS === 'web' ? 'submit' : 'newline'}
        onSubmitEditing={Platform.OS === 'web' ? props.onSend : undefined}
      />
      <Pressable
        testID="send"
        onPress={props.onSend}
        disabled={!canSend}
        style={[styles.send, !canSend && styles.sendDisabled]}
      >
        <Text style={styles.sendText}>↑</Text>
      </Pressable>
    </View>
  );
}

function ModelPicker(props: {
  open: boolean;
  current: string;
  onClose: () => void;
  onSelect: (model: string) => void;
}) {
  const [featured, setFeatured] = useState<readonly string[]>([]);
  const [all, setAll] = useState<{ id: string; name: string }[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open) return;
    fetchModelCatalog()
      .then((catalog) => { setFeatured(catalog.featured); setAll(catalog.models); setError(null); })
      .catch((cause) => setError(String(cause?.message ?? cause)));
  }, [props.open]);

  const rows = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (trimmed.length === 0) {
      const rest = all.filter((candidate) => !featured.includes(candidate.id));
      return [...featured.map((id) => ({ id, name: id })), ...rest];
    }
    return all.filter((candidate) => candidate.id.toLowerCase().includes(trimmed) || candidate.name.toLowerCase().includes(trimmed));
  }, [featured, all, query]);

  return (
    <Modal visible={props.open} animationType="slide" onRequestClose={props.onClose} presentationStyle="pageSheet">
      <View style={styles.pickerRoot}>
        <View style={styles.pickerHeader}>
          <Text style={styles.pickerTitle}>Choose a model</Text>
          <Pressable testID="picker-close" onPress={props.onClose}><Text style={styles.pickerClose}>Done</Text></Pressable>
        </View>
        <TextInput
          testID="picker-search"
          style={styles.pickerSearch}
          value={query}
          onChangeText={setQuery}
          placeholder="Search models…"
          placeholderTextColor="#98989f"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {error ? <Text style={styles.pickerError}>Model catalog unavailable: {error}</Text> : null}
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Pressable
              testID={`model-${item.id}`}
              onPress={() => props.onSelect(item.id)}
              style={[styles.pickerRow, item.id === props.current && styles.pickerRowActive]}
            >
              <Text style={styles.pickerRowText}>{item.id}</Text>
              {featured.includes(item.id) ? <Text style={styles.pickerStar}>★</Text> : null}
            </Pressable>
          )}
          keyboardShouldPersistTaps="handled"
        />
        <Text style={styles.engineNote}>keyboard engine: {keyboardEngine}</Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f4f4f6' },
  body: { flex: 1 },
  header: { paddingHorizontal: 12, paddingBottom: 8, gap: 8, backgroundColor: '#f4f4f6' },
  backendRow: { flexDirection: 'row', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#e4e4ea' },
  chipActive: { backgroundColor: '#1f1f24' },
  chipText: { fontSize: 13, color: '#4a4a52' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  modelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modelButton: { flexShrink: 1, backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: '#d9d9e0' },
  modelButtonText: { fontSize: 13, color: '#1f1f24' },
  transport: { fontSize: 11, color: '#8a8a92' },
  newChat: { marginLeft: 'auto' },
  newChatText: { fontSize: 14, color: '#3478f6', fontWeight: '600' },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  emptyWrap: { padding: 24, alignItems: 'center', transform: [{ scaleY: -1 }] },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: '#3a3a40', marginBottom: 6 },
  emptyBody: { fontSize: 13, color: '#8a8a92', textAlign: 'center', lineHeight: 19 },
  bubble: { maxWidth: '84%', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 9 },
  bubbleUser: { alignSelf: 'flex-end', backgroundColor: '#3478f6', borderBottomRightRadius: 4 },
  bubbleAssistant: { alignSelf: 'flex-start', backgroundColor: '#fff', borderBottomLeftRadius: 4 },
  bubbleError: { backgroundColor: '#fdecec' },
  bubbleText: { fontSize: 15, lineHeight: 21, color: '#1f1f24' },
  bubbleTextUser: { color: '#fff' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 8, backgroundColor: '#f4f4f6' },
  input: { flex: 1, minHeight: 40, maxHeight: 120, borderRadius: 20, borderWidth: 1, borderColor: '#d9d9e0', backgroundColor: '#fff', paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, fontSize: 15, color: '#1f1f24' },
  send: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#3478f6', alignItems: 'center', justifyContent: 'center' },
  sendDisabled: { backgroundColor: '#b9cdf8' },
  sendText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  pickerRoot: { flex: 1, backgroundColor: '#f4f4f6', paddingTop: 14 },
  pickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 10 },
  pickerTitle: { fontSize: 17, fontWeight: '700', color: '#1f1f24' },
  pickerClose: { fontSize: 15, color: '#3478f6', fontWeight: '600' },
  pickerSearch: { marginHorizontal: 16, marginBottom: 8, borderRadius: 10, borderWidth: 1, borderColor: '#d9d9e0', backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 9, fontSize: 15 },
  pickerError: { marginHorizontal: 16, marginBottom: 8, color: '#b3261e', fontSize: 13 },
  pickerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e2e2e8' },
  pickerRowActive: { backgroundColor: '#e9f0fe' },
  pickerRowText: { fontSize: 14, color: '#1f1f24', flexShrink: 1 },
  pickerStar: { marginLeft: 'auto', color: '#e8a13a', fontSize: 14 },
  engineNote: { textAlign: 'center', fontSize: 11, color: '#a0a0a8', paddingVertical: 6 },
});
