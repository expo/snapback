import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { IDBFactory } from 'fake-indexeddb';

const moduleRoot = process.env.SNAPBACK_GUEST_ENTRY_MODULE_ROOT;
assert.ok(moduleRoot, 'SNAPBACK_GUEST_ENTRY_MODULE_ROOT is required');
const packed = (path) => import(pathToFileURL(resolve(moduleRoot, path)).href);
const { createSnapbackAppClient } = await packed('@expo/snapback-client/app-client.mjs');
const reactArm = await packed('@expo/snapback-react/index.mjs');
const expoArm = await packed('@expo/snapback-expo/index.mjs');
const packedExpoScaffold = JSON.parse(readFileSync(resolve(
  moduleRoot,
  '@expo/snapback-cli/templates/expo-chat/snapback/generated/app.descriptor.json',
), 'utf8'));
assert.equal(packedExpoScaffold.authBootstrap?.entryMechanisms?.includes('guest-v1'), true);

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const APP_ID = '018f0d90-ab20-7a22-8c33-445566778899';
const INCARNATION = '018f0d90-ab21-7a22-8c33-445566778899';
const USER = '018f0d90-ab22-7a22-8c33-445566778899';
const GUEST_SESSION = '018f0d90-ab23-7a22-8c33-445566778899';
const GUEST_AUTHORITY = '018f0d90-ab24-7a22-8c33-445566778899';
const CLAIM_SESSION = '018f0d90-ab25-7a22-8c33-445566778899';
const CLAIM_AUTHORITY = '018f0d90-ab26-7a22-8c33-445566778899';
const GUEST_BEARER = 'sbs_packed_guest_entry_secret';
const CLAIM_BEARER = 'sbs_packed_guest_claim_secret';
const PASSWORD = 'packed-guest-claim-password-123!';
const recoveryCodes = Object.freeze(Array.from(
  { length: 8 },
  (_, index) => `sbrv1_${String(index).padStart(2, '0')}${'G'.repeat(25)}`,
));

const app = (custody) => Object.freeze({
  format: 'snapback.app.v1',
  authoringProfile: 'snapback-explicit-v1',
  identity: Object.freeze({
    app: APP_ID,
    schema: `snapback.v1:sessions:schema:sha256:${'1'.repeat(64)}`,
    functions: `snapback.v1:sessions:function:sha256:${'2'.repeat(64)}`,
    descriptor: `sha256:${'3'.repeat(64)}`,
  }),
  api: Object.freeze({
    assets: Object.freeze({}),
    ephemeral: Object.freeze({}),
    queries: Object.freeze({}),
    mutations: Object.freeze({}),
    queryGroups: Object.freeze({}),
  }),
  commands: Object.freeze({}),
  surfaces: Object.freeze({}),
  capabilities: Object.freeze({
    required: Object.freeze(['auth.application-bootstrap.v1']),
  }),
  authBootstrap: Object.freeze({
    format: 'snapback.application-auth-bootstrap.v1',
    appId: APP_ID,
    mode: 'sessions',
    custody,
    entryMechanisms: Object.freeze(['guest-v1', 'password-v1']),
    anonymousPublic: 'refused',
    lifecycleProtocol: 1,
  }),
});

const binding = (descriptor) => Object.freeze({
  format: 'snapback.app-binding.v1',
  source: 'supervised-dev',
  descriptorIdentity: descriptor,
  target: Object.freeze({
    app: APP_ID,
    schema: `snapback.v1:sessions:schema:sha256:${'1'.repeat(64)}`,
    functions: `snapback.v1:sessions:function:sha256:${'2'.repeat(64)}`,
    origin: 'http://127.0.0.1:4988',
    routing: 'loopback',
  }),
  capabilities: Object.freeze({
    offered: Object.freeze([
      'auth.application-bootstrap.v1',
      'auth.guest-sessions',
      'auth.passwords',
    ]),
  }),
  provenance: Object.freeze({
    supervisorGeneration: 'packed-guest-entry',
    issuedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  }),
  integrity: Object.freeze({ channel: 'local-supervised-ipc' }),
});

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

const originalFetch = globalThis.fetch;
const credentials = new Map();
const requests = [];
const register = (token, sessionId, authorityInstanceId, provider) => {
  credentials.set(token, { sessionId, authorityInstanceId, provider });
};
const credential = (token, sessionId, authorityInstanceId, provider, codes = null) => {
  register(token, sessionId, authorityInstanceId, provider);
  return {
    tokenType: 'Bearer',
    token,
    refreshAfter: Date.now() + 60_000,
    session: {
      id: sessionId,
      userId: USER,
      provider,
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
  const path = new URL(url).pathname;
  const headers = new Headers(init.headers);
  const bearer = headers.get('authorization')?.replace(/^Bearer /u, '') ?? null;
  const body = init.body === undefined ? undefined : JSON.parse(init.body);
  requests.push({ path, bearer, body });
  if (path === '/inspect') {
    return Response.json({
      targetProfileId: 'local-dev-sqlite-ibex',
      target: 'local',
      functions: {
        artifactKind: 'functionManifest',
        schemaVersion: 'snapback.v1',
        appId: APP_ID,
        bundleHash: `snapback.v1:sessions:function:sha256:${'2'.repeat(64)}`,
        functions: [],
      },
      schema: {
        schemaHash: `snapback.v1:sessions:schema:sha256:${'1'.repeat(64)}`,
        ephemeralCollections: [],
      },
      capabilityManifest: {
        artifactKind: 'capabilityManifest',
        schemaVersion: 'snapback.v1',
        targetProfileId: 'local-dev-sqlite-ibex',
        supportedCapabilities: [],
      },
    });
  }
  if (path === '/auth/session') {
    const known = credentials.get(bearer) ?? null;
    return Response.json({
      protocolVersion: 1,
      serverStartupNonce: 'packed-guest-entry',
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
      provider: { key: known?.provider ?? 'guest', available: true },
      transports: ['bearer'],
      authority: known === null
        ? { kind: 'anonymous', userId: null, sessionId: null, isAuthenticated: false }
        : {
            kind: 'humanSession',
            userId: USER,
            sessionId: known.sessionId,
            isAuthenticated: true,
          },
      authorityDescriptor: {
        descriptorVersion: 1,
        authorityInstanceId: known?.authorityInstanceId ?? INCARNATION,
        sessionGeneration: known === null ? 0 : 1,
      },
      deploymentIdentity: {
        schemaVersion: 'snapback.v1',
        authMode: 'sessions',
        appId: APP_ID,
        schemaHash: `snapback.v1:sessions:schema:sha256:${'1'.repeat(64)}`,
        bundleHash: `snapback.v1:sessions:function:sha256:${'2'.repeat(64)}`,
        inputsHash: `snapback.v1:sessions:inputs:sha256:${'4'.repeat(64)}`,
      },
      authorizedLease: null,
    });
  }
  if (path === '/auth/guest') {
    assert.equal(bearer, null);
    assert.deepEqual(body, {});
    return Response.json(credential(
      GUEST_BEARER,
      GUEST_SESSION,
      GUEST_AUTHORITY,
      'guest',
    ));
  }
  if (path === '/query/guestProtected') {
    assert.ok(credentials.has(bearer), 'authenticated operation carries adopted guest custody');
    return Response.json({ version: 1, rows: [{ userId: USER }] });
  }
  if (path === '/auth/guest/claim/password') {
    assert.equal(bearer, GUEST_BEARER);
    assert.deepEqual(body, { email: 'guest@example.com', password: PASSWORD });
    return Response.json(credential(
      CLAIM_BEARER,
      CLAIM_SESSION,
      CLAIM_AUTHORITY,
      'local-password',
      recoveryCodes,
    ));
  }
  if (path === '/auth/logout') {
    credentials.delete(bearer);
    return new Response(null, { status: 204 });
  }
  throw new Error(`unexpected packed guest request: ${path}`);
};

const lockManager = { request: (_name, _options, operation) => operation() };
const indexedDB = new IDBFactory();
const durableApp = app('durable-required');
const durableInput = {
  app: durableApp,
  binding: binding(durableApp.identity.descriptor),
  storagePartition: 'packed-browser-guest',
  platform: {
    kind: 'browser',
    indexedDB,
    lockManager,
    cryptoObject: webcrypto,
    databaseName: 'packed-browser-guest-custody',
  },
};

let first;
let restored;
let expoBoot;
let expoRestartBoot;
let renderer;
try {
  first = await createSnapbackAppClient(durableInput);
  const entered = await first.auth.enterAsGuest();
  assert.equal(entered.session.userId, USER);
  assert.equal(Object.hasOwn(entered, 'token'), false);
  assert.equal(first.auth.currentPrincipal().status, 'authenticated');
  assert.equal((await first.client.auth.authSession()).authority.userId, USER);
  assert.deepEqual((await first.client.query('guestProtected')).rows, [{ userId: USER }]);
  await first.dispose();
  first = null;

  restored = await createSnapbackAppClient(durableInput);
  assert.equal(restored.auth.currentPrincipal().status, 'authenticated');
  assert.equal(restored.auth.currentPrincipal().userId, USER);
  const claimed = await restored.auth.claimGuestWithPassword({
    email: 'guest@example.com',
    password: PASSWORD,
  });
  assert.equal(claimed.session.userId, USER, 'claim preserves the guest principal');
  assert.deepEqual(claimed.recoveryCodes, recoveryCodes);
  assert.equal(Object.hasOwn(claimed, 'token'), false);

  const preparedReactBinding = await restored.client.prepareReactBinding({
    generatedManifest: durableApp,
  });
  restored.client.prepareReactBinding = async () => preparedReactBinding;
  let projectedAuth = null;
  let reactFallback = null;
  function Probe() {
    projectedAuth = reactArm.useSnapbackAuth();
    return null;
  }
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(
      reactArm.SnapbackProvider,
      {
        appClient: restored,
        fallback(snapshot) {
          reactFallback = snapshot;
          return null;
        },
      },
      React.createElement(Probe),
    ));
    for (let attempt = 0; attempt < 20 && projectedAuth === null; attempt += 1) {
      await new Promise((resolveTurn) => setImmediate(resolveTurn));
    }
  });
  assert.equal(
    projectedAuth,
    restored.auth,
    `React projects the framework-neutral owner (${JSON.stringify(reactFallback)})`,
  );
  assert.equal(
    expoArm.useSnapbackAuth,
    reactArm.useSnapbackAuth,
    'Expo exports the same React projection over the same owner',
  );
  await act(async () => renderer.unmount());
  renderer = null;
  await restored.auth.signOut();
  assert.equal(restored.auth.currentPrincipal().status, 'anonymous');
  await restored.dispose();
  restored = null;

  const volatileApp = app('volatile-explicit');
  const expoBinding = binding(volatileApp.identity.descriptor);
  const expoEnvironment = Object.freeze({
    format: 'snapback.expo-environment.v1',
    appState: Object.freeze({
      currentState: 'active',
      addEventListener() { return Object.freeze({ remove() {} }); },
    }),
    resolveAppClientPlatform: async () => Object.freeze({
      kind: 'memory',
      cryptoObject: webcrypto,
    }),
    resolveBinding: async () => Object.freeze({
      binding: expoBinding,
      admission: Object.freeze({
        productionCondition: false,
        delivery: Object.freeze({ channel: 'local-supervised-ipc' }),
      }),
    }),
    resolveSupervisedAuthority: async () => Object.freeze({ status: 'unavailable' }),
    async adoptAuthority() {
      throw new Error('first-party Expo guest entry must not use legacy adoption');
    },
    onDiagnostic() {},
  });
  const createExpoBoot = () => expoArm.createSnapbackExpoBoot({
    app: volatileApp,
    environment: expoEnvironment,
    createProvider: () => Object.freeze({
      start() {},
      async dispose() {},
    }),
    bindLifecycle: () => Object.freeze({ async dispose() {} }),
  });
  expoBoot = createExpoBoot();
  const expoReady = await expoBoot.start();
  assert.equal(expoReady.status, 'ready', JSON.stringify(expoReady));
  const expoFirst = expoBoot.appClient();
  await expoFirst.auth.enterAsGuest();
  assert.equal(expoFirst.auth.currentPrincipal().status, 'authenticated');
  assert.deepEqual((await expoFirst.client.query('guestProtected')).rows, [{ userId: USER }]);
  await expoBoot.dispose();
  expoBoot = null;
  expoRestartBoot = createExpoBoot();
  const expoRestartReady = await expoRestartBoot.start();
  assert.equal(expoRestartReady.status, 'ready', JSON.stringify(expoRestartReady));
  const expoRestart = expoRestartBoot.appClient();
  assert.equal(
    expoRestart.auth.currentPrincipal().status,
    'anonymous',
    'the Expo scaffold explicitly declares volatile cold-restart custody',
  );
  await expoRestart.auth.enterAsGuest();
  await expoRestart.auth.signOut();
  assert.equal(expoRestart.auth.currentPrincipal().status, 'anonymous');
  await expoRestartBoot.dispose();
  expoRestartBoot = null;
  assert.equal(
    requests.filter(({ path }) => path === '/auth/guest').length,
    3,
    'browser and both Expo process lifetimes use the same guest transition route',
  );
  console.log('packed guest-session entry: browser durable restart/claim/logout and Expo volatile restart pass');
} finally {
  if (renderer !== undefined && renderer !== null) {
    try { await act(async () => renderer.unmount()); } catch { /* cleanup only */ }
  }
  for (const client of [first, restored]) {
    try { await client?.dispose(); } catch { /* cleanup only */ }
  }
  for (const boot of [expoBoot, expoRestartBoot]) {
    try { await boot?.dispose(); } catch { /* cleanup only */ }
  }
  globalThis.fetch = originalFetch;
}
