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
  validateClosedLatestProofPlan,
  validatePreClosePublicationState,
  validatePostPromotionLedger,
  vectorFromLease,
  validatePriorDependencyAlias,
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
    schemaVersion: 'snapback.publication-authority-head.v3',
    authorityInstallationId: lease.authorityInstallationId,
    authorityOrigin: lease.authorityOrigin,
    challenge: 'd'.repeat(64),
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

test('a first-publication package already on the new version is a verified no-op', async () => {
  const base = fixture();
  const unsigned = unsignedLease(base.lease);
  unsigned.packages[5].expectedPriorVersion = unsigned.packages[5].newVersion;
  const lease = signPublicationLease({ unsigned, privateKey: base.privateKey });
  const vector = vectorFromLease(lease, 'prior');
  const head = acquiredHead(lease, base.privateKey);
  const writes = [];
  const result = await promoteDefaultVector({
    lease,
    authorityPublicKey: base.publicKey,
    readVector: async () => structuredClone(vector),
    readLeaseHead: async () => structuredClone(head),
    setTag: async (name, version) => {
      writes.push([name, version]);
      vector[name] = version;
    },
    removeTag: async (name) => { vector[name] = null; },
    now: () => Date.parse('2026-07-28T19:05:00.000Z'),
  });
  assert.equal(result.ok, true);
  assert.equal(writes.length, 8);
  assert.deepEqual(
    result.events.map((event) => event.package),
    names,
  );
  assert.equal(result.events[5].alreadyAtNewVersion, true);
  assert.deepEqual(result.events[5].before, result.events[5].after);
  assert.deepEqual(Object.values(result.vector), Array(9).fill('0.1.1'));
});

test('promotion tolerates bounded official-registry propagation lag', async () => {
  const { lease, privateKey, publicKey } = fixture();
  const visible = vectorFromLease(lease, 'prior');
  const actual = structuredClone(visible);
  const staleReads = new Map();
  const head = acquiredHead(lease, privateKey);
  const result = await promoteDefaultVector({
    lease,
    authorityPublicKey: publicKey,
    readVector: async () => {
      for (const [name, remaining] of staleReads) {
        if (remaining > 0) {
          staleReads.set(name, remaining - 1);
          return structuredClone(visible);
        }
        visible[name] = actual[name];
        staleReads.delete(name);
      }
      return structuredClone(visible);
    },
    readLeaseHead: async () => structuredClone(head),
    setTag: async (name, version) => {
      actual[name] = version;
      staleReads.set(name, 2);
    },
    removeTag: async (name) => {
      actual[name] = null;
      staleReads.set(name, 2);
    },
    wait: async () => {},
    registryConvergenceDelayMs: 0,
    now: () => Date.parse('2026-07-28T19:05:00.000Z'),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.vector, actual);
  assert.ok(
    result.events.every((event) => event.registryConvergenceAttempts === 3),
  );
});

test('promotion tolerates one preceding checkpoint after a proven write', async () => {
  const { lease, privateKey, publicKey } = fixture();
  const vector = vectorFromLease(lease, 'prior');
  const prior = structuredClone(vector);
  const head = acquiredHead(lease, privateKey);
  let firstWriteDone = false;
  let firstPostObserved = false;
  let regressedOnce = false;
  const result = await promoteDefaultVector({
    lease,
    authorityPublicKey: publicKey,
    readVector: async () => {
      if (firstWriteDone && !firstPostObserved) {
        firstPostObserved = true;
        return structuredClone(vector);
      }
      if (firstPostObserved && !regressedOnce) {
        regressedOnce = true;
        return structuredClone(prior);
      }
      return structuredClone(vector);
    },
    readLeaseHead: async () => structuredClone(head),
    setTag: async (name, version) => {
      vector[name] = version;
      firstWriteDone = true;
    },
    removeTag: async (name) => { vector[name] = null; },
    wait: async () => {},
    registryConvergenceDelayMs: 0,
    now: () => Date.parse('2026-07-28T19:05:00.000Z'),
  });
  assert.equal(result.ok, true);
  assert.equal(
    result.events[1].preMutationRegistryConvergenceAttempts,
    2,
  );
});

test('promotion fails closed on a refused convergence observation', async () => {
  const { lease, privateKey, publicKey } = fixture();
  const prior = vectorFromLease(lease, 'prior');
  const head = acquiredHead(lease, privateKey);
  let reads = 0;
  let waitCalls = 0;
  await assert.rejects(
    promoteDefaultVector({
      lease,
      authorityPublicKey: publicKey,
      readVector: async () => {
        reads += 1;
        if (reads === 2) {
          throw new Error('simulated registry read refusal');
        }
        return structuredClone(prior);
      },
      readLeaseHead: async () => structuredClone(head),
      // Model an ambiguous command whose write cannot be proven.
      setTag: async () => {},
      removeTag: async () => {},
      wait: async () => { waitCalls += 1; },
      registryConvergenceAttempts: 3,
      registryConvergenceDelayMs: 0,
      now: () => Date.parse('2026-07-28T19:05:00.000Z'),
    }),
    (error) => {
      assert.match(error.message, /simulated registry read refusal/u);
      assert.deepEqual(error.result.vector, prior);
      assert.deepEqual(error.result.rollback, []);
      return true;
    },
  );
  assert.equal(waitCalls, 0);
});

test('only an already-candidate prior package may bind aliases to the new vector', () => {
  const base = fixture();
  const unsigned = unsignedLease(base.lease);
  unsigned.packages[5].expectedPriorVersion = unsigned.packages[5].newVersion;
  const lease = signPublicationLease({ unsigned, privateKey: base.privateKey });
  assert.deepEqual(
    validatePriorDependencyAlias({
      lease,
      ownerName: names[5],
      dependency: '@snapback/cli',
      target: names[8],
      version: '0.1.1',
    }),
    { sectionVector: 'new', selectedVersion: '0.1.1' },
  );
  assert.throws(
    () => validatePriorDependencyAlias({
      lease,
      ownerName: names[2],
      dependency: '@snapback/client',
      target: names[3],
      version: '0.1.1',
    }),
    /escapes the authorized vector/u,
  );
  assert.deepEqual(
    validatePriorDependencyAlias({
      lease,
      ownerName: names[2],
      dependency: '@snapback/client',
      target: names[3],
      version: '0.1.0',
    }),
    { sectionVector: 'prior', selectedVersion: '0.1.0' },
  );
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
      registryConvergenceAttempts: 1,
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

test('rollback tolerates one preceding checkpoint after a proven reverse write', async () => {
  const { lease, privateKey, publicKey } = fixture();
  const vector = vectorFromLease(lease, 'prior');
  const prior = structuredClone(vector);
  const allNew = vectorFromLease(lease, 'new');
  const head = acquiredHead(lease, privateKey);
  let firstReverseWriteDone = false;
  let firstReversePostObserved = false;
  let regressedOnce = false;
  await assert.rejects(
    promoteDefaultVector({
      lease,
      authorityPublicKey: publicKey,
      readVector: async () => {
        if (firstReverseWriteDone && !firstReversePostObserved) {
          firstReversePostObserved = true;
          return structuredClone(vector);
        }
        if (firstReversePostObserved && !regressedOnce) {
          regressedOnce = true;
          return structuredClone(allNew);
        }
        return structuredClone(vector);
      },
      readLeaseHead: async () => structuredClone(head),
      setTag: async (name, version) => {
        vector[name] = version;
        if (
          name === names.at(-1)
          && version === lease.packages.at(-1).expectedPriorVersion
        ) {
          firstReverseWriteDone = true;
        }
      },
      removeTag: async (name) => { vector[name] = null; },
      wait: async () => {},
      registryConvergenceDelayMs: 0,
      now: () => Date.parse('2026-07-28T19:05:00.000Z'),
      afterPromotion: async () => {
        throw new Error('force rollback checkpoint regression');
      },
    }),
    (error) => {
      assert.match(error.message, /force rollback checkpoint regression/u);
      assert.ok(error.result.rollback.every((event) => event.ok));
      assert.equal(
        error.result.rollback[1].preMutationRegistryConvergenceAttempts,
        2,
      );
      return true;
    },
  );
  assert.deepEqual(vector, prior);
});

test('a refused first rollback read retains direct and reconciliation counts', async () => {
  const { lease, privateKey, publicKey } = fixture();
  const vector = vectorFromLease(lease, 'prior');
  const head = acquiredHead(lease, privateKey);
  let refuseFirstRollbackRead = false;
  let refused = false;
  await assert.rejects(
    promoteDefaultVector({
      lease,
      authorityPublicKey: publicKey,
      readVector: async () => {
        if (refuseFirstRollbackRead && !refused) {
          refused = true;
          throw new Error('simulated first rollback read refusal');
        }
        return structuredClone(vector);
      },
      readLeaseHead: async () => structuredClone(head),
      setTag: async (name, version) => { vector[name] = version; },
      removeTag: async (name) => { vector[name] = null; },
      now: () => Date.parse('2026-07-28T19:05:00.000Z'),
      afterPromotion: async () => {
        refuseFirstRollbackRead = true;
        throw new Error('force first rollback read refusal');
      },
    }),
    (error) => {
      assert.equal(
        error.result.rollback[0].preMutationRegistryConvergenceAttempts,
        1,
      );
      assert.equal(error.result.rollback[0].registryConvergenceAttempts, null);
      assert.equal(
        error.result.rollback[0].reconciliationRegistryObservations,
        1,
      );
      assert.match(error.result.rollback[0].error, /first rollback read refusal/u);
      return true;
    },
  );
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

test('rollback reconciles an apply-then-throw response loss and continues in reverse', async () => {
  const { lease, privateKey, publicKey } = fixture();
  const vector = vectorFromLease(lease, 'prior');
  const prior = structuredClone(vector);
  const head = acquiredHead(lease, privateKey);
  let lostRollbackResponse = false;
  await assert.rejects(
    promoteDefaultVector({
      lease,
      authorityPublicKey: publicKey,
      readVector: async () => structuredClone(vector),
      readLeaseHead: async () => structuredClone(head),
      setTag: async (name, version) => {
        vector[name] = version;
        if (
          version === '0.1.0'
          && name === lease.packages.at(-1).name
          && !lostRollbackResponse
        ) {
          lostRollbackResponse = true;
          throw new Error('simulated lost rollback response');
        }
      },
      removeTag: async (name) => { vector[name] = null; },
      now: () => Date.parse('2026-07-28T19:05:00.000Z'),
      afterPromotion: async () => {
        throw new Error('force complete-vector rollback');
      },
    }),
    (error) => {
      assert.equal(error.result.rollback.length, 9);
      assert.ok(error.result.rollback.every((row) => row.ok));
      assert.equal(
        error.result.rollback[0].commandReportedError,
        'simulated lost rollback response',
      );
      return true;
    },
  );
  assert.equal(lostRollbackResponse, true);
  assert.deepEqual(vector, prior);
});

test('rollback advances after one bounded retry proves an apply-then-throw reverse write', async () => {
  const { lease, privateKey, publicKey } = fixture();
  const vector = vectorFromLease(lease, 'prior');
  const prior = structuredClone(vector);
  const head = acquiredHead(lease, privateKey);
  const allNew = vectorFromLease(lease, 'new');
  let failNextObservation = false;
  let rollbackWrites = 0;
  let firstRollbackWrite = true;
  let reconciledFirstWrite = false;
  let regressedAfterReconciliation = false;
  await assert.rejects(
    promoteDefaultVector({
      lease,
      authorityPublicKey: publicKey,
      readVector: async () => {
        if (failNextObservation) {
          failNextObservation = false;
          throw new Error('simulated registry observation outage');
        }
        if (!firstRollbackWrite && rollbackWrites === 1 && !reconciledFirstWrite) {
          reconciledFirstWrite = true;
          return structuredClone(vector);
        }
        if (reconciledFirstWrite && !regressedAfterReconciliation) {
          regressedAfterReconciliation = true;
          return structuredClone(allNew);
        }
        return structuredClone(vector);
      },
      readLeaseHead: async () => structuredClone(head),
      setTag: async (name, version) => {
        if (version === '0.1.0') {
          rollbackWrites += 1;
          vector[name] = version;
          if (firstRollbackWrite) {
            firstRollbackWrite = false;
            failNextObservation = true;
            throw new Error('simulated lost rollback response');
          }
        } else {
          vector[name] = version;
        }
      },
      removeTag: async (name) => {
        rollbackWrites += 1;
        vector[name] = null;
      },
      wait: async () => {},
      registryConvergenceAttempts: 2,
      registryConvergenceDelayMs: 0,
      now: () => Date.parse('2026-07-28T19:05:00.000Z'),
      afterPromotion: async () => {
        throw new Error('force complete-vector rollback');
      },
    }),
    (error) => {
      assert.match(
        error.result.rollback[0].error,
        /registry observation outage/u,
      );
      assert.equal(
        error.result.rollback[0].commandReportedError,
        'simulated lost rollback response',
      );
      assert.equal(error.result.rollback[0].observationError, null);
      assert.equal(error.result.rollback[0].checkpointAdvanced, true);
      assert.equal(error.result.rollback[0].registryConvergenceAttempts, 2);
      assert.equal(
        error.result.rollback[0].reconciliationRegistryObservations,
        1,
      );
      assert.equal(error.result.rollback.length, 9);
      assert.ok(error.result.rollback.slice(1).every((row) => row.ok === true));
      assert.equal(
        error.result.rollback[1].preMutationRegistryConvergenceAttempts,
        2,
      );
      return true;
    },
  );
  assert.equal(rollbackWrites, 9);
  assert.deepEqual(vector, prior);
});

test('rollback refuses earlier writes when both bounded observations fail', async () => {
  const { lease, privateKey, publicKey } = fixture();
  const vector = vectorFromLease(lease, 'prior');
  const head = acquiredHead(lease, privateKey);
  let observationFailures = 0;
  let rollbackWrites = 0;
  await assert.rejects(
    promoteDefaultVector({
      lease,
      authorityPublicKey: publicKey,
      readVector: async () => {
        if (observationFailures > 0) {
          observationFailures -= 1;
          throw new Error(`simulated registry observation outage ${2 - observationFailures}`);
        }
        return structuredClone(vector);
      },
      readLeaseHead: async () => structuredClone(head),
      setTag: async (name, version) => {
        if (version === '0.1.0' && rollbackWrites === 0) {
          rollbackWrites += 1;
          vector[name] = version;
          observationFailures = 2;
          throw new Error('simulated lost rollback response');
        }
        if (version === '0.1.0') rollbackWrites += 1;
        vector[name] = version;
      },
      removeTag: async (name) => {
        rollbackWrites += 1;
        vector[name] = null;
      },
      registryConvergenceAttempts: 1,
      now: () => Date.parse('2026-07-28T19:05:00.000Z'),
      afterPromotion: async () => {
        throw new Error('force complete-vector rollback');
      },
    }),
    (error) => {
      assert.equal(error.result.rollback.length, 9);
      assert.match(error.result.rollback[0].error, /observation outage 1/u);
      assert.match(error.result.rollback[0].observationError, /observation outage 2/u);
      assert.equal(error.result.rollback[0].checkpointAdvanced, false);
      assert.ok(error.result.rollback.slice(1).every((row) => row.ok === false));
      return true;
    },
  );
  assert.equal(rollbackWrites, 1);
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

test('pre-close gate reopens the complete vector and current acquired authority head', () => {
  const { lease, privateKey, publicKey } = fixture();
  const vector = vectorFromLease(lease, 'new');
  const head = acquiredHead(lease, privateKey);
  assert.deepEqual(validatePreClosePublicationState({
    lease,
    authorityPublicKey: publicKey,
    expectedVector: vector,
    observedVector: vector,
    head,
    now: Date.parse('2026-07-28T19:05:00.000Z'),
  }).vector, vector);
  assert.throws(
    () => validatePreClosePublicationState({
      lease,
      authorityPublicKey: publicKey,
      expectedVector: vector,
      observedVector: { ...vector, [lease.packages[0].name]: '0.2.0' },
      head,
      now: Date.parse('2026-07-28T19:05:00.000Z'),
    }),
    /vector drift/u,
  );
  assert.throws(
    () => validatePreClosePublicationState({
      lease,
      authorityPublicKey: publicKey,
      expectedVector: vector,
      observedVector: vector,
      head: acquiredHead(lease, privateKey, { status: 'closed', outcome: 'promoted' }),
      now: Date.parse('2026-07-28T19:05:00.000Z'),
    }),
    /lease head drifted/u,
  );
});

test('latest proof plan cannot inject a local command or substitute GitHub identity', () => {
  const plan = {
    schemaVersion: 'snapback.latest-root-proof-plan.v2',
    repository: 'ccheever/snapback',
    workflow: 'public-package-proof.yml',
    ref: 'main',
    expectedHeadSha: '1'.repeat(40),
    ledgerPath: 'demos/signal-desk/candidate-ledger.json',
    operationId: 'release-plan-test',
    helperSha256: '2'.repeat(64),
    darwinReceipt: 'proof/darwin.json',
    linuxReceipt: 'proof/linux.json',
    collection: 'proof/collection.json',
    dispatchTimeoutMs: 440_000,
    verifyTimeoutMs: 30_000,
  };
  const expected = {
    expectedOperationId: plan.operationId,
    expectedHelperSha256: plan.helperSha256,
    expectedLedgerPath: plan.ledgerPath,
    expectedHeadSha: plan.expectedHeadSha,
  };
  assert.equal(validateClosedLatestProofPlan({ plan, ...expected }), plan);
  assert.throws(
    () => validateClosedLatestProofPlan({
      plan: {
        schemaVersion: 'snapback.latest-root-proof-plan.v1',
        commands: [{ command: '/bin/sh', args: ['-c', 'true'] }],
      },
      ...expected,
    }),
    /unknown or missing members/u,
  );
  for (const mutate of [
    (candidate) => { candidate.repository = 'attacker/fork'; },
    (candidate) => { candidate.workflow = 'attacker.yml'; },
    (candidate) => { candidate.expectedHeadSha = '3'.repeat(40); },
    (candidate) => { candidate.helperSha256 = '4'.repeat(64); },
    (candidate) => { candidate.operationId = 'other-operation'; },
    (candidate) => { candidate.darwinReceipt = '../forged.json'; },
  ]) {
    const candidate = structuredClone(plan);
    mutate(candidate);
    assert.throws(
      () => validateClosedLatestProofPlan({ plan: candidate, ...expected }),
      /closed package-owned plan|normalized and relative/u,
    );
  }
});

test('post-promotion ledger closes candidate lineage, tags, and final receipts', () => {
  const { lease, privateKey } = fixture();
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
    ['darwin-arm64', 'b'],
    ['linux-x64', 'c'],
  ].map(([platform, fill], index) => ({
    platform,
    sha256: fill.repeat(64),
    github: {
      repository: 'ccheever/snapback',
      workflow: 'public-package-proof.yml',
      workflowId: 42,
      workflowPath: '.github/workflows/public-package-proof.yml@refs/heads/main',
      ref: 'main',
      runId: 100,
      runAttempt: 1,
      runHeadSha: 'd'.repeat(40),
      operationId: lease.operationId,
      dispatchStartedAt: '2026-07-28T19:00:00.000Z',
      runCreatedAt: '2026-07-28T19:00:01.000Z',
      runStartedAt: '2026-07-28T19:00:02.000Z',
      collectedAt: '2026-07-28T19:04:00.000Z',
      artifactId: 200 + index,
      artifactName: `artifact-${platform}`,
      artifactApiDigest: `sha256:${'e'.repeat(64)}`,
      artifactArchiveSha256: 'e'.repeat(64),
    },
    machine: {},
    latestRootResolution: {},
    browserCaptureSha256: 'f'.repeat(64),
    browserDistributionSha256: '3'.repeat(64),
    browserExecutableSha256: '1'.repeat(64),
    browserPackageTreeSha256: '2'.repeat(64),
  }));
  const preCloseAuthorityHead = acquiredHead(lease, privateKey);
  const preCloseRegistryObservation = {
    observedAt: '2026-07-28T19:05:00.000Z',
    vector,
  };
  const post = buildPostPromotionLedger({
    candidateLedger,
    lease,
    events,
    vector,
    latestRootReceipts,
    preCloseAuthorityHead,
    preCloseRegistryObservation,
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
