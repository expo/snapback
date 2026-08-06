import { useEffect, useMemo, useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
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
import {
  skip,
  SnapbackAssetImage,
  useSnapbackAssetUpload,
  useSnapbackConnection,
  useSnapbackOutbox,
  useSurface,
} from '@expo/snapback-expo';

import { app } from '../../snapback/generated/app.mjs';
import type { GeneratedDataModel, Id } from '../../snapback/generated/api.d.ts';
import { Avatar } from '../avatar';
import { useG2Demo } from '../g2-context';
import { palette } from '../palette';
import { shortTime } from '../time';

type Message = GeneratedDataModel['messages'];
type Reaction = GeneratedDataModel['reactions'];
type User = GeneratedDataModel['users'];
type PendingImage = { caption?: string; replyToId?: Id<'messages'> };
const REACTIONS = ['❤️', '👍', '😂', '✨'] as const;
const PERSONA_NAMES: Readonly<Record<string, string>> = {
  user_ada: 'Ada', user_grace: 'Grace', user_alan: 'Alan', user_katherine: 'Katherine',
};

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}

export default function ChatScreen({ conversationId, title, onBack }: Readonly<{
  conversationId: Id<'conversations'>;
  title: string;
  onBack(): void;
}>) {
  const { activeUserId } = useG2Demo();
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<Id<'messages'> | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const attachedAsset = useRef<string | null>(null);
  const listRef = useRef<FlatList<Message>>(null);
  const conversation = useSurface(
    app.surfaces.conversation,
    { conversationId },
    { presence: { typing: draft.trim() ? { displayName: PERSONA_NAMES[activeUserId] ?? 'Someone' } : skip } },
  );
  const connection = useSnapbackConnection();
  const outbox = useSnapbackOutbox();
  const upload = useSnapbackAssetUpload({ upload: conversation.assets.image.reference });
  const { details, memberships, messages, reactions, users } = conversation.state;
  const activeUser = conversation.data.users?.find((user) => user._id === activeUserId);
  const userById = useMemo(() => new Map((conversation.data.users ?? []).map((user) => [user._id, user])), [conversation.data.users]);
  const messageById = useMemo(() => new Map((conversation.data.messages ?? []).map((message) => [message._id, message])), [conversation.data.messages]);
  const typingNames = [...new Set(conversation.presence.typing.members
    .filter((entry) => entry.key !== conversation.presence.typing.selfKey)
    .map((entry) => entry.value.displayName))];

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setComposerError(null);
    try {
      if (replyTo) await conversation.mutations.sendReply({ senderId: activeUserId, text, replyToId: replyTo._id });
      else await conversation.mutations.sendText({ senderId: activeUserId, text });
      setDraft('');
      setReplyTo(null);
    } catch (error) {
      setComposerError(errorText(error));
    }
  };

  const chooseImage = async () => {
    setComposerError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setComposerError('Photo library access is required to send an image.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.86 });
    if (result.canceled || !result.assets[0]) return;
    const picked = result.assets[0];
    const blob = await fetch(picked.uri).then((response) => response.blob());
    attachedAsset.current = null;
    setPendingImage({ ...(draft.trim() ? { caption: draft.trim() } : {}), ...(replyTo ? { replyToId: replyTo._id } : {}) });
    upload.start(blob, {
      userId: activeUserId,
      declaredFilename: picked.fileName ?? `relay-photo-${Date.now()}.jpg`,
      declaredContentType: picked.mimeType ?? blob.type ?? 'image/jpeg',
      previewUrl: picked.uri,
    });
  };

  useEffect(() => {
    const assetId = upload.state.assetId;
    if (upload.state.status !== 'ready' || !assetId || !pendingImage || attachedAsset.current === assetId) return;
    attachedAsset.current = assetId;
    void conversation.mutations.sendImage({ senderId: activeUserId, assetId, ...pendingImage }).then(() => {
      setPendingImage(null); setDraft(''); setReplyTo(null);
    }).catch((error) => {
      setComposerError(errorText(error)); setPendingImage(null);
    });
  }, [activeUserId, conversation.mutations, pendingImage, upload.state.assetId, upload.state.status]);

  useEffect(() => {
    if (upload.state.status === 'failed' || upload.state.status === 'rejected') {
      setComposerError(upload.state.diagnostic?.message ?? 'Image upload failed.');
      setPendingImage(null);
    }
  }, [upload.state.diagnostic, upload.state.status]);

  const react = async (message: Message, emoji: string) => {
    setComposerError(null);
    const existing = (conversation.data.reactions ?? []).find((row) => row.messageId === message._id && row.userId === activeUserId && row.emoji === emoji);
    try {
      if (existing) await conversation.mutations.removeReaction({ reactionId: existing._id });
      else await conversation.mutations.addReaction({ messageId: message._id, userId: activeUserId, emoji });
      setSelectedMessageId(null);
    } catch (error) {
      setComposerError(errorText(error));
    }
  };

  const retained = messages.freshness === 'retained';
  const uploadBusy = ['creating', 'uploading', 'finalizing'].includes(upload.state.status);
  const progress = upload.state.totalBytes ? Math.round((upload.state.bytesTransferred / upload.state.totalBytes) * 100) : 0;
  const readError = [details, memberships, messages, reactions, users].find((state) => state.status === 'error')?.error;
  const presenceError = ['error', 'unsupported'].includes(conversation.presence.typing.status)
    ? conversation.presence.typing.diagnostic ?? { message: `Typing ${conversation.presence.typing.status}` }
    : null;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90} style={styles.screen}>
      <View style={styles.header}><Pressable accessibilityLabel="Back to messages" onPress={onBack}><Text style={styles.back}>‹</Text></Pressable><View><Text style={styles.title}>{conversation.data.details?.[0]?.title ?? title}</Text><Text style={styles.subtitle}>{memberships.data?.length ?? 0} members</Text></View></View>
      <View style={styles.contextBar}>
        <View style={[styles.dot, { backgroundColor: connection.status === 'live' ? palette.success : palette.warning }]} />
        <Text testID="thread-retained" style={styles.contextText}>{retained ? 'Saved history' : connection.status === 'live' ? 'Live' : 'Offline'}</Text>
        {outbox.status === 'ready' && outbox.pending > 0 ? <Text testID="queued-mutations" style={styles.queued}>{outbox.pending} queued</Text> : null}
      </View>
      {readError ? <Text testID="thread-read-error" style={styles.error}>{errorText(readError)}</Text> : null}
      {presenceError ? <Text testID="typing-error" style={styles.error}>{errorText(presenceError)}</Text> : null}
      <FlatList
        ref={listRef}
        contentContainerStyle={styles.messageList}
        data={conversation.data.messages ?? []}
        keyExtractor={(item) => item._id}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        renderItem={({ item }) => (
          <MessageBubble
            currentUserId={activeUserId}
            message={item}
            reactions={(conversation.data.reactions ?? []).filter((row) => row.messageId === item._id)}
            quoted={item.replyToId ? messageById.get(item.replyToId) : undefined}
            selected={selectedMessageId === item._id}
            sender={userById.get(item.senderId)}
            onPress={() => setSelectedMessageId((value) => value === item._id ? null : item._id)}
            onReact={(emoji) => void react(item, emoji)}
            onReply={() => { setReplyTo(item); setSelectedMessageId(null); }}
          />
        )}
        ListEmptyComponent={messages.status === 'pending' ? <ActivityIndicator color={palette.accent} style={styles.loader} /> : null}
      />
      <View style={styles.composerShell}>
        {typingNames.length ? <Text style={styles.typing}>{typingNames.join(', ')} {typingNames.length === 1 ? 'is' : 'are'} typing…</Text> : null}
        {replyTo ? <View style={styles.replyComposer}><View style={{ flex: 1 }}><Text style={styles.replyLabel}>Replying to {userById.get(replyTo.senderId)?.name ?? 'message'}</Text><Text numberOfLines={1} style={styles.replyText}>{replyTo.text ?? 'Photo'}</Text></View><Pressable accessibilityLabel="Cancel reply" onPress={() => setReplyTo(null)}><Text style={styles.cancel}>×</Text></Pressable></View> : null}
        {uploadBusy ? <View style={styles.uploadRow}><ActivityIndicator color={palette.accent} size="small" /><Text style={styles.uploadText}>Preparing photo · {progress}%</Text></View> : null}
        {composerError ? <Text testID="composer-error" selectable style={styles.error}>{composerError}</Text> : null}
        <View style={styles.composer}>
          <Pressable accessibilityLabel="Choose image" disabled={uploadBusy} onPress={() => void chooseImage()} style={styles.attach}><Text style={styles.attachText}>＋</Text></Pressable>
          <TextInput accessibilityLabel="Message" multiline onChangeText={setDraft} placeholder={`Message as ${activeUser?.name ?? 'Ada'}`} placeholderTextColor={palette.muted} style={styles.input} value={draft} />
          <Pressable accessibilityLabel="Send message" disabled={!draft.trim()} onPress={() => void send()} style={[styles.send, !draft.trim() && styles.disabled]}><Text style={styles.sendText}>↑</Text></Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function MessageBubble({ currentUserId, message, reactions, quoted, selected, sender, onPress, onReact, onReply }: Readonly<{
  currentUserId: Id<'users'>; message: Message; reactions: readonly Reaction[]; quoted?: Message; selected: boolean; sender?: User;
  onPress(): void; onReact(emoji: string): void; onReply(): void;
}>) {
  const mine = message.senderId === currentUserId;
  const grouped = Object.entries(reactions.reduce<Record<string, number>>((all, row) => ({ ...all, [row.emoji]: (all[row.emoji] ?? 0) + 1 }), {}));
  return (
    <View style={[styles.messageRow, mine && styles.mineRow]}>
      {!mine ? <Avatar name={sender?.name ?? '?'} color={sender?.color ?? palette.muted} size={28} /> : null}
      <View style={[styles.bubbleColumn, mine && styles.mineColumn]}>
        {!mine ? <Text style={styles.senderName}>{sender?.name ?? 'Unknown'}</Text> : null}
        <Pressable onLongPress={onPress} onPress={onPress} style={[styles.bubble, mine ? styles.mineBubble : styles.theirBubble]}>
          {quoted ? <View style={styles.quote}><Text style={styles.replyLabel}>Reply</Text><Text numberOfLines={2} style={styles.replyText}>{quoted.text ?? 'Photo'}</Text></View> : null}
          {message.image ? <SnapbackAssetImage assetId={message.image} alt="Shared photo" maxWidth={760} style={styles.image} userId={currentUserId} /> : null}
          {message.text ? <Text selectable style={styles.messageText}>{message.text}</Text> : null}
          <Text style={styles.messageTime}>{shortTime(message.sentAt)}</Text>
        </Pressable>
        {grouped.length ? <View style={styles.reactionSummary}>{grouped.map(([emoji, count]) => <Text key={emoji} style={styles.reactionChip}>{emoji}{count > 1 ? ` ${count}` : ''}</Text>)}</View> : null}
        {selected ? <View style={styles.actions}>{REACTIONS.map((emoji) => <Pressable key={emoji} onPress={() => onReact(emoji)}><Text style={styles.actionEmoji}>{emoji}</Text></Pressable>)}<Pressable onPress={onReply}><Text style={styles.replyButton}>Reply</Text></Pressable></View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: palette.canvas, flex: 1 }, header: { alignItems: 'center', backgroundColor: palette.surface, flexDirection: 'row', gap: 12, padding: 12 },
  back: { color: palette.accent, fontSize: 38, lineHeight: 38 }, title: { color: palette.ink, fontSize: 17, fontWeight: '800' }, subtitle: { color: palette.muted, fontSize: 11 },
  contextBar: { alignItems: 'center', backgroundColor: palette.surface, borderTopColor: palette.line, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 7, padding: 8 },
  dot: { borderRadius: 4, height: 8, width: 8 }, contextText: { color: palette.ink, fontSize: 11, fontWeight: '800' }, queued: { color: palette.warning, fontSize: 11, fontWeight: '800', marginLeft: 'auto' },
  messageList: { flexGrow: 1, gap: 12, padding: 14 }, loader: { marginTop: 40 }, messageRow: { alignItems: 'flex-end', flexDirection: 'row', gap: 7, maxWidth: '88%' }, mineRow: { alignSelf: 'flex-end' },
  bubbleColumn: { alignItems: 'flex-start', maxWidth: '90%' }, mineColumn: { alignItems: 'flex-end' }, senderName: { color: palette.muted, fontSize: 10, fontWeight: '700', marginLeft: 5 },
  bubble: { borderColor: palette.line, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, gap: 7, maxWidth: '100%', minWidth: 92, overflow: 'hidden', padding: 10 },
  mineBubble: { backgroundColor: palette.outgoing, borderBottomRightRadius: 5 }, theirBubble: { backgroundColor: palette.incoming, borderBottomLeftRadius: 5 }, quote: { borderLeftColor: palette.accent, borderLeftWidth: 3, paddingLeft: 8 },
  image: { aspectRatio: 1.3, borderRadius: 12, minHeight: 170, width: 240 }, messageText: { color: palette.ink, fontSize: 15, lineHeight: 21 }, messageTime: { alignSelf: 'flex-end', color: palette.muted, fontSize: 9 },
  reactionSummary: { backgroundColor: palette.surface, borderColor: palette.line, borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: 4, marginTop: -5, padding: 5 }, reactionChip: { fontSize: 12 },
  actions: { alignItems: 'center', backgroundColor: palette.ink, borderRadius: 20, flexDirection: 'row', gap: 10, marginTop: 5, padding: 7 }, actionEmoji: { fontSize: 17 }, replyButton: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  composerShell: { backgroundColor: palette.surface, borderTopColor: palette.line, borderTopWidth: 1, gap: 6, padding: 9 }, typing: { color: palette.accent, fontSize: 11, fontStyle: 'italic' },
  replyComposer: { alignItems: 'center', backgroundColor: palette.accentSoft, borderLeftColor: palette.accent, borderLeftWidth: 3, borderRadius: 10, flexDirection: 'row', padding: 8 }, replyLabel: { color: palette.accent, fontSize: 10, fontWeight: '900' }, replyText: { color: palette.muted, fontSize: 12 }, cancel: { color: palette.muted, fontSize: 24, padding: 8 },
  uploadRow: { alignItems: 'center', flexDirection: 'row', gap: 8 }, uploadText: { color: palette.muted, fontSize: 11 }, error: { color: palette.danger, fontSize: 11, marginHorizontal: 8 },
  composer: { alignItems: 'flex-end', flexDirection: 'row', gap: 8 }, attach: { alignItems: 'center', backgroundColor: palette.accentSoft, borderRadius: 20, height: 40, justifyContent: 'center', width: 40 }, attachText: { color: palette.accent, fontSize: 25 },
  input: { backgroundColor: palette.canvas, borderColor: palette.line, borderRadius: 20, borderWidth: 1, color: palette.ink, flex: 1, fontSize: 15, maxHeight: 110, minHeight: 40, paddingHorizontal: 14, paddingVertical: 9 },
  send: { alignItems: 'center', backgroundColor: palette.accent, borderRadius: 20, height: 40, justifyContent: 'center', width: 40 }, disabled: { opacity: 0.35 }, sendText: { color: '#FFF', fontSize: 24, fontWeight: '800' },
});
