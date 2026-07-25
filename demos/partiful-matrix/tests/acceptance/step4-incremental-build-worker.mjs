#!/usr/bin/env bun

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// @ref LLP 0063#workstream-8--performance-and-packaging-budgets — Contract's
// TypeScript Vite configuration is loaded by its declared Bun toolchain while
// the measured interval remains Vite's watcher event clock, not process time.

const option = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? null : process.argv[at + 1];
};
const surface = option('surface');
const configFile = option('config');
const mode = option('backend');
const outDir = option('out-dir');
const probe = option('probe');
const warmups = Number(option('warmups'));
const samples = Number(option('samples'));
const debug = process.env.PARTITIME_INCREMENTAL_DEBUG === '1';
const trace = (value) => { if (debug) process.stderr.write(`${JSON.stringify(value)}\n`); };
assert(surface && configFile && mode && outDir && probe, 'incremental worker arguments are incomplete');
assert(Number.isInteger(warmups) && warmups >= 0);
assert(Number.isInteger(samples) && samples > 0);

const viteEntry = join(surface, 'node_modules', 'vite', 'dist', 'node', 'index.js');
const { build } = await import(pathToFileURL(viteEntry).href);
let waiting = null;
let bundleStartedAt = null;
let bundleSequence = 0;
let activeBundleSequence = 0;
let markInitialBuildStarted;
const initialBuildStarted = new Promise((resolveStarted) => { markInitialBuildStarted = resolveStarted; });
let markInitialBuildClosed;
let failInitialBuild;
const initialBuildClosed = new Promise((resolveClosed, rejectClosed) => {
  markInitialBuildClosed = resolveClosed;
  failInitialBuild = rejectClosed;
});
const plugin = {
  name: 'partitime-incremental-build-probe',
  buildStart() {
    this.addWatchFile(probe);
    markInitialBuildStarted?.();
    markInitialBuildStarted = null;
  },
  closeBundle() {
    markInitialBuildClosed?.();
    markInitialBuildClosed = null;
  },
};
const watcher = await build({
  root: surface,
  configFile,
  mode,
  build: { watch: {}, outDir, emptyOutDir: true },
  plugins: [plugin],
  logLevel: 'silent',
});
watcher.on('event', (event) => {
  trace({
    event: event.code,
    bundleSequence,
    activeBundleSequence,
    waiting: waiting?.targetSequence ?? null,
    error: event.code === 'ERROR' ? String(event.error?.stack ?? event.error) : null,
  });
  if (event.code === 'BUNDLE_START') {
    bundleStartedAt = process.hrtime.bigint();
    activeBundleSequence = ++bundleSequence;
  }
  if (event.code === 'ERROR') {
    if (waiting) waiting.reject(event.error);
    else failInitialBuild?.(event.error);
  }
  if (event.code !== 'BUNDLE_END') return;
  event.result?.close?.();
  if (!waiting || activeBundleSequence < waiting.targetSequence) return;
  const value = {
    durationMs: Number.isFinite(event.duration)
      ? event.duration
      : Number(process.hrtime.bigint() - bundleStartedAt) / 1_000_000,
  };
  const resolveWaiting = waiting.resolve;
  waiting = null;
  resolveWaiting(value);
});
const nextBuild = () => new Promise((resolveBuild, reject) => {
  waiting = { resolve: resolveBuild, reject, targetSequence: bundleSequence + 1 };
});

const events = [];
try {
  await initialBuildStarted;
  trace({ milestone: 'initial-build-started' });
  await initialBuildClosed;
  trace({ milestone: 'initial-build-closed' });
  await new Promise((resolveSettle) => setTimeout(resolveSettle, 250));
  for (let index = 0; index < warmups + samples; index += 1) {
    const completion = nextBuild();
    trace({ milestone: 'probe-write', index, targetSequence: waiting?.targetSequence ?? null });
    writeFileSync(probe, `${index + 1}\n`);
    const value = await completion;
    if (index >= warmups) events.push(value);
  }
} finally {
  await watcher.close();
}
process.stdout.write(JSON.stringify(events));
