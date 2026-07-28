import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import {
  createPublicationAuthorityReceipt,
  publicationAuthorityHeadSha256,
  publicationAuthoritySigningKeyId,
  signPublicationAuthorityHead,
  signPublicationLease,
} from '../packages/snapback-publication-authority/protocol.mjs';
import {
  buildPostPromotionLedger,
  canonicalJcs,
  leaseSha256,
  publicationAuthorityTransition,
  promoteDefaultVector,
  unsignedLease,
  validatePublicationLease,
  validatePublicationAuthorityReceipt,
  validatePostPromotionLedger,
  vectorFromLease,
} from './snapback-promotion-core.mjs';

const names = [
  '@ccheever/snapback-runtime-darwin-arm64',
  '@ccheever/snapback-runtime-linux-x64',
  '@ccheever/snapback-contract',
  '@ccheever/snapback-client',
  '@ccheever/snapback-codegen',
  '@ccheever/snapback-vite',
  '@ccheever/snapback-react',
  '@ccheever/snapback-app-cli',
  '@ccheever/snapback-cli',
];
const authorityInstallationId = 'snapback-publication-promotion';
const authorityOrigin = 'https://publication-authority.example';

function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const unsigned = {
    schemaVersion: 'snapback.authorized-publication-lease.v2',
    authorityInstallationId,
    authorityOrigin,
    signingKeyId: publicationAuthoritySigningKeyId(publicKey),
    operationId: 'release-0.1.1-test',
    publisherInstanceId: 'publisher-test-01',
    publicationEpoch: 7,
    candidateLedgerSha256: 'a'.repeat(64),
    candidateTag: 'bakeoff-0-1-1-deadbeefcafe',
    defaultTag: 'latest',
    issuedAt: '2026-07-28T19:00:00.000Z',
    expiresAt: '2026-07-28T19:15:00.000Z',
    packages: names.map((name, index) => ({
      name,
      expectedPriorVersion: index === 5 ? null : '0.1.0',
      newVersion: '0.1.1',
    })),
  };
  const lease = signPublicationLease({ unsigned, privateKey });
  return { lease, privateKey, publicKey };
}

function acquiredHead(lease, privateKey, overrides = {}) {
  const unsigned = {
    schemaVersion: 'snapback.publication-authority-head.v2',
    authorityInstallationId: lease.authorityInstallationId,
    authorityOrigin: lease.authorityOrigin,
    signingKeyId: lease.signingKeyId,
    authorityGeneration: 2,
    publicationEpoch: lease.publicationEpoch,
    status: 'acquired',
    operationId: lease.operationId,
    publisherInstanceId: lease.publisherInstanceId,
    leaseSha256: leaseSha256(lease),
    expiresAt: lease.expiresAt,
    outcome: null,
    headSha256: null,
    ...overrides,
  };
  unsigned.headSha256 = publicationAuthorityHeadSha256(unsigned);
  return signPublicationAuthorityHead({ unsigned, privateKey });
}

test('lease is signature, candidate, time, and nine-package bound', () => {
  const { lease, publicKey } = fixture();
  assert.equal(
    validatePublicationLease({
      lease,
      publicKey,
      authorityInstallationId,
      authorityOrigin,
      candidateLedgerSha256: 'a'.repeat(64),
      candidateTag: lease.candidateTag,
      publisherInstanceId: lease.publisherInstanceId,
      now: Date.parse('2026-07-28T19:05:00.000Z'),
    }),
    lease,
  );
  const tampered = structuredClone(lease);
  tampered.packages[0].newVersion = '9.9.9';
  assert.throws(
    () => validatePublicationLease({
      lease: tampered,
      publicKey,
      authorityInstallationId,
      authorityOrigin,
      candidateLedgerSha256: 'a'.repeat(64),
      candidateTag: lease.candidateTag,
      publisherInstanceId: lease.publisherInstanceId,
      now: Date.parse('2026-07-28T19:05:00.000Z'),
    }),
    /signature is invalid/,
  );
  const unknown = structuredClone(lease);
  unknown.extra = true;
  assert.throws(
    () => validatePublicationLease({
      lease: unknown,
      publicKey,
      authorityInstallationId,
      authorityOrigin,
      candidateLedgerSha256: 'a'.repeat(64),
      candidateTag: lease.candidateTag,
      publisherInstanceId: lease.publisherInstanceId,
      now: Date.parse('2026-07-28T19:05:00.000Z'),
    }),
    /unknown or missing members/,
  );
  assert.throws(
    () => validatePublicationLease({
      lease,
      publicKey,
      authorityInstallationId,
      authorityOrigin: 'https://substitute-authority.example',
      candidateLedgerSha256: 'a'.repeat(64),
      candidateTag: lease.candidateTag,
      publisherInstanceId: lease.publisherInstanceId,
      now: Date.parse('2026-07-28T19:05:00.000Z'),
    }),
    /authority origin mismatch/u,
  );
});

test('promotion checks the complete vector around each tag mutation', async () => {
  const { lease, privateKey, publicKey } = fixture();
  const vector = Object.fromEntries(lease.packages.map((row) => [
    row.name,
    row.expectedPriorVersion,
  ]));
  const head = acquiredHead(lease, privateKey);
  const result = await promoteDefaultVector({
    lease,
    authorityPublicKey: publicKey,
    readVector: async () => structuredClone(vector),
    readLeaseHead: async () => structuredClone(head),
    setTag: async (name, version) => { vector[name] = version; },
    removeTag: async (name) => { vector[name] = null; },
    now: () => Date.parse('2026-07-28T19:05:00.000Z'),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(
    Object.values(result.vector),
    Array(9).fill('0.1.1'),
  );
  assert.equal(result.events.length, 9);
});

test('failure rolls back every changed tag in reverse order', async () => {
  const { lease, privateKey, publicKey } = fixture();
  const vector = Object.fromEntries(lease.packages.map((row) => [
    row.name,
    row.expectedPriorVersion,
  ]));
  const prior = structuredClone(vector);
  const head = acquiredHead(lease, privateKey);
  let writes = 0;
  await assert.rejects(
    promoteDefaultVector({
      lease,
      authorityPublicKey: publicKey,
      readVector: async () => structuredClone(vector),
      readLeaseHead: async () => structuredClone(head),
      setTag: async (name, version) => {
        writes += 1;
        if (writes === 4) throw new Error('simulated npm failure');
        vector[name] = version;
      },
      removeTag: async (name) => { vector[name] = null; },
      now: () => Date.parse('2026-07-28T19:05:00.000Z'),
    }),
    (error) => {
      assert.match(error.message, /simulated npm failure/);
      assert.equal(error.result.rollback.length, 3);
      assert.ok(error.result.rollback.every((row) => row.ok));
      return true;
    },
  );
  assert.deepEqual(vector, prior);
});

test('post-mutation lease-head failure rolls the proven mutation back completely', async () => {
  const { lease, privateKey, publicKey } = fixture();
  const vector = Object.fromEntries(lease.packages.map((row) => [
    row.name,
    row.expectedPriorVersion,
  ]));
  const prior = structuredClone(vector);
  const currentHead = acquiredHead(lease, privateKey);
  const driftedHead = acquiredHead(lease, privateKey, {
    publicationEpoch: lease.publicationEpoch + 1,
  });
  let headReads = 0;
  const recorded = [];
  await assert.rejects(
    promoteDefaultVector({
      lease,
      authorityPublicKey: publicKey,
      readVector: async () => structuredClone(vector),
      readLeaseHead: async () => {
        headReads += 1;
        return structuredClone(headReads === 2 ? driftedHead : currentHead);
      },
      setTag: async (name, version) => { vector[name] = version; },
      removeTag: async (name) => { vector[name] = null; },
      record: (event) => recorded.push(structuredClone(event)),
      now: () => Date.parse('2026-07-28T19:05:00.000Z'),
    }),
    (error) => {
      assert.match(error.message, /external publication lease head drifted/u);
      assert.equal(error.result.rollback.length, 1);
      assert.equal(error.result.rollback[0].ok, true);
      return true;
    },
  );
  assert.deepEqual(vector, prior);
  const refusedPromotion = recorded.find((event) => event.phase === 'promote');
  assert.deepEqual(refusedPromotion.before, prior);
  assert.deepEqual(refusedPromotion.after, {
    ...prior,
    [lease.packages[0].name]: lease.packages[0].newVersion,
  });
  assert.deepEqual(refusedPromotion.afterLeaseHead, driftedHead);
  assert.deepEqual(refusedPromotion.postMutationAuthorityError, {
    code: 'SNAPBACK_PUBLICATION_POST_MUTATION_AUTHORITY_REFUSED',
    message: 'external publication lease head drifted',
  });
});

test('failed final latest-root proof rolls the complete promoted vector back', async () => {
  const { lease, privateKey, publicKey } = fixture();
  const vector = Object.fromEntries(lease.packages.map((row) => [
    row.name,
    row.expectedPriorVersion,
  ]));
  const prior = structuredClone(vector);
  const head = acquiredHead(lease, privateKey);
  await assert.rejects(
    promoteDefaultVector({
      lease,
      authorityPublicKey: publicKey,
      readVector: async () => structuredClone(vector),
      readLeaseHead: async () => structuredClone(head),
      setTag: async (name, version) => { vector[name] = version; },
      removeTag: async (name) => { vector[name] = null; },
      now: () => Date.parse('2026-07-28T19:05:00.000Z'),
      afterPromotion: async () => {
        throw new Error('linux latest-root proof refused');
      },
    }),
    (error) => {
      assert.match(error.message, /linux latest-root proof refused/u);
      assert.equal(error.result.rollback.length, 9);
      return true;
    },
  );
  assert.deepEqual(vector, prior);
});

test('an ambiguous command error is reconciled from the registry and rolled back', async () => {
  const { lease, privateKey, publicKey } = fixture();
  const vector = Object.fromEntries(lease.packages.map((row) => [
    row.name,
    row.expectedPriorVersion,
  ]));
  const prior = structuredClone(vector);
  const head = acquiredHead(lease, privateKey);
  let writes = 0;
  await assert.rejects(
    promoteDefaultVector({
      lease,
      authorityPublicKey: publicKey,
      readVector: async () => structuredClone(vector),
      readLeaseHead: async () => structuredClone(head),
      setTag: async (name, version) => {
        writes += 1;
        vector[name] = version;
        if (writes === 2) throw new Error('simulated lost command response');
      },
      removeTag: async (name) => { vector[name] = null; },
      now: () => Date.parse('2026-07-28T19:05:00.000Z'),
    }),
    (error) => {
      assert.match(error.message, /lost command response/);
      assert.equal(error.result.rollback.length, 2);
      assert.ok(error.result.rollback.every((row) => row.ok));
      return true;
    },
  );
  assert.deepEqual(vector, prior);
});

test('rollback never clobbers an independently advanced tag', async () => {
  const { lease, privateKey, publicKey } = fixture();
  const vector = Object.fromEntries(lease.packages.map((row) => [
    row.name,
    row.expectedPriorVersion,
  ]));
  const head = acquiredHead(lease, privateKey);
  let writes = 0;
  await assert.rejects(
    promoteDefaultVector({
      lease,
      authorityPublicKey: publicKey,
      readVector: async () => structuredClone(vector),
      readLeaseHead: async () => structuredClone(head),
      setTag: async (name, version) => {
        writes += 1;
        if (writes === 3) {
          vector[lease.packages[0].name] = '0.2.0';
          throw new Error('simulated concurrent release');
        }
        vector[name] = version;
      },
      removeTag: async (name) => { vector[name] = null; },
      now: () => Date.parse('2026-07-28T19:05:00.000Z'),
    }),
    (error) => {
      assert.equal(vector[lease.packages[0].name], '0.2.0');
      assert.ok(error.result.rollback.some((row) => row.ok === false));
      assert.equal(writes, 3, 'strict checkpoint prevents every later rollback mutation');
      return true;
    },
  );
});

test('lease expiry is rechecked immediately around every mutation', async () => {
  const { lease, privateKey, publicKey } = fixture();
  const vector = Object.fromEntries(lease.packages.map((row) => [
    row.name,
    row.expectedPriorVersion,
  ]));
  const head = acquiredHead(lease, privateKey);
  const times = [
    '2026-07-28T19:14:59.000Z',
    '2026-07-28T19:14:59.500Z',
    '2026-07-28T19:15:00.000Z',
  ].map(Date.parse);
  let writes = 0;
  await assert.rejects(
    promoteDefaultVector({
      lease,
      authorityPublicKey: publicKey,
      readVector: async () => structuredClone(vector),
      readLeaseHead: async () => structuredClone(head),
      setTag: async (name, version) => {
        writes += 1;
        vector[name] = version;
      },
      removeTag: async () => {
        writes += 1;
      },
      now: () => times.shift() ?? Date.parse('2026-07-28T19:15:00.000Z'),
    }),
    /expired during vector transition/u,
  );
  assert.equal(writes, 1, 'the completed pre-expiry mutation is observed');
  assert.equal(
    vector[lease.packages[0].name],
    '0.1.1',
    'expiry refuses rollback and every further registry mutation',
  );
});

test('a signed closed head refuses every mutation even when lease identity still matches', async () => {
  const { lease, privateKey, publicKey } = fixture();
  const vector = vectorFromLease(lease, 'prior');
  const closedHead = acquiredHead(lease, privateKey, {
    authorityGeneration: 3,
    status: 'closed',
    outcome: 'rolled-back',
  });
  let writes = 0;
  await assert.rejects(
    promoteDefaultVector({
      lease,
      authorityPublicKey: publicKey,
      readVector: async () => structuredClone(vector),
      readLeaseHead: async () => structuredClone(closedHead),
      setTag: async () => { writes += 1; },
      removeTag: async () => { writes += 1; },
      now: () => Date.parse('2026-07-28T19:05:00.000Z'),
    }),
    /external publication lease head drifted/u,
  );
  assert.equal(writes, 0);
});

test('external authority acquisition and close receipts are exact-value bound', () => {
  const { lease, privateKey, publicKey } = fixture();
  const vector = Object.fromEntries(lease.packages.map((row) => [
    row.name,
    row.expectedPriorVersion,
  ]));
  const acquisition = publicationAuthorityTransition({
    lease,
    outcome: 'acquired',
    vector,
  });
  const acquisitionReceipt = createPublicationAuthorityReceipt({
    transition: acquisition,
    authorityGeneration: 2,
    privateKey,
  });
  assert.equal(
    validatePublicationAuthorityReceipt({
      receipt: acquisitionReceipt,
      transition: acquisition,
      publicKey,
      authorityInstallationId,
      authorityOrigin,
    }),
    acquisitionReceipt,
  );
  const promoted = publicationAuthorityTransition({
    lease,
    outcome: 'promoted',
    vector: Object.fromEntries(names.map((name) => [name, '0.1.1'])),
    publicationLedgerSha256: 'b'.repeat(64),
  });
  const closeReceipt = createPublicationAuthorityReceipt({
    transition: promoted,
    authorityGeneration: 3,
    privateKey,
  });
  assert.equal(
    validatePublicationAuthorityReceipt({
      receipt: closeReceipt,
      transition: promoted,
      publicKey,
      authorityInstallationId,
      authorityOrigin,
    }),
    closeReceipt,
  );
  const wrongTransition = { ...promoted, vectorSha256: 'c'.repeat(64) };
  const wrongReceipt = createPublicationAuthorityReceipt({
    transition: wrongTransition,
    authorityGeneration: 3,
    privateKey,
  });
  assert.throws(
    () => validatePublicationAuthorityReceipt({
      receipt: wrongReceipt,
      transition: promoted,
      publicKey,
      authorityInstallationId,
      authorityOrigin,
    }),
    /vectorSha256 mismatch/u,
  );
});

test('post-promotion ledger closes candidate lineage, tags, and final receipts', () => {
  const { lease } = fixture();
  const vector = Object.fromEntries(names.map((name) => [name, '0.1.1']));
  const candidateLedger = {
    candidateLedgerSha256: lease.candidateLedgerSha256,
    packages: names.map((name, index) => ({
      sourceName: name.replace('@ccheever/snapback-', '@snapback/'),
      name,
      version: '0.1.1',
      sha256: String(index + 1).repeat(64).slice(0, 64),
      registryIntegrity: `sha512-${'a'.repeat(80)}`,
      registrySha256: String(index + 1).repeat(64).slice(0, 64),
    })),
  };
  const events = names.map((name) => ({ phase: 'promote', package: name }));
  const latestRootReceipts = [
    { platform: 'darwin-arm64', sha256: 'b'.repeat(64) },
    { platform: 'linux-x64', sha256: 'c'.repeat(64) },
  ];
  const post = buildPostPromotionLedger({
    candidateLedger,
    lease,
    events,
    vector,
    latestRootReceipts,
  });
  assert.equal(post.previousLedgerSha256, lease.candidateLedgerSha256);
  assert.equal(validatePostPromotionLedger(post), post);
  assert.throws(
    () => validatePostPromotionLedger({
      ...post,
      finalVector: { ...post.finalVector, [names[0]]: '0.1.0' },
    }),
    /self-digest mismatch/u,
  );
});

test('signature preimage excludes only signature', () => {
  const { lease } = fixture();
  assert.equal(unsignedLease(lease).signature, undefined);
});
