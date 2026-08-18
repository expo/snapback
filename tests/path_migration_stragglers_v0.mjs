import assert from 'node:assert/strict';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  scanCommonPatterns,
  scanRustSource,
  readFailureSnippet,
  validateConsumerFiles,
  validateConsumerProjections,
  validateEpochAssignments,
  validateEpochShape,
  validateManifest,
} from '../scripts/check-path-migration-stragglers.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = join(ROOT, 'scripts/check-path-migration-stragglers.mjs');
const MANIFEST_PATH = join(ROOT, 'scripts/path-migration-manifest.v1.json');
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const WORKSPACE_MEMBERS = [
  'crates/snapback',
  'crates/snapback-activation',
  'crates/snapback-auth',
  'crates/snapback-cli',
  'crates/snapback-conformance',
  'crates/snapback-engine',
  'crates/snapback-kernel',
  'crates/snapback-runtime',
  'crates/snapback-server',
  'crates/snapback-services',
  'crates/snapback-sync',
  'crates/snapback-tools',
  'crates/snapback-types',
];

function runChecker(arguments_, cwd = ROOT, checker = CHECKER) {
  return spawnSync(process.execPath, [checker, ...arguments_], {
    cwd,
    encoding: 'utf8',
  });
}

function writeFixtureFile(root, repositoryPath, source = '') {
  const absolute = join(root, repositoryPath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, source);
}

function writeWorkspace(root, members) {
  writeFixtureFile(
    root,
    'Cargo.toml',
    `[workspace]\nmembers = [${members.map((member) => `"${member}"`).join(', ')}]\n`,
  );
  for (const member of members) writeFixtureFile(root, `${member}/Cargo.toml`, '[package]\nname = "fixture"\n');
}

function materializeEpoch(root, epoch) {
  if (epoch === 'pre-flip') {
    writeFixtureFile(root, 'Cargo.toml', '[package]\nname = "fixture"\n');
    for (const path of ['src/.keep', 'cloudflare/.keep', 'tools/agent-safe-baseline-worker/.keep', 'examples/.keep']) {
      writeFixtureFile(root, path);
    }
    return;
  }

  const members = epoch === 'phase-1'
    ? ['crates/snapback', 'crates/snapback-types']
    : WORKSPACE_MEMBERS;
  writeWorkspace(root, members);
  writeFixtureFile(root, 'crates/snapback/src/.keep');
  writeFixtureFile(root, 'scripts/check-module-ownership.mjs');
  writeFixtureFile(
    root,
    'crates/allowed-dependencies.v1.json',
    epoch === 'post-migration' ? '{}\n' : '{"remainderConfinementExemption": {}}\n',
  );
  if (epoch === 'phase-1') {
    for (const path of ['cloudflare/.keep', 'tools/agent-safe-baseline-worker/.keep', 'crates/snapback/examples/.keep']) {
      writeFixtureFile(root, path);
    }
  } else {
    writeFixtureFile(root, 'crates/snapback/examples/.keep');
    writeFixtureFile(root, epoch === 'phase-2' ? 'cloudflare/.keep' : 'targets/cloudflare/.keep');
  }
  if (epoch === 'post-migration') rmSync(join(root, 'scripts/check-module-ownership.mjs'));
}

function withEpochFixture(epoch, callback) {
  const fixtureRoot = mkdtempSync(join(tmpdir(), `snapback-path-epoch-${epoch}-`));
  try {
    materializeEpoch(fixtureRoot, epoch);
    callback(fixtureRoot);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

test('a moved Phase 1 tree with a committed pre-flip epoch fails before scanning', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'snapback-stale-path-epoch-'));
  try {
    mkdirSync(join(fixtureRoot, 'scripts'), { recursive: true });
    mkdirSync(join(fixtureRoot, 'crates/snapback/src'), { recursive: true });
    copyFileSync(CHECKER, join(fixtureRoot, 'scripts/check-path-migration-stragglers.mjs'));
    const staleManifest = structuredClone(manifest);
    staleManifest.epoch.current = 'pre-flip';
    writeFileSync(
      join(fixtureRoot, 'scripts/path-migration-manifest.v1.json'),
      `${JSON.stringify(staleManifest, null, 2)}\n`,
    );

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

test('every adjacent epoch pair has unique exact, partial, both, and neither shapes', async (t) => {
  const adjacentPairs = manifest.epoch.order.slice(0, -1)
    .map((epoch, index) => [epoch, manifest.epoch.order[index + 1]]);
  for (const [earlier, later] of adjacentPairs) {
    await t.test(`${earlier} -> ${later}: exact shapes select only their epoch`, () => {
      withEpochFixture(earlier, (root) => {
        assert.deepEqual(validateEpochShape(earlier, root), []);
        assert.notDeepEqual(validateEpochShape(later, root), []);
      });
      withEpochFixture(later, (root) => {
        assert.deepEqual(validateEpochShape(later, root), []);
        assert.notDeepEqual(validateEpochShape(earlier, root), []);
      });
    });

    await t.test(`${earlier} -> ${later}: partial/both/neither shapes select neither epoch`, () => {
      const variants = ['partial', 'both', 'neither'];
      for (const variant of variants) {
        withEpochFixture(earlier, (root) => {
          if (earlier === 'pre-flip') {
            if (variant !== 'neither') writeFixtureFile(root, 'crates/snapback/src/.keep');
            if (variant !== 'both') rmSync(join(root, 'src'), { recursive: true, force: true });
          } else if (earlier === 'phase-1') {
            if (variant !== 'neither') {
              writeWorkspace(root, WORKSPACE_MEMBERS);
              writeFixtureFile(root, 'crates/snapback-tools/.keep');
            }
            if (variant !== 'both') rmSync(join(root, 'tools/agent-safe-baseline-worker'), { recursive: true, force: true });
            if (variant === 'partial') {
              rmSync(join(root, 'crates/snapback/examples'), { recursive: true, force: true });
            }
          } else if (earlier === 'phase-2') {
            if (variant !== 'neither') writeFixtureFile(root, 'targets/cloudflare/.keep');
            if (variant !== 'both') rmSync(join(root, 'cloudflare'), { recursive: true, force: true });
            if (variant === 'partial') rmSync(join(root, 'scripts/check-module-ownership.mjs'), { force: true });
          } else {
            if (variant === 'both' || variant === 'partial') {
              writeFixtureFile(root, 'crates/allowed-dependencies.v1.json', '{}\n');
            }
            if (variant !== 'both') rmSync(join(root, 'scripts/check-module-ownership.mjs'), { force: true });
            if (variant === 'partial') rmSync(join(root, 'targets/cloudflare'), { recursive: true, force: true });
          }
          assert.notDeepEqual(validateEpochShape(earlier, root), [], `${earlier}/${later} ${variant} accepted ${earlier}`);
          assert.notDeepEqual(validateEpochShape(later, root), [], `${earlier}/${later} ${variant} accepted ${later}`);
        });
      }
    });
  }
});

test('the named fixture exemption stops at exact fixture-builder files', () => {
  const fixtureBuilder = runChecker(['--epoch', 'phase-3', '--path', 'tests/local_proof_selection_v0.mjs']);
  assert.equal(fixtureBuilder.status, 0, fixtureBuilder.stderr);
  assert.match(fixtureBuilder.stdout, /scannedFiles=0, exemptFiles=1/u);

  const ordinaryScriptTest = runChecker([
    '--epoch',
    'phase-3',
    '--path',
    'scripts/build-linux-runtime-release.test.mjs',
  ]);
  assert.equal(ordinaryScriptTest.status, 0, ordinaryScriptTest.stderr);
  assert.match(ordinaryScriptTest.stdout, /scannedFiles=1, exemptFiles=0/u);

  const workflowAuthority = runChecker(['--epoch', 'phase-3', '--path', 'tests/ci_workflows_v0.mjs']);
  assert.equal(workflowAuthority.status, 1);
  assert.match(
    workflowAuthority.stderr,
    /tests\/ci_workflows_v0\.mjs:37 \[workflow-yaml\/cloudflare-root\].*node cloudflare\/scripts\/generate-deployment-identity\.mjs --check/u,
  );
  assert.match(workflowAuthority.stderr, /scannedFiles=1, exemptFiles=0/u);

  const attemptedSwallow = structuredClone(manifest);
  attemptedSwallow.exceptions.namedNegativeFixtures[0] = {
    id: 'module-ownership-fixture-repositories',
    pattern: '^tests/.*\\.mjs$',
  };
  assert.deepEqual(
    validateManifest(attemptedSwallow).filter((error) => error.includes('tests/ci_workflows_v0.mjs')),
    ['tests/ci_workflows_v0.mjs is structurally unexemptable'],
  );
});

test('normalized root-path mutations cover relative, quoted, and concatenated forms', () => {
  const phase1 = manifest.epoch.order.indexOf('phase-1');
  const mutations = [
    'const path = "./src/storage.rs";',
    '[storage](../src/storage.rs)',
    '{"source":"../src/storage.rs"}',
    "source: './src/storage.rs'",
    "const path = 'src' + '/storage.rs';",
    "const path = join(ROOT, 'src', 'storage.rs');",
    "const path = resolve(import.meta.dirname, '..', 'src', 'storage.rs');",
    "const path = new URL('src', 'storage.rs');",
    String.raw`const path = "src\/storage.rs";`,
    String.raw`const path = "src\storage.rs";`,
    'const path = "src%2Fstorage.rs";',
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

test('due consumers are projected from the manifest and an unprojectable planted consumer fails', () => {
  const phase3 = manifest.epoch.order.indexOf('phase-3');
  const packageJson = runChecker(['--epoch', 'phase-3', '--path', 'package.json']);
  assert.notEqual(packageJson.status, 2, packageJson.stderr);
  assert.doesNotMatch(packageJson.stderr, /outside the checked projections/u);

  const localSuiteManifest = runChecker([
    '--epoch',
    'phase-3',
    '--path',
    'cloudflare/test/local-suite-manifest.mjs',
  ]);
  assert.notEqual(localSuiteManifest.status, 2, localSuiteManifest.stderr);
  assert.doesNotMatch(localSuiteManifest.stderr, /outside the checked projections/u);

  const extendedKinds = structuredClone(manifest);
  extendedKinds.consumers.find(({ id }) => id === 's01-r001').consumerFiles.push(
    'config/path-consumer.yaml',
    'config/path-consumer.jsonc',
    'targets/example/src/path_consumer.rs',
    'clients/example/PathConsumer.swift',
  );
  assert.deepEqual(validateConsumerProjections(extendedKinds, phase3), []);

  const planted = structuredClone(manifest);
  planted.consumers.find(({ id }) => id === 's01-r001').consumerFiles.push('LICENSE');
  assert.deepEqual(validateConsumerProjections(planted, phase3), [
    'consumer s01-r001 due at phase-3 has unprojectable consumerFiles entry LICENSE',
  ]);
  assert.deepEqual(validateConsumerProjections(manifest, phase3), []);
});

test('a composed stale Unicode generator source path is caught from Phase 1', () => {
  const source = "const output = resolve(root, 'src', 'search', 'unicode17_generated.rs');";
  const findings = scanCommonPatterns({
    source,
    repositoryPath: 'scripts/generate-search-unicode.mjs',
    projection: 'scripts',
    patterns: manifest.stalePathPatterns,
    manifest,
    epochIndex: manifest.epoch.order.indexOf('phase-1'),
  });
  assert.deepEqual(
    findings.filter(({ pattern }) => pattern === 'root-src-path').map(({ line }) => line),
    [1],
  );
});

test('each epoch destination shape yields zero findings for its active families', () => {
  const migratedByEpoch = new Map([
    ['phase-1', [
      'const source = "crates/snapback/src/search/unicode17_generated.rs";',
      'const test = "crates/snapback/tests/wait_cli_v1.rs";',
      'const build = "crates/snapback/build.rs";',
      'const relative = "../../crates/snapback/src/storage.rs";',
      "const composed = resolve(ROOT, 'crates', 'snapback', 'src', 'search', 'unicode17_generated.rs');",
    ]],
    ['phase-2', [
      'const tool = "crates/snapback-tools/src/bin/snapback-agent-safe-candidate.rs";',
      'const example = "crates/snapback/examples/native_code.rs";',
    ]],
    ['phase-3', [
      'const target = "targets/cloudflare/test/local-suite.mjs";',
      'const relative = "../../targets/cloudflare/test/local-suite.mjs";',
      "const composed = join(ROOT, 'targets', 'cloudflare', 'test', 'local-suite.mjs');",
    ]],
  ]);
  for (const [epoch, lines] of migratedByEpoch) {
    const findings = scanCommonPatterns({
      source: lines.join('\n'),
      repositoryPath: 'scripts/migrated-fixture.mjs',
      projection: 'scripts',
      patterns: manifest.stalePathPatterns,
      manifest,
      epochIndex: manifest.epoch.order.indexOf(epoch),
    });
    assert.deepEqual(findings, [], epoch);
  }

  const mixed = scanCommonPatterns({
    source: [
      'const oldAndNew = ["src/storage.rs", "crates/snapback/src/storage.rs"];',
      'const oldAndNewTarget = ["cloudflare/test/local-suite.mjs", "targets/cloudflare/test/local-suite.mjs"];',
    ].join('\n'),
    repositoryPath: 'scripts/mixed-fixture.mjs',
    projection: 'scripts',
    patterns: manifest.stalePathPatterns,
    manifest,
    epochIndex: manifest.epoch.order.indexOf('phase-3'),
  });
  assert.deepEqual(mixed.map(({ pattern }) => pattern), ['root-src-path', 'cloudflare-root']);
});

test('unreadable-file diagnostics never include checkout-specific absolute paths', () => {
  const snippet = readFailureSnippet({
    code: 'EACCES',
    message: `EACCES: permission denied, open '${join(ROOT, 'scripts/private.mjs')}'`,
  });
  assert.equal(snippet, 'read failed (EACCES)');
  assert.equal(snippet.includes(ROOT), false);
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

test('manifest rows retain the pre-flip inventory with structurally valid epochs', () => {
  assert.equal(manifest.consumers.length, 210);
  assert.deepEqual(validateManifest(manifest), []);
  if (manifest.epoch.current === 'pre-flip') {
    assert.deepEqual(validateConsumerFiles(manifest, ROOT), []);
  } else {
    assert.equal(manifest.epoch.current, 'phase-1');
  }
  assert.deepEqual(validateEpochAssignments(manifest), []);
  for (const epoch of manifest.epoch.order) {
    assert.deepEqual(validateConsumerProjections(manifest, manifest.epoch.order.indexOf(epoch)), [], epoch);
  }

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
