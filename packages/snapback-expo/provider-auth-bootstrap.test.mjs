import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { IDBFactory } from 'fake-indexeddb';

import { createSnapbackAppClient } from '@expo/snapback-client';
import {
  adoptSupervisedBootstrapAuthority,
  createSnapbackAppClientWithBootstrapObserver,
} from '@expo/snapback-client/app-client-internal';
import { createMemoryAuthCustodyStorage } from '@expo/snapback-contract/auth-coordinator';

import {
  APPLICATION_AUTH_BOOTSTRAP_CAPABILITY,
  SnapbackExpoProvider,
  createSnapbackExpoBoot,
  useSnapbackExpoBootState,
  useSnapbackExpoLifecycleContext,
} from './provider.mjs';
import {
  useSnapbackAuth,
  useSnapbackCurrentPrincipal,
  useSnapbackQuery,
} from '@expo/snapback-react';
import { useSnapbackProviderClient } from '../snapback-react/implementation.mjs';
import { startBootstrapExchange } from '../snapback-cli/expo-dev.mjs';
import {
  SUPERVISED_DEV_IDENTITY_CHECKOUT_ENV,
  SUPERVISED_DEV_IDENTITY_CHECKOUT_HEADER,
  SUPERVISED_DEV_IDENTITY_CHECKOUT_PATH,
  SUPERVISED_EXCHANGE_FORMAT,
  SUPERVISED_EXCHANGE_PATH,
  createSupervisedExpoEnvironment,
} from './supervised-environment.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const USER_A = '018f0d90-9c20-7a22-8c33-445566778899';
const USER_B = '018f0d90-9c21-7a22-8c33-445566778899';
const SESSION_A = '018f0d90-9c22-7a22-8c33-445566778899';
const SESSION_B = '018f0d90-9c23-7a22-8c33-445566778899';
const SESSION_C = '018f0d90-9c27-7a22-8c33-445566778899';
const SESSION_D = '018f0d90-9c29-7a22-8c33-445566778899';
const SESSION_E = '018f0d90-9c2b-7a22-8c33-445566778899';
const AUTHORITY_A = '018f0d90-9c24-7a22-8c33-445566778899';
const AUTHORITY_B = '018f0d90-9c25-7a22-8c33-445566778899';
const AUTHORITY_C = '018f0d90-9c28-7a22-8c33-445566778899';
const AUTHORITY_D = '018f0d90-9c2a-7a22-8c33-445566778899';
const AUTHORITY_E = '018f0d90-9c2c-7a22-8c33-445566778899';
const INCARNATION = '018f0d90-9c26-7a22-8c33-445566778899';
const APPLICATION_BEARER = 'sbs_expo_application_authority_secret';
const APPLICATION_SIGNIN_BEARER = 'sbs_expo_application_signin_authority_secret';
const SUPERVISED_BEARER = 'sbs_expo_supervised_authority_secret';
const SUPERVISED_REMINT = 'sbs_expo_supervised_remint_secret';
const SUPERVISED_SIGNOUT_BEARER = 'sbs_expo_supervised_signout_secret';
const SUPERVISED_REMINT_AFTER_ENTRY = 'sbs_expo_supervised_remint_after_entry_secret';
const PASSWORD = 'expo-bootstrap-password-secret';
const RECOVERY_CODES = Object.freeze(Array.from({ length: 8 }, (_, index) => (
  `sbrv1_${String(index).padStart(2, '0')}${'A'.repeat(25)}`
)));
const TEST_NOW_MS = Date.parse('2026-08-15T12:30:00.000Z');

const generatedRoot = new URL(
  '../snapback-cli/templates/react/snapback/generated/',
  import.meta.url,
);
const app = JSON.parse(readFileSync(new URL('app.descriptor.json', generatedRoot)));
const functionManifest = JSON.parse(readFileSync(new URL('functions.manifest.json', generatedRoot)));
const schemaManifest = JSON.parse(readFileSync(new URL('schema.manifest.json', generatedRoot)));
const capabilityManifest = JSON.parse(readFileSync(new URL('capability.manifest.json', generatedRoot)));
app.authBootstrap.entryMechanisms = ['password-v1'];
app.authBootstrap.custody = 'durable-required';
app.capabilities.required = [...new Set([
  ...app.capabilities.required,
  APPLICATION_AUTH_BOOTSTRAP_CAPABILITY,
])];

const binding = Object.freeze({
  format: 'snapback.app-binding.v1',
  source: 'supervised-dev',
  descriptorIdentity: app.identity.descriptor,
  target: Object.freeze({
    app: app.identity.app,
    schema: app.identity.schema,
    functions: app.identity.functions,
    origin: 'http://127.0.0.1:4911',
    routing: 'loopback',
  }),
  capabilities: Object.freeze({
    offered: Object.freeze([
      ...app.capabilities.required,
      'auth.passwords',
    ]),
  }),
  provenance: Object.freeze({
    supervisorGeneration: 'expo-auth-bootstrap-test',
    issuedAt: new Date(TEST_NOW_MS - 30 * 60_000).toISOString(),
    expiresAt: new Date(TEST_NOW_MS + 30 * 60_000).toISOString(),
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

function installAuthServer() {
  const originalFetch = globalThis.fetch;
  const requests = [];
  let subscriptionSequence = 0;
  let servedFunctions = functionManifest;
  const bearers = new Map([
    [APPLICATION_BEARER, {
      userId: USER_A,
      sessionId: SESSION_A,
      authorityInstanceId: AUTHORITY_A,
    }],
    [APPLICATION_SIGNIN_BEARER, {
      userId: USER_A,
      sessionId: SESSION_C,
      authorityInstanceId: AUTHORITY_C,
    }],
    [SUPERVISED_BEARER, {
      userId: USER_B,
      sessionId: SESSION_B,
      authorityInstanceId: AUTHORITY_B,
    }],
    [SUPERVISED_REMINT, {
      userId: USER_B,
      sessionId: SESSION_B,
      authorityInstanceId: AUTHORITY_B,
    }],
    [SUPERVISED_SIGNOUT_BEARER, {
      userId: USER_B,
      sessionId: SESSION_D,
      authorityInstanceId: AUTHORITY_D,
    }],
    [SUPERVISED_REMINT_AFTER_ENTRY, {
      userId: USER_B,
      sessionId: SESSION_E,
      authorityInstanceId: AUTHORITY_E,
    }],
  ]);
  const revokedBearers = new Set();
  const handshake = (bearer, authInvalidationProtocol) => {
    const authenticated = bearers.get(bearer) ?? null;
    const authLiveOffered = authInvalidationProtocol === '1';
    return {
      protocolVersion: 1,
      serverStartupNonce: 'expo-auth-bootstrap-test',
      authorizationStreamIncarnation: INCARNATION,
      transitionGeneration: 0,
      activeMode: 'sessions',
      desiredMode: 'sessions',
      modeState: 'settled',
      appDataAvailability: 'available',
      quarantineCode: null,
      clientProtocols: {
        authClient: 1,
        authInvalidation: authLiveOffered ? 1 : null,
        authorityDescriptor: 1,
        authorizedLease: null,
      },
      availability: {
        ...availability,
        authScopedLive: authLiveOffered
          ? {
              available: true,
              minimumAuthInvalidationProtocol: 1,
              reason: null,
            }
          : availability.authScopedLive,
      },
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
      deploymentIdentity: {
        schemaVersion: 'snapback.v1',
        authMode: 'sessions',
        appId: app.identity.app,
        schemaHash: app.identity.schema,
        bundleHash: app.identity.functions,
        inputsHash: `snapback.v1:sessions:inputs:sha256:${'3'.repeat(64)}`,
      },
      authorizedLease: null,
    };
  };
  const credential = (token, record) => {
    revokedBearers.delete(token);
    return {
      tokenType: 'Bearer',
      token,
      refreshAfter: Date.now() + 60_000,
      session: {
        id: record.sessionId,
        userId: record.userId,
        provider: 'local-password',
        createdAt: Date.now(),
        expiresAt: Date.now() + 120_000,
        absoluteExpiresAt: Date.now() + 240_000,
      },
      authorityDescriptor: {
        descriptorVersion: 1,
        authorityInstanceId: record.authorityInstanceId,
        sessionGeneration: 1,
      },
    };
  };
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const headers = new Headers(init.headers);
    const authorization = headers.get('authorization');
    const bearer = authorization?.replace(/^Bearer /u, '') ?? null;
    const authInvalidationProtocol = headers.get('x-snapback-auth-invalidation-protocol');
    const connectionToken = headers.get('x-snapback-connection-token');
    const body = init.body === undefined ? null : JSON.parse(init.body);
    requests.push({ path, bearer, authInvalidationProtocol, connectionToken, body });
    if (
      revokedBearers.has(bearer)
      && (
        path === '/auth/session'
        || path === '/connection/open'
        || /^\/live\/[^/]+\/subscribe$/u.test(path)
      )
    ) {
      return Response.json({
        code: 'SNAPBACK_AUTH_SESSION_EXPIRED',
        message: 'the ordinary session has ended',
      }, { status: 401 });
    }
    if (path === '/auth/session') {
      return Response.json(handshake(bearer, authInvalidationProtocol));
    }
    if (path === '/inspect') {
      return Response.json({
        targetProfileId: capabilityManifest.targetProfileId,
        target: 'local',
        functions: servedFunctions,
        schema: schemaManifest,
        capabilityManifest,
        routeManifestHash: null,
      });
    }
    if (path === '/auth/password/signup') {
      return Response.json({
        ...credential(
          APPLICATION_BEARER,
          bearers.get(APPLICATION_BEARER),
        ),
        recoveryCodes: [...RECOVERY_CODES],
      });
    }
    if (path === '/auth/password/signin') {
      return Response.json(credential(
        APPLICATION_SIGNIN_BEARER,
        bearers.get(APPLICATION_SIGNIN_BEARER),
      ));
    }
    if (path === '/auth/logout') {
      if (bearer !== null) revokedBearers.add(bearer);
      return new Response(null, { status: 204 });
    }
    if (path === '/connection/open') {
      if (body.authInvalidationProtocol !== 1) {
        return Response.json({
          code: 'SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED',
          message: 'connection did not negotiate authInvalidationProtocol: 1',
        }, { status: 400 });
      }
      return Response.json({
        connectionId: body.connectionId,
        connectionToken: `connection-token-${body.connectionId}`,
        wireVersion: body.wireVersion,
      });
    }
    if (path === '/live/listTodos/subscribe') {
      if (authInvalidationProtocol !== '1') {
        return Response.json({
          code: 'SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED',
          message: 'auth-scoped live requires x-snapback-auth-invalidation-protocol: 1',
        }, { status: 400 });
      }
      subscriptionSequence += 1;
      return Response.json({
        subscription_id: `list-todos-${subscriptionSequence}`,
        snapshot: { rows: [], version: subscriptionSequence },
      });
    }
    if (path === '/live/listTodos/unsubscribe') {
      return Response.json({ removed: true });
    }
    throw new Error(`unexpected Expo auth request: ${path}`);
  };
  return {
    fetchImplementation: originalFetch,
    requests,
    revokedBearers,
    setFunctionManifest(value) { servedFunctions = value; },
    restore() { globalThis.fetch = originalFetch; },
  };
}

function appStateSource() {
  return Object.freeze({
    currentState: 'active',
    addEventListener() { return Object.freeze({ remove() {} }); },
  });
}

function fakeReactProvider() {
  return {
    start() {},
    async pause() {},
    async resume() {},
    inspection() { return { hostPaused: false }; },
    async dispose() {},
  };
}

function environmentFor(platform, supervisor) {
  const currentBinding = () => supervisor.binding ?? binding;
  const admission = () => ({
    productionCondition: false,
    delivery: { channel: 'local-supervised-ipc' },
  });
  return Object.freeze({
    format: 'snapback.expo-environment.v1',
    appState: appStateSource(),
    resolveNativeAuthCustodyOperatingSystem: async () => (
      ['browser', 'expo-web'].includes(platform?.kind) ? 'web' : 'ios'
    ),
    resolveAppClientPlatform: async () => platform,
    resolveBinding: async () => ({
      binding: currentBinding(),
      admission: admission(),
    }),
    async resolveSupervisedAuthority({ refresh }) {
      supervisor.events.push(refresh === true ? 'refresh' : 'boot');
      return supervisor.bearer === null
        ? Object.freeze({ status: 'unavailable' })
        : Object.freeze({
            status: 'ready',
            bearer: supervisor.bearer,
            binding: currentBinding(),
            admission: admission(),
            refreshAfterMs: Number.MAX_SAFE_INTEGER,
            ...(supervisor.clientOptions === undefined
              ? {}
              : { clientOptions: supervisor.clientOptions }),
          });
    },
    async adoptAuthority() {
      throw new Error('opted-in path must not call legacy adoptAuthority');
    },
    onDiagnostic(value) { supervisor.diagnostics.push(value); },
  });
}

const priorRqs = process.env.SNAPBACK_CLIENT_RQS_STORE;
process.env.SNAPBACK_CLIENT_RQS_STORE = 'off';
const server = installAuthServer();
const indexedDB = new IDBFactory();
const platform = Object.freeze({
  kind: 'expo-web',
  indexedDB,
  lockManager: Object.freeze({ request: (_name, _options, operation) => operation() }),
  cryptoObject: webcrypto,
  databaseName: 'snapback-expo-auth-bootstrap-test',
});

// Regression: the first-party Expo provider must carry its application
// client's authority transition into the canonical React query registry. This
// uses the real AuthCoordinator barrier; a fake that exposes successor
// authority before participant resume masks the publication-order defect.
const protectedApp = structuredClone(app);
protectedApp.api.queries.listTodos.authRequirement = 'authenticated';
const protectedFunctions = structuredClone(functionManifest);
protectedFunctions.functions.find(({ name }) => name === 'listTodos').authRequirement = 'authenticated';
server.setFunctionManifest(protectedFunctions);

// Regression: a custom application-client seam can deliberately accept the
// native-custody sentinel so the provider's runtime-posture decision remains
// observable in a DOM host without IndexedDB. The sentinel is not affirmative
// native evidence: this web boot must stop after the binding-only GET.
const sentinelWebRequests = [];
const sentinelWebBinding = structuredClone(binding);
sentinelWebBinding.provenance.issuedAt = new Date(Date.now() - 30 * 60_000).toISOString();
sentinelWebBinding.provenance.expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
const sentinelWebEnvironment = Object.freeze({
  ...createSupervisedExpoEnvironment({
    exchangeOrigin: 'http://127.0.0.1:4321',
    appState: appStateSource(),
    bindingCache: null,
    async fetch(_url, options) {
      const requestAuthority = options.method === 'POST';
      sentinelWebRequests.push(requestAuthority ? 'mint' : 'binding');
      return Response.json({
        format: SUPERVISED_EXCHANGE_FORMAT,
        correlationId: 'sentinel-dom-web-correlation',
        binding: sentinelWebBinding,
        authority: requestAuthority
          ? Object.freeze({
              status: 'ready',
              tokenType: 'Bearer',
              token: SUPERVISED_BEARER,
            })
          : Object.freeze({ status: 'unavailable' }),
      });
    },
  }),
  resolveAppClientPlatform: async () => Object.freeze({
    kind: 'expo-native-phase-2-evidence-required',
  }),
  resolveNativeAuthCustodyOperatingSystem: async () => 'unknown',
});
const previousSentinelDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const previousSentinelNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: Object.freeze({}),
});
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: Object.freeze({ product: 'Gecko' }),
});
const sentinelWebBoot = createSnapbackExpoBoot({
  app: protectedApp,
  environment: sentinelWebEnvironment,
  rqsStore: null,
  createApplicationClient: async () => Object.freeze({
    client: Object.freeze({
      prepareReactBinding: async () => Object.freeze({ source: 'deployment' }),
    }),
    auth: Object.freeze({
      currentPrincipal: () => Object.freeze({ status: 'anonymous' }),
    }),
    bootstrapState: () => Object.freeze({
      status: 'ready',
      custody: Object.freeze({ grade: 'unavailable' }),
      authoritySource: 'server-anonymous',
      advisories: Object.freeze([]),
    }),
    subscribeBootstrap: () => () => {},
    async dispose() {},
  }),
  async adoptSupervisedAuthority() {},
  createProvider: fakeReactProvider,
  bindLifecycle: () => Object.freeze({ dispose() {}, async settled() {} }),
});
const sentinelWebReady = await sentinelWebBoot.start();
assert.equal(sentinelWebReady.status, 'ready', JSON.stringify(sentinelWebReady));
assert.deepEqual(
  sentinelWebRequests,
  ['binding'],
  'a no-IndexedDB DOM web boot through custom createApplicationClient makes zero mint POSTs',
);
await sentinelWebBoot.dispose();
if (previousSentinelDocument === undefined) delete globalThis.document;
else Object.defineProperty(globalThis, 'document', previousSentinelDocument);
if (previousSentinelNavigator === undefined) delete globalThis.navigator;
else Object.defineProperty(globalThis, 'navigator', previousSentinelNavigator);

// Regression: runtime posture, not the selected custody platform, decides
// whether supervised adoption is a default. Expo web without IndexedDB uses
// explicit volatile custody (`kind: "memory"`) but must still boot anonymous
// so password entry remains reachable and no authority request is made.
const noIndexedDbWebApp = structuredClone(protectedApp);
noIndexedDbWebApp.authBootstrap.custody = 'volatile-explicit';
const noIndexedDbWebBinding = structuredClone(binding);
noIndexedDbWebBinding.provenance.issuedAt = new Date(Date.now() - 30 * 60_000).toISOString();
noIndexedDbWebBinding.provenance.expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
const noIndexedDbWebSupervisor = {
  requests: [],
  diagnostics: [],
};
const noIndexedDbWebEnvironment = Object.freeze({
  ...createSupervisedExpoEnvironment({
    exchangeOrigin: 'http://127.0.0.1:4321',
    runtimePlatform: 'web',
    appState: appStateSource(),
    bindingCache: null,
    onDiagnostic(value) { noIndexedDbWebSupervisor.diagnostics.push(value); },
    async fetch(_url, options) {
      const requestAuthority = options.method === 'POST';
      noIndexedDbWebSupervisor.requests.push(requestAuthority ? 'mint' : 'binding');
      return Response.json({
        format: SUPERVISED_EXCHANGE_FORMAT,
        correlationId: 'headless-supervised-web-correlation',
        binding: noIndexedDbWebBinding,
        authority: requestAuthority
          ? Object.freeze({
              status: 'ready',
              tokenType: 'Bearer',
              token: SUPERVISED_BEARER,
            })
          : Object.freeze({ status: 'unavailable' }),
      });
    },
  }),
  resolveAppClientPlatform: async () => Object.freeze({
    kind: 'memory',
    cryptoObject: webcrypto,
  }),
});
const previousWebDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const previousWebNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
assert.equal(globalThis.indexedDB, undefined, 'the regression requires IndexedDB to be absent');
delete globalThis.document;
delete globalThis.navigator;
const noIndexedDbWebProjection = { boot: null, principal: null };
function NoIndexedDbWebPasswordProjection() {
  noIndexedDbWebProjection.boot = useSnapbackExpoBootState();
  noIndexedDbWebProjection.principal = useSnapbackCurrentPrincipal();
  return noIndexedDbWebProjection.principal?.status === 'anonymous'
    ? React.createElement('password-form', { testID: 'no-indexeddb-web-password-form' })
    : null;
}
let noIndexedDbWebRenderer;
await act(async () => {
  noIndexedDbWebRenderer = TestRenderer.create(React.createElement(
    SnapbackExpoProvider,
    {
      app: noIndexedDbWebApp,
      environment: noIndexedDbWebEnvironment,
      rqsStore: null,
      outboxDrain: 'manual',
      fallback(state) {
        noIndexedDbWebProjection.boot = state;
        return null;
      },
    },
    React.createElement(NoIndexedDbWebPasswordProjection),
  ));
});
await settleReactUntil(
  () => noIndexedDbWebProjection.boot?.status === 'ready'
    && noIndexedDbWebProjection.principal !== null,
  () => `the no-IndexedDB Expo web provider must settle: ${JSON.stringify({
    boot: noIndexedDbWebProjection.boot,
    requests: noIndexedDbWebSupervisor.requests,
    diagnostics: noIndexedDbWebSupervisor.diagnostics,
  })}`,
);
assert.deepEqual(
  noIndexedDbWebSupervisor.requests,
  ['binding'],
  'headless Expo web makes one binding GET and zero supervised mint POSTs',
);
assert.equal(
  noIndexedDbWebProjection.principal.status,
  'anonymous',
  `Expo web without IndexedDB must not adopt from its memory custody platform: ${JSON.stringify({
    custody: noIndexedDbWebProjection.boot?.custody,
    requests: noIndexedDbWebSupervisor.requests,
  })}`,
);
assert.equal(
  noIndexedDbWebRenderer.root.findAllByProps({ testID: 'no-indexeddb-web-password-form' }).length,
  1,
  'Expo web without IndexedDB exposes password entry',
);
await act(async () => {
  noIndexedDbWebRenderer.unmount();
  await new Promise((resolve) => setImmediate(resolve));
});
if (previousWebDocument === undefined) delete globalThis.document;
else Object.defineProperty(globalThis, 'document', previousWebDocument);
if (previousWebNavigator === undefined) delete globalThis.navigator;
else Object.defineProperty(globalThis, 'navigator', previousWebNavigator);

const previousLiveNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
delete process.env.SNAPBACK_CLIENT_RQS_STORE;
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  enumerable: true,
  value: Object.freeze({ product: 'ReactNative' }),
});
const liveMemoryCustody = createMemoryAuthCustodyStorage();
const livePlatform = Object.freeze({
  kind: 'expo-native',
  cryptoObject: webcrypto,
  authCustodyStorage: Object.freeze({
    ownerKeyCapability: liveMemoryCustody.ownerKeyCapability,
    withOwnership: liveMemoryCustody.withOwnership,
    platformGrade: async () => Object.freeze({
      grade: 'single-runtime',
      mechanism: 'provider-auth-bootstrap-native-fixture',
    }),
  }),
});
const liveBinding = structuredClone(binding);
liveBinding.provenance.issuedAt = new Date(Date.now() - 30 * 60_000).toISOString();
liveBinding.provenance.expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
const liveSupervisor = {
  bearer: SUPERVISED_BEARER,
  binding: liveBinding,
  events: [],
  diagnostics: [],
};
const originalWebSocket = globalThis.WebSocket;
let liveSocketAttempts = 0;

class LiveQueryWebSocket {
  constructor(url, protocols) {
    this.url = url;
    this.protocols = protocols;
    this.readyState = 0;
    this.listeners = new Map();
    liveSocketAttempts += 1;
    queueMicrotask(() => {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      this.emit('open', {});
    });
  }

  addEventListener(type, listener, options = {}) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push({ listener, once: options.once === true });
    this.listeners.set(type, listeners);
  }

  emit(type, event) {
    const listeners = [...(this.listeners.get(type) ?? [])];
    for (const entry of listeners) {
      entry.listener(event);
      if (entry.once) {
        const current = this.listeners.get(type) ?? [];
        const index = current.indexOf(entry);
        if (index !== -1) current.splice(index, 1);
      }
    }
  }

  send(encoded) {
    const request = JSON.parse(encoded);
    if (request.type !== 'ping') return;
    queueMicrotask(() => this.emit('message', {
      data: JSON.stringify({ kind: 'pong', requestId: request.requestId }),
    }));
  }

  close(code = 1000, reason = '') {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit('close', { code, reason });
  }
}

globalThis.WebSocket = LiveQueryWebSocket;
const liveEnvironment = environmentFor(livePlatform, liveSupervisor);
const liveProjection = { auth: null, principal: null, query: null, boot: null };
function ProtectedLiveProjection() {
  liveProjection.query = useSnapbackQuery(protectedApp.api.queries.listTodos, {});
  return null;
}
function LiveProjection({ showQuery = true }) {
  liveProjection.auth = useSnapbackAuth();
  liveProjection.boot = useSnapbackExpoBootState();
  liveProjection.principal = useSnapbackCurrentPrincipal();
  liveProjection.client = useSnapbackProviderClient();
  liveProjection.refreshAuthority = useSnapbackExpoLifecycleContext()?.refreshAuthority ?? null;
  if (!showQuery) liveProjection.query = null;
  return React.createElement(
    React.Fragment,
    null,
    liveProjection.principal?.status === 'anonymous'
      ? React.createElement('password-form', { testID: 'password-form' })
      : null,
    showQuery ? React.createElement(ProtectedLiveProjection) : null,
  );
}
async function settleReactUntil(predicate, message) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  assert.fail(typeof message === 'function' ? message() : message);
}

// Default web posture is anonymous-first even when the supervisor can mint.
// Omit the prop entirely: this is the public default, while the native fixture
// below keeps its explicit-false opt-out coverage.
const defaultWebSupervisor = {
  bearer: SUPERVISED_BEARER,
  binding: liveBinding,
  events: [],
  diagnostics: [],
};
const defaultWebBaseEnvironment = environmentFor(Object.freeze({
  ...platform,
  databaseName: 'snapback-expo-auth-bootstrap-default-web',
}), defaultWebSupervisor);
let defaultWebBindingResolutions = 0;
const defaultWebEnvironment = Object.freeze({
  ...defaultWebBaseEnvironment,
  async resolveBinding(input) {
    defaultWebBindingResolutions += 1;
    return defaultWebBaseEnvironment.resolveBinding(input);
  },
});
let defaultWebPrincipal = null;
let defaultWebBootState = null;
function DefaultWebPasswordProjection() {
  defaultWebPrincipal = useSnapbackCurrentPrincipal();
  return defaultWebPrincipal?.status === 'anonymous'
    ? React.createElement('password-form', { testID: 'default-web-password-form' })
    : null;
}
let defaultWebRenderer;
await act(async () => {
  defaultWebRenderer = TestRenderer.create(React.createElement(
    SnapbackExpoProvider,
    {
      app: protectedApp,
      environment: defaultWebEnvironment,
      outboxDrain: 'manual',
      fallback(state) {
        defaultWebBootState = state;
        return null;
      },
    },
    React.createElement(DefaultWebPasswordProjection),
  ));
});
await settleReactUntil(
  () => defaultWebPrincipal?.status === 'anonymous',
  () => `an omitted adoption prop on expo-web must settle anonymous: ${JSON.stringify({
    boot: defaultWebBootState,
    diagnostics: defaultWebSupervisor.diagnostics,
  })}`,
);
assert.equal(
  defaultWebRenderer.root.findAllByProps({ testID: 'default-web-password-form' }).length,
  1,
  'the omitted-prop expo-web default exposes password entry',
);
assert.deepEqual(
  defaultWebSupervisor.events,
  [],
  'the omitted-prop expo-web default never resolves supervised authority',
);
await act(async () => {
  defaultWebRenderer.unmount();
  await new Promise((resolve) => setImmediate(resolve));
});

const defaultRefreshSupervisor = {
  bearer: SUPERVISED_BEARER,
  binding: liveBinding,
  events: [],
  diagnostics: [],
};
const defaultRefreshEnvironment = environmentFor(Object.freeze({
  ...platform,
  databaseName: 'snapback-expo-auth-bootstrap-default-refresh',
}), defaultRefreshSupervisor);
const defaultRefreshProjection = {
  auth: null,
  boot: null,
  client: null,
  disposeBoot: null,
  principal: null,
  query: null,
  refreshAuthority: null,
};
function DefaultRefreshProjection() {
  defaultRefreshProjection.auth = useSnapbackAuth();
  defaultRefreshProjection.boot = useSnapbackExpoBootState();
  defaultRefreshProjection.client = useSnapbackProviderClient();
  defaultRefreshProjection.principal = useSnapbackCurrentPrincipal();
  defaultRefreshProjection.query = useSnapbackQuery(app.api.queries.listTodos, {});
  const lifecycleContext = useSnapbackExpoLifecycleContext();
  defaultRefreshProjection.disposeBoot = lifecycleContext?.disposeBoot ?? null;
  defaultRefreshProjection.refreshAuthority = lifecycleContext?.refreshAuthority ?? null;
  return null;
}
server.setFunctionManifest(functionManifest);
const defaultRefreshSubscriptionsBeforeMount = server.requests.filter(
  ({ path }) => path === '/live/listTodos/subscribe',
).length;
let defaultRefreshRenderer;
await act(async () => {
  defaultRefreshRenderer = TestRenderer.create(React.createElement(
    SnapbackExpoProvider,
    {
      app,
      environment: defaultRefreshEnvironment,
      rqsStore: null,
      outboxDrain: 'manual',
    },
    React.createElement(DefaultRefreshProjection),
  ));
});
await settleReactUntil(
  () => defaultRefreshProjection.principal?.status === 'anonymous'
    && defaultRefreshProjection.boot?.authoritySource === 'fresh-anonymous'
    && defaultRefreshProjection.query?.status === 'ready'
    && typeof defaultRefreshProjection.refreshAuthority === 'function',
  'the real anonymous Expo provider must mount a public live query before refresh',
);
const defaultRefreshPredecessorAuth = defaultRefreshProjection.auth;
const defaultRefreshPredecessorClient = defaultRefreshProjection.client;
const defaultRefreshSubscriptionsBeforeRefresh = server.requests.filter(
  ({ path }) => path === '/live/listTodos/subscribe',
).length;
assert.equal(
  defaultRefreshSubscriptionsBeforeRefresh,
  defaultRefreshSubscriptionsBeforeMount + 1,
  'anonymous initial render subscribes the mounted public query once',
);
const defaultRefreshBinding = structuredClone(liveBinding);
defaultRefreshBinding.provenance.issuedAt = new Date(Date.now() - 20 * 60_000).toISOString();
defaultRefreshBinding.provenance.expiresAt = new Date(Date.now() + 40 * 60_000).toISOString();
defaultRefreshSupervisor.binding = defaultRefreshBinding;
await act(async () => { await defaultRefreshProjection.refreshAuthority(); });
await settleReactUntil(
  () => defaultRefreshProjection.auth !== defaultRefreshPredecessorAuth
    && defaultRefreshProjection.query?.status === 'ready'
    && server.requests.filter(({ path }) => path === '/live/listTodos/subscribe').length
      === defaultRefreshSubscriptionsBeforeRefresh + 1,
  'anonymous refresh must atomically render the successor provider and re-subscribe its mounted query',
);
assert.notEqual(
  defaultRefreshProjection.auth,
  defaultRefreshPredecessorAuth,
  'anonymous refresh exposes a successor app-client projection',
);
assert.equal(
  defaultRefreshProjection.client,
  defaultRefreshPredecessorClient,
  'same-owner anonymous rebind retains the canonical underlying client',
);
assert.deepEqual(
  defaultRefreshSupervisor.events,
  [],
  'refresh remains rebind-only when supervised adoption was not opted in',
);
assert.equal(defaultRefreshProjection.principal.status, 'anonymous');
await act(async () => {
  defaultRefreshRenderer.unmount();
  await defaultRefreshProjection.disposeBoot();
});
server.setFunctionManifest(protectedFunctions);

const liveRequestStart = server.requests.length;
const liveSubscriptions = () => server.requests.slice(liveRequestStart).filter(
  ({ path }) => path === '/live/listTodos/subscribe',
);
const liveConnectionOpens = () => server.requests.slice(liveRequestStart).filter(
  ({ path }) => path === '/connection/open',
);
const liveTree = (showQuery = true) => React.createElement(
  SnapbackExpoProvider,
  {
    app: protectedApp,
    environment: liveEnvironment,
    adoptSupervisedSession: false,
    outboxDrain: 'manual',
    fallback(state) {
      liveProjection.boot = state;
      return null;
    },
  },
  React.createElement(LiveProjection, { showQuery }),
);
let liveRenderer;
await act(async () => {
  liveRenderer = TestRenderer.create(liveTree());
});
await settleReactUntil(
  () => liveProjection.auth !== null && liveProjection.query?.status === 'blocked',
  () => `Expo provider must mount the anonymous blocked query: ${JSON.stringify({
    boot: liveProjection.boot,
    diagnostics: liveSupervisor.diagnostics,
    requests: server.requests.slice(-10),
  })}`,
);
assert.equal(liveProjection.query.status, 'blocked');
assert.equal(
  liveRenderer.root.findAllByProps({ testID: 'password-form' }).length,
  1,
  'default first-party boot exposes password entry instead of adopting the available mint',
);
assert.equal(liveSubscriptions().length, 0, 'anonymous protected query performs no stream work');
assert.deepEqual(
  liveSupervisor.events,
  [],
  'default first-party boot does not request or adopt supervised authority',
);
await act(async () => {
  await liveProjection.auth.signUpWithPassword({
    email: 'application@example.com',
    password: PASSWORD,
  });
});
const streamsAfterSignup = liveSubscriptions().length;
const signinRequestsBeforeRefusal = server.requests.filter(
  ({ path }) => path === '/auth/password/signin',
).length;
await assert.rejects(
  liveProjection.auth.signInWithPassword({
    email: 'application@example.com',
    password: PASSWORD,
  }),
  (error) => error?.code === 'SNAPBACK_AUTH_ENTRY_AUTHENTICATED',
  'signin immediately after signup requires explicit signout',
);
assert.equal(
  server.requests.filter(({ path }) => path === '/auth/password/signin').length,
  signinRequestsBeforeRefusal,
  'signin immediately after signup is refused before transport',
);
assert.equal(
  liveSubscriptions().length,
  streamsAfterSignup,
  'refused signin performs no additional stream work',
);

await act(async () => { await liveProjection.auth.signOut(); });
await settleReactUntil(
  () => liveProjection.principal?.status === 'anonymous'
    && liveProjection.query?.status === 'blocked',
  'signout must blank the protected query and publish anonymous principal state',
);
assert.equal(liveProjection.principal.status, 'anonymous');
assert.equal(liveProjection.query.status, 'blocked');
assert.equal(liveRenderer.root.findAllByProps({ testID: 'password-form' }).length, 1);
assert.equal(
  liveSubscriptions().length,
  streamsAfterSignup,
  'signout performs no anonymous stream work',
);

const startsBeforeSecondAuthenticatedSuccessor = liveSubscriptions().length;
const socketsBeforeSecondAuthenticatedSuccessor = liveSocketAttempts;
await act(async () => {
  await liveProjection.auth.signInWithPassword({
    email: 'application@example.com',
    password: PASSWORD,
  });
});
await settleReactUntil(
  () => liveProjection.query?.status === 'ready'
    && liveSubscriptions().length === startsBeforeSecondAuthenticatedSuccessor + 1
    && liveSocketAttempts === socketsBeforeSecondAuthenticatedSuccessor + 1,
  'authenticated successor #2 must start exactly one socket-backed stream and make the query ready',
);
const passwordRefreshAuth = liveProjection.auth;
const passwordRefreshClient = liveProjection.client;
const passwordRefreshSubscriptions = liveSubscriptions().length;
assert.equal(liveProjection.boot.authoritySource, 'application-entry');
const passwordRefreshBinding = structuredClone(liveBinding);
passwordRefreshBinding.provenance.issuedAt = new Date(Date.now() - 10 * 60_000).toISOString();
passwordRefreshBinding.provenance.expiresAt = new Date(Date.now() + 50 * 60_000).toISOString();
liveSupervisor.binding = passwordRefreshBinding;
await act(async () => { await liveProjection.refreshAuthority(); });
await settleReactUntil(
  () => liveProjection.principal?.status === 'authenticated'
    && liveProjection.query?.status === 'ready',
  'password-authenticated refresh must retain the settled session and mounted query',
);
assert.equal(liveProjection.auth, passwordRefreshAuth, 'password refresh retains the app-client projection');
assert.equal(liveProjection.client, passwordRefreshClient, 'password refresh retains the same client');
assert.equal(liveProjection.boot.authoritySource, 'application-entry');
assert.equal(liveProjection.principal.userId, USER_A, 'password refresh preserves the signed-in principal');
assert.equal(
  liveSubscriptions().length,
  passwordRefreshSubscriptions,
  'password refresh does not rebuild or re-subscribe the mounted query',
);
assert.equal(
  startsBeforeSecondAuthenticatedSuccessor,
  1,
  'signup starts authenticated successor #1 once before the exact signout/signin sequence',
);
assert.equal(
  liveSubscriptions().length - startsBeforeSecondAuthenticatedSuccessor,
  1,
  'signin after signup and signout starts exactly one fresh live stream',
);
assert.equal(
  liveConnectionOpens().at(-1).bearer,
  APPLICATION_SIGNIN_BEARER,
  'signin transport admission carries authenticated successor #2 bearer',
);
assert.equal(
  liveConnectionOpens().at(-1).body.authInvalidationProtocol,
  1,
  'signin transport admission carries successor #2 auth/live open offer',
);
assert.equal(
  liveSubscriptions().at(-1).authInvalidationProtocol,
  '1',
  'signin subscribe carries successor #2 auth/live lifecycle offer',
);
assert.equal(
  liveSocketAttempts - socketsBeforeSecondAuthenticatedSuccessor,
  1,
  'authenticated successor #2 reaches exactly one WebSocket attempt',
);
assert.equal(
  liveProjection.query.status,
  'ready',
  'the protected query leaves pending after authenticated successor #2',
);

// Metro may evaluate and mount the protected route only after sign-in has
// completely exposed its successor. Prove that this late hook registration
// reads the current authority level and creates one new stream without
// requiring another auth-transition edge.
await act(async () => { liveRenderer.update(liveTree(false)); });
await act(async () => { await new Promise((resolve) => setImmediate(resolve)); });
await act(async () => { await liveProjection.auth.signOut(); });
await settleReactUntil(
  () => liveProjection.principal?.status === 'anonymous',
  'late-mount arm must reach anonymous before signing in without the query',
);
const startsBeforeQuerylessSignin = liveSubscriptions().length;
const socketsBeforeQuerylessSignin = liveSocketAttempts;
await act(async () => {
  await liveProjection.auth.signInWithPassword({
    email: 'application@example.com',
    password: PASSWORD,
  });
});
assert.equal(
  liveSubscriptions().length,
  startsBeforeQuerylessSignin,
  'signin with no protected store performs no speculative subscribe',
);
assert.equal(
  liveSocketAttempts,
  socketsBeforeQuerylessSignin,
  'signin with no protected store performs no speculative socket work',
);
await act(async () => { liveRenderer.update(liveTree(true)); });
await settleReactUntil(
  () => liveProjection.query?.status === 'ready'
    && liveSubscriptions().length === startsBeforeQuerylessSignin + 1
    && liveSocketAttempts === socketsBeforeQuerylessSignin + 1,
  'protected query mounted after signin confirmation must start one socket-backed stream',
);
assert.equal(
  liveSubscriptions().length - startsBeforeQuerylessSignin,
  1,
  'post-signin protected hook registration starts exactly one stream',
);
assert.equal(
  liveSocketAttempts - socketsBeforeQuerylessSignin,
  1,
  'post-signin protected hook registration creates exactly one socket',
);
await act(async () => {
  liveRenderer.unmount();
  await new Promise((resolve) => setImmediate(resolve));
});

// Regression: an explicitly adopted supervised mint is a normal session, not
// a permanent provider bootstrap dependency. The fake server below models the
// real revocation edge: once logout ends the bearer, any attempted reuse gets
// SNAPBACK_AUTH_SESSION_EXPIRED. Keep a protected query mounted across that
// transition and require the real React provider to expose password entry.
const adoptedSignoutPlatform = Object.freeze({
  kind: 'expo-web',
  indexedDB: new IDBFactory(),
  lockManager: Object.freeze({ request: (_name, _options, operation) => operation() }),
  cryptoObject: webcrypto,
  databaseName: 'snapback-expo-auth-bootstrap-adopted-signout-web',
});
const adoptedSignoutSupervisor = {
  events: [],
  diagnostics: [],
};
let adoptedSignoutExchange;
adoptedSignoutExchange = await startBootstrapExchange(({ requestAuthority }) => {
  adoptedSignoutSupervisor.events.push(requestAuthority ? 'mint' : 'binding');
  return Object.freeze({
    format: SUPERVISED_EXCHANGE_FORMAT,
    correlationId: 'provider-adopted-signout-web',
    binding: liveBinding,
    authority: requestAuthority
      ? Object.freeze({
          status: 'ready',
          tokenType: 'Bearer',
          token: SUPERVISED_SIGNOUT_BEARER,
        })
      : Object.freeze({ status: 'unavailable' }),
  });
}, {
  admittedAuthorityOrigins: () => [adoptedSignoutExchange.origin],
});
const adoptedSignoutEnvironment = Object.freeze({
  ...createSupervisedExpoEnvironment({
    exchangeOrigin: adoptedSignoutExchange.origin,
    fetch: server.fetchImplementation,
    appState: appStateSource(),
    bindingCache: null,
    runtimePlatform: 'web',
    onDiagnostic(value) { adoptedSignoutSupervisor.diagnostics.push(value); },
  }),
  resolveNativeAuthCustodyOperatingSystem: async () => 'web',
  resolveAppClientPlatform: async () => adoptedSignoutPlatform,
});
const adoptedSignoutProjection = { auth: null, principal: null, query: null, boot: null };
function AdoptedSignoutProjection() {
  adoptedSignoutProjection.auth = useSnapbackAuth();
  adoptedSignoutProjection.principal = useSnapbackCurrentPrincipal();
  adoptedSignoutProjection.query = useSnapbackQuery(protectedApp.api.queries.listTodos, {});
  return adoptedSignoutProjection.principal?.status === 'anonymous'
    ? React.createElement('password-form', { testID: 'adopted-signout-password-form' })
    : null;
}
let adoptedSignoutRenderer;
await act(async () => {
  adoptedSignoutRenderer = TestRenderer.create(React.createElement(
    SnapbackExpoProvider,
    {
      app: protectedApp,
      environment: adoptedSignoutEnvironment,
      adoptSupervisedSession: true,
      rqsStore: null,
      outboxDrain: 'manual',
      fallback(state) {
        adoptedSignoutProjection.boot = state;
        return null;
      },
    },
    React.createElement(AdoptedSignoutProjection),
  ));
});
await settleReactUntil(
  () => adoptedSignoutProjection.principal?.status === 'authenticated'
    && adoptedSignoutProjection.query?.status === 'ready',
  () => `the real provider must adopt the supervised mint and mount its protected query: ${JSON.stringify({
    boot: adoptedSignoutProjection.boot,
    diagnostics: adoptedSignoutSupervisor.diagnostics,
    requests: server.requests.slice(-10),
  })}`,
);
await act(async () => { await adoptedSignoutProjection.auth.signOut(); });
await settleReactUntil(
  () => adoptedSignoutProjection.principal?.status === 'anonymous'
    && adoptedSignoutProjection.query?.status === 'blocked'
    && adoptedSignoutRenderer.root.findAllByProps({
      testID: 'adopted-signout-password-form',
    }).length === 1,
  () => `signout must fence the adopted query and expose password entry: ${JSON.stringify({
    boot: adoptedSignoutProjection.boot,
    principal: adoptedSignoutProjection.principal,
    query: adoptedSignoutProjection.query,
    diagnostics: adoptedSignoutSupervisor.diagnostics,
    requests: server.requests.slice(-10),
  })}`,
);
assert.equal(server.revokedBearers.has(SUPERVISED_SIGNOUT_BEARER), true);
const revokedBearerReuse = await fetch(`${liveBinding.target.origin}/auth/session`, {
  headers: { authorization: `Bearer ${SUPERVISED_SIGNOUT_BEARER}` },
});
assert.equal(revokedBearerReuse.status, 401, 'the ended supervised bearer is unusable');
assert.equal(
  (await revokedBearerReuse.json()).code,
  'SNAPBACK_AUTH_SESSION_EXPIRED',
  'the route gate reports the ordinary ended-session diagnostic',
);
assert.equal(
  adoptedSignoutSupervisor.diagnostics.some(
    ({ code }) => code === 'SNAPBACK_AUTH_SESSION_EXPIRED',
  ),
  false,
);
await act(async () => {
  adoptedSignoutRenderer.unmount();
  await new Promise((resolve) => setImmediate(resolve));
});
await adoptedSignoutExchange.close();
globalThis.WebSocket = originalWebSocket;
if (previousLiveNavigator === undefined) delete globalThis.navigator;
else Object.defineProperty(globalThis, 'navigator', previousLiveNavigator);
process.env.SNAPBACK_CLIENT_RQS_STORE = 'off';

let seeded = await createSnapbackAppClient({
  app, binding, platform, now: () => Date.parse('2026-08-15T12:30:00.000Z'),
});
await seeded.auth.signInWithPassword({ email: 'application@example.com', password: PASSWORD });
await seeded.dispose();
seeded = null;

const supervisor = {
  bearer: SUPERVISED_BEARER,
  events: [],
  diagnostics: [],
};
const boot = createSnapbackExpoBoot({
  app,
  environment: environmentFor(platform, supervisor),
  adoptSupervisedSession: true,
  now: () => TEST_NOW_MS,
  async createApplicationClient(input, observer) {
    const appClient = await createSnapbackAppClientWithBootstrapObserver(input, observer);
    appClient.client.prepareReactBinding = async () => ({ source: 'deployment' });
    return appClient;
  },
  createProvider: fakeReactProvider,
  bindLifecycle: () => Object.freeze({ dispose() {}, async settled() {} }),
});
const bootStates = [];
boot.subscribe(() => bootStates.push(boot.getSnapshot()));

const ready = await boot.start();
assert.equal(ready.status, 'ready');
assert.equal(ready.authoritySource, 'durable-restored');
assert.equal(ready.custody.grade, 'durable');
assert.equal(ready.binding.source, 'supervised-dev');
assert.equal(ready.preparation.source, 'deployment');
assert.deepEqual(ready.advisories.map(({ diagnostic }) => diagnostic.code), [
  'SNAPBACK_AUTH_SUPERVISED_PRINCIPAL_CONFLICT',
]);
assert.equal(boot.appClient().auth.currentPrincipal().userId, USER_A);
assert.deepEqual(
  bootStates
    .filter(({ status }) => status === 'starting')
    .map(({ stage }) => stage),
  ['binding', 'custody', 'authority', 'client'],
);

const afterRefreshConflict = await boot.refreshAuthority();
assert.equal(afterRefreshConflict.status, 'ready');
assert.equal(boot.appClient().auth.currentPrincipal().userId, USER_A);
assert.equal(afterRefreshConflict.advisories[0].diagnostic.code,
  'SNAPBACK_AUTH_SUPERVISED_PRINCIPAL_CONFLICT');

await boot.appClient().auth.signOut();
assert.equal(boot.appClient().auth.currentPrincipal().status, 'anonymous');
const readmitted = await boot.refreshAuthority();
assert.equal(readmitted.status, 'ready');
assert.equal(
  readmitted.authoritySource,
  'supervised-development',
  JSON.stringify({ events: supervisor.events, diagnostics: supervisor.diagnostics }),
);
assert.deepEqual(readmitted.advisories, []);
assert.equal(boot.appClient().auth.currentPrincipal().userId, USER_B);

supervisor.bearer = SUPERVISED_REMINT;
const rebound = await boot.refreshAuthority();
assert.equal(rebound.status, 'ready');
assert.equal(rebound.authoritySource, 'supervised-development');
assert.deepEqual(rebound.advisories, []);
assert.equal(boot.appClient().auth.currentPrincipal().userId, USER_B);

await boot.appClient().auth.signInWithPassword({
  email: 'application@example.com',
  password: PASSWORD,
});
assert.equal(boot.appClient().bootstrapState().authoritySource, 'application-entry');
supervisor.bearer = SUPERVISED_REMINT_AFTER_ENTRY;
const applicationConflict = await boot.refreshAuthority();
assert.equal(applicationConflict.status, 'ready');
assert.equal(boot.appClient().auth.currentPrincipal().userId, USER_A);
assert.equal(applicationConflict.advisories[0].diagnostic.code,
  'SNAPBACK_AUTH_SUPERVISED_PRINCIPAL_CONFLICT');
await boot.dispose();

// Focused injected client-options test. The ordinary lifecycle above uses the
// default sessions-only environment; the live first-party native reader is
// receipt-gated separately, while this memory platform isolates the internal
// native-only client-option seam from browser custody.
const devIdentityCapability = 'sbdev_provider_plumbing_test';
const carrierProtocolApp = structuredClone(app);
carrierProtocolApp.authBootstrap.custody = 'volatile-explicit';
const carrierProtocolPlatform = Object.freeze({
  kind: 'memory',
  cryptoObject: webcrypto,
  databaseName: 'snapback-expo-auth-bootstrap-carrier-protocol-test',
});
const carrierProtocolSupervisor = {
  bearer: SUPERVISED_BEARER,
  clientOptions: Object.freeze({ devIdentityCapability }),
  events: [],
  diagnostics: [],
};
const carrierProtocolAdoptionInputs = [];
const carrierProtocolBoot = createSnapbackExpoBoot({
  app: carrierProtocolApp,
  environment: environmentFor(carrierProtocolPlatform, carrierProtocolSupervisor),
  adoptSupervisedSession: true,
  now: () => Date.parse('2026-08-15T12:30:00.000Z'),
  async createApplicationClient(input, observer) {
    const appClient = await createSnapbackAppClientWithBootstrapObserver(input, observer);
    appClient.client.prepareReactBinding = async () => ({ source: 'deployment' });
    return appClient;
  },
  createProvider: fakeReactProvider,
  bindLifecycle: () => Object.freeze({ dispose() {}, async settled() {} }),
  async adoptSupervisedAuthority(appClient, input) {
    carrierProtocolAdoptionInputs.push(input);
    // This seam test runs on expo-web, where the app client intentionally
    // refuses raw dev-identity installation. Record the provider carrier, then
    // use ordinary bearer adoption so the fixture tests plumbing without
    // weakening that platform refusal.
    const { clientOptions: _clientOptions, ...adoption } = input;
    return adoptSupervisedBootstrapAuthority(appClient, adoption);
  },
});
const carrierProtocolReady = await carrierProtocolBoot.start();
assert.equal(
  carrierProtocolReady.status,
  'ready',
  JSON.stringify(carrierProtocolReady),
);
assert.deepEqual(
  carrierProtocolAdoptionInputs[0]?.clientOptions,
  { devIdentityCapability },
  'the future native-reader result crosses only the internal client-option seam',
);
await carrierProtocolBoot.dispose();

const anonymousPlatform = Object.freeze({
  ...platform,
  databaseName: 'snapback-expo-auth-bootstrap-anonymous-test',
});
const anonymousSupervisor = { bearer: SUPERVISED_BEARER, events: [], diagnostics: [] };
const anonymousBoot = createSnapbackExpoBoot({
  app,
  environment: environmentFor(anonymousPlatform, anonymousSupervisor),
  adoptSupervisedSession: true,
  now: () => TEST_NOW_MS,
  async createApplicationClient(input, observer) {
    const appClient = await createSnapbackAppClientWithBootstrapObserver(input, observer);
    appClient.client.prepareReactBinding = async () => ({ source: 'deployment' });
    return appClient;
  },
  createProvider: fakeReactProvider,
  bindLifecycle: () => Object.freeze({ dispose() {}, async settled() {} }),
});
const anonymousReady = await anonymousBoot.start();
assert.equal(anonymousReady.status, 'ready');
assert.equal(anonymousReady.authoritySource, 'supervised-development');
assert.equal(anonymousBoot.appClient().auth.currentPrincipal().userId, USER_B);
assert.deepEqual(anonymousReady.advisories, []);

anonymousSupervisor.bearer = SUPERVISED_REMINT;
anonymousSupervisor.binding = Object.freeze({
  ...binding,
  provenance: Object.freeze({
    ...binding.provenance,
    issuedAt: '2026-08-15T10:00:00.000Z',
    expiresAt: '2026-08-15T11:00:00.000Z',
  }),
});
const bearerBeforeExpiredRemint = anonymousBoot.appClient().client.authCoordinator
  .credentialFor(anonymousBoot.appClient().client.authCoordinator.capture()).bearer;
const expiredRemint = await anonymousBoot.refreshAuthority();
assert.equal(expiredRemint.status, 'ready', 'an inadmissible remint leaves the live ready owner intact');
assert.equal(
  anonymousBoot.appClient().client.authCoordinator
    .credentialFor(anonymousBoot.appClient().client.authCoordinator.capture()).bearer,
  bearerBeforeExpiredRemint,
  'binding refusal happens before supervised bearer adoption',
);
assert.equal(
  anonymousSupervisor.diagnostics.at(-1)?.code,
  'SNAPBACK_APP_BINDING_EXPIRED',
  'the expired remint reports the existing typed binding refusal',
);
await anonymousBoot.dispose();

// New regression: a server-side one-shot refusal must never outrank adoption
// of the ordinary supervised session. This uses the resolver's default native
// environment path; the global installation models the missing reader and is
// intentionally confined to this protocol test.
const failedCheckoutNonce = `failed-checkout-${'f'.repeat(32)}`;
const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const previousCheckoutHook = globalThis.__SNAPBACK_EXPO_DEV_IDENTITY_CHECKOUT_NONCE__;
const checkoutDiagnostics = [];
let checkoutBootstraps = 0;
let refusedRedemptions = 0;
try {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    enumerable: true,
    value: Object.freeze({ product: 'ReactNative' }),
  });
  globalThis.__SNAPBACK_EXPO_DEV_IDENTITY_CHECKOUT_NONCE__ = failedCheckoutNonce;
  const failedCheckoutEnvironment = createSupervisedExpoEnvironment({
    exchangeOrigin: 'http://127.0.0.1:4321',
    bindingCache: null,
    onDiagnostic: (value) => checkoutDiagnostics.push(value),
    async fetch(url, options) {
      if (url.startsWith(`http://127.0.0.1:4321${SUPERVISED_EXCHANGE_PATH}`)) {
        const expectedUrl = options.method === 'GET'
          ? `http://127.0.0.1:4321${SUPERVISED_EXCHANGE_PATH}`
          : `http://127.0.0.1:4321${SUPERVISED_EXCHANGE_PATH}?authority=mint`;
        assert.equal(url, expectedUrl);
        checkoutBootstraps += 1;
        return Response.json({
          format: SUPERVISED_EXCHANGE_FORMAT,
          correlationId: 'failed-checkout-adoption',
          binding,
          authority: {
            status: 'ready',
            tokenType: 'Bearer',
            token: SUPERVISED_BEARER,
          },
        });
      }
      assert.equal(url, `http://127.0.0.1:4321${SUPERVISED_DEV_IDENTITY_CHECKOUT_PATH}`);
      assert.equal(options.method, 'POST');
      assert.equal(
        options.headers[SUPERVISED_DEV_IDENTITY_CHECKOUT_HEADER],
        failedCheckoutNonce,
      );
      refusedRedemptions += 1;
      return Response.json({
        ok: false,
        code: 'SNAPBACK_DEV_IDENTITY_REFUSED',
      }, { status: 403 });
    },
  });
  const checkoutAdmission = await failedCheckoutEnvironment.resolveBinding({
    app,
    signal: new AbortController().signal,
  });
  const checkoutAuthority = await failedCheckoutEnvironment.resolveSupervisedAuthority({
    app,
    binding: checkoutAdmission.binding,
    signal: new AbortController().signal,
  });
  assert.equal(checkoutAuthority.status, 'ready');
  assert.equal(checkoutAuthority.bearer, SUPERVISED_BEARER);
  assert.equal(checkoutAuthority.clientOptions, undefined);

  const adoptedAfterRefusal = await failedCheckoutEnvironment.adoptAuthority({
    app,
    binding: checkoutAdmission.binding,
    signal: new AbortController().signal,
  });
  assert.equal(adoptedAfterRefusal.status, 'ready');
  assert.equal(adoptedAfterRefusal.publicFacts.kind, 'session');
  assert.equal(adoptedAfterRefusal.publicFacts.userId, USER_B);
  assert.equal(
    await failedCheckoutEnvironment.resolveDevIdentityCapability(),
    null,
    'server-confirmed consumption degrades permanently for this JS boot',
  );
  assert.equal(refusedRedemptions, 1, 'a consumed checkout nonce is not retried');
  assert.equal(checkoutDiagnostics.length, 1, 'the local degradation is logged once');
  assert.equal(checkoutDiagnostics[0].code, 'SNAPBACK_EXPO_NATIVE_CHECKOUT_UNAVAILABLE');
  await adoptedAfterRefusal.dispose();
} finally {
  if (previousNavigator === undefined) delete globalThis.navigator;
  else Object.defineProperty(globalThis, 'navigator', previousNavigator);
  if (previousCheckoutHook === undefined) {
    delete globalThis.__SNAPBACK_EXPO_DEV_IDENTITY_CHECKOUT_NONCE__;
  } else {
    globalThis.__SNAPBACK_EXPO_DEV_IDENTITY_CHECKOUT_NONCE__ = previousCheckoutHook;
  }
}

assert.deepEqual(supervisor.events, ['boot', 'refresh', 'refresh', 'refresh', 'refresh']);
assert.deepEqual(
  adoptedSignoutSupervisor.events,
  ['binding', 'binding', 'mint'],
  'the real exchange performs one on-demand mint for the explicit web adoption',
);
assert.deepEqual(anonymousSupervisor.events, ['boot', 'refresh']);
assert.deepEqual(supervisor.diagnostics, []);
assert.deepEqual(adoptedSignoutSupervisor.diagnostics, []);
assert.deepEqual(
  anonymousSupervisor.diagnostics.map(({ code }) => code),
  ['SNAPBACK_APP_BINDING_EXPIRED'],
);
assert.equal(
  server.requests.some(({ path, bearer }) => (
    path === '/auth/session' && bearer === SUPERVISED_BEARER
  )),
  true,
);
assert.equal(
  server.requests.some(({ path, bearer }) => (
    path === '/auth/session' && bearer === SUPERVISED_REMINT
  )),
  true,
);

server.restore();
if (priorRqs === undefined) delete process.env.SNAPBACK_CLIENT_RQS_STORE;
else process.env.SNAPBACK_CLIENT_RQS_STORE = priorRqs;

console.log('provider-auth-bootstrap.test.mjs: DOM and DOM-less no-IndexedDB supervised-web runtime detection/custom-client zero-mint defaults, anonymous real-provider refresh handoff/resubscribe, password-session refresh preservation, revoked-route reuse refusal, real supervised-web provider adoption/signOut with mounted query, native client-option forwarding, and redeem-refusal adoption pass');
