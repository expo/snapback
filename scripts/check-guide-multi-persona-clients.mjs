#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// @ref LLP 0061#3-verification-snippets-that-ran — the Guide transcludes the
// exact multi-persona helper, and this check typechecks and runs it against
// npm-packed public package bytes.
// @ref LLP 0295#program-invariant-vertical-paved-path-coherence — the packed
// fixture binds Guide spelling, root import, durable client behavior, and the
// negative diagnostic into one external-consumer receipt.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRelative = 'tests/fixtures/guide-multi-persona-clients/multi-persona-clients.mts';
const fixtureDirectory = join(root, dirname(fixtureRelative));
const fixtureSource = readFileSync(join(root, fixtureRelative), 'utf8');
const guideSource = readFileSync(join(root, 'guide/recipes/multi-persona-clients.md'), 'utf8');
const exactFence = `\`\`\`ts source=${fixtureRelative}\n${fixtureSource}\`\`\``;
assert(
  guideSource.includes(exactFence),
  'multi-persona recipe must transclude the exact packed fixture',
);

const tsc = join(root, 'node_modules/.bin/tsc');
assert(existsSync(tsc), 'locked TypeScript is missing; run `bun install --frozen-lockfile`');
const fakeIndexedDbPackage = join(root, 'node_modules/fake-indexeddb');
assert(existsSync(fakeIndexedDbPackage), 'locked fake-indexeddb is missing; run `bun install --frozen-lockfile`');

const scratch = mkdtempSync(join(tmpdir(), 'snapback-guide-multi-persona-'));
const tarballDirectory = join(scratch, 'tarballs');
const scaffold = join(scratch, 'scaffold');
const npmCache = join(scratch, 'npm-cache');

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function packInto(packageDirectory) {
  const output = run(
    'npm',
    ['pack', '--json', '--ignore-scripts', '--pack-destination', tarballDirectory],
    {
      cwd: packageDirectory,
      env: { ...process.env, npm_config_cache: npmCache },
    },
  );
  const records = JSON.parse(output);
  assert.equal(records.length, 1, `npm pack returned ${records.length} records`);
  return join(tarballDirectory, records[0].filename);
}

function installPacked(packageName, tarball) {
  const target = join(scaffold, 'node_modules', ...packageName.split('/'));
  mkdirSync(target, { recursive: true });
  run('tar', ['-xzf', tarball, '--strip-components=1', '-C', target]);
}

try {
  mkdirSync(tarballDirectory, { recursive: true });
  mkdirSync(scaffold, { recursive: true });
  writeFileSync(join(scaffold, 'package.json'), '{"private":true,"type":"module"}\n');
  cpSync(fixtureDirectory, scaffold, { recursive: true });

  installPacked(
    '@expo/snapback-contract',
    packInto(join(root, 'packages/snapback-contract')),
  );
  installPacked(
    '@expo/snapback-client',
    packInto(join(root, 'packages/snapback-client')),
  );
  installPacked('fake-indexeddb', packInto(fakeIndexedDbPackage));

  run(tsc, [
    '--noEmit',
    '--strict',
    '--target', 'es2022',
    '--module', 'nodenext',
    '--moduleResolution', 'nodenext',
    '--lib', 'es2022,dom',
    join(scaffold, 'multi-persona-clients.mts'),
  ], { cwd: scaffold });

  const runtimeProbe = join(scaffold, 'packed-multi-persona-runtime.mjs');
  writeFileSync(runtimeProbe, `
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import {
  DEFAULT_AUTH_STORAGE_PARTITION,
  createSnapbackAppClient,
} from '@expo/snapback-client';
import { createAcceptancePersonas } from './multi-persona-clients.mts';

process.env.SNAPBACK_CLIENT_RQS_STORE = 'off';

const APP_ID = '018f0d90-7c20-7a22-8c33-445566778899';
const INCARNATION = '018f0d90-7c21-7a22-8c33-445566778899';
const USERS = {
  'henry@example.com': '018f0d90-7c22-7a22-8c33-445566778899',
  'mia@example.com': '018f0d90-7c23-7a22-8c33-445566778899',
};
const bearers = new Map();
let serial = 0;

const app = Object.freeze({
  format: 'snapback.app.v1',
  identity: Object.freeze({
    app: APP_ID,
    schema: 'sha256:schema',
    functions: 'sha256:functions',
    descriptor: 'sha256:descriptor',
  }),
  authBootstrap: Object.freeze({
    format: 'snapback.application-auth-bootstrap.v1',
    appId: APP_ID,
    mode: 'sessions',
    custody: 'durable-required',
    entryMechanisms: Object.freeze(['password-v1']),
    anonymousPublic: 'refused',
    lifecycleProtocol: 1,
  }),
});
const binding = Object.freeze({
  format: 'snapback.app-binding.v1',
  source: 'supervised-dev',
  descriptorIdentity: app.identity.descriptor,
  target: Object.freeze({
    app: APP_ID,
    schema: app.identity.schema,
    functions: app.identity.functions,
    origin: 'http://127.0.0.1:4711',
    routing: 'loopback',
  }),
  capabilities: Object.freeze({
    offered: Object.freeze(['auth.application-bootstrap.v1', 'auth.passwords']),
  }),
  provenance: Object.freeze({
    supervisorGeneration: 'packed-fixture',
    issuedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  }),
  integrity: Object.freeze({ channel: 'local-supervised-ipc' }),
});
const platform = Object.freeze({
  kind: 'browser',
  indexedDB: new IDBFactory(),
  lockManager: Object.freeze({ request: (_name, _options, operation) => operation() }),
  cryptoObject: webcrypto,
  databaseName: 'snapback-packed-multi-persona',
  broadcastChannelFactory: null,
  hintStorage: null,
});

const deploymentIdentity = Object.freeze({
  schemaVersion: 'snapback.v1',
  authMode: 'sessions',
  appId: APP_ID,
  schemaHash: \`snapback.v1:sessions:schema:sha256:\${'1'.repeat(64)}\`,
  bundleHash: \`snapback.v1:sessions:function:sha256:\${'2'.repeat(64)}\`,
  inputsHash: \`snapback.v1:sessions:inputs:sha256:\${'3'.repeat(64)}\`,
});
const handshake = (bearer) => {
  const authenticated = bearers.get(bearer) ?? null;
  return {
    protocolVersion: 1,
    serverStartupNonce: 'packed-multi-persona',
    authorizationStreamIncarnation: INCARNATION,
    transitionGeneration: 0,
    activeMode: 'sessions',
    desiredMode: 'sessions',
    modeState: 'settled',
    appDataAvailability: 'available',
    quarantineCode: null,
    clientProtocols: {
      authClient: 1,
      authInvalidation: null,
      authorityDescriptor: 1,
      authorizedLease: null,
    },
    availability: {
      onlineRequestResponse: { available: true, reason: null },
      authScopedLive: { available: false, minimumAuthInvalidationProtocol: 1, reason: 'SNAPBACK_AUTH_INVALIDATION_PROTOCOL_REQUIRED' },
      retainedReads: { available: false, minimumAuthInvalidationProtocol: 1, minimumAuthorizedLeaseProtocol: 1, reason: 'SNAPBACK_AUTH_RETAINED_READS_UNAVAILABLE' },
      queuedReplay: { available: true, minimumAuthorityDescriptorProtocol: 1, reason: null },
    },
    provider: { key: 'local-password', available: true },
    transports: ['bearer'],
    authority: authenticated === null
      ? { kind: 'anonymous', userId: null, sessionId: null, isAuthenticated: false }
      : { kind: 'humanSession', userId: authenticated.userId, sessionId: authenticated.sessionId, isAuthenticated: true },
    authorityDescriptor: {
      descriptorVersion: 1,
      authorityInstanceId: authenticated?.authorityInstanceId ?? INCARNATION,
      sessionGeneration: authenticated === null ? 0 : 1,
    },
    deploymentIdentity,
    authorizedLease: null,
  };
};

globalThis.fetch = async (url, init = {}) => {
  const path = new URL(url).pathname;
  const headers = new Headers(init.headers);
  const bearer = headers.get('authorization')?.replace(/^Bearer /u, '') ?? null;
  if (path === '/auth/session') return Response.json(handshake(bearer));
  if (path !== '/auth/password/signup') throw new Error(\`unexpected packed request: \${path}\`);
  const body = JSON.parse(init.body);
  serial += 1;
  const userId = USERS[body.email];
  const token = \`packed-bearer-\${serial}\`;
  const sessionId = \`018f0d90-7c2\${serial}-7a22-8c33-445566778899\`;
  const authorityInstanceId = \`018f0d90-7c3\${serial}-7a22-8c33-445566778899\`;
  bearers.set(token, { userId, sessionId, authorityInstanceId });
  return Response.json({
    tokenType: 'Bearer',
    token,
    refreshAfter: Date.now() + 60_000,
    session: { id: sessionId, userId, provider: 'local-password', createdAt: Date.now(), expiresAt: Date.now() + 120_000, absoluteExpiresAt: Date.now() + 240_000 },
    authorityDescriptor: { descriptorVersion: 1, authorityInstanceId, sessionGeneration: 1 },
    recoveryCodes: Array.from({ length: 8 }, (_, index) => \`sbrv1_\${String(index).padStart(2, '0')}\${'R'.repeat(25)}\`),
  });
};

assert.equal(DEFAULT_AUTH_STORAGE_PARTITION, 'default');
const input = { app, binding, platform };
const { henry, mia } = await createAcceptancePersonas(input, 'worker-7');
await henry.auth.signUpWithPassword({ email: 'henry@example.com', password: 'packed-password-12' });
await mia.auth.signUpWithPassword({ email: 'mia@example.com', password: 'packed-password-12' });
assert.equal(henry.auth.currentPrincipal().userId, USERS['henry@example.com']);
assert.equal(mia.auth.currentPrincipal().userId, USERS['mia@example.com']);
assert.notEqual(henry.client, mia.client);
await henry.dispose();
await mia.dispose();

const firstDefault = await createSnapbackAppClient(input);
await firstDefault.auth.signUpWithPassword({ email: 'henry@example.com', password: 'packed-password-12' });
const secondDefault = await createSnapbackAppClient(input);
const thirdDefault = await createSnapbackAppClient(input);
assert.equal(firstDefault.client, secondDefault.client);
assert.equal(secondDefault.auth.currentPrincipal().userId, USERS['henry@example.com']);
const warnings = firstDefault.client.diagnosticsChannel().snapshot().events.filter(
  ({ code }) => code === 'SNAPBACK_AUTH_STORAGE_PARTITION_IMPLICIT_REUSE',
);
assert.equal(warnings.length, 1, 'implicit-default reuse warning is bounded once per owner');
assert.equal(warnings[0].severity, 'warning');
assert.equal(warnings[0].details.storagePartition, DEFAULT_AUTH_STORAGE_PARTITION);
assert.equal(warnings[0].details.guidePointer, 'guide/recipes/multi-persona-clients.md');
assert.match(warnings[0].details.repair, /explicit storagePartition per persona/u);
await thirdDefault.dispose();
await secondDefault.dispose();
await firstDefault.dispose();
`);
  run(process.execPath, [runtimeProbe], { cwd: scaffold });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log('check-guide-multi-persona-clients: packed import, typecheck, isolated personas, and bounded warning passed');
