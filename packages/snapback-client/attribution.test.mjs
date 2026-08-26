// LLP 0062's finite client attribution seam (LLP 0055 §Audit): non-2xx
// responses through the lifted client core retain the server's `attribution`
// sibling verbatim — byte-preserving pass-through, never reshaped, never
// redacted, never synthesized — and success envelopes (mutation, live
// establishment) carry it through untouched. Parity is asserted per principal
// class against the exact bytes the server served.

import assert from 'node:assert/strict';
import http from 'node:http';

import { AgentAuthorityFence, SnapbackClient, deriveServiceAuthorityInstanceId } from './index.mjs';

const ACTOR_ID = '018f0d90-7b31-7a22-8c33-445566778899';
const EFFECTIVE_ID = '018f0d90-7b30-7a22-8c33-445566778899';
const GRANT_ID = '018f0d90-7b32-7a22-8c33-445566778899';
const CREDENTIAL_ID = '018f0d90-7b33-7a22-8c33-445566778899';
const AGENT_BEARER = 'sbagt_attribution_seam_token';
const SESSION_BEARER = 'sbs_attribution_seam_session';

// The server-derived block, exactly as the wire serializes it. Key order is
// load-bearing for the byte-level assertions below.
const ATTRIBUTION = {
  actorUserId: ACTOR_ID,
  effectiveUserId: EFFECTIVE_ID,
  grantId: GRANT_ID,
  dryRun: false,
};

const handshakeFor = (authority, descriptor) => ({
  protocolVersion: 1,
  serverStartupNonce: 'attribution-seam',
  authorizationStreamIncarnation: '018f0d90-7b34-7a22-8c33-445566778899',
  transitionGeneration: 1,
  activeMode: 'sessions',
  desiredMode: 'sessions',
  modeState: 'settled',
  appDataAvailability: 'available',
  quarantineCode: null,
  clientProtocols: {
    authClient: 1,
    authInvalidation: 1,
    authorityDescriptor: 1,
    authorizedLease: null,
  },
  availability: {
    onlineRequestResponse: { available: true, reason: null },
    authScopedLive: { available: true, minimumAuthInvalidationProtocol: 1, reason: null },
    retainedReads: {
      available: false,
      minimumAuthInvalidationProtocol: 1,
      minimumAuthorizedLeaseProtocol: 1,
      reason: 'SNAPBACK_AUTH_POLICY_UNAVAILABLE',
    },
    queuedReplay: {
      available: false,
      minimumAuthorityDescriptorProtocol: 1,
      reason: 'SNAPBACK_AUTH_POLICY_UNAVAILABLE',
    },
  },
  provider: { key: 'email-code', available: true },
  transports: ['bearer'],
  authority,
  authorityDescriptor: descriptor,
  deploymentIdentity: {
    schemaVersion: 'snapback.v1',
    authMode: 'sessions',
    appId: 'attribution-seam',
    schemaHash: `snapback.v1:sessions:schema:sha256:${'a'.repeat(64)}`,
    bundleHash: `snapback.v1:sessions:function:sha256:${'b'.repeat(64)}`,
    inputsHash: `snapback.v1:sessions:inputs:sha256:${'c'.repeat(64)}`,
  },
  authorizedLease: null,
});

const agentHandshake = handshakeFor(
  { kind: 'servicePrincipal', userId: EFFECTIVE_ID, sessionId: null, isAuthenticated: true },
  {
    descriptorVersion: 1,
    authorityInstanceId: deriveServiceAuthorityInstanceId({
      actorUserId: ACTOR_ID,
      credentialId: CREDENTIAL_ID,
      credentialGeneration: 1,
      grantId: GRANT_ID,
    }),
    sessionGeneration: 0,
  },
);
const sessionHandshake = handshakeFor(
  {
    kind: 'humanSession',
    userId: EFFECTIVE_ID,
    sessionId: '018f0d90-7b37-7a22-8c33-445566778899',
    isAuthenticated: true,
  },
  {
    descriptorVersion: 1,
    authorityInstanceId: '018f0d90-7b35-7a22-8c33-445566778899',
    sessionGeneration: 1,
  },
);

// One mock server: attribution rides errors and success envelopes exactly
// when the presented carrier is the scoped agent token (the only class that
// resolves a service principal). `served` records the exact serialized body
// answered for each request — the HTTP lane of the parity assertions.
const served = [];
const listen = () => new Promise((resolve) => {
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const isAgent = request.headers.authorization === `Bearer ${AGENT_BEARER}`;
      const answer = (status, value) => {
        const body = JSON.stringify(value);
        served.push({ path: request.url, status, body, authorization: request.headers.authorization ?? null });
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(body);
      };
      if (request.url === '/auth/session') {
        return answer(200, isAgent ? agentHandshake : sessionHandshake);
      }
      if (request.url === '/query/boom') {
        return answer(403, {
          diagnostic: {
            code: 'SNAPBACK_AUTH_GRANT_SCOPE_DENIED',
            severity: 'error',
            subsystem: 'auth',
            message: 'scope denied',
            details: {},
          },
          ...(isAgent ? { attribution: ATTRIBUTION } : {}),
        });
      }
      if (request.url === '/mutation/rejected') {
        return answer(409, {
          diagnostic: {
            code: 'SNAPBACK_REJECTED',
            severity: 'error',
            subsystem: 'runtime',
            message: `handler rejected bearer ${request.headers.authorization ?? '(none)'}`,
            details: {},
          },
          receipt: { kind: 'mutation', mutationId: 'cm_1', outcome: 'rejected' },
          ...(isAgent ? { attribution: ATTRIBUTION } : {}),
        });
      }
      if (request.url === '/mutation/confirmed') {
        return answer(200, {
          version: 4,
          changed_count: 1,
          result: { ok: true },
          receipt: { kind: 'mutation', mutationId: 'cm_2', outcome: 'confirmed' },
          ...(isAgent ? { attribution: ATTRIBUTION } : {}),
        });
      }
      if (request.url === '/connection/open') {
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
        return answer(200, {
          connectionId: 'conn_attr',
          connectionToken: 'sct_attr',
          ...(body.wireVersion ? { wireVersion: body.wireVersion } : {}),
        });
      }
      if (request.url === '/live/feed/subscribe') {
        return answer(200, {
          subscription_id: 'sub_attr',
          snapshot: { version: 1, rows: [] },
          permission_epochs: {},
          ...(isAgent ? { attribution: ATTRIBUTION } : {}),
        });
      }
      return answer(404, { diagnostic: { code: 'SNAPBACK_ROUTE_UNKNOWN', severity: 'error', subsystem: 'server', message: request.url, details: {} } });
    });
  });
  server.listen(0, '127.0.0.1', () => resolve({
    server,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((done) => server.close(done)),
  }));
});

const lastServed = (path) => {
  const record = [...served].reverse().find((entry) => entry.path === path);
  assert.ok(record, `mock served ${path}`);
  return record;
};

const caught = async (work) => {
  try {
    await work();
  } catch (error) {
    return error;
  }
  return assert.fail('expected the call to reject');
};

const { url, close } = await listen();
try {
  const agentClient = new SnapbackClient(url, {
    agentAuthority: new AgentAuthorityFence({
      actorUserId: ACTOR_ID,
      credentialId: CREDENTIAL_ID,
      credentialGeneration: 1,
      grantId: GRANT_ID,
      tokenId: '018f0d90-7b36-7a22-8c33-445566778899',
      bearerToken: AGENT_BEARER,
    }),
    authInvalidationProtocol: 1,
  });

  // --- byte-level pass-through (the LLP 0055 §Audit copy contract) --------
  {
    const error = await caught(() => agentClient.query('boom', { args: {} }));
    const rawBody = JSON.parse(lastServed('/query/boom').body);
    assert.equal(
      JSON.stringify(error.attribution),
      JSON.stringify(rawBody.attribution),
      'the client-surfaced block must be byte-identical to the served block',
    );
    assert.equal(JSON.stringify(error.attribution), JSON.stringify(ATTRIBUTION));
    assert.equal(error.diagnostic.code, 'SNAPBACK_AUTH_GRANT_SCOPE_DENIED');
  }

  // --- retention alongside a receipt, with redaction firing nearby --------
  // The rejected-mutation diagnostic reflects the bearer and is redacted;
  // the attribution sibling must still pass through byte-identically —
  // retention is verbatim copy, not "sanitize then keep".
  {
    const error = await caught(() => agentClient.mutate('rejected', { args: {}, queue: false }));
    assert.equal(error.receipt.kind, 'mutation');
    assert.equal(
      error.diagnostic.message.includes(AGENT_BEARER),
      false,
      'the reflected bearer is redacted from the diagnostic',
    );
    assert.equal(
      JSON.stringify(error.attribution),
      JSON.stringify(JSON.parse(lastServed('/mutation/rejected').body).attribution),
    );
  }

  // --- success envelopes: mutation result and live establishment ---------
  {
    const confirmed = await agentClient.mutate('confirmed', { args: {}, queue: false });
    assert.equal(
      JSON.stringify(confirmed.attribution),
      JSON.stringify(JSON.parse(lastServed('/mutation/confirmed').body).attribution),
      'the mutation result path must not drop the attribution member',
    );
    const subscribed = await agentClient.subscribeLive('feed', {
      args: {},
      connectionId: 'attribution-connection',
    });
    assert.equal(
      JSON.stringify(subscribed.attribution),
      JSON.stringify(JSON.parse(lastServed('/live/feed/subscribe').body).attribution),
      'live establishment metadata must reach the caller verbatim',
    );
  }

  // --- HTTP vs client parity, per principal class -------------------------
  // Only a resolved service principal has attribution authority; every other
  // class must surface exactly what HTTP shows: no member at all. The client
  // must never fabricate (or null-fill) the block for them.
  const anonymousClient = new SnapbackClient(url);
  const classes = [
    ['anonymous', anonymousClient, {}],
    ['devAsserted', anonymousClient, { userId: 'dev-user' }],
    [
      'sessionBearer',
      new SnapbackClient(url, {
        bearerToken: SESSION_BEARER,
        authClientProtocol: 1,
        authInvalidationProtocol: 1,
      }),
      {},
    ],
    ['servicePrincipal', agentClient, {}],
  ];
  for (const [label, client, options] of classes) {
    const error = await caught(() => client.query('boom', { args: {}, ...options }));
    const raw = JSON.parse(lastServed('/query/boom').body);
    // The class must actually reach the route: a handshake refusal would
    // vacuously satisfy the absence assertions below.
    assert.equal(
      error.diagnostic.code,
      raw.diagnostic.code,
      `${label}: the surfaced diagnostic is the served diagnostic`,
    );
    if (label === 'servicePrincipal') {
      assert.equal(
        JSON.stringify(error.attribution),
        JSON.stringify(raw.attribution),
        `${label}: client and HTTP lanes must agree byte-for-byte`,
      );
    } else {
      assert.equal('attribution' in raw, false, `${label}: HTTP carries no block`);
      assert.equal(
        'attribution' in error,
        false,
        `${label}: the client must not synthesize an attribution member`,
      );
    }
  }

  console.log('attribution.test.mjs: non-2xx retention, byte-level pass-through, and per-class parity pass');
} finally {
  await close();
}
