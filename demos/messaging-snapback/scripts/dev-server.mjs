#!/usr/bin/env node
// Snapback Messenger dev backend: boot the server, provision the app,
// seed two demo images, and hold it open for the Expo client.

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SnapbackClient } from '../../../packages/snapback-client/index.mjs';
import { seedImages } from './seed-images.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, '..');
const repoRoot = resolve(appDir, '..', '..');
const generatedDir = join(appDir, 'snapback', 'generated');
const generated = (name) => JSON.parse(readFileSync(join(generatedDir, name), 'utf8'));

const PORT = Number(process.env.MESSAGING_PORT ?? 4421);
const RESET = process.argv.includes('--reset');
const stateDir = join(appDir, '.dev');
const dbPath = join(stateDir, 'messaging.sqlite3');
const readyFile = join(stateDir, 'ready.json');

mkdirSync(stateDir, { recursive: true });
if (RESET && existsSync(dbPath)) rmSync(dbPath, { force: true });
if (existsSync(readyFile)) rmSync(readyFile, { force: true });

const binary = process.env.SNAPBACK_SERVER_BINARY ?? join(repoRoot, 'target', 'debug', 'snapback');
// Loopback-only by default. Set MESSAGING_HOST=0.0.0.0 to reach it from a
// phone on the LAN (same --allow-insecure-dev-auth trade-off Warble makes).
const bindHost = process.env.MESSAGING_HOST ?? '127.0.0.1';

const child = spawn(binary, [
  'start',
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
    SNAPBACK_PROFILE: process.env.SNAPBACK_PROFILE ?? 'dev',
    DYLD_FRAMEWORK_PATH: join(repoRoot, 'vendor', 'ibex', 'ios', 'Frameworks'),
  },
});

child.on('exit', (code) => {
  console.error(`\n[messaging] snapback exited with code ${code}`);
  process.exit(code ?? 1);
});

const origin = `http://${bindHost}:${PORT}`;
const client = new SnapbackClient(origin, { rqsStore: null });

const deadline = Date.now() + 60_000;
for (;;) {
  try {
    await client.health();
    break;
  } catch (cause) {
    if (Date.now() > deadline) {
      console.error('[messaging] server did not become healthy in 60s');
      child.kill();
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

// Idempotent: provisions only what is missing, seeds only empty tables.
await client.ensureApp({
  schema: generated('schema.manifest.json'),
  functions: generated('functions.manifest.json'),
  seed: JSON.parse(readFileSync(join(appDir, 'snapback', 'seed.json'), 'utf8')),
});

const adminToken = readFileSync(`${dbPath}.admin-token`, 'utf8').trim();
await seedImages(origin, { binary, adminToken });
await client.closeAuth();

console.log('');
console.log('  ┌─────────────────────────────────────────────────');
console.log('  │  Snapback Messenger backend ready');
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
