import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  checkLocalProof,
  parseGateCalls,
  validateGateCalls,
} from '../scripts/check-local-proof-gates.mjs';

const root = resolve(import.meta.dirname, '..');

test('the canonical proof has named gates and its producer edges are closed', () => {
  const result = checkLocalProof();
  assert(result.gateCount > 80, 'the canonical inventory unexpectedly became vacuous');
  assert(result.uniqueGateCount > 80, 'the canonical stable-id inventory unexpectedly shrank');

  const source = readFileSync(resolve(root, 'scripts/verify-local-proof'), 'utf8');
  const rustTests = parseGateCalls(source).find(({ gateId }) => gateId === 'rust-tests');
  assert.equal(rustTests?.timeoutSeconds, 3600, 'the workspace Rust gate needs an explicit cap');
  assert.match(rustTests?.command ?? '', /cargo test --workspace --no-fail-fast --/u);
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
