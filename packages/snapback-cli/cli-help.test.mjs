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
import { VERIFY_RECEIPT_SCHEMA_VERSION } from './verify.mjs';

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
    if (!['--help', '-h', 'help', '--version', '-V'].includes(match[1])) dispatched.add(match[1]);
  }
}
// A command may be package-owned outright, or natively owned with a few
// package-owned verbs (`snapback auth enable|configure|status`). Either way the
// dispatch branch must be named by composed help — as a command, or as the root
// of a registered subcommand path.
const composedHelpRoots = new Set([
  ...PACKAGED_CLI_COMMANDS.map(({ name }) => name),
  ...PACKAGED_CLI_SUBCOMMANDS.map(({ path }) => path[0]),
]);
assert.deepEqual(
  [...dispatched].sort(),
  [...composedHelpRoots].sort(),
  'composed help registry must equal the mechanically derived package dispatch set',
);
assert.equal(
  PACKAGED_CLI_COMMANDS.find(({ name }) => name === 'verify').output,
  `${VERIFY_RECEIPT_SCHEMA_VERSION} receipt`,
  'verify help must bind its output claim to the exported receipt schema constant',
);

const root = realpathSync(mkdtempSync(join(tmpdir(), 'snapback-cli-help-')));
try {
  const native = join(root, 'snapback-native');
  writeFileSync(native, `#!/bin/sh
if [ "$1" = "--help" ]; then
  printf '%s\\n' 'Native Snapback help' 'Commands:' '  start' '  stop' '  admin' '  guide' '  mcp' '' 'Documentation:' '  snapback guide [QUERY]' '  snapback mcp'
  exit 0
fi
if [ "$1" = "command-inventory" ]; then
  printf '%s\n' '{"schemaVersion":"snapback.native-command-inventory.v1","ok":true,"root":{"name":"snapback","path":["snapback"],"arguments":[],"subcommands":[{"name":"start","path":["snapback","start"],"arguments":[],"subcommands":[]},{"name":"admin","path":["snapback","admin"],"arguments":[],"subcommands":[]},{"name":"auth","path":["snapback","auth"],"arguments":[],"subcommands":[{"name":"password","path":["snapback","auth","password"],"arguments":[],"subcommands":[{"name":"reset","path":["snapback","auth","password","reset"],"arguments":[],"subcommands":[]},{"name":"unlock","path":["snapback","auth","password","unlock"],"arguments":[],"subcommands":[]}]}]}]}}'
  exit 0
fi
if [ "$2" = "--help" ]; then
  printf 'Native help for %s\\n' "$1"
  exit 0
fi
if [ "$1" = "auth" ] && [ "$2" = "password" ] && [ "$3" = "--help" ]; then
  printf '%s\\n' 'Native help for auth password' 'Usage: snapback auth password <command>'
  exit 0
fi
if [ "$1" = "auth" ] && [ "$2" = "password" ] && [ "$3" = "reset" ] && [ "$4" = "--help" ]; then
  printf '%s\\n' 'Native help for auth password reset' 'Usage: snapback auth password reset [OPTIONS]'
  exit 0
fi
if [ "$1" = "auth" ] && [ "$2" = "password" ] && [ "$3" = "unlock" ] && [ "$4" = "--help" ]; then
  printf '%s\\n' 'Native help for auth password unlock' 'Usage: snapback auth password unlock [OPTIONS]'
  exit 0
fi
if [ "$1" = "auth" ] && [ "$2" = "password" ] && [ "$3" = "unlock" ]; then
  if [ "$SNAPBACK_ADMIN_TOKEN" != "file-admin-token" ]; then
    printf '%s\\n' 'unlock did not receive the file-carried admin token' >&2
    exit 96
  fi
  shift 3
  printf 'DELEGATED %s\\n' "$*"
  exit 0
fi
printf '%s\\n' 'EXECUTED' >&2
exit 97
`);
  chmodSync(native, 0o755);
  const env = { ...process.env, SNAPBACK_RUNTIME_BINARY: native };

  const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  const version = spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8', env });
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), `snapback ${manifest.version}`);

  const bare = spawnSync(process.execPath, [cli], { encoding: 'utf8', env });
  assert.equal(bare.status, 0, bare.stderr);
  assert.match(bare.stdout, /^Usage: snapback <command>/m);
  assert.doesNotMatch(`${bare.stdout}\n${bare.stderr}`, /EXECUTED/);

  const rootHelp = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8', env });
  assert.equal(rootHelp.status, 0, rootHelp.stderr);
  for (const { name } of PACKAGED_CLI_COMMANDS) {
    assert.match(rootHelp.stdout, new RegExp(`^  ${name}\\s`, 'm'), `root help omits ${name}`);
  }
  for (const name of ['start', 'stop', 'admin', 'guide', 'mcp']) {
    assert.match(rootHelp.stdout, new RegExp(`^  ${name}$`, 'm'), `root help omits native ${name}`);
  }
  assert.match(rootHelp.stdout, /^Documentation:$/m, 'root help omits the native documentation channel heading');
  assert.match(rootHelp.stdout, /^  snapback guide \[QUERY\]$/m, 'root help omits Guide browsing and search');
  assert.match(rootHelp.stdout, /^  snapback mcp$/m, 'root help omits Guide MCP');

  for (const entry of PACKAGED_CLI_COMMANDS) {
    if (entry.name === 'auth') continue;
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

  const nativeAuthParentHelp = spawnSync(
    process.execPath,
    [cli, 'auth', '--help'],
    { encoding: 'utf8', env },
  );
  assert.equal(nativeAuthParentHelp.status, 0, nativeAuthParentHelp.stderr);
  assert.match(nativeAuthParentHelp.stdout, /Native help for auth/);

  const nativeAuthHelp = spawnSync(
    process.execPath,
    [cli, 'auth', 'password', '--help'],
    { encoding: 'utf8', env },
  );
  assert.equal(nativeAuthHelp.status, 0, nativeAuthHelp.stderr);
  assert.match(nativeAuthHelp.stdout, /Native help for auth password/);
  assert.doesNotMatch(nativeAuthHelp.stdout, /Mint one explicit ordinary development session/u);

  const nativeResetHelp = spawnSync(
    process.execPath,
    [cli, 'auth', 'password', 'reset', '--url', 'http://ignored.test', '--help'],
    { encoding: 'utf8', env },
  );
  assert.equal(nativeResetHelp.status, 0, nativeResetHelp.stderr);
  assert.match(nativeResetHelp.stdout, /Native help for auth password reset/);
  assert.doesNotMatch(nativeResetHelp.stdout, /Native help for auth password$/mu);

  const nativeUnlockHelp = spawnSync(
    process.execPath,
    [cli, 'help', 'auth', 'password', 'unlock', '--admin-token-file', 'ignored'],
    { encoding: 'utf8', env },
  );
  assert.equal(nativeUnlockHelp.status, 0, nativeUnlockHelp.stderr);
  assert.match(nativeUnlockHelp.stdout, /Native help for auth password unlock/);
  assert.match(nativeUnlockHelp.stdout, /--admin-token-file <path>/u);
  assert.doesNotMatch(nativeUnlockHelp.stdout, /Native help for auth password$/mu);

  const adminTokenFile = join(root, 'admin-token');
  writeFileSync(adminTokenFile, 'file-admin-token\n', { mode: 0o600 });
  const delegatedUnlock = spawnSync(
    process.execPath,
    [
      cli, 'auth', 'password', 'unlock',
      '--url', 'http://snapback.test',
      '--email', 'locked@example.test',
      '--admin-token-file', adminTokenFile,
    ],
    {
      encoding: 'utf8',
      env: { ...env, SNAPBACK_ADMIN_TOKEN: 'planted-wrong-token' },
    },
  );
  assert.equal(delegatedUnlock.status, 0, delegatedUnlock.stderr);
  assert.match(delegatedUnlock.stdout, /DELEGATED --url http:\/\/snapback\.test --email locked@example\.test/u);
  assert.doesNotMatch(`${delegatedUnlock.stdout}\n${delegatedUnlock.stderr}`, /file-admin-token|admin-token-file/u);

  chmodSync(adminTokenFile, 0o644);
  const permissiveTokenFile = spawnSync(
    process.execPath,
    [cli, 'auth', 'password', 'unlock', '--url', 'http://snapback.test', '--email', 'locked@example.test', '--admin-token-file', adminTokenFile],
    { encoding: 'utf8', env },
  );
  assert.equal(permissiveTokenFile.status, 1);
  assert.equal(JSON.parse(permissiveTokenFile.stderr).diagnostics[0].code, 'SNAPBACK_DEV_ADMIN_TOKEN_FILE_INVALID');
  assert.doesNotMatch(permissiveTokenFile.stderr, /file-admin-token/u);

  const guideHelp = spawnSync(process.execPath, [cli, 'guide', '--help'], { encoding: 'utf8', env });
  assert.equal(guideHelp.status, 0, guideHelp.stderr);
  assert.match(guideHelp.stdout, /^Usage: snapback guide <ExactSymbolName\|module> \[--slice <n>\] \[--json\]$/m);
  assert.match(guideHelp.stdout, /fuzzy queries delegate to the native Guide search/);
  assert.doesNotMatch(`${guideHelp.stdout}\n${guideHelp.stderr}`, /EXECUTED/);

  const jsonHelp = spawnSync(process.execPath, [cli, 'dev', '--help', '--json'], { encoding: 'utf8', env });
  assert.equal(jsonHelp.status, 0, jsonHelp.stderr);
  const parsed = JSON.parse(jsonHelp.stdout);
  assert.equal(parsed.schemaVersion, 'snapback.cli-help.v1');
  assert.equal(parsed.command.name, 'dev');
  for (const flag of ['--port <port>', '--client-port <port>', '--bootstrap-port <port>', '--port-range <lo>-<hi>', '--write-env [path]']) {
    assert.match(parsed.command.usage, new RegExp(flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'));
  }

  const authHelp = spawnSync(
    process.execPath,
    [cli, 'auth', 'dev-session', '--help', '--json'],
    { encoding: 'utf8', env },
  );
  assert.equal(authHelp.status, 0, authHelp.stderr);
  const parsedAuthHelp = JSON.parse(authHelp.stdout);
  assert.equal(parsedAuthHelp.command.name, 'auth dev-session');
  assert.equal(
    parsedAuthHelp.command.usage,
    'snapback auth dev-session [--ready-file <path>] [--email <address>] [--json]',
  );
  assert.match(parsedAuthHelp.command.description, /without creating another disk credential/u);

  const rootJsonHelp = spawnSync(process.execPath, [cli, '--help', '--json'], { encoding: 'utf8', env });
  assert.equal(rootJsonHelp.status, 0, rootJsonHelp.stderr);
  const rootJson = JSON.parse(rootJsonHelp.stdout);
  assert.equal(rootJson.nativeInventory.schemaVersion, 'snapback.native-command-inventory.v1');
  assert.deepEqual(rootJson.nativeCommands.map(({ name }) => name), ['start', 'admin', 'auth']);

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

  console.log(`cli-help.test.mjs: ${PACKAGED_CLI_COMMANDS.length} command and ${PACKAGED_CLI_SUBCOMMANDS.length} subcommand help cases passed`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
