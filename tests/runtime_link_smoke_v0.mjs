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
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_RUNTIME_LINK_TIMEOUT_MS,
  extractMissingSymbols,
  runRuntimeLinkProbe,
  stageLinuxLoaderClosure,
} from '../scripts/runtime-link-smoke.mjs';
import {
  runtimeArtifactCandidates,
  runtimeReadinessReceiptPath,
  verifyRuntimeReadinessReceipt,
} from '../packages/snapback-cli/runtime-readiness.mjs';
import {
  PREPARED_RUNTIME_QUALIFICATION_INPUTS,
} from '../packages/snapback-cli/prepared-runtime-reuse.mjs';

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

// These are deadlock watchdogs, not performance assertions. The tests below
// wait for a real subprocess readiness marker or a complete doctor record;
// under the full local proof, concurrent Cargo builds can leave either child
// runnable but unscheduled for tens of seconds. Keep the behavioral deadline
// in runtime-link-smoke itself (15 minutes); give the test harness enough room
// to observe its readiness/record signals without turning host load into a
// false failure.
const LOAD_TOLERANT_PROCESS_WATCHDOG_MS = 2 * 60_000;

// This file intentionally inspects the process-global temporary-directory
// namespace to prove cleanup. Newer Node runners may start top-level tests
// concurrently, which makes one fixture observe another fixture's directory.
// Serialize only this owning corpus; external build/process load remains real.
let fixtureQueue = Promise.resolve();
function fixtureTest(name, optionsOrRun, maybeRun) {
  const options = typeof optionsOrRun === 'function' ? {} : optionsOrRun;
  const run = typeof optionsOrRun === 'function' ? optionsOrRun : maybeRun;
  test(name, options, async (context) => {
    const predecessor = fixtureQueue;
    let release;
    fixtureQueue = new Promise((resolveRelease) => { release = resolveRelease; });
    await predecessor;
    try {
      return await run(context);
    } finally {
      release();
    }
  });
}

function waitForPathOrChildExit(path, child) {
  if (existsSync(path)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const readinessPoll = setInterval(() => {
      if (!existsSync(path)) return;
      cleanup();
      resolve();
    }, 20);
    const onClose = (status, signal) => {
      cleanup();
      reject(new Error(`child exited before readiness marker (status=${status}, signal=${signal})`));
    };
    const cleanup = () => {
      clearInterval(readinessPoll);
      child.off('close', onClose);
    };
    child.once('close', onClose);
    if (existsSync(path)) {
      cleanup();
      resolve();
    }
  });
}

fixtureTest('default exact-link deadline admits a serialized clean CI build', () => {
  assert.equal(DEFAULT_RUNTIME_LINK_TIMEOUT_MS, 15 * 60_000);
});

fixtureTest('Linux exact-link probe stages the public bin/../lib loader closure', () => {
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

fixtureTest('missing compatibility symbols produce one exact-link recovery record', async () => {
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
      timeoutMs: LOAD_TOLERANT_PROCESS_WATCHDOG_MS,
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

fixtureTest('green state links and launches the newly built binary, then cleans it', async () => {
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
      timeoutMs: LOAD_TOLERANT_PROCESS_WATCHDOG_MS,
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

fixtureTest('a launchable binary that cannot create the armed handler VM is never LINK_OK', async () => {
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
      timeoutMs: LOAD_TOLERANT_PROCESS_WATCHDOG_MS,
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

fixtureTest('a kept target persists a readiness receipt; a framework swap after issuance is refused', async () => {
  // LLP 0115 CV-3: the probe's OK on a kept (served) binary must leave the
  // digest-bound receipt every consumer re-verifies, and a Hermes artifact
  // refreshed after issuance must invalidate it rather than be served.
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-runtime-link-receipt-'));
  try {
    writeFileSync(join(scratch, 'Cargo.toml'), '[package]\nname = "snapback"\nversion = "1.2.3"\n');
    writeFileSync(join(scratch, 'Cargo.lock'), '');
    for (const candidate of runtimeArtifactCandidates(scratch)) {
      writeFixture(candidate, `fixture artifact ${candidate}`);
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
  console.log(JSON.stringify({
    schemaVersion:'snapback.runtime-qualify.v1',
    probe:'restricted-no-eval-handler-vm',
    ok:true,
    binary:{gitCommit:'receipt-cafebabe',gitDirty:false,crateVersion:'1.2.3',buildProfile:'debug'}
  }));
  process.exit(0);
}
console.log(JSON.stringify({binary:{
  gitCommit:'receipt-cafebabe',
  gitDirty:false,
  crateVersion:'1.2.3',
  buildProfile:'debug'
}}));
\`);
chmodSync(binary, 0o755);
`);
    const target = join(scratch, 'kept-target');
    const result = await runRuntimeLinkProbe({
      root: scratch,
      cargoCommand: cargo,
      timeoutMs: LOAD_TOLERANT_PROCESS_WATCHDOG_MS,
      targetDirectory: target,
      keepTarget: true,
    });
    assert.equal(result.ok, true, JSON.stringify(result.diagnostic));
    const binary = join(target, 'debug', 'snapback');
    assert.equal(result.diagnostic.details.receiptPath, runtimeReadinessReceiptPath(binary));
    assert.equal(existsSync(runtimeReadinessReceiptPath(binary)), true, 'the kept binary must carry its receipt');

    const coherent = verifyRuntimeReadinessReceipt({ root: scratch, binaryPath: binary });
    assert.equal(coherent.ok, true, JSON.stringify(coherent.diagnostic));
    assert.equal(coherent.receipt.qualification.ok, true);
    assert.equal(coherent.receipt.buildIdentity.gitCommit, 'receipt-cafebabe');

    // The rerun incident's shape, post-receipt: refresh a Hermes artifact
    // under the already-qualified binary. Consumption must refuse.
    const [artifact] = runtimeArtifactCandidates(scratch).filter((path) => existsSync(path));
    writeFileSync(artifact, 'a swapped framework the qualification never saw');
    const swapped = verifyRuntimeReadinessReceipt({ root: scratch, binaryPath: binary });
    assert.equal(swapped.ok, false);
    assert.equal(swapped.reason, 'framework-drift');
    assert.equal(swapped.diagnostic.code, 'SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

fixtureTest('a closure change during build cannot be certified for prepared reuse', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-runtime-link-closure-race-'));
  try {
    writeFixture(join(scratch, 'Cargo.toml'), '[package]\nname = "snapback"\nversion = "1.2.3"\n');
    writeFixture(join(scratch, 'Cargo.lock'), '');
    writeFixture(
      join(scratch, 'scripts', 'runtime-build-inputs.txt'),
      'Cargo.toml\nCargo.lock\nscripts/runtime-build-inputs.txt\n',
    );
    for (const input of PREPARED_RUNTIME_QUALIFICATION_INPUTS) {
      writeFixture(join(scratch, input), `qualification fixture: ${input}\n`);
    }
    for (const candidate of runtimeArtifactCandidates(scratch)) {
      writeFixture(candidate, `fixture artifact ${candidate}`);
    }
    for (const args of [
      ['init', '-q'],
      ['config', 'user.email', 'fixture@example.invalid'],
      ['config', 'user.name', 'Runtime Link Fixture'],
      ['add', '-A'],
      ['commit', '-qm', 'fixture'],
    ]) {
      const initialized = spawnSync('git', args, { cwd: scratch, encoding: 'utf8' });
      assert.equal(initialized.status, 0, initialized.stderr);
    }

    const cargo = join(scratch, 'fake-cargo.mjs');
    writeExecutable(cargo, `#!/usr/bin/env node
import { appendFileSync, chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
if (process.argv[2] === '--version') {
  console.log('cargo 1.99.0-fixture');
  process.exit(0);
}
appendFileSync(join(process.cwd(), 'scripts', 'bootstrap-ibex-runtime'), '// changed during build\\n');
const index = process.argv.indexOf('--target-dir');
const binary = join(process.argv[index + 1], 'debug', 'snapback');
mkdirSync(dirname(binary), {recursive:true});
writeFileSync(binary, \`#!/usr/bin/env node
if (process.argv[2] === 'runtime-qualify') {
  console.log(JSON.stringify({
    schemaVersion:'snapback.runtime-qualify.v1',
    probe:'restricted-no-eval-handler-vm',
    ok:true,
    binary:{gitCommit:'race-cafebabe',gitDirty:false,crateVersion:'1.2.3',buildProfile:'debug'}
  }));
  process.exit(0);
}
console.log(JSON.stringify({binary:{
  gitCommit:'race-cafebabe',gitDirty:false,crateVersion:'1.2.3',buildProfile:'debug'
}}));
\`);
chmodSync(binary, 0o755);
`);
    const target = join(scratch, 'kept-target');
    const result = await runRuntimeLinkProbe({
      root: scratch,
      cargoCommand: cargo,
      timeoutMs: LOAD_TOLERANT_PROCESS_WATCHDOG_MS,
      targetDirectory: target,
      keepTarget: true,
    });
    assert.equal(result.ok, true, JSON.stringify(result.diagnostic));
    const receipt = JSON.parse(readFileSync(
      runtimeReadinessReceiptPath(join(target, 'debug', 'snapback')),
      'utf8',
    ));
    assert.equal(
      Object.hasOwn(receipt, 'preparedRuntime'),
      false,
      'an ordinary readiness receipt may survive the race, but reusable preparation may not',
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

fixtureTest('a VM-refusing kept binary gets no receipt', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-runtime-link-no-receipt-'));
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
  console.log(JSON.stringify({
    schemaVersion:'snapback.runtime-qualify.v1',
    probe:'restricted-no-eval-handler-vm',
    ok:false,
    diagnostic:{code:'SNAPBACK_RUNTIME_CREATE_FAILED',severity:'error',subsystem:'runtime',message:'Ibex runtime could not be created'}
  }));
  process.exit(1);
}
console.log(JSON.stringify({binary:{gitCommit:'x',gitDirty:false,crateVersion:'1.2.3',buildProfile:'debug'}}));
\`);
chmodSync(binary, 0o755);
`);
    const target = join(scratch, 'kept-target');
    const result = await runRuntimeLinkProbe({
      root: scratch,
      cargoCommand: cargo,
      timeoutMs: LOAD_TOLERANT_PROCESS_WATCHDOG_MS,
      targetDirectory: target,
      keepTarget: true,
    });
    assert.equal(result.ok, false);
    assert.equal(result.diagnostic.code, 'SNAPBACK_IBEX_RUNTIME_VM_CREATE_FAILED');
    assert.equal(
      existsSync(runtimeReadinessReceiptPath(join(target, 'debug', 'snapback'))),
      false,
      'a failed qualification must never leave a readiness receipt',
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

fixtureTest('a caller-owned target directory is never recursively deleted', async () => {
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

fixtureTest('timeout is coded and still cleans the temporary Cargo target', async () => {
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

fixtureTest('SIGTERM interrupts the Cargo process group and cleans the temporary target', {
  timeout: LOAD_TOLERANT_PROCESS_WATCHDOG_MS,
}, async () => {
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
// Deterministically cross the former five-second readiness window. The
// parent must wait for the marker, not infer failure from scheduler time.
await new Promise((resolveReady) => setTimeout(resolveReady, 5_250));
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
    await waitForPathOrChildExit(marker, child);
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

fixtureTest('symbol extraction handles Darwin and GNU linker spellings', () => {
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

fixtureTest('repository doctor surfaces the exact-link failure and recovery record', (context) => {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-ibex-doctor-link-'));
  try {
    const scripts = join(scratch, 'scripts');
    const runtimeModule = join(scratch, 'packages', 'snapback-cli', 'runtime-recovery.mjs');
    mkdirSync(scripts, { recursive: true });
    mkdirSync(dirname(runtimeModule), { recursive: true });
    copyFileSync(new URL('../scripts/ibex-doctor', import.meta.url), join(scripts, 'ibex-doctor'));
    copyFileSync(new URL('../scripts/runtime-link-smoke.mjs', import.meta.url), join(scripts, 'runtime-link-smoke.mjs'));
    copyFileSync(new URL('../packages/snapback-cli/runtime-recovery.mjs', import.meta.url), runtimeModule);
    copyFileSync(
      new URL('../packages/snapback-cli/runtime-readiness.mjs', import.meta.url),
      join(dirname(runtimeModule), 'runtime-readiness.mjs'),
    );
    copyFileSync(
      new URL('../packages/snapback-cli/prepared-runtime-reuse.mjs', import.meta.url),
      join(dirname(runtimeModule), 'prepared-runtime-reuse.mjs'),
    );
    copyFileSync(
      new URL('../packages/snapback-cli/admin-snapshot.mjs', import.meta.url),
      join(dirname(runtimeModule), 'admin-snapshot.mjs'),
    );
    chmodSync(join(scripts, 'ibex-doctor'), 0o755);
    chmodSync(join(scripts, 'runtime-link-smoke.mjs'), 0o755);
    writeFileSync(join(scratch, 'Cargo.toml'), '[package]\nname = "snapback"\nversion = "1.2.3"\n');
    writeFileSync(join(scratch, 'Cargo.lock'), '');
    const vendor = join(scratch, 'vendor', 'ibex');
    writeFixture(join(vendor, 'Cargo.toml'), '[package]\nname = "ibex-runtime"\nversion = "1.0.0"\n');
    if (process.platform === 'darwin') {
      writeFixture(join(vendor, 'ios', 'Frameworks', 'hermes-headers', 'hermes', 'hermes.h'));
      const runtime = join(vendor, 'ios', 'Frameworks', 'hermesvm.framework', 'hermesvm');
      const sourceIbex = process.env.SNAPBACK_IBEX_CHECKOUT
        ?? fileURLToPath(new URL('../vendor/ibex/', import.meta.url));
      const sourceRuntime = join(
        sourceIbex,
        'ios',
        'Frameworks',
        'hermesvm.framework',
        'Versions',
        '1',
        'hermesvm',
      );
      if (!existsSync(sourceRuntime)) {
        context.skip(`prepared Hermes fixture is unavailable: ${sourceRuntime}`);
        return;
      }
      mkdirSync(dirname(runtime), { recursive: true });
      copyFileSync(sourceRuntime, runtime);
      writeFixture(join(vendor, 'tools', 'hermes', 'hermesc'));
    } else if (process.platform === 'linux') {
      writeFixture(join(vendor, 'linux', 'hermes-headers', 'hermes', 'hermes.h'));
      const runtime = join(vendor, 'linux', 'lib', 'libhermesvm.so');
      const sourceIbex = process.env.SNAPBACK_IBEX_CHECKOUT
        ?? fileURLToPath(new URL('../vendor/ibex/', import.meta.url));
      const sourceRuntime = join(sourceIbex, 'linux', 'lib', 'libhermesvm.so');
      if (!existsSync(sourceRuntime)) {
        context.skip(`prepared Hermes fixture is unavailable: ${sourceRuntime}`);
        return;
      }
      mkdirSync(dirname(runtime), { recursive: true });
      copyFileSync(sourceRuntime, runtime);
      writeFixture(join(vendor, 'tools', 'hermes', 'hermesc'));
    } else {
      return;
    }
    for (const cwd of [vendor, scratch]) {
      let initialized = spawnSync('git', ['init', '-q'], { cwd, encoding: 'utf8' });
      assert.equal(initialized.status, 0, initialized.stderr);
      initialized = spawnSync('git', ['config', 'user.email', 'fixture@example.invalid'], {
        cwd,
        encoding: 'utf8',
      });
      assert.equal(initialized.status, 0, initialized.stderr);
      initialized = spawnSync('git', ['config', 'user.name', 'Runtime Link Fixture'], {
        cwd,
        encoding: 'utf8',
      });
      assert.equal(initialized.status, 0, initialized.stderr);
      initialized = spawnSync('git', ['add', '-A'], { cwd, encoding: 'utf8' });
      assert.equal(initialized.status, 0, initialized.stderr);
      initialized = spawnSync('git', ['commit', '-qm', 'fixture'], { cwd, encoding: 'utf8' });
      assert.equal(initialized.status, 0, initialized.stderr);
    }
    const vendorCommit = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: vendor,
      encoding: 'utf8',
    }).stdout.trim();
    const artifactStamp = process.platform === 'darwin'
      ? join(vendor, 'ios', 'Frameworks', '.snapback-ibex-gitlink')
      : join(vendor, 'linux', 'lib', '.snapback-ibex-gitlink');
    writeFixture(artifactStamp, `${vendorCommit}\n`);
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
      timeout: LOAD_TOLERANT_PROCESS_WATCHDOG_MS,
    });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, false);
    assert(
      report.checks.some((check) => check.code === 'SNAPBACK_IBEX_RUNTIME_LINK_FAILED'),
      JSON.stringify(report),
    );
    // LLP 0115 CV-3: the doctor also verifies the SERVED binary's persisted
    // readiness receipt — read-only. The stale binary here carries none, so
    // the shared receipt code is reported and no receipt is created.
    assert(
      report.checks.some((check) => check.code === 'SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID'
        && check.severity === 'ERROR'),
      JSON.stringify(report),
    );
    assert.equal(
      existsSync(`${stale}.runtime-readiness.json`),
      false,
      'doctor must stay read-only: detection never issues a receipt',
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

    const reuseResult = spawnSync(
      join(scripts, 'ibex-doctor'),
      ['--reuse-authoritative-build', '--json'],
      {
        cwd: scratch,
        encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
        timeout: LOAD_TOLERANT_PROCESS_WATCHDOG_MS,
      },
    );
    assert.equal(reuseResult.status, 1, `${reuseResult.stdout}\n${reuseResult.stderr}`);
    const reuseReport = JSON.parse(reuseResult.stdout);
    assert.equal(reuseReport.probeMode, 'receipt-reuse');
    assert.equal(reuseReport.runtimeRecovery, null);
    assert(
      reuseReport.checks.some((check) => check.code === 'SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID'),
      JSON.stringify(reuseReport),
    );
    assert(
      !reuseReport.checks.some((check) => check.code === 'SNAPBACK_IBEX_RUNTIME_LINK_FAILED'),
      'receipt-reuse mode must not create the disposable Cargo target',
    );
    assert.deepEqual(probeTempDirectories(), before);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
