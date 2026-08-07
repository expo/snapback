import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
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
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  loadSelectionContext,
  selectDriftProneGates,
} from '../scripts/select-local-proof.mjs';
import {
  printRefusal,
  runRegisteredGateAtRevision,
} from '../scripts/drift-prone-gates.mjs';

// Every probe below is committed in a disposable clone before Git invokes the
// real tracked pre-push hook. A working-tree-only edit is deliberately never
// used as evidence for selection or enforcement.
// @ref LLP 0175#same-change-frozen-record-coupling — committed-history
// integration fixtures prove refusal, reconciliation, bypass, and backstop.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IMPLEMENTATION_FILES = [
  '.githooks/pre-push',
  'scripts/drift-prone-gates.mjs',
  'scripts/check-contract-meta.mjs',
  'scripts/check-contract-meta.test.mjs',
  'scripts/local-proof-selection-policy.v1.json',
  'scripts/select-local-proof.mjs',
  'scripts/update-agent-safe-publication-leaf-set.mjs',
  'scripts/update-contract-meta.mjs',
  'scripts/verify-local-proof',
  'tests/agent_safe_publication_checker_v1.mjs',
  'tests/drift_prone_gates_v0.mjs',
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
      || line.includes('[guide-check] error: guide/guide-manifest.generated.json')
      || line.includes('[guide-check] error: guide/guide-flat.generated.md')
  )).join('\n');
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
  for (const name of readdirSync(join(sourceModules, '@expo'))) {
    symlinkSync(join(repo, 'packages', name), join(targetModules, '@expo', name), 'dir');
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

test('drift selection is narrow for known paths and fail-closed for unknown paths', () => {
  const context = loadSelectionContext();
  assert.deepEqual(
    selectDriftProneGates(['README.md'], context).selectedDriftProneGates,
    [],
  );
  assert.deepEqual(
    selectDriftProneGates(['guide/index.md'], context).selectedDriftProneGates,
    ['guide'],
  );
  assert.deepEqual(
    selectDriftProneGates([
      'tests/agent_safe_publication_checker_v1.mjs',
    ], context).selectedDriftProneGates,
    ['agent-safe-publication-fixtures'],
  );
  const unknown = selectDriftProneGates(['unclassified-drift-probe.xyz'], context);
  assert.equal(unknown.selectionClass, 'FAIL_CLOSED_FULL');
  assert.deepEqual(
    unknown.selectedDriftProneGates,
    context.inventory.canonicalGates.filter((gate) => (
      Object.hasOwn(context.policy.driftProneGates, gate)
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

test('missing declared dependencies are infrastructure, never stale records', { timeout: 60_000 }, () => {
  const { scratch, repo } = setupCommittedClone();
  const savedModules = join(scratch, 'saved-node-modules');
  try {
    renameSync(join(repo, 'node_modules'), savedModules);
    appendFileSync(
      join(repo, 'packages/snapback-client/assets.mjs'),
      '\n// committed dependency-infrastructure probe\n',
    );
    commitAll(repo, 'test: committed client gate with unavailable dependencies');
    const result = run(repo, 'git', ['push', 'origin', 'HEAD:refs/heads/main']);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /INFRASTRUCTURE ERROR: .* could not faithfully run client-bundle-metrology/u);
    assert.match(result.output, /required Node module\(s\) unavailable: esbuild/u);
    assert.doesNotMatch(result.output, /stale record:/u);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('agent-safe publication checker passes in the isolated revision environment', { timeout: 60_000 }, () => {
  const result = runRegisteredGateAtRevision({
    gate: 'agent-safe-publication-fixtures',
    isolated: true,
  });
  assert.equal(result.ok, true, `${result.stdout}\n${result.stderr}`);
  assert.equal(result.infrastructureReason, null);
});

test('same-change hook and main backstop operate on committed pushes', { timeout: 180_000 }, () => {
  const { scratch, repo } = setupCommittedClone();
  const env = {
    ...process.env,
    SNAPBACK_DRIFT_TICKET_DATE: '2026-08-06',
  };
  try {
    appendFileSync(
      join(repo, 'tests/agent_safe_publication_checker_v1.mjs'),
      '\n// committed consistent-trigger probe\n',
    );
    const consistentCommit = commitAll(repo, 'test: consistent agent-safe trigger');
    appendFileSync(join(repo, 'README.md'), '\n<!-- later committed HEAD -->\n');
    commitAll(repo, 'test: advance worktree beyond pushed revision');
    const consistent = run(
      repo,
      'git',
      ['push', 'origin', `${consistentCommit}:refs/heads/main`],
      { env },
    );
    assert.equal(consistent.status, 0, consistent.output);
    assert.match(consistent.output, /dependency mirror cache MISS [0-9a-f]{16}/u);
    assert.match(consistent.output, /PASS agent-safe-publication-fixtures/u);
    assert.match(consistent.output, /ALLOWED: 1 selected drift-prone gate\(s\) passed/u);
    console.log(
      `DEMO consistent committed trigger in isolated checkout -> allowed\n`
        + relevantLines(consistent.output),
    );

    appendFileSync(join(repo, 'guide/index.md'), '\n<!-- committed stale-guide probe -->\n');
    const staleCommit = commitAll(repo, 'test: committed guide change without frozen record');
    const refused = run(repo, 'git', ['push', 'origin', 'HEAD:refs/heads/main'], { env });
    assert.notEqual(refused.status, 0, refused.output);
    assert.match(refused.output, /REFUSED: .* failed drift-prone gate guide/u);
    assert.match(refused.output, /stale record: guide\/guide-manifest\.generated\.json/u);
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
    const allowed = run(repo, 'git', ['push', 'origin', 'HEAD:refs/heads/main'], { env });
    assert.equal(allowed.status, 0, allowed.output);
    assert.match(allowed.output, /ALLOWED: .* selected drift-prone gate\(s\) passed/u);
    console.log(`DEMO (b) same committed change with generated record -> allowed\n${relevantLines(allowed.output)}`);
    console.log(`TIMING measured-surface git push: ${allowed.wallMs} ms`);

    appendFileSync(join(repo, 'README.md'), '\n<!-- committed unmeasured-path probe -->\n');
    commitAll(repo, 'test: committed unmeasured path');
    const fast = run(repo, 'git', ['push', 'origin', 'HEAD:refs/heads/main'], { env });
    assert.equal(fast.status, 0, fast.output);
    assert.match(fast.output, /FAST PATH: 1 committed changed path\(s\); 0 drift-prone gates run/u);
    console.log(`DEMO (c) committed unmeasured path -> fast path\n${relevantLines(fast.output)}`);

    const noOp = run(repo, 'git', ['push', 'origin', 'HEAD:refs/heads/main'], { env });
    assert.equal(noOp.status, 0, noOp.output);
    console.log(`TIMING no-op git push: ${noOp.wallMs} ms (${noOp.output.trim()})`);

    appendFileSync(join(repo, 'guide/index.md'), '\n<!-- committed bypass probe -->\n');
    const bypassCommit = commitAll(repo, 'test: committed bypassed guide drift');
    const bypass = run(repo, 'git', ['push', 'origin', 'HEAD:refs/heads/main'], {
      env: { ...env, SNAPBACK_DRIFT_GATES_BYPASS: '1' },
    });
    assert.equal(bypass.status, 0, bypass.output);
    assert.match(bypass.output, /BYPASS ACTIVE: SNAPBACK_DRIFT_GATES_BYPASS=1/u);
    assert.match(bypass.output, /BYPASS ALLOWED: skipped 1 selected gate\(s\): guide/u);
    console.log(`DEMO (d) explicit bypass -> allowed and loud\n${relevantLines(bypass.output)}`);

    const firstBackstop = run(repo, process.execPath, [
      'scripts/drift-prone-gates.mjs', 'backstop', '--head', 'HEAD', '--gate', 'guide',
    ], { env });
    assert.equal(firstBackstop.status, 1, firstBackstop.output);
    assert.match(firstBackstop.output, /dependency mirror cache HIT [0-9a-f]{16}/u);
    assert.match(firstBackstop.output, /FILED issues\/20260806-main-drift-guide\.md/u);
    const ticketsAfterFirst = readdirSync(join(repo, 'issues'))
      .filter((name) => name.includes('main-drift-guide'));
    assert.deepEqual(ticketsAfterFirst, ['20260806-main-drift-guide.md']);
    const ticket = readFileSync(join(repo, 'issues', ticketsAfterFirst[0]), 'utf8');
    assert.ok(ticket.includes('**Causal landing:** `' + bypassCommit + '`'));
    const causalLanding = ticket.split(/\r?\n/u)
      .find((line) => line.startsWith('**Causal landing:**'));
    assert.ok(causalLanding);

    const secondBackstop = run(repo, process.execPath, [
      'scripts/drift-prone-gates.mjs', 'backstop', '--head', 'HEAD', '--gate', 'guide',
    ], { env });
    assert.equal(secondBackstop.status, 1, secondBackstop.output);
    assert.match(secondBackstop.output, /existing open ticket .*; not filing a duplicate/u);
    const ticketsAfterSecond = readdirSync(join(repo, 'issues'))
      .filter((name) => name.includes('main-drift-guide'));
    assert.deepEqual(ticketsAfterSecond, ticketsAfterFirst);
    console.log(
      `DEMO (e) backstop -> one ticket, second run idempotent\n`
        + `${relevantLines(firstBackstop.output)}\n${causalLanding}\n`
        + `${relevantLines(secondBackstop.output)}`,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
