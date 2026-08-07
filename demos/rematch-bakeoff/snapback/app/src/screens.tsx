import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import {
  skip,
  useSnapbackAssetImage,
  useSnapbackAssetUpload,
  useSnapbackConnection,
  useSnapbackMutation,
  useSnapbackPresence,
  useSnapbackQueries,
} from '@expo/snapback-react';
import { api, ephemeral } from './generated/api.mjs';
import { useBackendInfo } from './backend';
import { cacheConversation, cacheDirectory, readCache } from './cache';
import type { Persona } from './broker';
import { PERSONAS } from './broker';

const EMOJI = ['👍', '❤️', '😂', '🔥', '☕'];

function rows(queryState: any): any[] {
  return queryState && (queryState.status === 'ready' || queryState.status === 'refreshing')
    ? queryState.data
    : [];
}

// ---------------------------------------------------------------------------
// Shared chrome
// ---------------------------------------------------------------------------

export function PersonaBar({
  persona,
  onSwitch,
}: {
  persona: Persona;
  onSwitch: (persona: Persona) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8 }}>
      <Text style={{ color: '#8696a0', fontSize: 12 }}>You are</Text>
      {PERSONAS.map((candidate) => {
        const active = candidate.handle === persona.handle;
        return (
          <Pressable
            key={candidate.handle}
            testID={`persona-${candidate.handle}`}
            onPress={() => onSwitch(candidate)}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: 999,
              backgroundColor: active ? candidate.color : '#233138',
            }}
          >
            <Text style={{ color: active ? '#fff' : '#8696a0', fontWeight: active ? '700' : '400' }}>
              {candidate.name.split(' ')[0]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ConnectionBadge() {
  const connection = useSnapbackConnection();
  const color = connection.status === 'live' ? '#00a884' : '#f0a04b';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text testID="connection-status" style={{ color: '#8696a0', fontSize: 12 }}>
        {connection.status}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Conversation list
// ---------------------------------------------------------------------------

export function ConversationListScreen({
  persona,
  onOpen,
}: {
  persona: Persona;
  onOpen: (conversationId: string) => void;
}) {
  const workspace = useSnapbackQueries({
    conversations: { ref: api.listConversations, args: {} },
    users: { ref: api.listUsers, args: {} },
  });
  const conversations = rows(workspace.queries.conversations);
  const users = rows(workspace.queries.users);

  useEffect(() => {
    if (conversations.length > 0 || users.length > 0) cacheDirectory(users, conversations);
  }, [conversations, users]);

  return (
    <ScrollView style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 12, paddingBottom: 6, flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: '#e9edef', fontSize: 22, fontWeight: '700' }}>Rematch</Text>
        <ConnectionBadge />
      </View>
      {conversations.map((conversation: any) => (
        <Pressable
          key={conversation._id}
          testID={`conversation-${conversation._id}`}
          onPress={() => onOpen(conversation._id)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderBottomWidth: 1,
            borderBottomColor: '#222d34',
          }}
        >
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              backgroundColor: conversation.kind === 'group' ? '#00a884' : '#7c5cff',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 20 }}>{conversation.kind === 'group' ? '👥' : '💬'}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#e9edef', fontSize: 16, fontWeight: '600' }}>
              {conversation.title}
            </Text>
            <Text style={{ color: '#8696a0', fontSize: 12 }}>
              {conversation.kind === 'group' ? 'Group chat' : 'Direct message'}
            </Text>
          </View>
        </Pressable>
      ))}
      {workspace.queries.conversations.status === 'error' ? (
        <Text style={{ color: '#f15c6d', padding: 12 }}>Failed to load conversations.</Text>
      ) : null}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Chat screen
// ---------------------------------------------------------------------------

function useTyping(conversationId: string, persona: Persona) {
  const scope = useMemo(() => ({ conversationId }), [conversationId]);
  const presence = useSnapbackPresence(ephemeral.typing, { scope, value: skip });
  const typers = useMemo(() => {
    if (presence.status !== 'ready' && presence.status !== 'stale') return [] as string[];
    const names = presence.entries
      .filter((entry: any) => entry.key !== presence.selfKey)
      .filter((entry: any) => entry.value.handle !== persona.handle)
      .map((entry: any) => entry.value.name);
    return [...new Set(names)] as string[];
  }, [presence, persona.handle]);
  return {
    typers,
    publish: (value: { handle: string; name: string }) => {
      void presence.publish(value, { ttlMs: 6_000 }).catch(() => {});
    },
    clear: () => {
      void presence.delete().catch(() => {});
    },
  };
}

function MessageImage({ assetId, serverUrl }: { assetId: string; serverUrl: string }) {
  const image = useSnapbackAssetImage({ assetId, maxWidth: 480 });
  const [retry, setRetry] = useState(0);
  // The hook's rendition src is the strict-delivery route, which a plain
  // <img> cannot fetch on a sessions-mode server (it needs the auth-client
  // protocol header). Our intent declares public-immutable delivery, so use
  // the pasteable public URL. Renditions materialize asynchronously after
  // finalize; a first load can 404, so retry with a cache-busting param.
  const src = `${serverUrl}/assets/public/${assetId}/thumb${retry > 0 ? `?r=${retry}` : ''}`;
  return (
    <Image
      testID={`message-image-${assetId}`}
      source={{ uri: src }}
      onError={() => {
        if (retry < 20) setTimeout(() => setRetry((value) => value + 1), 1_000);
      }}
      style={{
        width: 220,
        height: 220 / (image.aspectRatio ?? 1),
        borderRadius: 8,
        backgroundColor: '#222d34',
      }}
      resizeMode="cover"
    />
  );
}

export function ChatScreen({
  conversationId,
  persona,
  onBack,
}: {
  conversationId: string;
  persona: Persona;
  onBack: () => void;
}) {
  const { serverUrl } = useBackendInfo();
  const workspace = useSnapbackQueries({
    conversation: { ref: api.listConversations, args: {} },
    members: { ref: api.listMembers, args: { conversationId } as any },
    messages: { ref: api.listMessages, args: { conversationId } as any },
    reactions: { ref: api.listReactions, args: { conversationId } as any },
    users: { ref: api.listUsers, args: {} },
  });
  const sendMessage = useSnapbackMutation(api.sendMessage);
  const toggleReaction = useSnapbackMutation(api.toggleReaction);
  const upload = useSnapbackAssetUpload({ upload: api.messageImageUpload });
  const typing = useTyping(conversationId, persona);

  const conversations = rows(workspace.queries.conversation);
  const conversation = conversations.find((entry: any) => entry._id === conversationId);
  const members = rows(workspace.queries.members);
  const messages = rows(workspace.queries.messages);
  const reactions = rows(workspace.queries.reactions);
  const users = rows(workspace.queries.users);

  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<any | null>(null);
  const [attachment, setAttachment] = useState<{
    uri: string;
    fileName: string;
    mimeType: string;
  } | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [reactionTarget, setReactionTarget] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);

  useEffect(() => {
    if (messages.length > 0) cacheConversation(conversationId, members, messages, reactions);
  }, [conversationId, members, messages, reactions]);

  useEffect(() => {
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(timer);
  }, [messages.length]);

  const userByHandle = useMemo(() => {
    const map: Record<string, any> = {};
    for (const user of users) map[user.handle] = user;
    return map;
  }, [users]);

  const reactionsByMessage = useMemo(() => {
    const map: Record<string, Record<string, { count: number; mine: boolean }>> = {};
    for (const reaction of reactions) {
      const perMessage = (map[reaction.messageId] ??= {});
      const entry = (perMessage[reaction.emoji] ??= { count: 0, mine: false });
      entry.count += 1;
      if (reaction.handle === persona.handle) entry.mine = true;
    }
    return map;
  }, [reactions, persona.handle]);

  const messageById = useMemo(() => {
    const map: Record<string, any> = {};
    for (const message of messages) map[message._id] = message;
    return map;
  }, [messages]);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: false,
      mediaTypes: ['images'],
      quality: 0.85,
    });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;
    setAttachment({
      uri: asset.uri,
      fileName: asset.fileName ?? `photo-${Date.now()}.jpg`,
      mimeType: asset.mimeType ?? 'image/jpeg',
    });
  };

  const send = async () => {
    const text = draft.trim();
    if (!text && !attachment) return;
    setSending(true);
    setSendError(null);
    try {
      let imageAssetId: string | undefined;
      if (attachment) {
        const response = await fetch(attachment.uri);
        const blob = await response.blob();
        const task = upload.start(blob, {
          declaredContentType: attachment.mimeType,
          declaredFilename: attachment.fileName,
          previewUrl: attachment.uri,
        }) as any;
        const receipt = await task.done;
        if (receipt.status !== 'ready' || !receipt.assetId) {
          throw new Error(receipt.diagnostic?.message ?? 'image upload failed');
        }
        imageAssetId = receipt.assetId;
      }
      await sendMessage({
        conversationId: conversationId as any,
        senderHandle: persona.handle,
        ...(text ? { text } : {}),
        ...(imageAssetId ? { imageAssetId } : {}),
        ...(replyTo ? { replyToId: replyTo._id } : {}),
        sentAt: Date.now(),
      });
      setDraft('');
      setReplyTo(null);
      setAttachment(null);
      typing.clear();
    } catch (error: any) {
      setSendError(String(error?.message ?? error));
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingHorizontal: 12,
          paddingVertical: 8,
          backgroundColor: '#202c33',
        }}
      >
        <Pressable testID="back-button" onPress={onBack}>
          <Text style={{ color: '#00a884', fontSize: 18 }}>‹ Back</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#e9edef', fontSize: 16, fontWeight: '700' }}>
            {conversation?.title ?? '…'}
          </Text>
          <Text style={{ color: '#8696a0', fontSize: 11 }}>
            {members.map((member: any) => userByHandle[member.handle]?.name ?? member.handle).join(', ')}
          </Text>
        </View>
        <ConnectionBadge />
      </View>

      <ScrollView ref={scrollRef} style={{ flex: 1, paddingHorizontal: 10 }}>
        {messages.map((message: any) => {
          const mine = message.senderHandle === persona.handle;
          const sender = userByHandle[message.senderHandle];
          const quoted = message.replyToId ? messageById[message.replyToId] : null;
          const messageReactions = reactionsByMessage[message._id] ?? {};
          return (
            <View
              key={message._id}
              testID={`message-${message._id}`}
              style={{
                alignSelf: mine ? 'flex-end' : 'flex-start',
                maxWidth: '80%',
                marginVertical: 3,
              }}
            >
              <View
                style={{
                  backgroundColor: mine ? '#005c4b' : '#202c33',
                  borderRadius: 10,
                  padding: 8,
                }}
              >
                {!mine ? (
                  <Text style={{ color: sender?.color ?? '#8696a0', fontSize: 12, fontWeight: '700' }}>
                    {sender?.name ?? message.senderHandle}
                  </Text>
                ) : null}
                {quoted ? (
                  <View
                    style={{
                      borderLeftWidth: 3,
                      borderLeftColor: userByHandle[quoted.senderHandle]?.color ?? '#00a884',
                      backgroundColor: '#1a242b',
                      borderRadius: 6,
                      padding: 6,
                      marginBottom: 4,
                    }}
                  >
                    <Text style={{ color: '#8696a0', fontSize: 11, fontWeight: '700' }}>
                      {userByHandle[quoted.senderHandle]?.name ?? quoted.senderHandle}
                    </Text>
                    <Text numberOfLines={1} style={{ color: '#8696a0', fontSize: 12 }}>
                      {quoted.kind === 'image' ? '📷 Photo' : quoted.text}
                    </Text>
                  </View>
                ) : null}
                {message.image ? <MessageImage assetId={message.image} serverUrl={serverUrl} /> : null}
                {message.text ? (
                  <Text style={{ color: '#e9edef', fontSize: 15 }}>{message.text}</Text>
                ) : null}
                <Text style={{ color: '#8696a0', fontSize: 10, alignSelf: 'flex-end', marginTop: 2 }}>
                  {new Date(message.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>

              <View style={{ flexDirection: 'row', gap: 4, marginTop: 2, alignSelf: mine ? 'flex-end' : 'flex-start' }}>
                {Object.entries(messageReactions).map(([emoji, info]) => (
                  <Pressable
                    key={emoji}
                    testID={`reaction-${message._id}-${emoji}`}
                    onPress={() =>
                      void toggleReaction({
                        messageId: message._id,
                        conversationId: conversationId as any,
                        handle: persona.handle,
                        emoji,
                      }).catch(() => {})
                    }
                    style={{
                      flexDirection: 'row',
                      gap: 2,
                      backgroundColor: info.mine ? '#0b3d36' : '#233138',
                      borderRadius: 999,
                      paddingHorizontal: 6,
                      paddingVertical: 1,
                    }}
                  >
                    <Text style={{ fontSize: 12 }}>{emoji}</Text>
                    <Text style={{ color: '#8696a0', fontSize: 12 }}>{info.count}</Text>
                  </Pressable>
                ))}
                <Pressable
                  testID={`react-button-${message._id}`}
                  onPress={() => setReactionTarget(reactionTarget === message._id ? null : message._id)}
                  style={{ backgroundColor: '#233138', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 }}
                >
                  <Text style={{ color: '#8696a0', fontSize: 12 }}>🙂+</Text>
                </Pressable>
                <Pressable
                  testID={`reply-button-${message._id}`}
                  onPress={() => setReplyTo(message)}
                  style={{ backgroundColor: '#233138', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 }}
                >
                  <Text style={{ color: '#8696a0', fontSize: 12 }}>↩ Reply</Text>
                </Pressable>
              </View>

              {reactionTarget === message._id ? (
                <View
                  style={{
                    flexDirection: 'row',
                    gap: 6,
                    backgroundColor: '#111b21',
                    borderRadius: 999,
                    padding: 6,
                    marginTop: 3,
                    alignSelf: mine ? 'flex-end' : 'flex-start',
                  }}
                >
                  {EMOJI.map((emoji) => (
                    <Pressable
                      key={emoji}
                      testID={`emoji-${message._id}-${emoji}`}
                      onPress={() => {
                        setReactionTarget(null);
                        void toggleReaction({
                          messageId: message._id,
                          conversationId: conversationId as any,
                          handle: persona.handle,
                          emoji,
                        }).catch(() => {});
                      }}
                    >
                      <Text style={{ fontSize: 18 }}>{emoji}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}
        <View style={{ height: 12 }} />
      </ScrollView>

      {typing.typers.length > 0 ? (
        <Text testID="typing-indicator" style={{ color: '#00a884', fontSize: 12, paddingHorizontal: 12, paddingBottom: 2 }}>
          {typing.typers.join(', ')} {typing.typers.length === 1 ? 'is' : 'are'} typing…
        </Text>
      ) : null}

      {replyTo ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            marginHorizontal: 10,
            backgroundColor: '#1a242b',
            borderRadius: 8,
            padding: 6,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#00a884', fontSize: 11, fontWeight: '700' }}>
              Replying to {userByHandle[replyTo.senderHandle]?.name ?? replyTo.senderHandle}
            </Text>
            <Text numberOfLines={1} style={{ color: '#8696a0', fontSize: 12 }}>
              {replyTo.kind === 'image' ? '📷 Photo' : replyTo.text}
            </Text>
          </View>
          <Pressable testID="cancel-reply" onPress={() => setReplyTo(null)}>
            <Text style={{ color: '#8696a0', fontSize: 16, padding: 4 }}>✕</Text>
          </Pressable>
        </View>
      ) : null}

      {attachment ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 10, marginTop: 4, gap: 8 }}>
          <Image source={{ uri: attachment.uri }} style={{ width: 48, height: 48, borderRadius: 6 }} />
          <Text style={{ color: '#8696a0', fontSize: 12, flex: 1 }} numberOfLines={1}>
            {attachment.fileName}
          </Text>
          {upload.state.status === 'uploading' || upload.state.status === 'finalizing' ? (
            <Text style={{ color: '#00a884', fontSize: 12 }}>
              {Math.round(
                (upload.state.totalBytes > 0
                  ? upload.state.bytesTransferred / upload.state.totalBytes
                  : 0) * 100,
              )}
              %
            </Text>
          ) : null}
          <Pressable testID="cancel-attachment" onPress={() => setAttachment(null)}>
            <Text style={{ color: '#8696a0', fontSize: 16, padding: 4 }}>✕</Text>
          </Pressable>
        </View>
      ) : null}

      {sendError ? (
        <Text style={{ color: '#f15c6d', paddingHorizontal: 12, fontSize: 12 }}>{sendError}</Text>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8 }}>
        <Pressable testID="pick-image" onPress={() => void pickImage()}>
          <Text style={{ fontSize: 22 }}>📎</Text>
        </Pressable>
        <TextInput
          testID="composer-input"
          value={draft}
          onChangeText={(next) => {
            setDraft(next);
            if (next.trim()) typing.publish({ handle: persona.handle, name: persona.name });
            else typing.clear();
          }}
          placeholder="Message"
          placeholderTextColor="#8696a0"
          style={{
            flex: 1,
            backgroundColor: '#2a3942',
            color: '#e9edef',
            borderRadius: 20,
            paddingHorizontal: 14,
            paddingVertical: Platform.OS === 'web' ? 10 : 8,
            fontSize: 15,
          }}
          onSubmitEditing={() => void send()}
        />
        <Pressable
          testID="send-button"
          onPress={() => void send()}
          disabled={sending}
          style={{
            backgroundColor: '#00a884',
            borderRadius: 20,
            paddingHorizontal: 14,
            paddingVertical: 8,
            opacity: sending ? 0.6 : 1,
          }}
        >
          {sending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Send</Text>}
        </Pressable>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Offline cold-start view (backend unreachable)
// ---------------------------------------------------------------------------

export function OfflineApp({ error }: { error: string }) {
  const cache = readCache();
  const [selected, setSelected] = useState<string | null>(null);
  if (!cache) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ color: '#e9edef', fontSize: 16, textAlign: 'center' }}>
          Backend unreachable and no cached history yet.
        </Text>
        <Text style={{ color: '#8696a0', fontSize: 12, marginTop: 8 }}>{error}</Text>
      </View>
    );
  }
  const conversations = cache.conversations ?? [];
  const users = cache.users ?? [];
  const userByHandle: Record<string, any> = {};
  for (const user of users) userByHandle[user.handle] = user;
  const messages = selected ? cache.messagesByConversation[selected] ?? [] : [];
  return (
    <View style={{ flex: 1 }}>
      <View testID="offline-banner" style={{ backgroundColor: '#f0a04b', padding: 6 }}>
        <Text style={{ color: '#111b21', fontSize: 12, textAlign: 'center', fontWeight: '700' }}>
          Offline — showing cached history (backend unreachable)
        </Text>
      </View>
      {!selected ? (
        <ScrollView>
          {conversations.map((conversation: any) => (
            <Pressable
              key={conversation._id}
              testID={`conversation-${conversation._id}`}
              onPress={() => setSelected(conversation._id)}
              style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: '#222d34' }}
            >
              <Text style={{ color: '#e9edef', fontSize: 16, fontWeight: '600' }}>
                {conversation.title}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : (
        <ScrollView style={{ paddingHorizontal: 10 }}>
          <Pressable testID="back-button" onPress={() => setSelected(null)}>
            <Text style={{ color: '#00a884', fontSize: 16, padding: 8 }}>‹ Conversations</Text>
          </Pressable>
          {messages.map((message: any) => (
            <View
              key={message._id}
              testID={`message-${message._id}`}
              style={{ backgroundColor: '#202c33', borderRadius: 10, padding: 8, marginVertical: 3, alignSelf: 'flex-start', maxWidth: '80%' }}
            >
              <Text style={{ color: userByHandle[message.senderHandle]?.color ?? '#8696a0', fontSize: 12, fontWeight: '700' }}>
                {userByHandle[message.senderHandle]?.name ?? message.senderHandle}
              </Text>
              <Text style={{ color: '#e9edef', fontSize: 15 }}>
                {message.kind === 'image' ? '📷 Photo (cached reference)' : message.text}
              </Text>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
