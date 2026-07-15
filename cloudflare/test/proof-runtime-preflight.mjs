#!/usr/bin/env node
// Unit gate for the Cloudflare proof-runtime preflight (ENG-24454). Drives the
// version-comparison logic with injected version strings so its correctness is
// asserted independent of the Node major this process happens to run under —
// it must pass on the pinned Node 24 and would pass on 25 too if it ever ran
// there (the runner refuses the gate before reaching it under Node 25).
//
// @ref LLP 0040#proof-runtime-preflight-2026-07-14-eng-24454 — the preflight
// constrains the supported proof runtime; this pins its comparison + diagnostic.
import assert from 'node:assert/strict';
import {
  PROOF_NODE_UNSUPPORTED_CODE,
  parseNodeMajor,
  evaluateProofNodeSupport,
  formatUnsupportedNodeDiagnostic,
  readPinnedNodeVersion,
  assertProofRuntimeNode,
} from './proof-runtime.mjs';

// parseNodeMajor accepts exact semver cores with or without a leading v.
assert.equal(parseNodeMajor('24.18.0'), 24);
assert.equal(parseNodeMajor('v25.9.0'), 25);
assert.equal(parseNodeMajor('24.14.0'), 24);
for (const bad of ['', '24', '24.x', 'v24', 'node-24', null, undefined, '24.18']) {
  assert.throws(() => parseNodeMajor(bad), /not an exact semver/, `expected reject: ${JSON.stringify(bad)}`);
}

// The reported failure surface: active Node 25.9.0 against a Node-24 authority.
const rejected = evaluateProofNodeSupport({ activeVersion: '25.9.0', pinnedVersion: '24.18.0' });
assert.equal(rejected.supported, false);
assert.equal(rejected.activeMajor, 25);
assert.equal(rejected.pinnedMajor, 24);

// Patch/minor drift within the supported major is not this preflight's concern.
for (const active of ['24.18.0', '24.14.0', 'v24.0.0', '24.99.7']) {
  assert.equal(
    evaluateProofNodeSupport({ activeVersion: active, pinnedVersion: '24.18.0' }).supported,
    true,
    `same-major must be supported: ${active}`,
  );
}
// A lower major is equally unsupported — support is exact-major, not a floor.
assert.equal(evaluateProofNodeSupport({ activeVersion: '22.12.0', pinnedVersion: '24.18.0' }).supported, false);
assert.equal(evaluateProofNodeSupport({ activeVersion: '26.0.0', pinnedVersion: '24.18.0' }).supported, false);

// The diagnostic is actionable: it names the code, both versions/majors, the
// ECONNRESET surface, and directs the runner to the pinned Node.
const diagnostic = formatUnsupportedNodeDiagnostic(rejected);
assert.ok(diagnostic.startsWith(PROOF_NODE_UNSUPPORTED_CODE), 'diagnostic must lead with the stable code');
for (const needle of ['25.9.0', '24.18.0', 'major 25', '24.x', 'ECONNRESET', '.node-version']) {
  assert.ok(diagnostic.includes(needle), `diagnostic missing ${needle}`);
}

// assertProofRuntimeNode throws with the stable code on a mismatch and returns
// the evaluation (never throwing) when the major matches — both via injection.
let thrown;
try {
  assertProofRuntimeNode({ activeVersion: '25.9.0', pinnedVersion: '24.18.0' });
} catch (error) {
  thrown = error;
}
assert.ok(thrown, 'assertProofRuntimeNode must throw on an unsupported major');
assert.equal(thrown.code, PROOF_NODE_UNSUPPORTED_CODE);
assert.ok(thrown.message.includes('ECONNRESET'));
const ok = assertProofRuntimeNode({ activeVersion: '24.14.0', pinnedVersion: '24.18.0' });
assert.equal(ok.supported, true);

// The pinned authority resolves to an exact semver read from .node-version.
const pinned = readPinnedNodeVersion();
assert.match(pinned, /^\d+\.\d+\.\d+$/, '.node-version must be an exact semver');

console.log(`cloudflare proof-runtime preflight: node-major gate and diagnostic verified (pinned ${pinned})`);
