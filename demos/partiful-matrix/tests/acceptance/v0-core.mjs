import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeMachineReport } from '../../../_kit/harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const option = (name) => { const at = process.argv.indexOf(`--${name}`); return at < 0 ? null : process.argv[at + 1]; };
const output = option('out') ?? 'demos/partiful-matrix/acceptance/results/step0-v0-core.json';
const todoReceipt = resolve(repoRoot, 'demos/partiful-matrix/acceptance/results/step0-v0-todo.json');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const identity = (path) => ({ path, sha256: sha256(readFileSync(resolve(repoRoot, path))) });

// @ref LLP 0020#phase-0-freeze-the-good-v0-facts — Step 0 preserves the
// existing v0 facts as executable, retained evidence before lifecycle work.
const commands = [
  {
    id: 'todo-headless',
    command: process.execPath,
    args: ['demos/todo/tests/acceptance/headless.mjs', '--receipt', todoReceipt],
  },
  {
    id: 'capability-v0',
    command: 'cargo',
    args: ['test', '--test', 'capability_v0'],
  },
  {
    id: 'generated-artifact-freshness',
    command: 'scripts/check-generated-artifacts',
    args: [],
  },
];

const results = [];
rmSync(todoReceipt, { force: true });
for (const item of commands) {
  console.error(`[partitime/v0-core] ${item.id}`);
  const run = spawnSync(item.command, item.args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const stdout = run.stdout ?? '';
  const stderr = run.stderr ?? '';
  results.push({
    id: item.id,
    command: [item.command, ...item.args],
    status: run.status,
    signal: run.signal,
    stdoutSha256: sha256(stdout),
    stderrSha256: sha256(stderr),
    stdoutTail: stdout.trim().split('\n').slice(-8),
    stderrTail: stderr.trim().split('\n').filter(Boolean).slice(-8),
  });
  if (run.status !== 0) break;
}

let todoChild = null;
let todoChildError = null;
try {
  if (!existsSync(todoReceipt)) throw new Error('Todo child receipt was not written');
  const bytes = readFileSync(todoReceipt);
  const child = JSON.parse(bytes);
  if (child.ok !== true || child.outcome !== 'pass') throw new Error('Todo child receipt did not pass');
  if (child.schemaVersion !== 'snapback.todo-v0-receipt.v1') throw new Error('Todo child receipt schema drifted');
  if (child.total !== 24 || child.expectedChecks !== 24) throw new Error('Todo child receipt was short');
  if (child.cleanupErrorCount !== 0 || child.cleanupErrors.length !== 0) throw new Error('Todo child cleanup failed');
  todoChild = {
    path: 'demos/partiful-matrix/acceptance/results/step0-v0-todo.json',
    sha256: sha256(bytes),
    schemaVersion: child.schemaVersion ?? null,
    total: child.total,
    expectedChecks: child.expectedChecks,
  };
} catch (error) {
  todoChildError = error instanceof Error ? error.message : String(error);
}

const commandsPassed = results.length === commands.length && results.every(({ status }) => status === 0);
const aggregatePassed = commandsPassed && todoChild !== null;

const report = {
  schemaVersion: 'partitime.v0-core-receipt.v1',
  claimIds: [
    'STEP0.V0_DIAGNOSTICS',
    'STEP0.V0_RESET_SEED',
    'STEP0.V0_ATOMIC_SUBSCRIBE',
    'STEP0.V0_DELIVERY_CONTROL',
    'STEP0.V0_CAPABILITY_GAPS',
    'STEP0.V0_ARTIFACT_FRESHNESS',
  ],
  ok: aggregatePassed,
  outcome: aggregatePassed ? 'pass' : 'fail',
  requiredCommandCount: commands.length,
  executedCommandCount: results.length,
  results,
  children: todoChild === null ? [] : [todoChild],
  childError: todoChildError,
  testInventory: [
    'demos/partiful-matrix/tests/acceptance/v0-core.mjs',
    'demos/todo/tests/acceptance/headless.mjs',
    'demos/_kit/harness.mjs',
    'tests/capability_v0.rs',
    'scripts/check-generated-artifacts',
  ].map(identity),
};
writeMachineReport(resolve(repoRoot, output), report);
console.log(JSON.stringify(report));
process.exit(report.ok ? 0 : 1);
