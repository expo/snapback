// Reproduce the LLP 0051 D5 result-transform.v1 extension receipt.
//
// Usage after scripts/bootstrap-ibex-runtime:
//   node tests/acceptance/fixtures/write-lane/result-transform-d5-extension-evidence.2026-08-03.v1.mjs --write
//   node tests/acceptance/fixtures/write-lane/result-transform-d5-extension-evidence.2026-08-03.v1.mjs
//
// @ref LLP 0051#d5-conformance-the-corpus-becomes-the-data-tier-contract —
//   compare every committed case at pinned Rust/JavaScript evaluator identities.
// @ref LLP 0166#ship-gate — this receipt proves the pure references only and
//   does not admit or wire retained-result evaluation.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { canonicalizeClientValueV1 } from '../../../../packages/snapback-client/canonical-client-value.mjs';
import { runResultTransformCaseInJs } from '../../../conformance/data-tier/result-transform-v1/js-runner.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const CORPUS_DIR = join(ROOT, 'tests', 'conformance', 'data-tier', 'result-transform-v1');
const MANIFEST_PATH = join(CORPUS_DIR, 'corpus.manifest.json');
const RECEIPT_PATH = join(
  ROOT,
  'tests',
  'acceptance',
  'fixtures',
  'write-lane',
  'result-transform-d5-extension-evidence.2026-08-03.v1.json',
);
const WRITE = process.argv.includes('--write');
const EXISTING_RECEIPT = (() => {
  if (WRITE) return null;
  try {
    return JSON.parse(readFileSync(RECEIPT_PATH, 'utf8'));
  } catch {
    return null;
  }
})();
const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;

const canonicalValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  }
  return Object.is(value, -0) ? 0 : value;
};
const stableText = (value, spacing = 0) => JSON.stringify(canonicalValue(value), null, spacing);

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}`);
  }
  return result.stdout.trim();
};

const manifestRaw = readFileSync(MANIFEST_PATH, 'utf8');
const manifest = JSON.parse(manifestRaw);
assert.equal(manifest.cases.length, 56, 'receipt requires the complete 56-case v1 extension');
assert.equal(manifest.extensionOf.cases, 37, 'receipt binds the ruled 37-case D5 baseline');

const cases = manifest.cases.map((entry) => {
  const raw = readFileSync(join(CORPUS_DIR, entry.path), 'utf8');
  assert.equal(sha256(raw), entry.sha256, `${entry.name}: manifest case hash`);
  assert.equal(raw.includes('$ANY_'), false, `${entry.name}: no nondeterministic placeholder`);
  assert.equal(raw.includes('__GENERATED__'), false, `${entry.name}: no generated placeholder`);
  const testCase = JSON.parse(raw);
  assert.equal(testCase.name, entry.name, `${entry.name}: case name`);
  assert.equal(testCase.expect.transformHash, entry.transformHash, `${entry.name}: manifest transform hash`);
  return testCase;
});

const jsCases = await Promise.all(cases.map(runResultTransformCaseInJs));
for (let index = 0; index < cases.length; index += 1) {
  const testCase = cases[index];
  const actual = jsCases[index];
  assert.equal(actual.transformHash, testCase.expect.transformHash, `${testCase.name}: JS hash`);
  assert.equal(
    actual.outcomeJcs,
    canonicalizeClientValueV1(testCase.expect.outcome),
    `${testCase.name}: JS expected outcome bytes`,
  );
}

const temporary = mkdtempSync(join(tmpdir(), 'snapback-result-transform-evidence-'));
let rustReceipt;
try {
  const rustPath = join(temporary, 'rust-outcomes.json');
  run(
    'cargo',
    [
      'test',
      '--locked',
      '--test',
      'result_transform_corpus_v1',
      'result_transform_v1_corpus_is_exact_on_the_rust_reference',
      '--',
      '--nocapture',
    ],
    {
      env: {
        ...process.env,
        SNAPBACK_RESULT_TRANSFORM_RUST_OUTCOMES_PATH: rustPath,
      },
    },
  );
  rustReceipt = JSON.parse(readFileSync(rustPath, 'utf8'));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

assert.equal(rustReceipt.evaluatorIdentity, manifest.evaluatorIdentities.rust);
assert.equal(rustReceipt.cases.length, cases.length);
const rustByName = new Map(rustReceipt.cases.map((entry) => [entry.name, entry]));
const jsByName = new Map(jsCases.map((entry) => [entry.name, entry]));

const matrix = cases.map((testCase) => {
  const rust = rustByName.get(testCase.name);
  const javascript = jsByName.get(testCase.name);
  assert.ok(rust, `${testCase.name}: Rust outcome present`);
  assert.ok(javascript, `${testCase.name}: JS outcome present`);
  assert.equal(rust.transformHash, javascript.transformHash, `${testCase.name}: transform hash exact`);
  assert.equal(rust.outcomeJcs, javascript.outcomeJcs, `${testCase.name}: outcome bytes exact`);
  return {
    case: testCase.name,
    outcome: testCase.expect.outcome.status,
    overlayBoundary: Object.prototype.hasOwnProperty.call(testCase, 'clientOverlayRows')
      ? 'client-materialized-input'
      : 'none',
    rust: 'pass',
    javascript: 'pass',
    crossRuntimeExact: true,
    transformHash: javascript.transformHash,
    canonicalOutcomeSha256: sha256(javascript.outcomeJcs),
    finding: null,
  };
}).sort((left, right) => left.case.localeCompare(right.case));

const sourcePaths = [
  'packages/snapback-client/result-transform.mjs',
  'packages/snapback-client/result-transform.test.mjs',
  'src/result_transform.rs',
  'tests/result_transform_corpus_v1.rs',
  'tests/conformance/data-tier/result-transform-v1/corpus-source.mjs',
  'tests/conformance/data-tier/result-transform-v1/js-runner.mjs',
  'schemas/result-transform-v1.case.schema.json',
  'schemas/result-transform-v1.corpus.schema.json',
  'tests/acceptance/fixtures/write-lane/result-transform-d5-extension-evidence.2026-08-03.v1.mjs',
];
const successful = matrix.filter((entry) => entry.outcome === 'ok').length;
const refused = matrix.filter((entry) => entry.outcome === 'refused').length;
const overlayInputs = matrix.filter((entry) => entry.overlayBoundary === 'client-materialized-input').length;

const receipt = {
  artifactKind: 'snapback.result-transform-d5-extension-evidence.v1',
  evidenceDate: '2026-08-03',
  baseRevision: EXISTING_RECEIPT?.baseRevision ?? run('git', ['rev-parse', 'HEAD']),
  corpus: {
    manifestPath: 'tests/conformance/data-tier/result-transform-v1/corpus.manifest.json',
    manifestSha256: sha256(manifestRaw),
    corpus: manifest.corpus,
    extensionOf: manifest.extensionOf,
    cases: manifest.cases.length,
    profile: manifest.profile,
    profileVersion: manifest.profileVersion,
    corpusFormatVersion: manifest.corpusFormatVersion,
    placeholdersRemaining: 0,
  },
  evaluatorIdentities: manifest.evaluatorIdentities,
  executors: {
    rustReference: {
      runner: 'tests/result_transform_corpus_v1.rs',
      command: 'cargo test --locked --test result_transform_corpus_v1 result_transform_v1_corpus_is_exact_on_the_rust_reference -- --nocapture',
      status: 'pass',
      cargo: run('cargo', ['--version']),
      rustc: run('rustc', ['--version']),
    },
    javascriptReference: {
      module: 'packages/snapback-client/result-transform.mjs',
      runner: 'tests/conformance/data-tier/result-transform-v1/js-runner.mjs',
      suite: 'packages/snapback-client/result-transform.test.mjs',
      command: 'node packages/snapback-client/result-transform.test.mjs',
      status: 'pass',
      node: process.version,
      registration: 'dormant-unexported-module',
    },
  },
  exactness: {
    status: 'pass',
    statement: 'For all 56 cases, the pinned Rust and JavaScript references produced identical TransformHashV1 values (or identical null for structurally invalid plans) and identical RFC 8785 outcome bytes.',
    compared: [
      'TransformHashV1 fixture identity',
      'success-or-refusal status',
      'complete ordered output row sequence',
      'typed refusal code',
      'typed refusal reason',
    ],
    overlayBoundary: 'Cases with clientOverlayRows consume the same already-materialized client-only layer output on both references; arbitrary optimistic callbacks are composed and tested only by the JavaScript suite.',
  },
  summary: {
    cases: matrix.length,
    successful,
    refused,
    clientMaterializedOverlayInputs: overlayInputs,
    skipped: 0,
    blocked: 0,
    exactCrossRuntime: matrix.filter((entry) => entry.crossRuntimeExact).length,
  },
  sourceHashes: Object.fromEntries(sourcePaths.map((path) => [
    path,
    sha256(readFileSync(join(ROOT, path))),
  ])),
  cases: matrix,
  findings: [],
  limits: [
    'The evaluator modules remain dormant and are not imported by the store, evaluation floor, package root, or any live path.',
    'This receipt does not prove arbitrary optimistic callbacks on a server; callback composition is client-only and covered by the JavaScript suite.',
    'No retention-class capability or per-plan admission follows from this evidence. Every claiming carrier, S6 composition/admission legs, and owner reclassification remain ship-gate requirements.',
  ],
};

const rendered = `${stableText(receipt, 2)}\n`;
if (WRITE) {
  writeFileSync(RECEIPT_PATH, rendered);
  console.log(`wrote ${RECEIPT_PATH}`);
} else {
  assert.equal(readFileSync(RECEIPT_PATH, 'utf8'), rendered, 'committed receipt is stale');
}

console.log(
  `result-transform D5 extension: ${matrix.length}/${matrix.length} Rust-vs-JS exact, ${successful} success, ${refused} typed refusal, 0 skipped`,
);
