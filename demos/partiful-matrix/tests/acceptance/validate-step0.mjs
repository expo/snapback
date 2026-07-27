import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

import { manifestSemanticSha256, sha256 } from './manifest-semantics.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const demoRoot = resolve(here, '..', '..');
const acceptanceRoot = join(demoRoot, 'acceptance');
const repoRoot = resolve(demoRoot, '..', '..');
const requirePassing = process.argv.includes('--require-passing');
const structuralOnly = process.argv.includes('--structural-only');
const readJson = (name) => JSON.parse(readFileSync(join(acceptanceRoot, name), 'utf8'));
const lineCount = (bytes) => {
  if (bytes.length === 0) return 0;
  const text = bytes.toString('utf8');
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
};
const safeRepoPath = (repoRelativePath, label = repoRelativePath) => {
  assert.equal(isAbsolute(repoRelativePath), false, `${label} must be repository-relative`);
  const path = resolve(repoRoot, repoRelativePath);
  const lexicalRelative = relative(repoRoot, path);
  assert.ok(lexicalRelative !== '' && !lexicalRelative.startsWith('..'), `${label} escapes the repository`);
  let cursor = repoRoot;
  for (const segment of lexicalRelative.split(/[\\/]/)) {
    cursor = join(cursor, segment);
    assert.ok(existsSync(cursor), `${label} is missing: ${repoRelativePath}`);
    assert.equal(lstatSync(cursor).isSymbolicLink(), false, `${label} may not traverse a symlink: ${repoRelativePath}`);
  }
  const realRelative = relative(realpathSync(repoRoot), realpathSync(path));
  assert.ok(!realRelative.startsWith('..') && !isAbsolute(realRelative), `${label} resolves outside the repository`);
  return path;
};

const schema = readJson('claims.schema.json');
const claimsBytes = readFileSync(join(acceptanceRoot, 'claims.v1.json'));
const manifest = JSON.parse(claimsBytes);
const protocol = readJson('comparison-protocol.v1.json');
const lock = readFileSync(join(acceptanceRoot, 'claims.v1.sha256'), 'utf8').trim();

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validate = ajv.compile(schema);
assert.ok(validate(manifest), ajv.errorsText(validate.errors, { separator: '\n' }));

const ids = manifest.claims.map(({ id }) => id);
assert.equal(new Set(ids).size, ids.length, 'claim IDs must be unique');
const known = new Set(ids);
for (const [outcome, value] of Object.entries(manifest.outcomes)) {
  for (const id of value.mandatoryClaimIds) {
    assert.ok(known.has(id), `${outcome} names an unknown mandatory claim: ${id}`);
  }
}

assert.equal(protocol.workloadVersion, manifest.workloadVersion, 'protocol and manifest workload versions differ');
assert.equal(protocol.claimManifest, manifest.authority.path, 'protocol does not consume the authoritative manifest path');
assert.match(protocol.protocolId, /^partitime-method-rubric-v\d+$/);
assert.equal(lock, sha256(claimsBytes), 'claims.v1.sha256 does not match authoritative manifest bytes');
const bundlePath = resolve(
  repoRoot,
  manifest.authority.distribution.bundlePathTemplate.replace('{sha256}', lock),
);
assert.ok(existsSync(bundlePath), `content-addressed manifest bundle is missing: ${relative(repoRoot, bundlePath)}`);
assert.deepEqual(readFileSync(bundlePath), claimsBytes, 'content-addressed manifest bundle differs from the authority bytes');
for (const [kind, pathKey, digestKey, bundleKey] of [
  ['schema', 'schemaPath', 'schemaSha256', 'schemaBundlePathTemplate'],
  ['protocol', 'protocolPath', 'protocolSha256', 'protocolBundlePathTemplate'],
]) {
  const source = readFileSync(resolve(repoRoot, manifest.authority.distribution[pathKey]));
  assert.equal(sha256(source), manifest.authority.distribution[digestKey], `${kind} authority digest drifted`);
  const distributed = resolve(repoRoot, manifest.authority.distribution[bundleKey].replace('{sha256}', lock));
  assert.ok(existsSync(distributed), `content-addressed ${kind} bundle is missing`);
  assert.deepEqual(readFileSync(distributed), source, `content-addressed ${kind} bundle differs from its authority`);
}

const artifactReports = new Map();
for (const claim of manifest.claims) {
  if (claim.status === 'passing') {
    assert.notEqual(claim.artifact, null, `${claim.id} is passing without a committed artifact`);
  }
  if (claim.artifact === null) continue;
  assert.equal(isAbsolute(claim.artifact.path), false, `${claim.id} artifact path must be repository-relative`);
  const artifactPath = safeRepoPath(claim.artifact.path, `${claim.id} artifact`);
  assert.equal(
    sha256(readFileSync(artifactPath)),
    claim.artifact.sha256,
    `${claim.id} artifact digest does not match ${claim.artifact.path}`,
  );
  if (artifactPath.endsWith('.json')) {
    artifactReports.set(claim.id, JSON.parse(readFileSync(artifactPath, 'utf8')));
  }
}

const reportFor = (id) => {
  const report = artifactReports.get(id);
  assert.ok(report, `${id} has no readable JSON artifact`);
  return report;
};
const validateInventory = (inventory, label) => {
  assert.ok(Array.isArray(inventory) && inventory.length > 0, `${label} inventory is empty`);
  for (const entry of inventory) {
    assert.equal(
      sha256(readFileSync(safeRepoPath(entry.path, `${label} input`))),
      entry.sha256,
      `${label} input drifted: ${entry.path}`,
    );
  }
};
const identityAtRevision = (path, revision) => {
  safeRepoPath(path, `historical input at ${revision}`);
  const child = spawnSync('git', ['show', `${revision}:${path}`], {
    cwd: repoRoot,
    encoding: null,
  });
  assert.equal(
    child.status,
    0,
    `git show ${revision}:${path} failed: ${child.stderr?.toString('utf8')}`,
  );
  return { path, sha256: sha256(child.stdout) };
};
const passing = new Set(manifest.claims.filter(({ status }) => status === 'passing').map(({ id }) => id));
for (const id of [
  'STEP0.V0_DIAGNOSTICS', 'STEP0.V0_RESET_SEED', 'STEP0.V0_ATOMIC_SUBSCRIBE',
  'STEP0.V0_DELIVERY_CONTROL', 'STEP0.V0_CAPABILITY_GAPS', 'STEP0.V0_ARTIFACT_FRESHNESS',
]) {
  if (!passing.has(id)) continue;
  const report = reportFor(id);
  assert.equal(report.ok, true, `${id} v0 aggregate did not pass`);
  assert.ok(report.claimIds.includes(id), `${id} is absent from its v0 aggregate receipt`);
  assert.equal(report.executedCommandCount, report.requiredCommandCount, `${id} aggregate was short`);
  assert.equal(report.children.length, 1, `${id} aggregate lacks its Todo child receipt`);
  const todoChild = report.children[0];
  const todoPath = resolve(repoRoot, todoChild.path);
  assert.ok(existsSync(todoPath), `${id} Todo child receipt is missing`);
  assert.equal(sha256(readFileSync(todoPath)), todoChild.sha256, `${id} Todo child receipt drifted`);
  assert.equal(todoChild.total, 24, `${id} Todo child receipt did not run 24 checks`);
  assert.equal(todoChild.expectedChecks, 24, `${id} Todo child expected-check count drifted`);
  assert.equal(todoChild.schemaVersion, 'snapback.todo-v0-receipt.v1', `${id} Todo child schema drifted`);
  validateInventory(report.testInventory, `${id} v0`);
}

if (passing.has('STEP0.REQUIRED_SKIP_NONPASS')) {
  const report = reportFor('STEP0.REQUIRED_SKIP_NONPASS');
  assert.equal(report.ok, false, 'required-prerequisite skip was incorrectly reported as pass');
  assert.equal(report.outcome, 'skip', 'required-prerequisite receipt did not report skip');
  assert.equal(report.skipClass, 'required-prerequisite-missing');
  assert.ok(report.expectedChecks > 0, 'skip witness declared no required checks');
  assert.equal(report.total, 0, 'synthetic prerequisite skip unexpectedly ran checks');
  assert.equal(report.witness.exitStatus, 1, 'skip witness did not retain the required nonzero exit');
  assert.equal(report.witness.signal, null, 'skip witness child was signaled');
  validateInventory(report.witnessInventory, 'required-prerequisite skip');
  assert.equal(
    report.artifacts.diarySha256,
    sha256(readFileSync(join(repoRoot, 'diaries/0016-partiful-matrix.diary.md'))),
    'skip witness diary identity drifted',
  );
  assert.equal(
    report.artifacts.reportSha256,
    sha256(readFileSync(join(demoRoot, 'REPORT.md'))),
    'skip witness report identity drifted',
  );
}

const webClaimIds = ['STEP0.WEB_RENDERING', 'STEP0.WEB_RSVP_CONVERGENCE', 'STEP0.SNAPBACK_PUSH_PROVENANCE', 'STEP0.PACKAGE_PROVENANCE'];
if (webClaimIds.some((id) => passing.has(id))) {
  const report = reportFor(webClaimIds.find((id) => passing.has(id)));
  assert.equal(report.ok, true, 'web matrix receipt did not pass');
  assert.equal(report.expectedChecks, 43, 'web matrix did not declare the complete 43-check gate');
  assert.equal(report.total, 43, 'web matrix receipt is short');
  assert.equal(report.failed, 0, 'web matrix contains failed checks');
  assert.equal(report.passed + report.skipped, 43, 'web matrix outcomes do not cover all checks');
  assert.equal(report.cleanupErrorCount, 0, 'web matrix cleanup failed');
  assert.equal(new Set(report.cells).size, 12, 'web matrix does not cover twelve distinct cells');
  assert.match(report.revision.snapback, /^[a-f0-9]{40}$/, 'web receipt lacks a Snapback revision');
  assert.match(report.revision.exact, /^[a-f0-9]{40}$/, 'web receipt lacks an Exact revision');
  assert.equal(report.workloadVersion, manifest.workloadVersion, 'web receipt workload drifted');
  assert.equal(report.methodId, protocol.protocolId, 'web receipt method drifted');
  assert.equal(report.thresholdFormulaSetId, protocol.thresholdFormulaSetId, 'web receipt threshold formulas drifted');
  assert.ok(report.environment.chromeVersion, 'web receipt lacks the Chrome version');
  assert.ok(report.environment.cpu, 'web receipt lacks the CPU identity');
  assert.ok(report.environment.totalMemoryBytes > 0, 'web receipt lacks the memory identity');
  for (const [arm, identity] of Object.entries(report.packages ?? {})) {
    const lockPath = resolve(repoRoot, identity.lockPath);
    assert.ok(existsSync(lockPath), `${arm} receipt lock is missing: ${identity.lockPath}`);
    assert.equal(sha256(readFileSync(lockPath)), identity.lockSha256, `${arm} receipt lock digest drifted`);
    assert.ok(Object.keys(identity.dependencies).length > 0, `${arm} receipt lacks package identities`);
    assert.deepEqual(Object.keys(identity.resolvedDependencies).sort(), Object.keys(identity.dependencies).sort());
    for (const [name, dependency] of Object.entries(identity.resolvedDependencies)) {
      assert.ok(dependency.resolvedName, `${arm}/${name} lacks a resolved package name`);
      assert.ok(dependency.resolvedVersion, `${arm}/${name} lacks a resolved package version`);
    }
  }
  assert.deepEqual(Object.keys(report.packages ?? {}).sort(), ['contract', 'react', 'vanilla']);
  assert.ok(report.testInventory.length >= 12, 'web receipt lacks the harness/arm test inventory');
  for (const entry of report.testInventory) {
    assert.equal(sha256(readFileSync(resolve(repoRoot, entry.path))), entry.sha256, `web test input drifted: ${entry.path}`);
  }
  assert.equal(sha256(JSON.stringify(report.testInventory)), report.testInventorySha256, 'web test inventory digest drifted');
  for (const result of report.results.filter(({ outcome }) => outcome === 'skip')) {
    assert.equal(result.details.skipClass, 'remote-dependency', `${result.name} has an invalid skip class`);
    assert.ok(['supabase', 'convex'].includes(result.details.backend), `${result.name} skipped a local backend`);
    assert.equal(result.details.health.ok, false, `${result.name} skipped a healthy backend`);
  }
  assert.equal(
    report.artifacts.diarySha256,
    sha256(readFileSync(join(repoRoot, 'diaries/0016-partiful-matrix.diary.md'))),
    'Partitime diary changed after the web receipt',
  );
  assert.equal(
    report.artifacts.reportSha256,
    sha256(readFileSync(join(demoRoot, 'REPORT.md'))),
    'Partitime report changed after the web receipt',
  );
  if (passing.has('STEP0.WEB_RSVP_CONVERGENCE')) {
    const convergence = report.results.filter(
      ({ name, outcome }) => name.endsWith('opens details and observes RSVP')
        && outcome !== 'skip',
    );
    const healthyCells = report.cells.filter((cell) => {
      const backend = cell.split(':')[1];
      return report.backendHealth.backends?.[backend]?.ok === true;
    });
    assert.equal(convergence.length, healthyCells.length, 'web matrix lacks RSVP convergence for a healthy cell');
    for (const result of convergence) {
      assert.equal(result.ok, true, `${result.name} did not pass`);
      assert.equal(result.details.actor, 'user_eve', `${result.name} used the wrong deterministic actor`);
      assert.notEqual(result.details.before, result.details.after, `${result.name} observed no state transition`);
    }
  }
  if (passing.has('STEP0.SNAPBACK_PUSH_PROVENANCE')) {
    const push = report.results.filter(({ name }) => name.endsWith('proves unsolicited push with polling fallback disabled'));
    assert.equal(push.length, 3, 'web matrix lacks the three Snapback push witnesses');
    for (const result of push) {
      assert.equal(result.ok, true, `${result.name} did not pass`);
      assert.equal(result.details.pollFallback, 'disabled', `${result.name} did not disable fallback`);
      assert.equal(typeof result.details.connectionBefore, 'string', `${result.name} lacks a pre-mutation connection state`);
      assert.match(
        result.details.connectionBefore,
        /(?:^|[^a-z])live(?:[^a-z]|$)/i,
        `${result.name} was not live before mutation`,
      );
      assert.ok(
        result.details.established.some((event) => event.queryName === 'guestList' && event.transport === 'push'),
        `${result.name} lacks guestList push provenance`,
      );
      assert.equal(result.details.warmupCount, 2, `${result.name} has the wrong push warmup count`);
      assert.equal(result.details.sampleCount, 7, `${result.name} has the wrong push sample count`);
      assert.equal(result.details.observations.length, 9, `${result.name} lacks warmups plus samples`);
      assert.equal(result.details.freshnessLatencyMs.samples.length, 7, `${result.name} lacks push latency samples`);
      assert.ok(result.details.freshnessLatencyMs.samples.every((value) => Number.isFinite(value) && value >= 0));
    }
  }
}

if (passing.has('STEP0.VANILLA_LIFECYCLE')) {
  const report = reportFor('STEP0.VANILLA_LIFECYCLE');
  assert.equal(report.ok, true, 'vanilla lifecycle oracle did not pass');
  assert.equal(report.total, 5, 'vanilla lifecycle oracle was short');
  assert.equal(report.expectedChecks, 5, 'vanilla lifecycle expected-check count drifted');
  assert.equal(report.cleanupErrorCount, 0, 'vanilla lifecycle cleanup failed');
  validateInventory(report.testInventory, 'vanilla lifecycle');
}

if (passing.has('STEP0.NO_EXACT_CORE')) {
  const report = reportFor('STEP0.NO_EXACT_CORE');
  assert.equal(report.ok, true, 'no-Exact-core receipt did not pass');
  assert.equal(report.claimId, 'STEP0.NO_EXACT_CORE');
  assert.ok(report.results.length > 0 && report.results.every(({ status }) => status === 0), 'no-Exact-core suite was short or failed');
  validateInventory(report.testInventory, 'no-Exact-core');
}

if (passing.has('STEP0.NATIVE_BASELINE')) {
  const report = reportFor('STEP0.NATIVE_BASELINE');
  assert.equal(report.schemaVersion, 'partitime.native-baseline-aggregate.v1');
  assert.equal(report.ok, true, 'native baseline aggregate did not pass');
  assert.equal(report.outcome, 'pass', 'native baseline aggregate outcome is not pass');
  assert.equal(report.workloadVersion, manifest.workloadVersion, 'native workload drifted');
  assert.equal(report.methodId, protocol.protocolId, 'native method drifted');
  assert.equal(report.thresholdFormulaSetId, protocol.thresholdFormulaSetId, 'native threshold formulas drifted');
  assert.equal(report.children.length, 2, 'native baseline does not contain both authoring systems');
  assert.equal(report.cells.length, 16, 'native baseline did not retain sixteen cells');
  assert.equal(new Set(report.cells.map(({ cell }) => cell)).size, 16, 'native baseline contains duplicate cells');
  assert.ok(
    report.cells.every(({ ok, outcome, skipClass }) =>
      ok || (outcome === 'skip' && skipClass === 'remote-dependency')
    ),
    'native baseline contains a non-remote failure',
  );
  for (const child of report.children) {
    const path = resolve(repoRoot, child.path);
    assert.ok(existsSync(path), `native child receipt is missing: ${child.path}`);
    assert.equal(sha256(readFileSync(path)), child.sha256, `${child.name} native child receipt drifted`);
    assert.match(child.binaries.macosSha256, /^[a-f0-9]{64}$/);
    assert.match(child.binaries.iosSha256, /^[a-f0-9]{64}$/);
    assert.ok(child.source, `${child.name} native child lacks source identity`);
    assert.ok(child.packages, `${child.name} native child lacks package identity`);
    assert.ok(child.environment?.os, `${child.name} native child lacks environment identity`);
    assert.ok(child.testInventory?.length > 0, `${child.name} native child lacks test inventory`);
    const sourceRevision = child.source.snapbackRevision ?? child.source.snapback?.revision;
    assert.match(
      sourceRevision ?? '',
      /^[a-f0-9]{40}$/,
      `${child.name} native child lacks its immutable Snapback source revision`,
    );
    for (const entry of child.testInventory) {
      assert.deepEqual(
        identityAtRevision(entry.path, sourceRevision),
        entry,
        `native test input drifted at ${sourceRevision}: ${entry.path}`,
      );
    }
  }
}

if (passing.has('STEP0.COMPARISON_PROTOCOL')) {
  const artifact = reportFor('STEP0.COMPARISON_PROTOCOL');
  assert.deepEqual(artifact, protocol, 'comparison-protocol artifact does not match the validator input');
}

if (passing.has('STEP0.ATTRIBUTION_BASELINE')) {
  const report = reportFor('STEP0.ATTRIBUTION_BASELINE');
  assert.equal(report.methodId, protocol.protocolId, 'attribution method differs from preregistered protocol');
  assert.equal(report.thresholdFormulaSetId, protocol.thresholdFormulaSetId, 'attribution threshold formulas drifted');
  assert.equal(report.workloadVersion, manifest.workloadVersion, 'attribution workload differs from manifest');
  assert.equal(
    report.inputs.claimManifestSemanticSha256,
    manifestSemanticSha256(manifest),
    'attribution claim-manifest semantics drifted',
  );
  const webReceiptPath = join(acceptanceRoot, 'results', 'step0-web.json');
  assert.equal(report.inputs.webReceiptSha256, sha256(readFileSync(webReceiptPath)), 'attribution web receipt drifted');
  assert.match(report.thresholdId, /^partitime-thresholds-v\d+-sha256-[a-f0-9]{16}$/);
  assert.equal(report.thresholds.requiredWebCheckCount, 43);
  assert.equal(report.pushLatency.react.samples.length, 7);
  for (const group of Object.values(report.sourceInventory)) {
    for (const file of group.files) {
      const bytes = readFileSync(join(demoRoot, file.path));
      assert.equal(sha256(bytes), file.sha256, `attribution source drifted: ${file.path}`);
      assert.equal(bytes.length, file.bytes, `attribution byte count drifted: ${file.path}`);
      assert.equal(lineCount(bytes), file.lines, `attribution line count drifted: ${file.path}`);
    }
    assert.equal(group.totalLines, group.files.reduce((sum, file) => sum + file.lines, 0));
  }
  for (const group of Object.values(report.glueInventory)) {
    assert.ok(group.files.length > 0, 'glue inventory group is empty');
    assert.equal(group.totalLines, group.files.reduce((sum, file) => sum + file.lines, 0));
  }
  for (const cell of Object.values(report.cells)) {
    for (const asset of cell.assets) {
      assert.equal(sha256(readFileSync(resolve(repoRoot, asset.path))), asset.sha256, `attribution asset drifted: ${asset.path}`);
    }
  }
  const expectedThresholds = {
    emittedMinifiedJsBytes: Object.fromEntries(['snapback', 'supabase', 'convex', 'sqlite'].map(
      (backend) => [backend, Math.floor(report.cells[`react:${backend}`].minifiedBytes * 1.05)],
    )),
    compressedJsBytes: Object.fromEntries(['snapback', 'supabase', 'convex', 'sqlite'].map(
      (backend) => [backend, Math.floor(report.cells[`react:${backend}`].deterministicGzipBytes * 1.05)],
    )),
    contractSourceLines: Math.floor(report.sourceInventory.react.totalLines * 1.10),
    snapbackBackendLines: Math.floor(report.sourceInventory.snapbackBackend.totalLines * 0.80),
    requiredWebCheckCount: 43,
    firstPushFreshnessLatencyMsP95: Math.floor(report.pushLatency.react.p95 * 1.10),
  };
  assert.deepEqual(
    report.currentFormulaThresholds,
    expectedThresholds,
    'current formula-computed thresholds drifted',
  );
  const thresholdFreezeSource = report.inputs.thresholdFreezeSource;
  if (thresholdFreezeSource === null) {
    assert.deepEqual(report.thresholds, expectedThresholds, 'initial formula-computed thresholds drifted');
  } else {
    assert.equal(
      thresholdFreezeSource.path,
      'demos/partiful-matrix/acceptance/results/step0-attribution.json',
      'threshold freeze source path drifted',
    );
    assert.match(
      thresholdFreezeSource.revision,
      /^[a-f0-9]{40}$/,
      'threshold freeze source revision is not immutable',
    );
    const frozen = spawnSync(
      'git',
      ['show', `${thresholdFreezeSource.revision}:${thresholdFreezeSource.path}`],
      { cwd: repoRoot, encoding: null },
    );
    assert.equal(
      frozen.status,
      0,
      `threshold freeze source is unreadable: ${frozen.stderr?.toString('utf8')}`,
    );
    assert.equal(
      sha256(frozen.stdout),
      thresholdFreezeSource.sha256,
      'threshold freeze source digest drifted',
    );
    const baseline = JSON.parse(frozen.stdout.toString('utf8'));
    assert.equal(baseline.schemaVersion, 'partitime.attribution.v1');
    assert.equal(baseline.workloadVersion, report.workloadVersion);
    assert.equal(baseline.methodId, report.methodId);
    assert.equal(baseline.thresholdFormulaSetId, report.thresholdFormulaSetId);
    assert.deepEqual(report.thresholds, baseline.thresholds, 'frozen thresholds drifted');
    assert.equal(report.thresholdId, baseline.thresholdId, 'frozen threshold ID drifted');
  }
  assert.equal(
    report.thresholdId,
    `partitime-thresholds-v1-sha256-${sha256(JSON.stringify(report.thresholds)).slice(0, 16)}`,
    'threshold ID does not identify the retained thresholds',
  );
  assert.deepEqual(protocol.initialAttributionCategories, [
    'emittedMinifiedJsBytes', 'compressedJsBytes', 'authoredSourceLines',
    'glueFileAndLineInventory', 'requiredCheckCount', 'firstPushFreshnessLatencyMsP95',
  ]);
}

if (!structuralOnly && passing.has('STEP0.SHARED_MANIFEST')) {
  const report = reportFor('STEP0.SHARED_MANIFEST');
  assert.equal(report.schemaVersion, 'partitime.shared-manifest-contract.v1');
  assert.equal(report.claimId, 'STEP0.SHARED_MANIFEST');
  assert.equal(report.ok, true, 'shared-manifest contract did not pass');
  assert.equal(report.manifestId, manifest.manifestId);
  assert.equal(report.workloadVersion, manifest.workloadVersion);
  assert.equal(report.manifestSemanticSha256, manifestSemanticSha256(manifest));
  assert.deepEqual(report.authority.changeControl, manifest.authority.changeControl);
  assert.equal(
    report.authority.distribution.exactMirrorAggregatePath,
    manifest.authority.distribution.exactMirrorAggregatePath,
  );
  for (const entry of [
    report.validators.snapback,
    report.siblingPlans.snapback,
    report.inputs.semantics,
    report.inputs.schema,
    report.inputs.protocol,
  ]) {
    assert.equal(
      sha256(readFileSync(resolve(repoRoot, entry.path))),
      entry.sha256,
      `shared-manifest input drifted: ${entry.path}`,
    );
  }
  assert.match(report.exact.revision, /^[a-f0-9]{40}$/);
  assert.equal(report.exact.dirty, false);
  assert.equal(report.validators.exactAggregate.registeredCheckId, 'snapback-partitime-step0-aggregate');
  assert.equal(report.validators.exactAggregate.resultSchemaVersion, 'partitime.exact-step0-aggregate-validation.v1');
}

if (!structuralOnly && passing.has('STEP0.COMPLETE')) {
  const report = reportFor('STEP0.COMPLETE');
  assert.equal(report.schemaVersion, 'partitime.step0-complete.v1');
  assert.equal(report.claimId, 'STEP0.COMPLETE');
  assert.equal(report.ok, true, 'Step 0 aggregate did not pass');
  assert.equal(report.outcome, 'pass');
  assert.equal(report.manifestId, manifest.manifestId);
  assert.equal(report.workloadVersion, manifest.workloadVersion);
  assert.equal(report.manifestSemanticSha256, manifestSemanticSha256(manifest));
  assert.equal(report.methodId, protocol.protocolId);
  assert.equal(report.thresholdFormulaSetId, protocol.thresholdFormulaSetId);
  const expected = manifest.claims
    .filter(({ step, id }) => step === 0 && id !== 'STEP0.COMPLETE')
    .map(({ id, witnessClass, artifact }) => ({ id, witnessClass, artifact }));
  assert.equal(report.prerequisiteCount, expected.length);
  assert.deepEqual(report.prerequisites, expected, 'Step 0 aggregate prerequisites drifted');
  assert.deepEqual(
    report.nativeChildren,
    reportFor('STEP0.NATIVE_BASELINE').children
      .map(({ name, path, sha256: digest }) => ({ name, path, sha256: digest })),
    'Step 0 aggregate native children drifted',
  );
  assert.equal(
    sha256(readFileSync(resolve(repoRoot, report.sharedManifestContract.path))),
    report.sharedManifestContract.sha256,
    'Step 0 aggregate shared-manifest receipt drifted',
  );
  for (const entry of Object.values(report.inputs)) {
    assert.equal(
      sha256(readFileSync(resolve(repoRoot, entry.path))),
      entry.sha256,
      `Step 0 aggregate input drifted: ${entry.path}`,
    );
  }
}

for (const [id, platform] of [
  ['STEP2.CONTRACT_IOS_PARITY', 'ios'],
  ['STEP2.CONTRACT_ANDROID_PARITY', 'android'],
]) {
  if (!passing.has(id)) continue;
  const report = reportFor(id);
  assert.equal(report.schemaVersion, 'partitime.step2-exact-native-import.v1');
  assert.equal(report.claimId, id);
  assert.equal(report.profileId, `exact-native/${platform}`);
  assert.equal(report.capabilityClass, 'Parity');
  assert.equal(report.ok, true, `${id} import did not pass`);
  assert.equal(report.outcome, 'pass');
  assert.match(report.exact.receiptRevision, /^[a-f0-9]{40}$/);
  assert.match(report.exact.sourceRevision, /^[a-f0-9]{40}$/);
  assert.equal(report.exact.checkId, `exact-partitime-native-${platform}`);
  assert.equal(report.receipt.profileId, report.profileId);
  assert.equal(report.receipt.ok, true);
  assert.equal(report.receipt.carrierReceipt.mask, 0x7ff);
  assert.equal(report.validation.factCount, 12);
  assert.ok(report.validation.sourceCount > 0);
  assert.equal(report.validation.sourceGraphSha256, report.receipt.sourceGraph.sha256);
  assert.deepEqual(report.validation.lifecycleMasks, [0x1ff, 0x3ff, 0x7ff]);
  assert.ok(Object.values(report.receipt.facts).every(Boolean), `${id} contains a failed Parity fact`);
  validateInventory(report.verifierInventory, `${id} verifier`);
}

const stepZero = manifest.claims.filter(({ step }) => step === 0);
if (requirePassing) {
  assert.equal(structuralOnly, false, '--require-passing may not be combined with --structural-only');
  const incomplete = stepZero.filter(({ status }) => status !== 'passing');
  assert.deepEqual(incomplete.map(({ id, status }) => ({ id, status })), [], 'Step 0 still has non-passing claims');
  const crossPath = join(acceptanceRoot, 'results', 'step0-cross-repo-validation.json');
  assert.ok(existsSync(crossPath), 'cross-repository Step 0 validation receipt is missing');
  const cross = JSON.parse(readFileSync(crossPath, 'utf8'));
  assert.equal(cross.schemaVersion, 'partitime.cross-repo-step0-validation.v1');
  assert.equal(cross.ok, true, 'cross-repository Step 0 validation did not pass');
  assert.equal(cross.manifestId, manifest.manifestId);
  assert.equal(cross.manifestSha256, lock, 'cross-repository receipt names a different final manifest');
  assert.equal(cross.stepZeroClaimCount, stepZero.length);
  assert.match(cross.exact.revision, /^[a-f0-9]{40}$/);
  assert.equal(cross.exact.dirty, false);
  for (const entry of [
    cross.validators.snapback,
    cross.validators.crossRepository,
    cross.validators.semantics,
    cross.siblingPlans.snapback,
  ]) {
    assert.equal(
      sha256(readFileSync(resolve(repoRoot, entry.path))),
      entry.sha256,
      `cross-repository input drifted: ${entry.path}`,
    );
  }
  const shared = reportFor('STEP0.SHARED_MANIFEST');
  assert.deepEqual(cross.siblingPlans, shared.siblingPlans, 'cross-repository sibling Plans differ from the shared contract');
  assert.equal(cross.sharedContractExactRevision, shared.exact.revision);
  assert.deepEqual(cross.validators.exactManifest, shared.validators.exact);
  assert.deepEqual(cross.validators.exactAggregate, shared.validators.exactAggregate);
  assert.deepEqual(cross.validators.exactRegistry, shared.validators.exact.registry);
  assert.equal(cross.results.snapback.validationOk, true);
  assert.equal(cross.results.snapback.digest, lock);
  assert.equal(cross.results.exactManifest.ok, true);
  assert.equal(cross.results.exactManifest.digest, lock);
  assert.equal(cross.results.exactManifest.schemaSha256, manifest.authority.distribution.schemaSha256);
  assert.equal(cross.results.exactManifest.protocolSha256, manifest.authority.distribution.protocolSha256);
  assert.equal(cross.results.exactAggregate.ok, true);
  assert.equal(cross.results.exactAggregate.manifestDigest, lock);
  assert.equal(cross.results.exactAggregate.manifestSemanticSha256, manifestSemanticSha256(manifest));
  assert.equal(
    cross.results.exactAggregate.aggregateSha256,
    manifest.claims.find(({ id }) => id === 'STEP0.COMPLETE').artifact.sha256,
  );
  const expectedMirrors = {
    manifest: [manifest.authority.path, manifest.authority.distribution.exactMirrorPath],
    lock: [manifest.authority.distribution.lockPath, manifest.authority.distribution.exactMirrorLockPath],
    schema: [manifest.authority.distribution.schemaPath, manifest.authority.distribution.exactMirrorSchemaPath],
    protocol: [manifest.authority.distribution.protocolPath, manifest.authority.distribution.exactMirrorProtocolPath],
    aggregate: [
      'demos/partiful-matrix/acceptance/results/step0-complete.json',
      manifest.authority.distribution.exactMirrorAggregatePath,
    ],
  };
  for (const [kind, [sourcePath, exactPath]] of Object.entries(expectedMirrors)) {
    assert.equal(cross.mirrors[kind].source.path, sourcePath);
    assert.equal(cross.mirrors[kind].exactPath, exactPath);
    assert.equal(
      cross.mirrors[kind].source.sha256,
      sha256(readFileSync(safeRepoPath(sourcePath, `cross-repository ${kind} source`))),
    );
  }
}

console.log(JSON.stringify({
  schemaVersion: 'partitime.claim-manifest-validation.v1',
  validationOk: true,
  manifestId: manifest.manifestId,
  workloadVersion: manifest.workloadVersion,
  digest: lock,
  claims: manifest.claims.length,
  stepZero: Object.fromEntries(
    [...new Set(stepZero.map(({ status }) => status))]
      .map((status) => [status, stepZero.filter((claim) => claim.status === status).length]),
  ),
  requirePassing,
  structuralOnly,
}));
