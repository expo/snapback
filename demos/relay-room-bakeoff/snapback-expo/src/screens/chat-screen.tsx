import {
  skip,
  SnapbackAssetImage,
  useSnapbackAssetUpload,
  useSnapbackConnection,
  useSnapbackMutation,
  useSnapbackOutbox,
  useSnapbackPresence,
  useSnapbackQuery,
} from '@expo/snapback-react';
import * as Haptics from 'expo-haptics';
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

import { Avatar } from '@/components/avatar';
import { shortTime } from '@/lib/time';
import { snapbackApi, useRelay } from '@/providers/relay-provider';
import { palette } from '@/theme/colors';
import type { GeneratedDataModel, Id } from '@relay/generated-api';

type Message = GeneratedDataModel['messages'];
type Reaction = GeneratedDataModel['reactions'];
type User = GeneratedDataModel['users'];
type PendingImage = { caption?: string; replyToId?: Id<'messages'> };

const REACTION_CHOICES = ['❤️', '👍', '😂', '✨'] as const;

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export default function ChatScreen() {
  const params = useLocalSearchParams<{ id: string; title?: string }>();
  const navigation = useNavigation();
  const conversationId = params.id as Id<'conversations'>;
  const { activeUserId, client } = useRelay();
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<Id<'messages'> | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const attachedAsset = useRef<string | null>(null);
  const listRef = useRef<FlatList<Message>>(null);

  useEffect(() => {
    navigation.setOptions({ title: params.title ?? 'Conversation' });
  }, [navigation, params.title]);

  const users = useSnapbackQuery(snapbackApi.users, {});
  const memberships = useSnapbackQuery(snapbackApi.membershipsForConversation, { conversationId });
  const messages = useSnapbackQuery(snapbackApi.messagesForConversation, { conversationId });
  const reactions = useSnapbackQuery(snapbackApi.reactionsForConversation, { conversationId });
  const sendText = useSnapbackMutation(snapbackApi.sendText);
  const sendReply = useSnapbackMutation(snapbackApi.sendReply);
  const addReaction = useSnapbackMutation(snapbackApi.addReaction);
  const removeReaction = useSnapbackMutation(snapbackApi.removeReaction);
  const connection = useSnapbackConnection();
  const outbox = useSnapbackOutbox();
  const upload = useSnapbackAssetUpload({ upload: snapbackApi.messageImageUpload });
  const activeUser = users.data?.find((user) => user._id === activeUserId);
  const userById = useMemo(() => new Map((users.data ?? []).map((user) => [user._id, user])), [users.data]);
  const messageById = useMemo(() => new Map((messages.data ?? []).map((message) => [message._id, message])), [messages.data]);

  const typing = useSnapbackPresence(snapbackApi.ephemeral.typing, {
    scope: { conversationId },
    value: draft.trim() && activeUser
      ? { userId: activeUser._id, name: activeUser.name }
      : skip,
    ttlMs: 4_000,
  });
  const typingNames = [...new Set(typing.entries
    .map((entry) => entry.value)
    .filter((entry) => entry.userId !== activeUserId)
    .map((entry) => entry.name.split(' ')[0]))];

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setComposerError(null);
    try {
      if (replyTo) {
        await sendReply({ conversationId, senderId: activeUserId, text, replyToId: replyTo._id });
      } else {
        await sendText({ conversationId, senderId: activeUserId, text });
      }
      setDraft('');
      setReplyTo(null);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.86,
    });
    if (result.canceled || !result.assets[0]) return;
    const picked = result.assets[0];
    const blob = await fetch(picked.uri).then((response) => response.blob());
    attachedAsset.current = null;
    setPendingImage({
      ...(draft.trim() ? { caption: draft.trim() } : {}),
      ...(replyTo ? { replyToId: replyTo._id } : {}),
    });
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
    void client.mutate(snapbackApi.sendImage, {
      userId: activeUserId,
      queue: false,
      args: { conversationId, senderId: activeUserId, assetId, ...pendingImage },
    }).then(() => {
      setPendingImage(null);
      setDraft('');
      setReplyTo(null);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }).catch((error) => {
      setComposerError(errorText(error));
      setPendingImage(null);
    });
  }, [activeUserId, client, conversationId, pendingImage, upload.state.assetId, upload.state.status]);

  useEffect(() => {
    if (upload.state.status === 'failed' || upload.state.status === 'rejected') {
      setComposerError(upload.state.diagnostic?.message ?? 'Image upload failed.');
      setPendingImage(null);
    }
  }, [upload.state.diagnostic, upload.state.status]);

  const react = async (message: Message, emoji: string) => {
    setComposerError(null);
    const existing = (reactions.data ?? []).find((reaction) =>
      reaction.messageId === message._id && reaction.userId === activeUserId && reaction.emoji === emoji);
    try {
      if (existing) await removeReaction({ reactionId: existing._id });
      else await addReaction({ conversationId, messageId: message._id, userId: activeUserId, emoji });
      setSelectedMessageId(null);
      void Haptics.selectionAsync();
    } catch (error) {
      setComposerError(errorText(error));
    }
  };

  const retained = messages.freshness === 'retained';
  const uploadBusy = ['creating', 'uploading', 'finalizing'].includes(upload.state.status);
  const progress = upload.state.totalBytes
    ? Math.round((upload.state.bytesTransferred / upload.state.totalBytes) * 100)
    : 0;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90} style={styles.screen}>
      <View style={styles.contextBar}>
        <View style={[styles.connectionDot, { backgroundColor: connection.status === 'live' ? palette.success : palette.warning }]} />
        <Text style={styles.contextText}>{retained ? 'Saved history' : connection.status === 'live' ? 'Live' : 'Offline'}</Text>
        <Text style={styles.membersText}>{memberships.data?.length ?? 0} members</Text>
        {outbox.status === 'ready' && outbox.pending > 0 ? <Text style={styles.queued}>{outbox.pending} queued</Text> : null}
      </View>

      <FlatList
        ref={listRef}
        contentContainerStyle={styles.messageList}
        data={messages.data ?? []}
        keyboardDismissMode="interactive"
        keyExtractor={(item) => item._id}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        renderItem={({ item }) => {
          const sender = userById.get(item.senderId);
          const quoted = item.replyToId ? messageById.get(item.replyToId) : undefined;
          const messageReactions = (reactions.data ?? []).filter((reaction) => reaction.messageId === item._id);
          return (
            <MessageBubble
              currentUserId={activeUserId}
              message={item}
              reactions={messageReactions}
              quoted={quoted}
              selected={selectedMessageId === item._id}
              sender={sender}
              onPress={() => setSelectedMessageId((value) => value === item._id ? null : item._id)}
              onReact={(emoji) => void react(item, emoji)}
              onReply={() => { setReplyTo(item); setSelectedMessageId(null); }}
            />
          );
        }}
        ListEmptyComponent={messages.status === 'pending' ? <ActivityIndicator color={palette.accent} style={styles.loader} /> : null}
      />

      <View style={styles.composerShell}>
        {typingNames.length ? <Text style={styles.typing}>{typingNames.join(', ')} {typingNames.length === 1 ? 'is' : 'are'} typing…</Text> : null}
        {replyTo ? (
          <View style={styles.replyComposer}>
            <View style={styles.replyCopy}>
              <Text style={styles.replyLabel}>Replying to {userById.get(replyTo.senderId)?.name ?? 'message'}</Text>
              <Text numberOfLines={1} style={styles.replyText}>{replyTo.text ?? 'Photo'}</Text>
            </View>
            <Pressable accessibilityLabel="Cancel reply" onPress={() => setReplyTo(null)}><Text style={styles.cancelReply}>×</Text></Pressable>
          </View>
        ) : null}
        {uploadBusy ? (
          <View style={styles.uploadRow}><ActivityIndicator color={palette.accent} size="small" /><Text style={styles.uploadText}>Preparing photo · {progress}%</Text></View>
        ) : null}
        {composerError ? <Text selectable style={styles.error}>{composerError}</Text> : null}
        <View style={styles.composer}>
          <Pressable accessibilityLabel="Choose image" disabled={uploadBusy} onPress={() => void chooseImage()} style={styles.attachButton}>
            <Text style={styles.attachText}>＋</Text>
          </Pressable>
          <TextInput
            accessibilityLabel="Message"
            multiline
            onChangeText={setDraft}
            placeholder="Message"
            placeholderTextColor={palette.muted}
            style={styles.input}
            value={draft}
          />
          <Pressable accessibilityLabel="Send message" disabled={!draft.trim()} onPress={() => void send()} style={[styles.sendButton, !draft.trim() && styles.sendDisabled]}>
            <Text style={styles.sendText}>↑</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function MessageBubble({
  currentUserId,
  message,
  reactions,
  quoted,
  selected,
  sender,
  onPress,
  onReact,
  onReply,
}: Readonly<{
  currentUserId: Id<'users'>;
  message: Message;
  reactions: readonly Reaction[];
  quoted?: Message;
  selected: boolean;
  sender?: User;
  onPress: () => void;
  onReact: (emoji: string) => void;
  onReply: () => void;
}>) {
  const mine = message.senderId === currentUserId;
  const grouped = Object.entries(reactions.reduce<Record<string, number>>((result, reaction) => {
    result[reaction.emoji] = (result[reaction.emoji] ?? 0) + 1;
    return result;
  }, {}));

  return (
    <View style={[styles.messageRow, mine && styles.messageRowMine]}>
      {!mine ? <Avatar name={sender?.name ?? '?'} color={sender?.color ?? palette.muted} size={28} /> : null}
      <View style={[styles.bubbleColumn, mine && styles.bubbleColumnMine]}>
        {!mine ? <Text style={styles.senderName}>{sender?.name ?? 'Unknown'}</Text> : null}
        <Pressable onLongPress={onPress} onPress={onPress} style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
          {quoted ? (
            <View style={styles.quote}>
              <Text style={styles.quoteLabel}>Reply</Text>
              <Text numberOfLines={2} style={styles.quoteText}>{quoted.text ?? 'Photo'}</Text>
            </View>
          ) : null}
          {message.image ? (
            <SnapbackAssetImage
              assetId={message.image}
              alt="Shared photo"
              maxWidth={760}
              style={styles.image}
              userId={currentUserId}
            />
          ) : null}
          {message.text ? <Text selectable style={styles.messageText}>{message.text}</Text> : null}
          <Text style={styles.messageTime}>{shortTime(message.sentAt)}</Text>
        </Pressable>
        {grouped.length ? (
          <View style={[styles.reactionSummary, mine && styles.reactionSummaryMine]}>
            {grouped.map(([emoji, count]) => <Text key={emoji} style={styles.reactionChip}>{emoji}{count > 1 ? ` ${count}` : ''}</Text>)}
          </View>
        ) : null}
        {selected ? (
          <View style={[styles.actions, mine && styles.actionsMine]}>
            {REACTION_CHOICES.map((emoji) => <Pressable key={emoji} onPress={() => onReact(emoji)}><Text style={styles.actionEmoji}>{emoji}</Text></Pressable>)}
            <Pressable onPress={onReply} style={styles.replyButton}><Text style={styles.replyButtonText}>Reply</Text></Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: palette.canvas, flex: 1 },
  contextBar: { alignItems: 'center', backgroundColor: palette.surface, borderBottomColor: palette.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 7, paddingHorizontal: 14, paddingVertical: 8 },
  connectionDot: { borderRadius: 4, height: 8, width: 8 },
  contextText: { color: palette.ink, fontSize: 11, fontWeight: '800' },
  membersText: { color: palette.muted, fontSize: 11 },
  queued: { color: palette.warning, fontSize: 11, fontWeight: '800', marginLeft: 'auto' },
  messageList: { flexGrow: 1, gap: 12, paddingHorizontal: 12, paddingVertical: 18 },
  loader: { marginTop: 40 },
  messageRow: { alignItems: 'flex-end', flexDirection: 'row', gap: 7, maxWidth: '88%' },
  messageRowMine: { alignSelf: 'flex-end', justifyContent: 'flex-end' },
  bubbleColumn: { alignItems: 'flex-start', maxWidth: '90%' },
  bubbleColumnMine: { alignItems: 'flex-end' },
  senderName: { color: palette.muted, fontSize: 10, fontWeight: '700', marginBottom: 3, marginLeft: 5 },
  bubble: { borderColor: palette.line, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, gap: 7, maxWidth: '100%', minWidth: 92, overflow: 'hidden', paddingHorizontal: 12, paddingVertical: 9 },
  bubbleMine: { backgroundColor: palette.outgoing, borderBottomRightRadius: 5 },
  bubbleTheirs: { backgroundColor: palette.incoming, borderBottomLeftRadius: 5 },
  quote: { borderLeftColor: palette.accent, borderLeftWidth: 3, gap: 2, paddingHorizontal: 8, paddingVertical: 5 },
  quoteLabel: { color: palette.accent, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  quoteText: { color: palette.muted, fontSize: 12 },
  image: { aspectRatio: 1.3, borderRadius: 12, minHeight: 170, width: 240 },
  messageText: { color: palette.ink, fontSize: 15, lineHeight: 21 },
  messageTime: { alignSelf: 'flex-end', color: palette.muted, fontSize: 9 },
  reactionSummary: { backgroundColor: palette.surface, borderColor: palette.line, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 4, marginLeft: 8, marginTop: -5, paddingHorizontal: 7, paddingVertical: 3 },
  reactionSummaryMine: { marginLeft: 0, marginRight: 8 },
  reactionChip: { fontSize: 12 },
  actions: { alignItems: 'center', backgroundColor: palette.ink, borderRadius: 20, flexDirection: 'row', gap: 10, marginTop: 5, paddingHorizontal: 10, paddingVertical: 7 },
  actionsMine: { alignSelf: 'flex-end' },
  actionEmoji: { fontSize: 17 },
  replyButton: { borderLeftColor: '#66717D', borderLeftWidth: 1, paddingLeft: 9 },
  replyButtonText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  composerShell: { backgroundColor: palette.surface, borderTopColor: palette.line, borderTopWidth: StyleSheet.hairlineWidth, gap: 6, paddingHorizontal: 10, paddingBottom: Platform.OS === 'ios' ? 8 : 12, paddingTop: 8 },
  typing: { color: palette.accent, fontSize: 11, fontStyle: 'italic', marginLeft: 45 },
  replyComposer: { alignItems: 'center', backgroundColor: palette.accentSoft, borderLeftColor: palette.accent, borderLeftWidth: 3, borderRadius: 10, flexDirection: 'row', marginHorizontal: 4, padding: 8 },
  replyCopy: { flex: 1, gap: 2 },
  replyLabel: { color: palette.accent, fontSize: 10, fontWeight: '900' },
  replyText: { color: palette.muted, fontSize: 12 },
  cancelReply: { color: palette.muted, fontSize: 24, paddingHorizontal: 8 },
  uploadRow: { alignItems: 'center', flexDirection: 'row', gap: 8, marginHorizontal: 6 },
  uploadText: { color: palette.muted, fontSize: 11 },
  error: { color: palette.danger, fontSize: 11, marginHorizontal: 6 },
  composer: { alignItems: 'flex-end', flexDirection: 'row', gap: 8 },
  attachButton: { alignItems: 'center', backgroundColor: palette.accentSoft, borderRadius: 20, height: 40, justifyContent: 'center', width: 40 },
  attachText: { color: palette.accent, fontSize: 25, fontWeight: '500', marginTop: -2 },
  input: { backgroundColor: palette.canvas, borderColor: palette.line, borderRadius: 20, borderWidth: 1, color: palette.ink, flex: 1, fontSize: 15, maxHeight: 110, minHeight: 40, paddingHorizontal: 14, paddingVertical: 9 },
  sendButton: { alignItems: 'center', backgroundColor: palette.accent, borderRadius: 20, height: 40, justifyContent: 'center', width: 40 },
  sendDisabled: { opacity: 0.35 },
  sendText: { color: '#FFFFFF', fontSize: 24, fontWeight: '800', marginTop: -2 },
});
