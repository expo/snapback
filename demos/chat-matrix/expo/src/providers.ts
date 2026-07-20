// One ChatSession implementation per backend, each using that backend's
// idiomatic client and realtime mechanism:
//   snapback — @snapback/client live query (WebSocket push, poll fallback)
//   convex   — ConvexClient reactive subscription (WebSocket)
//   supabase — supabase-js + Realtime postgres_changes
//   sqlite   — gateway HTTP + 700ms poll (its only door)
// The AI reply is server-side everywhere; these sessions just watch rows.

import { ConvexClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

import { SnapbackClient } from '../../../../packages/snapback-client/index.mjs';
import snapbackApi from '../../snapback/generated/api.mjs';
import type { Backend, MessageRow } from '../../shared/model';
import { CONVEX_URL, GATEWAY_ORIGIN, SNAPBACK_ORIGIN, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config';

export type Transport = 'push' | 'poll' | 'connecting' | 'error';

export interface ChatSession {
  readonly backend: Backend;
  createConversation(model: string, title: string): Promise<string>;
  sendMessage(conversationId: string, content: string): Promise<void>;
  /** Subscribe to a conversation's messages; emits on every change. */
  subscribe(
    conversationId: string,
    onRows: (rows: MessageRow[], transport: Transport) => void,
  ): () => void;
  dispose(): void;
}

async function gatewayRpc<T>(backend: string, op: string, args: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(`${GATEWAY_ORIGIN}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ backend, op, args }),
  });
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.error ?? `${backend}.${op} failed`);
  return payload.value as T;
}

// --- SQLite ---------------------------------------------------------------

function createSqliteSession(): ChatSession {
  return {
    backend: 'sqlite',
    createConversation: (model, title) => gatewayRpc('sqlite', 'createConversation', { model, title }),
    async sendMessage(conversationId, content) {
      await gatewayRpc('sqlite', 'sendMessage', { conversationId, content });
    },
    subscribe(conversationId, onRows) {
      let disposed = false;
      let fingerprint = '';
      const poll = async () => {
        if (disposed) return;
        try {
          const rows = await gatewayRpc<MessageRow[]>('sqlite', 'listMessages', { conversationId });
          const next = JSON.stringify(rows);
          if (next !== fingerprint) {
            fingerprint = next;
            onRows(rows, 'poll');
          }
        } catch {
          onRows([], 'error');
        }
        if (!disposed) setTimeout(poll, 700);
      };
      void poll();
      return () => { disposed = true; };
    },
    dispose() {},
  };
}

// --- Supabase -------------------------------------------------------------

function createSupabaseSession(): ChatSession {
  const client = createSupabaseClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  const rowToMessage = (row: Record<string, unknown>): MessageRow => ({
    _id: String(row.id),
    conversationId: String(row.conversation_id),
    role: row.role as MessageRow['role'],
    content: String(row.content),
    status: row.status as MessageRow['status'],
    createdAt: Number(row.created_at),
  });
  return {
    backend: 'supabase',
    async createConversation(model, title) {
      const id = `conv_${randomId()}`;
      const { error } = await client.from('chat_matrix_conversations').insert({ id, title, model, created_at: Date.now() });
      if (error) throw new Error(error.message);
      return id;
    },
    async sendMessage(conversationId, content) {
      const createdAt = Date.now();
      const user = { id: `msg_${randomId()}`, conversation_id: conversationId, role: 'user', content, status: 'complete', created_at: createdAt };
      const assistant = { id: `msg_${randomId()}`, conversation_id: conversationId, role: 'assistant', content: '', status: 'pending', created_at: createdAt + 1 };
      const { error } = await client.from('chat_matrix_messages').insert([user, assistant]);
      if (error) throw new Error(error.message);
    },
    subscribe(conversationId, onRows) {
      let disposed = false;
      let transport: Transport = 'connecting';
      const refetch = async () => {
        const { data, error } = await client
          .from('chat_matrix_messages')
          .select('*')
          .eq('conversation_id', conversationId)
          .order('created_at');
        if (disposed) return;
        if (error) onRows([], 'error');
        else onRows((data ?? []).map(rowToMessage), transport);
      };
      const channel = client
        .channel(`chat_${conversationId}`)
        .on('postgres_changes', {
          event: '*', schema: 'public', table: 'chat_matrix_messages',
          filter: `conversation_id=eq.${conversationId}`,
        }, () => { void refetch(); })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') { transport = 'push'; void refetch(); }
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { transport = 'error'; }
        });
      void refetch();
      return () => { disposed = true; void client.removeChannel(channel); };
    },
    dispose() { void client.removeAllChannels(); },
  };
}

// --- Convex ---------------------------------------------------------------

const convexThread = makeFunctionReference<'query'>('chat:thread');
const convexCreate = makeFunctionReference<'mutation'>('chat:createConversation');
const convexSend = makeFunctionReference<'mutation'>('chat:sendMessage');

function createConvexSession(): ChatSession {
  const client = new ConvexClient(CONVEX_URL);
  return {
    backend: 'convex',
    createConversation: (model, title) =>
      client.mutation(convexCreate, { title, model, createdAt: Date.now() }) as Promise<string>,
    async sendMessage(conversationId, content) {
      await client.mutation(convexSend, { conversationId, content, createdAt: Date.now() });
    },
    subscribe(conversationId, onRows) {
      const unsubscribe = client.onUpdate(convexThread, { conversationId }, (rows) => {
        onRows(rows as MessageRow[], 'push');
      });
      return unsubscribe;
    },
    dispose() { void client.close(); },
  };
}

// --- Snapback -------------------------------------------------------------

// The Snapback dev server boots on an isolated OS-assigned port; discover the
// current origin from the gateway's /health before connecting directly.
async function discoverSnapbackOrigin(): Promise<string> {
  try {
    const response = await fetch(`${GATEWAY_ORIGIN}/health`);
    const health = await response.json();
    if (typeof health.snapbackOrigin === 'string' && health.snapbackOrigin) return health.snapbackOrigin;
  } catch { /* fall through to the configured default */ }
  return SNAPBACK_ORIGIN;
}

function createSnapbackSession(): ChatSession {
  const clientPromise = discoverSnapbackOrigin().then((origin) => new SnapbackClient(origin));
  const userId = 'user_chat';
  let counter = 0;
  return {
    backend: 'snapback',
    async createConversation(model, title) {
      const client = await clientPromise;
      const result = await client.mutate(snapbackApi.createConversation, {
        args: { title, model, createdAt: Date.now() }, userId,
      });
      return (result.result as { conversationId: string }).conversationId;
    },
    async sendMessage(conversationId, content) {
      const client = await clientPromise;
      const result = await client.mutate(snapbackApi.sendMessage, {
        args: { conversationId, content, createdAt: Date.now() }, userId,
      });
      const assistantMessageId = (result.result as { assistantMessageId: string }).assistantMessageId;
      // The AI call is a Snapback ACTION on the server; fire and forget — the
      // live query below streams its commits back.
      void client.action('generateReply', { args: { messageId: assistantMessageId }, userId })
        .catch((error: unknown) => console.warn('generateReply failed', error));
    },
    subscribe(conversationId, onRows) {
      let disposed = false;
      let handle: { dispose(): void } | null = null;
      void clientPromise.then((client) => client.liveQuery(snapbackApi.thread, {
        args: { conversationId },
        userId,
        transport: 'stream',
        fallbackToPoll: true,
        connectionId: `chat_matrix_expo_${counter += 1}`,
        onUpdate: (rows: MessageRow[]) => { if (!disposed) onRows(rows, 'push'); },
        onConnectionChange: (connection: string) => {
          if (!disposed && connection === 'stale') onRows([], 'connecting');
        },
      })).then((next: { rows: MessageRow[]; dispose(): void }) => {
        if (disposed) { next.dispose(); return; }
        handle = next;
        onRows(next.rows, 'push');
      }).catch(() => { if (!disposed) onRows([], 'error'); });
      return () => { disposed = true; handle?.dispose(); };
    },
    dispose() {},
  };
}

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function createChatSession(backend: Backend): ChatSession {
  if (backend === 'sqlite') return createSqliteSession();
  if (backend === 'supabase') return createSupabaseSession();
  if (backend === 'convex') return createConvexSession();
  return createSnapbackSession();
}

export async function fetchModelCatalog(): Promise<{ featured: readonly string[]; models: { id: string; name: string }[] }> {
  const response = await fetch(`${GATEWAY_ORIGIN}/models`);
  if (!response.ok) throw new Error(`models: HTTP ${response.status}`);
  return response.json();
}
