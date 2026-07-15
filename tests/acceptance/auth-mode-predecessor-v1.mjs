#!/usr/bin/env node

// @ref LLP 0058#artifact-and-predecessor-matrix — Rerunnable predecessor and byte-level rollback evidence.
// Rerunnable LLP 0039 / LLP 0058 rollback proof. The predecessor source and
// its Ibex gitlink are checked out without modification, built with its locked
// dependency graph, and exercised over its real HTTP and SQLite boundaries.

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PREDECESSOR = '1d6cafb6d35b159d19de257db03d69ef1fd218e8';
const PREDECESSOR_IBEX = 'f8d26ce889208fd5ee3b8d2a64b13787c37e5879';
const FIRST_STAGED_MODE_COMMIT = '8da7b46bd5d665317f52c09437ce28a72a559709';
const TOKEN = 'snapback-predecessor-proof-token';
const POISON = '"SNAPBACK_SESSIONS_MANIFEST_RELOCATED: session-aware binary required"';
const RECEIPT = join(ROOT, 'tests', 'acceptance', 'auth-mode-predecessor-v1.receipt.json');

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
  });
  if (result.status !== 0) {
    throw new Error([
      `${command} ${args.join(' ')} failed (${result.status})`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  return result.stdout?.trim() ?? '';
};

const exactGitObject = (revision) => run('git', ['rev-parse', `${revision}^{commit}`]);
const trackedFilesMatchHead = (cwd, extraArgs = []) => spawnSync(
  'git', ['diff', '--quiet', ...extraArgs, 'HEAD', '--'], { cwd },
).status === 0;

const predecessorBinary = () => {
  assert.equal(exactGitObject(`${FIRST_STAGED_MODE_COMMIT}^`), PREDECESSOR);
  const cache = join(ROOT, 'target', 'auth-mode-predecessor-1d6cafb');
  const checkout = join(ROOT, 'target', 'auth-mode-predecessor-source-1d6cafb');
  const binary = join(cache, 'debug', 'snapback');
  const marker = join(cache, 'proof-source.json');
  const provenance = JSON.stringify({ predecessor: PREDECESSOR, ibex: PREDECESSOR_IBEX });
  if (
    existsSync(binary)
    && existsSync(marker)
    && readFileSync(marker, 'utf8') === provenance
    && existsSync(checkout)
    && run('git', ['rev-parse', 'HEAD'], { cwd: checkout }) === PREDECESSOR
    && run('git', ['-C', join(checkout, 'vendor', 'ibex'), 'rev-parse', 'HEAD']) === PREDECESSOR_IBEX
    && trackedFilesMatchHead(checkout, ['--ignore-submodules=dirty'])
    && trackedFilesMatchHead(join(checkout, 'vendor', 'ibex'))
  ) {
    return binary;
  }

  if (existsSync(checkout)) {
    spawnSync('git', ['worktree', 'remove', '--force', checkout], { cwd: ROOT, stdio: 'ignore' });
    rmSync(checkout, { recursive: true, force: true });
  }
  try {
    run('git', ['worktree', 'add', '--detach', checkout, PREDECESSOR]);
    run('git', ['submodule', 'update', '--init', '--recursive', '--', 'vendor/ibex'], {
      cwd: checkout,
    });
    assert.equal(run('git', ['rev-parse', 'HEAD'], { cwd: checkout }), PREDECESSOR);
    assert.equal(
      run('git', ['-C', join(checkout, 'vendor', 'ibex'), 'rev-parse', 'HEAD']),
      PREDECESSOR_IBEX,
    );
    assert.equal(trackedFilesMatchHead(checkout, ['--ignore-submodules=dirty']), true);
    assert.equal(trackedFilesMatchHead(join(checkout, 'vendor', 'ibex')), true);
    run(join(checkout, 'scripts', 'bootstrap-ibex-runtime'), [], {
      cwd: checkout,
      env: {
        ...process.env,
        SNAPBACK_BOOTSTRAP_CHECK: '0',
        SNAPBACK_IBEX_CHECKOUT: process.env.SNAPBACK_IBEX_CHECKOUT ?? join(ROOT, '..', 'ibex'),
      },
      stdio: 'inherit',
    });
    run('cargo', ['build', '--locked', '--bin', 'snapback'], {
      cwd: checkout,
      env: { ...process.env, CARGO_TARGET_DIR: cache },
      stdio: 'inherit',
    });
    mkdirSync(cache, { recursive: true });
    writeFileSync(marker, provenance);
  } catch (error) {
    spawnSync('git', ['worktree', 'remove', '--force', checkout], { cwd: ROOT, stdio: 'ignore' });
    throw error;
  }
  return binary;
};

const reservePort = () => new Promise((resolvePort, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close((error) => (error ? reject(error) : resolvePort(port)));
  });
});

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

const waitFor = async (predicate, timeoutMs, description) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${description}`);
};

const startPredecessor = async (binary, directory, name) => {
  const port = await reservePort();
  const database = join(directory, `${name}.sqlite3`);
  const ready = join(directory, `${name}.ready.json`);
  const child = spawn(binary, [
    'start', '--host', '127.0.0.1', '--port', String(port), '--db', database,
    '--ready-file', ready,
  ], {
    env: { ...process.env, SNAPBACK_ADMIN_TOKEN: TOKEN },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  await waitFor(async () => {
    if (child.exitCode !== null) {
      throw new Error(`predecessor exited before readiness\n${stdout}\n${stderr}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      return response.ok && existsSync(ready);
    } catch {
      return false;
    }
  }, 20_000, `${name} predecessor readiness`);
  return { child, database, port, ready, output: () => ({ stdout, stderr }) };
};

const stop = async ({ child }) => {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    sleep(3_000),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
};

const postEnsure = async (server, body) => {
  const response = await fetch(`http://127.0.0.1:${server.port}/app/ensure`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-snapback-admin-token': TOKEN,
    },
    body: JSON.stringify(body),
  });
  const value = JSON.parse(await response.text());
  return { status: response.status, value };
};

const bytes = (path) => (existsSync(path) ? readFileSync(path) : null);
const snapshot = (database) => ({ database: bytes(database), wal: bytes(`${database}-wal`) });
const assertUnchanged = (before, after, label) => {
  assert.deepEqual(after.database, before.database, `${label} database bytes changed`);
  assert.deepEqual(after.wal, before.wal, `${label} WAL bytes changed`);
};

const emptyArtifacts = (version, sessions) => {
  const suffix = (letter) => letter.repeat(64);
  const inputsHash = sessions
    ? `snapback.v1:sessions:inputs:sha256:${suffix('c')}`
    : 'sha256:identical-empty-inputs';
  return {
    schema: {
      artifactKind: 'schemaManifest',
      schemaVersion: version,
      appId: 'predecessor-empty-app',
      ...(sessions ? { auth: { mode: 'sessions' }, requiredCapabilities: ['auth.sessions.v1'] } : {}),
      schemaHash: sessions
        ? `snapback.v1:sessions:schema:sha256:${suffix('a')}`
        : 'sha256:identical-empty-schema',
      inputsHash,
      tables: [],
      ephemeralCollections: [],
    },
    functions: {
      artifactKind: 'functionManifest',
      schemaVersion: version,
      appId: 'predecessor-empty-app',
      bundleHash: sessions
        ? `snapback.v1:sessions:function:sha256:${suffix('b')}`
        : 'sha256:identical-empty-functions',
      inputsHash,
      functions: [],
      cronJobs: [],
      config: [],
    },
  };
};

const provision = (requestedMode, artifacts) => ({
  intent: 'provision',
  requestedMode,
  ...artifacts,
  seed: { tables: {} },
});

const rejectedV1Case = async (binary, directory, name, provisionV0) => {
  const server = await startPredecessor(binary, directory, name);
  try {
    if (provisionV0) {
      const accepted = await postEnsure(server, provision('dev', emptyArtifacts('snapback.v0', false)));
      assert.equal(accepted.status, 200, JSON.stringify(accepted.value));
      assert.equal(accepted.value.intent, 'provision');
    }
    const before = snapshot(server.database);
    const rejected = await postEnsure(
      server,
      provision('sessions', emptyArtifacts('snapback.v1', true)),
    );
    assert.equal(rejected.value?.diagnostic?.code, 'SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION');
    const after = snapshot(server.database);
    assertUnchanged(before, after, name);
    return {
      diagnostic: rejected.value.diagnostic.code,
      databaseBytesUnchanged: true,
      walBytesUnchanged: true,
    };
  } finally {
    await stop(server);
  }
};

const poisonOpenCase = async (binary, directory) => {
  const seed = await startPredecessor(binary, directory, 'poison');
  await stop(seed);
  run('python3', ['-c', [
    'import sqlite3, sys',
    'connection = sqlite3.connect(sys.argv[1])',
    'connection.execute("INSERT INTO _snapback_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", ("schema_manifest", sys.argv[2]))',
    'connection.commit()',
    'connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")',
    'connection.close()',
  ].join('\n'), seed.database, POISON]);
  const poisonWal = `${seed.database}-wal`;
  if (existsSync(poisonWal)) {
    assert.equal(readFileSync(poisonWal).length, 0, 'poison fixture WAL did not checkpoint');
    rmSync(poisonWal);
  }
  const before = snapshot(seed.database);
  const port = await reservePort();
  const ready = join(directory, 'poison-refusal.ready.json');
  const result = spawnSync(binary, [
    'start', '--host', '127.0.0.1', '--port', String(port), '--db', seed.database,
    '--ready-file', ready,
  ], {
    env: { ...process.env, SNAPBACK_ADMIN_TOKEN: TOKEN },
    encoding: 'utf8',
    timeout: 20_000,
  });
  assert.notEqual(result.status, 0, 'poisoned predecessor unexpectedly started');
  assert.match(`${result.stdout}\n${result.stderr}`, /SNAPBACK_SCHEMA_PARSE_FAILED/);
  assert.equal(existsSync(ready), false, 'poisoned predecessor published readiness');
  const after = snapshot(seed.database);
  assertUnchanged(before, after, 'poison-open');
  return {
    diagnostic: 'SNAPBACK_SCHEMA_PARSE_FAILED',
    listenerBound: false,
    databaseBytesUnchanged: true,
    walBytesUnchanged: true,
  };
};

const main = async () => {
  const binary = predecessorBinary();
  const directory = mkdtempSync(join(tmpdir(), 'snapback-predecessor-proof-'));
  try {
    const actual = {
      formatVersion: 1,
      predecessor: PREDECESSOR,
      predecessorIbex: PREDECESSOR_IBEX,
      cases: {
        fresh: await rejectedV1Case(binary, directory, 'fresh', false),
        provisionedV0: await rejectedV1Case(binary, directory, 'provisioned-v0', true),
        poisonOpen: await poisonOpenCase(binary, directory),
      },
    };
    if (process.argv.includes('--update-receipt')) {
      writeFileSync(RECEIPT, `${JSON.stringify(actual, null, 2)}\n`);
    } else {
      const expected = JSON.parse(readFileSync(RECEIPT, 'utf8'));
      assert.deepEqual(actual, expected);
    }
    process.stdout.write(`${JSON.stringify(actual, null, 2)}\n`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

await main();
