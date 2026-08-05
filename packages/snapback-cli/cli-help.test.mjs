import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PACKAGED_CLI_COMMANDS, PACKAGED_CLI_SUBCOMMANDS } from './index.mjs';

const packageDir = dirname(fileURLToPath(import.meta.url));
const cli = join(packageDir, 'cli.mjs');
const source = readFileSync(join(packageDir, 'index.mjs'), 'utf8');

// Derive the package-owned dispatch inventory from the branches in runCli.
// A callable top-level branch cannot land without being named by composed help.
const runCliSource = source.slice(
  source.indexOf('export async function runCli'),
  source.indexOf('const runtime = resolveRuntimeBinary(options);', source.indexOf('export async function runCli')),
);
const dispatched = new Set();
for (const line of runCliSource.split('\n').filter((candidate) => candidate.startsWith('  if (command ==='))) {
  for (const match of line.matchAll(/command === '([^']+)'/g)) {
    if (!['--help', '-h', 'help'].includes(match[1])) dispatched.add(match[1]);
  }
}
assert.deepEqual(
  [...dispatched].sort(),
  PACKAGED_CLI_COMMANDS.map(({ name }) => name).sort(),
  'composed help registry must equal the mechanically derived package dispatch set',
);

const root = realpathSync(mkdtempSync(join(tmpdir(), 'snapback-cli-help-')));
try {
  const native = join(root, 'snapback-native');
  writeFileSync(native, `#!/bin/sh
if [ "$1" = "--help" ]; then
  printf '%s\\n' 'Native Snapback help' 'Commands:' '  start' '  stop' '  admin' '  mcp'
  exit 0
fi
if [ "$2" = "--help" ]; then
  printf 'Native help for %s\\n' "$1"
  exit 0
fi
printf '%s\\n' 'EXECUTED' >&2
exit 97
`);
  chmodSync(native, 0o755);
  const env = { ...process.env, SNAPBACK_RUNTIME_BINARY: native };

  const rootHelp = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8', env });
  assert.equal(rootHelp.status, 0, rootHelp.stderr);
  for (const { name } of PACKAGED_CLI_COMMANDS) {
    assert.match(rootHelp.stdout, new RegExp(`^  ${name}\\s`, 'm'), `root help omits ${name}`);
  }
  for (const name of ['start', 'stop', 'admin', 'mcp']) {
    assert.match(rootHelp.stdout, new RegExp(`^  ${name}$`, 'm'), `root help omits native ${name}`);
  }

  for (const entry of PACKAGED_CLI_COMMANDS) {
    const help = spawnSync(process.execPath, [cli, entry.name, '--help'], { encoding: 'utf8', env });
    assert.equal(help.status, 0, `${entry.name} --help failed: ${help.stderr}`);
    assert.match(help.stdout, new RegExp(`^Usage: ${entry.usage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
    assert.match(help.stdout, /^Lifecycle:/m);
    assert.match(help.stdout, /^Machine output:/m);
    assert.match(help.stdout, /^Exit taxonomy:/m);
    assert.match(help.stdout, /^Recovery:/m);
    assert.doesNotMatch(`${help.stdout}\n${help.stderr}`, /EXECUTED/);
  }

  for (const entry of PACKAGED_CLI_SUBCOMMANDS) {
    const help = spawnSync(process.execPath, [cli, ...entry.path, '--help'], { encoding: 'utf8', env });
    assert.equal(help.status, 0, `${entry.name} --help failed: ${help.stderr}`);
    assert.match(help.stdout, new RegExp(`^Usage: ${entry.usage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
    assert.doesNotMatch(`${help.stdout}\n${help.stderr}`, /EXECUTED/);
  }

  const backupPlanHelp = spawnSync(process.execPath, [cli, 'backup', 'create', 'plan', '--help'], { encoding: 'utf8', env });
  assert.equal(backupPlanHelp.status, 0, backupPlanHelp.stderr);
  for (const flag of ['--target', '--reason', '--retention-policy', '--operation-id', '--control-root', '--json']) {
    assert.match(backupPlanHelp.stdout, new RegExp(flag), `backup create plan help omits ${flag}`);
  }
  assert.doesNotMatch(backupPlanHelp.stdout, /<create\|list\|verify>/, 'nested backup help fell back to top-level backup usage');

  const lifecycleHelp = spawnSync(process.execPath, [cli, 'hosted', 'lifecycle', '--help'], { encoding: 'utf8', env });
  assert.equal(lifecycleHelp.status, 0, lifecycleHelp.stderr);
  for (const flag of ['--request', '--operator-request', '--supervisor', '--client-key', '--client-cert', '--server-ca', '--root-public-key', '--server-certificate-sha256', '--json']) {
    assert.match(lifecycleHelp.stdout, new RegExp(flag), `hosted lifecycle help omits ${flag}`);
  }
  for (const verb of ['acquire-lease', 'activate-generation', 'restore-backup-inactive', 'release-lease']) {
    assert.match(lifecycleHelp.stdout, new RegExp(verb), `hosted lifecycle help omits ${verb}`);
  }
  assert.match(lifecycleHelp.stdout, /Availability: disabled/, 'hosted lifecycle help must expose the current carrier gate');

  const lifecycleVerbJson = spawnSync(
    process.execPath,
    [cli, 'hosted', 'lifecycle', 'acquire-lease', '--help', '--json'],
    { encoding: 'utf8', env },
  );
  assert.equal(lifecycleVerbJson.status, 0, lifecycleVerbJson.stderr);
  const parsedLifecycleVerb = JSON.parse(lifecycleVerbJson.stdout);
  assert.equal(parsedLifecycleVerb.scope, 'subcommand');
  assert.equal(parsedLifecycleVerb.command.name, 'hosted lifecycle acquire-lease');
  assert.match(parsedLifecycleVerb.command.usage, /lifecycle acquire-lease .*--request/);

  const helpVerb = spawnSync(process.execPath, [cli, 'help', 'backup', 'create', 'plan'], { encoding: 'utf8', env });
  assert.equal(helpVerb.status, 0, helpVerb.stderr);
  assert.match(helpVerb.stdout, /^Usage: snapback backup create plan .*--retention-policy/m);

  const nativeHelp = spawnSync(process.execPath, [cli, 'start', '--help'], { encoding: 'utf8', env });
  assert.equal(nativeHelp.status, 0, nativeHelp.stderr);
  assert.match(nativeHelp.stdout, /Native help for start/);

  const jsonHelp = spawnSync(process.execPath, [cli, 'dev', '--help', '--json'], { encoding: 'utf8', env });
  assert.equal(jsonHelp.status, 0, jsonHelp.stderr);
  const parsed = JSON.parse(jsonHelp.stdout);
  assert.equal(parsed.schemaVersion, 'snapback.cli-help.v1');
  assert.equal(parsed.command.name, 'dev');

  // A held-open stdin must not make help wait for input. spawnSync above
  // covers the ordinary closed-input probe; the help path never inspects TTY
  // state, so both projections execute the same pre-dispatch branch.
  const held = spawn(process.execPath, [cli, 'doctor', '--help'], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let heldOutput = '';
  held.stdout.setEncoding('utf8');
  held.stdout.on('data', (chunk) => { heldOutput += chunk; });
  const heldExit = await Promise.race([
    new Promise((resolveExit) => held.once('exit', resolveExit)),
    new Promise((_, reject) => setTimeout(() => reject(new Error('help waited on held-open stdin')), 2_000)),
  ]);
  assert.equal(heldExit, 0);
  assert.match(heldOutput, /^Usage: snapback doctor/m);

  console.log('cli-help.test.mjs: dispatch parity and non-executing root/per-command/nested help pass');
} finally {
  rmSync(root, { recursive: true, force: true });
}
