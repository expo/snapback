import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';
import { Platform, Text, View } from 'react-native';
import { useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { SnapbackClient, createExternalSessionClient, registerExpoFileSystemRqsFiles } from '@expo/snapback-client';
import {
  SnapbackProvider,
  createSnapbackReactProvider,
  skip,
  useSnapbackAssetUpload,
  useSnapbackConnection,
  useSnapbackMutation,
  useSnapbackPresence,
  useSnapbackQuery,
} from '@tandem/snapback-react';
import api from '@generated/api';
import schema from '@generated/schema.manifest.json';
import functions from '@generated/functions.manifest.json';
import capabilityManifest from '@generated/capability.manifest.json';
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

if (Platform.OS !== 'web') {
  registerExpoFileSystemRqsFiles(FileSystem, { crypto: Crypto });
}

const origin = process.env.EXPO_PUBLIC_SNAPBACK_ORIGIN ?? 'http://127.0.0.1:4477';
const brokerOrigin = process.env.EXPO_PUBLIC_TANDEM_BROKER_ORIGIN;
const brokerToken = process.env.EXPO_PUBLIC_TANDEM_BROKER_TOKEN;
type Provider = ReturnType<typeof createSnapbackReactProvider>;
type Boot = { status: 'loading' } | { status: 'ready'; client: SnapbackClient; provider: Provider } | { status: 'error'; message: string };

function Root({ children }: PropsWithChildren) {
  const [boot, setBoot] = useState<Boot>({ status: 'loading' });
  const task = useRef<Promise<Extract<Boot, { status: 'ready' }>> | null>(null);

  useEffect(() => {
    let mounted = true;
    // @ref LLP 0064#3-react-nativeexpo-online-surface — Expo consumes one prepared
    // generated binding; it does not invent a second client cache.
    task.current ??= (async () => {
      if (!brokerOrigin || !brokerToken) {
        throw new Error('Start `bun run backend` before opening Tandem · Snapback.');
      }
      const brokerResponse = await expoFetch(`${brokerOrigin}/session`, {
        method: 'POST',
        headers: { authorization: `Bearer ${brokerToken}` },
      });
      const brokerPayload = await brokerResponse.json() as { bearerToken?: string; error?: string };
      if (!brokerResponse.ok || !brokerPayload.bearerToken) {
        throw new Error(brokerPayload.error ?? 'The local Tandem identity broker refused session entry.');
      }
      const client = createExternalSessionClient(origin, { bearerToken: brokerPayload.bearerToken });
      const binding = await client.prepareReactBinding({
        generatedManifest: { schema, functions, capabilityManifest },
      });
      return { status: 'ready' as const, client, provider: createSnapbackReactProvider(binding) };
    })();
    void task.current.then(
      (ready) => { if (mounted) setBoot(ready); },
      (error) => { if (mounted) setBoot({ status: 'error', message: error instanceof Error ? error.message : String(error) }); },
    );
    return () => { mounted = false; };
  }, []);

  if (boot.status !== 'ready') {
    return (
      <View style={{ alignItems: 'center', backgroundColor: colors.background, flex: 1, gap: 12, justifyContent: 'center', padding: 28 }}>
        <Text selectable style={{ color: boot.status === 'error' ? colors.destructive : colors.label, fontSize: 18, fontWeight: '800', textAlign: 'center' }}>
          {boot.status === 'error' ? boot.message : 'Connecting to Snapback…'}
        </Text>
        <Text selectable style={{ color: colors.secondary, textAlign: 'center' }}>Tandem · Snapback Online surface</Text>
      </View>
    );
  }
  return <SnapbackProvider provider={boot.provider}>{children}</SnapbackProvider>;
}

function useConnectionLabel() {
  return useSnapbackConnection().status;
}

function stateFromRows<T>(query: any, empty: T, connection: string, map: (data: any) => T): QueryState<T> {
  if (query.status === 'ready' || query.status === 'refreshing') {
    return { status: 'ready', data: map(query.data), connection, error: null };
  }
  if (query.status === 'error') {
    return { status: 'error', data: empty, connection, error: query.diagnostic?.message ?? 'Snapback query failed' };
  }
  return { status: 'loading', data: empty, connection, error: null };
}

function useInbox(viewerId: string): QueryState<ConversationSummary[]> {
  const connection = useConnectionLabel();
  const query = useSnapbackQuery(api.listInbox, { viewerId } as any);
  return stateFromRows(query, [], connection, (rows) => rows as ConversationSummary[]);
}

function useConversation(conversationId: string, viewerId: string): QueryState<ConversationDetail | null> {
  const connection = useConnectionLabel();
  const query = useSnapbackQuery(api.getConversation, { conversationId, viewerId } as any);
  return stateFromRows(query, null, connection, (rows) => (rows[0] ?? null) as ConversationDetail | null);
}

function publicAssetUrl(assetId: string) {
  return `${origin}/assets/public/${encodeURIComponent(assetId)}/display`;
}

function useMessages(conversationId: string, viewerId: string): QueryState<ChatMessage[]> {
  const connection = useConnectionLabel();
  const query = useSnapbackQuery(api.listMessages, { conversationId, viewerId } as any);
  return stateFromRows(query, [], connection, (rows) => rows.map((row: any) => ({
    id: row.id,
    conversationId: row.conversationId,
    senderId: row.senderId,
    senderName: row.senderName,
    senderColor: row.senderColor,
    text: row.text,
    createdAt: row.createdAt,
    ...(row.imageAssetId ? { imageUrl: publicAssetUrl(row.imageAssetId) } : {}),
    ...(row.seedImageUrl ? { imageUrl: row.seedImageUrl } : {}),
    ...(row.replyTo ? { replyTo: row.replyTo } : {}),
    reactions: row.reactions,
  })) as ChatMessage[]);
}

function useTyping(
  conversationId: string,
  viewer: { id: string; name: string; color: string },
  isTyping: boolean,
): QueryState<TypingPerson[]> {
  // @ref LLP 0114#presence-hook — the provider owns connection identity,
  // heartbeats, and expiry; the screen only supplies scope and a value.
  const presence = useSnapbackPresence(api.ephemeral.typing, {
    scope: { conversationId },
    value: isTyping ? { userId: viewer.id, name: viewer.name, color: viewer.color } : skip,
    ttlMs: 4_000,
  });
  const connection = presence.connection;
  if (presence.status === 'ready' || presence.status === 'stale') {
    return { status: 'ready', data: presence.entries.map((entry) => entry.value), connection, error: null };
  }
  if (presence.status === 'error' || presence.status === 'unsupported') {
    return { status: 'error', data: [], connection, error: presence.diagnostic.message };
  }
  return { status: 'loading', data: [], connection, error: null };
}

function useSendMessage() {
  const mutate = useSnapbackMutation(api.sendMessage);
  return async (input: SendMessageInput) => {
    await mutate({
      conversationId: input.conversationId,
      senderId: input.senderId,
      text: input.text,
      ...(input.replyToId ? { replyToId: input.replyToId } : {}),
      ...(input.imageRef ? { imageAssetId: input.imageRef } : {}),
    } as any);
  };
}

function useToggleReaction() {
  const mutate = useSnapbackMutation(api.toggleReaction);
  return async (input: { conversationId: string; messageId: string; userId: string; emoji: string }) => {
    await mutate(input as any);
  };
}

function useImageUpload() {
  const upload = useSnapbackAssetUpload({ upload: api.messageImageUpload });
  const [error, setError] = useState<string | null>(null);
  const progress = upload.state.totalBytes > 0 ? upload.state.bytesTransferred / upload.state.totalBytes : 0;
  return useMemo(() => ({
    state: {
      status: error ? 'error' as const : upload.state.status === 'idle' || upload.state.status === 'ready' ? 'idle' as const : 'uploading' as const,
      progress,
      error: error ?? upload.state.diagnostic?.message ?? null,
    },
    upload: async (input: { uri: string; mimeType: string; fileName: string }) => {
      setError(null);
      try {
        const response = await expoFetch(input.uri);
        const blob = await response.blob();
        const task = upload.start(blob, {
          declaredContentType: input.mimeType,
          declaredFilename: input.fileName,
          previewUrl: input.uri,
        }) as { done: Promise<{ status: string; assetId: string | null; diagnostic?: { message?: string } | null }> };
        const result = await task.done;
        if (result.status !== 'ready' || !result.assetId) {
          throw new Error(result.diagnostic?.message ?? 'Snapback could not finish the image upload.');
        }
        return result.assetId;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        throw cause;
      }
    },
  }), [error, progress, upload]);
}

export const backend: BackendHooks = {
  kind: 'snapback',
  label: 'Snapback',
  Root,
  useInbox,
  useConversation,
  useMessages,
  useTyping,
  useSendMessage,
  useToggleReaction,
  useImageUpload,
};
