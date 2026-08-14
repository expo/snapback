import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  createPublicationAuthorityReceipt,
  PROMOTION_PACKAGE_NAMES,
  publicationAuthorityHeadSha256,
  publicationAuthoritySigningKeyId,
  signPublicationAuthorityHead,
  signPublicationLease,
} from '../packages/snapback-publication-authority/protocol.mjs';
import {
  BARRIER_STABILITY_RESERVE_MS,
  CURRENT_LEASE_SCHEMA_VERSION,
  LATEST_PROOF_COLLECTION_RESERVE_MS,
  LATEST_PROOF_MIN_DISPATCH_GRANT_MS,
  PROMOTION_ROLLBACK_RESERVE_MS,
  buildPostPromotionLedger,
  canonicalJcs,
  latestProofDispatchGrantMs,
  leaseSha256,
  publicationAuthorityTransition,
  promoteDefaultVector,
  readDefaultTagVector,
  unsignedLease,
  validatePublicationLease,
  validatePublicationAuthorityReceipt,
  validateClosedLatestProofPlan,
  validatePreClosePublicationState,
  validatePostPromotionLatestRootReceipts,
  validatePostPromotionLedger,
  vectorFromLease,
  validatePriorDependencyAlias,
  waitForPromotedInstallability,
} from './snapback-promotion-core.mjs';

const names = PROMOTION_PACKAGE_NAMES;
const authorityInstallationId = 'snapback-publication-promotion';
const authorityOrigin = 'https://publication-authority.example';

test('default-tag vector observations run concurrently and preserve missing tags', async () => {
  const packageNames = ['package-a', 'package-b', 'package-c'];
  let inFlight = 0;
  let maximumInFlight = 0;
  const vector = await readDefaultTagVector({
    names: packageNames,
    defaultTag: 'latest',
    readDistTags: async (name) => {
      inFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      await new Promise((resolveWait) => setTimeout(resolveWait, 20));
      inFlight -= 1;
      if (name === 'package-b') return '{}';
      return JSON.stringify({ latest: `${name}-version` });
    },
  });
  assert.equal(maximumInFlight, packageNames.length);
  assert.deepEqual(vector, {
    'package-a': 'package-a-version',
    'package-b': null,
    'package-c': 'package-c-version',
  });
});

test('one failed default-tag observation rejects only after the whole read settles', async () => {
  const packageNames = ['package-a', 'package-b', 'package-c'];
  let settled = 0;
  await assert.rejects(
    readDefaultTagVector({
      names: packageNames,
      defaultTag: 'latest',
      readDistTags: async (name) => {
        await new Promise((resolveWait) => setTimeout(
          resolveWait,
          name === 'package-b' ? 5 : 20,
        ));
        settled += 1;
        if (name === 'package-b') throw new Error('package-b view failed');
        return '{"latest":"0.1.0"}';
      },
    }),
    /package-b view failed/u,
  );
  assert.equal(settled, packageNames.length);
});

test('promotion executable imports the lease digest used by plan preflight', () => {
  const source = readFileSync(
    new URL('./snapback-promote.mjs', import.meta.url),
    'utf8',
  );
  const coreImport = source.match(
    /import \{(?<bindings>[\s\S]*?)\} from '\.\/snapback-promotion-core\.mjs';/u,
  );
  assert.ok(coreImport?.groups?.bindings);
  assert.match(coreImport.groups.bindings, /(?:^|[\s,])leaseSha256(?:[\s,]|$)/u);
});

test('promote pins the lease generation the standing authority issues', () => {
  // The authority's issuance path and the promote CLI's preflight pin must
  // share one generation constant. A literal pin in the promote executable
  // survived the v3 -> v4 decision-9 bump and refused every issuable lease
  // (issues/closed/20260801-promote-v3-lease-pin-refuses-v4.md).
  const authoritySource = readFileSync(
    new URL(
      '../packages/snapback-publication-authority/authority.mjs',
      import.meta.url,
    ),
    'utf8',
  );
  assert.match(
    authoritySource,
    /schemaVersion: CURRENT_LEASE_SCHEMA_VERSION/u,
    'authority issuance must use the shared generation constant',
  );
  assert.doesNotMatch(
    authoritySource,
    /schemaVersion: 'snapback\.authorized-publication-lease\.v\d+'/u,
    'authority issuance must not carry a literal lease generation',
  );
  const promoteSource = readFileSync(
    new URL('./snapback-promote.mjs', import.meta.url),
    'utf8',
  );
  const promoteCoreImport = promoteSource.match(
    /import \{(?<bindings>[\s\S]*?)\} from '\.\/snapback-promotion-core\.mjs';/u,
  );
  assert.match(
    promoteCoreImport.groups.bindings,
    /(?:^|[\s,])CURRENT_LEASE_SCHEMA_VERSION(?:[\s,]|$)/u,
    'promote must import the shared generation constant',
  );
  assert.match(
    promoteSource,
    /lease\.schemaVersion !== CURRENT_LEASE_SCHEMA_VERSION/u,
    'promote preflight must pin to the shared generation constant',
  );
  assert.doesNotMatch(
    promoteSource,
    /authorized-publication-lease\.v\d+/u,
    'promote must not carry a literal lease generation that a bump can strand',
  );
  // Behavioral half: a lease of the current generation — the shape the
  // authority signs and validatePublicationLease accepts as current — is the
  // generation the promote pin admits.
  const { lease, publicKey } = fixture();
  assert.equal(lease.schemaVersion, CURRENT_LEASE_SCHEMA_VERSION);
  validatePublicationLease({
    lease,
    publicKey,
    authorityInstallationId,
    authorityOrigin,
    candidateLedgerSha256: lease.candidateLedgerSha256,
    candidateTag: lease.candidateTag,
    publisherInstanceId: lease.publisherInstanceId,
    priorDefaultClosureReceiptSha256: lease.priorDefaultClosureReceiptSha256,
    now: Date.parse(lease.issuedAt) + 1_000,
  });
});

function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const unsigned = {
    schemaVersion: 'snapback.authorized-publication-lease.v4',
    authorityInstallationId,
    authorityOrigin,
    signingKeyId: publicationAuthoritySigningKeyId(publicKey),
    operationId: 'release-0.1.1-test',
    publisherInstanceId: 'publisher-test-01',
    publicationEpoch: 7,
    candidateLedgerSha256: 'a'.repeat(64),
    candidateTag: 'bakeoff-0-1-1-deadbeefcafe',
    defaultTag: 'latest',
    priorDefaultClosureReceiptSha256: 'e'.repeat(64),
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

test('lease is signature, candidate, time, and promotion-inventory bound', () => {
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
  assert.throws(
    () => validatePublicationLease({
      lease,
      publicKey,
      authorityInstallationId,
      authorityOrigin,
      candidateLedgerSha256: 'a'.repeat(64),
      candidateTag: lease.candidateTag,
      publisherInstanceId: lease.publisherInstanceId,
      priorDefaultClosureReceiptSha256: 'b'.repeat(64),
      now: Date.parse('2026-07-28T19:05:00.000Z'),
    }),
    /prior closure mismatch/u,
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
    Array(names.length).fill('0.1.1'),
  );
  assert.equal(result.events.length, names.length);
});

test('forward and rollback mutations are preceded by vector then fresh head', async () => {
  const { lease, privateKey, publicKey } = fixture();
  const vector = vectorFromLease(lease, 'prior');
  const prior = structuredClone(vector);
  const head = acquiredHead(lease, privateKey);
  const trace = [];
  await assert.rejects(
    promoteDefaultVector({
      lease,
      authorityPublicKey: publicKey,
      readVector: async () => {
        trace.push('vector');
        return structuredClone(vector);
      },
      readLeaseHead: async () => {
        trace.push('head');
        return structuredClone(head);
      },
      setTag: async (name, version) => {
        trace.push(`set:${name}`);
        vector[name] = version;
      },
      removeTag: async (name) => {
        trace.push(`remove:${name}`);
        vector[name] = null;
      },
      now: () => Date.parse('2026-07-28T19:05:00.000Z'),
      afterPromotion: async () => {
        throw new Error('force ordering rollback');
      },
    }),
    /force ordering rollback/u,
  );
  const mutationIndexes = trace
    .map((event, index) => (/^(?:set|remove):/u.test(event) ? index : null))
    .filter((index) => index !== null);
  assert.ok(mutationIndexes.length > lease.packages.length);
  for (const index of mutationIndexes) {
    assert.deepEqual(
      trace.slice(index - 2, index),
      ['vector', 'head'],
      `mutation ${trace[index]} must follow vector then head`,
    );
  }
  assert.ok(trace.some((event) => event.startsWith('remove:')));
  assert.deepEqual(vector, prior);
});

test('a first-publication package already on the new version is a verified no-op', async () => {
  const base = fixture();
  const unsigned = unsignedLease(base.lease);
  const umbrellaIndex = unsigned.packages.findIndex(
    (row) => row.name === '@expo/snapback',
  );
  unsigned.packages[umbrellaIndex].expectedPriorVersion =
    unsigned.packages[umbrellaIndex].newVersion;
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
  assert.equal(writes.length, names.length - 1);
  assert.deepEqual(
    result.events.map((event) => event.package),
    names,
  );
  assert.equal(result.events[umbrellaIndex].alreadyAtNewVersion, true);
  assert.deepEqual(
    result.events[umbrellaIndex].before,
    result.events[umbrellaIndex].after,
  );
  assert.deepEqual(Object.values(result.vector), Array(names.length).fill('0.1.1'));
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
  const owner = unsigned.packages.find(
    (row) => row.name === '@expo/snapback-vite',
  );
  owner.expectedPriorVersion = owner.newVersion;
  const lease = signPublicationLease({ unsigned, privateKey: base.privateKey });
  assert.deepEqual(
    validatePriorDependencyAlias({
      lease,
      ownerName: owner.name,
      dependency: '@expo/snapback-cli',
      target: '@expo/snapback-cli',
      version: '0.1.1',
    }),
    { sectionVector: 'new', selectedVersion: '0.1.1' },
  );
  assert.throws(
    () => validatePriorDependencyAlias({
      lease,
      ownerName: names[2],
      dependency: '@expo/snapback-client',
      target: names[3],
      version: '0.1.1',
    }),
    /escapes the authorized vector/u,
  );
  assert.deepEqual(
    validatePriorDependencyAlias({
      lease,
      ownerName: names[2],
      dependency: '@expo/snapback-client',
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
      assert.equal(error.result.rollback.length, names.length);
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
      assert.equal(error.result.rollback.length, names.length);
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
      assert.equal(error.result.rollback.length, names.length);
      assert.ok(error.result.rollback.slice(1).every((row) => row.ok === true));
      assert.equal(
        error.result.rollback[1].preMutationRegistryConvergenceAttempts,
        2,
      );
      return true;
    },
  );
  assert.equal(rollbackWrites, names.length);
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
      assert.equal(error.result.rollback.length, names.length);
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

test('promoted installability retries only the prior CLI root and retains the closure', async () => {
  const { lease, privateKey, publicKey } = fixture();
  const vector = vectorFromLease(lease, 'new');
  const head = acquiredHead(lease, privateKey);
  let clock = Date.parse('2026-07-28T19:05:00.000Z');
  let probes = 0;
  const waits = [];
  const retained = [];
  const result = await waitForPromotedInstallability({
    lease,
    authorityPublicKey: publicKey,
    expectedVector: vector,
    readVector: async () => structuredClone(vector),
    readLeaseHead: async () => structuredClone(head),
    observeInstallability: async () => {
      probes += 1;
      if (probes === 1) {
        return {
          ok: false,
          rootVersion: '0.1.0',
          closure: null,
          error: 'latest root remained at the signed prior version',
          retryablePriorRoot: true,
        };
      }
      return {
        ok: true,
        rootVersion: '0.1.1',
        closure: { root: '@expo/snapback-cli', selected: '0.1.1' },
        error: null,
        retryablePriorRoot: false,
      };
    },
    record: (evidence) => retained.push(evidence),
    now: () => clock,
    wait: async (milliseconds) => {
      waits.push(milliseconds);
      clock += milliseconds;
    },
    delayMs: 2_500,
    probeBoundMs: 1_000,
    requiredRemainingMs: 60_000,
  });
  assert.equal(result.status, 'passed');
  assert.equal(result.schemaVersion, 'snapback.promoted-installability-barrier.v2');
  assert.equal(result.attempts.length, 2);
  assert.equal(result.maximumAttempts, 6);
  assert.equal(result.attempts[0].observation.rootVersion, '0.1.0');
  assert.equal(result.resolution.selected, '0.1.1');
  assert.deepEqual(waits, [2_500]);
  assert.equal(retained.at(-1).status, 'passed');
  assert.match(result.attempts[0].beforeVectorSha256, /^[0-9a-f]{64}$/u);
  assert.equal(result.attempts[0].publicationEpoch, lease.publicationEpoch);
});

test('promoted installability can require separated stable candidate closures', async () => {
  const { lease, privateKey, publicKey } = fixture();
  const vector = vectorFromLease(lease, 'new');
  const head = acquiredHead(lease, privateKey);
  let clock = Date.parse('2026-07-28T19:05:00.000Z');
  let probes = 0;
  const waits = [];
  const result = await waitForPromotedInstallability({
    lease,
    authorityPublicKey: publicKey,
    expectedVector: vector,
    readVector: async () => structuredClone(vector),
    readLeaseHead: async () => structuredClone(head),
    observeInstallability: async () => {
      probes += 1;
      return {
        ok: true,
        rootVersion: '0.1.1',
        closure: { root: '@expo/snapback-cli', selected: '0.1.1', probe: probes },
        error: null,
        retryablePriorRoot: false,
      };
    },
    now: () => clock,
    wait: async (milliseconds) => {
      waits.push(milliseconds);
      clock += milliseconds;
    },
    attempts: 3,
    delayMs: 30_000,
    probeBoundMs: 1_000,
    requiredRemainingMs: 60_000,
    requiredSuccessfulAttempts: 2,
  });
  assert.equal(result.status, 'passed');
  assert.equal(result.attempts.length, 2);
  assert.equal(result.requiredSuccessfulAttempts, 2);
  assert.equal(result.maximumAttempts, 3);
  assert.equal(result.delayMs, 30_000);
  assert.equal(result.mandatoryStabilityReserveMs, 32_000);
  assert.deepEqual(waits, [30_000]);
  assert.equal(result.resolution.probe, 2);
});

test('stable candidate observations must be consecutive and mixed states stay terminal', async () => {
  const { lease, privateKey, publicKey } = fixture();
  const vector = vectorFromLease(lease, 'new');
  const head = acquiredHead(lease, privateKey);
  const candidate = (probe) => ({
    ok: true,
    rootVersion: '0.1.1',
    closure: { root: '@expo/snapback-cli', selected: '0.1.1', probe },
    error: null,
    retryablePriorRoot: false,
  });
  const prior = {
    ok: false,
    rootVersion: '0.1.0',
    closure: null,
    error: 'uniform signed prior closure',
    retryablePriorRoot: true,
  };
  let probes = 0;
  let waits = 0;
  const result = await waitForPromotedInstallability({
    lease,
    authorityPublicKey: publicKey,
    expectedVector: vector,
    readVector: async () => structuredClone(vector),
    readLeaseHead: async () => structuredClone(head),
    observeInstallability: async () => {
      probes += 1;
      return probes === 2 ? prior : candidate(probes);
    },
    now: () => Date.parse('2026-07-28T19:05:00.000Z'),
    wait: async () => { waits += 1; },
    attempts: 4,
    delayMs: 1,
    probeBoundMs: 1_000,
    requiredRemainingMs: 60_000,
    requiredSuccessfulAttempts: 2,
  });
  assert.equal(probes, 4);
  assert.equal(waits, 3);
  assert.equal(result.attempts.length, 4);
  assert.equal(result.resolution.probe, 4);

  probes = 0;
  waits = 0;
  await assert.rejects(
    waitForPromotedInstallability({
      lease,
      authorityPublicKey: publicKey,
      expectedVector: vector,
      readVector: async () => structuredClone(vector),
      readLeaseHead: async () => structuredClone(head),
      observeInstallability: async () => {
        probes += 1;
        if (probes === 1) return candidate(probes);
        return {
          ok: false,
          rootVersion: '0.1.1',
          closure: null,
          error: 'mixed or incomplete candidate closure',
          retryablePriorRoot: false,
        };
      },
      now: () => Date.parse('2026-07-28T19:05:00.000Z'),
      wait: async () => { waits += 1; },
      attempts: 4,
      delayMs: 1,
      probeBoundMs: 1_000,
      requiredRemainingMs: 60_000,
      requiredSuccessfulAttempts: 2,
    }),
    /outside the retryable prior-root state/u,
  );
  assert.equal(probes, 2);
  assert.equal(waits, 1);
});

test('promoted installability refuses probe errors and third states without retry', async () => {
  const { lease, privateKey, publicKey } = fixture();
  const vector = vectorFromLease(lease, 'new');
  const head = acquiredHead(lease, privateKey);
  for (const observation of [
    {
      ok: false,
      rootVersion: null,
      closure: null,
      error: 'fresh-cache npm install failed',
      retryablePriorRoot: false,
    },
    {
      ok: false,
      rootVersion: '0.1.0',
      closure: null,
      error: 'fresh-cache npm install failed after partial materialization',
      retryablePriorRoot: false,
    },
    {
      ok: false,
      rootVersion: '9.9.9',
      closure: null,
      error: 'unexpected root',
      retryablePriorRoot: false,
    },
    {
      ok: false,
      rootVersion: '0.1.1',
      closure: null,
      error: 'candidate root had the wrong transitive closure',
      retryablePriorRoot: false,
    },
    {
      ok: true,
      rootVersion: '0.1.1',
      closure: null,
      error: null,
      retryablePriorRoot: false,
    },
  ]) {
    let probes = 0;
    let waits = 0;
    await assert.rejects(
      waitForPromotedInstallability({
        lease,
        authorityPublicKey: publicKey,
        expectedVector: vector,
        readVector: async () => structuredClone(vector),
        readLeaseHead: async () => structuredClone(head),
        observeInstallability: async () => {
          probes += 1;
          return observation;
        },
        now: () => Date.parse('2026-07-28T19:05:00.000Z'),
        wait: async () => { waits += 1; },
        probeBoundMs: 1_000,
        requiredRemainingMs: 60_000,
      }),
      /retryable prior-root state|invalid observation|incomplete closure/u,
    );
    assert.equal(probes, 1);
    assert.equal(waits, 0);
  }
});

test('an already-candidate CLI root never makes a malformed closure retryable', async () => {
  const base = fixture();
  const unsigned = unsignedLease(base.lease);
  const cliRow = unsigned.packages.find(
    (row) => row.name === '@expo/snapback-cli',
  );
  cliRow.expectedPriorVersion = cliRow.newVersion;
  const lease = signPublicationLease({ unsigned, privateKey: base.privateKey });
  const vector = vectorFromLease(lease, 'new');
  const head = acquiredHead(lease, base.privateKey);
  let waits = 0;
  await assert.rejects(
    waitForPromotedInstallability({
      lease,
      authorityPublicKey: base.publicKey,
      expectedVector: vector,
      readVector: async () => structuredClone(vector),
      readLeaseHead: async () => structuredClone(head),
      observeInstallability: async () => ({
        ok: false,
        rootVersion: cliRow.newVersion,
        closure: null,
        error: 'candidate root had the wrong transitive closure',
        retryablePriorRoot: true,
      }),
      now: () => Date.parse('2026-07-28T19:05:00.000Z'),
      wait: async () => { waits += 1; },
      probeBoundMs: 1_000,
      requiredRemainingMs: 60_000,
    }),
    /retryable prior-root state/u,
  );
  assert.equal(waits, 0);
});

test('promoted installability preserves hosted-proof and rollback lease budget', async () => {
  const { lease, privateKey, publicKey } = fixture();
  const vector = vectorFromLease(lease, 'new');
  const head = acquiredHead(lease, privateKey);
  let probes = 0;
  const retained = [];
  await assert.rejects(
    waitForPromotedInstallability({
      lease,
      authorityPublicKey: publicKey,
      expectedVector: vector,
      readVector: async () => structuredClone(vector),
      readLeaseHead: async () => structuredClone(head),
      observeInstallability: async () => {
        probes += 1;
        return {
          ok: true,
          rootVersion: '0.1.1',
          closure: { root: '@expo/snapback-cli', selected: '0.1.1' },
          error: null,
          retryablePriorRoot: false,
        };
      },
      record: (evidence) => retained.push(evidence),
      now: () => Date.parse('2026-07-28T19:14:30.000Z'),
      probeBoundMs: 15_000,
      requiredRemainingMs: 20_000,
    }),
    /reserved proof and rollback budget/u,
  );
  assert.equal(probes, 0);
  assert.equal(retained.at(-1).status, 'failed');
  assert.match(retained.at(-1).error, /reserved proof and rollback budget/u);
});

test('stable candidate barrier reserves both probes and their separating delay', async () => {
  const { lease, privateKey, publicKey } = fixture();
  const vector = vectorFromLease(lease, 'new');
  const head = acquiredHead(lease, privateKey);
  let probes = 0;
  await assert.rejects(
    waitForPromotedInstallability({
      lease,
      authorityPublicKey: publicKey,
      expectedVector: vector,
      readVector: async () => structuredClone(vector),
      readLeaseHead: async () => structuredClone(head),
      observeInstallability: async () => {
        probes += 1;
        return {
          ok: true,
          rootVersion: '0.1.1',
          closure: { root: '@expo/snapback-cli', selected: '0.1.1' },
          error: null,
          retryablePriorRoot: false,
        };
      },
      now: () => Date.parse('2026-07-28T19:13:55.000Z'),
      attempts: 2,
      delayMs: 30_000,
      probeBoundMs: 10_000,
      requiredRemainingMs: 20_000,
      requiredSuccessfulAttempts: 2,
    }),
    /reserved proof and rollback budget/u,
  );
  assert.equal(probes, 0);
});

test('stable candidate barrier rechecks reserve after its first successful probe', async () => {
  const { lease, privateKey, publicKey } = fixture();
  const vector = vectorFromLease(lease, 'new');
  const head = acquiredHead(lease, privateKey);
  let clock = Date.parse('2026-07-28T19:13:49.000Z');
  let probes = 0;
  let waits = 0;
  const retained = [];
  await assert.rejects(
    waitForPromotedInstallability({
      lease,
      authorityPublicKey: publicKey,
      expectedVector: vector,
      readVector: async () => structuredClone(vector),
      readLeaseHead: async () => structuredClone(head),
      observeInstallability: async () => {
        probes += 1;
        return {
          ok: true,
          rootVersion: '0.1.1',
          closure: { root: '@expo/snapback-cli', selected: '0.1.1' },
          error: null,
          retryablePriorRoot: false,
        };
      },
      record: (evidence) => {
        retained.push(evidence);
        if (evidence.status === 'running' && evidence.attempts.length === 1) {
          clock += 12_000;
        }
      },
      now: () => clock,
      wait: async () => { waits += 1; },
      attempts: 2,
      delayMs: 30_000,
      probeBoundMs: 10_000,
      requiredRemainingMs: 20_000,
      requiredSuccessfulAttempts: 2,
    }),
    /reserved proof and rollback budget/u,
  );
  assert.equal(probes, 1);
  assert.equal(waits, 0);
  assert.equal(retained.at(-1).status, 'failed');
  assert.equal(retained.at(-1).attempts.length, 1);
  assert.equal(retained.at(-1).attempts[0].observation.ok, true);
  assert.match(retained.at(-1).error, /reserved proof and rollback budget/u);
});

test('stable candidate barrier rechecks downstream reserve after final evidence retention', async () => {
  const { lease, privateKey, publicKey } = fixture();
  const vector = vectorFromLease(lease, 'new');
  const head = acquiredHead(lease, privateKey);
  let clock = Date.parse('2026-07-28T19:14:10.000Z');
  let probes = 0;
  let waits = 0;
  const retained = [];
  await assert.rejects(
    waitForPromotedInstallability({
      lease,
      authorityPublicKey: publicKey,
      expectedVector: vector,
      readVector: async () => structuredClone(vector),
      readLeaseHead: async () => structuredClone(head),
      observeInstallability: async () => {
        probes += 1;
        return {
          ok: true,
          rootVersion: '0.1.1',
          closure: { root: '@expo/snapback-cli', selected: '0.1.1' },
          error: null,
          retryablePriorRoot: false,
        };
      },
      record: (evidence) => {
        retained.push(evidence);
        if (evidence.status === 'passed') clock += 30_000;
      },
      now: () => clock,
      wait: async (milliseconds) => {
        waits += 1;
        clock += milliseconds;
      },
      attempts: 2,
      delayMs: 1_000,
      probeBoundMs: 1_000,
      requiredRemainingMs: 20_000,
      requiredSuccessfulAttempts: 2,
    }),
    /reserved proof and rollback budget/u,
  );
  assert.equal(probes, 2);
  assert.equal(waits, 1);
  assert.equal(retained.at(-1).status, 'failed');
  assert.equal(retained.at(-1).attempts.length, 2);
  assert.match(retained.at(-1).error, /reserved proof and rollback budget/u);
});

test('promoted installability rechecks its reserve after pre-probe fences', async () => {
  const { lease, privateKey, publicKey } = fixture();
  const vector = vectorFromLease(lease, 'new');
  const head = acquiredHead(lease, privateKey);
  let clock = Date.parse('2026-07-28T19:10:00.000Z');
  let probes = 0;
  const retained = [];
  await assert.rejects(
    waitForPromotedInstallability({
      lease,
      authorityPublicKey: publicKey,
      expectedVector: vector,
      readVector: async () => {
        clock += 10_000;
        return structuredClone(vector);
      },
      readLeaseHead: async () => {
        clock += 10_000;
        return structuredClone(head);
      },
      observeInstallability: async () => {
        probes += 1;
        return {
          ok: true,
          rootVersion: '0.1.1',
          closure: { root: '@expo/snapback-cli', selected: '0.1.1' },
          error: null,
          retryablePriorRoot: false,
        };
      },
      record: (evidence) => retained.push(evidence),
      now: () => clock,
      probeBoundMs: 45_000,
      requiredRemainingMs: 240_000,
    }),
    /reserved proof and rollback budget/u,
  );
  assert.equal(probes, 0);
  assert.equal(retained.at(-1).status, 'failed');
});

test('exhausted promoted installability enters the complete vector rollback', async () => {
  const { lease, privateKey, publicKey } = fixture();
  const vector = vectorFromLease(lease, 'prior');
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
      wait: async () => {},
      registryConvergenceDelayMs: 0,
      afterPromotion: async ({ vector: promoted }) => (
        waitForPromotedInstallability({
          lease,
          authorityPublicKey: publicKey,
          expectedVector: promoted,
          readVector: async () => structuredClone(vector),
          readLeaseHead: async () => structuredClone(head),
          observeInstallability: async () => ({
            ok: false,
            rootVersion: '0.1.0',
            closure: null,
            error: 'latest root remained stale',
            retryablePriorRoot: true,
          }),
          now: () => Date.parse('2026-07-28T19:05:00.000Z'),
          wait: async () => {},
          attempts: 2,
          delayMs: 0,
          probeBoundMs: 1_000,
          requiredRemainingMs: 60_000,
        })
      ),
    }),
    (error) => {
      assert.match(error.message, /did not converge after 2 attempts/u);
      assert.equal(error.result.rollback.length, names.length);
      assert.ok(error.result.rollback.every((event) => event.ok));
      return true;
    },
  );
  assert.deepEqual(vector, prior);
});

test('latest proof plan cannot inject a local command or substitute GitHub identity', () => {
  const plan = {
    schemaVersion: 'snapback.latest-root-proof-plan.v3',
    authorizedLeaseSha256: '5'.repeat(64),
    repository: 'expo/snapback',
    workflow: 'public-package-proof.yml',
    ref: 'main',
    expectedHeadSha: '1'.repeat(40),
    expectedPriorRootVersion: '0.1.0',
    ledgerPath: 'demos/signal-desk/candidate-ledger.json',
    operationId: 'release-plan-test',
    publicationEpoch: 17,
    helperSha256: '2'.repeat(64),
    darwinReceipt: 'proof/darwin.json',
    linuxReceipt: 'proof/linux.json',
    collection: 'proof/collection.json',
    dispatchTimeoutMs: 540_000,
    verifyTimeoutMs: 30_000,
  };
  const expected = {
    expectedOperationId: plan.operationId,
    expectedHelperSha256: plan.helperSha256,
    expectedLedgerPath: plan.ledgerPath,
    expectedHeadSha: plan.expectedHeadSha,
    expectedPriorRootVersion: plan.expectedPriorRootVersion,
    expectedAuthorizedLeaseSha256: plan.authorizedLeaseSha256,
    expectedPublicationEpoch: plan.publicationEpoch,
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
    (candidate) => { candidate.expectedPriorRootVersion = '0.0.9'; },
    (candidate) => { candidate.authorizedLeaseSha256 = '6'.repeat(64); },
    (candidate) => { candidate.publicationEpoch = 18; },
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

test('dispatch grant clamps the plan ceiling to the live lease and reserves once', () => {
  const plan = { dispatchTimeoutMs: 400_000, verifyTimeoutMs: 30_000 };
  // Plenty of lease: the ceiling is granted whole.
  assert.equal(
    latestProofDispatchGrantMs({ plan, remainingMs: 700_000 }),
    400_000,
  );
  // Tight lease: the grant is remaining minus (collection + verify +
  // rollback), each reserved exactly once.
  assert.equal(
    latestProofDispatchGrantMs({ plan, remainingMs: 580_000 }),
    580_000 - (90_000 + 30_000 + 120_000),
  );
  // Below the minimum viable window the dispatch refuses.
  assert.throws(
    () => latestProofDispatchGrantMs({
      plan,
      remainingMs: LATEST_PROOF_MIN_DISPATCH_GRANT_MS + 90_000 + 30_000 + 120_000 - 1,
    }),
    /reserved proof and rollback budget/u,
  );
  // Exact boundary is granted.
  assert.equal(
    latestProofDispatchGrantMs({
      plan,
      remainingMs: LATEST_PROOF_MIN_DISPATCH_GRANT_MS + 90_000 + 30_000 + 120_000,
    }),
    LATEST_PROOF_MIN_DISPATCH_GRANT_MS,
  );
  // A ceiling below the floor can never dispatch.
  assert.throws(
    () => latestProofDispatchGrantMs({
      plan: { dispatchTimeoutMs: 299_999, verifyTimeoutMs: 30_000 },
      remainingMs: 900_000,
    }),
    /reserved proof and rollback budget/u,
  );
  assert.throws(
    () => latestProofDispatchGrantMs({ plan, remainingMs: Number.NaN }),
    TypeError,
  );
});

test('measured r3 promotion timeline fits the once-reserved budget model', () => {
  const plan = { dispatchTimeoutMs: 400_000, verifyTimeoutMs: 30_000 };
  const leaseLifetimeMs = 900_000;
  const preflightMs = 200_000; // telemetry gate + closures + acquire + 12 tag moves
  const runWallMs = 280_000; // observed hosted run wall (created -> success)
  // Barrier entry: what the promote driver now requires to remain.
  const barrierEntryNeedMs =
    LATEST_PROOF_MIN_DISPATCH_GRANT_MS
    + LATEST_PROOF_COLLECTION_RESERVE_MS
    + plan.verifyTimeoutMs
    + PROMOTION_ROLLBACK_RESERVE_MS
    + BARRIER_STABILITY_RESERVE_MS;
  const remainingAtBarrierEntryMs = leaseLifetimeMs - preflightMs;
  assert.ok(remainingAtBarrierEntryMs >= barrierEntryNeedMs);
  // The barrier spends its full stability reserve, then dispatch is granted a
  // window the measured run fits inside.
  const remainingAtDispatchMs =
    remainingAtBarrierEntryMs - BARRIER_STABILITY_RESERVE_MS;
  const grantMs = latestProofDispatchGrantMs({
    plan,
    remainingMs: remainingAtDispatchMs,
  });
  assert.equal(grantMs, 340_000);
  assert.ok(runWallMs <= grantMs);
  // Even at full exhaustion of wait + collection, verify and rollback keep
  // their complete reserves inside the lease.
  assert.ok(
    remainingAtDispatchMs - grantMs - LATEST_PROOF_COLLECTION_RESERVE_MS
      >= plan.verifyTimeoutMs + PROMOTION_ROLLBACK_RESERVE_MS,
  );
});

test('the r4 dispatch ceiling no longer double-reserves the wait', () => {
  const plan = { dispatchTimeoutMs: 510_000, verifyTimeoutMs: 30_000 };
  const leaseLifetimeMs = 900_000;
  const preflightMs = 200_000;
  const runWallMs = 280_000;
  const barrierEntryNeedMs =
    LATEST_PROOF_MIN_DISPATCH_GRANT_MS
    + LATEST_PROOF_COLLECTION_RESERVE_MS
    + plan.verifyTimeoutMs
    + PROMOTION_ROLLBACK_RESERVE_MS
    + BARRIER_STABILITY_RESERVE_MS;
  const remainingAtBarrierEntryMs = leaseLifetimeMs - preflightMs;
  assert.equal(barrierEntryNeedMs, 660_000);
  assert.ok(remainingAtBarrierEntryMs >= barrierEntryNeedMs);
  const remainingAtDispatchMs =
    remainingAtBarrierEntryMs - BARRIER_STABILITY_RESERVE_MS;
  const grantMs = latestProofDispatchGrantMs({
    plan,
    remainingMs: remainingAtDispatchMs,
  });
  assert.equal(grantMs, 340_000);
  assert.ok(runWallMs <= grantMs);
  // This is the pre-fix formula that refused a fitting ceremony.
  assert.ok(
    510_000 + 30_000 + 120_000 + 120_000
      > leaseLifetimeMs - preflightMs,
  );
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
      authorizedLeaseSha256: leaseSha256(lease),
      repository: 'expo/snapback',
      workflow: 'public-package-proof.yml',
      workflowId: 42,
      workflowPath: '.github/workflows/public-package-proof.yml@refs/heads/main',
      ref: 'main',
      runId: 100,
      runAttempt: 1,
      runHeadSha: 'd'.repeat(40),
      operationId: lease.operationId,
      publicationEpoch: lease.publicationEpoch,
      expectedPriorRootVersion: '0.1.0',
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
    latestRootPropagationSha256: '4'.repeat(64),
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
  assert.equal(post.schemaVersion, 'snapback.package-post-promotion-ledger.v2');
  assert.equal(post.previousLedgerSha256, lease.candidateLedgerSha256);
  assert.equal(validatePostPromotionLedger(post), post);
  assert.throws(
    () => validatePostPromotionLedger({
      ...post,
      schemaVersion: 'snapback.package-post-promotion-ledger.v1',
    }),
    /unsupported post-promotion ledger schema/u,
  );
  assert.throws(
    () => validatePostPromotionLedger({
      ...post,
      finalVector: { ...post.finalVector, [names[0]]: '0.1.0' },
    }),
    /self-digest mismatch/u,
  );
});

test('latest receipts accept canonical GitHub second-precision run timestamps', () => {
  const { lease } = fixture();
  // GitHub's REST API reports run times at second precision and the raw
  // strings are preserved end-to-end for the helper's byte-exact reopen
  // equality; ceremony release-0.1.18-20260811-r10 was refused on exactly
  // this shape after a successful hosted proof.
  const receipts = (overrides = {}) => [
    ['darwin-arm64', 'b'],
    ['linux-x64', 'c'],
  ].map(([platform, fill], index) => ({
    platform,
    sha256: fill.repeat(64),
    github: {
      authorizedLeaseSha256: leaseSha256(lease),
      repository: 'expo/snapback',
      workflow: 'public-package-proof.yml',
      workflowId: 42,
      workflowPath: '.github/workflows/public-package-proof.yml',
      ref: 'release/qualified-0.1.18',
      runId: 31449958810,
      runAttempt: 1,
      runHeadSha: 'd'.repeat(40),
      operationId: lease.operationId,
      publicationEpoch: lease.publicationEpoch,
      expectedPriorRootVersion: '0.1.0',
      dispatchStartedAt: '2026-08-11T01:39:37.123Z',
      runCreatedAt: '2026-08-11T01:39:43Z',
      runStartedAt: '2026-08-11T01:39:44Z',
      collectedAt: '2026-08-11T01:45:00.456Z',
      artifactId: 200 + index,
      artifactName: `artifact-${platform}`,
      artifactApiDigest: `sha256:${'e'.repeat(64)}`,
      artifactArchiveSha256: 'e'.repeat(64),
      ...overrides,
    },
    machine: {},
    latestRootResolution: {},
    latestRootPropagationSha256: '4'.repeat(64),
    browserCaptureSha256: 'f'.repeat(64),
    browserDistributionSha256: '3'.repeat(64),
    browserExecutableSha256: '1'.repeat(64),
    browserPackageTreeSha256: '2'.repeat(64),
  }));
  const accepted = receipts();
  assert.equal(
    validatePostPromotionLatestRootReceipts(accepted, lease.operationId),
    accepted,
  );
  for (const runCreatedAt of [
    '2026-08-11T01:39:43',
    '2026-08-11T01:39:43.5Z',
    '2026-13-11T01:39:43Z',
    '2026-08-11T24:00:00Z',
    '2026-08-11 01:39:43Z',
  ]) {
    assert.throws(
      () => validatePostPromotionLatestRootReceipts(
        receipts({ runCreatedAt, runStartedAt: runCreatedAt }),
        lease.operationId,
      ),
      /must be canonical UTC milliseconds|is not canonical/u,
    );
  }
});

test('signature preimage excludes only signature', () => {
  const { lease } = fixture();
  assert.equal(unsignedLease(lease).signature, undefined);
});
