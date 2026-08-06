import { fetch as expoFetch } from 'expo/fetch';
import { Text, View } from 'react-native';
import { useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { ConvexProvider, ConvexReactClient, useMutation, useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import type {
  BackendHooks,
  ChatMessage,
  ConversationDetail,
  ConversationSummary,
  QueryState,
  SendMessageInput,
  TypingPerson,
} from '@tandem/shared/backend';
import { colors } from '@tandem/shared/colors';

const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
const convexSiteOrigin = process.env.EXPO_PUBLIC_CONVEX_SITE_URL;

function externalizeStorageUrl(url: string) {
  if (!convexSiteOrigin) return url;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') return url;
    return `${convexSiteOrigin.replace(/\/$/, '')}${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function Root({ children }: PropsWithChildren) {
  const client = useMemo(
    () => convexUrl ? new ConvexReactClient(convexUrl, { unsavedChangesWarning: false }) : null,
    [],
  );
  if (!client) {
    return (
      <View style={{ alignItems: 'center', backgroundColor: colors.background, flex: 1, gap: 12, justifyContent: 'center', padding: 28 }}>
        <Text selectable style={{ color: colors.destructive, fontSize: 18, fontWeight: '800', textAlign: 'center' }}>Convex has not been provisioned yet.</Text>
        <Text selectable style={{ color: colors.secondary, textAlign: 'center' }}>Run `npx convex dev` in this app first.</Text>
      </View>
    );
  }
  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}

function readyState<T>(data: T | undefined, empty: T): QueryState<T> {
  return data === undefined
    ? { status: 'loading', data: empty, connection: 'connecting', error: null }
    : { status: 'ready', data, connection: 'live', error: null };
}

function useInbox(viewerId: string): QueryState<ConversationSummary[]> {
  return readyState(useQuery(api.chat.listInbox, { viewerId }), []);
}

function useConversation(conversationId: string, viewerId: string): QueryState<ConversationDetail | null> {
  return readyState(useQuery(api.chat.getConversation, { conversationId, viewerId }), null);
}

function useMessages(conversationId: string, viewerId: string): QueryState<ChatMessage[]> {
  const rows = useQuery(api.chat.listMessages, { conversationId, viewerId });
  return readyState(rows?.map((row) => ({
    ...row,
    ...(row.imageUrl ? { imageUrl: externalizeStorageUrl(row.imageUrl) } : {}),
  })), []);
}

function useTyping(
  conversationId: string,
  viewer: { id: string; name: string; color: string },
  isTyping: boolean,
): QueryState<TypingPerson[]> {
  const rows = useQuery(api.typing.list, { conversationId });
  const setTyping = useMutation(api.typing.set);
  const last = useRef(false);
  useEffect(() => {
    const publish = (typing: boolean) => setTyping({
      conversationId,
      userId: viewer.id,
      name: viewer.name,
      color: viewer.color,
      typing,
    }).catch(() => undefined);
    if (isTyping) {
      last.current = true;
      void publish(true);
      const timer = setInterval(() => { void publish(true); }, 2_000);
      return () => {
        clearInterval(timer);
        if (last.current) void publish(false);
        last.current = false;
      };
    }
    return undefined;
  }, [conversationId, isTyping, setTyping, viewer.color, viewer.id, viewer.name]);
  return readyState(rows, []);
}

function useSendMessage() {
  const mutate = useMutation(api.chat.sendMessage);
  return async (input: SendMessageInput) => {
    await mutate({
      conversationId: input.conversationId,
      senderId: input.senderId,
      text: input.text,
      ...(input.replyToId ? { replyToId: input.replyToId } : {}),
      ...(input.imageRef ? { imageStorageId: input.imageRef as Id<'_storage'> } : {}),
    });
  };
}

function useToggleReaction() {
  const mutate = useMutation(api.chat.toggleReaction);
  return async (input: { conversationId: string; messageId: string; userId: string; emoji: string }) => {
    await mutate(input);
  };
}

function useImageUpload() {
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  return {
    state: { status, progress: status === 'uploading' ? 0.5 : 0, error },
    upload: async (input: { uri: string; mimeType: string; fileName: string }) => {
      setStatus('uploading');
      setError(null);
      try {
        const local = await expoFetch(input.uri);
        const blob = await local.blob();
        const uploadUrl = externalizeStorageUrl(await generateUploadUrl());
        const response = await expoFetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': input.mimeType },
          body: blob,
        });
        if (!response.ok) throw new Error(`Convex image upload failed (${response.status}).`);
        const payload = await response.json() as { storageId: string };
        setStatus('idle');
        return payload.storageId;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        setStatus('error');
        throw cause;
      }
    },
  };
}

export const backend: BackendHooks = {
  kind: 'convex',
  label: 'Convex',
  Root,
  useInbox,
  useConversation,
  useMessages,
  useTyping,
  useSendMessage,
  useToggleReaction,
  useImageUpload,
};
