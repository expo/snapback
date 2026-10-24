import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { changedPaths, loadModel, modelAtRevision, reverseClosure, selectAffected, runPlan, proofReceiptOptions, ROOT } from './affected.mjs';
import { selectChangedPaths } from '../../scripts/select-local-proof.mjs';

const crate = (name, dependencies = []) => ({ name, dependencies, dir: `snapback4/crates/${name}`, targets: [
  { name: 'focused', kind: ['test'], path: `snapback4/crates/${name}/tests/focused.rs` },
] });
const pkg = (name, dependencies = []) => ({ name, dependencies, dir: `snapback4/packages/${name}`, scripts: {}, tests: [`snapback4/packages/${name}/test/one.test.mjs`] });
const model = {
  crates: [crate('snapback4-core'), crate('snapback4-lang', ['snapback4-core']), crate('snapback4', ['snapback4-lang']), crate('snapback4-device', ['snapback4-core']), crate('isolated')],
  packages: [pkg('snapback4'), pkg('consumer', ['snapback4'])], files: [], text: () => '',
  clientEvidence: { 'snapback4/packages/snapback4/test/residency.test.mjs': ['residency.test.mjs: CLI/process consumer', 'residency.test.mjs: wasm consumer'] },
};
const select = files => selectAffected(files, model);
const ids = plan => plan.steps.map(step => step.id);

test('lang source closes over reverse dependencies and CLI consumers', () => {
  const plan = select(['snapback4/crates/snapback4-lang/src/bind.rs']);
  assert.deepEqual(plan.rustPackages, ['snapback4', 'snapback4-lang']);
  assert(plan.clientFiles.includes('snapback4/packages/snapback4/test/residency.test.mjs'));
  assert(ids(plan).includes('difftest:run-lean'));
});
test('integration test-only change selects one cargo target and no reverse dependents', () => {
  const plan = select(['snapback4/crates/snapback4-lang/tests/focused.rs']);
  assert.deepEqual(plan.rustPackages, []);
  assert.deepEqual(plan.rustTargets, { 'snapback4-lang': ['focused'] });
  assert.deepEqual(ids(plan), ['rust:snapback4-lang:focused', 'ref-check']);
});
test('a source change overrides test-only narrowing', () => {
  const plan = select(['snapback4/crates/snapback4-lang/tests/focused.rs', 'snapback4/crates/snapback4-lang/src/lib.rs']);
  assert.deepEqual(plan.rustTargets, {});
  assert(plan.rustPackages.includes('snapback4-lang'));
});
test('client source selects package pool and reverse package dependents', () => {
  const plan = select(['snapback4/packages/snapback4/src/client.ts']);
  assert.deepEqual(plan.clientFiles, model.packages.flatMap(pkg => pkg.tests).sort());
  assert.deepEqual(plan.rustPackages, []);
});
test('client test-only change selects only that file', () => {
  const plan = select(model.packages[0].tests);
  assert.deepEqual(plan.clientFiles, model.packages[0].tests);
  assert(!plan.broad);
});
test('guide-only change selects guide, budget and packaged docs, not Rust source closure', () => {
  const plan = select(['snapback4/crates/snapback4-lang/src/guide/language.md']);
  assert.deepEqual(plan.checks, ['docs-budget', 'guide', 'packaged-docs', 'ref-check']);
  assert.deepEqual(plan.rustPackages, []);
});
for (const path of ['snapback4/Cargo.lock', 'snapback4/Cargo.toml', 'snapback4/crates/snapback4-lang/build.rs', 'snapback4/crates/snapback4-lang/tests/support/mod.rs', 'snapback4/packages/snapback4/test/helpers/server.mjs', 'snapback4/surprise/input.bin']) {
  test(`${path} fails broad with a per-file reason`, () => {
    const plan = select([path]);
    assert(plan.broad); assert.equal(plan.rustPackages.length, model.crates.length);
    assert(plan.reasons.some(reason => reason.path === path && reason.reason.startsWith('fail broad:')));
  });
}
test('proc macro fails broad', () => {
  const plan = selectAffected(['snapback4/crates/isolated/src/lib.rs'], { ...model, crates: model.crates.map(crate => ({ ...crate, procMacro: crate.name === 'isolated' })) });
  assert(plan.broad);
});
test('reverse closure handles chains, optional/dev cycles and isolated nodes', () => {
  assert.deepEqual(reverseClosure(['a'], [{ name: 'a', dependencies: ['c'] }, { name: 'b', dependencies: ['a'] }, { name: 'c', dependencies: ['b'] }, { name: 'd', dependencies: [] }]), ['a', 'b', 'c']);
});
test('root delegates Snapback 4 and preserves unknown root fallback', () => {
  const plan = selectChangedPaths(['snapback4/crates/snapback4-lang/src/lib.rs']);
  assert.equal(plan.selectionClass, 'AFFECTED');
  assert(plan.selectedGates.includes('snapback4-affected'));
  assert(!plan.selectedGates.includes('native-runtime-bootstrap'));
  assert(!plan.selectedGates.includes('admin-install'));
  assert.equal(selectChangedPaths(['unowned/a.bin']).selectionClass, 'FAIL_CLOSED_FULL');
});
test('real cargo graph and transitive test imports catch maintained-column regression', () => {
  const actual = loadModel();
  const files = execFileSync('timeout', ['20s', 'git', 'diff-tree', '--no-commit-id', '--name-only', '-r', '202826334f'], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n');
  const plan = selectAffected(files, actual);
  assert(plan.rustPackages.includes('snapback4-core'));
  assert(plan.rustPackages.includes('snapback4-lang'));
  assert(plan.clientFiles.includes('snapback4/packages/snapback4/test/residency.test.mjs'));
});
test('known-red snapshot needs the originating range, not a docs-only red HEAD diff', () => {
  const files = changedPaths(ROOT, '202826334f^', 'cadb7c55be');
  modelAtRevision(ROOT, 'cadb7c55be', actual => {
    const plan = selectAffected(files, actual);
    assert(plan.rustPackages.includes('snapback4-core'));
    assert(plan.rustPackages.includes('snapback4-lang'));
    assert(plan.clientFiles.includes('snapback4/packages/snapback4/test/residency.test.mjs'));
  });
});
test('worktree includes staged, unstaged, deletes, rename old/new and untracked paths', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-affected-test-'));
  const git = (...args) => execFileSync('timeout', ['20s', 'git', ...args], { cwd: dir, encoding: 'utf8' });
  try {
    git('init', '-q');
    for (const path of ['deleted', 'renamed', 'staged', 'unstaged']) writeFileSync(join(dir, path), 'old');
    git('add', '.'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.org', 'commit', '-qm', 'fixture');
    const base = git('rev-parse', 'HEAD').trim();
    rmSync(join(dir, 'deleted')); git('mv', 'renamed', 'new-name');
    writeFileSync(join(dir, 'staged'), 'new'); git('add', 'staged');
    writeFileSync(join(dir, 'unstaged'), 'new'); writeFileSync(join(dir, 'untracked'), 'new');
    assert.deepEqual(changedPaths(dir, base, 'HEAD', true), ['deleted', 'new-name', 'renamed', 'staged', 'unstaged', 'untracked']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('known-red selection contains every failing target in the archived complete suite', () => {
  const archive = 'snapback4/reports/20261022-publication-0.4.38/superseded/attempt-1-cadb7c55be-linux/suite.log.gz';
  const log = gunzipSync(readFileSync(join(ROOT, archive))).toString('utf8');
  const failedTargets = [...log.matchAll(/-- FAIL rust target: ([^ :]+)::([^ (]+)/g)].map(match => ({ crate: match[1], target: match[2] }));
  const counts = [...log.matchAll(/test result: FAILED\. \d+ passed; (\d+) failed/g)].map(match => Number(match[1]));
  assert.equal(failedTargets.length, 6);
  assert.equal(counts.reduce((a, b) => a + b, 0), 21, 'archived raw log has 21 failures; prose report says 19');
  assert.match(log, /not ok 6 - check sidecar, why and test residency/);
  const files = changedPaths(ROOT, '202826334f^', 'cadb7c55be');
  modelAtRevision(ROOT, 'cadb7c55be', actual => {
    const plan = selectAffected(files, actual);
    for (const { crate, target } of failedTargets) assert(plan.rustPackages.includes(crate) || plan.rustTargets[crate]?.includes(target), `${crate}::${target} missed`);
    assert(plan.clientFiles.includes('snapback4/packages/snapback4/test/residency.test.mjs'));
  });
});
test('execution keeps going after failures and persists the complete failing receipt', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-affected-run-'));
  const git = (...args) => execFileSync('timeout', ['20s', 'git', ...args], { cwd: dir, encoding: 'utf8' }).trim();
  try {
    git('init', '-q'); writeFileSync(join(dir, '.gitignore'), 'target/\n'); git('add', '.');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.org', 'commit', '-qm', 'fixture');
    const head = git('rev-parse', 'HEAD');
    const plan = { ...selectAffected([], model), base: head, head, worktree: false, observedFiles: [], inputDigest: createHash('sha256').update('[]').digest('hex'), steps: [
      { id: 'fails', cwd: '.', argv: [process.execPath, '-e', 'process.exit(7)'], timeoutSeconds: 10 },
      { id: 'passes', cwd: '.', argv: [process.execPath, '-e', 'process.exit(0)'], timeoutSeconds: 10 },
      { id: 'blocked', cwd: '.', argv: [process.execPath, '-e', 'process.exit(0)'], requires: ['fails'], timeoutSeconds: 10 },
    ] };
    const { receipt, receiptPath } = await runPlan(plan, { root: dir });
    assert.deepEqual(receipt.results.map(result => result.status), [7, 0, null]);
    assert.deepEqual(receipt.results[2].blockedBy, ['fails']);
    assert.equal(receipt.complete, true); assert.equal(receipt.unchanged, true); assert.equal(receipt.ok, false);
    assert.deepEqual(JSON.parse(readFileSync(receiptPath, 'utf8')), receipt);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('root fail-closed and complete receipts delegate a broad Snapback 4 set', () => {
  for (const receipt of [
    { cadence: 'affected', selectionClass: 'FAIL_CLOSED_FULL', changedFiles: ['unknown/input'], headRevision: 'HEAD' },
    { cadence: 'complete', changedFiles: [], headRevision: 'HEAD' },
  ]) {
    const options = proofReceiptOptions(receipt);
    assert.deepEqual(options.files, ['snapback4/Cargo.toml']);
    assert(select(options.files).broad);
  }
});
test('broad set includes every test.sh non-Rust/client obligation', () => {
  const plan = select(['snapback4/fixtures/clique.mjs']);
  for (const id of ['fixture-tests', 'chat-check', 'chat-typecheck', 'expo-typecheck', 'release-guard', 'build-cli', 'build-wasm', 'build-client']) assert(ids(plan).includes(id), id);
});
test('real bare workspace imports rebuild the client and docs select executable consumers', () => {
  const actual = loadModel();
  const bare = selectAffected(['snapback4/packages/snapback4/test/headless-registration.test.mjs'], actual);
  assert(ids(bare).includes('build-client'));
  for (const path of ['snapback4/packages/snapback4/SERVER.md', 'snapback4/crates/snapback4-lang/src/guide/client.md']) {
    const plan = selectAffected([path], actual);
    assert(plan.rustTargets['snapback4-lang']?.includes('guide'));
    assert(plan.clientFiles.includes('snapback4/packages/snapback4/test/readme-examples.test.mjs'));
  }
});
test('committed execution refuses success if an initially unchanged tracked input changes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-affected-mutation-'));
  const git = (...args) => execFileSync('timeout', ['20s', 'git', ...args], { cwd: dir, encoding: 'utf8' }).trim();
  try {
    git('init', '-q'); writeFileSync(join(dir, '.gitignore'), 'target/\n'); writeFileSync(join(dir, 'input'), 'before'); git('add', '.');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.org', 'commit', '-qm', 'fixture');
    const head = git('rev-parse', 'HEAD');
    const plan = { ...selectAffected([], model), base: head, head, worktree: false, observedFiles: [], inputDigest: createHash('sha256').update('[]').digest('hex'), steps: [
      { id: 'mutates-input', cwd: '.', argv: [process.execPath, '-e', "require('node:fs').writeFileSync('input', 'after')"], timeoutSeconds: 10 },
    ] };
    const { receipt } = await runPlan(plan, { root: dir });
    assert.equal(receipt.results[0].status, 0); assert.equal(receipt.unchanged, false); assert.equal(receipt.ok, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('required target features, diagnostics movement and wasm measurement are selected', () => {
  const featured = { ...model, crates: model.crates.map(crate => ({ ...crate, targets: crate.targets.map(target => ({ ...target, requiredFeatures: ['test-support'] })) })) };
  const testOnly = selectAffected(['snapback4/crates/snapback4-lang/tests/focused.rs'], featured);
  assert(testOnly.steps.find(step => step.id.startsWith('rust:')).argv.includes('test-support'));
  const source = select(['snapback4/crates/snapback4-core/src/moved.rs']);
  for (const check of ['diagnostics', 'inventories', 'wasm-measurement']) assert(source.checks.includes(check));
});
test('packages without owned tests widen to cover sibling consumers', () => {
  const noTests = { ...model, packages: [...model.packages, { name: 'native-package', dir: 'snapback4/packages/native-package', dependencies: [], scripts: {}, tests: [] }] };
  assert(selectAffected(['snapback4/packages/native-package/src/bridge.ts'], noTests).broad);
});
