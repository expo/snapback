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
const execFileAsync = promisify(execFile);

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

const waitForLine = async (child, predicate) => {
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  let buffered = '';
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`child event timed out: ${stderr}`)), 5_000);
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
      const recordName = (await readdir(securityRoot)).find((entry) => entry.endsWith('.json'));
      assert(recordName, 'security fixture must create a custody record');
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

  // Orphan maintenance applies to independently locked terminal-witness
  // partitions too, not only the primary custody row. The derived namespace is
  // exact, so cleaning this temp cannot touch another witness or primary file.
  {
    const custodyId = 'agent:filesystem-deleted';
    const witnessId = `snapback.agent-terminal-witness.v1:${deleted.record.authorityKey}:${custodyId}`;
    const witnessKey = createHash('sha256')
      .update(`snapback.agent-authority-custody-file.v1\n${witnessId}`, 'utf8')
      .digest('hex');
    const witnessRecordName = `${witnessKey}.json`;
    assert((await readdir(directory)).includes(witnessRecordName));
    const witnessOrphanName = `${witnessRecordName}.777.${'b'.repeat(32)}.tmp`;
    await writeFile(join(directory, witnessOrphanName), 'witness-orphan', { mode: 0o600 });
    const witnessCleaner = createFilesystemAgentAuthorityCustodyStorage({ directory });
    const witness = await witnessCleaner.snapshot(witnessId);
    assert.equal(witness.status, 'deleted');
    const cleanup = witnessCleaner.maintenanceSnapshot();
    assert.equal(cleanup.orphanCount, 1);
    assert.equal(cleanup.orphanBytes, 14);
    assert.equal(cleanup.removedCount, 1);
    assert.equal((await readdir(directory)).includes(witnessOrphanName), false);
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
      /^[a-f0-9]{64}\.json\.[1-9][0-9]*\.[a-f0-9]{32}\.tmp$/u.test(entry)
    ));
    assert(orphanName, 'helper crash after temp creation must leave one exact-namespace orphan');
    const recordName = orphanName.match(/^([a-f0-9]{64}\.json)\./u)?.[1];
    assert(recordName, 'crash orphan must bind one exact record namespace');

    const cleaner = createFilesystemAgentAuthorityCustodyStorage({ directory });
    const predecessor = await cleaner.snapshot(custodyId);
    assert.equal(predecessor.revision, 1);
    const crashCleanup = cleaner.maintenanceSnapshot();
    assert(crashCleanup.scannedEntries >= crashEntries.length);
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
    const failedOrphanName = `${recordName}.999.${'a'.repeat(32)}.tmp`;
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
    assert(retryCleanup.scannedEntries >= (await readdir(directory)).length);
    assert.equal(retryCleanup.orphanCount, 1);
    assert.equal(retryCleanup.orphanBytes, 6);
    assert.equal(retryCleanup.removedCount, 1);
    assert.equal((await readdir(directory)).includes(failedOrphanName), false);

    // Count exhaustion is diagnosed before deletion. This proves maintenance
    // work is bounded even when the directory contains attacker-created debris.
    const excessiveOrphans = Array.from({ length: 129 }, (_, index) => (
      `${recordName}.${1_000 + index}.${index.toString(16).padStart(32, '0')}.tmp`
    ));
    for (const name of excessiveOrphans) {
      await writeFile(join(directory, name), '', { mode: 0o600 });
    }
    await assert.rejects(
      cleaner.snapshot(custodyId),
      (error) => (
        error?.code === 'SNAPBACK_AUTH_CUSTODY_ORPHAN_LIMIT'
        && error?.diagnostic?.details?.orphanCount === 129
        && error?.diagnostic?.details?.maximumOrphans === 128
      ),
    );
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
