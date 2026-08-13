// Regen-and-diff, JavaScript execution, and client-overlay composition proof
// for the LLP 0051 D5 result-transform.v1 extension.
//
// Usage:
//   node packages/snapback-client/result-transform.test.mjs --write
//   node packages/snapback-client/result-transform.test.mjs

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { canonicalizeClientValueV1 } from './canonical-client-value.mjs';
import { SnapbackClient } from './index.mjs';
import {
  RESULT_TRANSFORM_V1_JAVASCRIPT_EVALUATOR_ID,
  RESULT_TRANSFORM_V1_RETENTION_CLASS,
  RESULT_TRANSFORM_V1_RUST_EVALUATOR_ID,
  RESULT_TRANSFORM_V1_SHIP_GATE,
  evaluateAdmittedResultTransformV1,
  transformHashV1,
} from './result-transform.mjs';
import {
  RESULT_TRANSFORM_CORPUS_NAME,
  RESULT_TRANSFORM_CORPUS_VERSION,
  buildResultTransformCorpusCases,
} from '../../tests/conformance/data-tier/result-transform-v1/corpus-source.mjs';
import { runResultTransformCaseInJs } from '../../tests/conformance/data-tier/result-transform-v1/js-runner.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CORPUS_DIR = join(ROOT, 'tests', 'conformance', 'data-tier', 'result-transform-v1');
const MANIFEST_PATH = join(CORPUS_DIR, 'corpus.manifest.json');
const WRITE = process.argv.includes('--write');
const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const claimingCarriers = Object.freeze([
  Object.freeze({ implementation: 'indexeddb', durable: true }),
  Object.freeze({ implementation: 'file', durable: true }),
]);

const caseRequest = (testCase) => ({
  plan: testCase.plan,
  executingMaterializationKey: testCase.executingMaterializationKey,
  projectedFields: testCase.projectedFields,
  base: testCase.base,
  ...(Object.prototype.hasOwnProperty.call(testCase, 'clientOverlayRows')
    ? { clientOverlayRows: testCase.clientOverlayRows }
    : {}),
});

const capturedOutcome = (evaluate) => {
  try {
    return { status: 'ok', rows: evaluate() };
  } catch (error) {
    return {
      status: 'refused',
      code: error?.code ?? 'SNAPBACK_RESULT_TRANSFORM_UNTYPED_FAILURE',
      reason: error?.reason ?? 'untyped-failure',
    };
  }
};

async function renderedCorpusCases() {
  return Promise.all(buildResultTransformCorpusCases().map(async (testCase) => {
    let transformHash = null;
    try {
      transformHash = await transformHashV1(testCase.plan);
    } catch {
      // Structurally invalid plans deliberately have no TransformHashV1.
    }
    return {
      ...testCase,
      expect: {
        transformHash,
        outcome: testCase.expect.outcome,
      },
    };
  }));
}

const cases = await renderedCorpusCases();
const renderedCases = new Map(cases.map((testCase) => [
  testCase.name,
  `${JSON.stringify(testCase, null, 2)}\n`,
]));
const baseline = JSON.parse(readFileSync(join(CORPUS_DIR, '..', 'corpus.manifest.json'), 'utf8'));
assert.equal(baseline.cases.length, 37, 'the extension records the current 37-case D5 baseline');

const manifest = {
  artifactKind: 'snapback.result-transform-corpus-manifest.v1',
  corpus: RESULT_TRANSFORM_CORPUS_NAME,
  extensionOf: {
    corpus: baseline.corpus,
    manifestPath: 'tests/conformance/data-tier/corpus.manifest.json',
    cases: baseline.cases.length,
  },
  profile: 'result-transform.v1',
  corpusFormatVersion: RESULT_TRANSFORM_CORPUS_VERSION,
  profileVersion: 1,
  caseSchemaPath: 'schemas/result-transform-v1.case.schema.json',
  evaluatorIdentities: {
    rust: 'snapback.result-transform.rust.v1',
    javascript: RESULT_TRANSFORM_V1_JAVASCRIPT_EVALUATOR_ID,
  },
  cases: cases.map((testCase) => ({
    name: testCase.name,
    path: `${testCase.name}.case.json`,
    sha256: sha256(renderedCases.get(testCase.name)),
    transformHash: testCase.expect.transformHash,
    requiredCapabilities: testCase.plan.overlay === 'apply'
      ? ['resultTransformV1', 'clientMaterializedOverlayInputV1']
      : ['resultTransformV1'],
    minimumProfileVersion: testCase.corpusVersion,
  })),
};
const renderedManifest = `${JSON.stringify(manifest, null, 2)}\n`;

test('result-transform D5 extension is generated, pinned, and exact in JavaScript', async () => {
  const names = new Set();
  for (const testCase of cases) {
    assert.equal(testCase.corpus, RESULT_TRANSFORM_CORPUS_NAME);
    assert.equal(testCase.corpusVersion, RESULT_TRANSFORM_CORPUS_VERSION);
    assert.equal(names.has(testCase.name), false, `${testCase.name}: duplicate name`);
    names.add(testCase.name);

    const rendered = renderedCases.get(testCase.name);
    assert.equal(rendered.includes('$ANY_'), false, `${testCase.name}: no placeholder`);
    assert.equal(rendered.includes('__GENERATED__'), false, `${testCase.name}: no placeholder`);
    const path = join(CORPUS_DIR, `${testCase.name}.case.json`);
    if (WRITE) {
      mkdirSync(CORPUS_DIR, { recursive: true });
      writeFileSync(path, rendered);
    } else {
      assert.equal(readFileSync(path, 'utf8'), rendered, `${testCase.name}: committed case is stale`);
    }

    const actual = await runResultTransformCaseInJs(testCase);
    assert.equal(actual.transformHash, testCase.expect.transformHash, `${testCase.name}: transform hash`);
    assert.deepEqual(actual.outcome, testCase.expect.outcome, `${testCase.name}: exact outcome`);
    assert.equal(
      actual.outcomeJcs,
      canonicalizeClientValueV1(testCase.expect.outcome),
      `${testCase.name}: exact canonical outcome bytes`,
    );
  }

  if (WRITE) {
    writeFileSync(MANIFEST_PATH, renderedManifest);
  } else {
    assert.equal(readFileSync(MANIFEST_PATH, 'utf8'), renderedManifest, 'committed manifest is stale');
  }
  const committedCaseFiles = readdirSync(CORPUS_DIR).filter((name) => name.endsWith('.case.json'));
  assert.deepEqual(
    committedCaseFiles.sort(),
    cases.map(({ name }) => `${name}.case.json`).sort(),
    'no orphaned or missing result-transform cases',
  );
  assert.equal(existsSync(MANIFEST_PATH), true);
});

test('S6 ship gate runs all 56 cases on each claiming carrier and floors non-claiming carriers', () => {
  assert.deepEqual(RESULT_TRANSFORM_V1_SHIP_GATE.evaluatorIdentities, {
    javascript: RESULT_TRANSFORM_V1_JAVASCRIPT_EVALUATOR_ID,
    rust: RESULT_TRANSFORM_V1_RUST_EVALUATOR_ID,
  });
  assert.equal(RESULT_TRANSFORM_V1_SHIP_GATE.corpusCases, cases.length);
  for (const carrier of claimingCarriers) {
    for (const testCase of cases) {
      const actual = capturedOutcome(() => evaluateAdmittedResultTransformV1({
        retentionClass: RESULT_TRANSFORM_V1_RETENTION_CLASS,
        carrier,
      }, caseRequest(testCase)));
      assert.deepEqual(
        actual,
        testCase.expect.outcome,
        `${carrier.implementation}/${testCase.name}: admitted carrier outcome`,
      );
      assert.equal(
        canonicalizeClientValueV1(actual),
        canonicalizeClientValueV1(testCase.expect.outcome),
        `${carrier.implementation}/${testCase.name}: canonical outcome bytes`,
      );
    }
  }

  for (const carrier of [
    { implementation: 'memory', durable: false },
    { implementation: 'expo-file-system', durable: false },
  ]) {
    for (const testCase of cases) {
      assert.throws(
        () => evaluateAdmittedResultTransformV1({
          retentionClass: RESULT_TRANSFORM_V1_RETENTION_CLASS,
          carrier,
        }, caseRequest(testCase)),
        { code: 'SNAPBACK_LOCAL_EVALUATION_UNADMITTED' },
        `${carrier.implementation}/${testCase.name}: non-claiming carrier stays on floor`,
      );
    }
  }

  assert.throws(
    () => evaluateAdmittedResultTransformV1({
      retentionClass: 'opaque-authorized-snapshot-v1',
      carrier: claimingCarriers[0],
    }, caseRequest(cases[0])),
    { code: 'SNAPBACK_LOCAL_EVALUATION_UNADMITTED' },
    'the owner must reclassify the plan before the gate can evaluate it',
  );
});

test('the shipped client invocation seam preserves the floor before request inspection', async () => {
  const client = Object.create(SnapbackClient.prototype);
  client.rqsStoreInfo = Object.freeze({ implementation: 'indexeddb', durable: true });
  let transformInspected = false;
  const transformPlan = new Proxy({}, {
    get() {
      transformInspected = true;
      throw new Error('unreclassified request must not be inspected');
    },
  });
  await assert.rejects(
    client.evaluateLocalResultTransform({
      name: 'opaquePlan',
      composition: {
        normalizedCompositePlan: {
          classification: { retention: 'opaque-authorized-snapshot-v1' },
        },
      },
    }, { transformPlan }),
    { code: 'SNAPBACK_LOCAL_EVALUATION_UNADMITTED' },
  );
  assert.equal(transformInspected, false);
});

test('the shipped client invocation seam evaluates only proof-verified reclassified bytes', async () => {
  const client = Object.create(SnapbackClient.prototype);
  client.rqsStoreInfo = Object.freeze({ implementation: 'file', durable: true });
  let renderedReads = 0;
  client.__prepareGeneratedMaterializationBridge = async () => ({
    bridge: {
      address: ['snapback:client-materialization-address:v1', 'ship-gate-store', 'qmk1.ship-gate'],
      identities: { planHash: 'sha256:proof-verified-plan' },
      retentionClass: RESULT_TRANSFORM_V1_RETENTION_CLASS,
      retentionRequested: true,
      resultContract: {
        record: {
          fields: [{ name: 'id' }, { name: 'active' }, { name: 'rank' }],
        },
      },
    },
    record: {
      queryInstanceId: 7,
      authorityState: { authority_generation: 3, query_generation: 4 },
    },
    store: {
      async readRenderable(_address, fence) {
        renderedReads += 1;
        assert.deepEqual(fence, {
          queryInstanceId: 7,
          authorityGeneration: 3,
          queryGeneration: 4,
        });
        return new TextEncoder().encode(JSON.stringify([
          { id: 'base', active: true, rank: 1 },
          { id: 'inactive', active: false, rank: 9 },
        ]));
      },
    },
  });
  const rows = await client.evaluateLocalResultTransform({
    artifactKind: 'functionReference',
    name: 'reclassifiedPlan',
    argsContract: { kind: 'object', fields: [] },
    composition: {
      normalizedCompositePlan: {
        classification: { retention: RESULT_TRANSFORM_V1_RETENTION_CLASS },
      },
    },
  }, {
    transformPlan: {
      format: 'snapback.result-transform.v1',
      materializationKey: 'qmk1.ship-gate',
      overlay: 'none',
      filterGrammar: 'basic-v1',
      filter: [{ field: 'active', op: 'eq', value: true }],
      order: [{ field: 'rank', direction: 'desc' }],
      limit: 10,
    },
  });
  assert.deepEqual(rows, [{ id: 'base', active: true, rank: 1 }]);
  assert.equal(renderedReads, 1);
});

test('client-only overlay callbacks compose in owner order before the pure transform', () => {
  const transformPlan = {
    format: 'snapback.result-transform.v1',
    materializationKey: 'qmk1.result-transform-fixture',
    overlay: 'apply',
    filterGrammar: 'basic-v1',
    filter: [{ field: 'active', op: 'eq', value: true }],
    order: [{ field: 'rank', direction: 'desc' }],
    limit: 2,
  };
  const request = {
    plan: transformPlan,
    executingMaterializationKey: 'qmk1.result-transform-fixture',
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
      (current) => [...current, { id: 'only-overlay', active: true, rank: 2 }],
      (current) => current.map((row) => (
        row.id === 'base' ? { ...row, rank: 3 } : row
      )),
    ],
  };
  for (const carrier of claimingCarriers) {
    const rows = evaluateAdmittedResultTransformV1({
      retentionClass: RESULT_TRANSFORM_V1_RETENTION_CLASS,
      carrier,
    }, request);
    assert.deepEqual(rows, [
      { id: 'base', active: true, rank: 3 },
      { id: 'only-overlay', active: true, rank: 2 },
    ]);
  }

  let invalidLayerCalled = false;
  assert.throws(
    () => evaluateAdmittedResultTransformV1({
      retentionClass: RESULT_TRANSFORM_V1_RETENTION_CLASS,
      carrier: claimingCarriers[0],
    }, {
      plan: transformPlan,
      executingMaterializationKey: 'qmk1.other-address',
      projectedFields: ['id', 'active', 'rank'],
      base: {
        shape: 'row-sequence',
        mode: 'single-page',
        pages: [{ version: 'stream-v7', terminal: true, rows: [] }],
      },
      overlayLayers: [() => {
        invalidLayerCalled = true;
        return [];
      }],
    }),
    { code: 'SNAPBACK_RESULT_TRANSFORM_CROSS_ADDRESS' },
  );
  assert.equal(invalidLayerCalled, false, 'contextual refusal precedes client callback execution');
});

test('the shipped evaluator source is browser-safe', () => {
  const source = readFileSync(join(ROOT, 'packages', 'snapback-client', 'result-transform.mjs'), 'utf8');
  assert.equal(/\bBuffer\b/.test(source), false, 'no Buffer dependency');
  assert.equal(/^\s*import\s+.*['"]node:/mu.test(source), false, 'no static node: import');
  assert.match(source, /globalThis\.process\?\.getBuiltinModule\?\./u);
  assert.match(source, /globalThis\.crypto\?\.subtle/u);
});

console.log(`result-transform D5 extension: ${cases.length} JavaScript cases exact${WRITE ? ' and written' : ''}`);
