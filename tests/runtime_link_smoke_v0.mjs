import { strict as assert } from 'node:assert';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  extractMissingSymbols,
  runRuntimeLinkProbe,
  stageLinuxLoaderClosure,
} from '../scripts/runtime-link-smoke.mjs';

function writeExecutable(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

function writeFixture(path, contents = '') {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function probeTempDirectories() {
  return new Set(readdirSync(tmpdir()).filter((name) => name.startsWith('snapback-runtime-link-')));
}

test('Linux exact-link probe stages the public bin/../lib loader closure', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-runtime-link-linux-closure-'));
  try {
    const source = join(scratch, 'vendor', 'ibex', 'linux', 'lib', 'libhermesvm.so');
    const target = join(scratch, 'target');
    writeFixture(source, 'exact Hermes bytes');
    const destination = stageLinuxLoaderClosure(scratch, target, { platform: 'linux' });
    assert.equal(destination, join(target, 'lib', 'libhermesvm.so'));
    assert.equal(readFileSync(destination, 'utf8'), 'exact Hermes bytes');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('missing compatibility symbols produce one exact-link recovery record', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-runtime-link-test-'));
  try {
    writeFileSync(join(scratch, 'Cargo.toml'), '[package]\nname = "snapback"\nversion = "9.8.7"\n');
    writeFileSync(join(scratch, 'Cargo.lock'), '');
    const cargo = join(scratch, 'fake-cargo.mjs');
    writeExecutable(cargo, `#!/usr/bin/env node
if (process.argv[2] === '--version') {
  console.log('cargo 1.99.0-fixture');
  process.exit(0);
}
console.error('Undefined symbols for architecture arm64:');
console.error('  "_ex_hermes_create_no_eval", referenced from:');
console.error('  "_ex_hermes_watch_time_limit", referenced from:');
console.error("undefined reference to \\u0060ex_hermes_unwatch_time_limit'");
process.exit(1);
`);
    const stale = join(scratch, 'target', 'debug', 'snapback');
    writeExecutable(stale, `#!/usr/bin/env node
if (process.argv[2] !== 'build-identity') process.exit(2);
console.log(JSON.stringify({binary:{
  gitCommit:'stale-feedface',
  gitDirty:false,
  crateVersion:'9.8.6',
  buildProfile:'debug'
}}));
`);
    const before = probeTempDirectories();
    const result = await runRuntimeLinkProbe({
      root: scratch,
      cargoCommand: cargo,
      timeoutMs: 5_000,
    });
    assert.equal(result.ok, false);
    assert.equal(result.diagnostic.code, 'SNAPBACK_IBEX_RUNTIME_LINK_FAILED');
    assert.deepEqual(result.diagnostic.details.missingSymbols, [
      'ex_hermes_create_no_eval',
      'ex_hermes_unwatch_time_limit',
      'ex_hermes_watch_time_limit',
    ]);
    assert.equal(result.recovery.schemaVersion, 'snapback.runtime-recovery.v1');
    assert.equal(result.recovery.selectedBinary, stale);
    assert.equal(result.recovery.selectionRung, 'prebuilt');
    assert.equal(result.recovery.currentCheckout.buildable, false);
    assert.equal(result.recovery.currentCheckout.runnable, true);
    assert.equal(result.recovery.actualStamp.gitCommit, 'stale-feedface');
    assert.match(result.recovery.reuse.reason, /automatic reuse refused/);
    assert.equal(
      result.recovery.recovery.overrideCommand,
      `SNAPBACK_SERVER_BINARY=${JSON.stringify(stale)}`,
    );
    assert.deepEqual(probeTempDirectories(), before, 'failure must clean its temporary Cargo target');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('green state links and launches the newly built binary, then cleans it', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-runtime-link-green-'));
  try {
    writeFileSync(join(scratch, 'Cargo.toml'), '[package]\nname = "snapback"\nversion = "1.2.3"\n');
    writeFileSync(join(scratch, 'Cargo.lock'), '');
    if (process.platform === 'linux') {
      writeFixture(
        join(scratch, 'vendor', 'ibex', 'linux', 'lib', 'libhermesvm.so'),
        'fixture Hermes closure',
      );
    }
    const cargo = join(scratch, 'fake-cargo.mjs');
    writeExecutable(cargo, `#!/usr/bin/env node
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
if (process.argv[2] === '--version') {
  console.log('cargo 1.99.0-fixture');
  process.exit(0);
}
const index = process.argv.indexOf('--target-dir');
const binary = join(process.argv[index + 1], 'debug', 'snapback');
mkdirSync(dirname(binary), {recursive:true});
writeFileSync(binary, \`#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
${process.platform === 'linux' ? "if (!existsSync(join(dirname(process.argv[1]), '..', 'lib', 'libhermesvm.so'))) process.exit(9);" : ''}
if (process.argv[2] === 'runtime-qualify') {
  console.log(JSON.stringify({
    schemaVersion:'snapback.runtime-qualify.v1',
    probe:'restricted-no-eval-handler-vm',
    ok:true,
    binary:{gitCommit:'current-cafebabe',gitDirty:true,crateVersion:'1.2.3',buildProfile:'debug'}
  }));
  process.exit(0);
}
console.log(JSON.stringify({binary:{
  gitCommit:'current-cafebabe',
  gitDirty:true,
  crateVersion:'1.2.3',
  buildProfile:'debug'
}}));
\`);
chmodSync(binary, 0o755);
`);
    const before = probeTempDirectories();
    const result = await runRuntimeLinkProbe({
      root: scratch,
      cargoCommand: cargo,
      timeoutMs: 5_000,
    });
    assert.equal(result.ok, true, JSON.stringify(result.diagnostic));
    assert.equal(result.diagnostic.code, 'SNAPBACK_IBEX_RUNTIME_LINK_OK');
    assert.equal(result.recovery.currentCheckout.buildable, true);
    assert.equal(result.recovery.currentCheckout.runnable, true);
    assert.equal(result.recovery.qualification.ok, true);
    assert.equal(result.recovery.qualification.probe, 'restricted-no-eval-handler-vm');
    assert.equal(result.recovery.actualStamp.gitCommit, 'current-cafebabe');
    assert.deepEqual(probeTempDirectories(), before, 'success must clean its temporary Cargo target');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('a launchable binary that cannot create the armed handler VM is never LINK_OK', async () => {
  // issues/20260730-bootstrap-smoke-does-not-create-armed-handler-vm: the
  // exact reproduced state — link succeeds, the binary launches with loader
  // overrides scrubbed, but every JS handler would refuse at
  // RuntimeGuard::create because the selected Hermes framework lacks the
  // promise-rejection checkpoint contract the linked glue requires.
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-runtime-link-vm-refused-'));
  try {
    writeFileSync(join(scratch, 'Cargo.toml'), '[package]\nname = "snapback"\nversion = "1.2.3"\n');
    writeFileSync(join(scratch, 'Cargo.lock'), '');
    if (process.platform === 'linux') {
      writeFixture(
        join(scratch, 'vendor', 'ibex', 'linux', 'lib', 'libhermesvm.so'),
        'fixture Hermes closure',
      );
    }
    const cargo = join(scratch, 'fake-cargo.mjs');
    writeExecutable(cargo, `#!/usr/bin/env node
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
if (process.argv[2] === '--version') {
  console.log('cargo 1.99.0-fixture');
  process.exit(0);
}
const index = process.argv.indexOf('--target-dir');
const binary = join(process.argv[index + 1], 'debug', 'snapback');
mkdirSync(dirname(binary), {recursive:true});
writeFileSync(binary, \`#!/usr/bin/env node
if (process.argv[2] === 'runtime-qualify') {
  console.error('Armed startup refused: Hermes promise rejection checkpoint tracking is unavailable');
  console.log(JSON.stringify({
    schemaVersion:'snapback.runtime-qualify.v1',
    probe:'restricted-no-eval-handler-vm',
    ok:false,
    binary:{gitCommit:'current-cafebabe',gitDirty:true,crateVersion:'1.2.3',buildProfile:'debug'},
    diagnostic:{code:'SNAPBACK_RUNTIME_CREATE_FAILED',severity:'error',subsystem:'runtime',message:'Ibex runtime could not be created',details:{}}
  }));
  process.exit(1);
}
console.log(JSON.stringify({binary:{
  gitCommit:'current-cafebabe',
  gitDirty:true,
  crateVersion:'1.2.3',
  buildProfile:'debug'
}}));
\`);
chmodSync(binary, 0o755);
`);
    const before = probeTempDirectories();
    const result = await runRuntimeLinkProbe({
      root: scratch,
      cargoCommand: cargo,
      timeoutMs: 5_000,
    });
    assert.equal(result.ok, false, 'a launchable but VM-refusing binary must not pass');
    assert.equal(result.diagnostic.code, 'SNAPBACK_IBEX_RUNTIME_VM_CREATE_FAILED');
    assert.match(result.diagnostic.message, /handler VM/);
    assert.equal(result.recovery.currentCheckout.buildable, true);
    assert.equal(result.recovery.currentCheckout.runnable, true);
    assert.equal(result.recovery.qualification.ok, false);
    assert.equal(result.recovery.qualification.report.diagnostic.code, 'SNAPBACK_RUNTIME_CREATE_FAILED');
    assert.equal(result.recovery.reuse.allowed, false);
    assert.match(result.recovery.reuse.reason, /armed handler VM/);
    assert.ok(result.diagnostic.details.producerInputs, 'framework digests must ride the failure record');
    assert.deepEqual(probeTempDirectories(), before, 'failure must clean its temporary Cargo target');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('a caller-owned target directory is never recursively deleted', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-runtime-link-owned-target-'));
  const target = join(scratch, 'caller-target');
  const sentinel = join(target, 'do-not-delete.txt');
  try {
    writeFixture(sentinel, 'owned by the caller');
    await assert.rejects(
      runRuntimeLinkProbe({
        root: scratch,
        cargoCommand: join(scratch, 'must-not-run'),
        targetDirectory: target,
        keepTarget: false,
      }),
      (error) => {
        assert.equal(error.code, 'SNAPBACK_IBEX_RUNTIME_LINK_TARGET_NOT_OWNED');
        return true;
      },
    );
    assert.equal(existsSync(sentinel), true, 'the probe must preserve caller-owned target contents');
    const cli = spawnSync(process.execPath, [
      new URL('../scripts/runtime-link-smoke.mjs', import.meta.url).pathname,
      '--target-dir',
      target,
      '--json',
    ], { cwd: scratch, encoding: 'utf8' });
    assert.notEqual(cli.status, 0);
    assert.match(cli.stderr, /--target-dir requires --keep-target/);
    assert.equal(existsSync(sentinel), true, 'CLI argument refusal must also preserve caller contents');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('timeout is coded and still cleans the temporary Cargo target', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-runtime-link-timeout-'));
  try {
    writeFileSync(join(scratch, 'Cargo.toml'), '[package]\nname = "snapback"\nversion = "1.2.3"\n');
    writeFileSync(join(scratch, 'Cargo.lock'), '');
    const cargo = join(scratch, 'fake-cargo.mjs');
    writeExecutable(cargo, `#!/usr/bin/env node
if (process.argv[2] === '--version') {
  console.log('cargo 1.99.0-fixture');
  process.exit(0);
}
setInterval(() => {}, 1_000);
`);
    const before = probeTempDirectories();
    const result = await runRuntimeLinkProbe({
      root: scratch,
      cargoCommand: cargo,
      timeoutMs: 50,
    });
    assert.equal(result.ok, false);
    assert.equal(result.diagnostic.code, 'SNAPBACK_IBEX_RUNTIME_LINK_TIMEOUT');
    assert.equal(result.recovery.currentCheckout.buildable, false);
    assert.deepEqual(probeTempDirectories(), before);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('SIGTERM interrupts the Cargo process group and cleans the temporary target', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-runtime-link-signal-'));
  try {
    const bin = join(scratch, 'bin');
    const cargo = join(bin, 'cargo');
    const marker = join(scratch, 'cargo-started');
    const isolatedTmp = join(scratch, 'tmp');
    mkdirSync(isolatedTmp, { recursive: true });
    writeExecutable(cargo, `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
if (process.argv[2] === '--version') {
  console.log('cargo 1.99.0-fixture');
  process.exit(0);
}
writeFileSync(process.env.PROBE_MARKER, 'started');
setInterval(() => {}, 1_000);
`);
    let stdout = '';
    let stderr = '';
    const child = spawn(process.execPath, [new URL('../scripts/runtime-link-smoke.mjs', import.meta.url).pathname, '--json'], {
      cwd: new URL('..', import.meta.url).pathname,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        PROBE_MARKER: marker,
        TMPDIR: isolatedTmp,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const deadline = Date.now() + 5_000;
    while (!existsSync(marker) && Date.now() < deadline) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    }
    assert(existsSync(marker), `fake Cargo did not start: ${stderr}`);
    child.kill('SIGTERM');
    const exit = await new Promise((resolveExit) => {
      child.once('close', (status, signal) => resolveExit({ status, signal }));
    });
    assert.equal(exit.status, 1, stderr);
    assert.equal(exit.signal, null);
    const report = JSON.parse(stdout);
    assert.equal(report.diagnostic.code, 'SNAPBACK_IBEX_RUNTIME_LINK_INTERRUPTED');
    assert.deepEqual(
      readdirSync(isolatedTmp).filter((name) => name.startsWith('snapback-runtime-link-')),
      [],
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('symbol extraction handles Darwin and GNU linker spellings', () => {
  assert.deepEqual(
    extractMissingSymbols(`
      "_ex_one", referenced from:
      undefined reference to \`ex_two'
      undefined symbol: _ex_three
    `),
    ['ex_one', 'ex_three', 'ex_two'],
  );
  assert.deepEqual(
    extractMissingSymbols('warning: source mentions ex_not_a_link_failure'),
    [],
    'an ordinary compile diagnostic must not be mislabeled as a link failure',
  );
});

test('repository doctor surfaces the exact-link failure and recovery record', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-ibex-doctor-link-'));
  try {
    const scripts = join(scratch, 'scripts');
    const runtimeModule = join(scratch, 'packages', 'snapback-cli', 'runtime-recovery.mjs');
    mkdirSync(scripts, { recursive: true });
    mkdirSync(dirname(runtimeModule), { recursive: true });
    copyFileSync(new URL('../scripts/ibex-doctor', import.meta.url), join(scripts, 'ibex-doctor'));
    copyFileSync(new URL('../scripts/runtime-link-smoke.mjs', import.meta.url), join(scripts, 'runtime-link-smoke.mjs'));
    copyFileSync(new URL('../packages/snapback-cli/runtime-recovery.mjs', import.meta.url), runtimeModule);
    chmodSync(join(scripts, 'ibex-doctor'), 0o755);
    chmodSync(join(scripts, 'runtime-link-smoke.mjs'), 0o755);
    writeFileSync(join(scratch, 'Cargo.toml'), '[package]\nname = "snapback"\nversion = "1.2.3"\n');
    writeFileSync(join(scratch, 'Cargo.lock'), '');
    const vendor = join(scratch, 'vendor', 'ibex');
    writeFixture(join(vendor, 'Cargo.toml'), '[package]\nname = "ibex-runtime"\nversion = "1.0.0"\n');
    if (process.platform === 'darwin') {
      writeFixture(join(vendor, 'ios', 'Frameworks', 'hermes-headers', 'hermes', 'hermes.h'));
      writeFixture(join(vendor, 'ios', 'Frameworks', 'hermesvm.framework', 'hermesvm'));
      writeFixture(join(vendor, 'tools', 'hermes', 'hermesc'));
    } else if (process.platform === 'linux') {
      writeFixture(join(vendor, 'linux', 'hermes-headers', 'hermes', 'hermes.h'));
      writeFixture(join(vendor, 'linux', 'lib', 'libhermesvm.so'));
      writeFixture(join(vendor, 'tools', 'hermes', 'hermesc'));
    } else {
      return;
    }
    const stale = join(scratch, 'target', 'debug', 'snapback');
    writeExecutable(stale, `#!/usr/bin/env node
if (process.argv[2] === 'build-identity') {
  console.log(JSON.stringify({binary:{
    gitCommit:'stale-doctor',
    gitDirty:false,
    crateVersion:'1.2.2',
    buildProfile:'debug'
  }}));
  process.exit(0);
}
process.exit(process.argv[2] === '--help' ? 0 : 2);
`);
    const bin = join(scratch, 'bin');
    const cargo = join(bin, 'cargo');
    writeExecutable(cargo, `#!/usr/bin/env node
if (process.argv[2] === '--version') {
  console.log('cargo 1.99.0-fixture');
  process.exit(0);
}
console.error('Undefined symbols for architecture arm64:');
console.error('  "_ex_hermes_create_no_eval", referenced from:');
console.error('  "_ex_hermes_watch_time_limit", referenced from:');
console.error('  "_ex_hermes_unwatch_time_limit", referenced from:');
process.exit(1);
`);
    const before = probeTempDirectories();
    const result = spawnSync(join(scripts, 'ibex-doctor'), ['--json'], {
      cwd: scratch,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      timeout: 20_000,
    });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, false);
    assert(
      report.checks.some((check) => check.code === 'SNAPBACK_IBEX_RUNTIME_LINK_FAILED'),
      JSON.stringify(report),
    );
    assert.equal(report.runtimeRecovery.schemaVersion, 'snapback.runtime-recovery.v1');
    assert.equal(report.runtimeRecovery.selectedBinary, realpathSync(stale));
    assert.equal(report.runtimeRecovery.actualStamp.gitCommit, 'stale-doctor');
    assert.deepEqual(
      report.runtimeRecovery.diagnostic.missingSymbols,
      [
        'ex_hermes_create_no_eval',
        'ex_hermes_unwatch_time_limit',
        'ex_hermes_watch_time_limit',
      ],
    );
    assert.deepEqual(probeTempDirectories(), before);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
