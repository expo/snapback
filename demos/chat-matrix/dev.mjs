#!/usr/bin/env bun
// One-terminal dev environment for the chat matrix:
//   1. Snapback server (memory db) with the chat app mounted and the
//      OpenRouter key set via /_snapback/api/config/set (never in a bundle).
//   2. The gateway (models catalog + /rpc + AI worker for Supabase/SQLite),
//      pointed at the Snapback server.
// SNAPBACK_OUTBOUND_ACTIONS=1 lets the generateReply action fetch OpenRouter.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { SnapbackClient } from '../_kit/client.mjs';
import { startServer } from '../_kit/server-process.mjs';
import { loadOpenRouterKey } from './gateway/openrouter.ts';

const here = import.meta.dirname;
const repoRoot = resolve(here, '..', '..');
const backendDir = join(here, 'snapback');
const generated = (name) => JSON.parse(readFileSync(join(backendDir, 'generated', name), 'utf8'));

const port = Number(process.env.CHAT_MATRIX_SNAPBACK_PORT ?? 4434);
process.env.SNAPBACK_OUTBOUND_ACTIONS = '1';

let gateway = null;
const server = await startServer({
  port,
  db: ':memory:',
  cwd: repoRoot,
  provenance: { appId: 'chat-matrix', artifactsPath: join(backendDir, 'generated', 'artifacts.json') },
  // A backend that dies mid-session must take the dev environment down loudly
  // instead of leaving the gateway answering errors against a dead origin
  // (kit post-readiness watchdog, 2026-07-24). Never fires for a reused server.
  onUnexpectedExit: (exit) => {
    console.error(
      `[chat-matrix] snapback server died unexpectedly (${exit.signal ?? exit.code}); shutting down`,
    );
    gateway?.kill('SIGTERM');
    process.exit(1);
  },
});
const client = new SnapbackClient(server.baseUrl, server.clientOptions);
await client.ensureApp({
  schema: generated('schema.manifest.json'),
  functions: generated('functions.manifest.json'),
  seed: JSON.parse(readFileSync(join(backendDir, 'seed.json'), 'utf8')),
});
const configured = await fetch(`${server.baseUrl}/_snapback/api/config/set`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-snapback-admin-token': server.adminToken },
  body: JSON.stringify({ entry: 'openrouter', value: loadOpenRouterKey(), source: 'chat-matrix dev' }),
});
if (!configured.ok) throw new Error(`config/set failed: HTTP ${configured.status}`);
console.log(`[chat-matrix] snapback ready at ${server.baseUrl} (app mounted, openrouter key set)`);

gateway = spawn('bun', ['run', 'server.ts'], {
  cwd: join(here, 'gateway'),
  env: {
    ...process.env,
    CHAT_MATRIX_SNAPBACK_ORIGIN: server.baseUrl,
    CHAT_MATRIX_GATEWAY_PORT: process.env.CHAT_MATRIX_GATEWAY_PORT ?? '4470',
  },
  stdio: 'inherit',
});

const shutdown = async () => {
  gateway.kill('SIGTERM');
  await server.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
console.log('[chat-matrix] dev environment up — Ctrl-C to stop');
