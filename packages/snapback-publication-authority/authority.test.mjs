import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { PublicationLeaseAuthority } from './authority.mjs';
import {
  PROMOTION_PACKAGE_NAMES,
  publicationAuthorityTransition,
  validatePublicationLease,
  vectorFromLease,
} from './protocol.mjs';
import { createPublicationLeaseIssueRequest } from './request.mjs';
import {
  InMemoryPublicationAuthorityStore,
  SqliteVolumePublicationAuthorityStore,
} from './store.mjs';

const NOW = Date.parse('2026-07-28T20:00:00.000Z');

function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const store = new InMemoryPublicationAuthorityStore();
  const authority = new PublicationLeaseAuthority({
    store,
    privateKey,
    now: () => NOW,
  });
  const request = {
    schemaVersion: 'snapback.publication-lease-issue-request.v1',
    operationId: 'release-0.1.1-authority-test',
    publisherInstanceId: 'publisher-authority-test',
    expectedPublicationEpoch: 0,
    expectedHeadSha256: null,
    candidateLedgerSha256: 'a'.repeat(64),
    candidateTag: 'bakeoff-0-1-1-deadbeefcafe',
    defaultTag: 'latest',
    lifetimeSeconds: 900,
    packages: PROMOTION_PACKAGE_NAMES.map((name, index) => ({
      name,
      expectedPriorVersion: index === 6 ? null : '0.1.0',
      newVersion: '0.1.1',
    })),
  };
  return { authority, privateKey, publicKey, request, store };
}

test('issue allocates and signs one exact short-lived nine-package epoch', () => {
  const { authority, publicKey, request } = fixture();
  const lease = authority.issue(request);
  assert.equal(lease.publicationEpoch, 1);
  assert.equal(Date.parse(lease.expiresAt) - Date.parse(lease.issuedAt), 15 * 60_000);
  validatePublicationLease({
    lease,
    publicKey,
    candidateLedgerSha256: request.candidateLedgerSha256,
    candidateTag: request.candidateTag,
    publisherInstanceId: request.publisherInstanceId,
    now: NOW,
  });
  assert.equal(authority.head().status, 'issued');
  assert.equal(authority.head().publicationEpoch, 1);
});

test('issue is exact-replay idempotent and stale or altered requests refuse', () => {
  const { authority, request } = fixture();
  const lease = authority.issue(request);
  assert.deepEqual(authority.issue(structuredClone(request)), lease);
  assert.throws(
    () => authority.issue({ ...request, lifetimeSeconds: 899 }),
    /already used with different issue bytes/u,
  );
  const head = authority.head();
  assert.throws(
    () => authority.issue({
      ...request,
      operationId: 'release-0.1.2-stale-test',
      expectedPublicationEpoch: 0,
      expectedHeadSha256: null,
    }),
    /expected publication epoch or head/u,
  );
  assert.equal(head.authorityGeneration, 1, 'exact replay does not advance durable state');
});

test('acquire and promoted close are vector-bound, replay-safe transitions', () => {
  const { authority, request } = fixture();
  const lease = authority.issue(request);
  const acquire = publicationAuthorityTransition({
    lease,
    outcome: 'acquired',
    vector: vectorFromLease(lease, 'prior'),
  });
  const acquired = authority.acquire(acquire);
  assert.equal(acquired.closed, false);
  assert.deepEqual(authority.acquire(structuredClone(acquire)), acquired);
  assert.equal(authority.head().status, 'acquired');

  const alteredAcquire = { ...acquire, vectorSha256: 'b'.repeat(64) };
  assert.throws(
    () => authority.acquire(alteredAcquire),
    /already committed with different bytes/u,
  );
  const close = publicationAuthorityTransition({
    lease,
    outcome: 'promoted',
    vector: vectorFromLease(lease, 'new'),
    publicationLedgerSha256: 'c'.repeat(64),
  });
  const closed = authority.close(close);
  assert.equal(closed.closed, true);
  assert.equal(authority.head().status, 'closed');
  assert.equal(authority.head().outcome, 'promoted');
  assert.deepEqual(authority.close(structuredClone(close)), closed);
  assert.throws(
    () => authority.close({ ...close, publicationLedgerSha256: 'd'.repeat(64) }),
    /already committed with different bytes/u,
  );
});

test('tampered vector, stale epoch, and expiry cannot advance authority', () => {
  const { authority, request } = fixture();
  const lease = authority.issue(request);
  const tampered = publicationAuthorityTransition({
    lease,
    outcome: 'acquired',
    vector: vectorFromLease(lease, 'new'),
  });
  assert.throws(
    () => authority.acquire(tampered),
    /does not bind the authorized prior vector/u,
  );

  const expiredAuthority = new PublicationLeaseAuthority({
    store: authority.store,
    privateKey: authority.privateKey,
    now: () => NOW + 15 * 60_000,
  });
  const acquire = publicationAuthorityTransition({
    lease,
    outcome: 'acquired',
    vector: vectorFromLease(lease, 'prior'),
  });
  assert.throws(() => expiredAuthority.acquire(acquire), /not current/u);
  assert.equal(authority.head().status, 'issued');
});

test('rolled-back close binds the exact prior vector and allocates the next epoch', () => {
  const { authority, request } = fixture();
  const lease = authority.issue(request);
  authority.acquire(publicationAuthorityTransition({
    lease,
    outcome: 'acquired',
    vector: vectorFromLease(lease, 'prior'),
  }));
  authority.close(publicationAuthorityTransition({
    lease,
    outcome: 'rolled-back',
    vector: vectorFromLease(lease, 'prior'),
  }));
  const head = authority.head();
  const next = authority.issue({
    ...request,
    operationId: 'release-0.1.2-authority-test',
    expectedPublicationEpoch: head.publicationEpoch,
    expectedHeadSha256: head.headSha256,
    candidateLedgerSha256: 'e'.repeat(64),
    candidateTag: 'bakeoff-0-1-2-deadbeefcafe',
    packages: request.packages.map((row) => ({ ...row, newVersion: '0.1.2' })),
  });
  assert.equal(next.publicationEpoch, 2);
});

test('SQLite volume state survives restart with monotone replay identity', () => {
  const root = mkdtempSync(join(tmpdir(), 'snapback-publication-authority-'));
  try {
    const path = join(root, 'authority.sqlite3');
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const request = fixture().request;
    const firstStore = new SqliteVolumePublicationAuthorityStore(path);
    const first = new PublicationLeaseAuthority({
      store: firstStore,
      privateKey,
      now: () => NOW,
    });
    const lease = first.issue(request);
    firstStore.close();

    const reopenedStore = new SqliteVolumePublicationAuthorityStore(path);
    const reopened = new PublicationLeaseAuthority({
      store: reopenedStore,
      privateKey,
      now: () => NOW,
    });
    assert.deepEqual(reopened.issue(request), lease);
    assert.equal(reopened.head().authorityGeneration, 1);
    validatePublicationLease({
      lease,
      publicKey,
      candidateLedgerSha256: request.candidateLedgerSha256,
      candidateTag: request.candidateTag,
      publisherInstanceId: request.publisherInstanceId,
      now: NOW,
    });
    reopenedStore.close();

    const corruptor = new DatabaseSync(path);
    corruptor.prepare(`
      UPDATE publication_authority_state
      SET state_sha256 = ?
      WHERE singleton = 1
    `).run('0'.repeat(64));
    corruptor.close();
    const refusedStore = new SqliteVolumePublicationAuthorityStore(path);
    assert.throws(
      () => refusedStore.read(),
      /durable state digest mismatch/u,
    );
    refusedStore.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('request builder closes candidate-ledger and observed-prior-vector inventory', () => {
  const { authority, request } = fixture();
  const head = authority.head();
  const ledger = {
    candidateLedgerSha256: request.candidateLedgerSha256,
    tag: request.candidateTag,
    packages: [...request.packages].reverse().map((row) => ({
      name: row.name,
      version: row.newVersion,
    })),
  };
  const priorVector = Object.fromEntries(request.packages.map((row) => [
    row.name,
    row.expectedPriorVersion,
  ]));
  const built = createPublicationLeaseIssueRequest({
    ledger,
    priorVector,
    head,
    operationId: request.operationId,
    publisherInstanceId: request.publisherInstanceId,
    lifetimeSeconds: 600,
  });
  assert.deepEqual(
    built.packages.map((row) => row.name),
    PROMOTION_PACKAGE_NAMES,
  );
  assert.throws(
    () => createPublicationLeaseIssueRequest({
      ledger,
      priorVector: { ...priorVector, extra: '0.1.0' },
      head,
      operationId: request.operationId,
      publisherInstanceId: request.publisherInstanceId,
    }),
    /exact nine-package inventory/u,
  );
});
