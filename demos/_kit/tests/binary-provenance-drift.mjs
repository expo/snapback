// Real-binary drift proof (issues/20260724-kit-identity-stamp-env-injection-tautology).
//
// The lifecycle suite proves the kit's identity logic against a fixture; this
// suite proves it end-to-end against the REAL build.rs-stamped binary: boot
// `target/debug/snapback` while claiming a checkout identity it was not built
// from, and require the kit to either detect the mismatch or honestly report
// it unverifiable — never confirm it. Before the env-injection removal this
// comparison was self-confirming on the default `cargo run` path (the child
// was stamped with the very value it was compared against), so no test could
// fail here for stamp reasons.
//
// Skips cleanly when the binary has not been built (bootstrap not run yet):
// the point is the stamp semantics, not forcing a compile.

import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { __startServerForTests } from '../server-process.mjs';
import { readCheckoutBinaryIdentity } from '../provenance.mjs';

const repoRoot = resolve(import.meta.dirname, '..', '..', '..');
const binary = join(
  repoRoot,
  'target',
  'debug',
  process.platform === 'win32' ? 'snapback.exe' : 'snapback',
);

if (!existsSync(binary)) {
  console.log(
    `binary-provenance-drift: SKIP (${binary} is not built; run scripts/bootstrap-ibex-runtime first)`,
  );
  process.exit(0);
}

// A commit hash that no real checkout will ever produce: whatever the binary
// was actually stamped with, comparing against this MUST NOT verify.
const DRIFTED = {
  gitCommit: 'f'.repeat(40),
  gitDirty: false,
  crateVersion: null,
};

const running = [];
try {
  const server = await __startServerForTests(
    { port: 0, cwd: repoRoot, serverBinary: binary, startupTimeoutMs: 30_000 },
    { expectedIdentity: DRIFTED },
  );
  running.push(server);
  assert.equal(server.launch.rung, 'configured');
  assert(
    server.identity.verdict === 'stamp-mismatch' || server.identity.verdict === 'unverifiable',
    `a drifted expectation must be detected or reported unverifiable, got "${server.identity.verdict}" ` +
      `(binary stamp: ${JSON.stringify(server.identity.binary)})`,
  );
  if (server.identity.verdict === 'stamp-mismatch') {
    assert.match(server.identity.mismatches[0], /does not match checkout f{12}/);
  }
  console.log(
    `binary-provenance-drift: drifted expectation → ${server.identity.verdict} ` +
      `(binary stamped ${server.identity.binary.gitCommit ?? 'unknown'}` +
      `${server.identity.binary.gitDirty === false ? '' : '+dirty/unknown'})`,
  );
  await server.stop();
  running.splice(running.indexOf(server), 1);

  // Honesty against the real checkout identity: whatever the actual state is,
  // the verdict must be consistent with it — verified only when both sides
  // are pinned to the same clean commit.
  const checkout = readCheckoutBinaryIdentity(repoRoot);
  const honest = await __startServerForTests(
    { port: 0, cwd: repoRoot, serverBinary: binary, startupTimeoutMs: 30_000 },
    {},
  );
  running.push(honest);
  if (honest.identity.verdict === 'verified') {
    assert.equal(checkout.gitDirty, false, 'verified requires a clean checkout');
    assert.equal(honest.identity.binary.gitCommit, checkout.gitCommit);
    assert.equal(honest.identity.binary.gitDirty, false, 'verified requires a clean-stamped binary');
  }
  console.log(
    `binary-provenance-drift: real checkout (${checkout.gitCommit?.slice(0, 12) ?? 'unknown'}` +
      `${checkout.gitDirty ? '+dirty' : ''}) → ${honest.identity.verdict}`,
  );
  await honest.stop();
  running.splice(running.indexOf(honest), 1);

  console.log('binary-provenance-drift: PASS');
} finally {
  await Promise.allSettled(running.map((server) => server.stop()));
}
