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
  const decision = source.indexOf('cargo-target-headroom.mjs --cleanup-decision');
  const clean = source.indexOf('run cargo-test-profile-clean -- cargo clean --profile test');
  assert(decision >= 0 && clean > decision, 'CI must decide measured headroom before cleaning test artifacts');
  assert.doesNotMatch(
    source.slice(0, decision),
    /cargo clean --profile test/u,
    'cleanup must not manufacture headroom before the decision',
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
