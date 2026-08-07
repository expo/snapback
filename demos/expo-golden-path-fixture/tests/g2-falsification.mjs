import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

Object.defineProperty(globalThis, 'navigator', {
  value: { product: 'ReactNative' },
  configurable: true,
});

const appDir = resolve(import.meta.dirname, '..');
const repoRoot = resolve(appDir, '..', '..');
const generatedDir = join(appDir, 'snapback', 'generated');
const generated = (name) => JSON.parse(readFileSync(join(generatedDir, name), 'utf8'));
const runtimeBinary = process.env.SNAPBACK_RUNTIME_BINARY
  ?? process.env.SNAPBACK_SERVER_BINARY
  ?? join(repoRoot, 'target', 'debug', 'snapback');

const { createFakeExpoFileSystem } = await import('../../../packages/snapback-client/fake-expo-file-system.mjs');
const {
  createExternalSessionClient,
  createExpoRqsResumeStore,
  rqsEntryKey,
} = await import('../../../packages/snapback-client/index.mjs');
const {
  createSnapbackReactProvider,
  observeSnapbackQueries,
  observeSnapbackSurface,
  skip,
} = await import('../../../packages/snapback-react/index.mjs');
const { admitAppBindingV1 } = await import('../../../packages/snapback-expo/app-binding.mjs');
const { createSuite, runAcceptance } = await import('../../_kit/harness.mjs');
const { startServer } = await import('../../_kit/server-process.mjs');
const { app, default: api } = await import('../snapback/generated/api.mjs');

const suite = createSuite('expo golden path / G2 falsification', { expectedChecks: 5 });
const scratch = mkdtempSync(join(tmpdir(), 'snapback-g2-falsification-'));
const startupArtifacts = join(scratch, 'startup-artifacts.json');
writeFileSync(startupArtifacts, `${JSON.stringify({
  formatVersion: 1,
  schema: generated('schema.manifest.json'),
  functions: generated('functions.manifest.json'),
})}\n`, { mode: 0o600 });
const fakeFileSystem = createFakeExpoFileSystem(join(scratch, 'documents'));
const expoCrypto = {
  getRandomValues(values) {
    for (let index = 0; index < values.length; index += 1) values[index] = (index * 31 + 17) % 256;
    return values;
  },
};

let server = null;
let online = null;
let offline = null;
let onlineProvider = null;
let offlineProvider = null;
let onlineSurface = null;
let offlineSurface = null;
let directMessages = null;
let retentionHandle = null;
let offlineOrigin = null;
let warmStore = createExpoRqsResumeStore({ fileSystem: fakeFileSystem.module, crypto: expoCrypto });
let coldStore = null;

await runAcceptance(suite, async () => {
  server = await startServer({
    port: 0,
    db: join(scratch, 'g2.sqlite3'),
    cwd: repoRoot,
    serverBinary: runtimeBinary,
    startupArtifacts,
    captureImpersonationCapability: true,
    provenance: {
      appId: 'expo-golden-path-fixture',
      artifactsPath: join(generatedDir, 'artifacts.json'),
    },
  });
  const seedResponse = await fetch(`${server.baseUrl}/_snapback/api/host-ops`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-snapback-admin-token': server.adminToken,
    },
    body: JSON.stringify({
      schemaVersion: 'snapback.v0',
      requestId: 'g2-falsification-seed-reset',
      operation: 'app.reset',
      seed: JSON.parse(readFileSync(join(appDir, 'snapback', 'seed.json'), 'utf8')),
    }),
  });
  const seedEnvelope = await seedResponse.json();
  if (!seedResponse.ok || seedEnvelope.ok !== true) {
    throw new Error(`G2 seed reset failed: ${JSON.stringify(seedEnvelope)}`);
  }
  const minted = await mintSession(server, 'g2-falsification@snapback.test');
  const clientOptions = { bearerToken: minted.token, clientStoreId: 'g2-falsification', rqsStore: warmStore };
  online = createExternalSessionClient(server.baseUrl, clientOptions);
  const onlineBinding = await online.prepareReactBinding({ generatedManifest: app });
  assert(await pollBindingReceipt(online.rqsStore), 'online binding receipt did not persist');
  onlineProvider = createSnapbackReactProvider(onlineBinding, { connectionId: 'g2-online' });
  onlineSurface = observeSnapbackSurface(
    onlineProvider,
    app.surfaces.conversation,
    { conversationId: 'conversation_engine_room' },
    { presence: { typing: { displayName: 'Ada' } } },
    () => {},
  );

  await suite.check('surface reaches and renders the Relay-shaped current facts', async () => {
    await eventually(() => onlineSurface.snapshot().state.messages.freshness === 'current'
      && onlineSurface.snapshot().presence.typing.members.some((entry) => (
        entry.key === onlineSurface.snapshot().presence.typing.selfKey
        && entry.value.displayName === 'Ada'
      )));
    const snapshot = onlineSurface.snapshot();
    assert.equal(snapshot.data.messages.length, 3);
    assert.equal(snapshot.data.details[0].title, 'Engine Room');
    assert.equal(snapshot.data.memberships.length, 4);
    assert.equal(snapshot.data.users.length, 4);
    assert.equal(snapshot.state.messages.status, 'ready');
    assert.equal(snapshot.state.messages.connection, 'live');
    assert.equal(snapshot.presence.typing.status, 'ready');
    assert.equal(onlineProvider.inspection().presenceStores, 1);
    assert.equal(onlineProvider.inspection().presenceSubscriptions, 1);
  });

  await suite.check('bound reaction mutation omits conversationId and reaches the same surface', async () => {
    await onlineSurface.mutations.react({
      messageId: 'message_er_1',
      userId: 'user_ada',
      emoji: '😂',
    });
    await eventually(() => onlineSurface.snapshot().data.reactions?.some((row) => row.messageId === 'message_er_1' && row.emoji === '😂'));
  });

  await suite.check('surface and low-level message readers share one upstream owner', async () => {
    directMessages = observeSnapbackQueries(onlineProvider, {
      messages: { ref: api.messagesForConversation, args: { conversationId: 'conversation_engine_room' } },
    }, () => {});
    await eventually(() => directMessages.snapshot().queries.messages.freshness === 'current');
    assert.equal(onlineProvider.inspection().stores, 5);
    assert.equal(onlineProvider.inspection().serverSubscriptions, 5);
  });

  directMessages.dispose();
  directMessages = null;
  retentionHandle = online.startLiveQuery(api.messagesForConversation, {
    connectionId: 'g2-retention-writer',
    args: { conversationId: 'conversation_engine_room' },
    fallbackToPoll: false,
    persistResume: true,
  });
  await retentionHandle.started();
  assert(retentionHandle.current);
  await eventually(() => retentionHandle.current.freshness === 'current');
  await retentionHandle.current.flushResumeState();
  retentionHandle.dispose();
  retentionHandle = null;

  await onlineSurface.dispose();
  onlineSurface = null;
  await eventually(() => onlineProvider.inspection().stores === 0
    && onlineProvider.inspection().presenceStores === 0);
  await onlineProvider.dispose();
  assertProviderResourcesClosed(onlineProvider, 'online provider');
  onlineProvider = null;
  await online.closeAuth();
  online = null;
  await warmStore.close();
  warmStore = null;
  offlineOrigin = server.baseUrl;
  await server.stop();
  server = null;

  coldStore = createExpoRqsResumeStore({ fileSystem: fakeFileSystem.module, crypto: expoCrypto });
  await coldStore.whenLockSettled();
  assert(await coldStore.loadReactBindingReceipt(), 'cold store could not reopen the binding receipt');
  const retainedEntry = await coldStore.load(rqsEntryKey('messagesForConversation', {
    conversationId: 'conversation_engine_room',
  }));
  assert.equal(retainedEntry?.rows?.length, 3, 'cold store could not reopen the retained message rows');
  offline = createExternalSessionClient(offlineOrigin, {
    bearerToken: minted.token,
    clientStoreId: 'g2-falsification',
    rqsStore: coldStore,
  });
  await suite.check('descriptor cold boot renders retained message history through the surface', async () => {
    assert(await coldStore.loadReactBindingReceipt(), 'the exact binding receipt is present before cold preparation');
    const binding = await offline.prepareReactBinding({ generatedManifest: app });
    assert.equal(binding.source, 'persisted-receipt');
    offlineProvider = createSnapbackReactProvider(binding, { connectionId: 'g2-offline' });
    offlineSurface = observeSnapbackSurface(
      offlineProvider,
      app.surfaces.conversation,
      { conversationId: 'conversation_engine_room' },
      { presence: { typing: skip } },
      () => {},
    );
    await eventually(() => offlineSurface.snapshot().state.messages.freshness === 'retained');
    const snapshot = offlineSurface.snapshot();
    assert.equal(snapshot.data.messages.length, 3);
    assert.strictEqual(snapshot.data.messages, snapshot.state.messages.data);
    assert.equal(snapshot.state.messages.status, 'refreshing');
    assert.equal(snapshot.state.messages.connection, 'stale');
  });

  await suite.check('conversation descriptor refuses a missing target capability before authority', async () => {
    const binding = {
      format: 'snapback.app-binding.v1',
      source: 'supervised-dev',
      descriptorIdentity: app.identity.descriptor,
      target: {
        app: app.identity.app,
        schema: app.identity.schema,
        functions: app.identity.functions,
        origin: 'http://127.0.0.1:4317',
        routing: 'loopback',
      },
      capabilities: { offered: app.capabilities.required.slice(1) },
      provenance: {
        supervisorGeneration: 'g2-capability-refusal',
        issuedAt: '2026-08-06T12:00:00.000Z',
        expiresAt: '2026-08-06T13:00:00.000Z',
      },
      integrity: { channel: 'local-supervised-ipc' },
    };
    await assert.rejects(
      admitAppBindingV1(binding, app, {
        now: Date.parse('2026-08-06T12:30:00.000Z'),
        delivery: { channel: 'local-supervised-ipc' },
      }),
      (error) => error?.code === 'SNAPBACK_APP_BINDING_CAPABILITY_MISMATCH'
        && error.diagnostic.details.missingCapabilities[0] === app.capabilities.required[0],
    );
  });
}, {
  cleanups: [
    () => rmSync(scratch, { recursive: true, force: true }),
    async () => server?.stop(),
    async () => warmStore?.close(),
    async () => online?.closeAuth(),
    async () => retentionHandle?.dispose(),
    async () => directMessages?.dispose(),
    async () => onlineProvider?.dispose(),
    async () => onlineSurface?.dispose(),
    async () => coldStore?.close(),
    async () => offline?.closeAuth(),
    async () => offlineProvider?.dispose(),
    async () => offlineSurface?.dispose(),
  ],
});

async function mintSession(runningServer, email) {
  const child = spawn(runtimeBinary, [
    'session', 'mint', '--email', email, '--url', runningServer.baseUrl,
    '--impersonation-capability-stdin',
  ], {
    cwd: repoRoot,
    env: { ...process.env, SNAPBACK_ADMIN_TOKEN: runningServer.adminToken },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdin.end(`${runningServer.impersonationCapability}\n`);
  const exit = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  if (exit.code !== 0) throw new Error(`session mint failed (${exit.code ?? exit.signal}): ${stderr.trim()}`);
  const envelope = JSON.parse(stdout);
  if (envelope.ok !== true || typeof envelope.data?.token !== 'string') {
    throw new Error(`session mint returned an invalid envelope: ${stdout}`);
  }
  return envelope.data;
}

async function eventually(predicate) {
  const deadline = Date.now() + 15_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for G2 surface state');
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
}

async function pollBindingReceipt(store) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const receipt = await store?.loadReactBindingReceipt?.();
    if (receipt) return receipt;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  return null;
}

function assertProviderResourcesClosed(provider, label) {
  const inspection = provider.inspection();
  assert.deepEqual({
    stores: inspection.stores,
    consumers: inspection.consumers,
    subscriptions: inspection.serverSubscriptions,
    presenceStores: inspection.presenceStores,
    presenceConsumers: inspection.presenceConsumers,
    presenceSubscriptions: inspection.presenceSubscriptions,
    publishers: inspection.publishers,
    timers: inspection.timers,
    presenceTimers: inspection.presenceTimers,
    presenceListeners: inspection.presenceListeners,
    listeners: inspection.listeners,
  }, {
    stores: 0,
    consumers: 0,
    subscriptions: 0,
    presenceStores: 0,
    presenceConsumers: 0,
    presenceSubscriptions: 0,
    publishers: 0,
    timers: 0,
    presenceTimers: 0,
    presenceListeners: 0,
    listeners: 0,
  }, `${label} leaked React resources`);
}
