#!/usr/bin/env node
// @ref LLP 3000#publication-suite-under-contention — a watchdog outside each
// test process also bounds blocked JS and leaked handles after a failed test.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, openSync, closeSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { identity, live, records, cleanupProcesses } from './test-processes.mjs';

export const FILE_TIMEOUT_MS = 15 * 60_000;
export const MODEL_TIMEOUT_MS = 30 * 60_000;
const preload = fileURLToPath(new URL('./test-processes.mjs', import.meta.url));

export async function runFile(file, { timeout = FILE_TIMEOUT_MS, nodeArgs = [], env: overrides = {}, onOutput = text => process.stdout.write(text), onStart = () => {}, signal } = {}) {
  const temp = mkdtempSync(join(tmpdir(), 'sb4-test-file-'));
  const registry = join(temp, 'processes.jsonl'), output = join(temp, 'output.log');
  const fd = openSync(output, 'w');
  const env = { ...process.env, ...overrides, SNAPBACK4_TEST_PROCESS_LOG: registry };
  delete env.NODE_TEST_CONTEXT;
  const started = performance.now();
  onOutput(`-- client file start: ${file}; limit ${timeout} ms\n`);
  const child = spawn(process.execPath, ['--import', preload, '--test', '--test-reporter=tap', ...nodeArgs, resolve(file)], {
    env, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const owner = identity(child.pid);
  let tail = '', reason, cleanup, spawnError;
  const capture = b => { writeSync(fd, b); tail = (tail + b).slice(-16384); };
  child.stdout.on('data', capture); child.stderr.on('data', capture);
  child.on('error', error => { spawnError = error; });
  const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  let forcedClose;
  const forced = new Promise(resolve => { forcedClose = resolve; });
  const stop = why => {
    if (cleanup) return cleanup;
    reason = why;
    const owned = [...(owner ? [owner] : []), ...records(registry)];
    onOutput(`\n${why}: ${file}; ${Math.round(performance.now() - started)} ms elapsed; limit ${timeout} ms\n` +
      `owned processes: ${JSON.stringify(owned.filter(live))}\nlast output:\n${tail}\n`);
    cleanup = cleanupProcesses(owned);
    // The close event normally follows reaping. Retain cleanup errors without
    // throwing from the timer callback or dropping the file's failure report.
    cleanup.then(() => forcedClose({ code: null, signal: 'SIGKILL' }), () => forcedClose({ code: null, signal: 'SIGKILL' }));
    return cleanup;
  };
  const abort = () => { void stop('TEST_FILE_ABORT'); };
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => { void stop('TEST_FILE_HANG'); }, timeout);
  onStart(child);
  try {
    const result = await Promise.race([closed, forced]);
    clearTimeout(timer);
    if (cleanup) await cleanup;
    else {
      const remaining = records(registry).filter(live);
      if (remaining.length) { await stop('TEST_FILE_LEAK'); await cleanup; }
    }
    const text = readFileSync(output, 'utf8');
    onOutput(text);
    if (spawnError) onOutput(String(spawnError) + '\n');
    const elapsed = Math.round(performance.now() - started);
    const passed = result.code === 0 && !reason && !spawnError;
    const counts = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(key =>
      [key, Number(text.match(new RegExp(`^# ${key} (\\d+)$`, 'm'))?.[1] ?? 0)]));
    onOutput(`-- client file ${passed ? 'ok' : 'FAIL'}: ${file} (${elapsed} ms)\n`);
    return { file, ...result, passed, reason, elapsed, counts };
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
    if (reason) { child.stdout.destroy(); child.stderr.destroy(); child.unref(); }
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
      try { results.push(await runFile(file, { timeout: mode === 'models' ? MODEL_TIMEOUT_MS : FILE_TIMEOUT_MS, signal: abort.signal })); }
      catch (error) { console.error(`TEST_FILE_RUNNER: ${file}: ${error.stack}`); results.push({ file, passed: false }); }
    }
  }));
  const failures = results.filter(row => !row.passed).length + queue.length;
  const counts = {};
  for (const result of results) for (const [key, count] of Object.entries(result.counts ?? {})) counts[key] = (counts[key] ?? 0) + count;
  console.log(`-- client files: ${results.length}/${args.length}; failed ${failures}; tests ${JSON.stringify(counts)}`);
  process.exitCode = failures ? 1 : 0;
}
