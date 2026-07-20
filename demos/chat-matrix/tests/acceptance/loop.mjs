#!/usr/bin/env node
// Headless chat-matrix acceptance: for each backend, create a conversation
// through the gateway's portable /rpc surface, send one message, and require
// the assistant row to reach 'complete' with non-error content. Assumes the
// dev environment is up (`bun demos/chat-matrix/dev.mjs`); remote backends
// that are down are recorded as remote-dependency skips.

import { createSuite, runAcceptance } from '../../../_kit/harness.mjs';

const GATEWAY = process.env.CHAT_MATRIX_GATEWAY ?? 'http://127.0.0.1:4470';
const MODEL = process.env.CHAT_MATRIX_ACCEPTANCE_MODEL ?? 'anthropic/claude-haiku-4.5';
const BACKENDS = ['sqlite', 'snapback', 'convex', 'supabase'];
const option = (name) => { const at = process.argv.indexOf(`--${name}`); return at < 0 ? null : process.argv[at + 1]; };
const receiptFile = option('receipt');

const suite = createSuite('chat-matrix / four-backend AI loop', { expectedChecks: BACKENDS.length + 1 });

async function rpc(backend, op, args = {}) {
  const response = await fetch(`${GATEWAY}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ backend, op, args }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.error ?? `${backend}.${op} failed`);
  return payload.value;
}

let health = null;
try {
  health = await (await fetch(`${GATEWAY}/health`, { signal: AbortSignal.timeout(3_000) })).json();
} catch {
  console.error(`SKIP chat-matrix loop — gateway unreachable at ${GATEWAY}; start bun demos/chat-matrix/dev.mjs first`);
  for (const name of ['gateway serves the model catalog', ...BACKENDS.map((backend) => `${backend} completes send → assistant reply`)]) {
    suite.skip(name, { skipClass: 'required-local-dependency', gateway: GATEWAY });
  }
  await runAcceptance(suite, async () => {}, { reportFile: receiptFile });
  process.exit(1);
}

await runAcceptance(suite, async () => {
  await suite.check('gateway serves the model catalog', async () => {
    const catalog = await (await fetch(`${GATEWAY}/models`)).json();
    if (!Array.isArray(catalog.models) || catalog.models.length < 10) throw new Error(`catalog too small: ${catalog.models?.length}`);
    if (!catalog.featured.includes(MODEL)) throw new Error(`featured list missing ${MODEL}`);
    return { models: catalog.models.length };
  });

  for (const backend of BACKENDS) {
    const name = `${backend} completes send → assistant reply`;
    if (health.backends?.[backend] !== true) {
      suite.skip(name, { skipClass: 'remote-dependency', backend, health: health.backends?.[backend] ?? null });
      continue;
    }
    await suite.check(name, async () => {
      const conversationId = await rpc(backend, 'createConversation', { model: MODEL, title: '[acceptance] chat loop' });
      await rpc(backend, 'sendMessage', { conversationId, content: 'Reply with exactly the word: pong' });
      const startedAt = Date.now();
      while (Date.now() - startedAt < 60_000) {
        await new Promise((resolveSleep) => setTimeout(resolveSleep, 700));
        const messages = await rpc(backend, 'listMessages', { conversationId });
        const assistant = messages.find((message) => message.role === 'assistant');
        if (assistant?.status === 'complete') {
          if (assistant.content.trim().length === 0) throw new Error('assistant reply is empty');
          return { latencyMs: Date.now() - startedAt, reply: assistant.content.slice(0, 60) };
        }
        if (assistant?.status === 'error') throw new Error(`assistant errored: ${assistant.content.slice(0, 200)}`);
      }
      throw new Error('assistant reply did not complete within 60s');
    });
  }
}, { reportFile: receiptFile });
