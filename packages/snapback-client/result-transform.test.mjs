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
import {
  RESULT_TRANSFORM_V1_JAVASCRIPT_EVALUATOR_ID,
  evaluateResultTransformWithClientLayersV1,
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
  const rows = evaluateResultTransformWithClientLayersV1({
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
  });
  assert.deepEqual(rows, [
    { id: 'base', active: true, rank: 3 },
    { id: 'only-overlay', active: true, rank: 2 },
  ]);

  let invalidLayerCalled = false;
  assert.throws(
    () => evaluateResultTransformWithClientLayersV1({
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

test('the dormant evaluator source is browser-safe', () => {
  const source = readFileSync(join(ROOT, 'packages', 'snapback-client', 'result-transform.mjs'), 'utf8');
  assert.equal(/\bBuffer\b/.test(source), false, 'no Buffer dependency');
  assert.equal(/^\s*import\s+.*['"]node:/mu.test(source), false, 'no static node: import');
  assert.match(source, /globalThis\.process\?\.getBuiltinModule\?\./u);
  assert.match(source, /globalThis\.crypto\?\.subtle/u);
});

console.log(`result-transform D5 extension: ${cases.length} JavaScript cases exact${WRITE ? ' and written' : ''}`);
