import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { IDBFactory } from 'fake-indexeddb';

import { createSnapbackAppClient } from '@expo/snapback-client';
import {
  adoptSupervisedBootstrapAuthority,
  createSnapbackAppClientWithBootstrapObserver,
} from '@expo/snapback-client/app-client-internal';

import {
  APPLICATION_AUTH_BOOTSTRAP_CAPABILITY,
  createSnapbackExpoBoot,
} from './provider.mjs';

const USER_A = '018f0d90-9c20-7a22-8c33-445566778899';
const USER_B = '018f0d90-9c21-7a22-8c33-445566778899';
const SESSION_A = '018f0d90-9c22-7a22-8c33-445566778899';
const SESSION_B = '018f0d90-9c23-7a22-8c33-445566778899';
const AUTHORITY_A = '018f0d90-9c24-7a22-8c33-445566778899';
const AUTHORITY_B = '018f0d90-9c25-7a22-8c33-445566778899';
const INCARNATION = '018f0d90-9c26-7a22-8c33-445566778899';
const APPLICATION_BEARER = 'sbs_expo_application_authority_secret';
const SUPERVISED_BEARER = 'sbs_expo_supervised_authority_secret';
const SUPERVISED_REMINT = 'sbs_expo_supervised_remint_secret';
const PASSWORD = 'expo-bootstrap-password-secret';
const TEST_NOW_MS = Date.now();

const generatedRoot = new URL(
  '../snapback-react/fixtures/conversation/app/snapback/generated/',
  import.meta.url,
);
const app = JSON.parse(readFileSync(new URL('app.descriptor.json', generatedRoot)));
app.authBootstrap.entryMechanisms = ['password-v1'];
app.authBootstrap.custody = 'durable-required';
app.capabilities.required = [
  ...app.capabilities.required,
  APPLICATION_AUTH_BOOTSTRAP_CAPABILITY,
];

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
  const bearers = new Map([
    [APPLICATION_BEARER, {
      userId: USER_A,
      sessionId: SESSION_A,
      authorityInstanceId: AUTHORITY_A,
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
  ]);
  const handshake = (bearer) => {
    const authenticated = bearers.get(bearer) ?? null;
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
  const credential = (token, record) => ({
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
  });
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const authorization = new Headers(init.headers).get('authorization');
    const bearer = authorization?.replace(/^Bearer /u, '') ?? null;
    requests.push({ path, bearer });
    if (path === '/auth/session') return Response.json(handshake(bearer));
    if (path === '/auth/password/signin') {
      return Response.json(credential(
        APPLICATION_BEARER,
        bearers.get(APPLICATION_BEARER),
      ));
    }
    if (path === '/auth/logout') return new Response(null, { status: 204 });
    throw new Error(`unexpected Expo auth request: ${path}`);
  };
  return {
    requests,
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

let seeded = await createSnapbackAppClient({
  app, binding, platform, now: () => Date.parse('2026-08-15T12:30:00.000Z'),
});
await seeded.auth.signInWithPassword({ email: 'application@example.com', password: PASSWORD });
await seeded.dispose();
seeded = null;

const devIdentityCapability = 'sbdev_provider_plumbing_test';
const supervisor = {
  bearer: SUPERVISED_BEARER,
  clientOptions: Object.freeze({ devIdentityCapability }),
  events: [],
  diagnostics: [],
};
const supervisedAdoptionInputs = [];
const boot = createSnapbackExpoBoot({
  app,
  environment: environmentFor(platform, supervisor),
  now: () => TEST_NOW_MS,
  async createApplicationClient(input, observer) {
    const appClient = await createSnapbackAppClientWithBootstrapObserver(input, observer);
    appClient.client.prepareReactBinding = async () => ({ source: 'deployment' });
    return appClient;
  },
  createProvider: fakeReactProvider,
  bindLifecycle: () => Object.freeze({ dispose() {}, async settled() {} }),
  async adoptSupervisedAuthority(appClient, input) {
    supervisedAdoptionInputs.push(input);
    return adoptSupervisedBootstrapAuthority(appClient, input);
  },
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
  supervisedAdoptionInputs[0]?.clientOptions,
  { devIdentityCapability },
  'supervised dev-identity custody is forwarded only through the client-option seam',
);
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
const applicationConflict = await boot.refreshAuthority();
assert.equal(applicationConflict.status, 'ready');
assert.equal(boot.appClient().auth.currentPrincipal().userId, USER_A);
assert.equal(applicationConflict.advisories[0].diagnostic.code,
  'SNAPBACK_AUTH_SUPERVISED_PRINCIPAL_CONFLICT');
await boot.dispose();

const anonymousPlatform = Object.freeze({
  ...platform,
  databaseName: 'snapback-expo-auth-bootstrap-anonymous-test',
});
const anonymousSupervisor = { bearer: SUPERVISED_BEARER, events: [], diagnostics: [] };
const anonymousBoot = createSnapbackExpoBoot({
  app,
  environment: environmentFor(anonymousPlatform, anonymousSupervisor),
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

assert.deepEqual(supervisor.events, ['boot', 'refresh', 'refresh', 'refresh', 'refresh']);
assert.deepEqual(anonymousSupervisor.events, ['boot', 'refresh']);
assert.deepEqual(supervisor.diagnostics, []);
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

console.log('provider-auth-bootstrap.test.mjs: durable precedence, anonymous adoption, refresh rebind-only, and signOut readmission pass');
