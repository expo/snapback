// 0137 a4-f2 regression: `snapback dev` must never exit 1 silently.
//
// 1. When the managed loop's first result is not ok (here: a generation
//    failure), the failed envelope reaches the terminal through the same
//    printResult path every other command uses — previously the dev branch
//    returned `result.ok ? 0 : 1` without printing anything.
// 2. A flag-shaped positional (`snapback dev --help`) is rejected with a
//    usage diagnostic instead of being consumed as the backend directory
//    name and silently exiting 1.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scaffoldApp } from './index.mjs';

const packageDir = dirname(fileURLToPath(import.meta.url));
const cli = join(packageDir, 'cli.mjs');

const root = realpathSync(mkdtempSync(join(tmpdir(), 'snapback-dev-diagnostics-')));
try {
  const project = join(root, 'broken-app');
  const scaffolded = scaffoldApp(project, { template: 'todo-contract' });
  assert.equal(scaffolded.ok ?? true, true, `scaffold failed: ${JSON.stringify(scaffolded)}`);

  // Break generation deterministically: a query against an undeclared table.
  writeFileSync(join(project, 'snapback', 'functions.mjs'), `
import { defineQuery } from '@expo/snapback-codegen/define';
export const listGhosts = defineQuery({ table: 'ghosts', args: {} });
`);

  const dev = spawnSync(process.execPath, [cli, 'dev', 'snapback'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SNAPBACK_CRON_DISABLED: '1' },
    timeout: 120_000,
  });
  assert.equal(dev.status, 1, `dev over a failing backend must exit 1, got ${dev.status}`);
  const surfaced = `${dev.stdout}\n${dev.stderr}`;
  assert.notEqual(
    surfaced.trim(),
    '',
    'dev must print the failed result envelope, not exit silently',
  );
  assert.match(
    surfaced,
    /FUNCTION_UNKNOWN_TABLE|"ok":\s*false/,
    `dev must surface the generation diagnostic, got: ${surfaced.slice(0, 2_000)}`,
  );

  const help = spawnSync(process.execPath, [cli, 'dev', '--help'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env },
    timeout: 60_000,
  });
  assert.notEqual(help.status, 0, 'dev --help must not exit 0');
  const helpSurfaced = `${help.stdout}\n${help.stderr}`;
  assert.match(
    helpSurfaced,
    /SNAPBACK_CLI_ARGUMENT_INVALID/,
    `a flag-shaped positional must be rejected loudly, got: ${helpSurfaced.slice(0, 2_000)}`,
  );
  assert.match(helpSurfaced, /usage: snapback dev/, 'the rejection must carry dev usage');

  console.log('dev-cli-diagnostics.test.mjs: all cases passed');
} finally {
  rmSync(root, { recursive: true, force: true });
}
