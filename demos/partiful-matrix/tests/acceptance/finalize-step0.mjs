import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { manifestSemanticSha256, sha256 } from './manifest-semantics.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const acceptanceRoot = resolve(here, '..', '..', 'acceptance');
const option = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? fallback : process.argv[at + 1];
};
const output = resolve(repoRoot, option(
  'out',
  'demos/partiful-matrix/acceptance/results/step0-complete.json',
));
const manifest = JSON.parse(readFileSync(resolve(acceptanceRoot, 'claims.v1.json'), 'utf8'));
const protocol = JSON.parse(readFileSync(resolve(acceptanceRoot, 'comparison-protocol.v1.json'), 'utf8'));
const prerequisites = manifest.claims.filter(({ step, id }) => step === 0 && id !== 'STEP0.COMPLETE');
assert.ok(prerequisites.length > 0, 'Step 0 has no prerequisites');
assert.deepEqual(
  prerequisites.filter(({ status }) => status !== 'passing').map(({ id, status }) => ({ id, status })),
  [],
  'Step 0 has non-passing prerequisites',
);

const prerequisiteArtifacts = prerequisites.map((claim) => {
  assert.ok(claim.artifact, `${claim.id} has no artifact`);
  const bytes = readFileSync(resolve(repoRoot, claim.artifact.path));
  assert.equal(sha256(bytes), claim.artifact.sha256, `${claim.id} artifact drifted`);
  return { id: claim.id, witnessClass: claim.witnessClass, artifact: claim.artifact };
});
const native = JSON.parse(readFileSync(resolve(acceptanceRoot, 'results/step0-native.json'), 'utf8'));
const sharedPath = resolve(acceptanceRoot, 'results/step0-shared-manifest-contract.json');
const shared = JSON.parse(readFileSync(sharedPath, 'utf8'));
assert.equal(shared.ok, true, 'shared-manifest contract did not pass');
assert.equal(shared.manifestSemanticSha256, manifestSemanticSha256(manifest));

const result = {
  schemaVersion: 'partitime.step0-complete.v1',
  claimId: 'STEP0.COMPLETE',
  ok: true,
  outcome: 'pass',
  manifestId: manifest.manifestId,
  workloadVersion: manifest.workloadVersion,
  manifestSemanticSha256: manifestSemanticSha256(manifest),
  methodId: protocol.protocolId,
  thresholdFormulaSetId: protocol.thresholdFormulaSetId,
  prerequisiteCount: prerequisiteArtifacts.length,
  prerequisites: prerequisiteArtifacts,
  nativeChildren: native.children.map(({ name, path, sha256: digest }) => ({ name, path, sha256: digest })),
  sharedManifestContract: {
    path: 'demos/partiful-matrix/acceptance/results/step0-shared-manifest-contract.json',
    sha256: sha256(readFileSync(sharedPath)),
    exactRevision: shared.exact.revision,
  },
  inputs: {
    semantics: {
      path: 'demos/partiful-matrix/tests/acceptance/manifest-semantics.mjs',
      sha256: sha256(readFileSync(resolve(here, 'manifest-semantics.mjs'))),
    },
    generator: {
      path: 'demos/partiful-matrix/tests/acceptance/finalize-step0.mjs',
      sha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
    },
  },
};

mkdirSync(dirname(output), { recursive: true });
const temporary = `${output}.tmp-${process.pid}`;
writeFileSync(temporary, `${JSON.stringify(result, null, 2)}\n`);
renameSync(temporary, output);
console.log(JSON.stringify(result));
