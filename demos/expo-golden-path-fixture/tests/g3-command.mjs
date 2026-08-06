import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const appDir = resolve(import.meta.dirname, '..');
const repoRoot = resolve(appDir, '..', '..');
const generatedDir = join(appDir, 'snapback', 'generated');
const generated = (name) => JSON.parse(readFileSync(join(generatedDir, name), 'utf8'));
const runtimeBinary = process.env.SNAPBACK_RUNTIME_BINARY
  ?? process.env.SNAPBACK_SERVER_BINARY
  ?? join(repoRoot, 'target', 'debug', 'snapback');

const {
  SnapbackClient,
  createCommandClient,
  createExternalSessionClient,
} = await import('../../../packages/snapback-client/index.mjs');
const {
  bindSnapbackSurface,
  createSnapbackReactProvider,
} = await import('../../../packages/snapback-react/index.mjs');
const { createSuite, runAcceptance } = await import('../../_kit/harness.mjs');
const { startServer } = await import('../../_kit/server-process.mjs');
const { app } = await import('../snapback/generated/app.mjs');

const suite = createSuite('expo golden path / G3 command', { expectedChecks: 4 });
const scratch = mkdtempSync(join(tmpdir(), 'snapback-g3-command-'));
const startupArtifacts = join(scratch, 'startup-artifacts.json');
writeFileSync(startupArtifacts, `${JSON.stringify({
  formatVersion: 1,
  schema: generated('schema.manifest.json'),
  functions: generated('functions.manifest.json'),
})}\n`, { mode: 0o600 });

let server = null;
let client = null;
let anonymous = null;
let provider = null;
let surface = null;

await runAcceptance(suite, async () => {
  server = await startServer({
    port: 0,
    db: join(scratch, 'g3.sqlite3'),
    cwd: repoRoot,
    serverBinary: runtimeBinary,
    startupArtifacts,
    captureImpersonationCapability: true,
    provenance: {
      appId: 'expo-golden-path-fixture',
      artifactsPath: join(generatedDir, 'artifacts.json'),
    },
  });
  await resetSeed(server);
  const minted = await mintSession(server, 'g3-command@snapback.test');
  client = createExternalSessionClient(server.baseUrl, {
    bearerToken: minted.token,
    clientStoreId: 'g3-command',
    rqsStore: null,
  });
  const binding = await client.prepareReactBinding({ generatedManifest: app });
  provider = createSnapbackReactProvider(binding, { connectionId: 'g3-command' });
  surface = bindSnapbackSurface(
    provider,
    app.surfaces.conversation,
    { conversationId: 'conversation_engine_room' },
    { presence: {} },
  );

  await suite.check('text-only send uses the generated surface command and commits once', async () => {
    const before = await messages();
    const task = surface.commands.send({ body: 'G3 text command' });
    const outcome = await task.done;
    assert.equal(outcome.kind, 'committed');
    assert.equal(task.snapshot().status, 'succeeded');
    const after = await messages();
    assert.equal(after.length, before.length + 1);
    assert(after.some((row) => row._id === outcome.result && row.text === 'G3 text command'));
  });

  await suite.check('the same typed command call admits one image source', async () => {
    const task = surface.commands.send({ body: 'G3 image command', image: pngBlob() });
    const phases = [];
    const off = task.subscribe(() => phases.push(task.snapshot().status));
    const outcome = await task.done;
    off();
    assert.equal(outcome.kind, 'committed');
    assert(phases.includes('transferring'));
    assert(phases.includes('committing'));
    const row = (await messages()).find((candidate) => candidate._id === outcome.result);
    assert.equal(row?.kind, 'image');
    assert.equal(typeof row?.image, 'string');
  });

  await suite.check('finalized asset plus mutation refusal reports residue, not rollback', async () => {
    const commands = createCommandClient(client);
    const before = await messages();
    const task = commands.start(app.commands.send, {
      conversationId: 'conversation_engine_room',
      senderId: 'user_ada',
      body: 'must not commit',
      image: pngBlob(),
      failAfterFinalize: true,
    });
    const outcome = await task.done;
    assert.equal(outcome.kind, 'failed');
    assert.equal(task.snapshot().status, 'failed');
    assert.equal(task.snapshot().asset.status, 'ready');
    assert.equal(outcome.residue.unattached, 'inferred');
    assert.equal((await messages()).length, before.length);
  });

  await suite.check('missing session refuses at the boundary reached by each branch', async () => {
    anonymous = new SnapbackClient(server.baseUrl, {
      custody: 'anonymous-public',
      adminToken: null,
      rqsStore: null,
    });
    const commands = createCommandClient(anonymous);
    const text = await commands.start(app.commands.send, {
      conversationId: 'conversation_engine_room',
      senderId: 'user_ada',
      body: 'anonymous text',
    }).done;
    assert.equal(text.kind, 'failed', JSON.stringify(text));
    assert.match(text.diagnostic.code, /AUTH|SESSION|HTTP_403/u);

    const imageTask = commands.start(app.commands.send, {
      conversationId: 'conversation_engine_room',
      senderId: 'user_ada',
      body: 'anonymous image',
      image: pngBlob(),
    });
    const image = await imageTask.done;
    assert.equal(image.kind, 'failed');
    assert.equal(imageTask.snapshot().mutation, null, 'asset authority refuses before mutation invocation');
    assert.match(image.diagnostic.code, /AUTH|SESSION|CUSTODY|HTTP/u);
  });
}, {
  cleanups: [
    () => rmSync(scratch, { recursive: true, force: true }),
    async () => surface?.dispose(),
    async () => provider?.dispose(),
    async () => anonymous?.closeAuth(),
    async () => client?.closeAuth(),
    async () => server?.stop(),
  ],
});

async function messages() {
  return (await client.query(app.api.queries.messagesForConversation, {
    args: { conversationId: 'conversation_engine_room' },
  })).rows;
}

async function resetSeed(runningServer) {
  const response = await fetch(`${runningServer.baseUrl}/_snapback/api/host-ops`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-snapback-admin-token': runningServer.adminToken,
    },
    body: JSON.stringify({
      schemaVersion: 'snapback.v0',
      requestId: 'g3-command-seed-reset',
      operation: 'app.reset',
      seed: JSON.parse(readFileSync(join(appDir, 'snapback', 'seed.json'), 'utf8')),
    }),
  });
  const envelope = await response.json();
  if (!response.ok || envelope.ok !== true) {
    throw new Error(`G3 seed reset failed: ${JSON.stringify(envelope)}`);
  }
}

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

function pngBlob() {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  return new Blob([png], { type: 'image/png' });
}
