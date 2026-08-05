import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalizeClientValueV1 } from '../../packages/snapback-client/canonical-client-value.mjs';
import {
  RESULT_TRANSFORM_V1_JAVASCRIPT_EVALUATOR_ID,
  RESULT_TRANSFORM_V1_RETENTION_CLASS,
  RESULT_TRANSFORM_V1_RUST_EVALUATOR_ID,
  RESULT_TRANSFORM_V1_SHIP_GATE,
  evaluateAdmittedResultTransformV1,
} from '../../packages/snapback-client/result-transform.mjs';
import { runResultTransformCaseInJs } from './data-tier/result-transform-v1/js-runner.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CORPUS_DIR = join(ROOT, 'tests/conformance/data-tier/result-transform-v1');
const RECEIPT_PATH = join(ROOT, 'tests/conformance/result-transform-ship-gate-v1.receipt.json');
const RUST_OUTCOMES_PATH = process.env.SNAPBACK_RESULT_TRANSFORM_RUST_OUTCOMES_PATH
  ?? '/private/tmp/snapback-result-transform-rust-outcomes.json';
const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const manifestBytes = readFileSync(join(CORPUS_DIR, 'corpus.manifest.json'));
const manifest = JSON.parse(manifestBytes);
const caseNames = readdirSync(CORPUS_DIR)
  .filter((name) => name.endsWith('.case.json'))
  .sort();
const retainedReceipt = JSON.parse(readFileSync(RECEIPT_PATH, 'utf8'));

if (process.argv.includes('--check')) {
  assert.equal(retainedReceipt.schemaVersion, 'snapback.result-transform-ship-gate.v1');
  assert.equal(retainedReceipt.corpus, manifest.corpus);
  assert.equal(retainedReceipt.corpusFormatVersion, manifest.corpusFormatVersion);
  assert.equal(retainedReceipt.profileVersion, manifest.profileVersion);
  assert.equal(retainedReceipt.corpusManifestSha256, sha256(manifestBytes));
  assert.match(retainedReceipt.rustOutcomes?.sha256 ?? '', /^sha256:[0-9a-f]{64}$/u);
  assert.match(retainedReceipt.rustOutcomes?.producingRevision ?? '', /^[0-9a-f]{40}$/u);
  execFileSync('git', [
    'cat-file', '-e', `${retainedReceipt.rustOutcomes.producingRevision}^{commit}`,
  ], { cwd: ROOT, stdio: 'ignore' });
  assert.deepEqual(retainedReceipt.evaluatorIdentities, RESULT_TRANSFORM_V1_SHIP_GATE.evaluatorIdentities);
  assert.equal(retainedReceipt.evidence.rustCasesExact, caseNames.length);
  assert.equal(retainedReceipt.evidence.rustVsJavascriptByteAgreement, caseNames.length);
  console.log(JSON.stringify({
    status: 'PASS',
    receipt: 'tests/conformance/result-transform-ship-gate-v1.receipt.json',
    rustOutcomesSha256: retainedReceipt.rustOutcomes.sha256,
    producingRevision: retainedReceipt.rustOutcomes.producingRevision,
  }));
} else {
const rustBytes = readFileSync(RUST_OUTCOMES_PATH);
const rust = JSON.parse(rustBytes);
const rustByName = new Map(rust.cases.map((testCase) => [testCase.name, testCase]));
const cases = caseNames
  .map((name) => JSON.parse(readFileSync(join(CORPUS_DIR, name), 'utf8')));

assert.equal(cases.length, 56);
assert.equal(manifest.cases.length, cases.length);
assert.equal(rust.cases.length, cases.length);
assert.equal(rust.evaluatorIdentity, RESULT_TRANSFORM_V1_RUST_EVALUATOR_ID);
assert.equal(manifest.evaluatorIdentities.javascript, RESULT_TRANSFORM_V1_JAVASCRIPT_EVALUATOR_ID);
assert.deepEqual(RESULT_TRANSFORM_V1_SHIP_GATE.evaluatorIdentities, {
  javascript: RESULT_TRANSFORM_V1_JAVASCRIPT_EVALUATOR_ID,
  rust: RESULT_TRANSFORM_V1_RUST_EVALUATOR_ID,
});

const claimingCarriers = [
  { context: 'browser-indexeddb', carrier: { implementation: 'indexeddb', durable: true } },
  { context: 'file-node', carrier: { implementation: 'file', durable: true } },
];
const refusingCarriers = [
  { context: 'memory', carrier: { implementation: 'memory', durable: false } },
  { context: 'expo', carrier: { implementation: 'expo-file-system', durable: false } },
];

for (const testCase of cases) {
  const js = await runResultTransformCaseInJs(testCase);
  const rustCase = rustByName.get(testCase.name);
  assert.ok(rustCase, `${testCase.name}: Rust outcome exists`);
  assert.equal(js.transformHash, rustCase.transformHash, `${testCase.name}: TransformHashV1 agreement`);
  assert.equal(js.outcomeJcs, rustCase.outcomeJcs, `${testCase.name}: exact Rust/JS outcome bytes`);

  const request = {
    plan: testCase.plan,
    executingMaterializationKey: testCase.executingMaterializationKey,
    projectedFields: testCase.projectedFields,
    base: testCase.base,
    ...(Object.hasOwn(testCase, 'clientOverlayRows')
      ? { clientOverlayRows: testCase.clientOverlayRows }
      : {}),
  };
  for (const { context, carrier } of claimingCarriers) {
    let outcome;
    try {
      outcome = {
        status: 'ok',
        rows: evaluateAdmittedResultTransformV1({
          retentionClass: RESULT_TRANSFORM_V1_RETENTION_CLASS,
          carrier,
        }, request),
      };
    } catch (error) {
      outcome = {
        status: 'refused',
        code: error?.code ?? 'SNAPBACK_RESULT_TRANSFORM_UNTYPED_FAILURE',
        reason: error?.reason ?? 'untyped-failure',
      };
    }
    assert.equal(
      canonicalizeClientValueV1(outcome),
      rustCase.outcomeJcs,
      `${context}/${testCase.name}: carrier bytes match Rust`,
    );
  }
  for (const { context, carrier } of refusingCarriers) {
    assert.throws(
      () => evaluateAdmittedResultTransformV1({
        retentionClass: RESULT_TRANSFORM_V1_RETENTION_CLASS,
        carrier,
      }, request),
      { code: 'SNAPBACK_LOCAL_EVALUATION_UNADMITTED' },
      `${context}/${testCase.name}: nonclaiming carrier floor`,
    );
  }
}

const overlayRequest = {
  plan: {
    format: 'snapback.result-transform.v1',
    materializationKey: 'qmk1.ship-gate-overlay',
    overlay: 'apply',
    filterGrammar: 'basic-v1',
    filter: [{ field: 'active', op: 'eq', value: true }],
    order: [{ field: 'rank', direction: 'desc' }],
    limit: 2,
  },
  executingMaterializationKey: 'qmk1.ship-gate-overlay',
  projectedFields: ['id', 'active', 'rank'],
  base: {
    shape: 'row-sequence',
    mode: 'single-page',
    pages: [{
      version: 'stream-v7',
      terminal: true,
      rows: [{ id: 'base', active: true, rank: 1 }],
    }],
  },
  overlayLayers: [
    (rows) => [...rows, { id: 'overlay', active: true, rank: 2 }],
    (rows) => rows.map((row) => (row.id === 'base' ? { ...row, rank: 3 } : row)),
  ],
};
for (const { context, carrier } of claimingCarriers) {
  assert.deepEqual(evaluateAdmittedResultTransformV1({
    retentionClass: RESULT_TRANSFORM_V1_RETENTION_CLASS,
    carrier,
  }, overlayRequest), [
    { id: 'base', active: true, rank: 3 },
    { id: 'overlay', active: true, rank: 2 },
  ], `${context}: client overlay composition`);
}

const receipt = {
  schemaVersion: 'snapback.result-transform-ship-gate.v1',
  date: '2026-08-04',
  corpus: manifest.corpus,
  corpusFormatVersion: manifest.corpusFormatVersion,
  profileVersion: manifest.profileVersion,
  corpusManifestSha256: sha256(manifestBytes),
  rustOutcomes: {
    sha256: sha256(rustBytes),
    producingRevision: process.env.SNAPBACK_RESULT_TRANSFORM_RUST_OUTCOMES_REVISION
      ?? (process.argv.includes('--write')
        ? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
        : retainedReceipt.rustOutcomes.producingRevision),
  },
  evaluatorIdentities: RESULT_TRANSFORM_V1_SHIP_GATE.evaluatorIdentities,
  evidence: {
    rustCasesExact: cases.length,
    javascriptCasesExact: cases.length,
    rustVsJavascriptByteAgreement: cases.length,
    claimingCarriers: claimingCarriers.map(({ context }) => ({ context, casesExact: cases.length })),
    refusingCarriers: refusingCarriers.map(({ context }) => ({
      context,
      floorRefusals: cases.length,
      code: 'SNAPBACK_LOCAL_EVALUATION_UNADMITTED',
    })),
    clientOverlayComposition: claimingCarriers.map(({ context }) => ({ context, status: 'PASS' })),
    unreclassifiedDefault: 'SNAPBACK_LOCAL_EVALUATION_UNADMITTED',
  },
};

if (process.argv.includes('--write')) {
  writeFileSync(RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`);
} else {
  assert.deepEqual(JSON.parse(readFileSync(RECEIPT_PATH, 'utf8')), receipt);
}

console.log(JSON.stringify({
  status: 'PASS',
  receipt: 'tests/conformance/result-transform-ship-gate-v1.receipt.json',
  rustVsJavascript: `${cases.length}/${cases.length}`,
  claimingCarriers: claimingCarriers.map(({ context }) => context),
  refusingCarriers: refusingCarriers.map(({ context }) => context),
  overlays: `${claimingCarriers.length}/${claimingCarriers.length}`,
}));
}
