#!/usr/bin/env node
// Warble dev backend: boot the Snapback server, provision the app, and hold it
// open for the Expo client.
//
// A LAN bind is a deliberate, unsupported workaround. Snapback refuses
// client-asserted dev auth on a plaintext non-loopback listener unless you pass
// --allow-insecure-dev-auth, because dev auth trusts the caller's asserted
// identity. It is NEVER a production posture — the production profile rejects
// the flag outright.

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SnapbackClient } from '../../_kit/client.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, '..');
const repoRoot = resolve(appDir, '..', '..');
const generatedDir = join(appDir, 'snapback', 'generated');
const generated = (name) => JSON.parse(readFileSync(join(generatedDir, name), 'utf8'));

const PORT = Number(process.env.WARBLE_PORT ?? 4420);
const RESET = process.argv.includes('--reset');
const stateDir = join(appDir, '.dev');
const dbPath = join(stateDir, 'warble.sqlite3');
const readyFile = join(stateDir, 'ready.json');

// Prefer a real private-LAN address over CGNAT (100.64/10, which is what
// Tailscale hands out): a phone on the same Wi-Fi can reach the former, and
// the latter only works if the phone is also on the tailnet. WARBLE_HOST_IP
// overrides when you actually want the tailnet address.
function lanAddress() {
  if (process.env.WARBLE_HOST_IP) return process.env.WARBLE_HOST_IP;
  const candidates = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) candidates.push(entry.address);
    }
  }
  const isCgnat = (a) => {
    const [x, y] = a.split('.').map(Number);
    return x === 100 && y >= 64 && y <= 127;
  };
  return candidates.find((a) => !isCgnat(a)) ?? candidates[0] ?? '127.0.0.1';
}

mkdirSync(stateDir, { recursive: true });
if (RESET && existsSync(dbPath)) rmSync(dbPath, { force: true });
if (existsSync(readyFile)) rmSync(readyFile, { force: true });

const binary = process.env.SNAPBACK_SERVER_BINARY ?? join(repoRoot, 'target', 'debug', 'snapback');
// Loopback-only by default. Set WARBLE_HOST=0.0.0.0 to reach it from a phone on
// the LAN (same --allow-insecure-dev-auth trade-off Messaging makes).
const bindHost = process.env.WARBLE_HOST ?? '127.0.0.1';
const host = bindHost === '0.0.0.0' ? lanAddress() : bindHost;

if (bindHost !== '127.0.0.1') {
  console.warn(`[snapback] WARNING: bind address ${bindHost} exposes insecure dev auth; anyone on the network can assert any identity.`);
}

const child = spawn(binary, [
  '--host', bindHost,
  '--port', String(PORT),
  '--db', dbPath,
  '--allow-insecure-dev-auth',
  '--ready-file', readyFile,
], {
  cwd: repoRoot,
  stdio: ['ignore', 'inherit', 'inherit'],
  env: {
    ...process.env,
    // A non-loopback bind with SNAPBACK_PROFILE unset resolves to `prod`, and
    // the prod profile refuses dev auth outright — --allow-insecure-dev-auth
    // alone is NOT enough. Both are required, deliberately. Keep this pin
    // unconditional so loopback retains the launcher's existing explicit-dev
    // behavior rather than changing profile handling with the safer default.
    SNAPBACK_PROFILE: process.env.SNAPBACK_PROFILE ?? 'dev',
    DYLD_FRAMEWORK_PATH: join(repoRoot, 'vendor', 'ibex', 'ios', 'Frameworks'),
  },
});

child.on('exit', (code) => {
  console.error(`\n[warble] snapback exited with code ${code}`);
  process.exit(code ?? 1);
});

const origin = `http://${host}:${PORT}`;
const client = new SnapbackClient(origin, { rqsStore: null });

const deadline = Date.now() + 60_000;
for (;;) {
  try {
    await client.health();
    break;
  } catch (cause) {
    if (Date.now() > deadline) {
      console.error('[warble] server did not become healthy in 60s');
      child.kill();
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

// Idempotent: provisions only what is missing and seeds only empty tables, so
// restarting the dev server never wipes posts you made while playing with it.
await client.ensureApp({
  schema: generated('schema.manifest.json'),
  functions: generated('functions.manifest.json'),
  seed: JSON.parse(readFileSync(join(appDir, 'snapback', 'seed.json'), 'utf8')),
});

console.log('');
console.log('  ┌─────────────────────────────────────────────────');
console.log('  │  Warble backend ready');
console.log(`  │  origin   ${origin}`);
console.log(`  │  db       ${dbPath}`);
console.log('  │  auth     dev (client-asserted)');
console.log('  └─────────────────────────────────────────────────');
console.log('');
console.log(`  Point the app at it:  EXPO_PUBLIC_SNAPBACK_ORIGIN=${origin}`);
console.log('');

const shutdown = () => { child.kill(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
