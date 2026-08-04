// True process-restart and OS-lock proof for Node filesystem agent custody.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import {
  link,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp } from 'node:fs/promises';
import { promisify } from 'node:util';

import { createFilesystemAgentAuthorityCustodyStorage } from '../agent-authority-filesystem.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHILD = join(HERE, 'agent-authority-filesystem-child.mjs');
const BEARER_SENTINEL = 'sbagt_filesystem_bearer_must_never_persist';
const CHILD_EVENT_TIMEOUT_MS = 30_000;
const execFileAsync = promisify(execFile);

const recordNameFor = (custodyId) => `${createHash('sha256')
  .update(`snapback.agent-authority-custody-file.v1\n${custodyId}`, 'utf8')
  .digest('hex')}.json`;
const lockNameFor = (custodyId) => recordNameFor(custodyId).replace(/\.json$/u, '.lock');

const spawnChild = (args) => spawn(
  process.execPath,
  [CHILD, ...args],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);

const collect = async (child) => {
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const status = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.deepEqual(status, { code: 0, signal: null }, stderr);
  const lines = stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  assert(lines.length > 0, 'child must emit a result');
  return lines;
};

const run = async (...args) => (await collect(spawnChild(args))).at(-1);

const crashAtCheckpoint = async (checkpoint, directory, custodyId) => {
  const child = spawnChild([`crash-${checkpoint}-a`, directory, custodyId]);
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  const observed = await waitForLine(
    child,
    (value) => value.event === 'terminal-ledger-checkpoint',
  );
  assert.equal(observed.name, checkpoint);
  assert.deepEqual(await exited, { code: null, signal: 'SIGKILL' });
  return observed;
};

const killHelperAtRetireCheckpoint = async (checkpoint, directory, custodyId) => {
  const result = await run(`crash-retire-helper-${checkpoint}-a`, directory, custodyId);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'SNAPBACK_AUTH_CUSTODY_LOCK_LOST');
  return result;
};

const waitForLine = async (child, predicate) => {
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  let buffered = '';
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`child event timed out after ${CHILD_EVENT_TIMEOUT_MS}ms: ${stderr}`)),
      CHILD_EVENT_TIMEOUT_MS,
    );
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.stdout.on('data', (chunk) => {
      buffered += chunk;
      while (buffered.includes('\n')) {
        const newline = buffered.indexOf('\n');
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        if (line.length === 0) continue;
        const parsed = JSON.parse(line);
        if (predicate(parsed)) {
          clearTimeout(timeout);
          resolve(parsed);
          return;
        }
      }
    });
  });
};

const directory = await mkdtemp(join(tmpdir(), 'snapback-agent-custody-'));

try {
  // Custody roots are canonical, stable private directories. A final symlink
  // (including the historical trailing-separator lstat bypass) is refused.
  {
    const securityRoot = await mkdtemp(join(tmpdir(), 'snapback-agent-symlink-'));
    try {
      const target = join(securityRoot, 'target');
      const alias = join(securityRoot, 'alias');
      await mkdir(target, { mode: 0o700 });
      const privateChild = join(target, 'private');
      await mkdir(privateChild, { mode: 0o700 });
      await symlink(target, alias);
      assert.throws(
        () => createFilesystemAgentAuthorityCustodyStorage({ directory: `${alias}${sep}` }),
        /normalized path without a trailing separator/,
      );
      const aliased = createFilesystemAgentAuthorityCustodyStorage({ directory: alias });
      await assert.rejects(
        aliased.withOwnership('agent:symlink-root', (owner) => owner.read()),
        (error) => error?.code === 'SNAPBACK_AUTH_CUSTODY_DIRECTORY_INSECURE',
      );
      const intermediate = createFilesystemAgentAuthorityCustodyStorage({
        directory: join(alias, 'private'),
      });
      await assert.rejects(
        intermediate.withOwnership('agent:symlink-ancestor', (owner) => owner.read()),
        (error) => error?.code === 'SNAPBACK_AUTH_CUSTODY_DIRECTORY_INSECURE',
      );
    } finally {
      await rm(securityRoot, { recursive: true, force: true });
    }
  }

  if (process.platform === 'darwin') {
    const securityRoot = await mkdtemp(join(tmpdir(), 'snapback-agent-acl-'));
    try {
      const custodyDirectory = join(securityRoot, 'custody');
      await mkdir(custodyDirectory, { mode: 0o700 });
      await execFileAsync('/bin/chmod', [
        '+a',
        'everyone allow add_file,delete_child',
        securityRoot,
      ]);
      const aclStorage = createFilesystemAgentAuthorityCustodyStorage({
        directory: custodyDirectory,
      });
      await assert.rejects(
        aclStorage.withOwnership('agent:unsafe-ancestor-acl', (owner) => owner.read()),
        (error) => error?.code === 'SNAPBACK_AUTH_CUSTODY_DIRECTORY_INSECURE',
      );
    } finally {
      await rm(securityRoot, { recursive: true, force: true });
    }
  }

  // The helper retains one kernel CWD capability before taking the partition
  // lock. Replacing the configured pathname at every later linearization
  // window cannot split the SQLite lock, temporary file, and final record
  // across two directory inodes: the commit stays in the displaced original.
  const swapTemplate = await run('init-a', directory, 'agent:swap-template');
  for (const hookName of [
    'beforeLock',
    'beforeTemporaryCreate',
    'afterTemporaryCreate',
    'beforeRecordRename',
  ]) {
    const securityRoot = await mkdtemp(join(tmpdir(), `snapback-agent-swap-${hookName}-`));
    const custodyDirectory = join(securityRoot, 'custody');
    const displacedDirectory = join(securityRoot, 'custody-displaced');
    await mkdir(custodyDirectory, { mode: 0o700 });
    let swapped = false;
    const hooks = {
      async [hookName]() {
        if (swapped) return;
        swapped = true;
        await rename(custodyDirectory, displacedDirectory);
        await mkdir(custodyDirectory, { mode: 0o700 });
      },
    };
    const swapping = createFilesystemAgentAuthorityCustodyStorage({
      directory: custodyDirectory,
      testHooks: hooks,
    });
    const custodyId = `agent:directory-swap-${hookName}`;
    try {
      const committed = await swapping.withOwnership(custodyId, (owner) => (
        owner.replace(null, {
          ...swapTemplate.record,
          custodyId,
        })
      ));
      assert.equal(swapped, true);
      assert.deepEqual(await swapping.snapshot(custodyId), committed);
      const displacedEntries = await readdir(displacedDirectory);
      assert(displacedEntries.some((entry) => entry.endsWith('.lock')));
      assert(displacedEntries.some((entry) => entry.endsWith('.json')));
      assert.deepEqual(await readdir(custodyDirectory), []);
    } finally {
      await rm(securityRoot, { recursive: true, force: true });
    }
  }

  // Record reads are bounded and reject aliases with extra hard links.
  for (const attack of ['hard-link', 'oversized', 'fifo']) {
    const securityRoot = await mkdtemp(join(tmpdir(), `snapback-agent-${attack}-`));
    try {
      await run('init-a', securityRoot, `agent:${attack}`);
      const recordName = recordNameFor(`agent:${attack}`);
      assert((await readdir(securityRoot)).includes(recordName), 'security fixture must create its primary custody record');
      const recordPath = join(securityRoot, recordName);
      if (attack === 'hard-link') {
        await link(recordPath, join(securityRoot, 'record-alias'));
      } else if (attack === 'oversized') {
        await writeFile(recordPath, 'x'.repeat((64 * 1_024) + 1), { mode: 0o600 });
      } else {
        await rm(recordPath);
        await execFileAsync('/usr/bin/mkfifo', ['-m', '600', recordPath]);
      }
      const attacked = createFilesystemAgentAuthorityCustodyStorage({ directory: securityRoot });
      await assert.rejects(
        attacked.snapshot(`agent:${attack}`),
        (error) => error?.code === 'SNAPBACK_AUTH_CUSTODY_FILE_INSECURE',
      );
    } finally {
      await rm(securityRoot, { recursive: true, force: true });
    }
  }

  // Parent request/session ids and helper hook ids each have a finite native
  // number space. The last safe id remains usable by one complete predecessor
  // ownership interval; the next allocation permanently closes that retained
  // capability without reusing an id or stranding its predecessor lock.
  for (const {
    axis,
    seed,
  } of [
    { axis: 'request', seed: { requestId: Number.MAX_SAFE_INTEGER - 3 } },
    { axis: 'session', seed: { sessionId: Number.MAX_SAFE_INTEGER } },
    { axis: 'hook', seed: { hookId: Number.MAX_SAFE_INTEGER - 1 } },
  ]) {
    const correlationDirectory = await mkdtemp(
      join(tmpdir(), `snapback-agent-correlation-${axis}-`),
    );
    try {
      const correlationStorage = createFilesystemAgentAuthorityCustodyStorage({
        directory: correlationDirectory,
        testCounterSeeds: seed,
      });
      let predecessorCompleted = false;
      await correlationStorage.withOwnership(
        `agent:filesystem-correlation-${axis}-predecessor`,
        async (owner) => {
          assert.equal(await owner.read(), null);
          predecessorCompleted = true;
        },
      );
      assert.equal(predecessorCompleted, true, `${axis} predecessor owner settled`);

      const rejectsExhaustion = (error) => (
        error?.code === 'SNAPBACK_AUTH_CUSTODY_CORRELATION_EXHAUSTED'
        && error?.diagnostic?.details?.axis === axis
      );
      await assert.rejects(
        correlationStorage.withOwnership(
          `agent:filesystem-correlation-${axis}-refused`,
          () => assert.fail(`${axis} exhaustion entered a new owner`),
        ),
        rejectsExhaustion,
      );
      await assert.rejects(
        correlationStorage.withOwnership(
          `agent:filesystem-correlation-${axis}-still-refused`,
          () => assert.fail(`${axis} exhausted lineage recovered or reused an id`),
        ),
        rejectsExhaustion,
        `${axis} exhaustion remains permanently fail-closed`,
      );
    } finally {
      await rm(correlationDirectory, { recursive: true, force: true });
    }
  }

  // Three independent Node processes prove epoch/revision restoration rather
  // than accidentally sharing the in-memory adapter or an imported singleton.
  const initialized = await run('init-a', directory, 'agent:filesystem-restart');
  assert.equal(initialized.ok, true);
  assert.equal(initialized.capture.authorityEpoch, 0);
  assert.equal(initialized.record.revision, 1);

  const replaced = await run('replace-b', directory, 'agent:filesystem-restart');
  assert.equal(replaced.ok, true);
  assert.equal(replaced.capture.authorityEpoch, 1);
  assert.equal(replaced.record.revision, 3);

  const restarted = await run('adopt-b', directory, 'agent:filesystem-restart');
  assert.equal(restarted.ok, true);
  assert.equal(restarted.capture.authorityEpoch, 1);
  assert.equal(restarted.record.revision, 3);
  assert.equal(restarted.record.authorityKey, replaced.record.authorityKey);

  // Operations sharing one owner cannot race the compare-and-swap. The first
  // replacement may commit, but an overlapping second call is rejected before
  // it can reread the same predecessor and silently overwrite the winner.
  const overlapCustodyId = 'agent:filesystem-owner-overlap';
  await run('init-a', directory, overlapCustodyId);
  const overlapStorage = createFilesystemAgentAuthorityCustodyStorage({ directory });
  const overlap = await overlapStorage.withOwnership(overlapCustodyId, async (owner) => {
    const current = await owner.read();
    const marker = {
      ...current,
      revision: current.revision + 1,
      phase: 'exhausted',
      status: 'deleted',
      transition: null,
    };
    const results = await Promise.allSettled([
      owner.replace(current.revision, marker),
      owner.replace(current.revision, marker),
    ]);
    return { results, marker };
  });
  assert.deepEqual(
    overlap.results.map((result) => result.status).sort(),
    ['fulfilled', 'rejected'],
  );
  assert.equal(
    overlap.results.find((result) => result.status === 'rejected').reason.code,
    'SNAPBACK_AUTH_CUSTODY_OPERATION_OVERLAP',
  );
  assert.deepEqual(await overlapStorage.snapshot(overlapCustodyId), overlap.marker);
  {
    let signalNestedEntered;
    let signalNestedRelease;
    const nestedEntered = new Promise((resolve) => { signalNestedEntered = resolve; });
    const nestedRelease = new Promise((resolve) => { signalNestedRelease = resolve; });
    const refusedUnhandled = [];
    const onRefusedUnhandled = (error) => { refusedUnhandled.push(error); };
    process.on('unhandledRejection', onRefusedUnhandled);
    await overlapStorage.withOwnership('agent:filesystem-unawaited-overlap', async (owner) => {
      const nested = owner.withPartition(
        'agent:filesystem-unawaited-overlap-child',
        async () => {
          signalNestedEntered();
          await nestedRelease;
        },
      );
      await nestedEntered;
      void owner.read();
      await new Promise((resolve) => setImmediate(resolve));
      signalNestedRelease();
      await nested;
    });
    process.off('unhandledRejection', onRefusedUnhandled);
    assert.deepEqual(
      refusedUnhandled,
      [],
      'an unawaited overlapping filesystem refusal is observed immediately',
    );
  }
  await overlapStorage.withOwnership('agent:filesystem-reentrant-owner', async (owner) => {
    await assert.rejects(
      owner.withPartition('agent:filesystem-reentrant-owner', () => assert.fail('reentered')),
      (error) => error?.code === 'SNAPBACK_AUTH_CUSTODY_OWNERSHIP_REENTRANT',
    );
    await assert.rejects(
      overlapStorage.snapshot('agent:filesystem-reentrant-owner'),
      (error) => error?.code === 'SNAPBACK_AUTH_CUSTODY_OWNERSHIP_REENTRANT',
    );
  });

  // A returned callback closes its owner to new starts but does not release
  // the filesystem gate until every already-started child has settled. This
  // catches the historical unawaited-withPartition split-brain interval.
  {
    let signalNestedEntered;
    let signalNestedRelease;
    const nestedEntered = new Promise((resolve) => { signalNestedEntered = resolve; });
    const nestedRelease = new Promise((resolve) => { signalNestedRelease = resolve; });
    let capturedOwner = null;
    let nestedOperation = null;
    let successorEntered = false;
    const outer = overlapStorage.withOwnership('agent:filesystem-joined-owner', (owner) => {
      capturedOwner = owner;
      nestedOperation = owner.withPartition('agent:filesystem-joined-child', async () => {
        signalNestedEntered();
        await nestedRelease;
      });
      return 'outer-result';
    });
    await nestedEntered;
    await new Promise((resolve) => setImmediate(resolve));

    await assert.rejects(
      capturedOwner.read(),
      (error) => (
        error?.code === 'SNAPBACK_AUTH_CUSTODY_LOCK_LOST'
        && /released/u.test(error.message)
      ),
    );
    const refusedUnhandled = [];
    const onRefusedUnhandled = (error) => { refusedUnhandled.push(error); };
    process.on('unhandledRejection', onRefusedUnhandled);
    void capturedOwner.read();
    await new Promise((resolve) => setImmediate(resolve));
    process.off('unhandledRejection', onRefusedUnhandled);
    assert.deepEqual(
      refusedUnhandled,
      [],
      'an unawaited late filesystem start is rejected without an unhandled event',
    );
    let outerSettled = false;
    void outer.then(() => { outerSettled = true; }, () => { outerSettled = true; });
    const successor = overlapStorage.withOwnership('agent:filesystem-joined-owner', () => {
      successorEntered = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(outerSettled, false, 'filesystem ownership joins its unawaited child');
    assert.equal(successorEntered, false, 'successor remains behind the outer gate');

    signalNestedRelease();
    await nestedOperation;
    assert.equal(outerSettled, false, 'observed filesystem child settlement precedes release');
    assert.equal(successorEntered, false, 'successor waits for the outer release step');
    assert.equal(await outer, 'outer-result');
    await successor;
    assert.equal(successorEntered, true);

    let signalFailedChildEntered;
    let signalFailedChildRelease;
    const failedChildEntered = new Promise((resolve) => { signalFailedChildEntered = resolve; });
    const failedChildRelease = new Promise((resolve) => { signalFailedChildRelease = resolve; });
    const unhandled = [];
    const onUnhandled = (error) => { unhandled.push(error); };
    process.on('unhandledRejection', onUnhandled);
    let failedChildOuterSettled = false;
    const joinedFailure = overlapStorage.withOwnership(
      'agent:filesystem-missed-child-error',
      (owner) => {
        void owner.withPartition('agent:filesystem-missed-child-error-nested', async () => {
          signalFailedChildEntered();
          await failedChildRelease;
          throw new Error('filesystem missed-await child failed');
        });
        return 'joined-child-rejection';
      },
    );
    void joinedFailure.then(
      () => { failedChildOuterSettled = true; },
      () => { failedChildOuterSettled = true; },
    );
    await failedChildEntered;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(failedChildOuterSettled, false, 'filesystem joins a rejected missed-await child');
    signalFailedChildRelease();
    assert.equal(await joinedFailure, 'joined-child-rejection');
    await new Promise((resolve) => setImmediate(resolve));
    process.off('unhandledRejection', onUnhandled);
    assert.deepEqual(unhandled, [], 'filesystem ownership observes missed child rejection');
    await overlapStorage.withOwnership('agent:filesystem-missed-child-error', async (owner) => {
      assert.equal(await owner.read(), null, 'a failed child does not strand the physical lock');
    });

    const primaryFailure = new Error('filesystem ownership callback failed');
    await assert.rejects(
      overlapStorage.withOwnership('agent:filesystem-primary-child-error', (owner) => {
        void owner.withPartition('agent:filesystem-primary-child-error-nested', async () => {
          throw new Error('secondary filesystem child failure');
        });
        throw primaryFailure;
      }),
      (error) => error === primaryFailure,
      'the filesystem callback error remains primary after child join',
    );
  }
  const exhaustedRestart = await run('reject-a', directory, overlapCustodyId);
  assert.equal(exhaustedRestart.failure.code, 'SNAPBACK_AUTH_CUSTODY_COUNTER_EXHAUSTED');

  // A crash after the clearing CAS leaves enough intent for a distinct
  // process to replay the durable participant phase and settle exactly once.
  await run('init-a', directory, 'agent:filesystem-clearing');
  const wedged = await run('wedge-b', directory, 'agent:filesystem-clearing');
  assert.equal(wedged.ok, true);
  assert.match(wedged.failure.message, /injected child participant failure/);
  assert.equal(wedged.record.phase, 'clearing');
  assert.equal(wedged.record.authorityEpoch, 1);
  assert.equal(wedged.record.revision, 2);
  const recovered = await run('recover-b', directory, 'agent:filesystem-clearing');
  assert.equal(recovered.ok, true);
  assert.equal(recovered.durableCommits, 1);
  assert.equal(recovered.record.phase, 'settled');
  assert.equal(recovered.record.authorityEpoch, 1);
  assert.equal(recovered.record.revision, 3);

  // A settled deletion tombstone survives restart. Re-presenting a fresh
  // carrier for the exact same tuple cannot revive it or advance counters.
  await run('init-a', directory, 'agent:filesystem-deleted');
  const deleted = await run('delete-a', directory, 'agent:filesystem-deleted');
  assert.equal(deleted.ok, true);
  assert.equal(deleted.record.status, 'deleted');
  assert.equal(deleted.record.authorityEpoch, 1);
  assert.equal(deleted.record.revision, 3);
  const rejected = await run('reject-a', directory, 'agent:filesystem-deleted');
  assert.equal(rejected.ok, true);
  assert.equal(rejected.failure.code, 'SNAPBACK_CLIENT_AUTHORITY_STALE');
  assert.equal(rejected.record.status, 'deleted');
  assert.equal(rejected.record.authorityEpoch, deleted.record.authorityEpoch);
  assert.equal(rejected.record.revision, deleted.record.revision);

  // Orphan maintenance applies to independently locked terminal-ledger buckets
  // too, not only the primary custody row. The derived namespace is exact, so
  // cleaning this temp cannot touch another bucket or primary file.
  {
    const custodyId = 'agent:filesystem-deleted';
    const bucketIndex = Number.parseInt(
      deleted.record.authorityKey.slice('sha256:'.length, 'sha256:'.length + 8),
      16,
    ) % 64;
    const bucketId = `snapback.agent-terminal-bucket.v2:${bucketIndex}:${custodyId}`;
    const bucketRecordName = recordNameFor(bucketId);
    assert((await readdir(directory)).includes(bucketRecordName));
    const bucketOrphanName = `${bucketRecordName}.tmp`;
    await writeFile(join(directory, bucketOrphanName), 'bucket-orphan', { mode: 0o600 });
    const bucketCleaner = createFilesystemAgentAuthorityCustodyStorage({ directory });
    const bucket = await bucketCleaner.snapshot(bucketId);
    assert.equal(bucket.recordType, 'agentTerminalBucket');
    assert(bucket.entries.some((entry) => entry.authorityKey === deleted.record.authorityKey));
    const cleanup = bucketCleaner.maintenanceSnapshot();
    assert.equal(cleanup.orphanCount, 1);
    assert.equal(cleanup.orphanBytes, 13);
    assert.equal(cleanup.removedCount, 1);
    assert.equal((await readdir(directory)).includes(bucketOrphanName), false);
  }

  // Every durable ledger checkpoint is restart-safe on the real filesystem,
  // including the v1-writer compatibility cut. Killing the whole owner process
  // leaves only exact fsynced records; a fresh process resumes preparation,
  // activates the bounded ledger, migrates the primary, and finishes legacy
  // witness removal without reopening the delayed tuple.
  for (const checkpoint of [
    'afterLedgerPreparing',
    'afterLedgerBuckets',
    'afterLedgerActive',
    'afterPrimaryV2',
  ]) {
    const custodyId = `agent:filesystem-crash-${checkpoint}`;
    await crashAtCheckpoint(checkpoint, directory, custodyId);
    const recoveredAfterCheckpoint = await run('init-a', directory, custodyId);
    assert.equal(recoveredAfterCheckpoint.ok, true, `${checkpoint} must recover`);
    assert.equal(recoveredAfterCheckpoint.record.formatVersion, 2);
    const recoveredStorage = createFilesystemAgentAuthorityCustodyStorage({ directory });
    const root = await recoveredStorage.snapshot(`snapback.agent-terminal-ledger.v2:${custodyId}`);
    assert(root.phase === 'active' || root.phase === 'closed');
    assert.equal(root.legacyCut, true);
  }

  {
    const custodyId = 'agent:filesystem-crash-afterLegacyWitnessRemove';
    const seeded = await run('seed-legacy-a', directory, custodyId);
    assert.equal(seeded.ok, true);
    const witnessId = seeded.seeded.witnessId;
    assert((await readdir(directory)).includes(recordNameFor(witnessId)));
    assert((await readdir(directory)).includes(lockNameFor(witnessId)));
    await crashAtCheckpoint('afterLegacyWitnessRemove', directory, custodyId);
    assert.equal((await readdir(directory)).includes(recordNameFor(witnessId)), false);
    assert.equal((await readdir(directory)).includes(lockNameFor(witnessId)), false);
    const recoveredAfterRemoval = await run('init-a', directory, custodyId);
    assert.equal(recoveredAfterRemoval.ok, false);
    assert.equal(recoveredAfterRemoval.code, 'SNAPBACK_CLIENT_AUTHORITY_STALE');
    const recoveredStorage = createFilesystemAgentAuthorityCustodyStorage({ directory });
    const root = await recoveredStorage.snapshot(`snapback.agent-terminal-ledger.v2:${custodyId}`);
    assert.equal(root.legacyCut, true);
    assert.equal((await recoveredStorage.snapshot(custodyId)).formatVersion, 2);
  }

  // Initial migration ignores unidentifiable unrelated corruption, then the
  // sealed v2 path performs no shared-directory discovery at all. A thousand
  // unrelated invalid records therefore cannot wedge or scale a healthy
  // custody's steady synchronization.
  {
    const isolationDirectory = await mkdtemp(join(tmpdir(), 'snapback-agent-scan-isolation-'));
    try {
      const malformedPath = join(isolationDirectory, `${'e'.repeat(64)}.json`);
      await writeFile(malformedPath, '{ definitely not json', { mode: 0o600 });
      const custodyId = 'agent:filesystem-steady-isolation';
      const initializedIsolation = await run('init-a', isolationDirectory, custodyId);
      assert.equal(initializedIsolation.ok, true);
      const unrelated = [];
      for (let index = 0; index < 1_000; index += 1) {
        const name = `${index.toString(16).padStart(64, '0')}.json`;
        if (name === `${'e'.repeat(64)}.json`) continue;
        unrelated.push(join(isolationDirectory, name));
      }
      for (let offset = 0; offset < unrelated.length; offset += 128) {
        await Promise.all(unrelated.slice(offset, offset + 128).map((path) => (
          writeFile(path, 'not-json', { mode: 0o600 })
        )));
      }
      const steady = await run('init-a', isolationDirectory, custodyId);
      assert.equal(steady.ok, true);
      assert.equal(steady.record.formatVersion, 2);
    } finally {
      await rm(isolationDirectory, { recursive: true, force: true });
    }
  }

  // An unparseable hashed v1 filename cannot be classified during discovery.
  // Skipping it is safe because the sealed protocol still performs a strict
  // exact lookup for every candidate tuple. The bytes survive the cut and make
  // that candidate fail closed; only unrelated malformed filenames are
  // isolated.
  {
    const ambiguousDirectory = await mkdtemp(join(tmpdir(), 'snapback-agent-ambiguous-v1-'));
    try {
      const custodyId = 'agent:filesystem-ambiguous-v1';
      const seeded = await run('seed-legacy-primary-a', ambiguousDirectory, custodyId);
      assert.equal(seeded.ok, true);
      const delayedWitnessName = recordNameFor(seeded.seeded.delayedWitnessId);
      await writeFile(join(ambiguousDirectory, delayedWitnessName), '{ broken witness', {
        mode: 0o600,
      });
      const cut = await run('init-a', ambiguousDirectory, custodyId);
      assert.equal(cut.ok, true);
      const storage = createFilesystemAgentAuthorityCustodyStorage({
        directory: ambiguousDirectory,
      });
      assert.equal(
        (await storage.snapshot(`snapback.agent-terminal-ledger.v2:${custodyId}`)).legacyCut,
        true,
      );
      assert.equal((await readdir(ambiguousDirectory)).includes(delayedWitnessName), true);
      const refused = await run('adopt-b', ambiguousDirectory, custodyId);
      assert.equal(refused.ok, false);
      assert.equal(refused.code, 'SNAPBACK_AUTH_CUSTODY_CORRUPT');
    } finally {
      await rm(ambiguousDirectory, { recursive: true, force: true });
    }
  }

  // Witness retirement cleanly closes SQLite while the advisory carrier still
  // has its stable pathname, then unlinks and fsyncs that carrier before the
  // JSON record. Killing the lock-owning helper at each boundary leaves a
  // recoverable state: the old JSON is still discoverable, or its v2 bucket is
  // already durable. Recovery finishes both-file retirement without leaving a
  // rollback-journal sidecar or resurrecting the tuple.
  for (const checkpoint of [
    'beforeLockClose',
    'afterLockClose',
    'afterLockUnlink',
    'afterLockRetireSync',
    'afterRecordUnlink',
  ]) {
    const custodyId = `agent:filesystem-retire-crash-${checkpoint}`;
    const seeded = await run('seed-legacy-a', directory, custodyId);
    assert.equal(seeded.ok, true);
    const witnessId = seeded.seeded.witnessId;
    await killHelperAtRetireCheckpoint(checkpoint, directory, custodyId);
    if (checkpoint !== 'beforeLockClose') {
      assert.equal(
        (await readdir(directory)).includes(`${lockNameFor(witnessId)}-journal`),
        false,
        `${checkpoint} must occur after SQLite removed its rollback journal`,
      );
    }
    const recoveredAfterRetireCrash = await run('init-a', directory, custodyId);
    assert.equal(recoveredAfterRetireCrash.ok, false);
    assert.equal(recoveredAfterRetireCrash.code, 'SNAPBACK_CLIENT_AUTHORITY_STALE');
    const entriesAfterRecovery = await readdir(directory);
    assert.equal(entriesAfterRecovery.includes(recordNameFor(witnessId)), false);
    assert.equal(entriesAfterRecovery.includes(lockNameFor(witnessId)), false);
    assert.equal(entriesAfterRecovery.includes(`${lockNameFor(witnessId)}-journal`), false);
    const recoveredStorage = createFilesystemAgentAuthorityCustodyStorage({ directory });
    const root = await recoveredStorage.snapshot(`snapback.agent-terminal-ledger.v2:${custodyId}`);
    assert.equal(root.legacyCut, true);
  }

  // A conforming v1 writer and v2 migration use the same universal gate. An
  // old-style process holding that gate excludes v2 before it can acquire or
  // retire the tuple lock; after kernel release, migration completes normally.
  {
    const custodyId = 'agent:filesystem-v1-v2-gate-exclusion';
    const seeded = await run('seed-legacy-a', directory, custodyId);
    assert.equal(seeded.ok, true);
    const oldWriter = spawnChild([
      'hold-universal-gate',
      directory,
      custodyId,
      '5000',
      '60000',
    ]);
    await waitForLine(oldWriter, (value) => value.event === 'universal-gate-acquired');
    const excluded = await run('init-a', directory, custodyId, '150');
    assert.equal(excluded.ok, false);
    assert.equal(excluded.code, 'SNAPBACK_AUTH_CUSTODY_LOCK_UNAVAILABLE');
    oldWriter.kill('SIGKILL');
    await new Promise((resolve) => oldWriter.once('exit', resolve));
    const recovered = await run('init-a', directory, custodyId);
    assert.equal(recovered.ok, false);
    assert.equal(recovered.code, 'SNAPBACK_CLIENT_AUTHORITY_STALE');
    const entriesAfterRecovery = await readdir(directory);
    assert.equal(entriesAfterRecovery.includes(recordNameFor(seeded.seeded.witnessId)), false);
    assert.equal(entriesAfterRecovery.includes(lockNameFor(seeded.seeded.witnessId)), false);
  }

  // The process that owns the kernel lock also performs rename(). Kill it in
  // both deterministic linearization windows. A successor can then acquire
  // custody, but the dead predecessor has no process left that could overwrite
  // the successor after the lock was released.
  for (const stage of ['before', 'after']) {
    const custodyId = `agent:filesystem-${stage}-rename-crash`;
    await run('init-a', directory, custodyId);
    const predecessor = spawnChild([
      `pause-${stage}-rename-b`,
      directory,
      custodyId,
      '5000',
      '60000',
    ]);
    const paused = await waitForLine(
      predecessor,
      (value) => value.event === `${stage}-rename`,
    );
    assert.equal(paused.context.nextRevision, 2);
    predecessor.kill('SIGKILL');
    await new Promise((resolve) => predecessor.once('exit', resolve));

    const successor = await run('recover-b', directory, custodyId);
    assert.equal(successor.ok, true);
    assert.equal(successor.record.phase, 'settled');
    assert.equal(successor.record.revision, 3);
    assert.equal(successor.record.authority.grantId, replaced.record.authority.grantId);
  }

  // Killing only the retained-capability helper after O_EXCL temp creation
  // also kills the process that owns SQLite's inode lock and the only writer.
  // The authority fence reports the indeterminate write as ambiguous; a fresh
  // process can acquire the same directory, validate the exact temp namespace,
  // and remove the orphan under the partition lock before recovering.
  {
    const custodyId = 'agent:filesystem-helper-temp-crash';
    await run('init-a', directory, custodyId);
    const crashed = await run('crash-helper-after-temp-b', directory, custodyId);
    assert.equal(crashed.ok, false);
    assert.equal(crashed.code, 'SNAPBACK_AUTH_CUSTODY_AMBIGUOUS');
    const crashEntries = await readdir(directory);
    const orphanName = crashEntries.find((entry) => (
      /^[a-f0-9]{64}\.json\.tmp$/u.test(entry)
    ));
    assert(orphanName, 'helper crash after temp creation must leave one exact-namespace orphan');
    const recordName = orphanName.match(/^([a-f0-9]{64}\.json)\.tmp$/u)?.[1];
    assert(recordName, 'crash orphan must bind one exact record namespace');

    const cleaner = createFilesystemAgentAuthorityCustodyStorage({ directory });
    const predecessor = await cleaner.snapshot(custodyId);
    assert.equal(predecessor.revision, 1);
    const crashCleanup = cleaner.maintenanceSnapshot();
    assert.equal(crashCleanup.scannedEntries, 1);
    assert.equal(crashCleanup.orphanCount, 1);
    assert.equal(crashCleanup.orphanBytes, 0);
    assert.equal(crashCleanup.removedCount, 1);
    assert.equal((await readdir(directory)).includes(orphanName), false);
    const recoveredAfterHelperCrash = await run('recover-b', directory, custodyId);
    assert.equal(recoveredAfterHelperCrash.ok, true);
    assert.equal(recoveredAfterHelperCrash.record.phase, 'settled');
    assert.equal(recoveredAfterHelperCrash.record.revision, 3);

    // A cleanup failure never broadens the deletion target or silently claims
    // success. The exact validated orphan remains for a later under-lock retry,
    // whose maintenance receipt reports its bounded count and bytes.
    const failedOrphanName = `${recordName}.tmp`;
    await writeFile(join(directory, failedOrphanName), 'orphan', { mode: 0o600 });
    const failingCleaner = createFilesystemAgentAuthorityCustodyStorage({
      directory,
      testHooks: {
        async beforeOrphanUnlink({ orphanName: candidate }) {
          if (candidate === failedOrphanName) throw new Error('injected orphan unlink failure');
        },
      },
    });
    await assert.rejects(
      failingCleaner.snapshot(custodyId),
      (error) => (
        error?.code === 'SNAPBACK_AUTH_CUSTODY_ORPHAN_CLEANUP_FAILED'
        && error?.diagnostic?.details?.removedCount === 0
        && error?.diagnostic?.details?.remainingCount === 1
      ),
    );
    assert.equal((await readdir(directory)).includes(failedOrphanName), true);
    await cleaner.snapshot(custodyId);
    const retryCleanup = cleaner.maintenanceSnapshot();
    assert.equal(retryCleanup.scannedEntries, 1);
    assert.equal(retryCleanup.orphanCount, 1);
    assert.equal(retryCleanup.orphanBytes, 6);
    assert.equal(retryCleanup.removedCount, 1);
    assert.equal((await readdir(directory)).includes(failedOrphanName), false);

    // Unrelated legacy-shaped debris does not expand exact cleanup work. The
    // fixed sidecar admits at most one 64 KiB orphan per owned partition.
    const excessiveOrphans = Array.from({ length: 129 }, (_, index) => (
      `${recordName}.${1_000 + index}.${index.toString(16).padStart(32, '0')}.tmp`
    ));
    for (const name of excessiveOrphans) {
      await writeFile(join(directory, name), '', { mode: 0o600 });
    }
    await cleaner.snapshot(custodyId);
    assert.deepEqual(cleaner.maintenanceSnapshot(), {
      scannedEntries: 1,
      orphanCount: 0,
      orphanBytes: 0,
      removedCount: 0,
    });
    for (const name of excessiveOrphans) await rm(join(directory, name));
    await cleaner.snapshot(custodyId);
  }

  // The OS advisory lock serializes distinct processes. Acquisition is
  // bounded, and SIGKILL cannot leave a time-stolen lock: the crashing owner
  // itself holds the SQLite/POSIX lock, which the kernel releases on exit.
  const holder = spawnChild(['hold', directory, 'agent:filesystem-lock', '5000', '60000']);
  await waitForLine(holder, (value) => value.event === 'acquired');
  const localContender = createFilesystemAgentAuthorityCustodyStorage({
    directory,
    lockTimeoutMs: 150,
  });
  let eventLoopAdvanced = false;
  setTimeout(() => { eventLoopAdvanced = true; }, 25);
  const localFailure = localContender
    .withOwnership('agent:filesystem-lock', (owner) => owner.read())
    .then(() => null, (error) => error);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(eventLoopAdvanced, true, 'cross-process lock waiting must not freeze the event loop');
  assert.equal(
    (await localFailure)?.code,
    'SNAPBACK_AUTH_CUSTODY_LOCK_UNAVAILABLE',
  );
  const startedAt = performance.now();
  const blocked = await run('probe', directory, 'agent:filesystem-lock', '150');
  const elapsedMs = performance.now() - startedAt;
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'SNAPBACK_AUTH_CUSTODY_LOCK_UNAVAILABLE');
  assert(elapsedMs < 1_000, `bounded lock acquisition took ${elapsedMs}ms`);
  holder.kill('SIGKILL');
  await new Promise((resolve) => holder.once('exit', resolve));

  let postCrash = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    postCrash = await run('probe', directory, 'agent:filesystem-lock', '500');
    if (postCrash.ok) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(postCrash.ok, true, 'a crashed owner must not leave stale filesystem ownership');

  // Same-process callers queue before attempting the OS lock. Queue time is
  // not misclassified as cross-process lock timeout, and the first async owner
  // can resume to release instead of being starved by a synchronous waiter.
  const localStorage = createFilesystemAgentAuthorityCustodyStorage({
    directory,
    lockTimeoutMs: 25,
  });
  let firstEntered;
  const entered = new Promise((resolve) => { firstEntered = resolve; });
  const order = [];
  const first = localStorage.withOwnership('agent:filesystem-local-fifo', async (owner) => {
    order.push('first:start');
    firstEntered();
    await new Promise((resolve) => setTimeout(resolve, 75));
    await owner.read();
    order.push('first:end');
  });
  await entered;
  const second = localStorage.withOwnership('agent:filesystem-local-fifo', async (owner) => {
    order.push('second:start');
    await owner.read();
    order.push('second:end');
  });
  await Promise.all([first, second]);
  assert.deepEqual(order, ['first:start', 'first:end', 'second:start', 'second:end']);

  // The v2 adapter is itself a strict fixed-ledger store, not merely a byte
  // transport for the AgentAuthorityFence. Root and bucket records have closed
  // shapes and monotonic replacements; primary v1 migration is one exact CAS;
  // gate scans are cursor-paged; exact removal refuses stale revisions.
  {
    const adapterDirectory = await mkdtemp(join(tmpdir(), 'snapback-agent-ledger-adapter-'));
    try {
      const adapter = createFilesystemAgentAuthorityCustodyStorage({
        directory: adapterDirectory,
        terminalLedgerParameters: { bucketCount: 2, bucketCapacity: 2 },
      });
      assert.equal(adapter.partitionOwnership, 'partitioned-v2');
      assert.deepEqual(adapter.terminalLedgerParameters, { bucketCount: 2, bucketCapacity: 2 });
      assert(Object.isFrozen(adapter.terminalLedgerParameters));

      const custodyId = 'agent:filesystem-ledger-adapter';
      const primaryV1 = {
        ...initialized.record,
        formatVersion: 1,
        custodyId,
        authorityEpoch: 0,
        revision: 1,
        phase: 'settled',
        status: 'active',
        transition: null,
      };
      delete primaryV1.terminalLedgerVersion;
      await adapter.withOwnership(custodyId, (owner) => owner.replace(null, primaryV1));
      const primaryV2 = {
        ...primaryV1,
        formatVersion: 2,
        revision: 2,
        terminalLedgerVersion: 1,
      };
      await adapter.withOwnership(custodyId, (owner) => owner.replace(1, primaryV2));
      assert.deepEqual(await adapter.snapshot(custodyId), primaryV2);

      const rootId = `snapback.agent-terminal-ledger.v2:${custodyId}`;
      const preparing = {
        formatVersion: 1,
        recordType: 'agentTerminalLedger',
        custodyId: rootId,
        sourceCustodyId: custodyId,
        revision: 1,
        phase: 'preparing',
        legacyCut: false,
        bucketCount: 2,
        bucketCapacity: 2,
      };
      await adapter.withOwnership(rootId, (owner) => owner.replace(null, preparing));
      const active = { ...preparing, revision: 2, phase: 'active' };
      await adapter.withOwnership(rootId, (owner) => owner.replace(1, active));
      const cut = { ...active, revision: 3, legacyCut: true };
      await adapter.withOwnership(rootId, (owner) => owner.replace(2, cut));
      await assert.rejects(
        adapter.withOwnership(rootId, (owner) => owner.replace(3, {
          ...cut,
          revision: 4,
          legacyCut: false,
        })),
        (error) => error?.code === 'SNAPBACK_AUTH_CUSTODY_CORRUPT',
      );

      const authorityKey = primaryV2.authorityKey;
      const bucketIndex = Number.parseInt(
        authorityKey.slice('sha256:'.length, 'sha256:'.length + 8),
        16,
      ) % 2;
      const bucketId = `snapback.agent-terminal-bucket.v2:${bucketIndex}:${custodyId}`;
      const bucket = {
        formatVersion: 1,
        recordType: 'agentTerminalBucket',
        custodyId: bucketId,
        sourceCustodyId: custodyId,
        revision: 1,
        bucketIndex,
        bucketCount: 2,
        bucketCapacity: 2,
        entries: [{ authorityKey, authority: primaryV2.authority }],
      };
      await adapter.withOwnership(bucketId, (owner) => owner.replace(null, bucket));
      await assert.rejects(
        adapter.withOwnership(bucketId, (owner) => owner.replace(1, {
          ...bucket,
          revision: 2,
          entries: [],
        })),
        (error) => error?.code === 'SNAPBACK_AUTH_CUSTODY_CORRUPT',
      );
      await assert.rejects(
        adapter.withOwnership(rootId, (owner) => owner.replace(3, {
          ...cut,
          revision: 4,
          unexpected: true,
        })),
        (error) => error?.code === 'SNAPBACK_AUTH_CUSTODY_CORRUPT',
      );

      const scanned = [];
      await adapter.withOwnership('snapback.agent-custody-gate.v1:adapter-scan', async (owner) => {
        let cursor = null;
        do {
          const page = await owner.scanPartitions({ cursor, limit: 1 });
          assert(page.records.length <= 1);
          for (const record of page.records) {
            assert(record.byteLength > 0 && record.byteLength <= 64 * 1_024);
            scanned.push(record.partitionId);
          }
          cursor = page.nextCursor;
        } while (cursor !== null);
      });
      assert.deepEqual(
        new Set(scanned),
        new Set([custodyId, rootId, bucketId]),
        'paged scans return every strict stored partition exactly once',
      );

      // Scan authenticates an unrelated record's partition identity without
      // imposing this custody's schema. The core can therefore classify and
      // ignore an unrelated malformed shape instead of letting it wedge this
      // custody's migration.
      const unrelatedId = 'agent:filesystem-unrelated-malformed-scan-record';
      const unrelatedPath = join(adapterDirectory, recordNameFor(unrelatedId));
      await writeFile(unrelatedPath, `${JSON.stringify({
        custodyId: unrelatedId,
        unexpectedUnrelatedField: true,
      })}\n`, { mode: 0o600 });
      let sawUnrelated = false;
      await adapter.withOwnership('snapback.agent-custody-gate.v1:adapter-raw-scan', async (owner) => {
        let cursor = null;
        do {
          const page = await owner.scanPartitions({ cursor, limit: 2 });
          for (const record of page.records) {
            if (record.partitionId !== unrelatedId) continue;
            sawUnrelated = true;
            assert.equal(record.value.unexpectedUnrelatedField, true);
          }
          cursor = page.nextCursor;
        } while (cursor !== null);
      });
      assert.equal(sawUnrelated, true);
      await rm(unrelatedPath);

      await assert.rejects(
        adapter.withOwnership(bucketId, (owner) => owner.remove(2)),
        (error) => (
          error?.code === 'SNAPBACK_AUTH_CUSTODY_CAS_STALE'
          && error?.diagnostic?.details?.actualRevision === 1
        ),
      );
      assert.equal(
        await adapter.withOwnership(bucketId, (owner) => owner.remove(1)),
        true,
      );
      assert.equal(await adapter.snapshot(bucketId), null);
      await assert.rejects(
        adapter.withOwnership(bucketId, (owner) => owner.remove(1)),
        (error) => (
          error?.code === 'SNAPBACK_AUTH_CUSTODY_CAS_STALE'
          && error?.diagnostic?.details?.actualRevision === null
        ),
      );

      // `retire` consumes the exact owner. No same-callback operation may
      // recreate a JSON row after its discoverable lock carrier is gone, and a
      // later fresh ownership interval remains usable.
      const retiredOwnerId = 'agent:filesystem-retired-owner';
      const retiredOwnerRecord = {
        ...primaryV2,
        custodyId: retiredOwnerId,
        revision: 1,
      };
      await adapter.withOwnership(retiredOwnerId, async (owner) => {
        await owner.replace(null, retiredOwnerRecord);
        assert.equal(await owner.retire(1), true);
        for (const operation of [
          () => owner.read(),
          () => owner.replace(null, retiredOwnerRecord),
          () => owner.remove(1),
          () => owner.retire(null),
          () => owner.scanPartitions({ cursor: null, limit: 1 }),
          () => owner.withPartition(
            'agent:filesystem-retired-owner-child',
            () => assert.fail('a retired owner entered a nested partition'),
          ),
        ]) {
          await assert.rejects(
            operation,
            (error) => (
              error?.code === 'SNAPBACK_AUTH_CUSTODY_LOCK_LOST'
              && /retired/u.test(error.message)
            ),
          );
        }
      });
      const retiredRecordName = recordNameFor(retiredOwnerId);
      const retiredLockName = lockNameFor(retiredOwnerId);
      const filesAfterRetire = await readdir(adapterDirectory);
      assert.equal(filesAfterRetire.includes(retiredRecordName), false);
      assert.equal(filesAfterRetire.includes(retiredLockName), false);
      assert.equal(filesAfterRetire.includes(`${retiredLockName}-journal`), false);
      await adapter.withOwnership(retiredOwnerId, async (owner) => {
        assert.equal(await owner.read(), null);
        await owner.replace(null, retiredOwnerRecord);
      });
      assert.deepEqual(await adapter.snapshot(retiredOwnerId), retiredOwnerRecord);

      // Missing is not equal to a positive expected revision. The helper must
      // refuse before unlinking its carrier, while the conservative parent
      // still consumes the owner once retirement was dispatched.
      const staleRetireId = 'agent:filesystem-stale-retired-owner';
      await adapter.withOwnership(staleRetireId, async (owner) => {
        await assert.rejects(
          owner.retire(1),
          (error) => (
            error?.code === 'SNAPBACK_AUTH_CUSTODY_CAS_STALE'
            && error?.diagnostic?.details?.actualRevision === null
          ),
        );
        await assert.rejects(
          owner.read,
          (error) => (
            error?.code === 'SNAPBACK_AUTH_CUSTODY_LOCK_LOST'
            && /retired/u.test(error.message)
          ),
        );
      });
      assert.equal(await adapter.snapshot(staleRetireId), null);
      await adapter.withOwnership(staleRetireId, async (owner) => {
        assert.equal(await owner.read(), null);
      });
    } finally {
      await rm(adapterDirectory, { recursive: true, force: true });
    }
  }

  // Compare-and-remove stays on the retained CWD inode just like replacement.
  // Replacing the configured pathname at its final pre-unlink hook cannot move
  // the delete to the attacker-controlled successor directory.
  {
    const removalRoot = await mkdtemp(join(tmpdir(), 'snapback-agent-remove-swap-'));
    const custodyDirectory = join(removalRoot, 'custody');
    const displacedDirectory = join(removalRoot, 'custody-displaced');
    await mkdir(custodyDirectory, { mode: 0o700 });
    let swapped = false;
    const removalStorage = createFilesystemAgentAuthorityCustodyStorage({
      directory: custodyDirectory,
      testHooks: {
        async beforeRecordRemove() {
          if (swapped) return;
          swapped = true;
          await rename(custodyDirectory, displacedDirectory);
          await mkdir(custodyDirectory, { mode: 0o700 });
        },
      },
    });
    const custodyId = 'agent:filesystem-remove-swap';
    const record = {
      ...initialized.record,
      custodyId,
      authorityEpoch: 0,
      revision: 1,
      phase: 'settled',
      status: 'active',
      transition: null,
    };
    try {
      await removalStorage.withOwnership(custodyId, (owner) => owner.replace(null, record));
      await removalStorage.withOwnership(custodyId, (owner) => owner.remove(1));
      assert.equal(swapped, true);
      assert.equal((await readdir(displacedDirectory)).includes(recordNameFor(custodyId)), false);
      assert.deepEqual(await readdir(custodyDirectory), []);
      assert.equal(await removalStorage.snapshot(custodyId), null);
    } finally {
      await rm(removalRoot, { recursive: true, force: true });
    }
  }

  // Enumeration is paged for result memory, and it also has an absolute
  // per-page directory-work ceiling. A same-uid debris flood created after
  // lock acquisition fails closed with a typed diagnostic instead of turning
  // legacy migration into an unbounded opendir walk.
  {
    const scanLimitDirectory = await mkdtemp(join(tmpdir(), 'snapback-agent-scan-limit-'));
    try {
      const bounded = createFilesystemAgentAuthorityCustodyStorage({
        directory: scanLimitDirectory,
      });
      await bounded.withOwnership('snapback.agent-custody-gate.v1:scan-limit', async (owner) => {
        const debris = Array.from({ length: 4_097 }, (_, index) => (
          join(scanLimitDirectory, `noise-${index.toString().padStart(4, '0')}`)
        ));
        for (let offset = 0; offset < debris.length; offset += 128) {
          await Promise.all(debris.slice(offset, offset + 128).map((path) => (
            writeFile(path, '', { mode: 0o600 })
          )));
        }
        await assert.rejects(
          owner.scanPartitions({ cursor: null, limit: 1 }),
          (error) => (
            error?.code === 'SNAPBACK_AUTH_CUSTODY_PARTITION_SCAN_LIMIT'
            && error?.diagnostic?.details?.maximumEntries === 4_096
          ),
        );
      });
    } finally {
      await rm(scanLimitDirectory, { recursive: true, force: true });
    }
  }

  const entries = await readdir(directory);
  assert(entries.some((entry) => entry.endsWith('.json')));
  assert(entries.some((entry) => entry.endsWith('.lock')));
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  for (const entry of entries) {
    const path = join(directory, entry);
    assert.equal((await stat(path)).mode & 0o777, 0o600, `${entry} must be 0600`);
    assert.equal((await readFile(path, 'utf8')).includes(BEARER_SENTINEL), false);
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log('PASS agent authority filesystem custody — process restart, recovery, tombstone, lock');
