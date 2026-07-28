import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import test from 'node:test';

import { PublicationLeaseAuthority } from './authority.mjs';
import {
  canonicalJcs,
  PROMOTION_PACKAGE_NAMES,
  publicationAuthoritySigningKeyId,
  publicationAuthorityTransition,
  vectorFromLease,
} from './protocol.mjs';
import { createPublicationAuthorityServer } from './server.mjs';
import { InMemoryPublicationAuthorityStore } from './store.mjs';

const TOKEN = 'publication-authority-test-bearer-token';
const AUTHORITY_INSTALLATION_ID = 'snapback-publication-http';
const AUTHORITY_ORIGIN = 'https://publication-authority.example';
let testSigningKeyId;

function issueRequest() {
  return {
    schemaVersion: 'snapback.publication-lease-issue-request.v2',
    authorityInstallationId: AUTHORITY_INSTALLATION_ID,
    authorityOrigin: AUTHORITY_ORIGIN,
    signingKeyId: testSigningKeyId,
    operationId: 'release-http-authority-test',
    publisherInstanceId: 'publisher-http-test',
    expectedPublicationEpoch: 0,
    expectedHeadSha256: null,
    candidateLedgerSha256: 'a'.repeat(64),
    candidateTag: 'bakeoff-0-1-1-deadbeefcafe',
    defaultTag: 'latest',
    lifetimeSeconds: 600,
    packages: PROMOTION_PACKAGE_NAMES.map((name) => ({
      name,
      expectedPriorVersion: '0.1.0',
      newVersion: '0.1.1',
    })),
  };
}

async function withServer(run) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  testSigningKeyId = publicationAuthoritySigningKeyId(publicKey);
  const authority = new PublicationLeaseAuthority({
    store: new InMemoryPublicationAuthorityStore({
      authorityInstallationId: AUTHORITY_INSTALLATION_ID,
      authorityOrigin: AUTHORITY_ORIGIN,
      publicKey,
    }),
    privateKey,
    authorityInstallationId: AUTHORITY_INSTALLATION_ID,
    authorityOrigin: AUTHORITY_ORIGIN,
    now: () => Date.parse('2026-07-28T20:00:00.000Z'),
  });
  const server = createPublicationAuthorityServer({ authority, bearerToken: TOKEN });
  assert.equal(server.requestTimeout, 15_000);
  assert.equal(server.headersTimeout, 10_000);
  assert.equal(server.keepAliveTimeout, 5_000);
  assert.equal(server.maxRequestsPerSocket, 100);
  assert.equal(server.maxHeadersCount, 64);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`, publicKey);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('health is unprivileged while head and mutation endpoints require Bearer auth', async () => {
  await withServer(async (base) => {
    const health = await fetch(`${base}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      ready: true,
      schemaVersion: 'snapback.publication-authority-health.v1',
    });
    const missing = await fetch(`${base}/v1/head`);
    assert.equal(missing.status, 401);
    assert.equal((await missing.json()).code, 'SNAPBACK_PUBLICATION_AUTH_REQUIRED');
    const wrong = await fetch(`${base}/v1/head`, {
      headers: { authorization: 'Bearer this-token-is-definitely-wrong' },
    });
    assert.equal(wrong.status, 401);
    const head = await fetch(`${base}/v1/head`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(head.status, 200);
    assert.equal((await head.json()).status, 'empty');
  });
});

test('issue accepts only canonical closed request bytes and exact replay', async () => {
  await withServer(async (base) => {
    const request = issueRequest();
    const invoke = (body) => fetch(`${base}/v1/leases/issue`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
      },
      body,
    });
    const nonCanonical = await invoke(JSON.stringify(request, null, 2));
    assert.equal(nonCanonical.status, 400);
    assert.equal(
      (await nonCanonical.json()).code,
      'SNAPBACK_PUBLICATION_CANONICAL_BODY_REQUIRED',
    );
    const unknown = await invoke(canonicalJcs({ ...request, extra: true }));
    assert.equal(unknown.status, 400);
    assert.equal((await unknown.json()).code, 'SNAPBACK_PUBLICATION_ISSUE_INVALID');

    const issued = await invoke(canonicalJcs(request));
    assert.equal(issued.status, 200);
    const lease = await issued.json();
    assert.equal(lease.publicationEpoch, 1);
    const replayed = await invoke(canonicalJcs(request));
    assert.equal(replayed.status, 200);
    assert.deepEqual(await replayed.json(), lease);
  });
});

test('HTTP acquire, head, and close preserve exact authority state', async () => {
  await withServer(async (base) => {
    const headers = {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
    };
    const post = async (path, value) => {
      const response = await fetch(`${base}${path}`, {
        method: 'POST',
        headers,
        body: canonicalJcs(value),
      });
      assert.equal(response.status, 200);
      return response.json();
    };
    const lease = await post('/v1/leases/issue', issueRequest());
    const acquire = publicationAuthorityTransition({
      lease,
      outcome: 'acquired',
      vector: vectorFromLease(lease, 'prior'),
    });
    const acquired = await post('/v1/leases/acquire', acquire);
    assert.equal(acquired.closed, false);
    const acquiredHead = await fetch(`${base}/v1/head`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    }).then((response) => response.json());
    assert.equal(acquiredHead.status, 'acquired');

    const close = publicationAuthorityTransition({
      lease,
      outcome: 'promoted',
      vector: vectorFromLease(lease, 'new'),
      publicationLedgerSha256: 'b'.repeat(64),
    });
    const closed = await post('/v1/leases/close', close);
    assert.equal(closed.closed, true);
    const closedHead = await fetch(`${base}/v1/head`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    }).then((response) => response.json());
    assert.equal(closedHead.status, 'closed');
    assert.equal(closedHead.outcome, 'promoted');
  });
});

test('duplicate Authorization headers and route/query smuggling refuse', async () => {
  await withServer(async (base) => {
    const query = await fetch(`${base}/v1/head?head=other`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(query.status, 404);
    const duplicate = await new Promise((resolve, reject) => {
      const url = new URL(`${base}/v1/head`);
      const request = httpRequest({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        headers: [
          'Authorization', `Bearer ${TOKEN}`,
          'Authorization', `Bearer ${TOKEN}`,
        ],
      }, resolve);
      request.on('error', reject);
      request.end();
    });
    assert.ok(
      duplicate.statusCode === 400 || duplicate.statusCode === 401,
      `duplicate authorization was not refused: HTTP ${duplicate.statusCode}`,
    );
    duplicate.resume();
  });
});

test('GET bodies are rejected and drained instead of reaching health or head', async () => {
  await withServer(async (base) => {
    const response = await new Promise((resolve, reject) => {
      const url = new URL(`${base}/v1/head`);
      const request = httpRequest({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'GET',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-length': '2',
          'content-type': 'application/json',
        },
      }, resolve);
      request.on('error', reject);
      request.end('{}');
    });
    assert.equal(response.statusCode, 400);
    let body = '';
    response.setEncoding('utf8');
    for await (const chunk of response) body += chunk;
    assert.equal(JSON.parse(body).code, 'SNAPBACK_PUBLICATION_GET_BODY_REFUSED');
  });
});
