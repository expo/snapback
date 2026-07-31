#!/usr/bin/env node

// @ref LLP 0015#acceptance-rules — the workout corpus is one explicit,
// maintained inventory whose suites each retain vacuous-pass protection.

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const suites = [
  'demos/catalog-lens/tests/acceptance/headless.mjs',
  'demos/dispatch-board/tests/acceptance/headless.mjs',
  'demos/pulse-monitor/tests/acceptance/headless.mjs',
  'demos/public-dashboard/tests/acceptance/headless.mjs',
  'demos/public-dashboard/tests/acceptance/offline-local-first.mjs',
  'demos/access-desk/tests/acceptance/headless.mjs',
];

const run = (suite) => new Promise((resolveRun) => {
  const child = spawn(process.execPath, [suite], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });
  child.once('error', (error) => resolveRun({ suite, code: 2, error }));
  child.once('exit', (code, signal) => resolveRun({
    suite,
    code: code ?? 2,
    signal,
  }));
});

const results = [];
for (const suite of suites) {
  console.log(`\n[snapback-workout] ${suite}`);
  results.push(await run(suite));
}

const failed = results.filter(({ code }) => code !== 0);
const report = {
  artifactKind: 'snapback.workout-apps.v1',
  suites: results.map(({ suite, code, signal, error }) => ({
    suite,
    ok: code === 0,
    code,
    signal: signal ?? null,
    error: error?.message ?? null,
  })),
  passed: results.length - failed.length,
  failed: failed.length,
  total: results.length,
  ok: failed.length === 0,
};

console.log('\n--- workout aggregate report ---');
console.log(JSON.stringify(report));
process.exitCode = report.ok ? 0 : 1;
