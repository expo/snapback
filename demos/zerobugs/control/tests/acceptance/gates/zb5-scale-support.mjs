import assert from 'node:assert/strict';
import {constants as fsConstants} from 'node:fs';
import {
  copyFile,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {
  SnapbackClient,
  createExternalSessionClient,
} from '@expo/snapback-client';

import {mintDevSession} from '../../../scripts/load-fixture.mts';
import {
  CONTROL_ROOT,
  FUNCTIONS_MANIFEST_PATH,
  REPO_ROOT,
  SCHEMA_MANIFEST_PATH,
} from '../gate-support.mjs';
import {sha256File} from '../receipt.mjs';

// @ref LLP 0183#zb5--performance-scale-and-custody — the large and hot
// profiles own isolated file-backed databases, raw measurements, and exact
// fixture/reset custody rather than borrowing the normal-control namespace.

export const LARGE_ACTORS = Object.freeze([
  'ordinary-user',
  'creator',
  'assignee',
  'crew-admin',
  'removed-member',
]);

function safeName(value) {
  const name = String(value);
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(name)) {
    throw new TypeError(`invalid scale namespace name ${name}`);
  }
  return name;
}

function absentFile(error) {
  return error && typeof error === 'object' && error.code === 'ENOENT';
}

async function assertNoSqliteSidecars(databasePath) {
  for (const suffix of ['-wal', '-shm']) {
    await assert.rejects(
      () => stat(`${databasePath}${suffix}`),
      absentFile,
      `paused baseline has no SQLite ${suffix} sidecar`,
    );
  }
}

export async function createScaleNamespace(gate, label) {
  const name = safeName(label);
  const scratch = await realpath(await mkdtemp(join(tmpdir(), `zerobugs-${name}-`)));
  gate.registerCleanup({
    label: `${name} scratch namespace`,
    targets: [{kind: 'directory', path: scratch}],
    run: () => rm(scratch, {recursive: true, force: true}),
  });
  const [schema, functions] = await Promise.all([
    readFile(SCHEMA_MANIFEST_PATH, 'utf8').then(JSON.parse),
    readFile(FUNCTIONS_MANIFEST_PATH, 'utf8').then(JSON.parse),
  ]);
  const startupArtifacts = join(scratch, 'startup-artifacts.json');
  await writeFile(
    startupArtifacts,
    `${JSON.stringify({formatVersion: 1, schema, functions})}\n`,
    {mode: 0o600},
  );
  return Object.freeze({name, scratch, startupArtifacts});
}

export async function startScaleServer(
  gate,
  namespace,
  {databasePath, instance, configure = false},
) {
  const instanceName = safeName(instance);
  const server = await gate.startServer({
    db: databasePath,
    cwd: REPO_ROOT,
    startupArtifacts: namespace.startupArtifacts,
    captureImpersonationCapability: true,
    serverBinary: process.env.SNAPBACK_SERVER_BINARY
      ?? process.env.SNAPBACK_RUNTIME_BINARY
      ?? null,
    // SIGTERM shutdown checkpoints the SQLite WAL before exit; over the
    // multi-GiB large-profile store that checkpoint outlives the kit's 3 s
    // default grace, and the SIGKILL escalation would strand a -wal sidecar
    // that breaks the hot gate's byte-provable paused-baseline clone.
    stopGraceMs: 600_000,
    env: {
      SNAPBACK_OUTBOUND_ACTIONS: '1',
      ZERBUGS_TEST_DEFAULTS: '1',
    },
  });
  assert.equal(server.reused, false, `${instanceName} owns a fresh server`);
  assert(server.adminToken, `${instanceName} has an owned admin carrier`);
  assert(
    server.impersonationCapability,
    `${instanceName} has an owned impersonation carrier`,
  );

  const readyFile = join(namespace.scratch, `${instanceName}.ready.json`);
  const adminFile = join(namespace.scratch, `${instanceName}.admin.carrier`);
  const impersonationFile = `${readyFile}.impersonation`;
  await writeFile(adminFile, `${server.adminToken}\n`, {mode: 0o600});
  await writeFile(
    impersonationFile,
    String(server.impersonationCapability),
    {mode: 0o600},
  );
  const port = Number(new URL(server.baseUrl).port);
  await writeFile(readyFile, `${JSON.stringify({
    schemaVersion: 'snapback.v0',
    descriptorKind: 'snapbackHostReady',
    startupId: `srt-${instanceName}-${server.pid}`,
    ready: true,
    serverUrl: server.baseUrl,
    host: '127.0.0.1',
    port,
    pid: server.pid,
    startupNonce: server.startupNonce,
    target: {
      appId: 'zerobugs-control',
      appRoot: null,
      targetProfile: 'local-dev-sqlite-ibex',
      serverUrl: server.baseUrl,
    },
    database: {mode: 'sqlite', path: databasePath},
    startedAtMs: Date.now(),
    adminGated: true,
    adminTokenFile: adminFile,
    impersonationCapabilityFile: impersonationFile,
    diagnostics: [],
  })}\n`, {mode: 0o600});

  if (configure) {
    for (const [entry, value] of [
      ['loopsApiKey', `${namespace.name}-local-mail-provider-v1`],
      ['discordWebhookToken', `${namespace.name}-local-webhook-provider-v1`],
      ['captureAdapterAuth', `${namespace.name}-local-capture-provider-v1`],
    ]) {
      const response = await fetch(`${server.baseUrl}/_snapback/api/config/set`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-snapback-admin-token': server.adminToken,
        },
        body: JSON.stringify({entry, value}),
      });
      const body = await response.text();
      assert.equal(response.status, 200, `${instanceName} configured ${entry}`);
      assert(!body.includes(value), `${entry} receipt withholds its value`);
    }
  }

  return Object.freeze({
    server,
    readyFile,
    databasePath,
    serverUrl: server.baseUrl,
  });
}

// Fold a WAL sidecar the server's shutdown stranded. Small-store SIGTERM
// shutdown provably checkpoints and removes the sidecars; over the multi-GiB
// large profile the server exits within seconds leaving the -wal behind
// (issues/20260807-server-sigterm-strands-large-sqlite-wal.md). The db+wal
// pair is a consistent SQLite state, so an explicit TRUNCATE checkpoint
// yields exactly the committed bytes; the strand stays disclosed in the
// returned fact rather than silently absorbed.
async function foldStrandedWal(databasePath) {
  const walStat = await stat(`${databasePath}-wal`).catch(error => {
    if (absentFile(error)) return null;
    throw error;
  });
  if (walStat === null) {
    await assertNoSqliteSidecars(databasePath);
    return {shutdownStrandedWal: false, strandedWalBytes: 0};
  }
  const {Database} = await import('bun:sqlite');
  const db = new Database(databasePath);
  try {
    db.exec('PRAGMA busy_timeout = 60000;');
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } finally {
    db.close();
  }
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${databasePath}${suffix}`;
    const sidecarStat = await stat(sidecar).catch(error => {
      if (absentFile(error)) return null;
      throw error;
    });
    if (sidecarStat !== null) {
      if (suffix === '-wal' && sidecarStat.size > 0) {
        throw new Error('stranded WAL did not fold to zero bytes under an exclusive checkpoint');
      }
      await rm(sidecar, {force: true});
    }
  }
  await assertNoSqliteSidecars(databasePath);
  return {shutdownStrandedWal: true, strandedWalBytes: walStat.size};
}

export async function pauseAndHashBaseline(stack) {
  await stack.server.stop();
  await stat(stack.databasePath);
  const shutdownWal = await foldStrandedWal(stack.databasePath);
  return {digest: await sha256File(stack.databasePath), shutdownWal};
}

export async function cloneBaselineDatabase(
  baselinePath,
  destinationPath,
  expectedDigest,
) {
  await assertNoSqliteSidecars(baselinePath);
  await copyFile(baselinePath, destinationPath, fsConstants.COPYFILE_FICLONE);
  // The sessions auth provider keeps its keyring in a db-path-prefixed
  // sibling file; a database clone without that sibling refuses to boot
  // (SNAPBACK_AUTH_PROVIDER_UNAVAILABLE — probed and verified). The keyring
  // is part of the durable state a byte-provable reset must carry.
  await copyFile(
    `${baselinePath}.auth-keyring.json`,
    `${destinationPath}.auth-keyring.json`,
  );
  const digest = await sha256File(destinationPath);
  assert.equal(digest, expectedDigest, 'cycle database is byte-identical to paused baseline');
  return Object.freeze({
    digest,
    method: 'COPYFILE_FICLONE with platform fallback; db-sibling auth keyring cloned alongside',
  });
}

export async function bindLargeActors({api, overlay, readyFile, instance}) {
  const sessions = new Map();
  const actors = {};
  let closePromise = null;
  const close = () => {
    closePromise ??= Promise.allSettled(
      [...sessions.values()].map(session => session.client.closeAuth()),
    ).then(results => {
      const rejected = results.find(result => result.status === 'rejected');
      if (rejected?.status === 'rejected') throw rejected.reason;
    });
    return closePromise;
  };
  try {
    for (const actor of LARGE_ACTORS) {
      const expected = overlay.payload.actorBindings[actor];
      assert(expected, `overlay binds ${actor}`);
      const email = `zerobugs-${instance}-${actor}@acceptance.invalid`;
      const minted = await mintDevSession(readyFile, email);
      const client = createExternalSessionClient(minted.baseUrl, {
        bearerToken: minted.token,
        clientStoreId: `zerobugs-${instance}-${actor}`,
        rqsStore: null,
      });
      const response = await client.mutate(api.acceptanceBindActor, {
        args: {actor},
        clientMutationId: `${instance}-bind-${actor}`,
        queue: false,
      });
      assert.equal(response.result.actor, actor);
      assert.equal(response.result.principal, minted.principal);
      assert.equal(response.result.sourceUserID, expected.sourceUserID);
      assert.equal(response.result.role, expected.role);
      const self = await client.query(api.acceptanceActorBindingSelf, {args: {}});
      assert.equal(self.rows.length, 1);
      assert.equal(self.rows[0].sourceUserID, expected.sourceUserID);
      assert.equal(self.rows[0].role, expected.role);
      sessions.set(actor, Object.freeze({client, principal: minted.principal}));
      actors[actor] = Object.freeze({
        principal: minted.principal,
        sourceUserID: expected.sourceUserID,
        role: expected.role,
      });
    }
    return Object.freeze({sessions, actors: Object.freeze(actors), close});
  } catch (error) {
    await close().catch(() => {});
    throw error;
  }
}

export function createAnonymousClient(baseUrl, instance) {
  return new SnapbackClient(baseUrl, {
    custody: 'anonymous-public',
    clientStoreId: `zerobugs-${instance}-anonymous`,
    adminToken: null,
    rqsStore: null,
    // Streaming live-query observers are auth-scoped live work even under
    // anonymous-public custody; the server refuses the stream without the
    // exact authorization-invalidation protocol declaration
    // (SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED). The bound-actor
    // clients get this from createExternalSessionClient already.
    authInvalidationProtocol: 1,
  });
}

export function listContext(projectName, overrides = {}) {
  return {
    open: null,
    projectName,
    assignee: null,
    creator: null,
    labels: null,
    textFilter: null,
    sortField: 'modified',
    sortDirection: 'desc',
    ...overrides,
  };
}

export async function queryOne(client, reference, args, label) {
  const response = await client.query(reference, {args});
  assert.equal(response.rows.length, 1, `${label} returns one typed envelope`);
  return response.rows[0];
}

export function issueIDs(envelope) {
  return envelope.items.map(item => item.issue.id);
}

export function databasePath(namespace, name) {
  return join(namespace.scratch, `${safeName(name)}.sqlite`);
}

export const scaleSupportIdentity = Object.freeze({
  source: join(CONTROL_ROOT, 'tests/acceptance/gates/zb5-scale-support.mjs'),
});
