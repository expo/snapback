// Shared query ceilings and the fallback JS/Rust literal parity guard.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  RELATIONAL_TAKE_CEILING,
  SNAPBACK_PUBLIC_BUDGETS_V1,
  SNAPSHOT_BATCH_SUMMED_TAKE_CEILING,
} from './limits.mjs';

assert.equal(RELATIONAL_TAKE_CEILING, 1_024);
assert.equal(SNAPSHOT_BATCH_SUMMED_TAKE_CEILING, 1_024);
assert.deepEqual(SNAPBACK_PUBLIC_BUDGETS_V1, {
  query: {
    implicitResultRows: 1_024,
    takeRows: 1_024,
    dynamicTake: 'supported-with-runtime-ceiling',
    repair: 'fixed-bound-then-slice',
  },
  result: { maxBytes: 4_194_304, maxArrayItems: 1_024 },
  retainedMutationOutput: {
    maxBytes: 65_536,
    diagnostic: 'SNAPBACK_CLIENT_MUTATION_RESULT_TOO_LARGE',
  },
  react: {
    queryStores: 256,
    queryConsumers: 1_024,
    viewSubscriptionWarning: 16,
    serverSubscriptions: 64,
    warningDiagnostic: 'SNAPBACK_REACT_SUBSCRIPTION_VIEW_BUDGET_EXCEEDED',
  },
});

// define.mjs participates in every explicit-profile app's authored module
// graph, so importing this module from it would rotate all generated artifact
// identities. Its literals are parity-locked here instead, exactly like the
// Rust enforcement sites below.
const rustSources = [
  ['manifest', fileURLToPath(new URL('../../crates/snapback-types/src/manifest/types.rs', import.meta.url))],
  ['storage', fileURLToPath(new URL('../../crates/snapback-kernel/src/storage.rs', import.meta.url))],
  ['define', fileURLToPath(new URL('../snapback-codegen/define.mjs', import.meta.url))],
];
const presentSources = rustSources.filter(([, path]) => existsSync(path));

if (presentSources.length === 0) {
  console.log('ok - packages/snapback-contract/limits.test.mjs # SKIP enforcement sources absent (published-package context)');
} else {
  assert.equal(
    presentSources.length,
    rustSources.length,
    `enforcement-source parity guard requires all of ${rustSources.map(([, path]) => path).join(', ')}`,
  );

  const sources = Object.fromEntries(
    rustSources.map(([name, path]) => [name, readFileSync(path, 'utf8')]),
  );
  const assertLiterals = (source, pattern, expectedCount, expected, label) => {
    const literals = [...source.matchAll(pattern)].map((match) => (
      Number(match[1].replaceAll('_', ''))
    ));
    assert.equal(literals.length, expectedCount, `${label} enforcement-site count drifted`);
    for (const literal of literals) assert.equal(literal, expected, label);
  };

  assertLiterals(
    sources.manifest,
    /plan\.take\s*>\s*(1_?024)\b/gu,
    2,
    RELATIONAL_TAKE_CEILING,
    'crates/snapback-types/src/manifest/types.rs relational and bounded-children take ceilings',
  );
  assertLiterals(
    sources.storage,
    /plan\.take\s*>\s*(1_?024)\b/gu,
    1,
    RELATIONAL_TAKE_CEILING,
    'crates/snapback-kernel/src/storage.rs relational take ceiling',
  );
  assertLiterals(
    sources.manifest,
    /total_take\s*>\s*(1_?024)\b/gu,
    2,
    SNAPSHOT_BATCH_SUMMED_TAKE_CEILING,
    'crates/snapback-types/src/manifest/types.rs snapshot-batch summed take ceilings',
  );
  assertLiterals(
    sources.define,
    /spec\.take\s*<=\s*(1_?024)\b/gu,
    2,
    RELATIONAL_TAKE_CEILING,
    'snapback-codegen define.mjs relational and bounded-children take ceilings',
  );
  assertLiterals(
    sources.define,
    /totalTake\s*<=\s*(1_?024)\b/gu,
    1,
    SNAPSHOT_BATCH_SUMMED_TAKE_CEILING,
    'snapback-codegen define.mjs snapshot-batch summed take ceiling',
  );

  console.log('ok - packages/snapback-contract/limits.test.mjs');
}
