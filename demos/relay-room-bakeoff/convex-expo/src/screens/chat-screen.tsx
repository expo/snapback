import { useNetInfo } from '@react-native-community/netinfo';
import { useMutation, useQuery } from 'convex/react';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { api } from '../../convex/_generated/api';
import type { Doc, Id } from '../../convex/_generated/dataModel';
import { Avatar } from '@/components/avatar';
import { useCachedQuery } from '@/lib/cache';
import { usePersona } from '@/providers/convex-provider';
import { colors } from '@/theme/colors';

type Message = Doc<'messages'> & { imageUrl: string | null };
const EMOJIS = ['❤️', '👍', '😂', '✨'] as const;

export default function ChatScreen() {
  const params = useLocalSearchParams<{ id: string; title?: string }>();
  const navigation = useNavigation();
  const conversationId = params.id as Id<'conversations'>;
  const network = useNetInfo();
  const online = network.isConnected !== false;
  const { activeHandle } = usePersona();
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [selected, setSelected] = useState<Id<'messages'> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const listRef = useRef<FlatList<Message>>(null);

  useEffect(() => navigation.setOptions({ title: params.title ?? 'Conversation' }), [navigation, params.title]);

  const users = useCachedQuery(api.relay.users, {}, 'relay.convex.users');
  const activeUser = users.data?.find((user) => user.handle === activeHandle) ?? users.data?.[0];
  const messages = useCachedQuery(api.relay.messages, { conversationId }, `relay.convex.messages.${conversationId}`);
  const reactions = useCachedQuery(api.relay.reactions, { conversationId }, `relay.convex.reactions.${conversationId}`);
  const members = useCachedQuery(api.relay.members, { conversationId }, `relay.convex.members.${conversationId}`);
  const typingRows = useQuery(api.relay.typing, { conversationId });
  const sendText = useMutation(api.relay.sendText);
  const toggleReaction = useMutation(api.relay.toggleReaction);
  const generateUploadUrl = useMutation(api.relay.generateUploadUrl);
  const sendImage = useMutation(api.relay.sendImage);
  const setTyping = useMutation(api.relay.setTyping);

  const userById = useMemo(() => new Map((users.data ?? []).map((user) => [user._id, user])), [users.data]);
  const messageById = useMemo(() => new Map((messages.data ?? []).map((message) => [message._id, message as Message])), [messages.data]);
  const typingNames = [...new Set((typingRows ?? []).filter((row) => row.userId !== activeUser?._id).map((row) => row.name.split(' ')[0]))];

  useEffect(() => {
    if (!activeUser || !online) return;
    const publish = (active: boolean) => void setTyping({
      conversationId,
      userId: activeUser._id,
      name: activeUser.name,
      active,
    }).catch(() => undefined);
    if (!draft.trim()) {
      publish(false);
      return;
    }
    publish(true);
    const heartbeat = setInterval(() => publish(true), 2_000);
    return () => { clearInterval(heartbeat); publish(false); };
  }, [activeUser, conversationId, draft.length > 0, online, setTyping]);

  const submit = async () => {
    const text = draft.trim();
    if (!text || !activeUser || !online) return;
    setError(null);
    try {
      await sendText({
        conversationId,
        senderId: activeUser._id,
        text,
        ...(replyTo ? { replyToId: replyTo._id } : {}),
      });
      setDraft('');
      setReplyTo(null);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (cause) { setError(message(cause)); }
  };

  const chooseImage = async () => {
    if (!activeUser || !online) return;
    setError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError('Photo library access is required to send an image.'); return; }
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.86 });
    if (picked.canceled || !picked.assets[0]) return;
    setUploading(true);
    try {
      const asset = picked.assets[0];
      const blob = await fetch(asset.uri).then((response) => response.blob());
      const uploadUrl = await generateUploadUrl({ conversationId, userId: activeUser._id });
      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': asset.mimeType ?? blob.type ?? 'image/jpeg' },
        body: blob,
      });
      if (!uploadResponse.ok) throw new Error(`Upload failed (${uploadResponse.status})`);
      const { storageId } = await uploadResponse.json() as { storageId: Id<'_storage'> };
      await sendImage({
        conversationId,
        senderId: activeUser._id,
        storageId,
        ...(draft.trim() ? { caption: draft.trim() } : {}),
        ...(replyTo ? { replyToId: replyTo._id } : {}),
      });
      setDraft('');
      setReplyTo(null);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (cause) { setError(message(cause)); }
    finally { setUploading(false); }
  };

  const react = async (messageId: Id<'messages'>, emoji: string) => {
    if (!activeUser || !online) return;
    try {
      await toggleReaction({ conversationId, messageId, userId: activeUser._id, emoji });
      setSelected(null);
      void Haptics.selectionAsync();
    } catch (cause) { setError(message(cause)); }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90} style={styles.screen}>
      <View style={styles.contextBar}>
        <View style={[styles.dot, { backgroundColor: online ? colors.success : colors.warning }]} />
        <Text style={styles.contextText}>{online ? 'Convex live query' : 'Offline · cached snapshot'}</Text>
        <Text style={styles.members}>{members.data?.length ?? 0} members</Text>
      </View>

      <FlatList
        ref={listRef}
        contentContainerStyle={styles.list}
        data={(messages.data ?? []) as Message[]}
        keyboardDismissMode="interactive"
        keyExtractor={(item) => item._id}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        renderItem={({ item }) => {
          const mine = item.senderId === activeUser?._id;
          const sender = userById.get(item.senderId);
          const quoted = item.replyToId ? messageById.get(item.replyToId) : undefined;
          const grouped = Object.entries((reactions.data ?? []).filter((reaction) => reaction.messageId === item._id).reduce<Record<string, number>>((result, reaction) => {
            result[reaction.emoji] = (result[reaction.emoji] ?? 0) + 1; return result;
          }, {}));
          return (
            <View style={[styles.messageRow, mine && styles.messageRowMine]}>
              {!mine ? <Avatar name={sender?.name ?? '?'} color={sender?.color ?? colors.muted} size={28} /> : null}
              <View style={[styles.bubbleColumn, mine && styles.bubbleColumnMine]}>
                {!mine ? <Text style={styles.sender}>{sender?.name ?? 'Unknown'}</Text> : null}
                <Pressable onPress={() => setSelected((value) => value === item._id ? null : item._id)} onLongPress={() => setSelected(item._id)} style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
                  {quoted ? <View style={styles.quote}><Text style={styles.quoteLabel}>Reply</Text><Text numberOfLines={2} style={styles.quoteText}>{quoted.text ?? 'Photo'}</Text></View> : null}
                  {item.imageUrl ? <Image cachePolicy="memory-disk" contentFit="cover" source={item.imageUrl} style={styles.image} transition={150} /> : null}
                  {item.text ? <Text selectable style={styles.body}>{item.text}</Text> : null}
                  <Text style={styles.time}>{shortTime(item.sentAt)}</Text>
                </Pressable>
                {grouped.length ? <View style={[styles.reactions, mine && styles.reactionsMine]}>{grouped.map(([emoji, count]) => <Text key={emoji} style={styles.reaction}>{emoji}{count > 1 ? ` ${count}` : ''}</Text>)}</View> : null}
                {selected === item._id ? (
                  <View style={[styles.actions, mine && styles.actionsMine]}>
                    {EMOJIS.map((emoji) => <Pressable key={emoji} onPress={() => void react(item._id, emoji)}><Text style={styles.actionEmoji}>{emoji}</Text></Pressable>)}
                    <Pressable onPress={() => { setReplyTo(item); setSelected(null); }} style={styles.replyAction}><Text style={styles.replyActionText}>Reply</Text></Pressable>
                  </View>
                ) : null}
              </View>
            </View>
          );
        }}
        ListEmptyComponent={<ActivityIndicator color={colors.accent} style={styles.loader} />}
      />

      <View style={styles.composerShell}>
        {typingNames.length ? <Text style={styles.typing}>{typingNames.join(', ')} {typingNames.length === 1 ? 'is' : 'are'} typing…</Text> : null}
        {replyTo ? <View style={styles.replyComposer}><View style={styles.replyCopy}><Text style={styles.replyLabel}>Replying to {userById.get(replyTo.senderId)?.name}</Text><Text numberOfLines={1} style={styles.replyText}>{replyTo.text ?? 'Photo'}</Text></View><Pressable onPress={() => setReplyTo(null)}><Text style={styles.close}>×</Text></Pressable></View> : null}
        {!online ? <Text style={styles.offlineNotice}>Sending and reactions require a connection. Saved messages remain visible.</Text> : null}
        {uploading ? <View style={styles.upload}><ActivityIndicator color={colors.accent} size="small" /><Text style={styles.uploadText}>Uploading photo…</Text></View> : null}
        {error ? <Text selectable style={styles.error}>{error}</Text> : null}
        <View style={styles.composer}>
          <Pressable disabled={!online || uploading} onPress={() => void chooseImage()} style={styles.attach}><Text style={styles.attachText}>＋</Text></Pressable>
          <TextInput editable={online} multiline onChangeText={setDraft} placeholder={online ? 'Message' : 'Offline'} placeholderTextColor={colors.muted} style={styles.input} value={draft} />
          <Pressable disabled={!online || !draft.trim()} onPress={() => void submit()} style={[styles.send, (!online || !draft.trim()) && styles.disabled]}><Text style={styles.sendText}>↑</Text></Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }
function shortTime(value: number) { return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value)); }

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.canvas, flex: 1 },
  contextBar: { alignItems: 'center', backgroundColor: colors.surface, borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 7, paddingHorizontal: 14, paddingVertical: 8 },
  dot: { borderRadius: 4, height: 8, width: 8 },
  contextText: { color: colors.ink, fontSize: 11, fontWeight: '800' },
  members: { color: colors.muted, fontSize: 11, marginLeft: 'auto' },
  list: { flexGrow: 1, gap: 12, paddingHorizontal: 12, paddingVertical: 18 },
  loader: { marginTop: 40 },
  messageRow: { alignItems: 'flex-end', flexDirection: 'row', gap: 7, maxWidth: '88%' },
  messageRowMine: { alignSelf: 'flex-end', justifyContent: 'flex-end' },
  bubbleColumn: { alignItems: 'flex-start', maxWidth: '90%' },
  bubbleColumnMine: { alignItems: 'flex-end' },
  sender: { color: colors.muted, fontSize: 10, fontWeight: '700', marginBottom: 3, marginLeft: 5 },
  bubble: { borderColor: colors.line, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, gap: 7, maxWidth: '100%', minWidth: 92, overflow: 'hidden', paddingHorizontal: 12, paddingVertical: 9 },
  mine: { backgroundColor: colors.outgoing, borderBottomRightRadius: 5 },
  theirs: { backgroundColor: colors.incoming, borderBottomLeftRadius: 5 },
  quote: { borderLeftColor: colors.accent, borderLeftWidth: 3, gap: 2, paddingHorizontal: 8, paddingVertical: 5 },
  quoteLabel: { color: colors.accent, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  quoteText: { color: colors.muted, fontSize: 12 },
  image: { aspectRatio: 1.3, borderRadius: 12, height: 180, width: 240 },
  body: { color: colors.ink, fontSize: 15, lineHeight: 21 },
  time: { alignSelf: 'flex-end', color: colors.muted, fontSize: 9 },
  reactions: { backgroundColor: colors.surface, borderColor: colors.line, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 4, marginLeft: 8, marginTop: -5, paddingHorizontal: 7, paddingVertical: 3 },
  reactionsMine: { marginLeft: 0, marginRight: 8 },
  reaction: { fontSize: 12 },
  actions: { alignItems: 'center', backgroundColor: colors.ink, borderRadius: 20, flexDirection: 'row', gap: 10, marginTop: 5, paddingHorizontal: 10, paddingVertical: 7 },
  actionsMine: { alignSelf: 'flex-end' },
  actionEmoji: { fontSize: 17 },
  replyAction: { borderLeftColor: '#66717D', borderLeftWidth: 1, paddingLeft: 9 },
  replyActionText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  composerShell: { backgroundColor: colors.surface, borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth, gap: 6, paddingBottom: Platform.OS === 'ios' ? 8 : 12, paddingHorizontal: 10, paddingTop: 8 },
  typing: { color: colors.accent, fontSize: 11, fontStyle: 'italic', marginLeft: 45 },
  replyComposer: { alignItems: 'center', backgroundColor: colors.accentSoft, borderLeftColor: colors.accent, borderLeftWidth: 3, borderRadius: 10, flexDirection: 'row', marginHorizontal: 4, padding: 8 },
  replyCopy: { flex: 1, gap: 2 },
  replyLabel: { color: colors.accent, fontSize: 10, fontWeight: '900' },
  replyText: { color: colors.muted, fontSize: 12 },
  close: { color: colors.muted, fontSize: 24, paddingHorizontal: 8 },
  offlineNotice: { color: colors.warning, fontSize: 11, marginHorizontal: 6 },
  upload: { alignItems: 'center', flexDirection: 'row', gap: 8, marginHorizontal: 6 },
  uploadText: { color: colors.muted, fontSize: 11 },
  error: { color: colors.danger, fontSize: 11, marginHorizontal: 6 },
  composer: { alignItems: 'flex-end', flexDirection: 'row', gap: 8 },
  attach: { alignItems: 'center', backgroundColor: colors.accentSoft, borderRadius: 20, height: 40, justifyContent: 'center', width: 40 },
  attachText: { color: colors.accent, fontSize: 25, marginTop: -2 },
  input: { backgroundColor: colors.canvas, borderColor: colors.line, borderRadius: 20, borderWidth: 1, color: colors.ink, flex: 1, fontSize: 15, maxHeight: 110, minHeight: 40, paddingHorizontal: 14, paddingVertical: 9 },
  send: { alignItems: 'center', backgroundColor: colors.accent, borderRadius: 20, height: 40, justifyContent: 'center', width: 40 },
  disabled: { opacity: 0.35 },
  sendText: { color: '#FFFFFF', fontSize: 24, fontWeight: '800', marginTop: -2 },
});
