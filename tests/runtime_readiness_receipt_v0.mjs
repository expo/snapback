// LLP 0115 CV-3: the persisted runtime readiness receipt.
//
// The receipt binds binary digest + Hermes artifact digests + the CV-2
// qualification verdict into one document beside the binary, and every
// consumer refuses an absent/stale/incoherent receipt with the one shared
// code. These tests pin issuance custody (never issued for a failed
// qualification), digest-coherence verification, and the invalidation
// semantics on binary rebuild and framework change after issuance.

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  RUNTIME_READINESS_INVALID_CODE,
  RUNTIME_READINESS_SCHEMA_VERSION,
  digestRuntimeArtifacts,
  issueRuntimeReadinessReceipt,
  packagedRuntimeArtifactCandidates,
  produceRuntimePackageSeal,
  runtimeArtifactCandidates,
  runtimeReadinessReceiptPath,
  verifyRuntimePackageSeal,
  verifyRuntimeReadinessReceipt,
} from '../packages/snapback-cli/runtime-readiness.mjs';
import { PUBLIC_PACKAGE_BUILD_RECIPE } from '../scripts/runtime-package-authority.mjs';

const CLI = new URL('../packages/snapback-cli/runtime-readiness.mjs', import.meta.url).pathname;

function writeFixture(path, contents = '') {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function scaffold() {
  const root = mkdtempSync(join(tmpdir(), 'snapback-readiness-'));
  const binary = join(root, 'target', 'debug', 'snapback');
  writeFixture(binary, 'fixture snapback binary bytes');
  for (const candidate of runtimeArtifactCandidates(root)) {
    writeFixture(candidate, `fixture artifact ${candidate}`);
  }
  return { root, binary };
}

const OK_QUALIFICATION = {
  probe: 'restricted-no-eval-handler-vm',
  ok: true,
  report: {
    schemaVersion: 'snapback.runtime-qualify.v1',
    probe: 'restricted-no-eval-handler-vm',
    ok: true,
    binary: {
      gitCommit: 'cafebabecafebabecafebabecafebabecafebabe',
      gitDirty: false,
      crateVersion: '1.2.3',
      buildProfile: 'debug',
    },
  },
};

test('Darwin package seals bind the dyld versioned file across npm symlink removal', () => {
  const root = mkdtempSync(join(tmpdir(), 'snapback-darwin-package-readiness-'));
  const binary = join(root, 'bin', 'snapback');
  const frameworkRoot = join(root, 'Frameworks', 'hermesvm.framework');
  const framework = join(frameworkRoot, 'Versions', '1', 'hermesvm');
  const frameworkAlias = join(frameworkRoot, 'hermesvm');
  const sourceRevision = 'd'.repeat(40);
  const buildIdentity = {
    schemaVersion: 'snapback.binary-identity.v1',
    binary: {
      crateVersion: '0.1.0',
      gitCommit: sourceRevision,
      gitDirty: false,
      buildProfile: 'release',
      buildRecipe: PUBLIC_PACKAGE_BUILD_RECIPE,
      startupNonce: 'build-identity-process',
    },
    buildDistribution: 'public-package',
  };
  try {
    writeFixture(binary, 'fixture packaged snapback binary bytes');
    writeFixture(join(root, 'include', 'hermes', 'hermes.h.artifact'), 'fixture header');
    writeFixture(framework, 'fixture versioned Hermes runtime');
    symlinkSync('Versions/1/hermesvm', frameworkAlias);
    const qualification = {
      ok: true,
      report: {
        schemaVersion: 'snapback.runtime-qualify.v1',
        probe: 'restricted-no-eval-handler-vm',
        ok: true,
        binary: {
          ...buildIdentity.binary,
          startupNonce: 'qualification-process',
        },
      },
    };
    const sealed = produceRuntimePackageSeal({
      root,
      binaryPath: binary,
      packageName: '@expo/snapback-runtime-darwin-arm64',
      platform: 'darwin',
      architecture: 'arm64',
      buildIdentity,
      sourceRevision,
      catalogBuildIdentityProof: {
        schemaVersion: 'snapback.runtime-catalog-build-identity-proof.v1',
        source: 'native-inspection',
        buildIdentity: { sourceCommit: sourceRevision, dirty: false },
      },
      qualification,
      adminConsoleRequired: false,
    });
    assert.deepEqual(
      packagedRuntimeArtifactCandidates(root, { platform: 'darwin' })
        .map((path) => path.slice(root.length + 1)),
      [
        'include/hermes/hermes.h.artifact',
        'Frameworks/hermesvm.framework/Versions/1/hermesvm',
      ],
    );
    assert.equal(
      sealed.receipt.artifacts.some(
        (artifact) => artifact.path.endsWith('/hermesvm.framework/hermesvm'),
      ),
      false,
    );

    rmSync(frameworkAlias);
    const installed = verifyRuntimePackageSeal({
      root,
      binaryPath: binary,
      packageName: '@expo/snapback-runtime-darwin-arm64',
      platform: 'darwin',
      architecture: 'arm64',
      adminConsoleRequired: false,
    });
    assert.equal(installed.ok, true, JSON.stringify(installed.diagnostic));

    writeFileSync(framework, 'genuinely drifted versioned Hermes runtime');
    assert.equal(verifyRuntimePackageSeal({
      root,
      binaryPath: binary,
      packageName: '@expo/snapback-runtime-darwin-arm64',
      platform: 'darwin',
      architecture: 'arm64',
      adminConsoleRequired: false,
    }).reason, 'framework-drift');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('issue → verify round-trips a digest-coherent receipt', () => {
  const { root, binary } = scaffold();
  try {
    const { receipt, receiptPath } = issueRuntimeReadinessReceipt({
      root,
      binaryPath: binary,
      qualification: OK_QUALIFICATION,
      issuer: 'unit-test',
    });
    assert.equal(receiptPath, runtimeReadinessReceiptPath(binary));
    assert.equal(receipt.schemaVersion, RUNTIME_READINESS_SCHEMA_VERSION);
    assert.equal(receipt.qualification.ok, true);
    assert.equal(receipt.buildIdentity.gitCommit, OK_QUALIFICATION.report.binary.gitCommit);
    assert.ok(receipt.artifacts.length > 0, 'the receipt must bind the framework artifact digests');
    assert.ok(receipt.binary.sha256.match(/^[0-9a-f]{64}$/));

    const verdict = verifyRuntimeReadinessReceipt({ root, binaryPath: binary });
    assert.equal(verdict.ok, true, JSON.stringify(verdict.diagnostic));
    assert.equal(verdict.reason, 'coherent');
    assert.equal(verdict.diagnostic, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a receipt is never issued for a failed qualification', () => {
  const { root, binary } = scaffold();
  try {
    assert.throws(
      () => issueRuntimeReadinessReceipt({
        root,
        binaryPath: binary,
        qualification: { probe: 'restricted-no-eval-handler-vm', ok: false, report: null },
        issuer: 'unit-test',
      }),
      (error) => {
        assert.equal(error.code, RUNTIME_READINESS_INVALID_CODE);
        return true;
      },
    );
    assert.equal(existsSync(runtimeReadinessReceiptPath(binary)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('absence, malformation, an un-OK verdict, and probe drift are refused with the shared code', () => {
  const { root, binary } = scaffold();
  try {
    const absent = verifyRuntimeReadinessReceipt({ root, binaryPath: binary });
    assert.equal(absent.ok, false);
    assert.equal(absent.reason, 'absent');
    assert.equal(absent.diagnostic.code, RUNTIME_READINESS_INVALID_CODE);
    assert.equal(absent.diagnostic.details.custody, 'source-checkout');
    assert.equal(
      absent.diagnostic.details.repairCommand,
      join(root, 'scripts', 'assemble-runtime-package'),
    );
    assert.match(absent.diagnostic.details.requalifyCommand, /runtime-readiness\.mjs.*issue/u);

    writeFileSync(runtimeReadinessReceiptPath(binary), 'not json');
    const malformed = verifyRuntimeReadinessReceipt({ root, binaryPath: binary });
    assert.equal(malformed.reason, 'malformed');
    assert.equal(malformed.diagnostic.code, RUNTIME_READINESS_INVALID_CODE);

    const { receiptPath } = issueRuntimeReadinessReceipt({
      root,
      binaryPath: binary,
      qualification: OK_QUALIFICATION,
      issuer: 'unit-test',
    });
    const tampered = JSON.parse(readFileSync(receiptPath, 'utf8'));
    tampered.qualification.ok = false;
    writeFileSync(receiptPath, JSON.stringify(tampered));
    const unqualified = verifyRuntimeReadinessReceipt({ root, binaryPath: binary });
    assert.equal(unqualified.reason, 'unqualified');
    assert.equal(unqualified.diagnostic.code, RUNTIME_READINESS_INVALID_CODE);

    tampered.qualification.ok = true;
    tampered.qualification.probe = 'legacy-launch-only';
    writeFileSync(receiptPath, JSON.stringify(tampered));
    const probeDrift = verifyRuntimeReadinessReceipt({ root, binaryPath: binary });
    assert.equal(probeDrift.reason, 'probe-contract-drift');
    assert.equal(probeDrift.diagnostic.details.observedProbe, 'legacy-launch-only');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rebuilding the binary after issuance invalidates the receipt (binary-drift)', () => {
  const { root, binary } = scaffold();
  try {
    issueRuntimeReadinessReceipt({
      root,
      binaryPath: binary,
      qualification: OK_QUALIFICATION,
      issuer: 'unit-test',
    });
    writeFileSync(binary, 'rebuilt bytes the receipt never qualified');
    const verdict = verifyRuntimeReadinessReceipt({ root, binaryPath: binary });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, 'binary-drift');
    assert.equal(verdict.diagnostic.code, RUNTIME_READINESS_INVALID_CODE);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a framework change after issuance invalidates the receipt (framework-drift)', () => {
  const { root, binary } = scaffold();
  try {
    issueRuntimeReadinessReceipt({
      root,
      binaryPath: binary,
      qualification: OK_QUALIFICATION,
      issuer: 'unit-test',
    });
    // The rerun incident's exact shape: the Hermes runtime artifact is
    // refreshed underneath an already-qualified binary.
    const [artifact] = runtimeArtifactCandidates(root).filter((path) => existsSync(path));
    writeFileSync(artifact, 'a refreshed framework the qualification never saw');
    const verdict = verifyRuntimeReadinessReceipt({ root, binaryPath: binary });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, 'framework-drift');
    assert.equal(verdict.diagnostic.code, RUNTIME_READINESS_INVALID_CODE);

    // A tampered receipt (hand-edited digests) is equally incoherent: trust
    // never derives from the file's presence.
    writeFileSync(artifact, 'a refreshed framework the qualification never saw');
    const receiptPath = runtimeReadinessReceiptPath(binary);
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    receipt.artifacts = digestRuntimeArtifacts(root);
    receipt.binary.sha256 = '0'.repeat(64);
    writeFileSync(receiptPath, JSON.stringify(receipt));
    const forged = verifyRuntimeReadinessReceipt({ root, binaryPath: binary });
    assert.equal(forged.ok, false);
    assert.equal(forged.reason, 'binary-drift');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a moved checkout stays coherent: artifact identity is root-relative', () => {
  const { root, binary } = scaffold();
  const moved = `${root}-moved`;
  try {
    issueRuntimeReadinessReceipt({
      root,
      binaryPath: binary,
      qualification: OK_QUALIFICATION,
      issuer: 'unit-test',
    });
    spawnSync('mv', [root, moved]);
    const verdict = verifyRuntimeReadinessReceipt({
      root: moved,
      binaryPath: join(moved, 'target', 'debug', 'snapback'),
    });
    assert.equal(verdict.ok, true, JSON.stringify(verdict.diagnostic));
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(moved, { recursive: true, force: true });
  }
});

test('the CLI issues only after a live qualification and verifies read-only', () => {
  const { root, binary } = scaffold();
  try {
    // A stand-in binary that answers `runtime-qualify` like the real one.
    writeFileSync(binary, `#!/usr/bin/env node
if (process.argv[2] !== 'runtime-qualify') process.exit(2);
if (process.env.FIXTURE_QUALIFY_REFUSE === '1') {
  console.log(JSON.stringify({
    schemaVersion: 'snapback.runtime-qualify.v1',
    probe: 'restricted-no-eval-handler-vm',
    ok: false,
    diagnostic: { code: 'SNAPBACK_RUNTIME_CREATE_FAILED', message: 'Ibex runtime could not be created' },
  }));
  process.exit(1);
}
console.log(JSON.stringify({
  schemaVersion: 'snapback.runtime-qualify.v1',
  probe: 'restricted-no-eval-handler-vm',
  ok: true,
  binary: { gitCommit: 'cli-cafebabe', gitDirty: false, crateVersion: '1.2.3', buildProfile: 'debug' },
}));
`);
    chmodSync(binary, 0o755);

    // A refusing binary yields the CV-2 code and no receipt.
    const refused = spawnSync(process.execPath, [CLI, 'issue', '--binary', binary, '--root', root, '--json'], {
      encoding: 'utf8',
      env: { ...process.env, FIXTURE_QUALIFY_REFUSE: '1' },
    });
    assert.equal(refused.status, 1, refused.stderr);
    const refusedReport = JSON.parse(refused.stdout);
    assert.equal(refusedReport.ok, false);
    assert.equal(refusedReport.diagnostic.code, 'SNAPBACK_IBEX_RUNTIME_VM_CREATE_FAILED');
    assert.equal(existsSync(runtimeReadinessReceiptPath(binary)), false);

    // Verify refuses the absent receipt with the shared code, read-only.
    const absent = spawnSync(process.execPath, [CLI, 'verify', '--binary', binary, '--root', root, '--json'], {
      encoding: 'utf8',
    });
    assert.equal(absent.status, 1);
    assert.equal(JSON.parse(absent.stdout).diagnostic.code, RUNTIME_READINESS_INVALID_CODE);

    // A qualifying binary gets a persisted, then-verifiable receipt.
    const issued = spawnSync(process.execPath, [CLI, 'issue', '--binary', binary, '--root', root, '--issuer', 'cli-test', '--json'], {
      encoding: 'utf8',
    });
    assert.equal(issued.status, 0, issued.stdout + issued.stderr);
    const verified = spawnSync(process.execPath, [CLI, 'verify', '--binary', binary, '--root', root, '--json'], {
      encoding: 'utf8',
    });
    assert.equal(verified.status, 0, verified.stdout);
    const verdict = JSON.parse(verified.stdout);
    assert.equal(verdict.ok, true);
    assert.equal(verdict.receipt.issuer, 'cli-test');
    assert.equal(verdict.receipt.buildIdentity.gitCommit, 'cli-cafebabe');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
