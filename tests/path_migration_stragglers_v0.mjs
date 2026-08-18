import assert from 'node:assert/strict';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  scanCommonPatterns,
  scanRustSource,
  validateConsumerFiles,
  validateEpochAssignments,
  validateManifest,
} from '../scripts/check-path-migration-stragglers.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = join(ROOT, 'scripts/check-path-migration-stragglers.mjs');
const MANIFEST_PATH = join(ROOT, 'scripts/path-migration-manifest.v1.json');
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));

function runChecker(arguments_, cwd = ROOT, checker = CHECKER) {
  return spawnSync(process.execPath, [checker, ...arguments_], {
    cwd,
    encoding: 'utf8',
  });
}

test('a moved Phase 1 tree with a committed pre-flip epoch fails before scanning', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'snapback-stale-path-epoch-'));
  try {
    mkdirSync(join(fixtureRoot, 'scripts'), { recursive: true });
    mkdirSync(join(fixtureRoot, 'crates/snapback/src'), { recursive: true });
    copyFileSync(CHECKER, join(fixtureRoot, 'scripts/check-path-migration-stragglers.mjs'));
    copyFileSync(MANIFEST_PATH, join(fixtureRoot, 'scripts/path-migration-manifest.v1.json'));

    const result = runChecker([], fixtureRoot, join(fixtureRoot, 'scripts/check-path-migration-stragglers.mjs'));
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(
      result.stderr,
      /PATH_MIGRATION_STRAGGLER_EPOCH_SHAPE_INVALID: pre-flip forbids directory crates\/snapback\/src\//u,
    );
    assert.match(
      result.stderr,
      /PATH_MIGRATION_STRAGGLER_EPOCH_SHAPE_INVALID: pre-flip requires directory src\//u,
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('the named fixture exemption stops at exact fixture-builder files', () => {
  const fixtureBuilder = runChecker(['--epoch', 'phase-3', '--path', 'tests/local_proof_selection_v0.mjs']);
  assert.equal(fixtureBuilder.status, 0, fixtureBuilder.stderr);
  assert.match(fixtureBuilder.stdout, /scannedFiles=0, exemptFiles=1/u);

  const workflowAuthority = runChecker(['--epoch', 'phase-3', '--path', 'tests/ci_workflows_v0.mjs']);
  assert.equal(workflowAuthority.status, 1);
  assert.match(
    workflowAuthority.stderr,
    /tests\/ci_workflows_v0\.mjs:37 \[workflow-yaml\/cloudflare-root\].*node cloudflare\/scripts\/generate-deployment-identity\.mjs --check/u,
  );
  assert.match(workflowAuthority.stderr, /scannedFiles=1, exemptFiles=0/u);
});

test('normalized root-path mutations cover relative, quoted, and concatenated forms', () => {
  const phase1 = manifest.epoch.order.indexOf('phase-1');
  const mutations = [
    'const path = "./src/storage.rs";',
    '[storage](../src/storage.rs)',
    '{"source":"../src/storage.rs"}',
    "source: './src/storage.rs'",
    "const path = 'src' + '/storage.rs';",
  ];

  for (const source of mutations) {
    const findings = scanCommonPatterns({
      source,
      repositoryPath: 'llp/fixture.spec.md',
      projection: 'docs-process',
      patterns: manifest.stalePathPatterns,
      manifest,
      epochIndex: phase1,
    });
    assert.ok(findings.some(({ pattern }) => pattern === 'root-src-path'), source);
  }

  const clean = scanCommonPatterns({
    source: 'const path = "crates/snapback/src/storage.rs";',
    repositoryPath: 'llp/fixture.spec.md',
    projection: 'docs-process',
    patterns: manifest.stalePathPatterns,
    manifest,
    epochIndex: phase1,
  });
  assert.equal(clean.some(({ pattern }) => pattern === 'root-src-path'), false);
});

test('CARGO_MANIFEST_DIR helpers cannot masquerade as repository roots', () => {
  const source = `
fn detect() {
    let path = snapback_root().join("vendor").join("ibex");
}

fn snapback_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}
`;
  const findings = scanRustSource(
    source,
    'crates/snapback/src/runtime.rs',
    manifest.epoch.order.indexOf('phase-1'),
    manifest,
  );
  assert.deepEqual(
    findings.filter(({ pattern }) => pattern === 'manifest-dir-helper-root-hop').map(({ line }) => line),
    [3],
  );
});

test('manifest rows are exact pre-flip files with structurally valid epochs', () => {
  assert.equal(manifest.consumers.length, 207);
  assert.deepEqual(validateManifest(manifest), []);
  assert.deepEqual(validateConsumerFiles(manifest, ROOT), []);
  assert.deepEqual(validateEpochAssignments(manifest), []);

  const earlyCloudflareMove = structuredClone(manifest);
  earlyCloudflareMove.consumers.find(({ id }) => id === 's12-r001').applyByEpoch = 'phase-1';
  assert.match(
    validateEpochAssignments(earlyCloudflareMove).join('\n'),
    /before target file targets\/cloudflare\/README\.md can exist \(phase-3\)/u,
  );

  const shorthand = structuredClone(manifest);
  shorthand.consumers[0].consumerFiles = ['tests/{wait_cli_v1.rs'];
  assert.match(validateManifest(shorthand).join('\n'), /non-file consumerFiles entry/u);
});
