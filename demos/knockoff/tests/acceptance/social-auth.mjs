#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash, randomBytes, webcrypto } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createSnapbackAppClient } from '@expo/snapback-client';

import { __startServerForTests as startServer } from '../../../_kit/server-process.mjs';
import { createKnockoffSocialBroker } from '../../server/social-broker.mjs';
import { fixtureIdentity } from '../../server/provider-verifier.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const demoRoot = resolve(here, '..', '..');
const repoRoot = resolve(demoRoot, '..', '..');
const generatedRoot = join(demoRoot, 'snapback', 'generated');
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const schema = await readJson(join(generatedRoot, 'schema.manifest.json'));
const functions = await readJson(join(generatedRoot, 'functions.manifest.json'));
const { app } = await import(pathToFileURL(join(generatedRoot, 'app.mjs')).href);
const { default: api } = await import(pathToFileURL(join(generatedRoot, 'api.mjs')).href);

const scratch = await mkdtemp(join(tmpdir(), 'snapback-knockoff-auth-'));
const carrier = join(scratch, 'startup-artifacts.json');
await writeFile(carrier, `${JSON.stringify({ formatVersion: 1, schema, functions })}\n`, { mode: 0o600 });

let server = null;
let listening = null;
let appClient = null;

const bindingFor = (origin) => {
  const issuedAt = new Date();
  return Object.freeze({
    format: 'snapback.app-binding.v1',
    source: 'supervised-dev',
    descriptorIdentity: app.identity.descriptor,
    target: Object.freeze({
      app: app.identity.app,
      schema: app.identity.schema,
      functions: app.identity.functions,
      origin,
      routing: 'loopback',
    }),
    capabilities: Object.freeze({ offered: Object.freeze([...app.capabilities.required].sort()) }),
    provenance: Object.freeze({
      supervisorGeneration: `knockoff-auth-${app.identity.descriptor}`,
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + 60 * 60_000).toISOString(),
    }),
    integrity: Object.freeze({ channel: 'local-supervised-ipc' }),
  });
};

async function jsonPost(origin, path, body) {
  const response = await fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  return result;
}

async function brokerLogin(origin, provider) {
  const verifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(verifier).digest('base64url');
  const started = await jsonPost(origin, '/v1/shared/start', {
    appId: schema.appId,
    provider,
    returnTo: 'knockoff://auth/shared',
    codeChallenge,
  });
  const page = await fetch(new URL(started.authorizationPath, origin));
  assert.equal(page.status, 200);
  assert.match(await page.text(), new RegExp(`Continue with ${provider === 'apple' ? 'Apple' : 'Google'}`, 'u'));
  const authorized = await fetch(`${origin}/v1/shared/complete?transaction=${encodeURIComponent(started.transactionId)}`, {
    redirect: 'manual',
  });
  assert.equal(authorized.status, 302);
  const callback = new URL(authorized.headers.get('location'));
  assert.equal(callback.searchParams.get('state'), started.state);
  assert.deepEqual([...callback.searchParams.keys()].sort(), ['code', 'state']);
  const result = await jsonPost(origin, '/v1/shared/redeem', {
    appId: schema.appId,
    code: callback.searchParams.get('code'),
    verifier,
  });
  assert.equal(result.profile.provider, provider);
  assert.equal(result.entry.adapter, 'snapback-shared-browser');
  assert.equal(result.entry.identityRealm, 'rehearsal');
  assert.equal(typeof result.exchange.challengeId, 'string');
  assert.equal(typeof result.exchange.code, 'string');
  return result;
}

async function enter(provider) {
  const login = await brokerLogin(listening.origin, provider);
  const session = await appClient.auth.signInWithExternalCode(login.exchange);
  assert.equal(Object.hasOwn(session, 'token'), false);
  const profile = await appClient.client.mutate(api.ensureProfile, {
    args: {
      handle: login.profile.handle,
      displayName: login.profile.displayName,
      avatarUrl: login.profile.avatarUrl,
    },
  });
  return { login, session, profile: profile.result };
}

try {
  server = await startServer({
    port: 0,
    db: ':memory:',
    cwd: repoRoot,
    startupArtifacts: carrier,
    captureImpersonationCapability: true,
    serverBinary: process.env.SNAPBACK_RUNTIME_BINARY
      ? resolve(process.env.SNAPBACK_RUNTIME_BINARY)
      : null,
  });
  const broker = createKnockoffSocialBroker({
    baseUrl: server.baseUrl,
    adminToken: server.adminToken,
    impersonationCapability: server.impersonationCapability,
    appId: schema.appId,
    identitySecret: 'knockoff-social-auth-acceptance-secret-v1',
    allowFixtures: true,
    allowSharedDevelopment: true,
    deploymentProfile: 'development',
    sharedReturnTargets: ['knockoff://auth/shared'],
    sharedUserLimit: 100,
    appleClientId: '',
    googleClientId: '',
  });
  listening = await broker.listen();
  appClient = await createSnapbackAppClient({
    app,
    binding: bindingFor(server.baseUrl),
    platform: { kind: 'memory', cryptoObject: webcrypto },
  });
  assert.equal(appClient.auth.currentPrincipal().status, 'anonymous');

  const apple = await enter('apple');
  assert.equal(apple.profile.created, true);
  assert.equal(apple.profile.handle, apple.login.profile.handle);
  const appleUser = apple.session.session.userId;
  const created = await appClient.client.mutate(api.createPost, {
    args: { body: 'Signed in with Apple and posted without a client-supplied author.' },
  });
  const feed = await appClient.client.query(api.timeline, { args: { limit: 20 } });
  assert(feed.rows.some((row) => row._id === created.result && row.authorHandle === apple.profile.handle));
  await appClient.auth.signOut();

  const google = await enter('google');
  assert.equal(google.profile.created, true);
  assert.notEqual(google.session.session.userId, appleUser);
  assert.notEqual(google.profile.handle, apple.profile.handle);
  const googleUser = google.session.session.userId;
  await appClient.auth.signOut();

  const googleAgain = await enter('google');
  assert.equal(googleAgain.profile.created, false);
  assert.equal(googleAgain.session.session.userId, googleUser);
  assert.equal(googleAgain.profile.handle, google.profile.handle);
  assert.equal(fixtureIdentity('apple').email.includes('privaterelay.appleid.com'), true);

  const refused = await fetch(`${listening.origin}/v1/unknown`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(refused.status, 404);

  console.log('knockoff social auth acceptance: PASS');
  console.log('  Apple shared browser profile -> Snapback custody -> principal-derived post');
  console.log('  Google shared browser profile -> distinct principal -> stable repeat login');
  console.log('  app-bound verifier + one-use callback; provider tokens absent');
} finally {
  await appClient?.dispose();
  await listening?.close();
  await server?.stop();
  await rm(scratch, { recursive: true, force: true });
}
