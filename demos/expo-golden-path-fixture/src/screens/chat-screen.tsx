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
  useSnapbackExpoBootState,
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
const G2_CONVERSATION_ID = 'conversation_engine_room';
const G2_PLATFORM = Platform.OS === 'ios' ? 'IOS' : Platform.OS === 'android' ? 'ANDROID' : 'UNKNOWN';
const G2_MARKER = `G2_${G2_PLATFORM}_PASS`;
const G2_PENDING_MARKER = `G2_${G2_PLATFORM}_PENDING`;
const G2_REACTION = '✅';
const G2_SEND_TEXT = `G2 ${G2_PLATFORM.toLowerCase()} surface sendText echo`;
const PERSONA_NAMES: Readonly<Record<string, string>> = {
  user_ada: 'Ada', user_grace: 'Grace', user_alan: 'Alan', user_katherine: 'Katherine',
};

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}

function emitG2(event: string, details: Readonly<Record<string, unknown>> = {}) {
  console.log(`SNAPBACK_G2_EVENT ${JSON.stringify({ event, platform: G2_PLATFORM.toLowerCase(), ...details })}`);
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
  const proofSendStarted = useRef(false);
  const proofReactionStarted = useRef(false);
  const proofProviderLogged = useRef(false);
  const proofSurfaceLogged = useRef(false);
  const proofPresenceLogged = useRef(false);
  const proofSendLogged = useRef(false);
  const proofReactionLogged = useRef(false);
  const proofPassLogged = useRef(false);
  const boot = useSnapbackExpoBootState();
  const proofEnabled = conversationId === G2_CONVERSATION_ID;
  const conversation = useSurface(
    app.surfaces.conversation,
    { conversationId },
    { presence: { typing: draft.trim() || proofEnabled ? { displayName: PERSONA_NAMES[activeUserId] ?? 'Someone' } : skip } },
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
  const proofMessage = conversation.data.messages?.find((message) => message.text === G2_SEND_TEXT);
  const proofReaction = proofMessage
    ? conversation.data.reactions?.find((row) => row.messageId === proofMessage._id && row.userId === activeUserId && row.emoji === G2_REACTION)
    : undefined;
  const proofProviderReady = boot.status === 'ready';
  const proofSurfaceReady = conversation.state.messages.status === 'ready'
    && conversation.state.messages.freshness === 'current'
    && (conversation.data.messages?.length ?? 0) >= 3;
  const proofPresenceReady = conversation.presence.typing.status === 'ready'
    && conversation.presence.typing.members.some((entry) => (
      entry.key === conversation.presence.typing.selfKey
      && entry.value.displayName === (PERSONA_NAMES[activeUserId] ?? 'Someone')
    ));
  const proofPassed = proofEnabled && proofProviderReady && proofSurfaceReady
    && Boolean(proofMessage) && Boolean(proofReaction) && proofPresenceReady;

  useEffect(() => {
    if (!proofEnabled || !proofProviderReady || proofProviderLogged.current) return;
    proofProviderLogged.current = true;
    emitG2('provider-ready', {
      routing: boot.status === 'ready' ? boot.binding.target.routing : null,
      authorityKind: boot.status === 'ready' ? boot.authority.kind : null,
      authMode: boot.status === 'ready' ? boot.authority.authMode : null,
    });
  }, [boot, proofEnabled, proofProviderReady]);

  useEffect(() => {
    if (!proofEnabled || !proofSurfaceReady || proofSurfaceLogged.current) return;
    proofSurfaceLogged.current = true;
    emitG2('surface-data-observed', {
      conversationId,
      messageCount: conversation.data.messages?.length ?? 0,
      freshness: conversation.state.messages.freshness,
    });
  }, [conversation.data.messages?.length, conversation.state.messages.freshness, conversationId, proofEnabled, proofSurfaceReady]);

  useEffect(() => {
    if (!proofEnabled || !proofPresenceReady || proofPresenceLogged.current) return;
    proofPresenceLogged.current = true;
    emitG2('presence-self-observed', {
      memberCount: conversation.presence.typing.members.length,
      status: conversation.presence.typing.status,
    });
  }, [conversation.presence.typing.members.length, conversation.presence.typing.status, proofEnabled, proofPresenceReady]);

  useEffect(() => {
    if (!proofEnabled || !proofProviderReady || !proofSurfaceReady || proofMessage || proofSendStarted.current) return;
    proofSendStarted.current = true;
    emitG2('sendText-dispatched');
    void conversation.mutations.sendText({ senderId: activeUserId, text: G2_SEND_TEXT })
      .then(() => emitG2('sendText-settled'))
      .catch((error) => {
        const message = errorText(error);
        setComposerError(message);
        emitG2('sendText-failed', { message });
      });
  }, [activeUserId, conversation.mutations, proofEnabled, proofMessage, proofProviderReady, proofSurfaceReady]);

  useEffect(() => {
    if (!proofEnabled || !proofMessage || proofSendLogged.current) return;
    proofSendLogged.current = true;
    emitG2('sendText-live-echo-observed', { messageId: proofMessage._id });
  }, [proofEnabled, proofMessage]);

  useEffect(() => {
    if (!proofEnabled || !proofMessage || proofReaction || proofReactionStarted.current) return;
    proofReactionStarted.current = true;
    emitG2('reaction-dispatched', { messageId: proofMessage._id, emoji: G2_REACTION });
    void conversation.mutations.react({
      messageId: proofMessage._id,
      userId: activeUserId,
      emoji: G2_REACTION,
    }).then(() => emitG2('reaction-settled')).catch((error) => {
      const message = errorText(error);
      setComposerError(message);
      emitG2('reaction-failed', { message });
    });
  }, [activeUserId, conversation.mutations, proofEnabled, proofMessage, proofReaction]);

  useEffect(() => {
    if (!proofEnabled || !proofReaction || proofReactionLogged.current) return;
    proofReactionLogged.current = true;
    emitG2('reaction-live-echo-observed', { reactionId: proofReaction._id });
  }, [proofEnabled, proofReaction]);

  useEffect(() => {
    if (!proofPassed || proofPassLogged.current) return;
    proofPassLogged.current = true;
    emitG2('pass', {
      marker: G2_MARKER,
      messageCount: conversation.data.messages?.length ?? 0,
      presenceMembers: conversation.presence.typing.members.length,
    });
  }, [conversation.data.messages?.length, conversation.presence.typing.members.length, proofPassed]);

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
      else await conversation.mutations.react({ messageId: message._id, userId: activeUserId, emoji });
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
      {proofEnabled ? (
        <View style={[styles.proof, proofPassed ? styles.proofPass : styles.proofPending]}>
          <Text style={styles.proofLabel}>LLP 0176 · G2 native surface</Text>
          <Text testID="g2-verdict" style={styles.proofVerdict}>{proofPassed ? G2_MARKER : G2_PENDING_MARKER}</Text>
          <Text style={styles.proofFacts}>
            provider {proofProviderReady ? 'ready' : '…'} · messages {conversation.data.messages?.length ?? 0} · send {proofMessage ? 'echoed' : '…'} · react {proofReaction ? 'echoed' : '…'} · typing {proofPresenceReady ? 'present' : '…'}
          </Text>
        </View>
      ) : null}
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
  proof: { borderRadius: 12, gap: 3, marginHorizontal: 10, marginTop: 8, padding: 10 }, proofPending: { backgroundColor: '#FFF0D9', borderColor: palette.warning, borderWidth: 1 }, proofPass: { backgroundColor: '#DDF5E9', borderColor: palette.success, borderWidth: 2 },
  proofLabel: { color: palette.muted, fontSize: 9, fontWeight: '900', letterSpacing: 0.8 }, proofVerdict: { color: palette.ink, fontSize: 20, fontWeight: '900' }, proofFacts: { color: palette.ink, fontSize: 10, fontWeight: '700' },
});
