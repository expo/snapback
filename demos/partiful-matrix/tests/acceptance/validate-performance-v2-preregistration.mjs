#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

import { canonicalizeJson } from './performance-v2-math.mjs';

// @ref LLP 0063#amendment-a1-2026-07-24--prospective-partitime-v2-correctness-baseline-reset
// — freeze and validate the comparator-only v2 protocol before any governed
// post-fix Contract sample can exist.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const acceptanceRoot = resolve(repoRoot, 'demos/partiful-matrix/acceptance');
const exactCheckoutArg = process.argv.indexOf('--exact-checkout');
const exactCheckout = exactCheckoutArg >= 0
  ? resolve(process.argv[exactCheckoutArg + 1] ?? '')
  : process.env.EXACT_CHECKOUT
    ? resolve(process.env.EXACT_CHECKOUT)
    : null;
const requireCrossRepo = process.argv.includes('--require-cross-repo');
const assertPreFreeze = process.argv.includes('--assert-pre-freeze');

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const runGit = (cwd, args) => {
  const result = spawnSync('git', args, {
    cwd,
    encoding: null,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(
    result.status,
    0,
    `git ${args.join(' ')} failed in ${cwd}: ${result.stderr.toString('utf8').trim()}`,
  );
  return result.stdout;
};
const gitShow = (cwd, revision, path) => runGit(cwd, ['show', `${revision}:${path}`]);
const gitObject = (cwd, revision, path) => runGit(cwd, ['rev-parse', `${revision}:${path}`])
  .toString('utf8')
  .trim();

const schemaPath = resolve(acceptanceRoot, 'comparison-protocol.v2.schema.json');
const protocolPath = resolve(acceptanceRoot, 'comparison-protocol.v2.json');
const receiptSchemaPath = resolve(
  repoRoot,
  'demos/partiful-matrix/acceptance/performance-v2-receipt.schema.json',
);
const schemaBytes = readFileSync(schemaPath);
const protocolBytes = readFileSync(protocolPath);
const receiptSchemaBytes = readFileSync(receiptSchemaPath);
const schema = JSON.parse(schemaBytes);
const protocol = JSON.parse(protocolBytes);
const receiptSchema = JSON.parse(receiptSchemaBytes);

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validate = ajv.compile(schema);
assert.ok(validate(protocol), ajv.errorsText(validate.errors, { separator: '\n' }));
const validateReceipt = ajv.compile(receiptSchema);

assert.equal(
  new Set(protocol.metrics.map(({ id }) => id)).size,
  protocol.metrics.length,
  'v2 metric IDs must be unique',
);
assert.deepEqual(
  protocol.metrics.map(({ id }) => id),
  [
    'totalWarmJsHeapBytesP95',
    'fixedWarmJsHeapBytesP95',
    'memoryPerActiveSubscriptionBytesP95',
    'updateFanoutCountP95',
    'domPatchCountP95',
  ],
  'v2 conjunct inventory or ordering drifted',
);
for (const metric of protocol.metrics) {
  assert.equal(metric.conjunct, true, `${metric.id} stopped being conjunctive`);
  assert.equal(
    metric.formula,
    `floor(react_same_workload_${metric.id} * 110 / 100)`,
    `${metric.id} formula is no longer comparator-only`,
  );
}

const canonicalCounts = protocol.workload.subscriptionCounts;
const expectedCountsKey = [...canonicalCounts].sort((a, b) => a - b).join(',');
const schedules = [
  ...protocol.workload.warmupSchedules,
  ...protocol.workload.sampleSchedules,
];
assert.equal(
  new Set(schedules.map((schedule) => schedule.join(','))).size,
  schedules.length,
  'literal schedules must be distinct',
);
for (const [index, schedule] of schedules.entries()) {
  assert.equal(
    [...schedule].sort((a, b) => a - b).join(','),
    expectedCountsKey,
    `schedule ${index + 1} is not an exact permutation`,
  );
}

const localAuthority = protocol.authority.amendments.filter(
  ({ repository }) => repository === 'ccheever/snapback',
);
assert.equal(localAuthority.length, 1, 'expected exactly one Snapback authority binding');
for (const binding of localAuthority) {
  assert.equal(
    sha256(gitShow(repoRoot, binding.revision, binding.path)),
    binding.sha256,
    `Snapback amendment digest mismatch at ${binding.revision}:${binding.path}`,
  );
}

const exactAuthority = protocol.authority.amendments.filter(
  ({ repository }) => repository === 'ccheever/exact',
);
assert.equal(exactAuthority.length, 2, 'expected exactly two Exact authority bindings');
if (requireCrossRepo) {
  assert.ok(exactCheckout, '--require-cross-repo requires --exact-checkout or EXACT_CHECKOUT');
}
if (exactCheckout) {
  assert.ok(existsSync(resolve(exactCheckout, '.git')), 'Exact checkout is not a Git worktree');
  for (const binding of exactAuthority) {
    assert.equal(
      sha256(gitShow(exactCheckout, binding.revision, binding.path)),
      binding.sha256,
      `Exact amendment digest mismatch at ${binding.revision}:${binding.path}`,
    );
  }
}

const collectorManifest = protocol.artifacts.collectorPaths.map((path) => {
  const absolute = resolve(repoRoot, path);
  assert.ok(existsSync(absolute), `frozen collector input is missing: ${path}`);
  return { path, sha256: sha256(readFileSync(absolute)) };
});
const collectorSha256 = sha256(Buffer.from(canonicalizeJson(collectorManifest), 'utf8'));

for (const fixture of protocol.workload.fixtureTrees) {
  assert.equal(
    gitObject(repoRoot, localAuthority[0].revision, fixture.path),
    fixture.gitTree,
    `frozen fixture tree drifted: ${fixture.path}`,
  );
}

const v1 = protocol.authority.preservedV1;
assert.equal(
  sha256(readFileSync(resolve(repoRoot, v1.protocolPath))),
  v1.protocolSha256,
  'preserved v1 protocol bytes drifted',
);
assert.equal(
  sha256(readFileSync(resolve(repoRoot, v1.thresholdSourcePath))),
  v1.thresholdSourceSha256,
  'preserved v1 threshold source drifted',
);
const v1ThresholdSource = readJson(resolve(repoRoot, v1.thresholdSourcePath));
assert.equal(v1ThresholdSource.thresholdId, v1.thresholdSetId);
assert.equal(v1ThresholdSource.workloadVersion, v1.workloadVersion);
assert.equal(v1ThresholdSource.methodId, v1.protocolId);
assert.equal(v1ThresholdSource.thresholdFormulaSetId, v1.thresholdFormulaSetId);

assert.equal(protocol.identities.thresholdSetId, null);
assert.equal(protocol.status, 'preregistered-no-governed-samples');
assert.deepEqual(protocol.authority.phaseOrder, ['P0a', 'P0b', 'P0c']);
assert.ok(
  protocol.targetDerivation.forbiddenInputs.every((input) => !input.startsWith('react:')),
  'React comparator was accidentally forbidden',
);
assert.ok(
  protocol.targetDerivation.forbiddenInputs.some((input) => input.includes('post-fix contract:snapback')),
  'post-fix judged-arm dependency is not forbidden',
);

if (assertPreFreeze) {
  for (const path of [
    protocol.artifacts.thresholdReceiptPath,
    protocol.artifacts.aggregatePath,
    protocol.artifacts.comparatorRawDirectory,
    protocol.artifacts.holdoutRawDirectory,
  ]) {
    assert.equal(existsSync(resolve(repoRoot, path)), false, `pre-freeze artifact already exists: ${path}`);
  }
}

const invalidP0aDirectory = resolve(
  acceptanceRoot,
  'results/performance-v2/invalid',
);
const invalidP0aReceipts = existsSync(invalidP0aDirectory)
  ? readdirSync(invalidP0aDirectory)
    .filter((name) => /^p0a-attempt-\d+\.json$/.test(name))
    .sort()
    .map((name) => {
      const path = resolve(invalidP0aDirectory, name);
      const receipt = readJson(path);
      assert.ok(
        validateReceipt(receipt),
        `${name}: ${ajv.errorsText(validateReceipt.errors, { separator: '\n' })}`,
      );
      assert.equal(receipt.valid, false, `${name} is retained as invalid`);
      assert.equal(receipt.p0a.p0aComplete, false, `${name} cannot complete P0a`);
      assert.equal(
        receipt.p0a.collectorSha256,
        sha256(Buffer.from(canonicalizeJson(receipt.p0a.collectorManifest), 'utf8')),
        `${name} collector manifest digest drifted internally`,
      );
      for (const input of receipt.p0a.collectorManifest) {
        assert.equal(
          sha256(gitShow(repoRoot, receipt.source.snapbackRevision, input.path)),
          input.sha256,
          `${name} retained collector input drifted at its source revision: ${input.path}`,
        );
      }
      return {
        path: `demos/partiful-matrix/acceptance/results/performance-v2/invalid/${name}`,
        sha256: sha256(readFileSync(path)),
        invalidReasons: receipt.invalidReasons,
      };
    })
  : [];

let exactMirrorVerified = false;
if (exactCheckout) {
  const mirrorRoot = resolve(exactCheckout, 'vendor/snapback-partitime');
  const mirrorSourcePath = resolve(mirrorRoot, 'comparison-protocol.v2.source.json');
  if (existsSync(mirrorSourcePath)) {
    const mirrorSource = readJson(mirrorSourcePath);
    assert.equal(mirrorSource.protocolSha256, sha256(protocolBytes));
    assert.equal(mirrorSource.schemaSha256, sha256(schemaBytes));
    assert.equal(mirrorSource.receiptSchemaSha256, sha256(receiptSchemaBytes));
    assert.equal(mirrorSource.collectorRevision, runGit(repoRoot, [
      'log',
      '-1',
      '--format=%H',
      '--',
      ...protocol.artifacts.collectorPaths,
    ]).toString('utf8').trim());
    assert.ok(
      invalidP0aReceipts.some(
        ({ sha256: digest }) => digest === mirrorSource.invalidP0aReceiptSha256,
      ),
      'Exact mirror omitted or drifted its named retained invalid P0a receipt',
    );
    const authorityP0aPath = resolve(
      repoRoot,
      protocol.artifacts.preregistrationReceiptPath,
    );
    if (existsSync(authorityP0aPath)) {
      const authorityP0aBytes = readFileSync(authorityP0aPath);
      assert.equal(
        sha256(gitShow(
          repoRoot,
          mirrorSource.revision,
          protocol.artifacts.preregistrationReceiptPath,
        )),
        mirrorSource.p0aReceiptSha256,
        'Exact mirror source revision does not contain the mirrored valid P0a receipt',
      );
      assert.equal(
        mirrorSource.p0aReceiptSha256,
        sha256(authorityP0aBytes),
        'Exact mirror omitted or drifted the valid P0a receipt',
      );
      assert.equal(
        sha256(readFileSync(resolve(
          mirrorRoot,
          'performance-v2-preregistration.json',
        ))),
        mirrorSource.p0aReceiptSha256,
        'Exact valid P0a mirror bytes differ from the Snapback authority',
      );
    }
    exactMirrorVerified = true;
  }
}

const p0aReceiptPath = resolve(repoRoot, protocol.artifacts.preregistrationReceiptPath);
let p0aReceipt = null;
if (existsSync(p0aReceiptPath)) {
  p0aReceipt = readJson(p0aReceiptPath);
  assert.ok(
    validateReceipt(p0aReceipt),
    ajv.errorsText(validateReceipt.errors, { separator: '\n' }),
  );
  assert.equal(p0aReceipt.valid, true, 'the P0a completion receipt must be valid');
  assert.equal(p0aReceipt.p0a.p0aComplete, true);
  assert.equal(p0aReceipt.p0a.collectorSha256, collectorSha256);
  assert.deepEqual(
    p0aReceipt.p0a.correctnessWitnesses.map(({ arm }) => arm),
    ['react:snapback', 'contract:snapback'],
    'P0a must witness both comparator and holdout control APIs before P0c',
  );
  for (const witness of p0aReceipt.p0a.correctnessWitnesses) {
    assert.deepEqual(
      witness.settledSchedule,
      protocol.workload.warmupSchedules[0],
      `${witness.arm} P0a witness omitted lifecycle churn`,
    );
    assert.equal(witness.contextsVerified, 2);
    assert.equal(witness.teardownActiveSubscriptions, 0);
  }
}

const result = {
  ok: true,
  schemaVersion: 'partitime.performance-v2-preregistration-check.v1',
  protocol: {
    id: protocol.protocolId,
    sha256: sha256(protocolBytes),
    schemaSha256: sha256(schemaBytes),
    receiptSchemaSha256: sha256(receiptSchemaBytes),
    workloadVersion: protocol.workloadVersion,
    thresholdFormulaSetId: protocol.thresholdFormulaSetId,
    thresholdSetId: protocol.identities.thresholdSetId,
  },
  authority: {
    selectedBranch: protocol.authority.selectedBranch,
    phaseOrder: protocol.authority.phaseOrder,
    bindings: protocol.authority.amendments,
    localBindingsVerified: localAuthority.length,
    exactBindingsVerified: exactCheckout ? exactAuthority.length : 0,
    exactCheckout: exactCheckout ? realpathSync(exactCheckout) : null,
  },
  preservedV1: {
    protocolSha256: v1.protocolSha256,
    thresholdSourceSha256: v1.thresholdSourceSha256,
    thresholdSetId: v1.thresholdSetId,
  },
  schedules: {
    warmups: protocol.workload.warmupSchedules.length,
    samples: protocol.workload.sampleSchedules.length,
    counts: canonicalCounts,
    distinctPermutations: schedules.length,
  },
  collector: {
    sha256: collectorSha256,
    files: collectorManifest,
  },
  retainedInvalidP0a: invalidP0aReceipts,
  exactMirrorVerified,
  governedSamplesCollected: false,
  p0aComplete: p0aReceipt !== null,
  remainingP0aInputs: p0aReceipt === null
    ? ['valid immutable pre-fix correctness receipt']
    : [],
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
