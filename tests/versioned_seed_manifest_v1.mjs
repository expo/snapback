import assert from 'node:assert/strict';
import { accessSync, constants, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const path = new URL('./conformance/versioned-seed-v1.manifest.json', import.meta.url);
const manifest = JSON.parse(readFileSync(path, 'utf8'));
const runners = new Set([
  'http', 'cli', 'host-op', 'vite', 'package', 'restore', 'migration',
  'predecessor', 'fault', 'storage', 'auth', 'hosted-gap',
]);

assert.equal(manifest.artifactKind, 'snapback.versioned-seed-conformance.v1');
assert.equal(manifest.schemaVersion, 'snapback.versioned-seed-conformance-manifest.v1');
assert.equal(manifest.formatVersion, 1);
assert.deepEqual(
  [...manifest.capabilities].sort(),
  ['versioned_seed_install_v1', 'versioned_seed_reset_v1'],
);
assert.match(manifest.predecessorArtifact.gitCommit, /^[0-9a-f]{8,40}$/);
assert.equal(manifest.predecessorArtifact.required, true);
assert.ok(manifest.cases.length > 0, 'versioned-seed manifest is non-vacuous');
assert.equal(new Set(manifest.cases.map(({ id }) => id)).size, manifest.cases.length);

for (const entry of manifest.cases) {
  assert.match(entry.id, /^[a-z0-9][a-z0-9-]*$/);
  assert.ok(runners.has(entry.runner), `unknown runner ${entry.runner}`);
  assert.ok(['required', 'gap'].includes(entry.status));
  assert.equal(typeof entry.entrypoint, 'string');
  assert.equal(Number.isSafeInteger(entry.expectedAssertions), true);
  assert.ok(Array.isArray(entry.capabilityPredicate));
  accessSync(resolve(new URL('..', import.meta.url).pathname, entry.entrypoint), constants.X_OK);
  if (entry.status === 'gap') {
    assert.equal(entry.runner, 'hosted-gap');
    assert.equal(typeof entry.gap, 'string');
    assert.ok(entry.gap.length > 0);
    assert.equal(entry.expectedAssertions, 0);
  } else {
    assert.equal(entry.gap, undefined);
    assert.ok(entry.expectedAssertions > 0);
  }
}

const mandatory = manifest.cases.filter(({ status }) => status === 'required');
assert.ok(mandatory.some(({ runner }) => runner === 'predecessor'));
assert.ok(mandatory.some(({ runner }) => runner === 'fault'));
assert.ok(mandatory.some(({ runner }) => runner === 'package'));
assert.ok(manifest.cases.some(({ runner }) => runner === 'hosted-gap'));

console.log(`Versioned seed conformance manifest — pass (${mandatory.length} mandatory, 1 GAP)`);
