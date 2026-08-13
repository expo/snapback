import assert from 'node:assert/strict';

import { createExternalSessionClient, isSnapbackDiagnosticError } from './index.mjs';

// Regression: 0137 A1-Expo f4 (carrier-agnostic) — replaceBearerToken to a
// lesser-privileged successor must SETTLE (the denial becomes a handle
// lifecycle fact, not an AggregateError the app string-matches), and rotating
// back must fresh-subscribe every handle the transition parked. Pre-fix:
// the downgrade rejected with 'external bearer custody transition completed
// with lifecycle failures', the denial never reached the handle, and the
// denied handle was excluded from every later transition's resume set
// (wedged 'disconnected' until process restart).
//
// The must-not-regress half (arm finding mustNotRegress): predecessor rows
// blank BEFORE the successor's subscribe reaches the server, and genuine
// lifecycle breakage (not a server-answered denial) still rejects loudly.

const INCARNATION = '018f0d90-7b11-7a22-8c33-445566778899';
const ALICE = 'sbs_alice_owner';
const MALLORY = 'sbs_mallory_outsider';
const USER_IDS = {
  [ALICE]: '018f0d90-7b12-7a22-8c33-445566778899',
  [MALLORY]: '018f0d90-7b15-7a22-8c33-445566778899',
};

const handshakeFor = (bearer) => ({
  protocolVersion: 1,
  serverStartupNonce: 'startup-bearer-rotation',
  authorizationStreamIncarnation: INCARNATION,
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
    authScopedLive: {
      available: true,
      minimumAuthInvalidationProtocol: 1,
      reason: null,
    },
    retainedReads: {
      available: false,
      minimumAuthInvalidationProtocol: 1,
      minimumAuthorizedLeaseProtocol: 1,
      reason: 'SNAPBACK_AUTH_RETAINED_READS_UNAVAILABLE',
    },
    queuedReplay: {
      available: true,
      minimumAuthorityDescriptorProtocol: 1,
      reason: null,
    },
  },
  provider: { key: 'email-code', available: true },
  transports: ['bearer'],
  authority: {
    kind: 'humanSession',
    userId: USER_IDS[bearer],
    sessionId: '018f0d90-7b13-7a22-8c33-445566778899',
    isAuthenticated: true,
  },
  authorityDescriptor: {
    descriptorVersion: 1,
    authorityInstanceId: INCARNATION,
    sessionGeneration: bearer === ALICE ? 1 : 2,
  },
  deploymentIdentity: {
    schemaVersion: 'snapback.v1',
    authMode: 'sessions',
    appId: '018f0d90-7b14-7a22-8c33-445566778899',
    schemaHash: `snapback.v1:sessions:schema:sha256:${'1'.repeat(64)}`,
    bundleHash: `snapback.v1:sessions:function:sha256:${'2'.repeat(64)}`,
    inputsHash: `snapback.v1:sessions:inputs:sha256:${'3'.repeat(64)}`,
  },
  authorizedLease: null,
});

const diagnosticResponse = (code, message, status) => new Response(
  JSON.stringify({ diagnostic: { code, message } }),
  { status, headers: { 'content-type': 'application/json' } },
);

const SITE_ROWS = [{ _id: 'site-1' }, { _id: 'site-2' }, { _id: 'site-3' }];
const RECORD_ROWS = [{ _id: 'rec-1' }, { _id: 'rec-2' }];

// Live subscribes authenticate by connection token, so the harness binds each
// minted token to the bearer that opened its connection — exactly how the
// real server scopes live authority.
const createHarness = () => {
  let nextSubscription = 0;
  let nextConnection = 0;
  const tokenBearers = new Map();
  const liveSubscriptions = new Set();
  const subscribeLog = [];
  const harness = {
    // Test seam: called with (table) when a subscribe request arrives, before
    // it is answered — the blank-before-successor probe.
    onSubscribeRequest: null,
    // Test seam: when set, successor subscribes reject at the transport
    // (fetch) level — a connectivity loss, not a server answer.
    failSubscribesWithTransportError: false,
  };
  const fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const headers = Object.fromEntries(
      Object.entries(init.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
    );
    const bearer = (headers.authorization ?? '').replace(/^Bearer /u, '') || null;
    if (path === '/auth/session') {
      if (!bearer || !USER_IDS[bearer]) {
        return diagnosticResponse('SNAPBACK_AUTH_REQUIRED', 'bearer required', 401);
      }
      return Response.json(handshakeFor(bearer));
    }
    if (path === '/connection/open') {
      const token = `sct-rotation-${nextConnection += 1}`;
      tokenBearers.set(token, bearer);
      return Response.json({
        connectionId: `wire-rotation-${nextConnection}`,
        connectionToken: token,
        authorizationInvalidation: null,
        wireVersion: 'snapback.v1',
      });
    }
    const subscribeMatch = path.match(/^\/live\/(sites|records)\/subscribe$/u);
    if (subscribeMatch) {
      const table = subscribeMatch[1];
      if (harness.failSubscribesWithTransportError) {
        throw new TypeError('fetch failed: connection refused');
      }
      harness.onSubscribeRequest?.(table);
      const body = JSON.parse(init.body);
      const connectionBearer = tokenBearers.get(headers['x-snapback-connection-token']);
      if (table === 'records' && connectionBearer !== ALICE) {
        return diagnosticResponse(
          'SNAPBACK_AUTH_PERMISSION_DENIED',
          'role requirement not satisfied',
          403,
        );
      }
      subscribeLog.push(`${table}:${connectionBearer}`);
      const subscriptionId = `sub-${table}-${nextSubscription += 1}`;
      liveSubscriptions.add(subscriptionId);
      const witness = body.supersedes
        ? liveSubscriptions.delete(body.supersedes)
          ? { superseded: body.supersedes }
          : { supersessionRefusal: 'SNAPBACK_LIVE_SUPERSESSION_TARGET_UNKNOWN' }
        : {};
      return Response.json({
        subscription_id: subscriptionId,
        snapshot: {
          version: 1,
          rows: table === 'sites' ? SITE_ROWS : RECORD_ROWS,
        },
        permission_epochs: {},
        ...witness,
      });
    }
    if (/^\/live\/(sites|records)\/unsubscribe$/u.test(path)) {
      const body = JSON.parse(init.body);
      if (!liveSubscriptions.delete(body.subscription_id)) {
        return diagnosticResponse(
          'SNAPBACK_UNKNOWN_SUBSCRIPTION',
          `unknown live subscription ${body.subscription_id}`,
          404,
        );
      }
      return Response.json({ subscription_id: body.subscription_id, disposed: true });
    }
    throw new Error(`unexpected bearer rotation request: ${path}`);
  };
  harness.fetch = fetch;
  harness.subscribeLog = subscribeLog;
  return harness;
};

const withHarness = async (run) => {
  const originalFetch = globalThis.fetch;
  const harness = createHarness();
  globalThis.fetch = harness.fetch;
  try {
    const client = createExternalSessionClient('http://bearer-rotation.test', {
      bearerToken: ALICE,
    });
    await run({ client, harness });
  } finally {
    globalThis.fetch = originalFetch;
  }
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

// --- 1: a→b downgrade settles; the denial is a handle fact; rotate back
// --- re-subscribes the parked handle (the pre-fix permanent wedge).
await withHarness(async ({ client, harness }) => {
  const recordUpdates = [];
  const sites = await client.liveQuery('sites', {
    connectionId: 'rotation-sites',
    pollCadenceMs: 60_000,
  });
  const records = await client.liveQuery('records', {
    connectionId: 'rotation-records',
    pollCadenceMs: 60_000,
    onUpdate(rows, detail) {
      recordUpdates.push({ rows: rows.length, kind: detail?.kind ?? null });
    },
  });
  assert.equal(sites.rows.length, 3);
  assert.equal(records.rows.length, 2);

  // Blank-before-successor (mustNotRegress): every successor-world subscribe
  // arrives with the predecessor rows already blanked.
  let successorSubscribes = 0;
  harness.onSubscribeRequest = (table) => {
    successorSubscribes += 1;
    const handle = table === 'sites' ? sites : records;
    assert.equal(
      handle.rows.length,
      0,
      `predecessor ${table} rows must blank before the successor subscribe`,
    );
  };

  // The downgrade transition COMPLETES: it must settle, not reject with the
  // expected denial buried in an AggregateError.
  await client.replaceBearerToken(MALLORY);

  harness.onSubscribeRequest = null;
  assert.ok(successorSubscribes >= 1, 'the successor world fresh-subscribed');

  // The public query re-entered under the successor.
  assert.deepEqual(sites.rows, SITE_ROWS);
  assert.equal(sites.paused, false);

  // The denied protected query presents the denial as a lifecycle fact.
  assert.deepEqual(records.rows, []);
  assert.equal(records.paused, true);
  assert.equal(records.connection, 'disconnected');
  assert.equal(records.authorizationDenial?.code, 'SNAPBACK_AUTH_PERMISSION_DENIED');
  assert.ok(
    Number.isFinite(records.authorizationDenial?.atMs),
    'the denial fact carries its recording time',
  );
  const denialUpdate = recordUpdates.find((entry) => entry.kind === 'authorization_denied');
  assert.ok(denialUpdate, 'the denial is delivered to onUpdate observers');
  assert.equal(denialUpdate.rows, 0, 'the denial delivery presents blank rows');

  // Rotating BACK re-subscribes the parked handle — no process restart.
  await client.replaceBearerToken(ALICE);
  await settle();
  assert.deepEqual(records.rows, RECORD_ROWS, 'restored authority re-renders protected rows');
  assert.equal(records.paused, false);
  assert.equal(records.connection, 'polling');
  assert.equal(records.authorizationDenial, null, 'a successful fresh subscribe clears the denial');
  assert.deepEqual(sites.rows, SITE_ROWS);
  assert.ok(
    harness.subscribeLog.filter((entry) => entry === `records:${ALICE}`).length >= 2,
    'rotate-back reached the server with a fresh protected subscribe',
  );
});

// --- 2: logout (null) parks every handle; the next login transition revives
// --- them without new liveQuery calls.
await withHarness(async ({ client }) => {
  const sites = await client.liveQuery('sites', {
    connectionId: 'rotation-logout-sites',
    pollCadenceMs: 60_000,
  });
  const records = await client.liveQuery('records', {
    connectionId: 'rotation-logout-records',
    pollCadenceMs: 60_000,
  });
  await client.replaceBearerToken(null);
  assert.deepEqual(sites.rows, []);
  assert.deepEqual(records.rows, []);
  assert.equal(sites.paused, true);
  assert.equal(records.paused, true);

  await client.replaceBearerToken(ALICE);
  await settle();
  assert.deepEqual(sites.rows, SITE_ROWS, 'login after logout revives the public handle');
  assert.deepEqual(records.rows, RECORD_ROWS, 'login after logout revives the protected handle');
  assert.equal(sites.paused, false);
  assert.equal(records.paused, false);
});

// --- 3: an app-paused handle stays app-owned — transitions never resume it.
await withHarness(async ({ client }) => {
  const sites = await client.liveQuery('sites', {
    connectionId: 'rotation-app-paused',
    pollCadenceMs: 60_000,
  });
  await sites.pause();
  await client.replaceBearerToken(MALLORY);
  await client.replaceBearerToken(ALICE);
  await settle();
  assert.equal(sites.paused, true, 'app pause intent survives custody transitions');
  assert.deepEqual(sites.rows, []);
});

// --- 4: genuine lifecycle breakage (transport loss, not a server answer)
// --- still rejects loudly — settling is only for answered denials.
await withHarness(async ({ client, harness }) => {
  const sites = await client.liveQuery('sites', {
    connectionId: 'rotation-transport-loss',
    pollCadenceMs: 60_000,
  });
  harness.failSubscribesWithTransportError = true;
  await assert.rejects(
    () => client.replaceBearerToken(MALLORY),
    (error) => error instanceof AggregateError
      && error.errors.some((inner) => isSnapbackDiagnosticError(inner)
        && inner.cause instanceof TypeError),
    'a transport-level successor failure is still a loud lifecycle failure',
  );
  assert.equal(sites.paused, true);

  // The failed handle stays parked: the next transition (with transport
  // restored) re-enters it.
  harness.failSubscribesWithTransportError = false;
  await client.replaceBearerToken(ALICE);
  await settle();
  assert.deepEqual(sites.rows, SITE_ROWS, 'a later transition recovers the parked handle');
  assert.equal(sites.paused, false);
});

console.log('snapback-client bearer rotation tests: ok');
