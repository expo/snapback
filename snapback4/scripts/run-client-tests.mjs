#!/usr/bin/env node
// @ref LLP 3000#publication-suite-under-contention — a watchdog outside each
// test process also bounds blocked JS and leaked handles after a failed test.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, openSync, closeSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ownedProcesses, processTable, cleanupProcesses, signalGroup } from './test-processes.mjs';

export const FILE_STALL_FLOOR_MS = 15 * 60_000;
// Largest SINGLE declared test guard, not the sum of sequential guards.
// The complete source census is retained in the QF round-2 report. Files below
// the floor need no entry. A guard gets 25% scheduling slack, at least a minute.
const hang = work => 120_000 + Math.max(1, work) * 2000;
export function largestGuard(file, env = process.env) {
  const count = (key, fallback) => {
    const value = Number(env[key] ?? fallback);
    if (!Number.isSafeInteger(value) || value < 1) throw Error(`invalid ${key}: ${value}`);
    return value;
  };
  const searchSeeds = env.SB4_SEARCH_SEEDS?.split(',').map(Number) ?? Array.from({ length: 300 }, (_, i) => i + 1);
  if (searchSeeds.some(seed => !Number.isSafeInteger(seed) || seed < 1)) throw Error('invalid SB4_SEARCH_SEEDS');
  const searchWork = searchSeeds.reduce((work, seed) => work + 8
    + (seed % 10 === 0 && seed % 11 !== 0 && seed % 12 !== 0 && seed % 75 !== 0 ? 8 : 0)
    + (seed % 25 === 0 ? 100 : 0) + (seed % 75 === 0 ? Math.ceil(8195 / 200) : 1), 0);
  return ({
    'ordinary-search-oracle.test.mjs': Math.max(hang(searchWork), hang(108)),
    'web-admission-review.test.mjs': 56 * hang(1),
    'mixed-evidence-oracle.test.mjs': Math.max(240_000, count('RL_SEEDS', 300) * 3 * 2000),
    'app-session-model.test.mjs': Math.max(240_000, count('SNAPBACK4_SESSION_SEQUENCES', 5000) * 2000),
    'online-client-model.test.mjs': Math.max(180_000, count('SNAPBACK4_ONLINE_SEQUENCES', 3000) * 2000),
    'column-stream-recovery.test.mjs': hang(1020),
    'timeline-delivery.test.mjs': hang(1020),
    'horizon-boundary.test.mjs': hang(5000),
    'acquisition.test.mjs': hang(600),
    'sync-overflow.test.mjs': hang(1024),
    'per-row-work.test.mjs': hang(1000),
    'per-row-react.test.mjs': hang(1000),
    'social-browser.test.mjs': hang(303),
    'live-margin-browser.test.mjs': hang(800),
    'retained-history.test.mjs': hang(126),
  })[basename(file)] ?? 0;
}
export const fileStallTimeout = (file, env) => {
  const guard = largestGuard(file, env);
  return Math.max(FILE_STALL_FLOOR_MS, guard + Math.max(60_000, Math.ceil(guard * .25)));
};

export async function runFile(file, { timeout, nodeArgs = [], env: overrides = {}, onOutput = text => process.stdout.write(text), onStart = () => {}, signal, inspect = processTable } = {}) {
  timeout ??= fileStallTimeout(file, { ...process.env, ...overrides });
  const { values } = parseArgs({ args: nodeArgs, options: {
    'test-name-pattern': { type: 'string', multiple: true },
    'test-skip-pattern': { type: 'string', multiple: true },
  } });
  // Node 24's in-process test tree also reads filters from the CLI, so pass
  // the validated flags to Node as well as the public run() options.
  const testOptions = { testNamePatterns: values['test-name-pattern'], testSkipPatterns: values['test-skip-pattern'] };
  const temp = mkdtempSync(join(tmpdir(), 'sb4-test-file-'));
  const output = join(temp, 'output.log');
  const fd = openSync(output, 'w');
  const env = { ...process.env, ...overrides };
  delete env.NODE_TEST_CONTEXT;
  const started = performance.now();
  onOutput(`-- client file start: ${file}; stall bound ${timeout} ms\n`);
  const child = spawn(process.execPath, [fileURLToPath(new URL('./test-file-owner.mjs', import.meta.url)),
    ...nodeArgs, fileURLToPath(new URL('./test-progress-reporter.mjs', import.meta.url)), resolve(file), JSON.stringify(testOptions)], {
    env, detached: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let tail = '', reason, cleanup, spawnError, inspectionFailure, timer, counts;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    signalGroup(child);
  };
  let lastProgress = started, progress = 'file startup', progressCount = 0;
  const capture = b => { writeSync(fd, b); tail = (tail + b).slice(-16384); };
  child.stdout.on('data', capture); child.stderr.on('data', capture);
  const closed = new Promise(resolve => child.once('close', resolve));
  const completed = new Promise(resolve => {
    child.on('message', result => {
      if (result.progress) {
        if (cleanup) return;
        lastProgress = performance.now(); progress = `${result.progress}: ${result.name}`; progressCount++;
        clearTimeout(timer); timer = setTimeout(() => { void stop('TEST_FILE_HANG'); }, timeout);
        return;
      }
      if (result.counts) { counts = result.counts; return; }
      if (result.error) spawnError = result.error;
      resolve(result);
    });
    child.once('error', error => { spawnError = error; resolve({ code: null, signal: null }); });
    child.once('exit', () => resolve({ code: null, signal: null }));
  });
  let forcedClose;
  const forced = new Promise(resolve => { forcedClose = resolve; });
  const diagnose = error => {
    const diagnostic = String(error.stack ?? error);
    inspectionFailure ??= diagnostic;
    reason ??= diagnostic.includes('TEST_FILE_LEAK:') ? 'TEST_FILE_LEAK' : 'TEST_PROCESS_INSPECTION';
    onOutput(`${diagnostic}\n`);
  };
  // Fail closed, but still release the group if inspection itself broke.
  // The same one-shot release prevents any signal after the keeper is reaped.
  const emergencyCleanup = () => {
    try { release(); } catch (error) { diagnose(error); }
  };
  const stop = why => {
    if (cleanup) return cleanup;
    reason = why;
    onOutput(`\n${why}: ${file}; ${Math.round(performance.now() - started)} ms elapsed; stall bound ${timeout} ms; ${Math.round(performance.now() - lastProgress)} ms without progress; last progress ${progress}\nlast output:\n${tail}\n`);
    cleanup = (async () => {
      try {
        const owned = ownedProcesses(child, inspect);
        onOutput(`owned processes: ${JSON.stringify(owned)}\n`);
        await cleanupProcesses(child, { inspect, release });
      } catch (error) { diagnose(error); emergencyCleanup(); }
      finally { forcedClose({ code: null, signal: 'SIGKILL' }); }
    })();
    return cleanup;
  };
  const abort = () => { void stop('TEST_FILE_ABORT'); };
  try {
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    timer = setTimeout(() => { void stop('TEST_FILE_HANG'); }, timeout);
    onStart(child);
    const result = await Promise.race([completed, forced]);
    clearTimeout(timer);
    if (cleanup) await cleanup;
    else {
      try {
        const remaining = ownedProcesses(child, inspect);
        if (remaining.length) await stop('TEST_FILE_LEAK');
        else {
          const found = await cleanupProcesses(child, { inspect, release });
          if (found.length) {
            reason = 'TEST_FILE_LEAK';
            onOutput(`TEST_FILE_LEAK: ${file}; found during group cleanup: ${JSON.stringify(found)}\n`);
          }
        }
      } catch (error) { diagnose(error); await stop(reason); }
    }
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
    // The reporter sends Node's own summary over IPC. Neither a mutable exit
    // code nor test-authored TAP-looking console output can erase failures.
    const passed = result.code === 0 && counts?.fail === 0 && counts.cancelled === 0 && !reason && !spawnError && !inspectionFailure;
    onOutput(`-- client file ${passed ? 'ok' : 'FAIL'}: ${file} (${elapsed} ms)\n`);
    return { file, ...result, passed, reason, inspectionFailure, elapsed, counts, stallMs: timeout, progressCount, lastProgress: progress };
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
