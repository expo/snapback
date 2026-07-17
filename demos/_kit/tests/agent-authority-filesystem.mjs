// True process-restart and OS-lock proof for Node filesystem agent custody.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp } from 'node:fs/promises';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHILD = join(HERE, 'agent-authority-filesystem-child.mjs');
const BEARER_SENTINEL = 'sbagt_filesystem_bearer_must_never_persist';

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

  // The OS advisory lock serializes distinct processes. Acquisition is
  // bounded, and SIGKILL cannot leave a time-stolen lock: kernel/process EOF
  // releases the owner, after which a new process safely acquires it.
  const holder = spawnChild(['hold', directory, 'agent:filesystem-lock', '5000', '60000']);
  await waitForLine(holder, (value) => value.event === 'acquired');
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
