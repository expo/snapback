import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  BINARY_SIZE_DRIFT,
  baselineRecord,
  compareMetrics,
  measureBinary,
  parseOtoolOutput,
  runCli,
} from './binary-size-metrology.mjs';

const FIXTURE_DIGEST = 'a'.repeat(64);
const FIXTURE_COMMIT = 'b'.repeat(40);
const STALE_FIXTURE_COMMIT = 'c'.repeat(40);
const FIXTURE_BINARY_DIGEST = { bytes: 6, sha256: FIXTURE_DIGEST };
const FIXTURE_METRICS = {
  bytes: 6,
  __TEXT: 4,
  __eh_frame: 1,
  __DATA_CONST: 1,
  __DATA: 1,
  __LINKEDIT: 2,
  nsyms: 3,
  strsize: 2,
};

function fixtureRunCommand(command, args) {
  if (command === 'rustc' && args[0] === '-V') return 'rustc fixture';
  if (command === 'rustc' && args[0] === '-vV') return 'host: fixture-target';
  assert.fail(`unexpected command: ${command} ${args.join(' ')}`);
}

function writeBaseline(binary, baselineOptions) {
  let record = null;
  let stdout = '';
  let stderr = '';
  const exitCode = runCli([
    'check',
    binary,
    '--write-baseline',
    '--baseline',
    join(dirname(binary), 'baseline.json'),
  ], {
    measureBinaryFn: () => FIXTURE_METRICS,
    baselineRecordFn: (path, metrics, coherenceOptions) => baselineRecord(
      path,
      metrics,
      { ...baselineOptions, ...coherenceOptions },
    ),
    digestBinaryFn: baselineOptions.digestBinaryFn,
    writeBaselineFn: (_path, value) => { record = value; },
    readBaselineFn: () => record ?? assert.fail('failed baseline writes must not read a baseline'),
    stdout: { write: (value) => { stdout += value; } },
    stderr: { write: (value) => { stderr += value; } },
  });
  return { exitCode, record, stderr, stdout };
}

function receipt({
  sha256 = FIXTURE_DIGEST,
  bytes = FIXTURE_METRICS.bytes,
  buildCommit = FIXTURE_COMMIT,
  buildDirty = false,
  qualificationCommit = FIXTURE_COMMIT,
  qualificationDirty = false,
  qualificationIdentity = true,
} = {}) {
  return {
    schemaVersion: 'snapback.runtime-readiness.v1',
    binary: { bytes, sha256 },
    buildIdentity: { gitCommit: buildCommit, gitDirty: buildDirty },
    artifacts: [],
    qualification: {
      probe: 'restricted-no-eval-handler-vm',
      ok: true,
      report: qualificationIdentity
        ? { binary: { gitCommit: qualificationCommit, gitDirty: qualificationDirty } }
        : null,
    },
  };
}

const OTOOL_FIXTURE = `
Load command 0
      cmd LC_SEGMENT_64
  cmdsize 72
  segname __TEXT
   vmaddr 0x0000000100000000
   vmsize 0x0000000000010000
  fileoff 0
 filesize 65536
   nsects 2
    flags 0x0
Section
  sectname __text
   segname __TEXT
      addr 0x0000000100001000
      size 0x0000000000000800
Section
  sectname __eh_frame
   segname __TEXT
      addr 0x0000000100001800
      size 0x0000000000000120
Load command 1
      cmd LC_SEGMENT_64
  cmdsize 72
  segname __DATA_CONST
   vmaddr 0x0000000100010000
   vmsize 0x0000000000004000
  fileoff 65536
 filesize 16384
Load command 2
      cmd LC_SEGMENT_64
  cmdsize 72
  segname __DATA
   vmaddr 0x0000000100014000
   vmsize 0x0000000000002000
  fileoff 81920
 filesize 4096
Load command 3
      cmd LC_SEGMENT_64
  cmdsize 72
  segname __LINKEDIT
   vmaddr 0x0000000100016000
   vmsize 0x0000000000008000
  fileoff 86016
 filesize 30000
Load command 4
     cmd LC_SYMTAB
 cmdsize 24
  symoff 90000
   nsyms 1234
  stroff 100000
 strsize 23456
`;

test('parseOtoolOutput reads segments, LC_SYMTAB, and __eh_frame', () => {
  assert.deepEqual(parseOtoolOutput(OTOOL_FIXTURE), {
    __TEXT: 65_536,
    __eh_frame: 288,
    __DATA_CONST: 16_384,
    __DATA: 8_192,
    __LINKEDIT: 32_768,
    nsyms: 1_234,
    strsize: 23_456,
  });
});

test('compareMetrics applies tolerance only to growth and never fails shrinkage', () => {
  const comparisons = compareMetrics(
    { bytes: 114, __LINKEDIT: 80, strsize: 116 },
    { bytes: 100, __LINKEDIT: 100, strsize: 100 },
    0.15,
  );
  assert.deepEqual(comparisons.map(({ name, failed }) => [name, failed]), [
    ['bytes', false],
    ['__LINKEDIT', false],
    ['strsize', true],
  ]);
  assert.equal(comparisons[1].growth, -0.2);
});

test('runCli returns the BINARY_SIZE_DRIFT exit path when a metric exceeds tolerance', () => {
  let stdout = '';
  let stderr = '';
  const exitCode = runCli(['check', '/fixture/snapback'], {
    measureBinaryFn: () => ({ bytes: 121, __LINKEDIT: 100, strsize: 100 }),
    digestBinaryFn: () => ({ bytes: 121, sha256: FIXTURE_DIGEST }),
    readBaselineFn: () => ({ metrics: { bytes: 100, __LINKEDIT: 100, strsize: 100 } }),
    stdout: { write: (value) => { stdout += value; } },
    stderr: { write: (value) => { stderr += value; } },
  });
  assert.equal(exitCode, 1);
  assert.match(stdout, /^bytes 121 vs baseline 100 \(\+21\.00%\)$/mu);
  assert.equal(stderr, `${BINARY_SIZE_DRIFT}: bytes grew past the 15.00% tolerance\n`);
});

test('measureBinary reports unsupported platforms without invoking otool', () => {
  const result = measureBinary('/fixture/snapback', {
    platform: 'linux',
    runOtool: () => assert.fail('otool must not be invoked'),
  });
  assert.deepEqual(result, {
    unsupported: true,
    reason: 'Mach-O size metrology is unsupported on linux',
  });

  assert.deepEqual(measureBinary('/fixture/snapback', {
    platform: 'darwin',
    runOtool: () => ({ unsupported: true, reason: 'otool is not installed' }),
  }), {
    unsupported: true,
    reason: 'otool is not installed',
  });

  let stdout = '';
  const exitCode = runCli(['check', '/fixture/snapback'], {
    measureBinaryFn: () => result,
    digestBinaryFn: () => FIXTURE_BINARY_DIGEST,
    readBaselineFn: () => assert.fail('unsupported checks must not read a baseline'),
    stdout: { write: (value) => { stdout += value; } },
  });
  assert.equal(exitCode, 0);
  assert.equal(stdout, 'binary size check skipped: Mach-O size metrology is unsupported on linux\n');
});

test('write-baseline rejects a stale readiness receipt whose binary digest mismatches', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'binary-size-stale-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const binary = join(root, 'target/debug/snapback');
  mkdirSync(dirname(binary), { recursive: true });
  writeFileSync(binary, 'binary');
  writeFileSync(`${binary}.runtime-readiness.json`, JSON.stringify(receipt({ sha256: '0'.repeat(64) })));

  const result = writeBaseline(binary, {
    digestBinaryFn: () => ({ bytes: FIXTURE_METRICS.bytes, sha256: FIXTURE_DIGEST }),
    runCommand: fixtureRunCommand,
    worktreeRoot: root,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.record, null);
  assert.match(result.stderr, /runtime readiness receipt is binary-drift:/u);
});

test('write-baseline rejects a malformed present readiness receipt', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'binary-size-malformed-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const binary = join(root, 'target/debug/snapback');
  mkdirSync(dirname(binary), { recursive: true });
  writeFileSync(binary, 'binary');
  writeFileSync(`${binary}.runtime-readiness.json`, '{not json');

  const result = writeBaseline(binary, {
    digestBinaryFn: () => ({ bytes: FIXTURE_METRICS.bytes, sha256: FIXTURE_DIGEST }),
    runCommand: fixtureRunCommand,
    worktreeRoot: root,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.record, null);
  assert.match(result.stderr, /runtime readiness receipt is malformed:/u);
});

test('write-baseline uses git fallback for an absent receipt inside the worktree target', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'binary-size-fallback-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const binary = join(root, 'target/debug/snapback');
  mkdirSync(dirname(binary), { recursive: true });
  writeFileSync(binary, 'binary');

  const result = writeBaseline(binary, {
    digestBinaryFn: () => FIXTURE_BINARY_DIGEST,
    now: () => new Date('2026-08-22T00:00:00.000Z'),
    readCheckoutRuntimeIdentityFn: (observedRoot) => {
      assert.equal(observedRoot, root);
      return {
        gitCommit: FIXTURE_COMMIT,
        gitDirty: true,
        crateVersion: '0.1.0',
        buildProfile: null,
      };
    },
    runCommand: fixtureRunCommand,
    worktreeRoot: root,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, '');
  assert.equal(result.record.commit, FIXTURE_COMMIT);
  assert.equal(result.record.gitDirty, true);
  assert.equal(result.record.provenanceSource, 'git-fallback');
  assert.equal(result.record.sha256, FIXTURE_DIGEST);
});

test('write-baseline rejects an absent receipt outside the current worktree target', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'binary-size-external-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const worktreeRoot = join(root, 'worktree');
  const binary = join(root, 'another-checkout/target/debug/snapback');
  mkdirSync(dirname(binary), { recursive: true });
  writeFileSync(binary, 'binary');

  const result = writeBaseline(binary, {
    digestBinaryFn: () => ({ bytes: FIXTURE_METRICS.bytes, sha256: FIXTURE_DIGEST }),
    runCommand: fixtureRunCommand,
    worktreeRoot,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.record, null);
  assert.match(
    result.stderr,
    /no runtime readiness receipt exists for binary outside the current worktree target:/u,
  );
});

test('write-baseline rejects a target symlink that escapes to another checkout', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'binary-size-symlink-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const worktreeRoot = join(root, 'worktree');
  const foreignBinary = join(root, 'another-checkout/target/debug/snapback');
  mkdirSync(dirname(foreignBinary), { recursive: true });
  writeFileSync(foreignBinary, 'binary');
  const binary = join(worktreeRoot, 'target/debug/snapback');
  mkdirSync(dirname(binary), { recursive: true });
  symlinkSync(foreignBinary, binary);

  const result = writeBaseline(binary, {
    digestBinaryFn: () => ({ bytes: FIXTURE_METRICS.bytes, sha256: FIXTURE_DIGEST }),
    runCommand: fixtureRunCommand,
    worktreeRoot,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.record, null);
  assert.match(
    result.stderr,
    /no runtime readiness receipt exists for binary outside the current worktree target:/u,
  );
});

test('write-baseline records coherent receipt provenance and the measured digest', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'binary-size-receipt-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const binary = join(root, 'target/debug/snapback');
  mkdirSync(dirname(binary), { recursive: true });
  writeFileSync(binary, 'binary');
  writeFileSync(`${binary}.runtime-readiness.json`, JSON.stringify(receipt()));

  const value = receipt();
  const result = writeBaseline(binary, {
    digestBinaryFn: () => ({ bytes: FIXTURE_METRICS.bytes, sha256: FIXTURE_DIGEST }),
    runCommand: fixtureRunCommand,
    verifyReceiptFn: () => ({ ok: true, receipt: value }),
    worktreeRoot: root,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, '');
  assert.equal(result.record.commit, FIXTURE_COMMIT);
  assert.equal(result.record.gitDirty, false);
  assert.equal(result.record.provenanceSource, 'readiness-receipt');
  assert.equal(result.record.sha256, FIXTURE_DIGEST);
});

test('write-baseline rejects stale top-level provenance even when the receipt digest matches', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'binary-size-identity-drift-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const binary = join(root, 'target/debug/snapback');
  mkdirSync(dirname(binary), { recursive: true });
  writeFileSync(binary, 'binary');
  writeFileSync(`${binary}.runtime-readiness.json`, JSON.stringify(receipt()));

  const value = receipt({ buildCommit: STALE_FIXTURE_COMMIT });
  const result = writeBaseline(binary, {
    digestBinaryFn: () => FIXTURE_BINARY_DIGEST,
    runCommand: fixtureRunCommand,
    verifyReceiptFn: () => ({ ok: true, receipt: value }),
    worktreeRoot: root,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.record, null);
  assert.match(
    result.stderr,
    /buildIdentity does not match its qualification binary identity/u,
  );
});

test('write-baseline rejects an absent qualification binary identity', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'binary-size-identity-absent-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const binary = join(root, 'target/debug/snapback');
  mkdirSync(dirname(binary), { recursive: true });
  writeFileSync(binary, 'binary');
  writeFileSync(`${binary}.runtime-readiness.json`, JSON.stringify(receipt()));

  const value = receipt({ qualificationIdentity: false });
  const result = writeBaseline(binary, {
    digestBinaryFn: () => FIXTURE_BINARY_DIGEST,
    runCommand: fixtureRunCommand,
    verifyReceiptFn: () => ({ ok: true, receipt: value }),
    worktreeRoot: root,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.record, null);
  assert.match(
    result.stderr,
    /buildIdentity does not match its qualification binary identity/u,
  );
});

test('write-baseline rejects qualification dirty-state drift', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'binary-size-dirty-drift-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const binary = join(root, 'target/debug/snapback');
  mkdirSync(dirname(binary), { recursive: true });
  writeFileSync(binary, 'binary');
  writeFileSync(`${binary}.runtime-readiness.json`, JSON.stringify(receipt()));

  const value = receipt({ qualificationDirty: true });
  const result = writeBaseline(binary, {
    digestBinaryFn: () => FIXTURE_BINARY_DIGEST,
    runCommand: fixtureRunCommand,
    verifyReceiptFn: () => ({ ok: true, receipt: value }),
    worktreeRoot: root,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.record, null);
  assert.match(
    result.stderr,
    /buildIdentity does not match its qualification binary identity/u,
  );
});

test('runCli rejects a binary that changes between the pre- and post-measurement hashes', () => {
  let digestCall = 0;
  let stdout = '';
  let stderr = '';
  const exitCode = runCli(['check', '/fixture/snapback'], {
    measureBinaryFn: () => FIXTURE_METRICS,
    digestBinaryFn: () => ({
      bytes: FIXTURE_METRICS.bytes,
      sha256: (digestCall++ === 0 ? 'a' : 'd').repeat(64),
    }),
    readBaselineFn: () => ({ metrics: FIXTURE_METRICS }),
    stdout: { write: (value) => { stdout += value; } },
    stderr: { write: (value) => { stderr += value; } },
  });
  assert.equal(exitCode, 1);
  assert.equal(stdout, '');
  assert.match(stderr, /binary changed during measurement: \/fixture\/snapback/u);
});
