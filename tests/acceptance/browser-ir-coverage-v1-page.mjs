// Browser-only entry for the LLP 0129 Phase 2a browser-IR coverage runner.
//
// @ref LLP 0129#open-questions — OQ9 requires the shipping evaluator to run
//   the exact D5 corpus through a standards-real IndexedDB browser carrier.
// @ref LLP 0051#d5-conformance-the-corpus-becomes-the-data-tier-contract —
//   compare exact normalized whole-plan outcomes, including atomic rejection.

import {
  classifyLocalMutationIrV1,
} from '../../packages/snapback-client/ir-evaluator.mjs';
import {
  d5RowsMatch,
  d5ValuesEqual,
  replayDataTierCaseInJs,
} from '../conformance/data-tier/js-d5-harness.mjs';

const DATABASE_PREFIX = 'snapback-browser-ir-coverage-';
const DATABASE_VERSION = 1;
const OUTCOME_STORE = 'outcomes';

const configuredDatabaseName = new URL(globalThis.location.href).searchParams.get('database');
let databasePromise = null;

// Copied from phase1-d5-evidence.2026-08-03.v1.mjs. D5 comparison and
// browser-vs-Node byte equality deliberately share this normalization policy.
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

const requireDatabaseName = () => {
  if (
    typeof configuredDatabaseName !== 'string'
    || !configuredDatabaseName.startsWith(DATABASE_PREFIX)
    || configuredDatabaseName.length > 160
  ) {
    throw new Error('browser IR coverage page requires a runner-provided database name');
  }
  return configuredDatabaseName;
};

const requestResult = (request) => new Promise((resolveRequest, rejectRequest) => {
  request.addEventListener('success', () => resolveRequest(request.result), { once: true });
  request.addEventListener('error', () => rejectRequest(request.error ?? new Error('IndexedDB request failed')), {
    once: true,
  });
});

const transactionDone = (transaction) => new Promise((resolveTransaction, rejectTransaction) => {
  transaction.addEventListener('complete', resolveTransaction, { once: true });
  transaction.addEventListener('abort', () => rejectTransaction(
    transaction.error ?? new Error('IndexedDB transaction aborted'),
  ), { once: true });
  transaction.addEventListener('error', () => rejectTransaction(
    transaction.error ?? new Error('IndexedDB transaction failed'),
  ), { once: true });
});

const openDatabase = () => {
  if (databasePromise !== null) return databasePromise;
  databasePromise = new Promise((resolveDatabase, rejectDatabase) => {
    const request = globalThis.indexedDB.open(requireDatabaseName(), DATABASE_VERSION);
    request.addEventListener('upgradeneeded', () => {
      if (!request.result.objectStoreNames.contains(OUTCOME_STORE)) {
        request.result.createObjectStore(OUTCOME_STORE);
      }
    });
    request.addEventListener('success', () => resolveDatabase(request.result), { once: true });
    request.addEventListener('error', () => rejectDatabase(
      request.error ?? new Error('IndexedDB open failed'),
    ), { once: true });
    request.addEventListener('blocked', () => rejectDatabase(new Error('IndexedDB open was blocked')), {
      once: true,
    });
  });
  return databasePromise;
};

const persistAndReadBack = async (name, normalizedOutcomeText) => {
  const database = await openDatabase();
  const writeTransaction = database.transaction(OUTCOME_STORE, 'readwrite');
  const writeDone = transactionDone(writeTransaction);
  await requestResult(writeTransaction.objectStore(OUTCOME_STORE).put(normalizedOutcomeText, name));
  await writeDone;

  const readTransaction = database.transaction(OUTCOME_STORE, 'readonly');
  const readDone = transactionDone(readTransaction);
  const readBackText = await requestResult(readTransaction.objectStore(OUTCOME_STORE).get(name));
  await readDone;
  if (typeof readBackText !== 'string') {
    throw new Error(`${name}: IndexedDB read-back did not return the persisted outcome text`);
  }
  if (readBackText !== normalizedOutcomeText) {
    throw new Error(`${name}: IndexedDB read-back bytes differ from the persisted outcome text`);
  }
  return readBackText;
};

const compareAgainstD5Expect = (testCase, outcome) => {
  const failures = [];
  const check = (condition, detail) => {
    if (!condition) failures.push(detail);
  };

  check(
    d5ValuesEqual(outcome.inputCtxLedger, testCase.ctxLedger),
    'input ctx ledger is not exact',
  );

  // This is the expect-comparison policy from the Phase-1 D5 evidence runner:
  // rejected cases prove their typed outcome and all-table rollback; committed
  // cases prove the return, changed count, output ledger, and expected rows.
  if (testCase.expect.error) {
    check(outcome.status === 'rejected', 'rejection status is not exact');
    check(
      outcome.rejectionCode === testCase.expect.error.code,
      `rejection code is not exact (expected ${testCase.expect.error.code}, received ${outcome.rejectionCode ?? 'null'})`,
    );
    check(outcome.result === null, 'rejected result is present');
    check(outcome.changedCount === null, 'rejected changed count is present');
    check(outcome.outputCtxLedger === null, 'rejected output ledger is present');
    for (const table of testCase.schema.tables) {
      check(
        d5RowsMatch(testCase.seed?.[table.name] ?? [], outcome.rows[table.name]),
        `atomic rejection did not roll back ${table.name}`,
      );
    }
  } else {
    check(outcome.status === 'committed', 'commit status is not exact');
    check(d5ValuesEqual(outcome.result, testCase.expect.result), 'committed result is not exact');
    check(
      outcome.changedCount === testCase.expect.changedCount,
      `changed count is not exact (expected ${testCase.expect.changedCount}, received ${outcome.changedCount ?? 'null'})`,
    );
    check(
      d5ValuesEqual(outcome.outputCtxLedger, testCase.ctxLedger),
      'output ctx ledger is not exact',
    );
    for (const [table, expectedRows] of Object.entries(testCase.expect.rows ?? {})) {
      check(d5RowsMatch(expectedRows, outcome.rows[table]), `result rows are not exact for ${table}`);
    }
  }

  return failures;
};

const envFacts = async () => ({
  indexedDb: typeof globalThis.indexedDB?.open === 'function',
  userAgent: globalThis.navigator.userAgent,
  databaseName: configuredDatabaseName,
});

const runCase = async (testCase) => {
  const classified = classifyLocalMutationIrV1({ plan: testCase.plan });
  const admission = {
    classification: classified.classification,
    code: classified.code,
  };

  const rawOutcome = replayDataTierCaseInJs(testCase);
  const persistedOutcomeText = stableText(normalizeOutcome(rawOutcome));
  const readBackText = await persistAndReadBack(testCase.name, persistedOutcomeText);
  const readBackOutcome = JSON.parse(readBackText);
  const failures = compareAgainstD5Expect(testCase, readBackOutcome);

  return {
    name: testCase.name,
    verdict: failures.length === 0 ? 'PASS' : 'FAIL',
    failureDetail: failures.length === 0 ? null : failures,
    admission,
    normalizedOutcomeText: readBackText,
    indexedDb: {
      persisted: true,
      readBack: readBackText === persistedOutcomeText,
    },
  };
};

const cleanup = async () => {
  const databaseName = requireDatabaseName();
  if (databasePromise !== null) {
    const database = await databasePromise;
    database.close();
    databasePromise = null;
  }
  await new Promise((resolveDelete, rejectDelete) => {
    const request = globalThis.indexedDB.deleteDatabase(databaseName);
    request.addEventListener('success', resolveDelete, { once: true });
    request.addEventListener('error', () => rejectDelete(
      request.error ?? new Error('IndexedDB database deletion failed'),
    ), { once: true });
    request.addEventListener('blocked', () => rejectDelete(
      new Error('IndexedDB database deletion was blocked'),
    ), { once: true });
  });
  return { databaseDeleted: true, databaseName };
};

Object.defineProperty(globalThis, 'snapbackBrowserIrCoverage', {
  value: Object.freeze({ envFacts, runCase, cleanup }),
  configurable: false,
  enumerable: true,
  writable: false,
});
