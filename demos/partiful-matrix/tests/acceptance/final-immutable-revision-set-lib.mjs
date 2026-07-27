import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import {
  manifestSemanticSha256,
  sha256,
} from './manifest-semantics.mjs';

export const FINAL_CLAIM_ID = 'FINAL.IMMUTABLE_REVISION_SET';
export const TERMINAL_PROFILE_ID = 'full-north-star';

export function assertFullRevision(revision, label) {
  assert.match(
    revision ?? '',
    /^[0-9a-f]{40}$/,
    `${label} must be one full 40-character Git revision`,
  );
}

function repoRelativePath(repoRoot, path) {
  assert.equal(isAbsolute(path), false, `artifact path must be repository-relative: ${path}`);
  const absolute = resolve(repoRoot, path);
  const fromRoot = relative(repoRoot, absolute);
  assert.ok(
    fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot),
    `artifact path escapes the repository: ${path}`,
  );
  return fromRoot.split(sep).join('/');
}

function readIdentity(repoRoot, path) {
  const safePath = repoRelativePath(repoRoot, path);
  const bytes = readFileSync(resolve(repoRoot, safePath));
  return {
    path: safePath,
    sha256: sha256(bytes),
  };
}

function artifactEvidence(repoRoot, claim) {
  const blockers = [];
  const evidence = {
    id: claim.id,
    status: claim.status,
    witnessClass: claim.witnessClass,
    artifact: claim.artifact,
  };

  if (claim.status !== 'passing') {
    blockers.push({
      claimId: claim.id,
      reason: 'claim-status',
      status: claim.status,
    });
    return { evidence, blockers };
  }

  if (!claim.artifact) {
    blockers.push({
      claimId: claim.id,
      reason: 'passing-claim-has-no-artifact',
    });
    return { evidence, blockers };
  }

  let actual;
  try {
    actual = readIdentity(repoRoot, claim.artifact.path);
  } catch (error) {
    blockers.push({
      claimId: claim.id,
      reason: 'artifact-unreadable',
      path: claim.artifact.path,
      detail: error instanceof Error ? error.message : String(error),
    });
    return { evidence, blockers };
  }

  evidence.artifact = {
    ...claim.artifact,
    observedSha256: actual.sha256,
  };
  if (actual.sha256 !== claim.artifact.sha256) {
    blockers.push({
      claimId: claim.id,
      reason: 'artifact-digest-mismatch',
      path: claim.artifact.path,
      declaredSha256: claim.artifact.sha256,
      observedSha256: actual.sha256,
    });
  }
  return { evidence, blockers };
}

/**
 * Build the versioned target-profile matrix from the cumulative authority.
 *
 * @ref LLP 0063#sequence — FINAL.IMMUTABLE_REVISION_SET is the aggregate
 * result named by every outcome. It is intentionally removed from each
 * profile's prerequisites so the aggregate can never satisfy itself.
 */
export function evaluateTargetProfiles(manifest, repoRoot) {
  assert.equal(manifest.schemaVersion, 'partitime.claims.v1');
  const claims = new Map();
  for (const claim of manifest.claims) {
    assert.equal(claims.has(claim.id), false, `duplicate claim id ${claim.id}`);
    claims.set(claim.id, claim);
  }
  assert.ok(claims.has(FINAL_CLAIM_ID), `manifest is missing ${FINAL_CLAIM_ID}`);
  assert.ok(
    Object.prototype.hasOwnProperty.call(manifest.outcomes, TERMINAL_PROFILE_ID),
    `manifest is missing terminal profile ${TERMINAL_PROFILE_ID}`,
  );

  return Object.entries(manifest.outcomes).map(([profileId, profile]) => {
    const mandatoryClaimIds = profile.mandatoryClaimIds;
    assert.equal(
      mandatoryClaimIds.filter((id) => id === FINAL_CLAIM_ID).length,
      1,
      `${profileId} must name ${FINAL_CLAIM_ID} exactly once`,
    );
    assert.equal(
      new Set(mandatoryClaimIds).size,
      mandatoryClaimIds.length,
      `${profileId} has duplicate mandatory claims`,
    );

    const prerequisiteClaims = [];
    const blockers = [];
    for (const id of mandatoryClaimIds) {
      const claim = claims.get(id);
      assert.ok(claim, `${profileId} names unknown claim ${id}`);
      if (id === FINAL_CLAIM_ID) {
        continue;
      }
      const evaluated = artifactEvidence(repoRoot, claim);
      prerequisiteClaims.push(evaluated.evidence);
      blockers.push(...evaluated.blockers);
    }

    return {
      profileId,
      terminal: profileId === TERMINAL_PROFILE_ID,
      mandatoryClaimIds,
      aggregateClaimId: FINAL_CLAIM_ID,
      prerequisiteClaims,
      blockers,
      claimSatisfied: blockers.length === 0,
    };
  });
}

function packageSetDigest(packages) {
  return sha256(Buffer.from(JSON.stringify(packages)));
}

export function readSnapbackPublicationPackageSet(
  repoRoot,
  path = 'demos/partiful-matrix/acceptance/results/step5-packaged-loop.json',
) {
  const input = readIdentity(repoRoot, path);
  const receipt = JSON.parse(readFileSync(resolve(repoRoot, input.path), 'utf8'));
  assert.equal(receipt.schemaVersion, 'snapback.package-cold-install.aggregate.v1');
  assert.equal(receipt.claimSatisfied, true, 'Snapback publication receipt is not passing');
  assert.equal(receipt.sourceDirty, false, 'Snapback publication receipt came from dirty source');
  assertFullRevision(receipt.sourceRevision, 'Snapback package source revision');
  assert.ok(receipt.packages.length > 0, 'Snapback publication receipt has no packages');

  const packages = receipt.packages.map((entry) => {
    assert.match(entry.registrySha256 ?? '', /^[0-9a-f]{64}$/);
    assert.match(entry.registryIntegrity ?? '', /^sha512-[A-Za-z0-9+/=]+$/);
    assert.ok(entry.publishedName);
    assert.ok(entry.sourceName);
    assert.ok(entry.version);
    return {
      sourceName: entry.sourceName,
      publishedName: entry.publishedName,
      version: entry.version,
      registrySha256: entry.registrySha256,
      registryIntegrity: entry.registryIntegrity,
    };
  });

  return {
    packageSetId: 'snapback-published-runtime',
    packageCount: packages.length,
    sourceRevision: receipt.sourceRevision,
    input,
    packages,
    packageSetSha256: packageSetDigest(packages),
  };
}

export function parseExactPackagesFromBunLock(lockText) {
  const rows = [];
  const pattern =
    /^\s+"(@(?:exact|ibex)\/[^"]+)": \["(@ccheever\/exact-[^"@]+)@([^"]+)",[^\n]*"(sha512-[A-Za-z0-9+/=]+)"\],?$/gm;
  for (const match of lockText.matchAll(pattern)) {
    rows.push({
      sourceName: match[1],
      publishedName: match[2],
      version: match[3],
      registryIntegrity: match[4],
    });
  }
  rows.sort((a, b) => a.sourceName.localeCompare(b.sourceName));
  assert.ok(rows.length > 0, 'Contract consumer lock contains no published Exact packages');
  assert.equal(
    new Set(rows.map(({ sourceName }) => sourceName)).size,
    rows.length,
    'Contract consumer lock contains duplicate Exact source identities',
  );
  return rows;
}

export function readExactConsumerPackageSet(
  repoRoot,
  {
    manifestPath = 'demos/partiful-matrix/surfaces/contract/package.json',
    lockPath = 'demos/partiful-matrix/surfaces/contract/bun.lock',
  } = {},
) {
  const manifestInput = readIdentity(repoRoot, manifestPath);
  const lockInput = readIdentity(repoRoot, lockPath);
  const manifest = JSON.parse(readFileSync(resolve(repoRoot, manifestInput.path), 'utf8'));
  const packages = parseExactPackagesFromBunLock(
    readFileSync(resolve(repoRoot, lockInput.path), 'utf8'),
  );
  const packageByPublishedName = new Map(
    packages.map((entry) => [`${entry.publishedName}@${entry.version}`, entry]),
  );

  const directAliases = Object.values({
    ...(manifest.dependencies ?? {}),
    ...(manifest.devDependencies ?? {}),
  }).filter(
    (specifier) =>
      typeof specifier === 'string' && specifier.startsWith('npm:@ccheever/exact-'),
  );
  assert.ok(directAliases.length > 0, 'Contract consumer manifest has no published Exact aliases');
  for (const specifier of directAliases) {
    const identity = specifier.slice('npm:'.length);
    assert.ok(
      packageByPublishedName.has(identity),
      `Contract consumer lock is missing direct Exact alias ${identity}`,
    );
  }
  assert.equal(
    new Set(packages.map(({ version }) => version)).size,
    1,
    'Contract consumer resolved more than one Exact package version',
  );

  return {
    packageSetId: 'exact-contract-consumer-lock',
    packageCount: packages.length,
    version: packages[0].version,
    inputs: {
      manifest: manifestInput,
      lock: lockInput,
    },
    packages,
    packageSetSha256: packageSetDigest(packages),
  };
}

export function buildReceiptModel({
  manifest,
  protocol,
  repoRoot,
  revisionSet,
  packageSets,
  instruments,
}) {
  const profiles = evaluateTargetProfiles(manifest, repoRoot);
  const terminal = profiles.find(({ profileId }) => profileId === TERMINAL_PROFILE_ID);
  assert.ok(terminal);
  const protocolBytes = readFileSync(
    resolve(repoRoot, manifest.authority.distribution.protocolPath),
  );
  const protocolSha256 = sha256(protocolBytes);
  assert.equal(
    protocolSha256,
    manifest.authority.distribution.protocolSha256,
    'comparison protocol digest differs from the cumulative manifest authority',
  );
  assert.equal(
    protocol.protocolId,
    JSON.parse(protocolBytes).protocolId,
    'comparison protocol identity differs from its committed bytes',
  );

  const targetProfileMatrix = {
    schemaVersion: manifest.schemaVersion,
    manifestId: manifest.manifestId,
    workloadVersion: manifest.workloadVersion,
    manifestSemanticSha256: manifestSemanticSha256(manifest),
    protocol: {
      protocolId: protocol.protocolId,
      thresholdFormulaSetId: protocol.thresholdFormulaSetId,
      path: manifest.authority.distribution.protocolPath,
      sha256: protocolSha256,
    },
    profiles: Object.fromEntries(
      Object.entries(manifest.outcomes).map(([profileId, profile]) => [
        profileId,
        { mandatoryClaimIds: profile.mandatoryClaimIds },
      ]),
    ),
  };

  const common = {
    revisionSet,
    targetProfileMatrix,
    packageSets,
    instruments,
  };
  const profileReceipts = profiles.map((profile) => ({
    schemaVersion: 'partitime.target-profile-receipt.v1',
    ...common,
    ...profile,
  }));
  const claimSatisfied = terminal.claimSatisfied;

  return {
    common,
    profileReceipts,
    aggregateBase: {
      schemaVersion: 'partitime.immutable-revision-set.v1',
      claimId: FINAL_CLAIM_ID,
      terminalProfileId: TERMINAL_PROFILE_ID,
      claimSatisfied,
      outcome: claimSatisfied ? 'pass' : 'fail',
      ...common,
      blockers: terminal.blockers,
      nonclaims: claimSatisfied
        ? []
        : [
            'This retained receipt records a red aggregate and does not promote any cumulative claim.',
            ...terminal.blockers.map(
              ({ claimId, status, reason }) =>
                `${claimId} remains unsatisfied (${status ?? reason}).`,
            ),
          ],
    },
  };
}

function atomicWriteJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
}

export function writeReceiptModel({
  model,
  repoRoot,
  aggregatePath,
  profileDirectory,
}) {
  const profileReceipts = model.profileReceipts.map((receipt) => {
    const absolute = resolve(profileDirectory, `${receipt.profileId}.json`);
    atomicWriteJson(absolute, receipt);
    const path = repoRelativePath(repoRoot, relative(repoRoot, absolute));
    return {
      profileId: receipt.profileId,
      terminal: receipt.terminal,
      claimSatisfied: receipt.claimSatisfied,
      blockerCount: receipt.blockers.length,
      path,
      sha256: sha256(readFileSync(absolute)),
    };
  });
  const aggregate = {
    ...model.aggregateBase,
    profileReceipts,
  };
  atomicWriteJson(aggregatePath, aggregate);
  return aggregate;
}

export function validateReceiptModel({
  model,
  repoRoot,
  aggregatePath,
}) {
  const aggregate = JSON.parse(readFileSync(aggregatePath, 'utf8'));
  assert.equal(aggregate.schemaVersion, 'partitime.immutable-revision-set.v1');
  const expectedProfileReceipts = model.profileReceipts.map((expected) => {
    const identity = aggregate.profileReceipts.find(
      ({ profileId }) => profileId === expected.profileId,
    );
    assert.ok(identity, `aggregate is missing profile receipt ${expected.profileId}`);
    const safePath = repoRelativePath(repoRoot, identity.path);
    const bytes = readFileSync(resolve(repoRoot, safePath));
    assert.equal(
      sha256(bytes),
      identity.sha256,
      `${expected.profileId} profile receipt digest drifted`,
    );
    assert.deepEqual(
      JSON.parse(bytes),
      expected,
      `${expected.profileId} profile receipt content drifted`,
    );
    return identity;
  });
  assert.equal(
    aggregate.profileReceipts.length,
    expectedProfileReceipts.length,
    'aggregate has an unexpected profile receipt',
  );
  assert.deepEqual(
    aggregate,
    {
      ...model.aggregateBase,
      profileReceipts: expectedProfileReceipts,
    },
    'immutable revision-set aggregate drifted',
  );
  return aggregate;
}

export function instrumentIdentity(repoRoot, path) {
  return readIdentity(repoRoot, path);
}

export function digestGitTreeish(runGit, repoRoot, revision, label) {
  assertFullRevision(revision, `${label} revision`);
  const tree = runGit(repoRoot, 'rev-parse', `${revision}^{tree}`);
  assert.match(tree, /^[0-9a-f]{40}$/, `${label} tree is not a full Git object id`);
  return {
    revision,
    tree,
  };
}

export function assertCheckoutForCollection(runGit, repoRoot, revision, label) {
  const identity = digestGitTreeish(runGit, repoRoot, revision, label);
  assert.equal(
    runGit(repoRoot, 'rev-parse', 'HEAD'),
    revision,
    `${label} checkout is not at the explicitly admitted revision`,
  );
  assert.deepEqual(
    runGit(repoRoot, 'status', '--porcelain').split('\n').filter(Boolean),
    [],
    `${label} checkout must be clean before collecting immutable evidence`,
  );
  return identity;
}
