import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { SnapbackClient } from '@expo/snapback-client';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '@expo/snapback-contract';

import { startServer } from '../../../_kit/server-process.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const demoRoot = resolve(here, '..', '..');
export const repoRoot = resolve(demoRoot, '..', '..');
export const generatedRoot = join(demoRoot, 'snapback', 'generated');
export const runtimeBinary = resolve(
  process.env.SNAPBACK_RUNTIME_BINARY ?? join(repoRoot, 'target', 'debug', 'snapback'),
);

export const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
export const schema = await readJson(join(generatedRoot, 'schema.manifest.json'));
export const functions = await readJson(join(generatedRoot, 'functions.manifest.json'));
export const { default: api } = await import(
  pathToFileURL(join(generatedRoot, 'api.mjs')).href
);

export async function createScratch(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const carrier = join(root, 'startup-artifacts.json');
  await writeFile(
    carrier,
    `${JSON.stringify({ formatVersion: 1, schema, functions })}\n`,
    { mode: 0o600 },
  );
  return Object.freeze({ root, carrier });
}

export async function removeScratch(scratch) {
  if (scratch?.root) await rm(scratch.root, { recursive: true, force: true });
}

export async function startRbacServer({
  scratch,
  db = ':memory:',
  capture = false,
  restoredFromBackup = null,
} = {}) {
  assert(scratch?.carrier, 'startRbacServer requires a startup-artifacts carrier');
  return startServer({
    port: 0,
    db,
    cwd: repoRoot,
    startupArtifacts: scratch.carrier,
    restoredFromBackup,
    captureImpersonationCapability: capture,
    serverBinary: runtimeBinary,
  });
}

export function publicClient(baseUrl, clientStoreId) {
  const storage = createMemoryAuthCustodyStorage({ state: { custody: {} } });
  const coordinator = new AuthCoordinator({
    appId: schema.appId,
    storage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const client = new SnapbackClient(baseUrl, {
    authCoordinator: coordinator,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    authorizedLeaseProtocol: 1,
    clientStoreId,
    rqsStore: null,
    offlineQueue: false,
  });
  return Object.freeze({ client, coordinator, storage });
}

export async function closeClients(clients) {
  await Promise.allSettled(clients.map(({ client }) => client.closeAuth()));
}

export function assertCredentialProjection(value, { recovery = false } = {}) {
  assert.equal(value.tokenType, 'Bearer');
  assert.equal(Object.hasOwn(value, 'token'), false, 'public client projection exposed a bearer');
  assert.equal(value.session.provider, 'local-password');
  assert.equal(typeof value.session.id, 'string');
  assert.equal(typeof value.session.userId, 'string');
  assert.equal(value.authorityDescriptor.descriptorVersion, 1);
  assert.equal(typeof value.authorityDescriptor.authorityInstanceId, 'string');
  if (recovery) {
    assert.equal(value.recoveryCodes.length, 8);
    assert.equal(new Set(value.recoveryCodes).size, 8);
    for (const code of value.recoveryCodes) assert.match(code, /^sbrv1_[A-Za-z0-9_-]+$/u);
  } else {
    assert.equal(Object.hasOwn(value, 'recoveryCodes'), false);
  }
}

export function custodySnapshot(fixture) {
  const record = fixture.storage.snapshot(schema.appId);
  assert(record, 'AuthCoordinator did not persist custody');
  return record;
}

export async function passwordReadiness(baseUrl) {
  const fixture = publicClient(baseUrl, `password-readiness-${Date.now()}`);
  let inspect;
  try {
    inspect = await fixture.client.inspect();
  } finally {
    await fixture.client.closeAuth();
  }
  const readiness = inspect.capabilityManifest?.runtimeFacts?.authProgramReadiness?.passwordProvider;
  assert.equal(readiness?.ready, true, `password provider is not ready: ${JSON.stringify(readiness)}`);
  assert.equal(readiness?.catalogVersion, 4);
  return Object.freeze({ inspect, readiness });
}

export async function joinAndReadProtectedLive(fixture, label, message = null) {
  await fixture.client.mutate(api.joinApp, { args: {} });
  if (message !== null) {
    await fixture.client.mutate(api.postAnnouncement, { args: { message } });
  }
  const live = await fixture.client.liveQuery(api.listAnnouncements, {
    connectionId: `${label}-connection`,
    args: {},
    transport: 'stream',
    fallbackToPoll: false,
  });
  assert.equal(live.freshness, 'current');
  assert(Array.isArray(live.rows));
  return live;
}

export function diagnosticCode(error) {
  return error?.diagnostic?.code ?? error?.code ?? null;
}

export async function expectRefusal(operation, expectedCodes, label) {
  try {
    await operation();
  } catch (error) {
    const code = diagnosticCode(error);
    assert(
      expectedCodes.includes(code),
      `${label} returned ${code ?? error?.message ?? String(error)}, expected ${expectedCodes.join(' or ')}`,
    );
    return Object.freeze({ code, message: error?.message ?? String(error) });
  }
  assert.fail(`${label} unexpectedly succeeded`);
}

export async function rawPasswordRequest(baseUrl, path, body, headers = {}) {
  const started = process.hrtime.bigint();
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-snapback-auth-client-protocol': '1',
      ...headers,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  return Object.freeze({
    status: response.status,
    headers: Object.freeze([...response.headers].sort(([a], [b]) => a.localeCompare(b))),
    bytes,
    body: JSON.parse(bytes.toString('utf8')),
    elapsedMs,
  });
}

export function publicSurfaceDeclaration() {
  return Object.freeze({
    customCredentialDatabase: false,
    hashingGateway: false,
    authMintSession: false,
    adminToken: false,
    impersonationCapability: false,
    undocumentedWireCall: false,
    clientPackageSourceInspection: false,
  });
}
