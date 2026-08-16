#!/usr/bin/env node
// Local backend launcher for the media happy-path Expo acceptance vehicle.
// A phone-reachable bind is explicit and unsupported; loopback is the default.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SnapbackClient } from '@expo/snapback-client';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '@expo/snapback-contract';

import { MEDIA_POST_PERSONAS } from '../personas.mjs';
import api from '../snapback/generated/api.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, '..');
const repoRoot = resolve(appDir, '..', '..');
const generatedDir = join(appDir, 'snapback', 'generated');
const generated = (name) => JSON.parse(readFileSync(join(generatedDir, name), 'utf8'));
const port = Number(process.env.MEDIA_POST_PORT ?? 4431);
const stateDir = join(appDir, '.dev');
const dbPath = join(stateDir, 'media-happy-post.sqlite3');
const readyFile = join(stateDir, 'ready.json');

function lanAddress() {
  const candidates = Object.values(networkInterfaces()).flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address);
  const isCgnat = (address) => {
    const [first, second] = address.split('.').map(Number);
    return first === 100 && second >= 64 && second <= 127;
  };
  return candidates.find((address) => !isCgnat(address))
    ?? candidates[0]
    ?? '127.0.0.1';
}

function diagnosticCode(error) {
  return error && typeof error === 'object' && typeof error.code === 'string'
    ? error.code
    : null;
}

async function provisionPersona(origin, persona) {
  // Sessions signup needs the registered auth-coordinator composition; a bare
  // client's signup resolves to the admin-gated write path.
  const coordinator = new AuthCoordinator({
    appId: 'media-happy-post',
    storage: createMemoryAuthCustodyStorage({ state: { custody: {} } }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const client = new SnapbackClient(origin, {
    authCoordinator: coordinator,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    authorizedLeaseProtocol: 1,
    clientStoreId: `provision-${persona.email}`,
    rqsStore: null,
    offlineQueue: false,
  });
  try {
    try {
      await client.authPasswordSignup({ email: persona.email, password: persona.password });
    } catch (error) {
      if (diagnosticCode(error) !== 'SNAPBACK_AUTH_PASSWORD_EXISTS') throw error;
      await client.authPasswordSignIn({ email: persona.email, password: persona.password });
    }
    await client.mutate(api.ensureProfile, { args: { displayName: persona.displayName } });
    await client.authLogout();
  } finally {
    await client.closeAuth();
  }
}

mkdirSync(stateDir, { recursive: true });
if (process.argv.includes('--reset') && existsSync(dbPath)) rmSync(dbPath, { force: true });
if (existsSync(readyFile)) rmSync(readyFile, { force: true });

// Sessions-mode apps deploy through the exact startup-artifacts carrier; the
// raw dev loading route accepts only the snapback.v0-dev tuple.
const startupArtifacts = join(stateDir, 'startup-artifacts.json');
writeFileSync(
  startupArtifacts,
  `${JSON.stringify({
    formatVersion: 1,
    schema: generated('schema.manifest.json'),
    functions: generated('functions.manifest.json'),
  })}\n`,
  { mode: 0o600 },
);

// Loopback-only by default. Set MEDIA_POST_BIND_HOST=0.0.0.0 to reach it from
// a phone on the LAN (the same unsupported local-development trade-off as the
// Relay Room launcher).
const bindHost = process.env.MEDIA_POST_BIND_HOST ?? '127.0.0.1';
const publicHost = bindHost === '0.0.0.0' ? lanAddress() : bindHost;
const origin = `http://${publicHost}:${port}`;

if (bindHost !== '127.0.0.1') {
  console.warn(`[snapback] WARNING: bind address ${bindHost} exposes insecure dev auth; anyone on the network can assert any identity.`);
}

// Debug-build media finalization is ~10s per 12MP photo; prefer the release
// binary when present (or MEDIA_POST_SERVER_BINARY) for device sessions.
const releaseBinary = join(repoRoot, 'target', 'release', 'snapback');
const serverBinary = process.env.MEDIA_POST_SERVER_BINARY
  ?? (existsSync(releaseBinary) ? releaseBinary : join(repoRoot, 'target', 'debug', 'snapback'));
const child = spawn(serverBinary, [
  'start',
  '--host', bindHost,
  '--port', String(port),
  '--db', dbPath,
  '--allow-insecure-dev-auth',
  '--startup-artifacts', startupArtifacts,
  '--ready-file', readyFile,
], {
  cwd: repoRoot,
  stdio: ['ignore', 'inherit', 'inherit'],
  env: { ...process.env, SNAPBACK_PROFILE: 'dev' },
});

const provisioner = new SnapbackClient(origin, { rqsStore: null });
const deadline = Date.now() + 60_000;
for (;;) {
  try {
    await provisioner.health();
    break;
  } catch {
    if (Date.now() > deadline) {
      child.kill('SIGTERM');
      throw new Error('Snapback server did not become healthy in 60 seconds');
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
}

// The startup-artifacts carrier staged the sessions deployment before the
// listener bound; nothing to load over the raw dev route.
await provisioner.closeAuth();

for (const persona of MEDIA_POST_PERSONAS) {
  await provisionPersona(origin, persona);
}

console.log(`\nMedia Happy Post backend ready: ${origin}`);
console.log(`Test personas: ${MEDIA_POST_PERSONAS.map((persona) => persona.displayName).join(', ')}`);
console.log(`EXPO_PUBLIC_SNAPBACK_ORIGIN=${origin} bun run start\n`);

const shutdown = () => child.kill('SIGTERM');
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
child.on('exit', (code) => process.exit(code ?? 0));
