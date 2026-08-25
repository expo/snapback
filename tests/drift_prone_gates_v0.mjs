import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  digestSelectedGateIds,
  loadSelectionContext,
  selectDriftProneGates,
} from '../scripts/select-local-proof.mjs';
import {
  batteryFailureSignature,
  parseBatteryResults,
  printRefusal,
  runBatteryBackstop,
  runBatteryReport,
  runBackstop,
  runPrePush,
  runRegisteredGateAtRevision,
  standingBatteryClaims,
} from '../scripts/drift-prone-gates.mjs';

// Every probe below is committed in a disposable clone before Git invokes the
// real tracked pre-push hook. A working-tree-only edit is deliberately never
// used as evidence for selection or enforcement.
// @ref LLP 0232#optimistic-landing-default-2026-08-13 — committed-history
// integration fixtures prove default deferral, strict refusal/reconciliation,
// compatibility bypass, tiering, and the authoritative scheduled backstop.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROOF_RUNNER = join(ROOT, 'scripts', 'lib', 'proof-runner.sh');
const FIXTURE_COMPLETION_RUN_ID = '12345678-1234-4123-8123-123456789abc';

function writeBatteryCompletion(root, resultsPath, canonicalGates) {
  const completionPath = join(root, 'proof-completion.json');
  const resultsSource = readFileSync(resultsPath);
  writeFileSync(completionPath, `${JSON.stringify({
    schemaVersion: 'snapback.proof-completion.v1',
    runId: FIXTURE_COMPLETION_RUN_ID,
    proofId: 'local-proof',
    selectedGateCount: canonicalGates.length,
    selectedGateDigest: digestSelectedGateIds(canonicalGates),
    resultsDigest: `sha256:${createHash('sha256').update(resultsSource).digest('hex')}`,
  })}\n`);
  return completionPath;
}
const IMPLEMENTATION_FILES = [
  '.githooks/pre-push',
  'issues/closed/20260811-record-inventory-guide.md',
  'crates/allowed-dependencies.v1.json',
  'guide/capabilities.md',
  'issues/20260825-guide-gap-first-class-notifications.md',
  'issues/20260825-guide-gap-kotlin-dart-clients.md',
  'issues/20260825-guide-gap-sequence-publication-targets.md',
  'scripts/check-path-migration-stragglers.mjs',
  'scripts/check-visibility-governance.mjs',
  'scripts/check-workspace-graph.mjs',
  'scripts/drift-prone-gates.mjs',
  'scripts/guide-lib.mjs',
  'scripts/check-contract-meta.mjs',
  'scripts/check-contract-meta.test.mjs',
  'scripts/check-diary-identity.mjs',
  'scripts/local-proof-selection-policy.v1.json',
  'scripts/path-migration-manifest.v1.json',
  'scripts/select-local-proof.mjs',
  'scripts/update-agent-safe-publication-leaf-set.mjs',
  'scripts/update-contract-meta.mjs',
  'scripts/verify-local-proof',
  'tests/agent_safe_publication_checker_v1.mjs',
  'tests/drift_prone_gates_v0.mjs',
  'tests/workspace_graph_v1.mjs',
];
const GUIDE_PREPARED_INPUTS = [
  'demos/competitive-checkpoint/snapback/generated/operations/startReply.args.schema.json',
  'demos/todo-v2/snapback/generated/contract/runtime-links.ts',
  'demos/todo-v2/snapback/generated/contract/setCompleted.mutation.ts',
];

function git(cwd, args, options = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function run(cwd, command, args, { env = process.env } = {}) {
  const started = performance.now();
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    ...result,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    wallMs: Math.round(performance.now() - started),
  };
}

function copyImplementation(repo) {
  for (const path of IMPLEMENTATION_FILES) {
    const source = join(ROOT, path);
    const target = join(repo, path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
  // This lane resolves the Guide record-inventory ticket. Disposable clones
  // start from committed HEAD, so mirror the uncommitted move before testing
  // that a later stale Guide files one new, idempotent backstop ticket.
  rmSync(join(repo, 'issues/20260811-record-inventory-guide.md'), { force: true });
  for (const path of [
    '.githooks/pre-push',
    'scripts/drift-prone-gates.mjs',
    'scripts/update-agent-safe-publication-leaf-set.mjs',
    'scripts/update-contract-meta.mjs',
    'scripts/verify-local-proof',
  ]) chmodSync(join(repo, path), 0o755);
}

function commitAll(repo, message, { amend = false } = {}) {
  git(repo, ['add', '--all']);
  git(repo, amend
    ? ['commit', '--amend', '--no-edit']
    : ['commit', '-m', message]);
  return git(repo, ['rev-parse', 'HEAD']).trim();
}

function relevantLines(output) {
  return output.split(/\r?\n/u).filter((line) => (
    line.includes('[snapback-drift]')
      || line.includes('[snapback-drift-backstop]')
      || line.includes('[visibility-governance]')
      || line.includes('[guide-check] error: guide/guide-manifest.generated.json')
      || line.includes('[guide-check] error: guide/guide-flat.generated.md')
  )).join('\n');
}

function inheritedStaleGateNames(output) {
  return [...new Set(
    [...output.matchAll(/^\[snapback-drift\] PRE-EXISTING STALE ([^:]+):/gmu)]
      .map((match) => match[1]),
  )].sort();
}

function installGuideDriftFixtureChecker(repo) {
  // This suite exercises revision selection, baseline attribution, refusal,
  // and reconciliation in the drift runner. Keep that integration fixture
  // independent of unrelated full-Guide freshness (including package/runtime
  // projections supplied by the host's dependency mirror): the Guide's own
  // suites cover those checks. The frozen page digest is enough to make the
  // committed stale/regenerated transition real.
  writeFileSync(join(repo, 'scripts/check-guide.mjs'), `#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const manifest = JSON.parse(readFileSync('guide/guide-manifest.generated.json', 'utf8'));
const page = Object.values(manifest.pages).find((entry) => entry.path === 'guide/index.md');
const digest = createHash('sha256').update(readFileSync('guide/index.md')).digest('hex');
if (!page || page.sha256 !== digest) {
  console.error('[guide-check] error: guide/guide-manifest.generated.json: stale or missing — run node scripts/generate-guide-manifest.mjs');
  process.exit(1);
}
console.log('[guide-check] ok — fixture page digest matches');
`);
}

function installPathMigrationDriftFixtureChecker(repo) {
  const plantedPath = 'scripts/path-migration-review-straggler.mjs';
  writeFileSync(join(repo, plantedPath), "export const retiredPath = 'src/storage.rs';\n");
  const realChecker = run(repo, process.execPath, [
    'scripts/check-path-migration-stragglers.mjs',
    '--epoch',
    'phase-3',
    '--path',
    plantedPath,
  ]);
  assert.equal(realChecker.status, 1, realChecker.output);
  assert.match(realChecker.output, /root-src-path/u);
  rmSync(join(repo, plantedPath));

  // This suite exercises committed-revision selection and D-3 classification,
  // while the now-canonical tests/path_migration_stragglers_v0.mjs suite owns
  // the scanner's complete semantic matrix. The assertion above keeps this
  // integration seam honest by proving the real checker rejects a controlled
  // planted straggler before the narrow drift-runner stub replaces it.
  // Keep the integration baseline independent of unrelated corpus literals
  // that may legitimately make main's full scanner red. The fixture still
  // validates the frozen manifest authority and must run green in strict mode.
  writeFileSync(join(repo, 'scripts/check-path-migration-stragglers.mjs'), `#!/usr/bin/env node
import { readFileSync } from 'node:fs';
const manifest = JSON.parse(readFileSync('scripts/path-migration-manifest.v1.json', 'utf8'));
if (manifest.schemaVersion !== 'snapback.path-migration-manifest.v1'
  || manifest.epoch?.current !== 'phase-3') {
  console.error('PATH_MIGRATION_STRAGGLER_FIXTURE_INVALID: manifest authority is invalid');
  process.exit(1);
}
console.log('path-migration straggler gate fixture: PASS');
`);
}

function setupCommittedClone() {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-drift-integration-'));
  const repo = join(scratch, 'repo');
  const remote = join(scratch, 'remote.git');
  git(ROOT, ['clone', '--shared', '--quiet', ROOT, repo]);
  git(repo, ['config', 'user.name', 'Snapback drift fixture']);
  git(repo, ['config', 'user.email', 'snapback-drift-fixture@example.invalid']);
  copyImplementation(repo);
  const worktreeListing = git(ROOT, ['worktree', 'list', '--porcelain']);
  const dependencyRoot = worktreeListing.split(/\r?\n/u)
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length))
    .find((path) => (
      existsSync(join(path, 'node_modules/.bun'))
        && existsSync(join(path, 'packages/snapback-codegen/node_modules'))
        && GUIDE_PREPARED_INPUTS.every((input) => existsSync(join(path, input)))
    ));
  assert.ok(dependencyRoot, 'a prepared worktree with JavaScript dependencies is required');
  const sourceModules = join(dependencyRoot, 'node_modules');
  const targetModules = join(repo, 'node_modules');
  mkdirSync(targetModules);
  for (const entry of readdirSync(sourceModules, { withFileTypes: true })) {
    if (entry.name === '@expo') continue;
    symlinkSync(join(sourceModules, entry.name), join(targetModules, entry.name), entry.isDirectory() ? 'dir' : 'file');
  }
  mkdirSync(join(targetModules, '@expo'));
  const expoWorkspaces = readdirSync(join(repo, 'packages')).flatMap((directory) => {
    const manifest = join(repo, 'packages', directory, 'package.json');
    if (!existsSync(manifest)) return [];
    const { name } = JSON.parse(readFileSync(manifest, 'utf8'));
    if (typeof name !== 'string' || !name.startsWith('@expo/')) return [];
    return [{ directory, name: name.slice('@expo/'.length) }];
  });
  for (const { directory, name } of expoWorkspaces) {
    symlinkSync(join(repo, 'packages', directory), join(targetModules, '@expo', name), 'dir');
  }
  const sourceCodegenModules = join(dependencyRoot, 'packages/snapback-codegen/node_modules');
  const targetCodegenModules = join(repo, 'packages/snapback-codegen/node_modules');
  mkdirSync(targetCodegenModules);
  for (const entry of readdirSync(sourceCodegenModules, { withFileTypes: true })) {
    if (entry.name === '@expo' || entry.name === '@snapback') continue;
    symlinkSync(
      join(sourceCodegenModules, entry.name),
      join(targetCodegenModules, entry.name),
      entry.isDirectory() ? 'dir' : 'file',
    );
  }
  for (const [scope, names] of [
    ['@expo', ['snapback-contract']],
    ['@snapback', ['contract']],
  ]) {
    mkdirSync(join(targetCodegenModules, scope));
    for (const name of names) {
      symlinkSync(
        join(repo, 'packages/snapback-contract'),
        join(targetCodegenModules, scope, name),
        'dir',
      );
    }
  }
  appendFileSync(
    join(repo, '.git/info/exclude'),
    '\n/node_modules\n/packages/*/node_modules\n',
  );
  for (const path of GUIDE_PREPARED_INPUTS) {
    assert.ok(existsSync(join(dependencyRoot, path)), `prepared Guide input exists: ${path}`);
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    copyFileSync(join(dependencyRoot, path), join(repo, path));
    git(repo, ['add', '--force', '--', path]);
  }
  const contractMeta = run(repo, process.execPath, ['scripts/check-contract-meta.test.mjs']);
  assert.equal(contractMeta.status, 0, contractMeta.output);
  const baselineGuide = run(repo, process.execPath, ['scripts/generate-guide-manifest.mjs']);
  assert.equal(baselineGuide.status, 0, baselineGuide.output);
  installGuideDriftFixtureChecker(repo);
  installPathMigrationDriftFixtureChecker(repo);
  commitAll(repo, 'test: install drift enforcement under committed state');
  git(ROOT, ['init', '--bare', '--quiet', remote]);
  git(repo, ['remote', 'rename', 'origin', 'source']);
  git(repo, ['remote', 'add', 'origin', remote]);
  git(repo, [
    '-c', 'core.hooksPath=/dev/null',
    'push', '--quiet', '-u', 'origin', 'HEAD:refs/heads/main',
  ]);
  git(repo, ['config', 'core.hooksPath', '.githooks']);
  return { scratch, repo };
}

const OUTCOME_GATE_SOURCE = `import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const phase = process.argv[2];
const state = JSON.parse(readFileSync(new URL('./state.json', import.meta.url), 'utf8'));
const mode = state[phase] ?? 'pass';
if (mode === 'pass') {
} else if (mode.startsWith('content:')) {
  console.error('fixture content failure: ' + mode.slice('content:'.length));
  process.exitCode = 1;
} else if (mode.startsWith('infra:')) {
  console.error('[snapback-bootstrap] error: SNAPBACK_CAPABILITY_IBEX_HERMES_MISSING ' + process.cwd() + ' ' + mode.slice('infra:'.length));
  process.exitCode = 1;
} else if (mode.startsWith('snapback:')) {
  const [code, ...detail] = mode.slice('snapback:'.length).split(':');
  console.error('[runtime-link-smoke] ' + code + ': ' + detail.join(':'));
  process.exitCode = 1;
} else if (mode === 'module-missing') {
  console.error("Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'fixture-missing' imported from " + process.cwd());
  process.exitCode = 1;
} else if (mode === 'unknown') {
  process.exitCode = 1;
} else if (mode === 'nondeterministic') {
  const counter = process.env.SNAPBACK_DRIFT_FIXTURE_COUNTER;
  if (existsSync(counter)) {
    console.log('fixture pass after determinate red');
  } else {
    writeFileSync(counter, 'red observed\\n');
    console.error('fixture content failure: transient contradiction');
    process.exitCode = 1;
  }
} else if (mode === 'alternating-red') {
  const counter = process.env.SNAPBACK_DRIFT_FIXTURE_COUNTER;
  if (existsSync(counter)) {
    console.error('fixture content failure: second contradictory red');
  } else {
    writeFileSync(counter, 'first red observed\\n');
    console.error('fixture content failure: first contradictory red');
  }
  process.exitCode = 1;
} else if (mode === 'dependency-drift') {
  const dependency = new URL('../node_modules/fixture-dependency/mutable.txt', import.meta.url);
  const before = readFileSync(dependency, 'utf8').trim();
  writeFileSync(dependency, before + '-changed\\n');
  console.error('fixture content failure: dependency changed from ' + before);
  process.exitCode = 1;
} else if (mode === 'dependency-sibling-drift') {
  const dependency = new URL('../node_modules/@fixture/platform/mutable.txt', import.meta.url);
  const before = readFileSync(dependency, 'utf8').trim();
  writeFileSync(dependency, before + '-changed\\n');
  console.error('fixture content failure: platform sibling changed from ' + before);
  process.exitCode = 1;
} else {
  console.error('fixture invalid mode: ' + mode);
  process.exitCode = 2;
}
`;

function fixtureOutcomeContext(gateId = 'guide') {
  const context = structuredClone(loadSelectionContext());
  context.policy.driftAlwaysRunGates = [];
  context.policy.driftFailClosedCoreGates = [];
  context.policy.driftProneGates = {
    [gateId]: {
      records: ['fixture/frozen-record.json'],
      recordPaths: ['fixture/frozen-record.json'],
      triggerRules: { prefixes: ['fixture/'] },
      regenerateCommand: 'node fixture/gate.mjs regenerate',
      prepareCommand: 'node fixture/gate.mjs prepare',
    },
  };
  context.calls = [{
    gateId,
    command: 'node fixture/gate.mjs check',
    prerequisites: [],
  }];
  return context;
}

function fixtureFullRegistryContext() {
  const context = fixtureOutcomeContext();
  context.policy.driftFailClosedCoreGates = ['guide'];
  context.policy.driftProneGates['contract-meta'] = {
    records: ['fixture/second-frozen-record.json'],
    recordPaths: ['fixture/second-frozen-record.json'],
    triggerRules: { prefixes: ['second-fixture/'] },
    regenerateCommand: 'node fixture/gate.mjs regenerate',
    prepareCommand: 'node fixture/gate.mjs prepare',
  };
  context.calls.push({
    gateId: 'contract-meta',
    command: 'node fixture/gate.mjs check',
    prerequisites: [],
  });
  return context;
}

function fixtureExternalDependencyContext(gateId = 'guide') {
  const context = fixtureOutcomeContext(gateId);
  context.policy.driftProneGates[gateId].requiredModules = ['fixture-dependency'];
  return context;
}

function installFixtureDependency(repo) {
  const directory = join(repo, 'node_modules/fixture-dependency');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'package.json'), `${JSON.stringify({
    name: 'fixture-dependency',
    version: '1.0.0',
    main: 'index.js',
    optionalDependencies: { '@fixture/platform': '1.0.0' },
  })}\n`);
  writeFileSync(join(directory, 'index.js'), 'module.exports = true;\n');
  writeFileSync(join(directory, 'mutable.txt'), 'original\n');
  const platformDirectory = join(repo, 'node_modules/@fixture/platform');
  mkdirSync(platformDirectory, { recursive: true });
  writeFileSync(join(platformDirectory, 'package.json'), `${JSON.stringify({
    name: '@fixture/platform',
    version: '1.0.0',
    main: 'index.js',
  })}\n`);
  writeFileSync(join(platformDirectory, 'index.js'), 'module.exports = true;\n');
  writeFileSync(join(platformDirectory, 'mutable.txt'), 'original\n');
}

function capturePrePush(callback) {
  const chunks = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalWrite = process.stderr.write;
  console.log = (...args) => chunks.push(`${args.join(' ')}\n`);
  console.error = (...args) => chunks.push(`${args.join(' ')}\n`);
  process.stderr.write = (chunk) => {
    chunks.push(`${chunk}`);
    return true;
  };
  try {
    return { status: callback(), output: chunks.join('') };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.stderr.write = originalWrite;
  }
}

function runOutcomeFixture({
  baseline,
  pushed,
  attempts = 1,
  unavailableBaseline = false,
  gateId = 'guide',
  staleRequestLock = false,
  tornRequestLine = null,
  triggerPath = 'fixture/trigger.txt',
  multiRef = null,
  secondPushed = pushed,
  contextFactory = fixtureOutcomeContext,
  env: envOverrides = {},
}) {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-drift-outcome-'));
  const repo = join(scratch, 'repo');
  mkdirSync(repo);
  try {
    git(repo, ['init', '--quiet']);
    git(repo, ['config', 'user.name', 'Snapback drift outcome fixture']);
    git(repo, ['config', 'user.email', 'snapback-drift-outcome@example.invalid']);
    mkdirSync(join(repo, 'fixture'));
    writeFileSync(join(repo, '.gitignore'), '/target\n/node_modules\n');
    writeFileSync(join(repo, 'fixture/gate.mjs'), OUTCOME_GATE_SOURCE);
    writeFileSync(join(repo, 'fixture/frozen-record.json'), '{}\n');
    writeFileSync(join(repo, 'fixture/state.json'), `${JSON.stringify(baseline)}\n`);
    const fixtureContext = contextFactory(gateId);
    if (fixtureContext.policy.driftProneGates[gateId].requiredModules?.includes(
      'fixture-dependency',
    )) installFixtureDependency(repo);
    const baselineRevision = commitAll(repo, 'test: outcome baseline');
    writeFileSync(join(repo, 'fixture/state.json'), `${JSON.stringify(pushed)}\n`);
    mkdirSync(dirname(join(repo, triggerPath)), { recursive: true });
    writeFileSync(join(repo, triggerPath), 'pushed revision\n');
    const pushedRevision = commitAll(repo, 'test: outcome pushed revision');
    const remoteRevision = unavailableBaseline
      ? git(repo, [
          'commit-tree',
          git(repo, ['rev-parse', `${baselineRevision}^{tree}`]).trim(),
          '-m',
          'unrelated baseline',
        ]).trim()
      : baselineRevision;
    let secondRevision = null;
    if (multiRef === 'distinct-tips') {
      git(repo, ['checkout', '--detach', '--quiet', baselineRevision]);
      writeFileSync(join(repo, 'fixture/state.json'), `${JSON.stringify(secondPushed)}\n`);
      mkdirSync(join(repo, 'second-fixture'), { recursive: true });
      writeFileSync(join(repo, 'second-fixture/trigger.txt'), 'second pushed revision\n');
      secondRevision = commitAll(repo, 'test: distinct second-ref revision');
    }
    const requestPath = join(repo, 'target/proof/drift-ticket-requests.jsonl');
    if (tornRequestLine !== null) {
      mkdirSync(dirname(requestPath), { recursive: true });
      writeFileSync(requestPath, `${tornRequestLine}\n`);
    }
    if (staleRequestLock) {
      mkdirSync(`${requestPath}.lock`, { recursive: true });
      const staleTime = new Date(Date.now() - 2 * 60 * 1000);
      utimesSync(`${requestPath}.lock`, staleTime, staleTime);
    }
    const env = {
      ...process.env,
      SNAPBACK_DRIFT_FIXTURE_COUNTER: join(scratch, 'counter'),
      SNAPBACK_DRIFT_TICKET_REQUESTS: 'target/proof/drift-ticket-requests.jsonl',
      SNAPBACK_DRIFT_GATES_STRICT: '1',
      ...envOverrides,
    };
    const input = multiRef === 'same-tip'
      ? `refs/heads/main ${pushedRevision} refs/heads/main ${remoteRevision}\n`
        + `refs/heads/release ${pushedRevision} refs/heads/release ${remoteRevision}\n`
      : multiRef === 'distinct-tips'
        ? `refs/heads/main ${pushedRevision} refs/heads/main ${remoteRevision}\n`
          + `refs/heads/release ${secondRevision} refs/heads/release ${remoteRevision}\n`
      : multiRef === 'release-only'
        ? `refs/heads/release ${pushedRevision} refs/heads/release ${remoteRevision}\n`
      : `refs/heads/main ${pushedRevision} refs/heads/main ${remoteRevision}\n`;
    const runs = [];
    for (let index = 0; index < attempts; index += 1) {
      runs.push(capturePrePush(() => runPrePush({
        input,
        remoteName: 'origin',
        root: repo,
        context: fixtureContext,
        env,
      })));
    }
    const requests = existsSync(requestPath)
      ? readFileSync(requestPath, 'utf8').trim().split(/\r?\n/u).filter(Boolean).map(JSON.parse)
      : [];
    const quarantinePath = `${requestPath}.quarantine.jsonl`;
    const quarantined = existsSync(quarantinePath)
      ? readFileSync(quarantinePath, 'utf8').trim().split(/\r?\n/u).filter(Boolean).map(JSON.parse)
      : [];
    return {
      runs,
      requests,
      quarantined,
      baselineRevision,
      pushedRevision,
      secondRevision,
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function runBackstopOutcomeFixture(
  state,
  { contextFactory = fixtureOutcomeContext } = {},
) {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-drift-backstop-outcome-'));
  const repo = join(scratch, 'repo');
  mkdirSync(repo);
  try {
    git(repo, ['init', '--quiet']);
    git(repo, ['config', 'user.name', 'Snapback drift backstop fixture']);
    git(repo, ['config', 'user.email', 'snapback-drift-backstop@example.invalid']);
    mkdirSync(join(repo, 'fixture'));
    writeFileSync(join(repo, '.gitignore'), '/target\n/node_modules\n');
    writeFileSync(join(repo, 'fixture/gate.mjs'), OUTCOME_GATE_SOURCE);
    writeFileSync(join(repo, 'fixture/frozen-record.json'), '{}\n');
    writeFileSync(join(repo, 'fixture/state.json'), `${JSON.stringify(state)}\n`);
    const context = contextFactory();
    if (context.policy.driftProneGates.guide.requiredModules?.includes(
      'fixture-dependency',
    )) installFixtureDependency(repo);
    const revision = commitAll(repo, 'test: backstop outcome fixture');
    const result = capturePrePush(() => runBackstop({
      head: revision,
      gate: 'guide',
      issuesDir: 'issues',
      root: repo,
      context,
      env: {
        ...process.env,
        SNAPBACK_DRIFT_FIXTURE_COUNTER: join(scratch, 'counter'),
        SNAPBACK_DRIFT_TICKET_DATE: '2026-08-11',
      },
    }));
    const issues = existsSync(join(repo, 'issues')) ? readdirSync(join(repo, 'issues')) : [];
    return {
      result,
      issues,
      issueBodies: issues.map((name) => readFileSync(join(repo, 'issues', name), 'utf8')),
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function runBackstopSignatureFixture({
  details = ['first distinct red', 'second distinct red'],
  legacyTicket = false,
} = {}) {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-drift-backstop-signatures-'));
  const repo = join(scratch, 'repo');
  mkdirSync(repo);
  try {
    git(repo, ['init', '--quiet']);
    git(repo, ['config', 'user.name', 'Snapback drift signature fixture']);
    git(repo, ['config', 'user.email', 'snapback-drift-signatures@example.invalid']);
    mkdirSync(join(repo, 'fixture'));
    writeFileSync(join(repo, '.gitignore'), '/target\n');
    writeFileSync(join(repo, 'fixture/gate.mjs'), OUTCOME_GATE_SOURCE);
    writeFileSync(join(repo, 'fixture/frozen-record.json'), '{}\n');
    writeFileSync(
      join(repo, 'fixture/state.json'),
      `${JSON.stringify({ prepare: 'pass', check: 'pass' })}\n`,
    );
    commitAll(repo, 'test: green backstop baseline');
    const env = {
      ...process.env,
      SNAPBACK_DRIFT_FIXTURE_COUNTER: join(scratch, 'counter'),
      SNAPBACK_DRIFT_TICKET_DATE: '2026-08-11',
    };
    if (legacyTicket) {
      mkdirSync(join(repo, 'issues'));
      writeFileSync(
        join(repo, 'issues/20260810-legacy-guide-drift.md'),
        '# Legacy guide drift\n\n**Status:** Open\n**Drift gate:** `guide`\n',
      );
    }
    const runs = [];
    const revisions = [];
    for (const detail of details) {
      writeFileSync(
        join(repo, 'fixture/state.json'),
        `${JSON.stringify({ prepare: 'pass', check: `content:${detail}` })}\n`,
      );
      revisions.push(commitAll(repo, `test: ${detail}`));
      runs.push(capturePrePush(() => runBackstop({
        head: 'HEAD',
        gate: 'guide',
        issuesDir: 'issues',
        root: repo,
        context: fixtureOutcomeContext(),
        env,
      })));
    }
    if (details.length > 1) {
      runs.push(capturePrePush(() => runBackstop({
        head: 'HEAD',
        gate: 'guide',
        issuesDir: 'issues',
        root: repo,
        context: fixtureOutcomeContext(),
        env,
      })));
    }
    const issueNames = readdirSync(join(repo, 'issues')).sort();
    const issues = issueNames.map((name) => ({
      name,
      body: readFileSync(join(repo, 'issues', name), 'utf8'),
    }));
    return { runs, revisions, issues };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function runBackstopMergeTopologyFixture() {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-drift-backstop-merge-'));
  const repo = join(scratch, 'repo');
  mkdirSync(repo);
  try {
    git(repo, ['init', '--quiet']);
    git(repo, ['config', 'user.name', 'Snapback drift merge fixture']);
    git(repo, ['config', 'user.email', 'snapback-drift-merge@example.invalid']);
    mkdirSync(join(repo, 'fixture'));
    writeFileSync(join(repo, '.gitignore'), '/target\n');
    writeFileSync(join(repo, 'fixture/gate.mjs'), OUTCOME_GATE_SOURCE);
    writeFileSync(join(repo, 'fixture/frozen-record.json'), '{}\n');
    writeFileSync(
      join(repo, 'fixture/state.json'),
      `${JSON.stringify({ prepare: 'pass', check: 'pass' })}\n`,
    );
    const baseline = commitAll(repo, 'test: green merge baseline');

    git(repo, ['checkout', '-b', 'record-side', '--quiet']);
    writeFileSync(join(repo, 'fixture/frozen-record.json'), '{"side":true}\n');
    writeFileSync(
      join(repo, 'fixture/state.json'),
      `${JSON.stringify({ prepare: 'pass', check: 'content:red introduced by merge side' })}\n`,
    );
    const sideRecordCommit = commitAll(repo, 'test: update record on merge side');

    git(repo, ['checkout', '-b', 'main-line', '--quiet', baseline]);
    writeFileSync(join(repo, 'main-line.txt'), 'main line\n');
    commitAll(repo, 'test: advance first parent');
    git(repo, ['merge', '--no-ff', '--no-edit', 'record-side']);
    writeFileSync(join(repo, 'post-merge.txt'), 'unrelated advance\n');
    const headRevision = commitAll(repo, 'test: unrelated advance after red merge');
    assert.equal(
      git(repo, ['log', '-1', '--format=%H', 'HEAD', '--', 'fixture/frozen-record.json']).trim(),
      sideRecordCommit,
      'fixture record epoch must resolve through the non-first parent',
    );

    const result = capturePrePush(() => runBackstop({
      head: headRevision,
      gate: 'guide',
      issuesDir: 'issues',
      root: repo,
      context: fixtureOutcomeContext(),
      env: {
        ...process.env,
        SNAPBACK_DRIFT_FIXTURE_COUNTER: join(scratch, 'counter'),
        SNAPBACK_DRIFT_TICKET_DATE: '2026-08-11',
      },
    }));
    const issueName = readdirSync(join(repo, 'issues')).find((name) => (
      name.includes('main-drift-guide')
    ));
    assert.ok(issueName);
    return {
      result,
      headRevision,
      sideRecordCommit,
      issue: readFileSync(join(repo, 'issues', issueName), 'utf8'),
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function outcomeLines(output) {
  return output.split(/\r?\n/u).filter((line) => line.includes('[snapback-drift] OUTCOME '));
}

test('drift selection preserves mapped triggers and tiers fail-closed paths', () => {
  const context = loadSelectionContext();
  const registered = context.inventory.canonicalGates.filter((gate) => (
    Object.hasOwn(context.policy.driftProneGates, gate)
  ));
  const core = context.inventory.canonicalGates.filter((gate) => (
    context.policy.driftFailClosedCoreGates.includes(gate)
  ));
  assert.deepEqual(
    context.policy.driftAlwaysRunGates,
    ['path-migration-stragglers', 'workspace-graph'],
  );
  assert.ok(context.policy.driftFailClosedCoreGates.length > 0);
  for (const gate of context.policy.driftFailClosedCoreGates) {
    assert.ok(Object.hasOwn(context.policy.driftProneGates, gate), gate);
  }
  assert.deepEqual(
    selectDriftProneGates(['README.md'], context).selectedDriftProneGates,
    ['path-migration-stragglers', 'workspace-graph'],
  );
  const mapped = selectDriftProneGates(['guide/index.md'], context);
  assert.deepEqual(
    mapped.selectedDriftProneGates,
    ['guide', 'path-migration-stragglers', 'workspace-graph'],
  );
  assert.equal(mapped.driftFailClosedDisposition, null);
  const guideTriggerFiles = [
    'llp/0193-errors-as-docs-completeness.plan.md',
    'llp/0194-generated-api-reference.rfc.md',
    'scripts/symbol-lifecycle.mjs',
  ];
  for (const path of guideTriggerFiles) {
    assert.ok(
      context.policy.driftProneGates.guide.triggerRules.files.includes(path),
      `${path} is an explicit Guide drift trigger`,
    );
    assert.ok(
      selectDriftProneGates([path], context).selectedDriftProneGates.includes('guide'),
      `${path} selects the Guide drift gate`,
    );
  }
  assert.deepEqual(
    selectDriftProneGates([
      'tests/agent_safe_publication_checker_v1.mjs',
    ], context).selectedDriftProneGates,
    ['agent-safe-publication-fixtures', 'path-migration-stragglers', 'workspace-graph'],
  );
  assert.deepEqual(
    selectDriftProneGates([
      'diaries/0001-todo-demo.diary.md',
    ], context).selectedDriftProneGates,
    ['diary-identity', 'path-migration-stragglers', 'workspace-graph'],
  );
  const unknown = selectDriftProneGates(['unclassified-drift-probe.xyz'], context);
  assert.equal(unknown.selectionClass, 'FAIL_CLOSED_FULL');
  assert.equal(unknown.driftFailClosedDisposition, 'core');
  assert.deepEqual(unknown.selectedDriftProneGates, core);

  const full = selectDriftProneGates(
    ['unclassified-drift-probe.xyz'],
    context,
    { failClosedDisposition: 'full' },
  );
  assert.equal(full.driftFailClosedDisposition, 'full');
  assert.deepEqual(full.selectedDriftProneGates, registered);

  const mappedAndUnknown = selectDriftProneGates([
    'tests/agent_safe_publication_checker_v1.mjs',
    'unclassified-drift-probe.xyz',
  ], context);
  assert.deepEqual(
    mappedAndUnknown.selectedDriftProneGates,
    context.inventory.canonicalGates.filter((gate) => (
      gate === 'agent-safe-publication-fixtures'
        || context.policy.driftFailClosedCoreGates.includes(gate)
    )),
  );
});

test('refusal keeps the regenerate command actionable when Git status is unavailable', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'snapback-drift-no-worktree-'));
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args.join(' '));
  try {
    assert.doesNotThrow(() => printRefusal({
      gate: 'guide',
      revision: 'a'.repeat(40),
      metadata: {
        records: ['guide/guide-manifest.generated.json'],
        regenerateCommand: 'node scripts/generate-guide-manifest.mjs',
      },
      cwd,
      command: 'node scripts/check-guide.mjs',
    }));
  } finally {
    console.error = original;
    rmSync(cwd, { recursive: true, force: true });
  }
  const output = lines.join('\n');
  assert.match(output, /regenerate: node scripts\/generate-guide-manifest\.mjs/u);
  assert.match(output, /regenerated path inspection unavailable \(non-fatal\)/u);
  assert.doesNotMatch(output, /\n\s+at /u);
});

test('ordinary push selects relevant gates, defers them, and runs no gate command', () => {
  const { runs, requests } = runOutcomeFixture({
    baseline: { prepare: 'pass', check: 'pass' },
    pushed: { prepare: 'content:would block under strict mode', check: 'pass' },
    env: { SNAPBACK_DRIFT_GATES_STRICT: '' },
  });
  assert.equal(runs[0].status, 0, runs[0].output);
  assert.match(runs[0].output, /selected 1 gate\(s\): guide/u);
  assert.match(runs[0].output, /DEFERRED BY DEFAULT: .* no gate commands ran: guide/u);
  assert.match(runs[0].output, /strict opt-in: SNAPBACK_DRIFT_GATES_STRICT=1 git push/u);
  assert.doesNotMatch(runs[0].output, /\[snapback-drift\] RUN |fixture content failure/u);
  assert.deepEqual(requests, []);
});

test('default multi-ref push separates scheduled-main deferral from a non-main tip', () => {
  const { runs, pushedRevision, secondRevision } = runOutcomeFixture({
    baseline: { prepare: 'pass', check: 'pass' },
    pushed: { prepare: 'pass', check: 'pass' },
    multiRef: 'distinct-tips',
    contextFactory: fixtureFullRegistryContext,
    env: { SNAPBACK_DRIFT_GATES_STRICT: '' },
  });
  assert.equal(runs[0].status, 0, runs[0].output);
  assert.match(
    runs[0].output,
    new RegExp(`${pushedRevision.slice(0, 12)}: .*selected 1 gate\\(s\\): guide`, 'u'),
  );
  assert.match(
    runs[0].output,
    new RegExp(
      `${secondRevision.slice(0, 12)}: .*selected 2 gate\\(s\\): contract-meta, guide`,
      'u',
    ),
  );
  assert.equal((runs[0].output.match(/DEFERRED BY DEFAULT/gu) ?? []).length, 1);
  assert.match(runs[0].output, /origin\/main drift-prone gate\(s\); no gate commands ran: guide/u);
  assert.match(
    runs[0].output,
    /NON-MAIN REF: 1 ref update\(s\) across 1 distinct revision\(s\), 1 committed path\(s\), selected 2 gate\(s\); no gate commands ran and no independent scheduled-main verdict is claimed: contract-meta, guide/u,
  );
  assert.match(runs[0].output, /a later origin\/main landing is selected from its own ref update/u);
  assert.doesNotMatch(runs[0].output, /\[snapback-drift\] RUN /u);
});

test('default same-tip main and non-main refs report both dispositions without duplicate execution', () => {
  const { runs } = runOutcomeFixture({
    baseline: { prepare: 'pass', check: 'pass' },
    pushed: { prepare: 'pass', check: 'pass' },
    multiRef: 'same-tip',
    env: { SNAPBACK_DRIFT_GATES_STRICT: '' },
  });
  assert.equal(runs[0].status, 0, runs[0].output);
  assert.match(runs[0].output, /across 2 ref update\(s\) selected 1 gate\(s\): guide/u);
  assert.match(runs[0].output, /DEFERRED BY DEFAULT: .*no gate commands ran: guide/u);
  assert.match(
    runs[0].output,
    /NON-MAIN REF: 1 ref update\(s\) across 1 distinct revision\(s\).*no independent scheduled-main verdict is claimed: guide/u,
  );
  assert.match(runs[0].output, /same-tip origin\/main update is covered by that landing/u);
  assert.doesNotMatch(runs[0].output, /\[snapback-drift\] RUN /u);
});

test('default non-main-only push makes no scheduled-backstop claim', () => {
  const { runs } = runOutcomeFixture({
    baseline: { prepare: 'pass', check: 'pass' },
    pushed: { prepare: 'pass', check: 'pass' },
    multiRef: 'release-only',
    env: { SNAPBACK_DRIFT_GATES_STRICT: '' },
  });
  assert.equal(runs[0].status, 0, runs[0].output);
  assert.match(runs[0].output, /NON-MAIN REF: 1 ref update\(s\) across 1 distinct revision\(s\), 1 committed path\(s\), selected 1 gate\(s\)/u);
  assert.match(runs[0].output, /later origin\/main landing/u);
  assert.doesNotMatch(runs[0].output, /DEFERRED BY DEFAULT|scheduled authority:/u);
  assert.doesNotMatch(runs[0].output, /\[snapback-drift\] RUN /u);
});

test('strict multi-ref push executes distinct tips and attributes the failing ref', () => {
  const { runs, baselineRevision, pushedRevision, secondRevision } = runOutcomeFixture({
    baseline: { prepare: 'pass', check: 'pass' },
    pushed: { prepare: 'pass', check: 'pass' },
    secondPushed: { prepare: 'content:second ref introduced failure', check: 'pass' },
    multiRef: 'distinct-tips',
    contextFactory: fixtureFullRegistryContext,
    env: { SNAPBACK_DRIFT_GATES_STRICT: '1' },
  });
  assert.equal(runs[0].status, 1, runs[0].output);
  assert.match(
    runs[0].output,
    new RegExp(`${pushedRevision.slice(0, 12)}: .*selected 1 gate\\(s\\): guide`, 'u'),
  );
  assert.match(runs[0].output, /RUN guide:.*PASS guide/su);
  assert.match(
    runs[0].output,
    new RegExp(
      `${secondRevision.slice(0, 12)}: .*selected 2 gate\\(s\\): contract-meta, guide`,
      'u',
    ),
  );
  assert.match(runs[0].output, /OUTCOME CONTENT_RED contract-meta/u);
  assert.match(
    runs[0].output,
    new RegExp(`baseline ${baselineRevision.slice(0, 12)} passed`, 'u'),
  );
  assert.doesNotMatch(runs[0].output, /DEFERRED BY DEFAULT/u);
});

test('default unknown and broad paths explicitly defer the selected core tier', () => {
  for (const triggerPath of ['unclassified-drift-probe.xyz', 'package.json']) {
    const { runs } = runOutcomeFixture({
      baseline: { prepare: 'pass', check: 'pass' },
      pushed: { prepare: 'pass', check: 'pass' },
      triggerPath,
      contextFactory: fixtureFullRegistryContext,
      env: { SNAPBACK_DRIFT_GATES_STRICT: '' },
    });
    assert.equal(runs[0].status, 0, runs[0].output);
    assert.match(runs[0].output, /DEFERRED BROAD selection: (?:unknown|broad):/u);
    assert.match(runs[0].output, /selected CORE tier \(1 of 2 registered gates\)/u);
    assert.match(runs[0].output, /no gate commands ran: guide/u);
    assert.doesNotMatch(runs[0].output, /\[snapback-drift\] RUN /u);
  }
});

test('strict full-registry mode runs every registered gate', () => {
  const { runs } = runOutcomeFixture({
    baseline: { prepare: 'pass', check: 'pass' },
    pushed: { prepare: 'pass', check: 'pass' },
    triggerPath: 'fixture/trigger.txt',
    contextFactory: fixtureFullRegistryContext,
    env: {
      SNAPBACK_DRIFT_GATES_STRICT: '1',
      SNAPBACK_DRIFT_GATES_FULL: '1',
    },
  });
  assert.equal(runs[0].status, 0, runs[0].output);
  assert.match(runs[0].output, /FULL REGISTRY: selected all 2 registered gate/u);
  assert.match(runs[0].output, /RUN guide:/u);
  assert.match(runs[0].output, /RUN contract-meta:/u);
  assert.doesNotMatch(runs[0].output, /DEFERRED BY DEFAULT/u);
});

test('strict, full, and bypass environment variables reject non-exact values', () => {
  for (const [name, value] of [
    ['SNAPBACK_DRIFT_GATES_STRICT', 'true'],
    ['SNAPBACK_DRIFT_GATES_FULL', '0'],
    ['SNAPBACK_DRIFT_GATES_BYPASS', 'yes'],
  ]) {
    const { runs } = runOutcomeFixture({
      baseline: { prepare: 'pass', check: 'pass' },
      pushed: { prepare: 'pass', check: 'pass' },
      env: { [name]: value },
    });
    assert.equal(runs[0].status, 2, runs[0].output);
    assert.match(runs[0].output, new RegExp(`${name} must be exactly 1 when used`, 'u'));
    assert.doesNotMatch(runs[0].output, /\[snapback-drift\] RUN /u);
  }
});

test('legacy full spelling implies strict mode and legacy bypass stays compatible', () => {
  const full = runOutcomeFixture({
    baseline: { prepare: 'pass', check: 'pass' },
    pushed: { prepare: 'pass', check: 'pass' },
    triggerPath: 'fixture/trigger.txt',
    contextFactory: fixtureFullRegistryContext,
    env: {
      SNAPBACK_DRIFT_GATES_STRICT: '',
      SNAPBACK_DRIFT_GATES_FULL: '1',
    },
  });
  assert.equal(full.runs[0].status, 0, full.runs[0].output);
  assert.match(full.runs[0].output, /SNAPBACK_DRIFT_GATES_FULL=1 implies strict/u);
  assert.match(full.runs[0].output, /FULL REGISTRY: selected all 2 registered gate/u);
  assert.match(full.runs[0].output, /RUN contract-meta:/u);

  const bypass = runOutcomeFixture({
    baseline: { prepare: 'pass', check: 'pass' },
    pushed: { prepare: 'content:would fail if executed', check: 'pass' },
    env: {
      SNAPBACK_DRIFT_GATES_STRICT: '',
      SNAPBACK_DRIFT_GATES_BYPASS: '1',
    },
  });
  assert.equal(bypass.runs[0].status, 0, bypass.runs[0].output);
  assert.match(bypass.runs[0].output, /COMPATIBILITY BYPASS: ordinary pushes already defer/u);
  assert.match(bypass.runs[0].output, /BYPASS ALLOWED: skipped 1 selected gate/u);
  assert.doesNotMatch(bypass.runs[0].output, /\[snapback-drift\] RUN /u);
});

test('pushed-revision prepare build failure blocks as CONTENT_RED', () => {
  const { runs, requests } = runOutcomeFixture({
    baseline: { prepare: 'pass', check: 'pass' },
    pushed: { prepare: 'content:pushed build broke', check: 'pass' },
  });
  assert.equal(runs[0].status, 1, runs[0].output);
  assert.match(runs[0].output, /OUTCOME CONTENT_RED guide/u);
  assert.match(runs[0].output, /attribution baseline .* passes guide/u);
  assert.deepEqual(requests, []);
});

test('baseline-reproducing setup failure proceeds with an auditable ticket request', () => {
  const { runs, requests, baselineRevision, pushedRevision } = runOutcomeFixture({
    baseline: { prepare: 'infra:shared setup outage', check: 'pass' },
    pushed: { prepare: 'infra:shared setup outage', check: 'pass' },
  });
  assert.equal(runs[0].status, 0, runs[0].output);
  assert.match(runs[0].output, /OUTCOME INFRASTRUCTURE guide/u);
  assert.match(runs[0].output, /infrastructure receipt: .*fullFailureOutputDigest/u);
  assert.match(runs[0].output, /ALLOWED WITH CORROBORATED INFRASTRUCTURE/u);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].outcomeType, 'INFRASTRUCTURE');
  assert.equal(requests[0].pushedRevision, pushedRevision);
  assert.deepEqual(requests[0].baselineRevisions, [baselineRevision]);
  assert.match(requests[0].normalizedSignature, /^sha256:[0-9a-f]{64}$/u);
  assert.match(requests[0].failureOutputDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(requests[0].baselineOutputsDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(requests[0].requestDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.ok(Date.parse(requests[0].observedAt));
  assert.equal(requests[0].recordedAt, requests[0].observedAt);
  assert.equal(
    Date.parse(requests[0].projectionDueBy) - Date.parse(requests[0].observedAt),
    2 * 60 * 60 * 1000,
  );
  assert.equal(requests[0].runnerIdentity.id, 'snapback-drift-prone-gates.d3.v1');
  assert.equal(requests[0].corroboration.length, 1);
});

test('signature-reproducing content failure proceeds as ticketed INHERITED_RED', () => {
  const { runs, requests } = runOutcomeFixture({
    baseline: { prepare: 'pass', check: 'content:shared stale record' },
    pushed: { prepare: 'pass', check: 'content:shared stale record' },
  });
  assert.equal(runs[0].status, 0, runs[0].output);
  assert.match(runs[0].output, /OUTCOME INHERITED_RED guide/u);
  assert.match(runs[0].output, /PRE-EXISTING STALE guide/u);
  assert.match(runs[0].output, /ALLOWED WITH PRE-EXISTING STALENESS/u);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].outcomeType, 'INHERITED_RED');
  assert.equal(requests[0].attribution.type, 'merge-base-signature-reproduction');
});

test('setup signature mismatch blocks instead of admitting INFRASTRUCTURE', () => {
  const { runs, requests } = runOutcomeFixture({
    baseline: { prepare: 'infra:baseline outage', check: 'pass' },
    pushed: { prepare: 'infra:pushed outage', check: 'pass' },
  });
  assert.equal(runs[0].status, 2, runs[0].output);
  assert.match(runs[0].output, /signature .* does not match pushed/u);
  assert.match(runs[0].output, /OUTCOME INFRASTRUCTURE-UNCORROBORATED guide/u);
  assert.doesNotMatch(runs[0].output, /OUTCOME INFRASTRUCTURE guide/u);
  assert.doesNotMatch(runs[0].output, /OUTCOME UNKNOWN guide/u);
  assert.doesNotMatch(runs[0].output, /repair the gate environment/u);
  assert.equal(outcomeLines(runs[0].output).length, 1, runs[0].output);
  assert.deepEqual(requests, []);
});

test('unavailable baseline blocks setup failure corroboration', () => {
  const { runs, requests } = runOutcomeFixture({
    baseline: { prepare: 'infra:shared setup outage', check: 'pass' },
    pushed: { prepare: 'infra:shared setup outage', check: 'pass' },
    unavailableBaseline: true,
  });
  assert.equal(runs[0].status, 2, runs[0].output);
  assert.match(runs[0].output, /attribution unavailable: merge-base/u);
  assert.match(runs[0].output, /OUTCOME INFRASTRUCTURE-UNCORROBORATED guide/u);
  assert.doesNotMatch(runs[0].output, /OUTCOME UNKNOWN guide/u);
  assert.equal(outcomeLines(runs[0].output).length, 1, runs[0].output);
  assert.deepEqual(requests, []);
});

test('runner-controlled pushed failure over a green baseline blocks as content evidence', () => {
  const { runs, requests } = runOutcomeFixture({
    baseline: { prepare: 'pass', check: 'pass' },
    pushed: { prepare: 'infra:pushed-only setup diagnostic', check: 'pass' },
  });
  assert.equal(runs[0].status, 2, runs[0].output);
  assert.match(runs[0].output, /attribution baseline .* passes guide/u);
  assert.match(
    runs[0].output,
    /OUTCOME INFRASTRUCTURE-UNCORROBORATED guide .* blocking as content evidence/u,
  );
  assert.equal(outcomeLines(runs[0].output).length, 1, runs[0].output);
  assert.doesNotMatch(runs[0].output, /repair the gate environment/u);
  assert.deepEqual(requests, []);
});

test('content-ambiguous SNAPBACK cargo build code is not runner-controlled evidence', () => {
  const { runs, requests } = runOutcomeFixture({
    baseline: { prepare: 'pass', check: 'pass' },
    pushed: {
      prepare: 'snapback:SNAPBACK_IBEX_CARGO_BUILD_FAILED:pushed compile failed',
      check: 'pass',
    },
  });
  assert.equal(runs[0].status, 1, runs[0].output);
  assert.match(runs[0].output, /OUTCOME CONTENT_RED guide/u);
  assert.doesNotMatch(runs[0].output, /OUTCOME INFRASTRUCTURE/u);
  assert.equal(outcomeLines(runs[0].output).length, 1, runs[0].output);
  assert.deepEqual(requests, []);
});

test('contradictory determinate executions block as NONDETERMINISTIC without attribution', () => {
  const { runs, requests } = runOutcomeFixture({
    baseline: { prepare: 'pass', check: 'pass' },
    pushed: { prepare: 'pass', check: 'nondeterministic' },
  });
  assert.equal(runs[0].status, 2, runs[0].output);
  assert.match(runs[0].output, /OUTCOME NONDETERMINISTIC guide/u);
  assert.match(runs[0].output, /same gate\/revision closure/u);
  assert.doesNotMatch(runs[0].output, /ATTRIBUTION CHECK/u);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].outcomeType, 'NONDETERMINISTIC');
  assert.deepEqual(requests[0].baselineRevisions, []);
  assert.equal(requests[0].attribution, null);
});

test('red-to-different-red contradiction blocks before inherited-red attribution', () => {
  const { runs, requests } = runOutcomeFixture({
    baseline: { prepare: 'pass', check: 'pass' },
    pushed: { prepare: 'pass', check: 'alternating-red' },
  });
  assert.equal(runs[0].status, 2, runs[0].output);
  assert.match(runs[0].output, /OUTCOME NONDETERMINISTIC guide/u);
  assert.match(runs[0].output, /first contradictory red|second contradictory red/u);
  assert.doesNotMatch(runs[0].output, /ATTRIBUTION CHECK|OUTCOME INHERITED_RED/u);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].outcomeType, 'NONDETERMINISTIC');
  assert.deepEqual(requests[0].corroboration.map(({ outcome }) => outcome), ['red', 'red']);
});

test('strict mode refuses nondeterminism classification when resolved dependency bytes drift', () => {
  const { runs, requests } = runOutcomeFixture({
    baseline: { prepare: 'pass', check: 'pass' },
    pushed: { prepare: 'pass', check: 'dependency-drift' },
    contextFactory: fixtureExternalDependencyContext,
  });
  assert.equal(runs[0].status, 2, runs[0].output);
  assert.match(runs[0].output, /OUTCOME UNKNOWN guide/u);
  assert.match(runs[0].output, /observed execution closure changed after the first determinate red/u);
  assert.doesNotMatch(runs[0].output, /OUTCOME NONDETERMINISTIC|ATTRIBUTION CHECK/u);
  assert.deepEqual(requests, []);
});

test('strict mode binds platform sibling bytes in the installed dependency mirror', () => {
  const { runs, requests } = runOutcomeFixture({
    baseline: { prepare: 'pass', check: 'pass' },
    pushed: { prepare: 'pass', check: 'dependency-sibling-drift' },
    contextFactory: fixtureExternalDependencyContext,
  });
  assert.equal(runs[0].status, 2, runs[0].output);
  assert.match(runs[0].output, /OUTCOME UNKNOWN guide/u);
  assert.match(runs[0].output, /observed execution closure changed after the first determinate red/u);
  assert.doesNotMatch(runs[0].output, /OUTCOME NONDETERMINISTIC|ATTRIBUTION CHECK/u);
  assert.deepEqual(requests, []);
});

test('unclassifiable failure output blocks as an unknown control-plane failure', () => {
  const { runs, requests } = runOutcomeFixture({
    baseline: { prepare: 'pass', check: 'pass' },
    pushed: { prepare: 'pass', check: 'unknown' },
  });
  assert.equal(runs[0].status, 2, runs[0].output);
  assert.match(runs[0].output, /OUTCOME UNKNOWN guide/u);
  assert.match(runs[0].output, /nonzero execution supplied no diagnostic output/u);
  assert.deepEqual(requests, []);
});

test('ticket requests are signature-idempotent across retries', () => {
  const { runs, requests } = runOutcomeFixture({
    baseline: { prepare: 'infra:shared setup outage', check: 'pass' },
    pushed: { prepare: 'infra:shared setup outage', check: 'pass' },
    attempts: 2,
  });
  assert.deepEqual(runs.map(({ status }) => status), [0, 0]);
  assert.match(runs[0].output, /TICKET REQUEST RECORDED/u);
  assert.match(runs[1].output, /TICKET REQUEST RETAINED/u);
  assert.equal(requests.length, 1);
});

test('infrastructure kill-switch restores broad module-not-found fail-closed behavior', () => {
  const { runs, requests } = runOutcomeFixture({
    baseline: { prepare: 'pass', check: 'pass' },
    pushed: { prepare: 'module-missing', check: 'pass' },
    env: { SNAPBACK_DRIFT_INFRA_FAILOPEN: '0' },
  });
  assert.equal(runs[0].status, 2, runs[0].output);
  assert.match(runs[0].output, /INFRASTRUCTURE ERROR: .* could not faithfully run guide/u);
  assert.match(runs[0].output, /ERR_MODULE_NOT_FOUND/u);
  assert.doesNotMatch(runs[0].output, /ATTRIBUTION CHECK/u);
  assert.doesNotMatch(runs[0].output, /DETERMINISM CHECK/u);
  assert.deepEqual(outcomeLines(runs[0].output), []);
  assert.deepEqual(requests, []);
});

test('infrastructure kill-switch restores prepare-failed fallback before reruns', () => {
  const { runs, requests } = runOutcomeFixture({
    baseline: { prepare: 'pass', check: 'pass' },
    pushed: { prepare: 'content:pushed prepare failure', check: 'pass' },
    env: { SNAPBACK_DRIFT_INFRA_FAILOPEN: '0' },
  });
  assert.equal(runs[0].status, 2, runs[0].output);
  assert.match(runs[0].output, /infrastructure reason: prepare command failed/u);
  assert.doesNotMatch(runs[0].output, /ATTRIBUTION CHECK|DETERMINISM CHECK/u);
  assert.deepEqual(outcomeLines(runs[0].output), []);
  assert.deepEqual(requests, []);
});

test('infrastructure kill-switch restores the old attribution loop without tickets', () => {
  const { runs, requests } = runOutcomeFixture({
    baseline: { prepare: 'pass', check: 'content:old baseline failure' },
    pushed: { prepare: 'pass', check: 'content:different pushed failure' },
    env: { SNAPBACK_DRIFT_INFRA_FAILOPEN: '0' },
  });
  assert.equal(runs[0].status, 0, runs[0].output);
  assert.match(runs[0].output, /PRE-EXISTING STALE guide/u);
  assert.doesNotMatch(runs[0].output, /DETERMINISM CHECK|TICKET REQUEST/u);
  assert.deepEqual(outcomeLines(runs[0].output), []);
  assert.deepEqual(requests, []);
});

test('backstop treats a stable content-caused prepare red as stale content', () => {
  const { result, issues } = runBackstopOutcomeFixture({
    prepare: 'content:stable backstop prepare failure',
    check: 'pass',
  });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /DETERMINISM CHECK guide/u);
  assert.match(result.output, /\bSTALE guide\b/u);
  assert.doesNotMatch(result.output, /INFRASTRUCTURE ERROR guide/u);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /^20260811-main-drift-guide-[0-9a-f]{16}\.md$/u);
});

test('backstop retains runner-controlled prepare failures as infrastructure', () => {
  const { result, issues } = runBackstopOutcomeFixture({
    prepare: 'infra:backstop setup unavailable',
    check: 'pass',
  });
  assert.equal(result.status, 2, result.output);
  assert.match(result.output, /INFRASTRUCTURE ERROR guide/u);
  assert.match(result.output, /no stale-record ticket was filed/u);
  assert.doesNotMatch(result.output, /\bSTALE guide\b|main-drift-guide|\bFILED\b/u);
  assert.deepEqual(issues, []);
});

test('backstop repeats a clean content red and tickets contradictory execution as nondeterminism', () => {
  const { result, issues, issueBodies } = runBackstopOutcomeFixture({
    prepare: 'pass',
    check: 'nondeterministic',
  });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /DETERMINISM CHECK guide/u);
  assert.match(result.output, /NONDETERMINISTIC guide/u);
  assert.doesNotMatch(result.output, /\bSTALE guide\b/u);
  assert.equal(issues.length, 1);
  assert.match(issueBodies[0], /\*\*Outcome:\*\* `NONDETERMINISTIC`/u);
  assert.match(
    issueBodies[0],
    /\*\*Causal landing:\*\* `none — contradictory same-closure executions`/u,
  );
  assert.match(issueBodies[0], /\*\*Attribution:\*\* `none-nondeterministic`/u);
});

test('backstop does not ticket false nondeterminism when resolved dependency bytes drift', () => {
  const { result, issues } = runBackstopOutcomeFixture(
    { prepare: 'pass', check: 'dependency-drift' },
    { contextFactory: fixtureExternalDependencyContext },
  );
  assert.equal(result.status, 2, result.output);
  assert.match(result.output, /UNKNOWN guide/u);
  assert.match(result.output, /observed execution closure changed after the first determinate red/u);
  assert.match(result.output, /no stale-record ticket was filed/u);
  assert.doesNotMatch(result.output, /NONDETERMINISTIC|\bSTALE guide\b/u);
  assert.deepEqual(issues, []);
});

test('backstop binds platform sibling bytes in the installed dependency mirror', () => {
  const { result, issues } = runBackstopOutcomeFixture(
    { prepare: 'pass', check: 'dependency-sibling-drift' },
    { contextFactory: fixtureExternalDependencyContext },
  );
  assert.equal(result.status, 2, result.output);
  assert.match(result.output, /UNKNOWN guide/u);
  assert.match(result.output, /observed execution closure changed after the first determinate red/u);
  assert.match(result.output, /no stale-record ticket was filed/u);
  assert.doesNotMatch(result.output, /NONDETERMINISTIC|\bSTALE guide\b/u);
  assert.deepEqual(issues, []);
});

test('backstop attribution refuses to cross a non-first-parent record epoch', () => {
  const { result, headRevision, sideRecordCommit, issue } = runBackstopMergeTopologyFixture();
  assert.equal(result.status, 1, result.output);
  assert.match(issue, /\*\*Causal landing:\*\* `none — record-epoch-off-first-parent`/u);
  assert.match(issue, /\*\*Attribution:\*\* `record-epoch-off-first-parent`/u);
  assert.ok(!issue.includes(`**Causal landing:** \`${headRevision}\``));
  assert.ok(!issue.includes(`**Causal landing:** \`${sideRecordCommit}\``));
});

test('backstop keys distinct reds by signature and updates an unchanged observation', () => {
  const { runs, revisions, issues } = runBackstopSignatureFixture();
  assert.deepEqual(runs.map((run) => run.status), [1, 1, 1]);
  assert.equal(issues.length, 2);
  assert.ok(issues.every(({ name }) => (
    /^20260811-main-drift-guide-[0-9a-f]{16}\.md$/u.test(name)
  )));
  const signatures = issues.map(({ body }) => (
    body.match(/^\*\*Failure signature:\*\* `(sha256:[0-9a-f]{64})`$/mu)?.[1]
  ));
  assert.equal(new Set(signatures).size, 2);
  const second = issues.find(({ body }) => body.includes(`\`${revisions[1]}\``));
  assert.ok(second);
  assert.match(second.body, /\*\*Attribution:\*\* `first-parent-signature-epoch`/u);
  assert.ok(second.body.includes(`**Last observed:** \`${revisions[1]}\``));
  assert.match(runs[2].output, /not filing a duplicate; updated its last observation/u);
});

test('backstop GAP review routing survives marker-stripped reruns and routing errors', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-gap-review-backstop-'));
  const repo = join(scratch, 'repo');
  mkdirSync(repo);
  try {
    git(repo, ['init', '--quiet']);
    git(repo, ['config', 'user.name', 'Snapback GAP review fixture']);
    git(repo, ['config', 'user.email', 'snapback-gap-review@example.invalid']);
    mkdirSync(join(repo, 'fixture'));
    mkdirSync(join(repo, 'guide'));
    mkdirSync(join(repo, 'issues'));
    writeFileSync(join(repo, '.gitignore'), '/target\n');
    writeFileSync(join(repo, 'fixture/gate.mjs'), OUTCOME_GATE_SOURCE);
    writeFileSync(join(repo, 'fixture/frozen-record.json'), '{}\n');
    writeFileSync(join(repo, 'fixture/state.json'), '{"prepare":"pass","check":"pass"}\n');
    writeFileSync(join(repo, 'issues/guide-gap-tracker.md'), '# Guide gap tracker\n');
    writeFileSync(join(repo, 'guide/capabilities.md'), [
      '# Capability index',
      '',
      '## Capabilities',
      '',
      '| id | What | Aliases | Targets | Maturity | Witness | Authorities | Page |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
      '| backend.expired | Expired fixture | expired | none | design-only | — | fixture | GAP (owner: Fixture Owner, review: 2026-08-24; issue: issues/guide-gap-tracker.md) |',
      '',
    ].join('\n'));
    const revision = commitAll(repo, 'test: expired GAP review fixture');
    const env = {
      ...process.env,
      SNAPBACK_DRIFT_TICKET_DATE: '2026-08-25',
    };
    const runOnce = () => capturePrePush(() => runBackstop({
      head: revision,
      gate: 'guide',
      issuesDir: 'issues',
      root: repo,
      context: fixtureOutcomeContext(),
      env,
    }));

    const first = runOnce();
    const ticketsAfterFirstRun = readdirSync(join(repo, 'issues'))
      .filter((name) => name.includes('guide-gap-review-expired'));
    assert.deepEqual(ticketsAfterFirstRun, ['20260825-guide-gap-review-expired-backend-expired.md']);
    const ticketPath = join(repo, 'issues', ticketsAfterFirstRun[0]);
    const filedBody = readFileSync(ticketPath, 'utf8');
    assert.match(filedBody, /\*\*Routing signature:\*\* `gap-review:backend\.expired`/u);
    assert.match(filedBody, /\*\*Owner:\*\* Fixture Owner/u);
    assert.match(filedBody, /\*\*Gap pointer:\*\* `issues\/guide-gap-tracker\.md`/u);
    writeFileSync(
      ticketPath,
      filedBody.replace(/^\*\*Routing signature:\*\* `gap-review:backend\.expired`\n/mu, ''),
    );

    const second = runOnce();
    const routingFailure = capturePrePush(() => runBackstop({
      head: revision,
      gate: 'guide',
      issuesDir: 'issues',
      root: repo,
      context: fixtureOutcomeContext(),
      env: {
        ...env,
        SNAPBACK_DRIFT_TICKET_DATE: 'not-a-date',
      },
    }));
    const tickets = readdirSync(join(repo, 'issues'))
      .filter((name) => name.includes('guide-gap-review-expired'));

    assert.equal(first.status, 0, first.output);
    assert.equal(second.status, 0, second.output);
    assert.equal(routingFailure.status, 0, routingFailure.output);
    assert.match(first.output, /GAP REVIEW EXPIRED backend\.expired; owner: Fixture Owner; pointer: issues\/guide-gap-tracker\.md/u);
    assert.match(first.output, /FILED issues\/20260825-guide-gap-review-expired-backend-expired\.md/u);
    assert.match(second.output, /existing GAP review ticket .*; treating it as already filed/u);
    assert.match(routingFailure.output, /WARNING GAP review routing failed; continuing with frozen-record gates: SNAPBACK_DRIFT_GATE_INVALID: invalid ticket date not-a-date/u);
    assert.match(routingFailure.output, /PASS guide/u);
    assert.deepEqual(tickets, ['20260825-guide-gap-review-expired-backend-expired.md']);
    const body = readFileSync(join(repo, 'issues', tickets[0]), 'utf8');
    assert.doesNotMatch(body, /\*\*Routing signature:\*\*/u);
    assert.match(body, /\*\*Owner:\*\* Fixture Owner/u);
    assert.match(body, /\*\*Gap pointer:\*\* `issues\/guide-gap-tracker\.md`/u);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

function captureDeclarationOrderBatteryFixture(scratch, context) {
  const resultsPath = join(scratch, 'declaration-order-results.jsonl');
  const selectedGatesPath = join(scratch, 'declaration-order-selected-gates.txt');
  const selectedSnapshotPath = `${resultsPath}.selected-gates`;
  const proofBodyPath = join(scratch, 'declaration-order-proof-body.sh');
  const completionPath = join(scratch, 'proof-completion.json');
  const seen = new Set();
  const declarationOrder = context.calls.flatMap(({ gateId }) => {
    if (seen.has(gateId)) return [];
    seen.add(gateId);
    return [gateId];
  });
  const selectedOrder = context.inventory.canonicalGates;
  writeFileSync(selectedGatesPath, selectedOrder.map((gateId) => `${gateId}\n`).join(''));
  const proofBody = [
    'set -euo pipefail',
    `source ${JSON.stringify(PROOF_RUNNER)}`,
    `proof_runner_init local-proof ${JSON.stringify(resultsPath)} 1 ${JSON.stringify(selectedGatesPath)} ${selectedOrder.length} ${JSON.stringify(digestSelectedGateIds(selectedOrder))}`,
    ...declarationOrder.map((gateId) => (
      `proof_gate ${gateId} -- /usr/bin/true`
    )),
    'proof_runner_finish',
  ].join('\n');
  writeFileSync(proofBodyPath, proofBody);
  const script = [
    'set -euo pipefail',
    `source ${JSON.stringify(PROOF_RUNNER)}`,
    `SNAPBACK_PROOF_COMPLETION_RECEIPT=${JSON.stringify(completionPath)} proof_runner_supervise local-proof ${JSON.stringify(resultsPath)} ${JSON.stringify(selectedSnapshotPath)} ${selectedOrder.length} ${JSON.stringify(digestSelectedGateIds(selectedOrder))} -- /bin/bash ${JSON.stringify(proofBodyPath)}`,
  ].join('\n');
  const run = spawnSync('/bin/bash', ['-c', script], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  return { declarationOrder, resultsPath, completionPath };
}

test('complete battery accepts a real proof-runner JSONL capture in declaration order', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-battery-declaration-order-'));
  try {
    const context = loadSelectionContext();
    const { declarationOrder, resultsPath, completionPath } = captureDeclarationOrderBatteryFixture(
      scratch,
      context,
    );
    assert.equal(declarationOrder[0], 'ref-check');
    assert.equal(context.inventory.canonicalGates[0], 'action-fetch-fence-fixtures');
    assert.deepEqual(new Set(declarationOrder), new Set(context.inventory.canonicalGates));
    assert.equal(runBatteryReport({
      resultsPath, completionPath, root: scratch, context,
    }), 0);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('complete battery refuses missing, stale, or mismatched supervisor completion evidence', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-battery-completion-'));
  try {
    const context = { inventory: { canonicalGates: ['only-gate'] } };
    const resultsPath = join(scratch, 'results.jsonl');
    writeFileSync(resultsPath, `${JSON.stringify({
      applicabilityEvidence: null,
      applicabilityPredicate: null,
      blockedBy: [],
      command: '/usr/bin/true',
      durationMs: 1,
      endedAtMs: 2,
      exitCode: 0,
      failureSignature: null,
      terminationReason: 'exit',
      gateId: 'only-gate',
      prerequisites: [],
      proofId: 'local-proof',
      schemaVersion: 'snapback.proof-gate-result.v3',
      selectionReason: null,
      startedAtMs: 1,
      state: 'PASS',
    })}\n`);
    const completionPath = writeBatteryCompletion(
      scratch,
      resultsPath,
      context.inventory.canonicalGates,
    );
    const validCompletion = readFileSync(completionPath, 'utf8');
    const validResults = readFileSync(resultsPath, 'utf8');
    rmSync(completionPath);
    assert.throws(
      () => runBatteryReport({
        resultsPath, completionPath, root: scratch, context,
      }),
      /completion token is missing or invalid/u,
    );

    writeFileSync(completionPath, validCompletion);
    writeFileSync(resultsPath, `${validResults}\n`);
    assert.throws(
      () => runBatteryReport({
        resultsPath, completionPath, root: scratch, context,
      }),
      /completion token does not match/u,
    );

    const mismatched = JSON.parse(validCompletion);
    writeFileSync(resultsPath, validResults);
    mismatched.selectedGateDigest = `sha256:${'0'.repeat(64)}`;
    writeFileSync(completionPath, `${JSON.stringify(mismatched)}\n`);
    assert.throws(
      () => runBatteryReport({
        resultsPath, completionPath, root: scratch, context,
      }),
      /completion token does not match/u,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('complete battery inventory rejects duplicate and missing gate ids independently of order', () => {
  const record = {
    blockedBy: [],
    command: 'true',
    durationMs: 0,
    endedAtMs: 1,
    exitCode: 0,
    failureSignature: null,
    terminationReason: 'exit',
    selectionReason: null,
    applicabilityPredicate: null,
    applicabilityEvidence: null,
    gateId: 'only-gate',
    prerequisites: [],
    proofId: 'local-proof',
    schemaVersion: 'snapback.proof-gate-result.v3',
    startedAtMs: 1,
    state: 'PASS',
  };
  assert.throws(
    () => parseBatteryResults(`${JSON.stringify(record)}\n${JSON.stringify(record)}\n`),
    /battery result repeats gate only-gate/u,
  );
  const rootFailure = {
    ...record,
    exitCode: 124,
    failureSignature: `sha256:${'a'.repeat(64)}`,
    state: 'FAIL',
  };
  assert.equal(
    parseBatteryResults(`${JSON.stringify({
      ...rootFailure,
      terminationReason: 'timeout',
    })}\n`)[0].terminationReason,
    'timeout',
  );
  assert.equal(
    parseBatteryResults(`${JSON.stringify({
      ...rootFailure,
      terminationReason: 'exit',
    })}\n`)[0].terminationReason,
    'exit',
    'a natural exit 124 remains structurally distinct from a runner timeout',
  );
  assert.throws(
    () => parseBatteryResults(`${JSON.stringify({
      ...rootFailure,
      exitCode: 7,
      terminationReason: 'timeout',
    })}\n`),
    /must use exit 124/u,
  );
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-battery-missing-gate-'));
  try {
    const resultsPath = join(scratch, 'results.jsonl');
    writeFileSync(resultsPath, `${JSON.stringify(record)}\n`);
    const context = { inventory: { canonicalGates: ['only-gate', 'missing-gate'] } };
    const completionPath = writeBatteryCompletion(
      scratch,
      resultsPath,
      context.inventory.canonicalGates,
    );
    assert.throws(
      () => runBatteryReport({
        resultsPath,
        completionPath,
        root: scratch,
        context,
      }),
      /missing: missing-gate/u,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('complete battery accepts only declared INAPPLICABLE pairs with predicate-valid evidence', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-battery-inapplicable-'));
  const resultsPath = join(scratch, 'results.jsonl');
  let completionPath;
  const record = {
    applicabilityEvidence: { ci: false },
    applicabilityPredicate: 'ci-only',
    blockedBy: [],
    command: '',
    durationMs: 0,
    endedAtMs: 1,
    exitCode: null,
    failureSignature: null,
    terminationReason: null,
    gateId: 'conditional-gate',
    prerequisites: [],
    proofId: 'local-proof',
    schemaVersion: 'snapback.proof-gate-result.v3',
    selectionReason: null,
    startedAtMs: 1,
    state: 'INAPPLICABLE',
  };
  const context = {
    inventory: { canonicalGates: ['conditional-gate'] },
    inapplicabilityDeclarations: [{ gateId: 'conditional-gate', predicate: 'ci-only' }],
  };
  try {
    writeFileSync(resultsPath, `${JSON.stringify(record)}\n`);
    completionPath = writeBatteryCompletion(scratch, resultsPath, context.inventory.canonicalGates);
    assert.equal(runBatteryReport({
      resultsPath, completionPath, root: scratch, context,
    }), 0);

    assert.throws(
      () => runBatteryReport({
        resultsPath,
        completionPath,
        root: scratch,
        context: { ...context, inapplicabilityDeclarations: [] },
      }),
      /undeclared inapplicability pair conditional-gate\/ci-only/u,
    );

    writeFileSync(resultsPath, `${JSON.stringify({
      ...record,
      applicabilityEvidence: { ci: true },
    })}\n`);
    completionPath = writeBatteryCompletion(scratch, resultsPath, context.inventory.canonicalGates);
    assert.throws(
      () => runBatteryReport({
        resultsPath, completionPath, root: scratch, context,
      }),
      /ci-only evidence must be exactly/u,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('standing battery claims are discovered from every on-disk publication anchor', () => {
  const claims = standingBatteryClaims();
  assert.deepEqual(
    claims.map(({ id }) => id).sort(),
    ['agent_safe_derived_deployment_fork_v1', 'single_table_v1'],
  );
  assert.equal(
    claims.find(({ id }) => id === 'single_table_v1')?.recordPath,
    'crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json',
  );
});

test('standing battery claims fail closed before an omitted known anchor can project zero claims', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-battery-zero-claims-'));
  const repo = join(scratch, 'repo');
  mkdirSync(repo);
  try {
    git(repo, ['init', '--quiet']);
    git(repo, ['config', 'user.name', 'Snapback battery fixture']);
    git(repo, ['config', 'user.email', 'snapback-battery@example.invalid']);
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'README.md'), 'legacy publication root\n');
    mkdirSync(join(repo, 'detached'), { recursive: true });
    writeFileSync(
      join(repo, 'detached', 'known-publication.anchor.json'),
      `${JSON.stringify({
        schemaVersion: 'snapback.local-capability-publication-anchor.v1',
        capabilityId: 'known_published_fixture_v1',
        state: 'published',
        carrierSha256: `sha256:${'0'.repeat(64)}`,
      })}\n`,
    );
    const revision = commitAll(repo, 'test: known anchor outside publication root');
    // Anchor discovery now validates the complete set before claim projection.
    // Returning an empty claim set would violate both assert.throws and D-1's
    // fail-closed requirement; pin the newer, more actionable precedence.
    assert.throws(
      () => standingBatteryClaims({ root: repo, revision, context: {} }),
      /publication roots omitted known anchor\(s\): detached\/known-publication\.anchor\.json/u,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

// @ref LLP 0189#decision — D-1 tickets are keyed by normalized root failure,
// maintain independent streak/open state, skip BLOCKED dependents, and expose
// claim relevance without turning an unrelated battery red into a withdrawal.
test('complete battery tickets track signatures, claims, streaks, closure, and reopening independently', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-battery-ticket-'));
  const repo = join(scratch, 'repo');
  mkdirSync(repo);
  try {
    git(repo, ['init', '--quiet']);
    git(repo, ['config', 'user.name', 'Snapback battery fixture']);
    git(repo, ['config', 'user.email', 'snapback-battery@example.invalid']);
    writeFileSync(join(repo, 'README.md'), 'battery fixture\n');
    const head = commitAll(repo, 'test: battery fixture');
    const context = {
      inventory: { canonicalGates: ['dependent-gate', 'root-gate'] },
      inapplicabilityDeclarations: [
        { gateId: 'dependent-gate', predicate: 'ci-only' },
        { gateId: 'root-gate', predicate: 'ci-only' },
      ],
    };
    const resultsPath = join(repo, 'target', 'proof', 'results.jsonl');
    mkdirSync(dirname(resultsPath), { recursive: true });
    const issuesDir = 'issues/battery-fixture';
    const env = { ...process.env, SNAPBACK_BATTERY_TICKET_DATE: '2026-08-15' };
    const claims = [{
      id: 'published_fixture_v1',
      recordPath: 'src/published-fixture.anchor.json',
      relevantGates: new Set(['root-gate']),
    }];
    const signatureA = batteryFailureSignature({
      gateId: 'root-gate',
      exitCode: 7,
      stdout: '',
      stderr: `root failure at ${repo} after 12ms\n`,
      normalizationPaths: [repo],
    });
    assert.equal(signatureA, batteryFailureSignature({
      gateId: 'root-gate',
      exitCode: 7,
      stdout: '',
      stderr: `root failure at ${repo} after 93ms\n`,
      normalizationPaths: [repo],
    }));
    const timeoutMarker = 'SNAPBACK_PROOF_GATE_TIMEOUT: gate=root-gate timeout_seconds=1 signal=TERM\n';
    const timeoutSignature = batteryFailureSignature({
      gateId: 'root-gate',
      exitCode: 124,
      terminationReason: 'timeout',
      stdout: '',
      stderr: timeoutMarker,
      normalizationPaths: [repo],
    });
    assert.notEqual(timeoutSignature, batteryFailureSignature({
      gateId: 'root-gate',
      exitCode: 124,
      terminationReason: 'timeout',
      stdout: '',
      stderr: '',
      normalizationPaths: [repo],
    }), 'the timeout marker must contribute to the normalized signature');
    assert.notEqual(timeoutSignature, batteryFailureSignature({
      gateId: 'root-gate',
      exitCode: 124,
      terminationReason: 'exit',
      stdout: '',
      stderr: timeoutMarker,
      normalizationPaths: [repo],
    }), 'the structural termination reason must contribute to the normalized signature');
    assert.equal(batteryFailureSignature({
      gateId: 'root-gate',
      exitCode: 7,
      stdout: '  duration_ms: 1.25\n# duration_ms 82.5\n',
      stderr: 'same TAP failure\n',
      normalizationPaths: [repo],
    }), batteryFailureSignature({
      gateId: 'root-gate',
      exitCode: 7,
      stdout: '  duration_ms: 93.75\n# duration_ms 104.125\n',
      stderr: 'same TAP failure\n',
      normalizationPaths: [repo],
    }));
    const signatureB = batteryFailureSignature({
      gateId: 'root-gate',
      exitCode: 7,
      stdout: '',
      stderr: 'a distinct root cause\n',
      normalizationPaths: [repo],
    });
    const result = (gateId, state, signature = null) => ({
      applicabilityEvidence: state === 'INAPPLICABLE' ? { ci: false } : null,
      applicabilityPredicate: state === 'INAPPLICABLE' ? 'ci-only' : null,
      blockedBy: state === 'BLOCKED' ? ['root-gate'] : [],
      command: ['NOT_SELECTED', 'INAPPLICABLE'].includes(state) ? '' : `node ${gateId}.mjs`,
      durationMs: 1,
      endedAtMs: 2,
      exitCode: state === 'FAIL' ? 7 : state === 'PASS' ? 0 : null,
      failureSignature: state === 'FAIL' ? signature : null,
      terminationReason: state === 'FAIL' || state === 'PASS' ? 'exit' : null,
      gateId,
      prerequisites: gateId === 'dependent-gate' ? ['root-gate'] : [],
      proofId: 'local-proof',
      schemaVersion: 'snapback.proof-gate-result.v3',
      selectionReason: state === 'NOT_SELECTED' ? 'outside fixture cadence' : null,
      startedAtMs: 1,
      state,
    });
    let completionPath;
    const writeResults = (rootState, signature = null) => {
      const dependentState = rootState === 'PASS' ? 'PASS'
        : ['NOT_SELECTED', 'INAPPLICABLE'].includes(rootState) ? rootState : 'BLOCKED';
      writeFileSync(resultsPath, [
        result('root-gate', rootState, signature),
        result('dependent-gate', dependentState),
      ].map((entry) => JSON.stringify(entry)).join('\n') + '\n');
      completionPath = writeBatteryCompletion(repo, resultsPath, context.inventory.canonicalGates);
    };
    const runBattery = (runId) => runBatteryBackstop({
      head,
      resultsPath,
      completionPath,
      runId,
      issuesDir,
      root: repo,
      context,
      env,
      claims,
    });
    const openTickets = () => readdirSync(join(repo, issuesDir))
      .filter((name) => name.endsWith('.md')).sort();
    const closedTickets = () => readdirSync(join(repo, issuesDir, 'closed'))
      .filter((name) => name.endsWith('.md')).sort();

    writeResults('FAIL', signatureA);
    assert.equal(runBattery('run-1'), 1);
    assert.equal(runBattery('run-1'), 1, 'retrying one run id is idempotent');
    assert.equal(openTickets().length, 1);
    let body = readFileSync(join(repo, issuesDir, openTickets()[0]), 'utf8');
    assert.match(body, /\*\*Consecutive red runs:\*\* `1`/u);
    assert.match(body, /`published_fixture_v1` — `src\/published-fixture\.anchor\.json`/u);
    assert.doesNotMatch(body, /dependent-gate/u);

    assert.equal(runBattery('run-2'), 1);
    body = readFileSync(join(repo, issuesDir, openTickets()[0]), 'utf8');
    assert.match(body, /\*\*Consecutive red runs:\*\* `2`/u);

    writeResults('FAIL', signatureB);
    assert.equal(runBattery('run-3'), 1);
    assert.equal(openTickets().length, 1);
    assert.equal(closedTickets().length, 1);
    assert.match(openTickets()[0], new RegExp(signatureB.slice(-64, -48), 'u'));

    writeResults('INAPPLICABLE');
    assert.equal(runBattery('run-3a'), 0);
    body = readFileSync(join(repo, issuesDir, openTickets()[0]), 'utf8');
    assert.match(body, /\*\*Consecutive red runs:\*\* `1`/u);
    assert.equal(openTickets().length, 1, 'INAPPLICABLE preserves an open FAIL streak');

    writeResults('BLOCKED');
    assert.equal(runBattery('run-4'), 1);
    body = readFileSync(join(repo, issuesDir, openTickets()[0]), 'utf8');
    assert.match(body, /\*\*Consecutive red runs:\*\* `0`/u);
    assert.equal(openTickets().length, 1, 'BLOCKED neither files nor closes a root ticket');

    writeResults('NOT_SELECTED');
    assert.throws(
      () => runBattery('run-4a'),
      /complete battery cannot contain policy NOT_SELECTED gate/u,
    );
    writeResults('INAPPLICABLE');
    assert.equal(runBattery('run-4b'), 0);
    body = readFileSync(join(repo, issuesDir, openTickets()[0]), 'utf8');
    assert.match(body, /\*\*Consecutive red runs:\*\* `0`/u);
    assert.equal(openTickets().length, 1, 'INAPPLICABLE neither files nor closes a ticket');

    writeResults('FAIL', signatureB);
    for (const runId of ['run-5', 'run-6', 'run-7', 'run-8']) assert.equal(runBattery(runId), 1);
    body = readFileSync(join(repo, issuesDir, openTickets()[0]), 'utf8');
    assert.match(body, /\*\*Consecutive red runs:\*\* `4`/u);
    assert.match(body, /\*\*Escalation:\*\* `AUTHOR_ESCALATION_REQUIRED`/u);
    assert.match(body, /## Author escalation/u);

    writeResults('PASS');
    assert.equal(runBattery('run-9'), 0);
    assert.equal(openTickets().length, 0);
    assert.equal(closedTickets().length, 2);

    writeResults('FAIL', signatureB);
    assert.equal(runBattery('run-10'), 1);
    assert.equal(openTickets().length, 1, 'a closed signature reopens its one ticket');
    assert.equal(closedTickets().length, 1);
    body = readFileSync(join(repo, issuesDir, openTickets()[0]), 'utf8');
    assert.match(body, /\*\*Reopened by battery run:\*\* `run-10`/u);
    assert.match(body, /\*\*Consecutive red runs:\*\* `1`/u);
    assert.match(body, /\*\*Escalation:\*\* `pending \(1\/4\)`/u);
    assert.doesNotMatch(body, /## Author escalation/u);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('backstop adopts a legacy gate-only ticket in place', () => {
  const { runs, revisions, issues } = runBackstopSignatureFixture({
    details: ['legacy ticket red'],
    legacyTicket: true,
  });
  assert.equal(runs[0].status, 1, runs[0].output);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].name, '20260810-legacy-guide-drift.md');
  assert.match(issues[0].body, /^\*\*Failure signature:\*\* `sha256:[0-9a-f]{64}`$/mu);
  assert.ok(issues[0].body.includes(`**Last observed:** \`${revisions[0]}\``));
  assert.match(runs[0].output, /not filing a duplicate; updated its last observation/u);
});

test('failure normalization strips volatile durations, temp paths, PIDs, and ports', () => {
  const { runs, requests } = runOutcomeFixture({
    baseline: {
      prepare: 'infra:outage after 1.25s /var/folders/aa/one/T/job-1 PID 123 port 4100',
      check: 'pass',
    },
    pushed: {
      prepare: 'infra:outage after 8ms /var/folders/bb/two/T/job-2 PID 987 port 6200',
      check: 'pass',
    },
  });
  assert.equal(runs[0].status, 0, runs[0].output);
  assert.match(runs[0].output, /OUTCOME INFRASTRUCTURE guide/u);
  assert.equal(requests.length, 1);
});

test('ticket request writer recovers a stale lock and quarantines a torn JSONL line', () => {
  const { runs, requests, quarantined } = runOutcomeFixture({
    baseline: { prepare: 'infra:shared setup outage', check: 'pass' },
    pushed: { prepare: 'infra:shared setup outage', check: 'pass' },
    staleRequestLock: true,
    tornRequestLine: '{"schemaVersion":"snapback.drift-ticket-request.v1"',
  });
  assert.equal(runs[0].status, 0, runs[0].output);
  assert.equal(requests.length, 1);
  assert.equal(quarantined.length, 1);
  assert.equal(quarantined[0].lineNumber, 1);
  assert.match(quarantined[0].reason, /invalid JSON/u);
});

test('missing declared dependencies reproduce as corroborated infrastructure', { timeout: 60_000 }, () => {
  const { scratch, repo } = setupCommittedClone();
  const savedModules = join(scratch, 'saved-node-modules');
  try {
    renameSync(join(repo, 'node_modules'), savedModules);
    appendFileSync(
      join(repo, 'packages/snapback-client/assets.mjs'),
      '\n// committed dependency-infrastructure probe\n',
    );
    commitAll(repo, 'test: committed client gate with unavailable dependencies');
    const result = run(repo, 'git', ['push', 'origin', 'HEAD:refs/heads/main'], {
      env: { ...process.env, SNAPBACK_DRIFT_GATES_STRICT: '1' },
    });
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /OUTCOME INFRASTRUCTURE client-bundle-metrology/u);
    assert.match(result.output, /required Node module\(s\) unavailable: esbuild/u);
    assert.doesNotMatch(result.output, /stale record:/u);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('agent-safe publication checker passes in the isolated revision environment', { timeout: 120_000 }, () => {
  // Exercise nested worktree isolation from a disposable repository. The
  // source checkout may itself be a managed worktree whose common Git
  // directory is intentionally read-only to the test process.
  const { scratch, repo } = setupCommittedClone();
  try {
    const result = runRegisteredGateAtRevision({
      gate: 'agent-safe-publication-fixtures',
      isolated: true,
      root: repo,
    });
    assert.equal(result.ok, true, `${result.stdout}\n${result.stderr}`);
    assert.equal(result.infrastructureReason, null);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('diary identity backstop files one ticket for a new collision', { timeout: 60_000 }, () => {
  const { scratch, repo } = setupCommittedClone();
  const env = {
    ...process.env,
    SNAPBACK_DRIFT_TICKET_DATE: '2026-08-10',
  };
  try {
    const diaryNames = readdirSync(join(repo, 'diaries'))
      .filter((name) => /^\d{4}-.+\.diary\.md$/u.test(name));
    const counts = new Map();
    for (const name of diaryNames) {
      const prefix = name.slice(0, 4);
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    }
    const sourceName = diaryNames.find((name) => counts.get(name.slice(0, 4)) === 1);
    assert.ok(sourceName, 'fixture needs a non-colliding diary prefix');
    const prefix = sourceName.slice(0, 4);
    copyFileSync(
      join(repo, 'diaries', sourceName),
      join(repo, 'diaries', `${prefix}-drift-backstop-probe.diary.md`),
    );
    commitAll(repo, 'test: introduce a new diary identity collision');

    const first = run(repo, process.execPath, [
      'scripts/drift-prone-gates.mjs', 'backstop', '--head', 'HEAD',
      '--gate', 'diary-identity',
    ], { env });
    assert.equal(first.status, 1, first.output);
    assert.match(first.output, new RegExp(`NEW collision ${prefix}:`, 'u'));
    assert.match(
      first.output,
      /FILED issues\/20260810-main-drift-diary-identity-[0-9a-f]{16}\.md/u,
    );

    const second = run(repo, process.execPath, [
      'scripts/drift-prone-gates.mjs', 'backstop', '--head', 'HEAD',
      '--gate', 'diary-identity',
    ], { env });
    assert.equal(second.status, 1, second.output);
    assert.match(second.output, /existing open ticket .*; not filing a duplicate/u);
    const diaryTickets = readdirSync(join(repo, 'issues'))
      .filter((name) => name.startsWith('20260810-main-drift-diary-identity-'));
    assert.equal(diaryTickets.length, 1);
    assert.match(diaryTickets[0], /^20260810-main-drift-diary-identity-[0-9a-f]{16}\.md$/u);
    console.log(
      `DEMO diary NEW collision -> one idempotent backstop ticket\n`
        + `${relevantLines(first.output)}\n${relevantLines(second.output)}`,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('tracked hook observes the compatibility bypass while keeping visibility governance active', { timeout: 60_000 }, () => {
  const { scratch, repo } = setupCommittedClone();
  try {
    appendFileSync(join(repo, 'guide/index.md'), '\n<!-- compatibility bypass posture probe -->\n');
    commitAll(repo, 'test: exercise compatibility bypass posture');
    const pushed = run(repo, 'git', ['push', 'origin', 'HEAD:refs/heads/main'], {
      env: { ...process.env, SNAPBACK_DRIFT_GATES_BYPASS: '1' },
    });
    assert.equal(pushed.status, 0, pushed.output);
    assert.match(
      pushed.output,
      /\[visibility-governance\] COMPATIBILITY BYPASS OBSERVED: SNAPBACK_DRIFT_GATES_BYPASS=1.*synchronous visibility governance remains enforced/u,
    );
    assert.match(pushed.output, /\[visibility-governance\] ALLOWED: 1 governed ref update/u);
    assert.match(pushed.output, /BYPASS ACTIVE: SNAPBACK_DRIFT_GATES_BYPASS=1/u);
    assert.match(pushed.output, /COMPATIBILITY BYPASS: ordinary pushes already defer/u);
    assert.match(
      pushed.output,
      /BYPASS ALLOWED: skipped 3 selected gate\(s\): guide, path-migration-stragglers, workspace-graph/u,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('optimistic hook, strict mode, and main backstop operate on committed pushes', { timeout: 180_000 }, () => {
  const { scratch, repo } = setupCommittedClone();
  const env = {
    ...process.env,
    SNAPBACK_DRIFT_TICKET_DATE: '2026-08-06',
  };
  const strictEnv = {
    ...env,
    SNAPBACK_DRIFT_GATES_STRICT: '1',
  };
  try {
    appendFileSync(
      join(repo, 'tests/agent_safe_publication_checker_v1.mjs'),
      '\n// committed default-deferral probe\n',
    );
    const deferredCommit = commitAll(repo, 'test: default defers selected agent-safe gate');
    appendFileSync(join(repo, 'README.md'), '\n<!-- later committed HEAD -->\n');
    commitAll(repo, 'test: advance worktree beyond pushed revision');
    const deferred = run(
      repo,
      'git',
      ['push', 'origin', `${deferredCommit}:refs/heads/main`],
      { env },
    );
    assert.equal(deferred.status, 0, deferred.output);
    assert.match(
      deferred.output,
      /DEFERRED BY DEFAULT: .* no gate commands ran: agent-safe-publication-fixtures, path-migration-stragglers, workspace-graph/u,
    );
    assert.doesNotMatch(deferred.output, /dependency mirror cache|\[snapback-drift\] RUN /u);
    console.log(
      `DEMO ordinary committed trigger -> selected and deferred\n`
        + relevantLines(deferred.output),
    );

    appendFileSync(
      join(repo, 'tests/agent_safe_publication_checker_v1.mjs'),
      '\n// committed strict-execution probe\n',
    );
    const strictCommit = commitAll(repo, 'test: strict mode executes selected gates');
    const strict = run(
      repo,
      'git',
      ['push', 'origin', `${strictCommit}:refs/heads/main`],
      { env: strictEnv },
    );
    assert.equal(strict.status, 0, strict.output);
    assert.match(strict.output, /RUN agent-safe-publication-fixtures:/u);
    assert.match(strict.output, /RUN path-migration-stragglers:/u);
    assert.match(strict.output, /RUN workspace-graph:/u);
    assert.match(strict.output, /PASS agent-safe-publication-fixtures/u);
    assert.match(strict.output, /PASS path-migration-stragglers/u);
    // This checkpoint intentionally carries no inherited red; an ambient stale
    // gate must not hide behind a permissive summary-count assertion.
    assert.deepEqual(inheritedStaleGateNames(strict.output), []);
    assert.match(strict.output, /ALLOWED: 3 selected drift-prone gate\(s\) passed/u);
    console.log(
      `DEMO explicit strict trigger in isolated checkout -> executed and allowed\n`
        + relevantLines(strict.output),
    );

    appendFileSync(join(repo, 'guide/index.md'), '\n<!-- committed stale-guide probe -->\n');
    const staleCommit = commitAll(repo, 'test: committed guide change without frozen record');
    const refused = run(
      repo,
      'git',
      ['push', 'origin', 'HEAD:refs/heads/main'],
      { env: strictEnv },
    );
    assert.notEqual(refused.status, 0, refused.output);
    assert.match(refused.output, /REFUSED: .* failed drift-prone gate guide/u);
    assert.match(
      refused.output,
      /stale record: Guide manifest, whole-corpus flat, and every section flat projection/u,
    );
    assert.match(
      refused.output,
      /stale record: diagnostics registry, Markdown projection, and public TypeScript code union/u,
    );
    assert.match(
      refused.output,
      /stale record: symbol registry, compact reference index, and every generated module reference page/u,
    );
    assert.match(refused.output, /regenerate: node scripts\/generate-guide-manifest\.mjs/u);
    assert.doesNotMatch(refused.output, /\n\s+at (?:async )?/u);
    assert.doesNotMatch(refused.output, /\[snapback-drift\] ERROR:/u);
    assert.equal(git(repo, ['rev-parse', 'HEAD']).trim(), staleCommit);
    console.log(`DEMO (a) committed stale record -> refused\n${relevantLines(refused.output)}`);

    const generated = run(
      repo,
      process.execPath,
      ['scripts/generate-guide-manifest.mjs'],
      { env },
    );
    assert.equal(generated.status, 0, generated.output);
    const reconciledCommit = commitAll(repo, '', { amend: true });
    assert.notEqual(reconciledCommit, staleCommit);
    const allowed = run(
      repo,
      'git',
      ['push', 'origin', 'HEAD:refs/heads/main'],
      { env: strictEnv },
    );
    assert.equal(allowed.status, 0, allowed.output);
    assert.deepEqual(inheritedStaleGateNames(allowed.output), []);
    assert.match(allowed.output, /ALLOWED: 3 selected drift-prone gate\(s\) passed/u);
    console.log(`DEMO (b) same committed change with generated record -> allowed\n${relevantLines(allowed.output)}`);
    console.log(`TIMING measured-surface git push: ${allowed.wallMs} ms`);

    appendFileSync(join(repo, 'README.md'), '\n<!-- committed unmeasured-path probe -->\n');
    commitAll(repo, 'test: committed unmeasured path');
    const fast = run(repo, 'git', ['push', 'origin', 'HEAD:refs/heads/main'], { env });
    assert.equal(fast.status, 0, fast.output);
    assert.match(fast.output, /selected 2 gate\(s\): path-migration-stragglers, workspace-graph/u);
    assert.match(
      fast.output,
      /DEFERRED BY DEFAULT: .* no gate commands ran: path-migration-stragglers, workspace-graph/u,
    );
    assert.doesNotMatch(fast.output, /RUN workspace-graph|PASS workspace-graph/u);
    console.log(`DEMO (c) committed docs-only path -> always-run gates selected and deferred\n${relevantLines(fast.output)}`);

    const noOp = run(repo, 'git', ['push', 'origin', 'HEAD:refs/heads/main'], { env });
    assert.equal(noOp.status, 0, noOp.output);
    console.log(`TIMING no-op git push: ${noOp.wallMs} ms (${noOp.output.trim()})`);

    appendFileSync(join(repo, 'guide/index.md'), '\n<!-- committed bypass probe -->\n');
    const bypassCommit = commitAll(repo, 'test: committed bypassed guide drift');
    const bypass = run(repo, 'git', ['push', 'origin', 'HEAD:refs/heads/main'], {
      env: { ...env, SNAPBACK_DRIFT_GATES_BYPASS: '1' },
    });
    assert.equal(bypass.status, 0, bypass.output);
    assert.match(
      bypass.output,
      /\[visibility-governance\] COMPATIBILITY BYPASS OBSERVED: SNAPBACK_DRIFT_GATES_BYPASS=1.*synchronous visibility governance remains enforced/u,
    );
    assert.match(bypass.output, /BYPASS ACTIVE: SNAPBACK_DRIFT_GATES_BYPASS=1/u);
    assert.match(bypass.output, /COMPATIBILITY BYPASS: ordinary pushes already defer/u);
    assert.match(
      bypass.output,
      /BYPASS ALLOWED: skipped 3 selected gate\(s\): guide, path-migration-stragglers, workspace-graph/u,
    );
    console.log(`DEMO (d) explicit bypass -> allowed and loud\n${relevantLines(bypass.output)}`);

    appendFileSync(join(repo, 'guide/index.md'), '\n<!-- committed pre-existing drift probe -->\n');
    commitAll(repo, 'test: guide remains stale after its baseline');
    const preExisting = run(
      repo,
      'git',
      ['push', 'origin', 'HEAD:refs/heads/main'],
      { env: strictEnv },
    );
    assert.equal(preExisting.status, 0, preExisting.output);
    // The bypassed commit deliberately leaves only Guide stale. Compare names
    // so an unrelated red cannot replace Guide while preserving a bare count.
    const expectedInheritedStaleGates = ['guide'];
    assert.deepEqual(inheritedStaleGateNames(preExisting.output), expectedInheritedStaleGates);
    assert.match(
      preExisting.output,
      new RegExp(
        `ALLOWED WITH PRE-EXISTING STALENESS: ${expectedInheritedStaleGates.length} gate\\(s\\)`,
        'u',
      ),
    );
    console.log(
      `DEMO (e) baseline-stale gate -> allowed with attribution\n`
        + relevantLines(preExisting.output),
    );

    appendFileSync(join(repo, 'unclassified-drift-probe.xyz'), 'core tier integration probe\n');
    commitAll(repo, 'test: unknown path selects the fail-closed core');
    const coreTier = run(
      repo,
      'git',
      ['push', 'origin', 'HEAD:refs/heads/main'],
      { env: strictEnv },
    );
    assert.equal(coreTier.status, 0, coreTier.output);
    const context = loadSelectionContext();
    const selectedCoreCount = selectDriftProneGates(
      ['unclassified-drift-probe.xyz'],
      context,
    ).selectedDriftProneGates.length;
    const registeredCount = Object.keys(context.policy.driftProneGates).length;
    assert.match(
      coreTier.output,
      new RegExp(
        `FAIL-CLOSED selection: .*running CORE tier `
          + `\\(${selectedCoreCount} of ${registeredCount} registered gates\\)`,
        'u',
      ),
    );
    assert.doesNotMatch(coreTier.output, /RUN client-bundle-metrology:/u);
    assert.doesNotMatch(coreTier.output, /RUN auth-invalidation-report:/u);
    assert.doesNotMatch(coreTier.output, /RUN deployment-identity:/u);
    console.log(
      `DEMO (f) unknown committed path -> fail-closed core tier\n`
        + relevantLines(coreTier.output),
    );

    const fixtureIssues = 'issues/drift-runner-fixture';
    const firstBackstop = run(repo, process.execPath, [
      'scripts/drift-prone-gates.mjs', 'backstop', '--head', 'HEAD', '--gate', 'guide',
      '--issues-dir', fixtureIssues,
    ], { env });
    assert.equal(firstBackstop.status, 1, firstBackstop.output);
    assert.match(firstBackstop.output, /dependency mirror cache HIT [0-9a-f]{16}/u);
    assert.match(
      firstBackstop.output,
      /FILED issues\/drift-runner-fixture\/20260806-main-drift-guide-[0-9a-f]{16}\.md/u,
    );
    const ticketsAfterFirst = readdirSync(join(repo, fixtureIssues))
      .filter((name) => name.includes('main-drift-guide'));
    assert.equal(ticketsAfterFirst.length, 1);
    assert.match(ticketsAfterFirst[0], /^20260806-main-drift-guide-[0-9a-f]{16}\.md$/u);
    const ticket = readFileSync(join(repo, fixtureIssues, ticketsAfterFirst[0]), 'utf8');
    assert.ok(ticket.includes('**Causal landing:** `' + bypassCommit + '`'));
    const causalLanding = ticket.split(/\r?\n/u)
      .find((line) => line.startsWith('**Causal landing:**'));
    assert.ok(causalLanding);

    const secondBackstop = run(repo, process.execPath, [
      'scripts/drift-prone-gates.mjs', 'backstop', '--head', 'HEAD', '--gate', 'guide',
      '--issues-dir', fixtureIssues,
    ], { env });
    assert.equal(secondBackstop.status, 1, secondBackstop.output);
    assert.match(secondBackstop.output, /existing open ticket .*; not filing a duplicate/u);
    const ticketsAfterSecond = readdirSync(join(repo, fixtureIssues))
      .filter((name) => name.includes('main-drift-guide'));
    assert.deepEqual(ticketsAfterSecond, ticketsAfterFirst);
    console.log(
      `DEMO (g) backstop -> one ticket, second run idempotent\n`
        + `${relevantLines(firstBackstop.output)}\n${causalLanding}\n`
        + `${relevantLines(secondBackstop.output)}`,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
