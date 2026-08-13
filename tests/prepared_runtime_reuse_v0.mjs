import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  PREPARED_RUNTIME_QUALIFICATION_INPUTS,
  capturePreparedRuntimeReuse,
  comparePreparedRuntimeReuse,
  verifyPreparedRuntimeReuse,
} from '../packages/snapback-cli/prepared-runtime-reuse.mjs';
import {
  issueRuntimeReadinessReceipt,
  runtimeArtifactCandidates,
  runtimeReadinessReceiptPath,
} from '../packages/snapback-cli/runtime-readiness.mjs';

const TOOLCHAIN = Object.freeze({
  cargo: 'cargo 1.97.0 fixture',
  cc: 'Apple clang fixture',
  cxx: 'Apple clang++ fixture',
  node: 'v24.0.0 fixture',
  rustc: 'rustc 1.97.0 fixture\nhost: fixture-host',
  hostTarget: 'fixture-host',
});
const RUNTIME_BUILD_INPUTS = readFileSync(
  new URL('../scripts/runtime-build-inputs.txt', import.meta.url),
  'utf8',
);

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function commit(root, message) {
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', message);
  return git(root, 'rev-parse', 'HEAD');
}

function scaffold() {
  const root = mkdtempSync(join(tmpdir(), 'snapback-prepared-runtime-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'prepared-runtime@example.invalid');
  git(root, 'config', 'user.name', 'Prepared Runtime Fixture');
  git(root, 'config', 'advice.addEmbeddedRepo', 'false');
  write(join(root, 'Cargo.toml'), '[package]\nname="fixture"\nversion="0.0.0"\n');
  write(join(root, 'src/lib.rs'), 'pub fn fixture() {}\n');
  write(join(root, 'vendor/ibex/Cargo.toml'), '[package]\nname="ibex-fixture"\nversion="0.0.0"\n');
  git(join(root, 'vendor/ibex'), 'init', '-q');
  git(join(root, 'vendor/ibex'), 'config', 'user.email', 'ibex-fixture@example.invalid');
  git(join(root, 'vendor/ibex'), 'config', 'user.name', 'Ibex Fixture');
  commit(join(root, 'vendor/ibex'), 'fixture ibex source');
  write(join(root, 'schemas/http.routes.v1.json'), '{"routes":[]}\n');
  write(
    join(root, 'scripts/runtime-build-inputs.txt'),
    RUNTIME_BUILD_INPUTS,
  );
  for (const path of PREPARED_RUNTIME_QUALIFICATION_INPUTS) {
    write(join(root, path), `fixture qualification input: ${path}\n`);
  }
  write(join(root, 'README.md'), 'fixture documentation\n');
  const sourceRevision = commit(root, 'fixture source');
  const binary = join(root, 'target/debug/snapback');
  write(binary, '#!/usr/bin/env sh\nexit 0\n');
  chmodSync(binary, 0o755);
  for (const artifact of runtimeArtifactCandidates(root)) {
    write(artifact, `fixture runtime artifact: ${artifact}\n`);
  }
  const qualification = {
    probe: 'restricted-no-eval-handler-vm',
    ok: true,
    report: {
      schemaVersion: 'snapback.runtime-qualify.v1',
      probe: 'restricted-no-eval-handler-vm',
      ok: true,
      binary: {
        gitCommit: sourceRevision,
        gitDirty: false,
        crateVersion: '0.0.0',
        buildProfile: 'debug',
      },
    },
  };
  const preparedRuntime = capturePreparedRuntimeReuse({ root, toolchain: TOOLCHAIN });
  issueRuntimeReadinessReceipt({
    root,
    binaryPath: binary,
    qualification,
    issuer: 'prepared-runtime-fixture',
    preparedRuntime,
  });
  return { root, binary, binaryPath: binary, qualification, preparedRuntime };
}

test('a docs-only commit reuses the same prepared source and qualification closure', () => {
  const fixture = scaffold();
  try {
    write(join(fixture.root, 'README.md'), 'documentation changed without changing runtime bytes\n');
    commit(fixture.root, 'docs only');
    const current = capturePreparedRuntimeReuse({ root: fixture.root, toolchain: TOOLCHAIN });
    const verdict = verifyPreparedRuntimeReuse({ ...fixture, current });
    assert.equal(verdict.ok, true, verdict.message);
    assert.equal(verdict.reason, 'closure-identical');
    assert.notEqual(
      verdict.receipt.buildIdentity.gitCommit,
      git(fixture.root, 'rev-parse', 'HEAD'),
      'the fixture must prove reuse across different commits',
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('source and qualification changes independently invalidate prepared reuse', () => {
  const fixture = scaffold();
  try {
    const sourceBefore = readFileSync(join(fixture.root, 'src/lib.rs'), 'utf8');
    write(join(fixture.root, 'src/lib.rs'), `${sourceBefore}pub fn changed() {}\n`);
    commit(fixture.root, 'source change');
    let current = capturePreparedRuntimeReuse({ root: fixture.root, toolchain: TOOLCHAIN });
    let verdict = verifyPreparedRuntimeReuse({ ...fixture, current });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, 'source-closure-drift');

    write(join(fixture.root, 'src/lib.rs'), sourceBefore);
    commit(fixture.root, 'restore source closure');
    write(
      join(fixture.root, PREPARED_RUNTIME_QUALIFICATION_INPUTS[0]),
      'changed qualification semantics\n',
    );
    commit(fixture.root, 'qualification change');
    current = capturePreparedRuntimeReuse({ root: fixture.root, toolchain: TOOLCHAIN });
    verdict = verifyPreparedRuntimeReuse({ ...fixture, current });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, 'qualification-closure-drift');
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('the build-embedded HTTP route catalog invalidates prepared reuse', () => {
  const fixture = scaffold();
  try {
    write(
      join(fixture.root, 'schemas/http.routes.v1.json'),
      '{"routes":[{"path":"/_snapback/fixture"}]}\n',
    );
    commit(fixture.root, 'pushed route catalog change');
    const current = capturePreparedRuntimeReuse({ root: fixture.root, toolchain: TOOLCHAIN });
    const verdict = verifyPreparedRuntimeReuse({ ...fixture, current });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, 'source-closure-drift');
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('a checked-out vendor/ibex gitlink pointer change invalidates prepared reuse', () => {
  const fixture = scaffold();
  try {
    write(join(fixture.root, 'vendor/ibex/Cargo.toml'), [
      '[package]',
      'name="ibex-fixture"',
      'version="0.0.1"',
      '',
    ].join('\n'));
    commit(join(fixture.root, 'vendor/ibex'), 'move fixture gitlink checkout');
    const current = capturePreparedRuntimeReuse({ root: fixture.root, toolchain: TOOLCHAIN });
    assert.notEqual(
      current.source.sha256,
      fixture.preparedRuntime.source.sha256,
      'the fixture must exercise the checked-out gitlink HEAD rather than the staged pointer',
    );
    const verdict = verifyPreparedRuntimeReuse({ ...fixture, current });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, 'source-closure-drift');
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('toolchain, platform, environment, and closure tampering invalidate reuse', () => {
  const fixture = scaffold();
  try {
    const current = capturePreparedRuntimeReuse({ root: fixture.root, toolchain: TOOLCHAIN });
    for (const [mutation, reason] of [
      [(identity) => ({ ...identity, toolchain: { ...identity.toolchain, cargo: 'cargo changed' } }), 'toolchain-drift'],
      [(identity) => ({ ...identity, platform: 'different-platform' }), 'platform-drift'],
      [(identity) => ({ ...identity, buildEnvironment: { RUSTFLAGS: '-C changed' } }), 'build-environment-drift'],
    ]) {
      const verdict = comparePreparedRuntimeReuse(fixture.preparedRuntime, mutation(current));
      assert.equal(verdict.ok, false);
      assert.equal(verdict.reason, reason);
    }
    const forged = { ...fixture.preparedRuntime, closureSha256: '0'.repeat(64) };
    assert.equal(comparePreparedRuntimeReuse(forged, current).reason, 'prepared-closure-tampered');
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('ordinary receipt verification remains mandatory and old receipts are misses', () => {
  const fixture = scaffold();
  try {
    const current = capturePreparedRuntimeReuse({ root: fixture.root, toolchain: TOOLCHAIN });
    writeFileSync(fixture.binary, 'unqualified replacement bytes');
    let verdict = verifyPreparedRuntimeReuse({ ...fixture, current });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, 'readiness-binary-drift');

    write(fixture.binary, '#!/usr/bin/env sh\nexit 0\n');
    chmodSync(fixture.binary, 0o755);
    issueRuntimeReadinessReceipt({
      root: fixture.root,
      binaryPath: fixture.binary,
      qualification: fixture.qualification,
      issuer: 'old-receipt-fixture',
    });
    verdict = verifyPreparedRuntimeReuse({ ...fixture, current });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, 'prepared-closure-absent');
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('readiness identity and platform binding drift invalidate prepared reuse', () => {
  const fixture = scaffold();
  try {
    const receiptPath = runtimeReadinessReceiptPath(fixture.binary);
    const original = JSON.parse(readFileSync(receiptPath, 'utf8'));
    const current = capturePreparedRuntimeReuse({ root: fixture.root, toolchain: TOOLCHAIN });
    const cases = [
      ['dirty build identity', (receipt) => { receipt.buildIdentity.gitDirty = true; }],
      ['non-40-hex build commit', (receipt) => {
        receipt.buildIdentity.gitCommit = 'not-a-full-commit';
        receipt.qualification.report.binary.gitCommit = 'not-a-full-commit';
      }],
      ['qualification/build identity mismatch', (receipt) => {
        receipt.qualification.report.binary.gitCommit = 'f'.repeat(40);
      }],
      ['receipt platform mismatch', (receipt) => { receipt.platform = 'other-platform'; }],
    ];
    for (const [label, mutate] of cases) {
      const receipt = structuredClone(original);
      mutate(receipt);
      writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
      const verdict = verifyPreparedRuntimeReuse({ ...fixture, current });
      assert.equal(verdict.ok, false, label);
      assert.equal(verdict.reason, 'readiness-binding-drift', label);
    }
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
