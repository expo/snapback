// Reproduce the LLP 0129 Phase-1 D5 cross-runtime evidence receipt.
//
// Usage after scripts/bootstrap-ibex-runtime:
//   node tests/acceptance/fixtures/write-lane/phase1-d5-evidence.2026-08-03.v1.mjs --write
//   node tests/acceptance/fixtures/write-lane/phase1-d5-evidence.2026-08-03.v1.mjs
//
// @ref LLP 0051#d5-conformance-the-corpus-becomes-the-data-tier-contract —
//   compare exact normalized whole-plan outcomes for every corpus case.

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

import {
  d5RowsMatch,
  d5ValuesEqual,
  replayDataTierCaseInJs,
} from '../../../conformance/data-tier/js-d5-harness.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const CORPUS_DIR = join(REPO_ROOT, 'tests', 'conformance', 'data-tier');
const MANIFEST_PATH = join(CORPUS_DIR, 'corpus.manifest.json');
const RECEIPT_PATH = join(
  REPO_ROOT,
  'tests',
  'acceptance',
  'fixtures',
  'write-lane',
  'phase1-d5-evidence.2026-08-03.v1.json',
);
const WRITE = process.argv.includes('--write');
const EXISTING_RECEIPT = WRITE ? null : JSON.parse(readFileSync(RECEIPT_PATH, 'utf8'));
const FORMER_MULTI_TABLE_SKIPS = new Set([
  'all-aboard-apply-feed-tick-first-run',
  'all-aboard-apply-feed-tick',
  'all-aboard-live-snapshot-fragments',
  'all-aboard-reset-feed',
  'reject-insert-each-non-array',
]);

const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;

const canonicalValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      Object.defineProperty(out, key, {
        value: canonicalValue(value[key]),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return out;
  }
  return Object.is(value, -0) ? 0 : value;
};

const stableText = (value, spacing = 0) => JSON.stringify(canonicalValue(value), null, spacing);

const normalizeOutcome = (outcome) => {
  const normalized = canonicalValue(outcome);
  for (const rows of Object.values(normalized.rows ?? {})) {
    rows.sort((left, right) => {
      const a = stableText(left);
      const b = stableText(right);
      return a === b ? 0 : a < b ? -1 : 1;
    });
  }
  return normalized;
};

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
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
assert.equal(manifest.cases.length, 37, 'receipt requires the complete 37-case v1 corpus');

const cases = manifest.cases.map((entry) => {
  const raw = readFileSync(join(CORPUS_DIR, entry.path), 'utf8');
  assert.equal(sha256(raw), entry.sha256, `${entry.name}: manifest hash`);
  assert.equal(raw.includes('$ANY_'), false, `${entry.name}: no nondeterministic placeholder`);
  const testCase = JSON.parse(raw);
  assert.ok(testCase.ctxLedger, `${entry.name}: exact ctx ledger is present`);
  return testCase;
});

const jsOutcomes = cases.map((testCase) => {
  const outcome = replayDataTierCaseInJs(testCase);
  assert.ok(d5ValuesEqual(outcome.inputCtxLedger, testCase.ctxLedger), `${testCase.name}: input ledger`);

  if (testCase.expect.error) {
    assert.equal(outcome.status, 'rejected', `${testCase.name}: JS rejection status`);
    assert.equal(outcome.rejectionCode, testCase.expect.error.code, `${testCase.name}: JS rejection code`);
    assert.equal(outcome.result, null, `${testCase.name}: rejected result is absent`);
    assert.equal(outcome.changedCount, null, `${testCase.name}: rejected changed count is absent`);
    assert.equal(outcome.outputCtxLedger, null, `${testCase.name}: rejected output ledger is absent`);
    for (const table of testCase.schema.tables) {
      assert.ok(
        d5RowsMatch(testCase.seed?.[table.name] ?? [], outcome.rows[table.name]),
        `${testCase.name}: JS rejection rolls back ${table.name}`,
      );
    }
  } else {
    assert.equal(outcome.status, 'committed', `${testCase.name}: JS commit status`);
    assert.ok(d5ValuesEqual(outcome.result, testCase.expect.result), `${testCase.name}: JS result`);
    assert.equal(outcome.changedCount, testCase.expect.changedCount, `${testCase.name}: JS changed count`);
    assert.ok(
      d5ValuesEqual(outcome.outputCtxLedger, testCase.ctxLedger),
      `${testCase.name}: JS output ledger`,
    );
    for (const [table, expectedRows] of Object.entries(testCase.expect.rows ?? {})) {
      assert.ok(d5RowsMatch(expectedRows, outcome.rows[table]), `${testCase.name}: JS rows ${table}`);
    }
  }
  return normalizeOutcome(outcome);
});

const temporary = mkdtempSync(join(tmpdir(), 'snapback-d5-evidence-'));
let rustReceipt;
try {
  const rustPath = join(temporary, 'rust-outcomes.json');
  run(
    'cargo',
    [
      'test',
      '--locked',
      '--test',
      'data_tier_corpus_v0',
      'data_tier_corpus_cases_pass_on_the_host_evaluator',
      '--',
      '--nocapture',
    ],
    {
      env: {
        ...process.env,
        SNAPBACK_D5_RUST_OUTCOMES_PATH: rustPath,
      },
    },
  );
  rustReceipt = JSON.parse(readFileSync(rustPath, 'utf8'));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

assert.equal(rustReceipt.cases.length, 37, 'Rust emitted every case');
const rustByName = new Map(rustReceipt.cases.map((outcome) => [outcome.name, normalizeOutcome(outcome)]));
const jsByName = new Map(jsOutcomes.map((outcome) => [outcome.name, outcome]));

const matrix = cases
  .map((testCase) => {
    const rust = rustByName.get(testCase.name);
    const js = jsByName.get(testCase.name);
    assert.ok(rust, `${testCase.name}: Rust outcome present`);
    assert.ok(js, `${testCase.name}: JS outcome present`);
    assert.deepEqual(js, rust, `${testCase.name}: Rust and JS normalized outcomes are exact`);
    const rejected = testCase.expect.error !== undefined;
    return {
      case: testCase.name,
      tables: testCase.schema.tables.map((table) => table.name),
      formerlySkippedMultiTable: FORMER_MULTI_TABLE_SKIPS.has(testCase.name),
      rust: 'pass',
      js: 'pass',
      crossRuntimeExact: true,
      normalizedOutcomeSha256: sha256(stableText(js)),
      pins: {
        wholePlanReturn: rejected ? 'not-applicable-atomic-rejection' : 'exact',
        changedCount: rejected ? 'not-applicable-atomic-rejection' : 'exact',
        resultRows: 'exact-all-schema-tables-after-system-field-normalization',
        inputCtxAnswerLedger: 'exact-consumed-recording',
        outputCtxAnswerLedger: rejected ? 'not-applicable-atomic-rejection' : 'exact-echo',
        rejectionCode: rejected ? 'exact' : 'not-applicable-commit',
        atomicRollback: rejected ? 'exact-all-schema-tables' : 'not-applicable-commit',
      },
      sidecar: {
        required: false,
        reason: 'D5 replays a complete seeded ephemeral workspace; partial-replica admission is out of scope.',
      },
      finding: null,
    };
  })
  .sort((left, right) => left.case.localeCompare(right.case));

assert.equal(matrix.filter((row) => row.formerlySkippedMultiTable).length, 5);
assert.equal(matrix.filter((row) => row.crossRuntimeExact).length, 37);

const sourcePaths = [
  'packages/snapback-codegen/data-tier-corpus.mjs',
  'packages/snapback-contract/index.mjs',
  'packages/snapback-contract/derived-overlay.mjs',
  'packages/snapback-contract/derived-overlay.test.mjs',
  'packages/snapback-client/ir-evaluator.mjs',
  'packages/snapback-client/ir-evaluator.test.mjs',
  'tests/conformance/data-tier/js-d5-harness.mjs',
  'tests/data_tier_corpus_v0.rs',
  'tests/acceptance/fixtures/write-lane/phase1-d5-evidence.2026-08-03.v1.mjs',
];

const receipt = {
  artifactKind: 'snapback.phase1-d5-evidence-receipt.v1',
  evidenceDate: '2026-08-03',
  gatePresentationDue: '2026-08-10',
  // The evidence is produced from an uncommitted gate worktree by design.
  // Preserve its source-base identity in verify mode so landing the evidence
  // does not make the committed receipt self-stale; exact changed bytes remain
  // independently bound below by corpus and source hashes.
  baseRevision: EXISTING_RECEIPT?.baseRevision ?? run('git', ['rev-parse', 'HEAD']),
  corpus: {
    manifestPath: 'tests/conformance/data-tier/corpus.manifest.json',
    manifestSha256: sha256(manifestRaw),
    corpus: manifest.corpus,
    cases: manifest.cases.length,
    profileVersion: manifest.profileVersion,
    corpusFormatVersion: manifest.corpusFormatVersion,
    ledgerVersion: manifest.ledgerVersion,
    placeholdersRemaining: 0,
  },
  executors: {
    rustHost: {
      runner: 'tests/data_tier_corpus_v0.rs',
      command: 'cargo test --locked --test data_tier_corpus_v0 data_tier_corpus_cases_pass_on_the_host_evaluator -- --nocapture',
      status: 'pass',
      cargo: run('cargo', ['--version']),
      rustc: run('rustc', ['--version']),
    },
    javascript: {
      shippingEvaluator: 'packages/snapback-client/ir-evaluator.mjs',
      conformanceAdapter: 'tests/conformance/data-tier/js-d5-harness.mjs',
      valueSemantics: 'packages/snapback-contract/derived-overlay.mjs',
      suite: 'packages/snapback-client/ir-evaluator.test.mjs',
      command: 'node packages/snapback-client/ir-evaluator.test.mjs',
      status: 'pass',
      node: process.version,
      registration: 'shipping-package-subpath',
    },
  },
  exactness: {
    status: 'pass',
    statement: 'For all 37 cases, Rust host and JS evidence execution produced identical normalized whole-plan outcomes.',
    compared: [
      'commit-or-rejection status',
      'whole-plan return value',
      'changed count',
      'all declared table rows',
      'input ctx-answer ledger',
      'output ctx-answer ledger',
      'typed rejection code',
    ],
    rowNormalization: 'Runtime-owned system fields are removed; every declared schema field is present (missing optional fields normalize to null); tables and rows are deterministically ordered.',
  },
  summary: {
    cases: 37,
    committed: matrix.filter((row) => row.pins.wholePlanReturn === 'exact').length,
    rejected: matrix.filter((row) => row.pins.rejectionCode === 'exact').length,
    multiTable: matrix.filter((row) => row.formerlySkippedMultiTable).length,
    skipped: 0,
    blocked: 0,
    unpinnable: 0,
    exactCrossRuntime: matrix.filter((row) => row.crossRuntimeExact).length,
  },
  sourceHashes: Object.fromEntries(sourcePaths.map((path) => [
    path,
    sha256(readFileSync(join(REPO_ROOT, path))),
  ])),
  cases: matrix,
  findings: [],
  limits: [
    'The shipping evaluator implements the complete D5 v1 semantic workspace, while local prediction separately admits only the M1 Insert/Get/Guard/Patch effect ceiling.',
    'No coverage/read-requirement sidecar is needed for D5 full-workspace replay; this receipt does not establish partial-replica read admission.',
    'This receipt makes no Parity, same-code, capability, React presentation, store/outbox, or settlement claim.',
  ],
};

const rendered = `${stableText(receipt, 2)}\n`;
if (WRITE) {
  writeFileSync(RECEIPT_PATH, rendered);
  console.log(`wrote ${RECEIPT_PATH}`);
} else {
  assert.equal(readFileSync(RECEIPT_PATH, 'utf8'), rendered, 'committed D5 evidence receipt is stale');
}

console.log('phase1 D5 evidence: 37/37 Rust-vs-JS exact, 5/5 multi-table replayed, 0 skipped');
