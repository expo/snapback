import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';

import {
  canonicalJcs,
  leaseSha256,
  promoteDefaultVector,
  unsignedLease,
  validatePublicationLease,
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

function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const lease = {
    schemaVersion: 'snapback.authorized-publication-lease.v1',
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
      expectedPriorVersion: index === 6 ? null : '0.1.0',
      newVersion: '0.1.1',
    })),
  };
  const payload = Buffer.concat([
    Buffer.from('snapback-authorized-publication-lease-v1\0'),
    Buffer.from(canonicalJcs(lease)),
  ]);
  lease.signature = sign(null, payload, privateKey).toString('base64url');
  return { lease, publicKey };
}

test('lease is signature, candidate, time, and nine-package bound', () => {
  const { lease, publicKey } = fixture();
  assert.equal(
    validatePublicationLease({
      lease,
      publicKey,
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
      candidateLedgerSha256: 'a'.repeat(64),
      candidateTag: lease.candidateTag,
      publisherInstanceId: lease.publisherInstanceId,
      now: Date.parse('2026-07-28T19:05:00.000Z'),
    }),
    /unknown or missing members/,
  );
});

test('promotion checks the complete vector around each tag mutation', async () => {
  const { lease } = fixture();
  const vector = Object.fromEntries(lease.packages.map((row) => [
    row.name,
    row.expectedPriorVersion,
  ]));
  const head = {
    operationId: lease.operationId,
    publicationEpoch: lease.publicationEpoch,
    leaseSha256: leaseSha256(lease),
  };
  const result = await promoteDefaultVector({
    lease,
    readVector: async () => structuredClone(vector),
    readLeaseHead: async () => structuredClone(head),
    setTag: async (name, version) => { vector[name] = version; },
    removeTag: async (name) => { vector[name] = null; },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(
    Object.values(result.vector),
    Array(9).fill('0.1.1'),
  );
  assert.equal(result.events.length, 9);
});

test('failure rolls back every changed tag in reverse order', async () => {
  const { lease } = fixture();
  const vector = Object.fromEntries(lease.packages.map((row) => [
    row.name,
    row.expectedPriorVersion,
  ]));
  const prior = structuredClone(vector);
  const head = {
    operationId: lease.operationId,
    publicationEpoch: lease.publicationEpoch,
    leaseSha256: leaseSha256(lease),
  };
  let writes = 0;
  await assert.rejects(
    promoteDefaultVector({
      lease,
      readVector: async () => structuredClone(vector),
      readLeaseHead: async () => structuredClone(head),
      setTag: async (name, version) => {
        writes += 1;
        if (writes === 4) throw new Error('simulated npm failure');
        vector[name] = version;
      },
      removeTag: async (name) => { vector[name] = null; },
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

test('an ambiguous command error is reconciled from the registry and rolled back', async () => {
  const { lease } = fixture();
  const vector = Object.fromEntries(lease.packages.map((row) => [
    row.name,
    row.expectedPriorVersion,
  ]));
  const prior = structuredClone(vector);
  const head = {
    operationId: lease.operationId,
    publicationEpoch: lease.publicationEpoch,
    leaseSha256: leaseSha256(lease),
  };
  let writes = 0;
  await assert.rejects(
    promoteDefaultVector({
      lease,
      readVector: async () => structuredClone(vector),
      readLeaseHead: async () => structuredClone(head),
      setTag: async (name, version) => {
        writes += 1;
        vector[name] = version;
        if (writes === 2) throw new Error('simulated lost command response');
      },
      removeTag: async (name) => { vector[name] = null; },
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
  const { lease } = fixture();
  const vector = Object.fromEntries(lease.packages.map((row) => [
    row.name,
    row.expectedPriorVersion,
  ]));
  const head = {
    operationId: lease.operationId,
    publicationEpoch: lease.publicationEpoch,
    leaseSha256: leaseSha256(lease),
  };
  let writes = 0;
  await assert.rejects(
    promoteDefaultVector({
      lease,
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
    }),
    (error) => {
      assert.equal(vector[lease.packages[0].name], '0.2.0');
      assert.ok(error.result.rollback.some((row) => row.ok === false));
      return true;
    },
  );
});

test('signature preimage excludes only signature', () => {
  const { lease } = fixture();
  assert.equal(unsignedLease(lease).signature, undefined);
});
