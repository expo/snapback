import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  manifestSemanticProjection,
  manifestSemanticSha256,
  sha256,
} from './manifest-semantics.mjs';

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
const laterClaimBootstrap = process.argv.includes('--append-only-later-claims-bootstrap');
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
if (shared.manifestSemanticSha256 !== manifestSemanticSha256(manifest)) {
  assert.equal(
    laterClaimBootstrap,
    true,
    'shared-manifest semantics differ; use the append-only later-claims bootstrap only for a proven post-Step-0 claim addition',
  );
  assertAppendOnlyLaterClaims(shared.manifestSemanticSha256, manifest);
}

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

function assertAppendOnlyLaterClaims(previousSemanticSha256, currentManifest) {
  const distributionRoot = resolve(acceptanceRoot, 'distribution');
  const candidates = readdirSync(distributionRoot)
    .filter((name) => /^claims\.v1\.[a-f0-9]{64}\.json$/.test(name))
    .map((name) => JSON.parse(readFileSync(resolve(distributionRoot, name), 'utf8')))
    .filter((candidate) => manifestSemanticSha256(candidate) === previousSemanticSha256);
  assert.ok(candidates.length > 0, 'the prior shared-manifest semantics have no retained content-addressed authority bundle');

  const previous = manifestSemanticProjection(candidates[0]);
  const current = manifestSemanticProjection(currentManifest);
  const withoutClaimsAndOutcomes = ({ claims: _claims, outcomes: _outcomes, ...rest }) => rest;
  assert.deepEqual(
    withoutClaimsAndOutcomes(current),
    withoutClaimsAndOutcomes(previous),
    'append-only bootstrap changed manifest authority, workload, or comparison semantics',
  );

  const currentClaims = new Map(current.claims.map((claim) => [claim.id, claim]));
  for (const priorClaim of previous.claims) {
    assert.deepEqual(
      currentClaims.get(priorClaim.id),
      priorClaim,
      `append-only bootstrap changed existing claim semantics: ${priorClaim.id}`,
    );
  }
  const priorIds = new Set(previous.claims.map(({ id }) => id));
  const additions = current.claims.filter(({ id }) => !priorIds.has(id));
  assert.ok(additions.length > 0, 'append-only bootstrap found no new claims');
  assert.ok(
    additions.every(({ step }) => step > 0),
    'append-only bootstrap may add only post-Step-0 claims',
  );

  assert.deepEqual(Object.keys(current.outcomes).sort(), Object.keys(previous.outcomes).sort());
  for (const [outcome, prior] of Object.entries(previous.outcomes)) {
    const next = current.outcomes[outcome];
    const { mandatoryClaimIds: _priorIds, ...priorPolicy } = prior;
    const { mandatoryClaimIds: _nextIds, ...nextPolicy } = next;
    assert.deepEqual(nextPolicy, priorPolicy, `append-only bootstrap changed ${outcome} policy`);
    assert.deepEqual(
      next.mandatoryClaimIds.filter((id) => prior.mandatoryClaimIds.includes(id)),
      prior.mandatoryClaimIds,
      `append-only bootstrap removed or reordered existing ${outcome} claims`,
    );
    assert.ok(
      next.mandatoryClaimIds
        .filter((id) => !prior.mandatoryClaimIds.includes(id))
        .every((id) => additions.some((claim) => claim.id === id)),
      `append-only bootstrap added an unknown ${outcome} claim`,
    );
  }
}
