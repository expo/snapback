#!/usr/bin/env node

// Bounded LLP 0129 Phase-2b design-spike witness. This is not the hot-swap
// implementation: it isolates only the server-side question whether the same
// clientMutationId settles once across two runtime processes/origins sharing
// one SQLite database.
//
// @ref LLP 0133#exactly-once-identity-under-the-new-semantics — an identical
//   durable mutation identity republishes the stored settlement.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resolveGeneratedArtifact } from '../../../../packages/snapback-cli/index.mjs';
import { SnapbackClient } from '../../../../packages/snapback-client/index.mjs';
import { generate } from '../../../../packages/snapback-codegen/index.mjs';
import { createSidecarSupervisor } from '../../../../packages/snapback-sidecar/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '../../../..');
const runtimeBinary = resolve(
  process.env.SNAPBACK_RUNTIME_BINARY ?? join(ROOT, 'target/debug/snapback'),
);
assert.equal(existsSync(runtimeBinary), true, `missing Snapback runtime ${runtimeBinary}`);

const scratch = await mkdtemp(join(tmpdir(), 'snapback-hot-swap-settlement-poc-'));
const backend = join(scratch, 'app', 'snapback');
const generated = join(backend, 'generated');
const database = join(scratch, 'state', 'shared.sqlite3');
const startupArtifacts = join(scratch, 'state', 'startup-artifacts.json');
const supervisors = [];
let oldPortGuard = null;

try {
  await cp(join(ROOT, 'packages/snapback-cli/templates/todo-contract/snapback'), backend, {
    recursive: true,
  });
  const generation = await generate(backend);
  assert.equal(generation.ok, true, JSON.stringify(generation.diagnostics));
  await mkdir(dirname(startupArtifacts), { recursive: true });
  await writeFile(startupArtifacts, `${JSON.stringify({
    formatVersion: 1,
    schema: JSON.parse(await readFile(
      resolveGeneratedArtifact(generated, 'schema.manifest.json'),
      'utf8',
    )),
    functions: JSON.parse(await readFile(
      resolveGeneratedArtifact(generated, 'functions.manifest.json'),
      'utf8',
    )),
  })}\n`, { mode: 0o600 });
  const api = (await import(
    `${pathToFileURL(resolveGeneratedArtifact(generated, 'api.mjs')).href}?poc=${Date.now()}`
  )).default;

  const startRuntime = async (label) => {
    const supervisor = createSidecarSupervisor({
      projectRoot: ROOT,
      database,
      runtimeBinary,
      stateDirectory: join(scratch, `sidecar-${label}`),
      startArgs: ['--startup-artifacts', startupArtifacts],
      readyTimeoutMs: 120_000,
      stopTimeoutMs: 20_000,
      env: {
        ...process.env,
        DYLD_FRAMEWORK_PATH: join(ROOT, 'vendor/ibex/ios/Frameworks'),
      },
    });
    supervisors.push(supervisor);
    const attachment = await supervisor.start();
    const client = new SnapbackClient(attachment.url, {
      adminToken: await attachment.capabilities.adminToken.read(),
      rqsStore: null,
      offlineQueue: false,
    });
    return { supervisor, attachment, client };
  };

  const userId = 'hot_swap_settlement_user';
  const clientMutationId = 'cm_hot_swap_settlement_poc';
  const first = await startRuntime('old');
  const firstResult = await first.client.mutate(api.createTodo, {
    userId,
    args: { title: 'settle once across origins' },
    clientMutationId,
    queue: false,
  });
  await first.supervisor.stop();

  // Keep the predecessor port occupied while the candidate asks the OS for
  // port 0, making this specifically a cross-origin witness rather than
  // relying on the allocator not to reuse the just-closed port.
  oldPortGuard = createServer();
  await new Promise((resolveListen, reject) => {
    oldPortGuard.once('error', reject);
    oldPortGuard.listen(first.attachment.port, '127.0.0.1', resolveListen);
  });

  const second = await startRuntime('new');
  await new Promise((resolveClose, reject) => {
    oldPortGuard.close((error) => error ? reject(error) : resolveClose());
  });
  oldPortGuard = null;
  assert.notEqual(second.attachment.url, first.attachment.url);
  assert.notEqual(
    second.attachment.healthyStart.startupNonce,
    first.attachment.healthyStart.startupNonce,
  );
  const secondResult = await second.client.mutate(api.createTodo, {
    userId,
    args: { title: 'settle once across origins' },
    clientMutationId,
    queue: false,
  });
  const rows = (await second.client.query(api.listTodos, { userId })).rows;

  assert.equal(rows.length, 1, 'duplicate delivery must not insert a second row');
  assert.equal(secondResult.version, firstResult.version);
  assert.deepEqual(secondResult.result, firstResult.result);
  // The receipt is byte-identical across the replay EXCEPT receivedAtMs, a
  // wall-clock stamp of when each receipt was received; it legitimately differs
  // between the original settlement and the duplicate-suppressed replay. Compare
  // every semantically meaningful field (identity, lane, claim ledger,
  // affected tables, snapshot version) and exclude only that timestamp — an
  // identical mutationId + replay-accept lane + unchanged snapshotVersion is the
  // exactly-once witness, not the receive time.
  const stripReceivedAt = ({ receivedAtMs, ...rest }) => rest;
  assert.deepEqual(
    stripReceivedAt(secondResult.receipt),
    stripReceivedAt(firstResult.receipt),
  );

  console.log(JSON.stringify({
    schemaVersion: 'snapback.hot-swap-settlement-poc.v1',
    status: 'PASS',
    databaseShared: true,
    old: {
      url: first.attachment.url,
      startupNonce: first.attachment.healthyStart.startupNonce,
      pid: first.attachment.pid,
    },
    candidate: {
      url: second.attachment.url,
      startupNonce: second.attachment.healthyStart.startupNonce,
      pid: second.attachment.pid,
    },
    clientMutationId,
    firstVersion: firstResult.version,
    replayedVersion: secondResult.version,
    rowCount: rows.length,
    rowId: rows[0]._id,
    sameResult: true,
    sameReceipt: true,
  }, null, 2));
} finally {
  if (oldPortGuard !== null) {
    await new Promise((resolveClose) => oldPortGuard.close(() => resolveClose()));
  }
  for (const supervisor of supervisors.reverse()) {
    try { await supervisor.stop(); } catch { /* bounded temp cleanup */ }
  }
  await rm(scratch, { recursive: true, force: true });
}
