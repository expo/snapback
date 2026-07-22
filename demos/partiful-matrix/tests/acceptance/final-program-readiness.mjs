#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { manifestSemanticSha256 } from './manifest-semantics.mjs';

// @ref LLP 0063#sequence
// @ref Exact LLP 0373#8-success-scorecard
//
// Final proof is conjunctive. This witness validates current artifact bytes
// and reports the exact non-passing mandatory set for every frozen outcome;
// it cannot turn an incomplete program into an immutable-revision pass.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const option = (name, fallback = null) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? fallback : process.argv[at + 1];
};
const output = resolve(repoRoot, option(
  'out',
  'demos/partiful-matrix/acceptance/results/final-program-readiness.json',
));
const suppliedSnapbackRevision = option('snapback-revision');
const suppliedExactRevision = option('exact-revision');
const requirePass = process.argv.includes('--require-pass');
const manifestPath = 'demos/partiful-matrix/acceptance/claims.v1.json';
const lockPath = 'demos/partiful-matrix/acceptance/claims.v1.sha256';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const identity = (path) => ({ path, sha256: sha256(readFileSync(resolve(repoRoot, path))) });
const manifestBytes = readFileSync(resolve(repoRoot, manifestPath));
const manifest = JSON.parse(manifestBytes);
const manifestSha256 = sha256(manifestBytes);
assert.equal(readFileSync(resolve(repoRoot, lockPath), 'utf8').trim(), manifestSha256);
const semanticSha256 = manifestSemanticSha256(manifest);

const finalClaimId = 'FINAL.IMMUTABLE_REVISION_SET';
const finalClaim = manifest.claims.find(({ id }) => id === finalClaimId);
assert.ok(finalClaim, `${finalClaimId} is absent`);
const artifactValidation = manifest.claims
  .filter(({ id, artifact }) => id !== finalClaimId && artifact)
  .map(({ id, artifact }) => {
    const present = existsSync(resolve(repoRoot, artifact.path));
    const actualSha256 = present ? sha256(readFileSync(resolve(repoRoot, artifact.path))) : null;
    return {
      claimId: id,
      path: artifact.path,
      expectedSha256: artifact.sha256,
      actualSha256,
      ok: present && actualSha256 === artifact.sha256,
    };
  });
assert.deepEqual(
  artifactValidation.filter(({ ok }) => !ok),
  [],
  'one or more retained claim artifacts are absent or drifted',
);

const claims = new Map(manifest.claims.map((claim) => [claim.id, claim]));
const outcomes = Object.fromEntries(Object.entries(manifest.outcomes).map(([name, policy]) => {
  const prerequisites = policy.mandatoryClaimIds.filter((id) => id !== finalClaimId).map((id) => {
    const claim = claims.get(id);
    assert.ok(claim, `${name} names unknown claim ${id}`);
    return { id, status: claim.status, artifact: claim.artifact ?? null };
  });
  const nonPassing = prerequisites.filter(({ status }) => status !== 'passing');
  return [name, {
    mandatoryClaimCount: policy.mandatoryClaimIds.length,
    prerequisiteCount: prerequisites.length,
    passingPrerequisiteCount: prerequisites.length - nonPassing.length,
    nonPassing,
    prerequisitesPass: nonPassing.length === 0,
  }];
}));
const allOutcomesPass = Object.values(outcomes).every(({ prerequisitesPass }) => prerequisitesPass);
const immutableIdentityComplete = Boolean(suppliedSnapbackRevision) && Boolean(suppliedExactRevision);
const gatePass = allOutcomesPass && immutableIdentityComplete;
const statusCounts = Object.fromEntries(
  [...new Set(manifest.claims.map(({ status }) => status))].sort().map((status) => [
    status,
    manifest.claims.filter((claim) => claim.status === status).length,
  ]),
);
const report = {
  schemaVersion: 'partitime.final-program-readiness.v1',
  claimId: finalClaimId,
  ok: gatePass,
  disposition: gatePass ? 'ready-to-finalize-immutable-revision-set' : 'not-ready',
  manifest: {
    path: manifestPath,
    semanticSha256,
    claimCount: manifest.claims.length,
    statusCounts,
    selfReferenceRule: 'The final claim artifact and mutable statuses are excluded from the semantic digest; a later unreferenced cross-repository receipt binds the final full manifest bytes.',
  },
  artifactValidation: {
    checked: artifactValidation.length,
    allMatch: true,
    artifacts: artifactValidation,
  },
  immutableRevisionSet: {
    snapbackRevision: suppliedSnapbackRevision,
    exactRevision: suppliedExactRevision,
    complete: immutableIdentityComplete,
  },
  outcomes,
  blockers: [
    ...(!suppliedSnapbackRevision ? [{ kind: 'missing-final-snapback-revision' }] : []),
    ...Object.entries(outcomes).flatMap(([outcome, value]) => value.nonPassing.map(({ id, status }) => ({
      kind: 'mandatory-claim-not-passing', outcome, claimId: id, status,
    }))),
  ],
  rule: 'Every frozen mandatory claim must pass on one immutable two-repository revision set; no outcome may infer or waive a missing claim.',
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
if (requirePass && !gatePass) process.exitCode = 1;
