import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  checkLocalProof,
  observeRustWitnesses,
  parseGateCalls,
  suiteFailureDetail,
  suiteFailureDiagnostic,
  validateGateCalls,
} from '../scripts/check-local-proof-gates.mjs';

const root = resolve(import.meta.dirname, '..');

function failingNode(source) {
  const result = spawnSync(process.execPath, ['-e', source], { encoding: 'utf8' });
  assert.notEqual(result.status, 0, 'fixture must exercise Node\'s uncaught-error renderer');
  return result;
}

test('versioned-seed total-failure diagnostics understand real Node error shapes', () => {
  const assertion = failingNode(
    "const assert = require('node:assert/strict'); assert.equal(1, 2, 'seed witness mismatch')",
  );
  assert.equal(
    suiteFailureDiagnostic(assertion),
    'suite failed: AssertionError [ERR_ASSERTION]: seed witness mismatch | 1 !== 2',
  );

  const multiline = failingNode(
    "throw new Error('outer label:\\ncargo failed: could not compile snapback-kernel"
      + "\\nserver stderr: bind refused')",
  );
  assert.equal(
    suiteFailureDiagnostic(multiline),
    'suite failed: Error: outer label: | cargo failed: could not compile snapback-kernel '
      + '| server stderr: bind refused',
  );
  assert.equal(
    suiteFailureDetail(multiline),
    `suite failed: ${multiline.stderr}`,
    'the receipt diagnostic must retain the complete multiline stderr',
  );

  const thrownValue = failingNode("throw 'seed witness exploded without Error prefix'");
  assert.equal(
    suiteFailureDiagnostic(thrownValue),
    'suite failed: seed witness exploded without Error prefix',
  );
});

test('versioned-seed Rust witnesses are counted from exact executed test records', () => {
  const expected = ['versioned_seed_one', 'versioned_seed_two'];
  const renamed = observeRustWitnesses(
    'running 2 tests\n'
      + 'test storage::tests::versioned_seed_one_suffix ... ok\n'
      + 'test storage::tests::versioned_seed_two ... ok\n'
      + 'test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 10 filtered out;\n',
    expected,
  );
  assert.deepEqual(renamed.executedWitnesses, ['versioned_seed_two']);
  assert.deepEqual(renamed.missingWitnesses, ['versioned_seed_one']);

  const replaced = observeRustWitnesses(
    'running 2 tests\n'
      + 'test storage::tests::versioned_seed_replacement_a ... ok\n'
      + 'test storage::tests::versioned_seed_replacement_b ... ok\n',
    expected,
  );
  assert.equal(replaced.executedTests.length, 2);
  assert.deepEqual(replaced.executedWitnesses, []);

  const none = observeRustWitnesses(
    'running 0 tests\ntest result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 12 filtered out;\n',
    expected,
  );
  assert.deepEqual(none.executedTests, []);
});

test('the canonical proof has named gates and its producer edges are closed', () => {
  const result = checkLocalProof();
  assert(result.gateCount > 80, 'the canonical inventory unexpectedly became vacuous');
  assert(result.uniqueGateCount > 80, 'the canonical stable-id inventory unexpectedly shrank');
  assert(result.inapplicabilityDeclarationCount > 0, 'host applicability inventory is empty');

  const source = readFileSync(resolve(root, 'scripts/verify-local-proof'), 'utf8');
  const rustTests = parseGateCalls(source).find(({ gateId }) => gateId === 'rust-tests');
  assert.equal(rustTests?.timeoutSeconds, 3600, 'the workspace Rust gate needs an explicit cap');
  assert.match(
    rustTests?.command ?? '',
    /NEXTEST_TEST_THREADS="\$\{SNAPBACK_RUST_TEST_THREADS:-4\}" scripts\/run-cargo-nextest --profile local-proof --workspace --no-fail-fast/u,
    'the Rust inventory must use the bounded local-proof nextest profile without target fail-fast',
  );
  assert.doesNotMatch(
    rustTests?.command ?? '',
    /cargo test/u,
    'the canonical Rust gate must never silently fall back to cargo test',
  );
  const rustDocTests = parseGateCalls(source).find(({ gateId }) => gateId === 'rust-doc-tests');
  assert.equal(rustDocTests?.timeoutSeconds, 3600, 'workspace doctests need an explicit cap');
  assert.match(
    rustDocTests?.command ?? '',
    /cargo test --workspace --doc --no-fail-fast -- --test-threads/u,
    'the explicit doctest complement must preserve cargo-test coverage nextest does not run',
  );
  const decision = source.indexOf('cargo-target-headroom.mjs --cleanup-decision');
  const clean = source.indexOf('run cargo-test-profile-clean -- cargo clean --profile test');
  assert(decision >= 0 && clean > decision, 'CI must decide measured headroom before cleaning test artifacts');
  assert.doesNotMatch(
    source.slice(0, decision),
    /cargo clean --profile test/u,
    'cleanup must not manufacture headroom before the decision',
  );
  assert.match(
    source,
    /build_current_binary\(\)[\s\S]*cargo clean -p snapback[\s\S]*env[\s\S]*SNAPBACK_BUILD_GIT_COMMIT="\$SNAPBACK_BUILD_GIT_COMMIT"[\s\S]*SNAPBACK_BUILD_GIT_DIRTY="\$SNAPBACK_BUILD_GIT_DIRTY"[\s\S]*cargo build --locked --bin snapback[\s\S]*SNAPBACK_BUILD_IDENTITY_MISMATCH[\s\S]*run current-binary-build[^\n]*build_current_binary/u,
    'the final acceptance binary must replay and verify its explicit proof identity without discarding dependency artifacts',
  );
  assert.match(
    source,
    /run generated-artifacts[^\n]*[\s\S]*run drift-prone-gate-fixtures --requires generated-artifacts/u,
    'committed-history fixtures must run after their ignored generated inputs are produced',
  );
  assert.match(
    source,
    /run admin-ui-build -- bash -c[\s\S]*bun install --frozen-lockfile --cwd admin-ui && admin-ui\/build\.sh[\s\S]*run runtime-package-stage --requires current-binary-readiness,admin-ui-build/u,
    'Linux runtime staging must consume a canonically built admin console snapshot',
  );

  const seedDispatcher = readFileSync(
    resolve(root, 'tests/conformance/run-versioned-seed-v1.mjs'),
    'utf8',
  );
  assert.match(
    seedDispatcher,
    /readCheckoutRuntimeIdentity\(root\)/u,
    'versioned-seed revision binding must use the shared runtime-input dirtiness scope',
  );
  assert.doesNotMatch(
    seedDispatcher,
    /spawnSync\('git', \['status', '--porcelain'/u,
    'versioned-seed revision binding must not reintroduce a whole-tree dirty probe',
  );

  const seedSuite = readFileSync(
    resolve(root, 'tests/conformance/versioned-seed-v1-suite.mjs'),
    'utf8',
  );
  assert.match(
    seedSuite,
    /const explicitCurrentBinary = process\.env\.SNAPBACK_BINARY;[\s\S]*if \(!explicitCurrentBinary\) \{[\s\S]*spawnSync\('cargo', \['build', '--quiet', '--bin', 'snapback'\]/u,
    'versioned-seed must not rebuild and overwrite the qualified root binary when an explicit carrier is supplied',
  );
});

test('the cargo-nextest launcher refuses a missing runner without fallback', () => {
  const launcher = resolve(root, 'scripts/run-cargo-nextest');
  const result = spawnSync(launcher, [], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SNAPBACK_CARGO_NEXTEST_BIN: 'cargo-nextest-deliberately-missing',
    },
  });
  assert.equal(result.status, 127, result.stderr);
  assert.match(result.stderr, /^SNAPBACK_CARGO_NEXTEST_MISSING:/mu);
  assert.match(
    result.stderr,
    /cargo install cargo-nextest --version 0\.9\.143 --locked/u,
  );
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /cargo test/u);
});

test('host inapplicability declarations are literal, known gate/predicate pairs', () => {
  const canonical = readFileSync(resolve(root, 'scripts/verify-local-proof'), 'utf8');
  assert.match(
    canonical,
    /proof_runner_declare_inapplicable admin-ui-build linux-host/u,
    'the Linux-only admin build prerequisite must be statically inventoried',
  );
  const mutated = canonical.replace(
    'proof_runner_declare_inapplicable runtime-package-stage linux-host',
    'proof_runner_declare_inapplicable runtime-package-stage invented-host-predicate',
  );
  assert.throws(
    () => checkLocalProof(mutated),
    /unknown predicate invented-host-predicate/u,
  );
});

test('a newly inventoried real-server test without the binary prerequisite fails closed', () => {
  const canonical = readFileSync(resolve(root, 'scripts/verify-local-proof'), 'utf8');
  const mutated = `${canonical}\nrun omitted-edge -- node demos/todo/tests/acceptance/headless.mjs\n`;
  assert.throws(
    () => validateGateCalls(parseGateCalls(mutated)),
    /real-server gate omitted-edge .* must require current-binary-readiness/u,
  );
});

test('browser availability is a strict producer, not an ambient skip', () => {
  const checker = resolve(root, 'scripts/check-browser-availability');
  const available = spawnSync(checker, [], {
    encoding: 'utf8',
    env: { ...process.env, CHROME_BIN: process.execPath },
  });
  assert.equal(available.status, 0, available.stderr);
  assert.match(available.stdout, /available/u);

  const missing = spawnSync(checker, [], {
    encoding: 'utf8',
    env: { ...process.env, CHROME_BIN: resolve(root, 'target', 'definitely-missing-chrome') },
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /SNAPBACK_CAPABILITY_CHROME_MISSING/u);
});
