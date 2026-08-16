import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { PublicationLeaseAuthority } from './authority.mjs';
import {
  canonicalJcs,
  LEASE_ISSUED_AT_SKEW_ALLOWANCE_MS,
  LEGACY_PROMOTION_PACKAGE_NAMES,
  PROMOTION_PACKAGE_NAMES,
  publicationAuthoritySigningKeyId,
  publicationAuthorityTransition,
  sha256Hex,
  signPublicationLease,
  validatePublicationLease,
  validatePublicationLeaseIssueRequest,
  vectorFromLease,
} from './protocol.mjs';
import { createPublicationLeaseIssueRequest } from './request.mjs';
import {
  InMemoryPublicationAuthorityStore,
  SqliteVolumePublicationAuthorityStore,
} from './store.mjs';

const NOW = Date.parse('2026-07-28T20:00:00.000Z');
const AUTHORITY_INSTALLATION_ID = 'snapback-publication-primary';
const AUTHORITY_ORIGIN = 'https://publication-authority.example';

function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const context = {
    authorityInstallationId: AUTHORITY_INSTALLATION_ID,
    authorityOrigin: AUTHORITY_ORIGIN,
    publicKey,
  };
  const store = new InMemoryPublicationAuthorityStore(context);
  const authority = new PublicationLeaseAuthority({
    store,
    privateKey,
    authorityInstallationId: AUTHORITY_INSTALLATION_ID,
    authorityOrigin: AUTHORITY_ORIGIN,
    now: () => NOW,
  });
  const request = {
    schemaVersion: 'snapback.publication-lease-issue-request.v4',
    authorityInstallationId: AUTHORITY_INSTALLATION_ID,
    authorityOrigin: AUTHORITY_ORIGIN,
    signingKeyId: publicationAuthoritySigningKeyId(publicKey),
    operationId: 'release-0.1.1-authority-test',
    publisherInstanceId: 'publisher-authority-test',
    expectedPublicationEpoch: 0,
    expectedHeadSha256: null,
    candidateLedgerSha256: 'a'.repeat(64),
    candidateTag: 'bakeoff-0-1-1-deadbeefcafe',
    defaultTag: 'latest',
    priorDefaultClosureReceiptSha256: 'b'.repeat(64),
    lifetimeSeconds: 900,
    packages: PROMOTION_PACKAGE_NAMES.map((name) => ({
      name,
      expectedPriorVersion: name === '@expo/snapback'
        || name === '@expo/snapback-expo'
        || name === '@expo/snapback-expo-custody'
        || name === 'create-snapback-app'
        ? null
        : '0.1.0',
      newVersion: '0.1.1',
    })),
  };
  return { authority, context, privateKey, publicKey, request, store };
}

test('issue allocates and signs one exact short-lived promotion epoch', () => {
  const { authority, publicKey, request } = fixture();
  const lease = authority.issue(request);
  assert.equal(lease.publicationEpoch, 1);
  assert.equal(Date.parse(lease.expiresAt) - Date.parse(lease.issuedAt), 15 * 60_000);
  validatePublicationLease({
    lease,
    publicKey,
    authorityInstallationId: AUTHORITY_INSTALLATION_ID,
    authorityOrigin: AUTHORITY_ORIGIN,
    candidateLedgerSha256: request.candidateLedgerSha256,
    candidateTag: request.candidateTag,
    publisherInstanceId: request.publisherInstanceId,
    priorDefaultClosureReceiptSha256:
      request.priorDefaultClosureReceiptSha256,
    now: NOW,
  });
  assert.throws(
    () => validatePublicationLease({
      lease,
      publicKey,
      authorityInstallationId: AUTHORITY_INSTALLATION_ID,
      authorityOrigin: AUTHORITY_ORIGIN,
      candidateLedgerSha256: request.candidateLedgerSha256,
      candidateTag: request.candidateTag,
      publisherInstanceId: request.publisherInstanceId,
      priorDefaultClosureReceiptSha256: 'c'.repeat(64),
      now: NOW,
    }),
    /prior closure mismatch/u,
  );
  assert.equal(authority.head().status, 'issued');
  assert.equal(authority.head().publicationEpoch, 1);
});

test('freshly issued lease validates under bounded authority-ahead clock skew', () => {
  // The first live promotion (2026-08-08) refused its own just-issued lease:
  // the authority's clock ran ~100ms ahead of the publisher's, so the
  // publisher's fresh Date.now() at response receipt was still before the
  // server-stamped issuedAt. The validator clock lagging issuedAt by less
  // than the allowance must validate; anything beyond it must refuse, and a
  // genuinely expired lease must refuse regardless of the allowance.
  const { authority, publicKey, request } = fixture();
  const lease = authority.issue(request);
  const binding = {
    lease,
    publicKey,
    authorityInstallationId: AUTHORITY_INSTALLATION_ID,
    authorityOrigin: AUTHORITY_ORIGIN,
    candidateLedgerSha256: request.candidateLedgerSha256,
    candidateTag: request.candidateTag,
    publisherInstanceId: request.publisherInstanceId,
    priorDefaultClosureReceiptSha256: request.priorDefaultClosureReceiptSha256,
  };
  const issuedAt = Date.parse(lease.issuedAt);
  // Publisher clock 100ms behind the authority's issuedAt stamp — the exact
  // live ordering that refused before the allowance existed.
  validatePublicationLease({ ...binding, now: issuedAt - 100 });
  validatePublicationLease({
    ...binding,
    now: issuedAt - LEASE_ISSUED_AT_SKEW_ALLOWANCE_MS,
  });
  assert.throws(
    () => validatePublicationLease({
      ...binding,
      now: issuedAt - LEASE_ISSUED_AT_SKEW_ALLOWANCE_MS - 1,
    }),
    /publication lease is not current/u,
  );
  // Expiry stays strict: the allowance never revives an expired lease.
  assert.throws(
    () => validatePublicationLease({
      ...binding,
      now: Date.parse(lease.expiresAt),
    }),
    /publication lease is not current/u,
  );
});

test('authority dual-reads historical v2 state but single-writes v4 leases', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const signingKeyId = publicationAuthoritySigningKeyId(publicKey);
  // Historical v2 artifacts bind the recorded legacy @ccheever scope.
  const packages = LEGACY_PROMOTION_PACKAGE_NAMES.map((name) => ({
    name,
    expectedPriorVersion: '0.1.0',
    newVersion: '0.1.1',
  }));
  const issueRequest = {
    schemaVersion: 'snapback.publication-lease-issue-request.v2',
    authorityInstallationId: AUTHORITY_INSTALLATION_ID,
    authorityOrigin: AUTHORITY_ORIGIN,
    signingKeyId,
    operationId: 'release-historical-v2-test',
    publisherInstanceId: 'publisher-historical-v2',
    expectedPublicationEpoch: 0,
    expectedHeadSha256: null,
    candidateLedgerSha256: '1'.repeat(64),
    candidateTag: 'bakeoff-historical-v2',
    defaultTag: 'latest',
    lifetimeSeconds: 900,
    packages,
  };
  const lease = signPublicationLease({
    privateKey,
    unsigned: {
      schemaVersion: 'snapback.authorized-publication-lease.v2',
      authorityInstallationId: AUTHORITY_INSTALLATION_ID,
      authorityOrigin: AUTHORITY_ORIGIN,
      signingKeyId,
      operationId: issueRequest.operationId,
      publisherInstanceId: issueRequest.publisherInstanceId,
      publicationEpoch: 1,
      candidateLedgerSha256: issueRequest.candidateLedgerSha256,
      candidateTag: issueRequest.candidateTag,
      defaultTag: 'latest',
      issuedAt: new Date(NOW - 20 * 60_000).toISOString(),
      expiresAt: new Date(NOW - 5 * 60_000).toISOString(),
      packages,
    },
  });
  const context = {
    authorityInstallationId: AUTHORITY_INSTALLATION_ID,
    authorityOrigin: AUTHORITY_ORIGIN,
    publicKey,
  };
  const store = new InMemoryPublicationAuthorityStore(context, {
    schemaVersion: 'snapback.publication-authority-state.v2',
    authorityInstallationId: AUTHORITY_INSTALLATION_ID,
    authorityOrigin: AUTHORITY_ORIGIN,
    signingKeyId,
    generation: 1,
    publicationEpoch: 1,
    records: [{
      issueRequest,
      issueRequestSha256: sha256Hex(canonicalJcs(issueRequest)),
      lease,
      status: 'issued',
      acquisition: null,
      closure: null,
    }],
  });
  const authority = new PublicationLeaseAuthority({
    store,
    privateKey,
    authorityInstallationId: AUTHORITY_INSTALLATION_ID,
    authorityOrigin: AUTHORITY_ORIGIN,
    now: () => NOW,
  });
  const head = authority.head();
  const next = authority.issue({
    ...issueRequest,
    schemaVersion: 'snapback.publication-lease-issue-request.v4',
    operationId: 'release-after-v2-test',
    expectedPublicationEpoch: head.publicationEpoch,
    expectedHeadSha256: head.headSha256,
    priorDefaultClosureReceiptSha256: '2'.repeat(64),
    packages: PROMOTION_PACKAGE_NAMES.map((name) => ({
      name,
      expectedPriorVersion: '0.1.0',
      newVersion: '0.1.1',
    })),
  });
  assert.equal(next.schemaVersion, 'snapback.authorized-publication-lease.v4');
  assert.equal(next.publicationEpoch, 2);
  assert.throws(
    () => authority.issue({
      ...issueRequest,
      operationId: 'release-new-v2-refused',
      expectedPublicationEpoch: 2,
      expectedHeadSha256: authority.head().headSha256,
    }),
    /only issues v4/u,
  );
});

test('issue is exact-replay idempotent and stale or altered requests refuse', () => {
  const { authority, request } = fixture();
  const lease = authority.issue(request);
  assert.deepEqual(authority.issue(structuredClone(request)), lease);
  assert.throws(
    () => authority.issue({ ...request, lifetimeSeconds: 899 }),
    /already used with different issue bytes/u,
  );
  assert.throws(
    () => authority.issue({
      ...request,
      priorDefaultClosureReceiptSha256: 'c'.repeat(64),
    }),
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
  const { authority, publicKey, request } = fixture();
  const lease = authority.issue(request);
  const acquire = publicationAuthorityTransition({
    lease,
    outcome: 'acquired',
    vector: vectorFromLease(lease, 'prior'),
  });
  const acquired = authority.acquire(acquire);
  assert.equal(acquired.closed, false);
  assert.equal(acquired.signingKeyId, publicationAuthoritySigningKeyId(publicKey));
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
    () => authority.acquire(structuredClone(acquire)),
    /cannot be acquired from its current state/u,
    'a retained acquisition is never replayable after terminal closure',
  );
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
    authorityInstallationId: AUTHORITY_INSTALLATION_ID,
    authorityOrigin: AUTHORITY_ORIGIN,
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
    const { privateKey, publicKey, request } = fixture();
    const context = {
      authorityInstallationId: AUTHORITY_INSTALLATION_ID,
      authorityOrigin: AUTHORITY_ORIGIN,
      publicKey,
    };
    const firstStore = new SqliteVolumePublicationAuthorityStore(path, context);
    const first = new PublicationLeaseAuthority({
      store: firstStore,
      privateKey,
      authorityInstallationId: AUTHORITY_INSTALLATION_ID,
      authorityOrigin: AUTHORITY_ORIGIN,
      now: () => NOW,
    });
    const lease = first.issue(request);
    for (const securedPath of [path, `${path}-wal`, `${path}-shm`]) {
      if (existsSync(securedPath)) {
        assert.equal(statSync(securedPath).mode & 0o777, 0o600);
      }
    }
    firstStore.close();

    const reopenedStore = new SqliteVolumePublicationAuthorityStore(path, context);
    const reopened = new PublicationLeaseAuthority({
      store: reopenedStore,
      privateKey,
      authorityInstallationId: AUTHORITY_INSTALLATION_ID,
      authorityOrigin: AUTHORITY_ORIGIN,
      now: () => NOW,
    });
    assert.deepEqual(reopened.issue(request), lease);
    assert.equal(reopened.head().authorityGeneration, 1);
    validatePublicationLease({
      lease,
      publicKey,
      authorityInstallationId: AUTHORITY_INSTALLATION_ID,
      authorityOrigin: AUTHORITY_ORIGIN,
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
    assert.throws(
      () => new SqliteVolumePublicationAuthorityStore(path, context),
      /durable state digest mismatch/u,
    );
    assert.equal(statSync(root).mode & 0o777, 0o700);
    assert.equal(statSync(path).mode & 0o777, 0o600);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('durable reopen rejects semantically inconsistent state even with a recomputed digest', () => {
  const root = mkdtempSync(join(tmpdir(), 'snapback-publication-authority-semantic-'));
  try {
    const path = join(root, 'authority.sqlite3');
    const { context, privateKey, request } = fixture();
    const store = new SqliteVolumePublicationAuthorityStore(path, context);
    const authority = new PublicationLeaseAuthority({
      store,
      privateKey,
      authorityInstallationId: AUTHORITY_INSTALLATION_ID,
      authorityOrigin: AUTHORITY_ORIGIN,
      now: () => NOW,
    });
    authority.issue(request);
    store.close();

    const corruptor = new DatabaseSync(path);
    const retained = JSON.parse(corruptor.prepare(`
      SELECT state_json FROM publication_authority_state WHERE singleton = 1
    `).get().state_json);
    retained.records[0].status = 'closed';
    const stateJson = canonicalJcs(retained);
    corruptor.prepare(`
      UPDATE publication_authority_state
      SET state_json = ?, state_sha256 = ?
      WHERE singleton = 1
    `).run(stateJson, sha256Hex(stateJson));
    corruptor.close();
    assert.throws(
      () => new SqliteVolumePublicationAuthorityStore(path, context),
      /status is inconsistent/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('key type and exact signature encoding fail closed at startup and validation', () => {
  const { authority, publicKey, request, store } = fixture();
  const { privateKey: rsaPrivateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  assert.throws(
    () => new PublicationLeaseAuthority({
      store,
      privateKey: rsaPrivateKey,
      authorityInstallationId: AUTHORITY_INSTALLATION_ID,
      authorityOrigin: AUTHORITY_ORIGIN,
    }),
    /must be Ed25519/u,
  );
  const lease = authority.issue(request);
  assert.throws(
    () => validatePublicationLease({
      lease: { ...lease, signature: `${lease.signature}=` },
      publicKey,
      authorityInstallationId: AUTHORITY_INSTALLATION_ID,
      authorityOrigin: AUTHORITY_ORIGIN,
      candidateLedgerSha256: request.candidateLedgerSha256,
      candidateTag: request.candidateTag,
      publisherInstanceId: request.publisherInstanceId,
      now: NOW,
    }),
    /exact unpadded Ed25519/u,
  );
});

test('request builder closes candidate-ledger and observed-prior-vector inventory', () => {
  const { authority, publicKey, request } = fixture();
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
    priorDefaultClosureReceiptSha256:
      request.priorDefaultClosureReceiptSha256,
    head,
    publicKey,
    authorityOrigin: AUTHORITY_ORIGIN,
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
      priorDefaultClosureReceiptSha256:
        request.priorDefaultClosureReceiptSha256,
      head,
      operationId: request.operationId,
      publisherInstanceId: request.publisherInstanceId,
    }),
    /exact promotion package inventory/u,
  );
});

test('historical twelve-name issue exact replay survives closure widening', () => {
  const { privateKey, publicKey, request } = fixture();
  const historicalRequest = {
    ...request,
    operationId: 'release-historical-twelve-name-replay',
    packages: request.packages.slice(0, 12),
  };
  const lease = signPublicationLease({
    privateKey,
    unsigned: {
      schemaVersion: 'snapback.authorized-publication-lease.v4',
      authorityInstallationId: AUTHORITY_INSTALLATION_ID,
      authorityOrigin: AUTHORITY_ORIGIN,
      signingKeyId: publicationAuthoritySigningKeyId(publicKey),
      operationId: historicalRequest.operationId,
      publisherInstanceId: historicalRequest.publisherInstanceId,
      publicationEpoch: 1,
      candidateLedgerSha256: historicalRequest.candidateLedgerSha256,
      candidateTag: historicalRequest.candidateTag,
      defaultTag: historicalRequest.defaultTag,
      priorDefaultClosureReceiptSha256:
        historicalRequest.priorDefaultClosureReceiptSha256,
      issuedAt: new Date(NOW).toISOString(),
      expiresAt: new Date(NOW + historicalRequest.lifetimeSeconds * 1_000).toISOString(),
      packages: structuredClone(historicalRequest.packages),
    },
  });
  const context = {
    authorityInstallationId: AUTHORITY_INSTALLATION_ID,
    authorityOrigin: AUTHORITY_ORIGIN,
    publicKey,
  };
  const store = new InMemoryPublicationAuthorityStore(context, {
    schemaVersion: 'snapback.publication-authority-state.v2',
    authorityInstallationId: AUTHORITY_INSTALLATION_ID,
    authorityOrigin: AUTHORITY_ORIGIN,
    signingKeyId: publicationAuthoritySigningKeyId(publicKey),
    generation: 1,
    publicationEpoch: 1,
    records: [{
      issueRequest: historicalRequest,
      issueRequestSha256: sha256Hex(canonicalJcs(historicalRequest)),
      lease,
      status: 'issued',
      acquisition: null,
      closure: null,
    }],
  });
  const authority = new PublicationLeaseAuthority({
    store,
    privateKey,
    authorityInstallationId: AUTHORITY_INSTALLATION_ID,
    authorityOrigin: AUTHORITY_ORIGIN,
    now: () => NOW,
  });

  assert.deepEqual(authority.issue(structuredClone(historicalRequest)), lease);
  const head = authority.head();
  assert.throws(
    () => authority.issue({
      ...historicalRequest,
      operationId: 'release-new-twelve-name-refused',
      expectedPublicationEpoch: head.publicationEpoch,
      expectedHeadSha256: head.headSha256,
    }),
    /full-closure/u,
  );
});

test('historical eleven- and twelve-name v4 records validate; new issues bind the full closure', () => {
  const { authority, request } = fixture();
  // Epochs recorded before the @expo/snapback umbrella joined bind the
  // eleven-name prefix of the current vector. Boot-time state validation
  // replays them through validatePublicationLeaseIssueRequest and must keep
  // accepting the recorded width (the 0.1.21 ceremony crash-loop regression).
  const historical = {
    ...request,
    packages: request.packages.slice(0, 11),
  };
  validatePublicationLeaseIssueRequest(historical, {
    authorityInstallationId: AUTHORITY_INSTALLATION_ID,
    authorityOrigin: AUTHORITY_ORIGIN,
  });
  const historicalWithUmbrella = {
    ...request,
    packages: request.packages.slice(0, 12),
  };
  validatePublicationLeaseIssueRequest(historicalWithUmbrella, {
    authorityInstallationId: AUTHORITY_INSTALLATION_ID,
    authorityOrigin: AUTHORITY_ORIGIN,
  });
  // A ten-name vector was never a recorded width; it must still refuse.
  assert.throws(
    () => validatePublicationLeaseIssueRequest(
      { ...request, packages: request.packages.slice(0, 10) },
      {
        authorityInstallationId: AUTHORITY_INSTALLATION_ID,
        authorityOrigin: AUTHORITY_ORIGIN,
      },
    ),
    /must bind exactly/u,
  );
  // The standing authority never issues a prefix-width lease.
  assert.throws(
    () => authority.issue(historical),
    /full-closure/u,
  );
  assert.throws(
    () => authority.issue(historicalWithUmbrella),
    /full-closure/u,
  );
});
