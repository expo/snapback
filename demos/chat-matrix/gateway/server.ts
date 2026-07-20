// Chat matrix gateway. Three jobs:
//  1. /models — the OpenRouter catalog for every cell's model picker (the key
//     stays here; clients never see it).
//  2. /rpc — a portable query/mutation surface over all four backends, used by
//     the SQLite cells (its only door), the Exact provider, and anything that
//     cannot speak a backend's native client.
//  3. The AI worker for Supabase + SQLite (backends with no function runtime).
// Snapback and Convex generate replies inside their own action runtimes; their
// /rpc sendMessage just forwards and triggers.

import { resolve } from 'node:path';

import { SnapbackClient } from '../../_kit/client.mjs';
import { loadLocalSecrets, requireSecret } from '../../partiful-matrix/backends/gateway/secrets.mjs';
import { convexDeploymentUrl } from '../../partiful-matrix/backends/gateway/convex.ts';
import api from '../snapback/generated/api.mjs';
import { FEATURED_MODELS } from '../shared/model.ts';
import { listModels } from './openrouter.ts';
import { createSqliteChatAdapter } from './sqlite.ts';
import { createSupabaseChatAdapter } from './supabase.ts';
import { startAiWorker } from './worker.ts';

const repoRoot = resolve(import.meta.dirname, '..', '..', '..');
const secrets = loadLocalSecrets(repoRoot);
const now = () => Date.now();

// --- SQLite (always available) ------------------------------------------------
const sqlite = createSqliteChatAdapter(
  process.env.CHAT_MATRIX_SQLITE_PATH ?? resolve(import.meta.dirname, 'chat-matrix.sqlite'),
);

// --- Supabase (remote; optional) ----------------------------------------------
let supabase: Awaited<ReturnType<typeof createSupabaseChatAdapter>> | null = null;
try {
  supabase = await createSupabaseChatAdapter(requireSecret(secrets, 'DIRECT_URL', 'DATABASE_URL', 'SUPABASE_DB_URL'));
} catch (error) {
  console.error('[chat-matrix] supabase unavailable:', (error as Error).message);
}

// --- Convex (remote; optional) --------------------------------------------------
const convexUrl = (() => {
  try { return convexDeploymentUrl(requireSecret(secrets, 'CONVEX_DEPLOY_KEY')); }
  catch { return process.env.CONVEX_URL ?? null; }
})();
const convexCall = async (kind: 'query' | 'mutation', path: string, args: Record<string, unknown>) => {
  const response = await fetch(`${convexUrl}/api/${kind}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, args, format: 'json' }),
  });
  const payload = await response.json() as { status: string; value?: unknown; errorMessage?: string };
  if (payload.status !== 'success') throw new Error(payload.errorMessage ?? `convex ${path} failed`);
  return payload.value;
};

// --- Snapback (local server launched by dev.mjs; optional) ---------------------
const snapbackOrigin = process.env.CHAT_MATRIX_SNAPBACK_ORIGIN ?? null;
const snapback = snapbackOrigin ? new SnapbackClient(snapbackOrigin) : null;

type Rpc = { op: string; args: Record<string, any> };

async function rpc(backend: string, { op, args }: Rpc): Promise<unknown> {
  if (backend === 'sqlite' || backend === 'supabase') {
    const adapter = backend === 'sqlite' ? sqlite : supabase;
    if (!adapter) throw new Error(`${backend} unavailable`);
    if (op === 'listConversations') return adapter.listConversations();
    if (op === 'createConversation') return adapter.createConversation(args.model, args.title, now());
    if (op === 'listMessages') return adapter.listMessages(args.conversationId);
    if (op === 'sendMessage') return adapter.sendMessage(args.conversationId, args.content, now());
  }
  if (backend === 'convex') {
    if (!convexUrl) throw new Error('convex unavailable');
    if (op === 'listConversations') return convexCall('query', 'chat:listConversations', {});
    if (op === 'createConversation') return convexCall('mutation', 'chat:createConversation', { title: args.title, model: args.model, createdAt: now() });
    if (op === 'listMessages') return convexCall('query', 'chat:thread', { conversationId: args.conversationId });
    if (op === 'sendMessage') return convexCall('mutation', 'chat:sendMessage', { conversationId: args.conversationId, content: args.content, createdAt: now() });
  }
  if (backend === 'snapback') {
    if (!snapback) throw new Error('snapback unavailable (set CHAT_MATRIX_SNAPBACK_ORIGIN)');
    const userId = 'user_chat';
    if (op === 'listConversations') return (await snapback.query(api.listConversations, { userId })).rows;
    if (op === 'createConversation') {
      const result = await snapback.mutate(api.createConversation, { args: { title: args.title, model: args.model, createdAt: now() }, userId });
      return (result.result as { conversationId: string }).conversationId;
    }
    if (op === 'listMessages') return (await snapback.query(api.thread, { args: { conversationId: args.conversationId }, userId })).rows;
    if (op === 'sendMessage') {
      const result = await snapback.mutate(api.sendMessage, { args: { conversationId: args.conversationId, content: args.content, createdAt: now() }, userId });
      const assistantMessageId = (result.result as { assistantMessageId: string }).assistantMessageId;
      void snapback.action('generateReply', { args: { messageId: assistantMessageId }, userId })
        .catch((error: unknown) => console.error('[chat-matrix] snapback generateReply failed:', error));
      return assistantMessageId;
    }
  }
  throw new Error(`unsupported rpc: ${backend}.${op}`);
}

const workerAdapters = [sqlite, ...(supabase ? [supabase] : [])];
const worker = startAiWorker(workerAdapters);

const headers = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'content-type': 'application/json',
};

const port = Number(process.env.CHAT_MATRIX_GATEWAY_PORT ?? 4470);
const server = Bun.serve({
  hostname: process.env.CHAT_MATRIX_GATEWAY_HOST ?? '0.0.0.0',
  port,
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const url = new URL(request.url);
    try {
      if (url.pathname === '/health') {
        return Response.json({
          ok: true,
          backends: {
            sqlite: true,
            supabase: supabase !== null,
            convex: convexUrl !== null,
            snapback: snapback !== null,
          },
          // Service discovery: the _kit server harness assigns an isolated OS
          // port on each boot, so clients that speak to Snapback directly
          // (the idiomatic cells) look the current origin up here.
          snapbackOrigin,
          supabaseUrl: process.env.SUPABASE_URL ?? secrets.SUPABASE_URL ?? null,
          convexUrl,
        }, { headers });
      }
      if (url.pathname === '/models') {
        const models = await listModels();
        return Response.json({ featured: FEATURED_MODELS, models }, { headers });
      }
      if (url.pathname === '/rpc' && request.method === 'POST') {
        const body = await request.json() as { backend: string } & Rpc;
        const value = await rpc(body.backend, body);
        return Response.json({ ok: true, value }, { headers });
      }
    } catch (error) {
      return Response.json({ ok: false, error: String((error as Error).message ?? error) }, { status: 400, headers });
    }
    return Response.json({ error: 'not found' }, { status: 404, headers });
  },
});

console.log(`[chat-matrix] gateway ready on http://${server.hostname}:${server.port}`);

const close = async () => {
  server.stop(true);
  await worker.stop();
  await sqlite.close();
  await supabase?.close();
};
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
