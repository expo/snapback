import { useEffect, useMemo, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Stack } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BackendHooks, ChatMessage, ConversationDetail } from './backend';
import { colors } from './colors';
import { formatMessageTime } from './format';
import { QueryState } from './query-state';
import { useDemoViewer } from './viewer';

const REACTIONS = ['👍', '❤️', '😂', '😮'];

type PendingImage = {
  uri: string;
  fileName: string;
  mimeType: string;
};

function ConversationHeader({ detail, backend }: { detail: ConversationDetail; backend: BackendHooks }) {
  const subtitle = detail.isGroup
    ? `${detail.memberCount} people · ${detail.memberNames.join(', ')}`
    : `Direct message · ${backend.label}`;
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text numberOfLines={1} selectable style={{ color: colors.label, fontSize: 16, fontWeight: '700' }}>
        {detail.name}
      </Text>
      <Text numberOfLines={1} selectable style={{ color: colors.secondary, fontSize: 11 }}>
        {subtitle}
      </Text>
    </View>
  );
}

function ReplyPointer({ message, outgoing }: { message: ChatMessage; outgoing: boolean }) {
  if (!message.replyTo) return null;
  return (
    <View
      style={{
        backgroundColor: outgoing ? 'rgba(255,255,255,.14)' : '#F0EDF8',
        borderCurve: 'continuous',
        borderLeftColor: outgoing ? '#C7BEFF' : colors.replyStripe,
        borderLeftWidth: 3,
        borderRadius: 8,
        gap: 2,
        paddingHorizontal: 9,
        paddingVertical: 7,
      }}
    >
      <Text selectable style={{ color: outgoing ? '#E4DFFF' : colors.accent, fontSize: 12, fontWeight: '800' }}>
        {message.replyTo.senderName}
      </Text>
      <Text numberOfLines={1} selectable style={{ color: outgoing ? '#F3F0FF' : colors.secondary, fontSize: 12 }}>
        {message.replyTo.preview}
      </Text>
    </View>
  );
}

function MessageBubble({
  message,
  selected,
  onSelect,
  onReply,
  onReact,
  viewerId,
}: {
  message: ChatMessage;
  selected: boolean;
  onSelect(): void;
  onReply(): void;
  onReact(emoji: string): void;
  viewerId: string;
}) {
  const outgoing = message.senderId === viewerId;
  return (
    <Animated.View
      layout={LinearTransition.duration(180)}
      style={{ alignItems: outgoing ? 'flex-end' : 'flex-start', gap: 5, paddingHorizontal: 13 }}
    >
      {!outgoing ? (
        <Text selectable style={{ color: message.senderColor, fontSize: 12, fontWeight: '800', paddingLeft: 8 }}>
          {message.senderName}
        </Text>
      ) : null}
      <Pressable
        accessibilityHint="Long press for reactions and reply"
        accessibilityLabel={`${message.senderName}: ${message.text || 'image'}`}
        onLongPress={() => {
          if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
          onSelect();
        }}
        style={{ maxWidth: '84%' }}
      >
        <View
          style={{
            backgroundColor: outgoing ? colors.outgoingBubble : colors.incomingBubble,
            borderCurve: 'continuous',
            borderRadius: 18,
            borderBottomRightRadius: outgoing ? 5 : 18,
            borderBottomLeftRadius: outgoing ? 18 : 5,
            boxShadow: outgoing ? 'none' : '0 1px 3px rgba(37, 26, 66, .09)',
            gap: 8,
            overflow: 'hidden',
            padding: message.imageUrl ? 5 : 11,
          }}
        >
          <ReplyPointer message={message} outgoing={outgoing} />
          {message.imageUrl ? (
            <Image
              accessibilityLabel={`Image sent by ${message.senderName}`}
              contentFit="cover"
              source={message.imageUrl}
              style={{ aspectRatio: 1.25, borderRadius: 14, minWidth: 220 }}
              transition={160}
            />
          ) : null}
          {message.text ? (
            <Text
              selectable
              style={{
                color: outgoing ? colors.white : colors.label,
                fontSize: 16,
                lineHeight: 21,
                paddingHorizontal: message.imageUrl ? 7 : 0,
                paddingTop: message.imageUrl ? 2 : 0,
              }}
            >
              {message.text}
            </Text>
          ) : null}
          <Text
            selectable
            style={{
              alignSelf: 'flex-end',
              color: outgoing ? '#DED7FF' : colors.secondary,
              fontSize: 10,
              fontVariant: ['tabular-nums'],
              paddingBottom: message.imageUrl ? 4 : 0,
              paddingHorizontal: message.imageUrl ? 6 : 0,
            }}
          >
            {formatMessageTime(message.createdAt)}{outgoing ? '  ✓✓' : ''}
          </Text>
        </View>
      </Pressable>
      {message.reactions.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, paddingHorizontal: 4 }}>
          {message.reactions.map((reaction) => (
            <Pressable
              accessibilityLabel={`${reaction.emoji} reaction, ${reaction.count}`}
              key={reaction.emoji}
              onPress={() => onReact(reaction.emoji)}
              style={{
                backgroundColor: reaction.reactedByViewer ? '#E9E3FF' : colors.surface,
                borderColor: reaction.reactedByViewer ? colors.accent : colors.separator,
                borderRadius: 12,
                borderWidth: 1,
                paddingHorizontal: 7,
                paddingVertical: 3,
              }}
            >
              <Text selectable style={{ color: colors.label, fontSize: 12, fontVariant: ['tabular-nums'] }}>
                {reaction.emoji} {reaction.count}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {selected ? (
        <Animated.View
          entering={FadeIn.duration(140)}
          exiting={FadeOut.duration(120)}
          style={{
            alignItems: 'center',
            backgroundColor: colors.surface,
            borderCurve: 'continuous',
            borderRadius: 18,
            boxShadow: '0 3px 12px rgba(37, 26, 66, .12)',
            flexDirection: 'row',
            gap: 2,
            padding: 4,
          }}
        >
          {REACTIONS.map((emoji) => (
            <Pressable
              accessibilityLabel={`React ${emoji}`}
              key={emoji}
              onPress={() => onReact(emoji)}
              style={{ paddingHorizontal: 8, paddingVertical: 6 }}
            >
              <Text style={{ fontSize: 20 }}>{emoji}</Text>
            </Pressable>
          ))}
          <View style={{ backgroundColor: colors.separator, height: 22, width: 1 }} />
          <Pressable accessibilityLabel="Reply to message" onPress={onReply} style={{ paddingHorizontal: 9, paddingVertical: 7 }}>
            <Text style={{ color: colors.accent, fontSize: 13, fontWeight: '800' }}>↩ Reply</Text>
          </Pressable>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

function TypingIndicator({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  const label = names.length === 1 ? `${names[0]} is typing` : `${names.slice(0, 2).join(' and ')} are typing`;
  return (
    <Animated.View
      entering={FadeIn.duration(160)}
      exiting={FadeOut.duration(140)}
      style={{ alignItems: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 18, paddingVertical: 5 }}
    >
      <View style={{ backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 }}>
        <Text selectable style={{ color: colors.secondary, fontSize: 16, letterSpacing: 2 }}>•••</Text>
      </View>
      <Text selectable style={{ color: colors.secondary, fontSize: 12 }}>{label}</Text>
    </Animated.View>
  );
}

export function ChatScreen({ backend, conversationId }: { backend: BackendHooks; conversationId: string }) {
  const insets = useSafeAreaInsets();
  const { viewer } = useDemoViewer();
  const detail = backend.useConversation(conversationId, viewer.id);
  const messages = backend.useMessages(conversationId, viewer.id);
  const sendMessage = backend.useSendMessage();
  const toggleReaction = backend.useToggleReaction();
  const imageUpload = backend.useImageUpload();
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState<PendingImage | null>(null);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const isTyping = text.trim().length > 0 && !sending;
  const typing = backend.useTyping(conversationId, viewer, isTyping);

  const otherTyping = useMemo(
    () => typing.data.filter((person) => person.userId !== viewer.id).map((person) => person.name),
    [typing.data, viewer.id],
  );

  useEffect(() => {
    if (messages.data.length === 0) return;
    const frame = requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
    return () => cancelAnimationFrame(frame);
  }, [messages.data.length]);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: false,
      mediaTypes: ['images'],
      quality: 0.82,
    });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;
    setAttachment({
      uri: asset.uri,
      fileName: asset.fileName ?? `message-${Date.now()}.jpg`,
      mimeType: asset.mimeType ?? 'image/jpeg',
    });
    if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
  };

  const submit = async () => {
    const body = text.trim();
    if (sending || (!body && !attachment)) return;
    setSending(true);
    setSendError(null);
    try {
      const imageRef = attachment ? await imageUpload.upload(attachment) : undefined;
      await sendMessage({
        conversationId,
        senderId: viewer.id,
        text: body,
        ...(replyingTo ? { replyToId: replyingTo.id } : {}),
        ...(imageRef ? { imageRef } : {}),
      });
      setText('');
      setAttachment(null);
      setReplyingTo(null);
      setSelectedMessageId(null);
      if (process.env.EXPO_OS === 'ios') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      setSendError(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
  };

  const currentDetail = detail.data;
  return (
    <KeyboardAvoidingView
      behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={88}
      style={{ backgroundColor: colors.background, flex: 1 }}
    >
      <Stack.Title>{currentDetail?.name ?? 'Conversation'}</Stack.Title>
      {currentDetail ? (
        <View style={{ backgroundColor: colors.surface, borderBottomColor: colors.separator, borderBottomWidth: 1, paddingHorizontal: 16, paddingVertical: 8 }}>
          <ConversationHeader backend={backend} detail={currentDetail} />
        </View>
      ) : null}
      {messages.status === 'error' ? (
        <QueryState message="Loading messages…" error={messages.error} />
      ) : (
        <FlatList
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ gap: 12, paddingBottom: 10, paddingTop: 14 }}
          data={messages.data}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          keyExtractor={(item) => item.id}
          ListEmptyComponent={<QueryState message="Loading messages…" />}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ref={listRef}
          renderItem={({ item }) => (
            <MessageBubble
              message={item}
              onReact={(emoji) => {
                setSelectedMessageId(null);
                void toggleReaction({
                  conversationId,
                  emoji,
                  messageId: item.id,
                  userId: viewer.id,
                });
              }}
              onReply={() => {
                setReplyingTo(item);
                setSelectedMessageId(null);
              }}
              onSelect={() => setSelectedMessageId((current) => current === item.id ? null : item.id)}
              selected={selectedMessageId === item.id}
              viewerId={viewer.id}
            />
          )}
        />
      )}
      <TypingIndicator names={otherTyping} />
      <View
        style={{
          backgroundColor: colors.composer,
          borderTopColor: colors.separator,
          borderTopWidth: 1,
          gap: 8,
          paddingBottom: Math.max(insets.bottom, 9),
          paddingHorizontal: 10,
          paddingTop: 8,
        }}
      >
        {replyingTo ? (
          <Animated.View
            entering={FadeIn.duration(140)}
            exiting={FadeOut.duration(120)}
            style={{ alignItems: 'center', backgroundColor: colors.elevated, borderRadius: 12, flexDirection: 'row', gap: 8, padding: 9 }}
          >
            <View style={{ backgroundColor: colors.replyStripe, borderRadius: 2, height: 34, width: 3 }} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text selectable style={{ color: colors.accent, fontSize: 12, fontWeight: '800' }}>Replying to {replyingTo.senderName}</Text>
              <Text numberOfLines={1} selectable style={{ color: colors.secondary, fontSize: 12 }}>{replyingTo.text || 'Photo'}</Text>
            </View>
            <Pressable accessibilityLabel="Cancel reply" onPress={() => setReplyingTo(null)} style={{ padding: 6 }}>
              <Text style={{ color: colors.secondary, fontSize: 17 }}>×</Text>
            </Pressable>
          </Animated.View>
        ) : null}
        {attachment ? (
          <Animated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(120)} style={{ alignItems: 'flex-end', alignSelf: 'flex-start' }}>
            <Image contentFit="cover" source={attachment.uri} style={{ borderRadius: 14, height: 92, width: 118 }} />
            <Pressable
              accessibilityLabel="Remove selected image"
              onPress={() => setAttachment(null)}
              style={{ alignItems: 'center', backgroundColor: '#24202D', borderRadius: 12, height: 24, justifyContent: 'center', position: 'absolute', right: -6, top: -6, width: 24 }}
            >
              <Text style={{ color: colors.white, fontSize: 15 }}>×</Text>
            </Pressable>
          </Animated.View>
        ) : null}
        {sendError || imageUpload.state.error ? (
          <Text selectable style={{ color: colors.destructive, fontSize: 12 }}>{sendError ?? imageUpload.state.error}</Text>
        ) : null}
        <View style={{ alignItems: 'flex-end', flexDirection: 'row', gap: 8 }}>
          <Pressable
            accessibilityLabel="Choose an image"
            onPress={pickImage}
            style={{ alignItems: 'center', height: 42, justifyContent: 'center', width: 42 }}
          >
            <Text style={{ color: colors.accent, fontSize: 25 }}>＋</Text>
          </Pressable>
          <TextInput
            accessibilityLabel="Message"
            maxLength={2_000}
            multiline
            onChangeText={setText}
            placeholder="Message"
            placeholderTextColor={colors.secondary}
            style={{
              backgroundColor: colors.elevated,
              borderColor: colors.separator,
              borderCurve: 'continuous',
              borderRadius: 19,
              borderWidth: 1,
              color: colors.label,
              flex: 1,
              fontSize: 16,
              maxHeight: 112,
              minHeight: 40,
              paddingHorizontal: 13,
              paddingVertical: 9,
            }}
            value={text}
          />
          <Pressable
            accessibilityLabel="Send message"
            disabled={sending || (!text.trim() && !attachment)}
            onPress={submit}
            style={{
              alignItems: 'center',
              backgroundColor: colors.accent,
              borderRadius: 21,
              height: 42,
              justifyContent: 'center',
              opacity: sending || (!text.trim() && !attachment) ? 0.4 : 1,
              width: 42,
            }}
          >
            {sending ? <ActivityIndicator color={colors.white} size="small" /> : <Text style={{ color: colors.white, fontSize: 19, fontWeight: '900' }}>↑</Text>}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
