#!/usr/bin/env node
// Snapback dev backend for Relay Room. Its opt-in phone-reachable mode is an
// unsupported workaround that deliberately defeats two fences: SNAPBACK_PROFILE=dev
// overrides the non-loopback production fallback, and --allow-insecure-dev-auth
// permits client-asserted identity on plaintext LAN transport. Do not copy this
// launcher as a carrier or production pattern. It remains loopback-only by default.
// The launcher uses client provisioning instead of the packaged managed dev loop
// because the current wrapper cannot parse native `load`'s two JSON result documents.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SnapbackClient } from '@expo/snapback-client';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, '..');
const repoRoot = resolve(appDir, '..', '..', '..');
const generatedDir = join(appDir, 'snapback', 'generated');
const generated = (name) => JSON.parse(readFileSync(join(generatedDir, name), 'utf8'));
const port = Number(process.env.RELAY_ROOM_PORT ?? 4425);
const stateDir = join(appDir, '.dev');
const dbPath = join(stateDir, 'relay-room.sqlite3');
const readyFile = join(stateDir, 'ready.json');

function lanAddress() {
  const candidates = Object.values(networkInterfaces()).flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address);
  const isCgnat = (address) => {
    const [first, second] = address.split('.').map(Number);
    return first === 100 && second >= 64 && second <= 127;
  };
  return process.env.RELAY_ROOM_HOST_IP
    ?? candidates.find((address) => !isCgnat(address))
    ?? candidates[0]
    ?? '127.0.0.1';
}

mkdirSync(stateDir, { recursive: true });
if (process.argv.includes('--reset') && existsSync(dbPath)) rmSync(dbPath, { force: true });
if (existsSync(readyFile)) rmSync(readyFile, { force: true });

// Loopback-only by default. Set RELAY_ROOM_BIND_HOST=0.0.0.0 to reach it from a
// phone on the LAN (same --allow-insecure-dev-auth trade-off Warble makes).
const bindHost = process.env.RELAY_ROOM_BIND_HOST ?? '127.0.0.1';
const publicHost = bindHost === '0.0.0.0' ? lanAddress() : bindHost;
const origin = `http://${publicHost}:${port}`;

if (bindHost !== '127.0.0.1') {
  console.warn(`[snapback] WARNING: bind address ${bindHost} exposes insecure dev auth; anyone on the network can assert any identity.`);
}

const child = spawn(join(repoRoot, 'target', 'debug', 'snapback'), [
  '--host', bindHost,
  '--port', String(port),
  '--db', dbPath,
  '--allow-insecure-dev-auth',
  '--ready-file', readyFile,
], {
  cwd: repoRoot,
  stdio: ['ignore', 'inherit', 'inherit'],
  env: { ...process.env, SNAPBACK_PROFILE: 'dev' },
});

const client = new SnapbackClient(origin, { rqsStore: null });
const deadline = Date.now() + 60_000;
for (;;) {
  try {
    await client.health();
    break;
  } catch {
    if (Date.now() > deadline) throw new Error('Snapback server did not become healthy in 60 seconds');
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
}

await client.ensureApp({
  schema: generated('schema.manifest.json'),
  functions: generated('functions.manifest.json'),
  seed: JSON.parse(readFileSync(join(appDir, 'snapback', 'seed.json'), 'utf8')),
});

console.log(`\nRelay Room backend ready: ${origin}`);
console.log(`EXPO_PUBLIC_SNAPBACK_ORIGIN=${origin} bun run start\n`);

const shutdown = () => child.kill('SIGTERM');
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
child.on('exit', (code) => process.exit(code ?? 0));
