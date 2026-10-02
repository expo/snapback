#!/usr/bin/env node
// @ref LLP 3000#publication-suite-under-contention — a watchdog outside each
// test process also bounds blocked JS and leaked handles after a failed test.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, openSync, closeSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { identity, live, records, ownedProcesses, processTable, cleanupProcesses } from './test-processes.mjs';

export const FILE_TIMEOUT_MS = 15 * 60_000;
// Named long files cover their serial aggregate guards, plus 25% and the
// ordinary 15-minute allowance for setup, unguarded cases and teardown. These
// are hang ceilings, not speed assertions; serial publication uses the same
// caps. Keep this table with changes to the named tests' work/case counts.
const hang = work => 120_000 + Math.max(1, work) * 2000;
export function fileTimeout(file, env = process.env) {
  const count = (key, fallback) => {
    const value = Number(env[key] ?? fallback);
    if (!Number.isSafeInteger(value) || value < 1) throw Error(`invalid ${key}: ${value}`);
    return value;
  };
  const searchSeeds = env.SB4_SEARCH_SEEDS?.split(',').map(Number) ?? Array.from({ length: 300 }, (_, i) => i + 1);
  const searchWork = searchSeeds.reduce((work, seed) => work + 8
    + (seed % 10 === 0 && seed % 11 !== 0 && seed % 12 !== 0 && seed % 75 !== 0 ? 8 : 0)
    + (seed % 25 === 0 ? 100 : 0) + (seed % 75 === 0 ? Math.ceil(8195 / 200) : 1), 0);
  const budgets = {
    'ordinary-search-oracle.test.mjs': 2 * hang(searchWork) + 4 * hang(108),
    'web-admission-review.test.mjs': 56 * hang(1),
    'mixed-evidence-oracle.test.mjs': 2 * Math.max(240_000, count('RL_SEEDS', 300) * 3 * 2000),
    'app-session-model.test.mjs': 2 * Math.max(240_000, count('SNAPBACK4_SESSION_SEQUENCES', 5000) * 2000) + hang(40),
    'online-client-model.test.mjs': Math.max(180_000, count('SNAPBACK4_ONLINE_SEQUENCES', 3000) * 2000),
    'column-stream-recovery.test.mjs': hang(1020),
    'timeline-delivery.test.mjs': hang(1020),
    // Conservative: every current case gets the largest declared guard,
    // including cases whose actual guard is shorter or implicit.
    'horizon-boundary.test.mjs': 82 * hang(5000),
    'acquisition.test.mjs': 47 * hang(600),
    'sync-overflow.test.mjs': 23 * hang(1024),
    'per-row-work.test.mjs': 25 * hang(1000),
    'per-row-react.test.mjs': 7 * hang(1000),
  };
  return FILE_TIMEOUT_MS + Math.ceil((budgets[basename(file)] ?? 0) * 1.25);
}
const preload = fileURLToPath(new URL('./test-processes.mjs', import.meta.url));

export async function runFile(file, { timeout, nodeArgs = [], env: overrides = {}, onOutput = text => process.stdout.write(text), onStart = () => {}, signal, inspect = processTable } = {}) {
  timeout ??= fileTimeout(file, { ...process.env, ...overrides });
  const temp = mkdtempSync(join(tmpdir(), 'sb4-test-file-'));
  const registry = join(temp, 'processes.jsonl'), output = join(temp, 'output.log');
  const fd = openSync(output, 'w');
  const env = { ...process.env, ...overrides, SNAPBACK4_TEST_PROCESS_LOG: registry };
  delete env.NODE_TEST_CONTEXT;
  const started = performance.now();
  onOutput(`-- client file start: ${file}; limit ${timeout} ms\n`);
  const child = spawn(process.execPath, [fileURLToPath(new URL('./test-file-owner.mjs', import.meta.url)),
    '--import', preload, '--test', '--test-reporter=tap', ...nodeArgs, resolve(file)], {
    env, detached: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let keeper, tail = '', reason, cleanup, spawnError, inspectionFailure;
  const capture = b => { writeSync(fd, b); tail = (tail + b).slice(-16384); };
  child.stdout.on('data', capture); child.stderr.on('data', capture);
  const closed = new Promise(resolve => child.once('close', resolve));
  const completed = new Promise(resolve => {
    child.once('message', result => { if (result.error) spawnError = result.error; resolve(result); });
    child.once('error', error => { spawnError = error; resolve({ code: null, signal: null }); });
    child.once('exit', () => resolve({ code: null, signal: null }));
  });
  let forcedClose;
  const forced = new Promise(resolve => { forcedClose = resolve; });
  const diagnose = error => {
    inspectionFailure = String(error.stack ?? error);
    reason ??= 'TEST_PROCESS_INSPECTION';
    onOutput(`${inspectionFailure}\n`);
  };
  // An inspection failure never establishes cleanup. Best effort still kills
  // the owned, unreaped keeper's entire group and individually known detaches.
  const emergencyCleanup = () => {
    try {
      for (const row of records(registry)) {
        try { if (live(row)) process.kill(row.pid, 'SIGKILL'); }
        catch (error) { if (error.code !== 'ESRCH') diagnose(error); }
      }
    } catch (error) { diagnose(error); }
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      try { process.kill(-child.pid, 'SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') diagnose(error); }
    }
  };
  const stop = why => {
    if (cleanup) return cleanup;
    reason = why;
    onOutput(`\n${why}: ${file}; ${Math.round(performance.now() - started)} ms elapsed; limit ${timeout} ms\nlast output:\n${tail}\n`);
    cleanup = (async () => {
      try {
        const owned = ownedProcesses(records(registry), keeper, inspect);
        onOutput(`owned processes: ${JSON.stringify(owned)}\n`);
        await cleanupProcesses(owned, { keeper, inspect });
      } catch (error) { diagnose(error); emergencyCleanup(); }
      finally { forcedClose({ code: null, signal: 'SIGKILL' }); }
    })();
    return cleanup;
  };
  const abort = () => { void stop('TEST_FILE_ABORT'); };
  let timer;
  try {
    keeper = identity(child.pid);
    if (!keeper) throw Error('TEST_PROCESS_INSPECTION: missing group keeper');
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    timer = setTimeout(() => { void stop('TEST_FILE_HANG'); }, timeout);
    onStart(child);
    const result = await Promise.race([completed, forced]);
    clearTimeout(timer);
    if (cleanup) await cleanup;
    else {
      try {
        const remaining = ownedProcesses(records(registry), keeper, inspect);
        if (remaining.length) await stop('TEST_FILE_LEAK');
      } catch (error) { diagnose(error); await stop('TEST_PROCESS_INSPECTION'); }
    }
    if (child.connected) child.send('release');
    // Pipes are inherited by helpers. Even failed inspection cannot wedge the
    // reporting path; failure remains recorded if EOF cannot be established.
    let closeTimer;
    const reachedEOF = await Promise.race([closed.then(() => true), new Promise(resolve => { closeTimer = setTimeout(() => resolve(false), 2000); })]);
    clearTimeout(closeTimer);
    if (!reachedEOF) {
      diagnose(Error('TEST_PROCESS_CLEANUP: output pipes remained open after group release'));
      emergencyCleanup();
    }
    const text = readFileSync(output, 'utf8');
    onOutput(text);
    if (spawnError) onOutput(String(spawnError) + '\n');
    const elapsed = Math.round(performance.now() - started);
    const passed = result.code === 0 && !reason && !spawnError && !inspectionFailure;
    const counts = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(key =>
      [key, Number(text.match(new RegExp(`^# ${key} (\\d+)$`, 'm'))?.[1] ?? 0)]));
    onOutput(`-- client file ${passed ? 'ok' : 'FAIL'}: ${file} (${elapsed} ms)\n`);
    return { file, ...result, passed, reason, inspectionFailure, elapsed, counts };
  } catch (error) {
    diagnose(error); emergencyCleanup();
    return { file, passed: false, reason, inspectionFailure, elapsed: Math.round(performance.now() - started) };
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
    child.stdout.destroy(); child.stderr.destroy(); child.unref();
    if (child.connected) child.disconnect();
    closeSync(fd); rmSync(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const concurrency = Number(args.shift()), mode = args.shift();
  if (!Number.isInteger(concurrency) || concurrency < 1 || !['files', 'models'].includes(mode) || !args.length)
    throw new Error('usage: run-client-tests.mjs <concurrency> <files|models> <file...>');
  const abort = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => abort.abort());
  const results = [], queue = [...args];
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length && !abort.signal.aborted) {
      const file = queue.shift();
      try { results.push(await runFile(file, { signal: abort.signal })); }
      catch (error) { console.error(`TEST_FILE_RUNNER: ${file}: ${error.stack}`); results.push({ file, passed: false }); }
    }
  }));
  const failures = results.filter(row => !row.passed).length + queue.length;
  const counts = {};
  for (const result of results) for (const [key, count] of Object.entries(result.counts ?? {})) counts[key] = (counts[key] ?? 0) + count;
  console.log(`-- client files: ${results.length}/${args.length}; failed ${failures}; tests ${JSON.stringify(counts)}`);
  process.exitCode = failures ? 1 : 0;
}
