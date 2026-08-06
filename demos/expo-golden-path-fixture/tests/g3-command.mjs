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
    const snapshots = [];
    const off = task.subscribe(() => snapshots.push(task.snapshot()));
    const outcome = await task.done;
    off();
    assert.equal(outcome.kind, 'committed');
    assert.equal(task.snapshot().status, 'succeeded');
    assert.deepEqual(commandStatuses(snapshots), ['preparing', 'committing', 'succeeded']);
    assert(
      snapshots.every((snapshot) => snapshot.asset === null),
      'text-only command never starts or adopts an asset child',
    );
    const after = await messages();
    assert.equal(after.length, before.length + 1);
    assert(after.some((row) => row._id === outcome.result && row.text === 'G3 text command'));
  });

  await suite.check('the same typed command call admits one image source', async () => {
    const task = surface.commands.send({ body: 'G3 image command', image: pngBlob() });
    const phases = [];
    const snapshots = [];
    const off = task.subscribe(() => {
      const snapshot = task.snapshot();
      phases.push(snapshot.status);
      snapshots.push(snapshot);
    });
    const outcome = await task.done;
    off();
    assert.equal(outcome.kind, 'committed');
    assert(phases.includes('transferring'));
    assert(phases.includes('committing'));
    assert.deepEqual(commandStatuses(snapshots), [
      'preparing',
      'transferring',
      'committing',
      'succeeded',
    ]);
    const attemptIds = distinctSnapshotValues(snapshots, (snapshot) => snapshot.asset?.attemptId);
    const assetIds = distinctSnapshotValues(snapshots, (snapshot) => snapshot.asset?.assetId);
    const mutationIds = distinctSnapshotValues(snapshots, (snapshot) => snapshot.mutation?.id);
    assert.equal(attemptIds.length, 1, `one command owns one asset attempt: ${JSON.stringify(attemptIds)}`);
    assert.equal(assetIds.length, 1, `one command owns one asset: ${JSON.stringify(assetIds)}`);
    assert.equal(mutationIds.length, 1, `one command owns one mutation attempt: ${JSON.stringify(mutationIds)}`);
    const committingIndex = snapshots.findIndex((snapshot) => snapshot.status === 'committing');
    assert.notEqual(committingIndex, -1);
    const committingMutationId = snapshots[committingIndex].mutation.id;
    assert(
      snapshots.slice(committingIndex).every((snapshot) => (
        snapshot.mutation == null || snapshot.mutation.id === committingMutationId
      )),
      'the mutation identity never changes from committing through the terminal snapshot',
    );
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
    const snapshots = [];
    const off = task.subscribe(() => snapshots.push(task.snapshot()));
    const outcome = await task.done;
    off();
    assert.equal(outcome.kind, 'failed');
    assert.equal(task.snapshot().status, 'failed');
    assert.equal(task.snapshot().asset.status, 'ready');
    assert.equal(outcome.residue.unattached, 'inferred');
    assert.deepEqual(commandStatuses(snapshots), [
      'preparing',
      'transferring',
      'committing',
      'failed',
    ]);
    const terminal = task.snapshot();
    const residue = terminal.residue;
    assert.equal(residue.assetId, terminal.asset.assetId);
    assert(['inferred', 'unknown'].includes(residue.unattached));
    assert.notEqual(residue.unattached, 'authoritative');
    assert.equal(typeof residue.basis, 'string');
    assert(residue.basis.length > 0);
    assert.equal(typeof residue.cleanupPolicy, 'string');
    assert(residue.cleanupPolicy.length > 0);
    for (const repair of terminal.repairs) {
      assert.equal(typeof repair.kind, 'string');
      assert.doesNotMatch(repair.kind, /delete|cleanup/iu);
      assert.equal(typeof repair.machineApplicable, 'boolean');
      assert.equal(typeof repair.requiresApproval, 'boolean');
    }
    const inspected = await hostOp(server, 'asset.inspect', { assetId: residue.assetId });
    assert.equal(inspected.asset.assetId, residue.assetId);
    assert.equal(inspected.asset.availability, 'ready');
    assert.notEqual(inspected.asset.availability, 'deleted');
    assert.equal((await messages()).length, before.length);

    const retry = task.retry();
    const retrySnapshots = [];
    const retryOff = retry.subscribe(() => retrySnapshots.push(retry.snapshot()));
    const retryOutcome = await retry.done;
    retryOff();
    assert.equal(retryOutcome.kind, 'failed', 'the unchanged fixture refusal re-refuses on retry');
    assert.equal(retry.snapshot().status, 'failed');
    assert.equal(retry.id, task.id);
    assert.equal(retry.generation, task.generation + 1);
    assert.equal(retry.snapshot().mutation.id, terminal.mutation.id);
    assert.equal(retry.snapshot().asset.assetId, terminal.asset.assetId);
    assert.equal(retry.snapshot().asset.attemptId, terminal.asset.attemptId);
    assert.equal(
      distinctSnapshotValues(
        [...snapshots, ...retrySnapshots],
        (snapshot) => snapshot.asset?.attemptId,
      ).length,
      1,
      'retry adopts the ready asset task instead of starting a shadow upload attempt',
    );
    assert.equal(
      distinctSnapshotValues(
        [...snapshots, ...retrySnapshots],
        (snapshot) => snapshot.mutation?.id,
      ).length,
      1,
      'retry reuses the original mutation identity',
    );
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

function commandStatuses(snapshots) {
  return snapshots
    .map((snapshot) => snapshot.status)
    .filter((status, index, statuses) => index === 0 || status !== statuses[index - 1]);
}

function distinctSnapshotValues(snapshots, read) {
  return [...new Set(
    snapshots
      .map(read)
      .filter((value) => typeof value === 'string'),
  )];
}

async function hostOp(runningServer, operation, input, userId = null) {
  const response = await fetch(`${runningServer.baseUrl}/_snapback/api/host-ops`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-snapback-admin-token': runningServer.adminToken,
      ...(runningServer.impersonationCapability
        ? { 'x-snapback-impersonation-capability': runningServer.impersonationCapability }
        : {}),
    },
    body: JSON.stringify({ operation, input, ...(userId ? { userId } : {}) }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, `${operation}: ${JSON.stringify(body)}`);
  assert.equal(body.ok, true, `${operation}: ${JSON.stringify(body.diagnostics ?? body)}`);
  return body.data ?? body.result ?? body;
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
