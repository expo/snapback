import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { test } from 'node:test';

import { IDBFactory } from 'fake-indexeddb';

import {
  DEFAULT_AUTH_STORAGE_PARTITION,
  createSnapbackAppClient,
} from './index.mjs';
import {
  __bootstrapHistoryForTests,
  __recordSupervisedBootstrapAdoptionForTests,
} from './app-client.mjs';

const APP_ID = '018f0d90-7c20-7a22-8c33-445566778899';
const INCARNATION = '018f0d90-7c21-7a22-8c33-445566778899';
const USER = '018f0d90-7c22-7a22-8c33-445566778899';
const PEER_USER = '018f0d90-7c23-7a22-8c33-445566778899';
const SESSION = '018f0d90-7c24-7a22-8c33-445566778899';
const PEER_SESSION = '018f0d90-7c25-7a22-8c33-445566778899';
const AUTHORITY = '018f0d90-7c26-7a22-8c33-445566778899';
const PEER_AUTHORITY = '018f0d90-7c27-7a22-8c33-445566778899';
const PASSWORD = 'app-client-password-must-not-leak';
const NEW_PASSWORD = 'app-client-new-password-must-not-leak';
const SUPERVISED_BEARER = 'sbs_app_client_supervised_secret';
const APPLICATION_BEARER = 'sbs_app_client_application_secret';
const ROTATED_BEARER = 'sbs_app_client_rotated_secret';
const PEER_BEARER = 'sbs_app_client_peer_secret';
const RECOVERY_CODES = Object.freeze(Array.from({ length: 8 }, (_, index) => (
  `sbrv1_${String(index).padStart(2, '0')}${'R'.repeat(25)}`
)));

const availability = Object.freeze({
  onlineRequestResponse: { available: true, reason: null },
  authScopedLive: {
    available: false,
    minimumAuthInvalidationProtocol: 1,
    reason: 'SNAPBACK_AUTH_INVALIDATION_PROTOCOL_REQUIRED',
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
});

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const isoFromNow = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();

function makeApp({
  schema = 'sha256:schema-1',
  functions = 'sha256:functions-1',
  descriptor = 'sha256:descriptor-1',
  custody = 'volatile-explicit',
  anonymousPublic = 'refused',
  entryMechanisms = ['password-v1'],
} = {}) {
  return Object.freeze({
    format: 'snapback.app.v1',
    identity: Object.freeze({ app: APP_ID, schema, functions, descriptor }),
    authBootstrap: Object.freeze({
      format: 'snapback.application-auth-bootstrap.v1',
      appId: APP_ID,
      mode: 'sessions',
      custody,
      entryMechanisms: Object.freeze([...entryMechanisms]),
      anonymousPublic,
      lifecycleProtocol: 1,
    }),
  });
}

function makeBinding(app, {
  origin = 'http://127.0.0.1:4711',
  issuedAt = isoFromNow(-60_000),
  expiresAt = isoFromNow(60 * 60_000),
  supervisorGeneration = 'supervisor-generation-1',
} = {}) {
  return Object.freeze({
    format: 'snapback.app-binding.v1',
    source: 'supervised-dev',
    descriptorIdentity: app.identity.descriptor,
    target: Object.freeze({
      app: app.identity.app,
      schema: app.identity.schema,
      functions: app.identity.functions,
      origin,
      routing: 'loopback',
    }),
    capabilities: Object.freeze({ offered: Object.freeze(['auth.passwords']) }),
    provenance: Object.freeze({ supervisorGeneration, issuedAt, expiresAt }),
    integrity: Object.freeze({ channel: 'local-supervised-ipc' }),
  });
}

const deploymentIdentity = (appId) => Object.freeze({
  schemaVersion: 'snapback.v1',
  authMode: 'sessions',
  appId,
  schemaHash: `snapback.v1:sessions:schema:sha256:${'1'.repeat(64)}`,
  bundleHash: `snapback.v1:sessions:function:sha256:${'2'.repeat(64)}`,
  inputsHash: `snapback.v1:sessions:inputs:sha256:${'3'.repeat(64)}`,
});

function installServer() {
  const originalFetch = globalThis.fetch;
  const priorRqsSetting = process.env.SNAPBACK_CLIENT_RQS_STORE;
  process.env.SNAPBACK_CLIENT_RQS_STORE = 'off';
  const requests = [];
  const handlers = new Map();
  const bearers = new Map();
  const registerBearer = (token, {
    userId = USER,
    sessionId = SESSION,
    authorityInstanceId = AUTHORITY,
  } = {}) => {
    bearers.set(token, { userId, sessionId, authorityInstanceId });
  };
  registerBearer(SUPERVISED_BEARER);
  registerBearer(APPLICATION_BEARER);
  registerBearer(ROTATED_BEARER);
  registerBearer(PEER_BEARER, {
    userId: PEER_USER,
    sessionId: PEER_SESSION,
    authorityInstanceId: PEER_AUTHORITY,
  });

  const handshake = (bearer, appId) => {
    const authenticated = bearers.get(bearer) ?? null;
    return {
      protocolVersion: 1,
      serverStartupNonce: 'app-client-test',
      authorizationStreamIncarnation: INCARNATION,
      transitionGeneration: 0,
      activeMode: 'sessions',
      desiredMode: 'sessions',
      modeState: 'settled',
      appDataAvailability: 'available',
      quarantineCode: null,
      clientProtocols: {
        authClient: 1,
        authInvalidation: null,
        authorityDescriptor: 1,
        authorizedLease: null,
      },
      availability,
      provider: { key: 'local-password', available: true },
      transports: ['bearer'],
      authority: authenticated === null
        ? { kind: 'anonymous', userId: null, sessionId: null, isAuthenticated: false }
        : {
            kind: 'humanSession',
            userId: authenticated.userId,
            sessionId: authenticated.sessionId,
            isAuthenticated: true,
          },
      authorityDescriptor: {
        descriptorVersion: 1,
        authorityInstanceId: authenticated?.authorityInstanceId ?? INCARNATION,
        sessionGeneration: authenticated === null ? 0 : 1,
      },
      deploymentIdentity: deploymentIdentity(appId),
      authorizedLease: null,
    };
  };

  const credential = ({
    token = APPLICATION_BEARER,
    codes = null,
    userId = USER,
    sessionId = SESSION,
    authorityInstanceId = AUTHORITY,
  } = {}) => {
    registerBearer(token, { userId, sessionId, authorityInstanceId });
    return {
      tokenType: 'Bearer',
      token,
      refreshAfter: Date.now() + 60_000,
      session: {
        id: sessionId,
        userId,
        provider: 'local-password',
        createdAt: Date.now(),
        expiresAt: Date.now() + 120_000,
        absoluteExpiresAt: Date.now() + 240_000,
      },
      authorityDescriptor: {
        descriptorVersion: 1,
        authorityInstanceId,
        sessionGeneration: 1,
      },
      ...(codes === null ? {} : { recoveryCodes: [...codes] }),
    };
  };

  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    const path = parsed.pathname;
    const headers = new Headers(init.headers);
    const authorization = headers.get('authorization');
    const bearer = authorization?.replace(/^Bearer /u, '') ?? null;
    const body = init.body === undefined ? undefined : JSON.parse(init.body);
    requests.push({ path, authorization, body, origin: parsed.origin });
    if (path === '/auth/session') {
      return Response.json(handshake(bearer, APP_ID));
    }
    const handler = handlers.get(path);
    if (!handler) throw new Error(`unexpected app-client request: ${path}`);
    return handler({ authorization, bearer, body });
  };

  return {
    requests,
    credential,
    respond(path, handler) { handlers.set(path, handler); },
    restore() {
      globalThis.fetch = originalFetch;
      if (priorRqsSetting === undefined) delete process.env.SNAPBACK_CLIENT_RQS_STORE;
      else process.env.SNAPBACK_CLIENT_RQS_STORE = priorRqsSetting;
    },
  };
}

const optionsFor = (app, binding = makeBinding(app), extra = {}) => ({
  app,
  binding,
  platform: { kind: 'memory', cryptoObject: webcrypto },
  ...extra,
});

test('framework-neutral bootstrap reaches ready through every starting stage and keeps secrets out', async () => {
  const server = installServer();
  const app = makeApp();
  const storagePartition = 'private-partition-must-not-leak';
  const appClient = await createSnapbackAppClient(optionsFor(app, makeBinding(app), {
    storagePartition,
  }));
  try {
    const history = __bootstrapHistoryForTests(appClient);
    assert.deepEqual(history.slice(0, 4).map((state) => (
      state.status === 'starting' ? state.stage : state.status
    )), ['binding', 'custody', 'authority', 'client']);
    const ready = appClient.bootstrapState();
    assert.equal(ready.status, 'ready');
    assert.equal(ready.authoritySource, 'fresh-anonymous');
    assert.equal(ready.custody.grade, 'volatile');
    assert.equal(ready.custody.carrier, 'memory');
    assert.match(ready.custody.storagePartitionIdentityHash, /^sha256:[0-9a-f]{64}$/u);
    assert.deepEqual(ready.advisories, []);
    assert.equal(DEFAULT_AUTH_STORAGE_PARTITION, 'default');
    assert.equal(appClient.auth.currentPrincipal().status, 'anonymous');

    server.respond('/auth/password/signup', ({ body }) => {
      assert.deepEqual(body, { email: 'person@example.com', password: PASSWORD });
      return Response.json(server.credential({ codes: RECOVERY_CODES }));
    });
    const result = await appClient.auth.signUpWithPassword({
      email: 'person@example.com',
      password: PASSWORD,
    });
    assert.deepEqual(result.recoveryCodes, RECOVERY_CODES);
    assert.equal(Object.hasOwn(result, 'token'), false);
    assert.equal(appClient.auth.currentPrincipal().status, 'authenticated');
    assert.equal(typeof appClient.client.auth.authPasswordSignup, 'function');
    const retained = JSON.stringify({
      bootstrap: appClient.bootstrapState(),
      principal: appClient.auth.currentPrincipal(),
      history: __bootstrapHistoryForTests(appClient),
    });
    for (const secret of [
      PASSWORD,
      APPLICATION_BEARER,
      storagePartition,
      ...RECOVERY_CODES,
    ]) {
      assert.equal(retained.includes(secret), false);
    }
  } finally {
    await appClient.dispose();
    server.restore();
  }
});

test('policy, binding, and durable-custody refusals happen before transport I/O', async () => {
  const server = installServer();
  try {
    const app = makeApp();
    const mismatched = makeBinding(app);
    const invalidBinding = {
      ...mismatched,
      target: { ...mismatched.target, schema: 'sha256:not-the-app-schema' },
    };
    await assert.rejects(
      createSnapbackAppClient(optionsFor(app, invalidBinding)),
      (error) => error?.code === 'SNAPBACK_AUTH_BOOTSTRAP_BINDING_INVALID',
    );
    await assert.rejects(
      createSnapbackAppClient({ ...optionsFor(app), bearerToken: 'must-not-be-admitted' }),
      (error) => error?.code === 'SNAPBACK_AUTH_BOOTSTRAP_INPUT_INVALID',
    );
    const expiredBinding = makeBinding(app, {
      issuedAt: isoFromNow(-120_000),
      expiresAt: isoFromNow(-60_000),
    });
    await assert.rejects(
      createSnapbackAppClient(optionsFor(app, expiredBinding)),
      (error) => error?.code === 'SNAPBACK_AUTH_BOOTSTRAP_BINDING_INVALID',
    );
    const durable = makeApp({ custody: 'durable-required' });
    await assert.rejects(
      createSnapbackAppClient(optionsFor(durable)),
      (error) => error?.code === 'SNAPBACK_AUTH_CUSTODY_DURABLE_UNAVAILABLE'
        && error?.bootstrapState?.status === 'unsupported',
    );
    assert.equal(server.requests.length, 0);

    const volatile = await createSnapbackAppClient(optionsFor(app));
    assert.equal(volatile.bootstrapState().custody.grade, 'volatile');
    assert.equal(server.requests.filter(({ path }) => path === '/auth/session').length, 1);
    await volatile.dispose();

    const withoutPasswords = makeApp({ entryMechanisms: [] });
    const noPasswordClient = await createSnapbackAppClient(optionsFor(withoutPasswords));
    const afterNoPasswordBoot = server.requests.length;
    await assert.rejects(
      noPasswordClient.auth.signInWithPassword({
        email: 'person@example.com',
        password: PASSWORD,
      }),
      (error) => error?.code === 'SNAPBACK_AUTH_BOOTSTRAP_MECHANISM_UNAVAILABLE',
    );
    assert.equal(server.requests.length, afterNoPasswordBoot);
    await noPasswordClient.dispose();
  } finally {
    server.restore();
  }
});

test('browser durable custody restores the default record and isolates explicit partitions', async () => {
  const server = installServer();
  const app = makeApp({ custody: 'durable-required' });
  const indexedDB = new IDBFactory();
  const lockManager = { request: (_name, _options, operation) => operation() };
  const platform = {
    kind: 'browser',
    indexedDB,
    lockManager,
    cryptoObject: webcrypto,
    databaseName: 'snapback-app-client-durable-test',
  };
  const input = { app, binding: makeBinding(app), platform };
  let first = null;
  let restored = null;
  let partitioned = null;
  try {
    first = await createSnapbackAppClient(input);
    assert.equal(first.bootstrapState().custody.carrier, 'indexeddb-web-locks');
    assert.equal(first.bootstrapState().custody.grade, 'durable');
    server.respond('/auth/password/signin', () => (
      Response.json(server.credential({ token: APPLICATION_BEARER }))
    ));
    await first.auth.signInWithPassword({ email: 'person@example.com', password: PASSWORD });
    await first.dispose();
    first = null;

    restored = await createSnapbackAppClient(input);
    assert.equal(restored.auth.currentPrincipal().status, 'authenticated');
    assert.equal(
      restored.auth.currentPrincipal().provider,
      null,
      'restoration does not fabricate the provider availability key as issuance provenance',
    );
    assert.equal(restored.bootstrapState().authoritySource, 'durable-restored');
    partitioned = await createSnapbackAppClient({
      ...input,
      storagePartition: 'secondary-profile',
    });
    assert.equal(partitioned.auth.currentPrincipal().status, 'anonymous');
  } finally {
    await partitioned?.dispose();
    await restored?.dispose();
    await first?.dispose();
    server.restore();
  }
});

test('owner registry single-flights, reference-counts, evicts failures, and reacquires after zero', async () => {
  const server = installServer();
  const app = makeApp();
  const options = optionsFor(app);
  const clients = await Promise.all([
    createSnapbackAppClient(options),
    createSnapbackAppClient(options),
    createSnapbackAppClient(options),
  ]);
  try {
    assert.equal(clients[0].client, clients[1].client);
    assert.equal(clients[1].client, clients[2].client);
    assert.equal(server.requests.filter(({ path }) => path === '/auth/session').length, 1);
    await clients[0].dispose();
    await clients[1].dispose();
    assert.equal(clients[2].auth.currentPrincipal().status, 'anonymous');
    const repeated = await createSnapbackAppClient(options);
    assert.equal(repeated.client, clients[2].client);
    await clients[2].dispose();
    assert.equal(repeated.auth.currentPrincipal().status, 'anonymous');
    const priorClient = repeated.client;
    await repeated.dispose();

    const reacquired = await createSnapbackAppClient(options);
    assert.notEqual(reacquired.client, priorClient);
    assert.equal(server.requests.filter(({ path }) => path === '/auth/session').length, 2);
    await reacquired.dispose();
  } finally {
    await Promise.allSettled(clients.map((client) => client.dispose()));
    server.restore();
  }

  const failureServer = installServer();
  const originalFetch = globalThis.fetch;
  let fail = true;
  globalThis.fetch = async (...args) => {
    if (fail) {
      fail = false;
      throw new Error('construction transport failure');
    }
    return originalFetch(...args);
  };
  try {
    await assert.rejects(createSnapbackAppClient(options), /construction transport failure/u);
    const recovered = await createSnapbackAppClient(options);
    assert.equal(recovered.bootstrapState().status, 'ready');
    await recovered.dispose();
  } finally {
    failureServer.restore();
  }
});

test('live owners accept proved same-policy successors and refuse conflicts, rotations, and stale bindings', async () => {
  const server = installServer();
  const firstApp = makeApp();
  const firstOptions = optionsFor(firstApp);
  const first = await createSnapbackAppClient(firstOptions);
  let reordered = null;
  let successor = null;
  try {
    const policy = firstApp.authBootstrap;
    const reorderedApp = Object.freeze({
      ...firstApp,
      authBootstrap: Object.freeze({
        lifecycleProtocol: policy.lifecycleProtocol,
        anonymousPublic: policy.anonymousPublic,
        entryMechanisms: policy.entryMechanisms,
        custody: policy.custody,
        mode: policy.mode,
        appId: policy.appId,
        format: policy.format,
      }),
    });
    reordered = await createSnapbackAppClient(optionsFor(reorderedApp));
    assert.equal(reordered.client, first.client);

    const conflictBinding = makeBinding(firstApp, { origin: 'http://127.0.0.1:4712' });
    await assert.rejects(
      createSnapbackAppClient(optionsFor(firstApp, conflictBinding)),
      (error) => error?.code === 'SNAPBACK_AUTH_BOOTSTRAP_BINDING_CONFLICT',
    );

    const successorApp = makeApp({
      schema: 'sha256:schema-2',
      functions: 'sha256:functions-2',
      descriptor: 'sha256:descriptor-2',
    });
    const successorIssuedAt = isoFromNow(60_000);
    const successorBinding = makeBinding(successorApp, {
      issuedAt: successorIssuedAt,
      expiresAt: isoFromNow(60 * 60_000),
    });
    successor = await createSnapbackAppClient(optionsFor(successorApp, successorBinding));
    assert.equal(successor.client, first.client);

    const rotatedPolicyApp = makeApp({
      schema: successorApp.identity.schema,
      functions: successorApp.identity.functions,
      descriptor: successorApp.identity.descriptor,
      anonymousPublic: 'allowed',
    });
    const rotatedPolicyBinding = makeBinding(rotatedPolicyApp, {
      issuedAt: isoFromNow(120_000),
      expiresAt: isoFromNow(60 * 60_000),
    });
    await assert.rejects(
      createSnapbackAppClient(optionsFor(rotatedPolicyApp, rotatedPolicyBinding)),
      (error) => error?.code === 'SNAPBACK_AUTH_BOOTSTRAP_POLICY_ROTATION',
    );
    await assert.rejects(
      createSnapbackAppClient(firstOptions),
      (error) => error?.code === 'SNAPBACK_AUTH_BOOTSTRAP_BINDING_STALE',
    );

    const ambiguousSameTimeRemint = makeBinding(successorApp, {
      issuedAt: successorIssuedAt,
      expiresAt: isoFromNow(2 * 60 * 60_000),
      supervisorGeneration: 'unordered-same-time-remint',
    });
    await assert.rejects(
      createSnapbackAppClient(optionsFor(successorApp, ambiguousSameTimeRemint)),
      (error) => error?.code === 'SNAPBACK_AUTH_BOOTSTRAP_BINDING_STALE',
    );

    const staleSuccessorRemint = makeBinding(successorApp, {
      issuedAt: isoFromNow(30_000),
      expiresAt: isoFromNow(60 * 60_000),
      supervisorGeneration: 'stale-successor-remint',
    });
    await assert.rejects(
      createSnapbackAppClient(optionsFor(successorApp, staleSuccessorRemint)),
      (error) => error?.code === 'SNAPBACK_AUTH_BOOTSTRAP_BINDING_STALE',
    );
  } finally {
    await successor?.dispose();
    await reordered?.dispose();
    await first.dispose();
    server.restore();
  }
});

test('entry gating protects authenticated principals while changePassword remains a rotation', async () => {
  const server = installServer();
  const app = makeApp();
  const appClient = await createSnapbackAppClient(optionsFor(app));
  try {
    appClient.client.clearAuthSession();
    const before = server.requests.length;
    await assert.rejects(
      appClient.auth.signInWithPassword({ email: 'person@example.com', password: PASSWORD }),
      (error) => error?.code === 'SNAPBACK_AUTH_ENTRY_UNSETTLED',
    );
    await assert.rejects(
      appClient.auth.changePassword({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }),
      (error) => error?.code === 'SNAPBACK_AUTH_CHANGE_PASSWORD_REQUIRES_AUTHENTICATED'
        && error?.diagnostic?.details?.principalStatus === 'loading'
        && error?.operation === 'auth-password-change',
    );
    assert.equal(server.requests.length, before);
    await appClient.client.auth.authSession();

    server.respond('/auth/password/signup', () => (
      Response.json(server.credential({ codes: RECOVERY_CODES }))
    ));
    await appClient.auth.signUpWithPassword({ email: 'person@example.com', password: PASSWORD });
    const beforeProtectedEntry = server.requests.length;
    await assert.rejects(
      appClient.auth.signInWithPassword({ email: 'person@example.com', password: PASSWORD }),
      (error) => error?.code === 'SNAPBACK_AUTH_ENTRY_AUTHENTICATED'
        && error.remediations[0].kind === 'signOut',
    );
    assert.equal(server.requests.length, beforeProtectedEntry);

    server.respond('/auth/password/change', ({ authorization, body }) => {
      assert.equal(authorization, `Bearer ${APPLICATION_BEARER}`);
      assert.deepEqual(body, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
      return Response.json(server.credential({ token: ROTATED_BEARER }));
    });
    const changed = await appClient.auth.changePassword({
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    assert.equal(changed.session.userId, USER);
    assert.equal(Object.hasOwn(changed, 'token'), false);

    const releasePublication = appClient.client.__withholdCurrentPrincipalPublication();
    try {
      await assert.rejects(
        appClient.auth.changePassword({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }),
        (error) => error?.code === 'SNAPBACK_AUTH_CHANGE_PASSWORD_REQUIRES_AUTHENTICATED'
          && error?.diagnostic?.details?.principalStatus === 'refreshing',
      );
    } finally {
      releasePublication();
    }

    const custodyFailure = new Error('custody is blocked for rotate-arm test');
    custodyFailure.code = 'SNAPBACK_AUTH_CUSTODY_CORRUPT';
    custodyFailure.diagnostic = {
      code: custodyFailure.code,
      message: 'Custody is blocked for rotate-arm test.',
      details: { phase: 'custody-read', causeCode: custodyFailure.code },
    };
    appClient.client.clearAuthSession();
    appClient.client.authCoordinator.synchronize = async () => { throw custodyFailure; };
    await assert.rejects(appClient.client.auth.authSession({ force: true }), (error) => error === custodyFailure);
    assert.equal(appClient.auth.currentPrincipal().status, 'blocked');
    await assert.rejects(
      appClient.auth.changePassword({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }),
      (error) => error?.code === 'SNAPBACK_AUTH_CHANGE_PASSWORD_REQUIRES_AUTHENTICATED'
        && error?.diagnostic?.details?.principalStatus === 'blocked',
    );
  } finally {
    await appClient.dispose();
    server.restore();
  }
});

test('supervised displacement withholds anonymous exposure and failed issuance terminates settled anonymous', async (t) => {
  await t.test('happy path publishes refreshing then the application principal', async () => {
    const server = installServer();
    const app = makeApp();
    const appClient = await createSnapbackAppClient(optionsFor(app));
    try {
      server.respond('/auth/password/signin', () => (
        Response.json(server.credential({ token: SUPERVISED_BEARER }))
      ));
      await appClient.client.auth.authPasswordSignIn({
        email: 'supervised@example.com',
        password: PASSWORD,
      });
      __recordSupervisedBootstrapAdoptionForTests(appClient);
      const observations = [];
      const unsubscribe = appClient.auth.subscribeCurrentPrincipal(() => {
        observations.push(appClient.auth.currentPrincipal().status);
      });
      server.respond('/auth/logout', ({ authorization }) => {
        assert.equal(authorization, `Bearer ${SUPERVISED_BEARER}`);
        return new Response(null, { status: 204 });
      });
      server.respond('/auth/password/signin', () => (
        Response.json(server.credential({ token: APPLICATION_BEARER }))
      ));
      const result = await appClient.auth.signInWithPassword({
        email: 'application@example.com',
        password: PASSWORD,
      });
      unsubscribe();
      assert.equal(result.session.userId, USER);
      assert.equal(observations[0], 'authenticated', '0238 D3 queues the subscribe-time current snapshot');
      assert.equal(observations[1], 'refreshing');
      assert.equal(observations.includes('anonymous'), false);
      assert.equal(observations.at(-1), 'authenticated');
      assert.equal(appClient.bootstrapState().authoritySource, 'application-entry');
    } finally {
      await appClient.dispose();
      server.restore();
    }
  });

  await t.test('failed issuance exposes the settled anonymous terminal state', async () => {
    const server = installServer();
    const app = makeApp();
    const appClient = await createSnapbackAppClient(optionsFor(app));
    try {
      server.respond('/auth/password/signin', () => (
        Response.json(server.credential({ token: SUPERVISED_BEARER }))
      ));
      await appClient.client.auth.authPasswordSignIn({
        email: 'supervised@example.com',
        password: PASSWORD,
      });
      __recordSupervisedBootstrapAdoptionForTests(appClient);
      server.respond('/auth/logout', () => new Response(null, { status: 204 }));
      server.respond('/auth/password/signin', () => Response.json({
        diagnostic: { code: 'SNAPBACK_AUTH_CREDENTIAL_INVALID', message: 'invalid credential' },
      }, { status: 401 }));
      await assert.rejects(
        appClient.auth.signInWithPassword({
          email: 'application@example.com',
          password: PASSWORD,
        }),
        (error) => error?.code === 'SNAPBACK_AUTH_ENTRY_FAILED'
          && error?.diagnostic?.details?.settledAnonymous === true,
      );
      assert.equal(appClient.auth.currentPrincipal().status, 'anonymous');
      assert.equal(appClient.bootstrapState().authoritySource, 'fresh-anonymous');
    } finally {
      await appClient.dispose();
      server.restore();
    }
  });
});

test('peer predecessor races surface the typed entry diagnostic and mid-entry remints only rebind', async (t) => {
  await t.test('peer adoption wins the intermediate anonymous predecessor', async () => {
    const server = installServer();
    const app = makeApp();
    const appClient = await createSnapbackAppClient(optionsFor(app));
    try {
      server.respond('/auth/password/signin', () => (
        Response.json(server.credential({ token: SUPERVISED_BEARER }))
      ));
      await appClient.client.auth.authPasswordSignIn({ email: 'supervised@example.com', password: PASSWORD });
      __recordSupervisedBootstrapAdoptionForTests(appClient);
      server.respond('/auth/logout', () => new Response(null, { status: 204 }));
      server.respond('/auth/password/signin', async () => {
        const coordinator = appClient.client.authCoordinator;
        const capture = coordinator.capture();
        await coordinator.transition(capture, {
          authority: {
            kind: 'session',
            authMode: 'sessions',
            authorizationStreamIncarnation: INCARNATION,
            sessionId: PEER_SESSION,
            userId: PEER_USER,
          },
          bearer: PEER_BEARER,
          refreshAfterMs: Date.now() + 60_000,
        }, 'peer-entry-test');
        return Response.json(server.credential({ token: APPLICATION_BEARER }));
      });
      await assert.rejects(
        appClient.auth.signInWithPassword({ email: 'application@example.com', password: PASSWORD }),
        (error) => error?.code === 'SNAPBACK_AUTH_ENTRY_FAILED'
          && error?.diagnostic?.details?.causeCode === 'SNAPBACK_CLIENT_AUTHORITY_STALE'
          && error?.diagnostic?.details?.principalStatus === 'authenticated',
      );
      assert.equal(appClient.auth.currentPrincipal().userId, PEER_USER);
      assert.equal(appClient.bootstrapState().authoritySource, 'external-transition');
    } finally {
      await appClient.dispose();
      server.restore();
    }
  });

  await t.test('successor binding resolves while composed entry is in flight', async () => {
    const server = installServer();
    const app = makeApp();
    const appClient = await createSnapbackAppClient(optionsFor(app));
    let reminted = null;
    try {
      server.respond('/auth/password/signin', () => (
        Response.json(server.credential({ token: SUPERVISED_BEARER }))
      ));
      await appClient.client.auth.authPasswordSignIn({ email: 'supervised@example.com', password: PASSWORD });
      __recordSupervisedBootstrapAdoptionForTests(appClient);
      server.respond('/auth/logout', () => new Response(null, { status: 204 }));
      const entered = deferred();
      const release = deferred();
      server.respond('/auth/password/signin', async () => {
        entered.resolve();
        await release.promise;
        return Response.json(server.credential({ token: APPLICATION_BEARER }));
      });
      const entry = appClient.auth.signInWithPassword({
        email: 'application@example.com',
        password: PASSWORD,
      });
      await entered.promise;
      const successorApp = makeApp({
        schema: 'sha256:schema-mid-entry',
        functions: 'sha256:functions-mid-entry',
        descriptor: 'sha256:descriptor-mid-entry',
      });
      const successorBinding = makeBinding(successorApp, {
        issuedAt: isoFromNow(180_000),
        expiresAt: isoFromNow(60 * 60_000),
      });
      reminted = await Promise.race([
        createSnapbackAppClient(optionsFor(successorApp, successorBinding)),
        new Promise((_, reject) => setTimeout(
          () => reject(new Error('mid-entry rebind waited for issuance')),
          250,
        )),
      ]);
      assert.equal(reminted.client, appClient.client);
      assert.equal(appClient.auth.currentPrincipal().status, 'refreshing');
      release.resolve();
      await entry;
      assert.equal(appClient.auth.currentPrincipal().status, 'authenticated');
    } finally {
      await reminted?.dispose();
      await appClient.dispose();
      server.restore();
    }
  });

  await t.test('displacement refuses when a peer replaces the exact supervised capture during logout preparation', async () => {
    const server = installServer();
    const app = makeApp();
    const appClient = await createSnapbackAppClient(optionsFor(app));
    try {
      server.respond('/auth/password/signin', () => (
        Response.json(server.credential({ token: SUPERVISED_BEARER }))
      ));
      await appClient.client.auth.authPasswordSignIn({
        email: 'supervised@example.com',
        password: PASSWORD,
      });
      __recordSupervisedBootstrapAdoptionForTests(appClient);

      const originalAuthSession = appClient.client.authSession.bind(appClient.client);
      let peerSettled = false;
      appClient.client.authSession = async (...args) => {
        if (!peerSettled) {
          peerSettled = true;
          const capture = appClient.client.authCoordinator.capture();
          await appClient.client.authCoordinator.transition(capture, {
            authority: {
              kind: 'session',
              authMode: 'sessions',
              authorizationStreamIncarnation: INCARNATION,
              sessionId: PEER_SESSION,
              userId: PEER_USER,
            },
            bearer: PEER_BEARER,
            refreshAfterMs: Date.now() + 60_000,
          }, 'peer-displacement-race');
        }
        return originalAuthSession(...args);
      };
      server.respond('/auth/logout', () => new Response(null, { status: 204 }));

      await assert.rejects(
        appClient.auth.signInWithPassword({
          email: 'application@example.com',
          password: PASSWORD,
        }),
        (error) => error?.code === 'SNAPBACK_AUTH_ENTRY_FAILED'
          && error?.diagnostic?.details?.causeCode === 'SNAPBACK_CLIENT_AUTHORITY_STALE'
          && error?.diagnostic?.details?.principalStatus === 'authenticated',
      );
      assert.equal(
        server.requests.filter(({ path }) => path === '/auth/logout').length,
        0,
        'the facade never sends logout for the peer successor',
      );
      assert.equal(appClient.client.authCoordinator.authority.userId, PEER_USER);
      assert.equal(appClient.auth.currentPrincipal().userId, PEER_USER);
    } finally {
      await appClient.dispose();
      server.restore();
    }
  });
});

console.log('snapback-client application auth bootstrap tests: ok');
