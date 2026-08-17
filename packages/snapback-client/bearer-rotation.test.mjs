import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createExternalSessionClient, isSnapbackDiagnosticError } from './index.mjs';
import { argsHash, digestOfRows } from './rqs.mjs';
import {
  createFileRqsResumeStore,
  createNodeFilesAdapter,
} from './rqs-store-file.mjs';
import { rqsEntryKey } from './rqs-store.mjs';

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
  authority: bearer === null
    ? { kind: 'anonymous', userId: null, sessionId: null, isAuthenticated: false }
    : {
        kind: 'humanSession',
        userId: USER_IDS[bearer],
        sessionId: '018f0d90-7b13-7a22-8c33-445566778899',
        isAuthenticated: true,
      },
  authorityDescriptor: {
    descriptorVersion: 1,
    authorityInstanceId: INCARNATION,
    sessionGeneration: bearer === null ? 0 : bearer === ALICE ? 1 : 2,
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
      if (bearer && !USER_IDS[bearer]) {
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

const withHarness = async (run, { clientOptions = {} } = {}) => {
  const originalFetch = globalThis.fetch;
  const harness = createHarness();
  globalThis.fetch = harness.fetch;
  try {
    const client = createExternalSessionClient('http://bearer-rotation.test', {
      bearerToken: ALICE,
      rqsStore: null,
      ...clientOptions,
    });
    await run({ client, harness });
  } finally {
    globalThis.fetch = originalFetch;
  }
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

// LLP 0258 Phase-1 fix-forward: every successful uncoordinated handshake must
// publish, and an explicit null bearer must settle the server-witnessed
// anonymous projection rather than leave the client loading.
await withHarness(async ({ client }) => {
  assert.equal(client.auth.currentPrincipal().status, 'loading');
  await client.auth.authSession();
  assert.equal(client.auth.currentPrincipal().status, 'authenticated');
  assert.equal(client.auth.currentPrincipal().userId, USER_IDS[ALICE]);
  assert.equal(client.auth.currentPrincipal().provider, null);

  await client.replaceBearerToken(MALLORY);
  await client.auth.authSession();
  assert.equal(client.auth.currentPrincipal().status, 'authenticated');
  assert.equal(client.auth.currentPrincipal().userId, USER_IDS[MALLORY]);

  await client.replaceBearerToken(null);
  assert.equal(client.auth.currentPrincipal().status, 'anonymous');
});

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

// --- 5: external-bearer custody has no AuthCoordinator participant, so its
// --- own transition must delete durable predecessor facts before installing
// --- the successor. This is the executable sbs_alice -> sbs_mallory repro.
{
  const directory = await mkdtemp(join(tmpdir(), 'snapback-bearer-rqs-wipe-'));
  const store = createFileRqsResumeStore({
    directory,
    clientStoreId: 'bearer-rotation-rqs',
  });
  const key = rqsEntryKey('sites', {});
  const rows = SITE_ROWS;
  await store.commit(key, {
    rows,
    token: 'sbrt1.owner-issued-public-exact-fixture',
    meta: {
      app: 'bearer-rotation',
      generation: 'sha256:alice-owner-generation',
      versionStream: 'alice-stream',
      queryArtifact: 'sha256:sites-public-exact',
      argsHash: argsHash({}),
      contentDigest: digestOfRows('mset1', rows),
      version: 1,
    },
  });
  assert.ok(await store.load(key), 'durable Alice public-exact record was not seeded');

  let wipes = 0;
  const instrumentedStore = Object.create(store);
  instrumentedStore.wipeForAuthorityTransition = async () => {
    wipes += 1;
    return store.wipeForAuthorityTransition();
  };

  try {
    await withHarness(async ({ client }) => {
      await client.auth.authSession();
      await client.replaceBearerToken(MALLORY);
      assert.ok(wipes >= 1, `expected at least one durable wipe, received ${wipes}`);
      assert.equal(await store.load(key), null,
        'Mallory can still load Alice durable public-exact bytes after transition');
      assert.equal((await store.inspection()).entries, 0,
        'the authority transition left a discoverable durable entry');
    }, { clientOptions: { rqsStore: instrumentedStore } });

    const originalFetch = globalThis.fetch;
    const offlineUpdates = [];
    globalThis.fetch = async () => { throw new TypeError('offline'); };
    try {
      const offlineMallory = createExternalSessionClient('http://bearer-rotation.test', {
        bearerToken: MALLORY,
        rqsStore: instrumentedStore,
      });
      await assert.rejects(
        () => offlineMallory.liveQuery('sites', {
          args: {},
          connectionId: 'mallory-offline-selection',
          persistResume: true,
          onUpdate(rowsUpdate, detail) {
            offlineUpdates.push({ rows: rowsUpdate, detail });
          },
        }),
        /offline|fetch failed|connection/u,
      );
      assert.equal(offlineUpdates.length, 0,
        'offline Mallory rediscovered Alice rows through retained selection');
      assert.equal(await store.load(key), null,
        'offline selection recreated or rediscovered the predecessor entry');
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
}

// --- 6: a shared-store follower installs the predecessor fence, wakes the
// --- actual writer, and exposes Mallory only after that writer's durable
// --- handle-key rotation deletes Alice's entry.
{
  const directory = await mkdtemp(join(tmpdir(), 'snapback-bearer-rqs-follower-'));
  const files = createNodeFilesAdapter();
  const writerStore = createFileRqsResumeStore({
    directory,
    files,
    clientStoreId: 'bearer-rotation-shared-rqs',
  });
  let followerStore = null;
  const key = rqsEntryKey('sites', {});
  let releaseWriterWipe;
  let observeWriterWipe;
  const writerWipeRelease = new Promise((resolve) => { releaseWriterWipe = resolve; });
  const writerWipeObserved = new Promise((resolve) => { observeWriterWipe = resolve; });
  const rename = files.rename.bind(files);
  let holdNextRename = false;
  files.rename = async (...args) => {
    if (holdNextRename) {
      holdNextRename = false;
      observeWriterWipe();
      await writerWipeRelease;
    }
    return rename(...args);
  };

  try {
    await writerStore.whenLockSettled();
    followerStore = createFileRqsResumeStore({
      directory,
      files,
      clientStoreId: 'bearer-rotation-shared-rqs',
    });
    await followerStore.whenLockSettled();
    assert.equal(writerStore.isWriter(), true, 'shared-store owner did not acquire writership');
    assert.equal(followerStore.isWriter(), false, 'shared-store follower unexpectedly became writer');
    await writerStore.commit(key, {
      rows: SITE_ROWS,
      token: 'sbrt1.shared-alice-owner-issued-public-exact-fixture',
      meta: {
        app: 'bearer-rotation',
        generation: 'sha256:shared-alice-owner-generation',
        versionStream: 'shared-alice-stream',
        queryArtifact: 'sha256:sites-public-exact',
        argsHash: argsHash({}),
        contentDigest: digestOfRows('mset1', SITE_ROWS),
        version: 1,
      },
    });
    assert.ok(await followerStore.load(key), 'follower could not see the seeded Alice entry');
    holdNextRename = true;

    await withHarness(async ({ client, harness }) => {
      await client.auth.authSession();
      const transition = client.replaceBearerToken(MALLORY);
      await writerWipeObserved;
      assert.equal(client.__externalBearerRetainedReadsFenced(), true,
        'follower did not install its client-local predecessor fence');
      assert.equal(client.bearerToken, ALICE,
        'successor bearer installed before the writer deletion barrier settled');
      await assert.rejects(
        () => client.__readQmk1LocalAnswer(),
        /retained predecessor data is fenced/u,
        'follower retention reads did not fail closed while predecessor bytes survived',
      );

      releaseWriterWipe();
      await transition;
      assert.equal(client.__externalBearerRetainedReadsFenced(), false,
        'writer handle-key rotation did not release the predecessor fence');
      assert.equal(client.bearerToken, MALLORY);
      assert.equal(await writerStore.load(key), null,
        'writer wake left Alice durable bytes in the shared store');
      assert.equal(await followerStore.load(key), null,
        'follower rediscovered Alice durable bytes after writer settlement');

      const offlineUpdates = [];
      globalThis.fetch = async () => { throw new TypeError('offline'); };
      await assert.rejects(
        () => client.liveQuery('sites', {
          args: {},
          connectionId: 'mallory-shared-follower-offline-selection',
          persistResume: true,
          onUpdate(rows, detail) { offlineUpdates.push({ rows, detail }); },
        }),
        /offline|fetch failed|connection/u,
      );
      globalThis.fetch = harness.fetch;
      assert.equal(offlineUpdates.length, 0,
        'Mallory rendered Alice rows through follower retained rediscovery');
    }, { clientOptions: { rqsStore: followerStore, offlineQueue: false } });
  } finally {
    releaseWriterWipe();
    await Promise.allSettled([followerStore?.close(), writerStore.close()]);
    await rm(directory, { recursive: true, force: true });
  }
}

// --- 7: false is never success for an injected store that can provide
// --- neither an exact predecessor fence nor a wake to a writer owner.
await withHarness(async ({ client }) => {
  await client.auth.authSession();
  await assert.rejects(
    () => client.replaceBearerToken(MALLORY),
    (error) => error instanceof AggregateError
      && error.errors.some((inner) => (
        /cannot install a predecessor fence/u.test(inner?.message ?? '')
      ))
      && client.bearerToken === ALICE,
    'an unfenceable non-writer store must block successor installation',
  );
}, {
  clientOptions: {
    rqsStore: {
      durability: () => ({ implementation: 'incapable-test-store', durable: true }),
      wipeForAuthorityTransition: async () => false,
    },
    offlineQueue: false,
  },
});

console.log('snapback-client bearer rotation tests: ok');
