import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

import {
  FINAL_CLAIM_ID,
  buildReceiptModel,
  evaluateTargetProfiles,
  parseExactPackagesFromBunLock,
  validateReceiptModel,
  writeReceiptModel,
} from './final-immutable-revision-set-lib.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'partitime-final-revision-'));
  const artifactPath = 'acceptance/pass.json';
  mkdirSync(dirname(resolve(root, artifactPath)), { recursive: true });
  writeFileSync(resolve(root, artifactPath), '{"ok":true}\n');
  const protocolPath = 'acceptance/protocol.json';
  const protocolBytes = '{"protocolId":"p1","thresholdFormulaSetId":"t1"}\n';
  writeFileSync(resolve(root, protocolPath), protocolBytes);
  const manifest = {
    schemaVersion: 'partitime.claims.v1',
    manifestId: 'fixture',
    workloadVersion: 'fixture.v1',
    authority: {
      distribution: {
        protocolPath,
        protocolSha256: sha256(protocolBytes),
      },
    },
    outcomes: {
      'web-only': {
        mandatoryClaimIds: ['PASS', 'OPEN', FINAL_CLAIM_ID],
      },
      'full-north-star': {
        mandatoryClaimIds: ['PASS', 'OPEN', FINAL_CLAIM_ID],
      },
    },
    claims: [
      {
        id: 'PASS',
        step: 1,
        witnessClass: 'fixture',
        status: 'passing',
        artifact: {
          path: artifactPath,
          sha256: sha256(readFileSync(resolve(root, artifactPath))),
        },
      },
      {
        id: 'OPEN',
        step: 6,
        witnessClass: 'fixture',
        status: 'pending',
        artifact: null,
      },
      {
        id: FINAL_CLAIM_ID,
        step: 6,
        witnessClass: 'aggregate',
        status: 'pending',
        artifact: null,
      },
    ],
  };
  return {
    root,
    manifest,
    protocol: {
      protocolId: 'p1',
      thresholdFormulaSetId: 't1',
    },
  };
}

test('the aggregate claim cannot satisfy itself and open prerequisites stay red', () => {
  const { root, manifest } = fixture();
  const profiles = evaluateTargetProfiles(manifest, root);
  for (const profile of profiles) {
    assert.deepEqual(
      profile.prerequisiteClaims.map(({ id }) => id),
      ['PASS', 'OPEN'],
    );
    assert.equal(profile.claimSatisfied, false);
    assert.deepEqual(profile.blockers, [
      { claimId: 'OPEN', reason: 'claim-status', status: 'pending' },
    ]);
  }
});

test('a passing claim with drifted evidence fails closed', () => {
  const { root, manifest } = fixture();
  writeFileSync(resolve(root, 'acceptance/pass.json'), '{"ok":false}\n');
  const terminal = evaluateTargetProfiles(manifest, root).find(
    ({ profileId }) => profileId === 'full-north-star',
  );
  assert.ok(
    terminal.blockers.some(({ reason }) => reason === 'artifact-digest-mismatch'),
  );
});

test('an artifact path outside the repository fails closed', () => {
  const { root, manifest } = fixture();
  manifest.claims[0].artifact.path = '../outside.json';
  const terminal = evaluateTargetProfiles(manifest, root).find(
    ({ profileId }) => profileId === 'full-north-star',
  );
  assert.ok(
    terminal.blockers.some(
      ({ reason, detail }) =>
        reason === 'artifact-unreadable' && detail.includes('escapes the repository'),
    ),
  );
});

test('every profile must name the aggregate exactly once', () => {
  const { root, manifest } = fixture();
  manifest.outcomes['web-only'].mandatoryClaimIds = ['PASS'];
  assert.throws(
    () => evaluateTargetProfiles(manifest, root),
    /must name FINAL\.IMMUTABLE_REVISION_SET exactly once/,
  );
});

test('Exact package identities are recovered from Bun JSONC lock rows', () => {
  const rows = parseExactPackagesFromBunLock(`
  "packages": {
    "@exact/core": ["@ccheever/exact-core@0.1.6", "", {}, "sha512-AAAA=="],
    "@ibex/runtime-js": ["@ccheever/exact-ibex-runtime@0.1.6", "", {}, "sha512-BBBB=="],
  },
`);
  assert.deepEqual(rows, [
    {
      sourceName: '@exact/core',
      publishedName: '@ccheever/exact-core',
      version: '0.1.6',
      registryIntegrity: 'sha512-AAAA==',
    },
    {
      sourceName: '@ibex/runtime-js',
      publishedName: '@ccheever/exact-ibex-runtime',
      version: '0.1.6',
      registryIntegrity: 'sha512-BBBB==',
    },
  ]);
});

test('aggregate validation detects a modified per-profile receipt', () => {
  const { root, manifest, protocol } = fixture();
  const model = buildReceiptModel({
    manifest,
    protocol,
    repoRoot: root,
    revisionSet: {
      snapback: { revision: '1'.repeat(40), tree: '2'.repeat(40) },
      exact: { revision: '3'.repeat(40), tree: '4'.repeat(40) },
    },
    packageSets: [],
    instruments: {},
  });
  const aggregatePath = resolve(root, 'acceptance/final.json');
  const profileDirectory = resolve(root, 'acceptance/profiles');
  const aggregate = writeReceiptModel({
    model,
    repoRoot: root,
    aggregatePath,
    profileDirectory,
  });
  assert.equal(aggregate.claimSatisfied, false);
  validateReceiptModel({ model, repoRoot: root, aggregatePath });

  writeFileSync(
    resolve(root, aggregate.profileReceipts[0].path),
    '{"tampered":true}\n',
  );
  assert.throws(
    () => validateReceiptModel({ model, repoRoot: root, aggregatePath }),
    /profile receipt digest drifted/,
  );
});
