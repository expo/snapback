import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import React, { StrictMode } from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { createSnapbackAppClient } from '@expo/snapback-client';
import { prepareReactBindingForClient } from '@expo/snapback-client/react-binding';

import {
  SnapbackProvider,
  useSnapbackAuth,
  useSnapbackCurrentPrincipal,
} from './index.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const APP_ID = '018f0d90-8c20-7a22-8c33-445566778899';
const INCARNATION = '018f0d90-8c21-7a22-8c33-445566778899';
const USER = '018f0d90-8c22-7a22-8c33-445566778899';
const SESSION = '018f0d90-8c23-7a22-8c33-445566778899';
const AUTHORITY = '018f0d90-8c24-7a22-8c33-445566778899';
const BEARER = 'sbs_react_auth_bootstrap_secret';
const PASSWORD = 'react-auth-password-secret';
const RECOVERY_CODES = Object.freeze(Array.from(
  { length: 8 },
  (_, index) => `sbrv1_${String(index).padStart(2, '0')}${'R'.repeat(25)}`,
));
const SCHEMA = `snapback.v1:sessions:schema:sha256:${'1'.repeat(64)}`;
const FUNCTIONS = `snapback.v1:sessions:function:sha256:${'2'.repeat(64)}`;
const INPUTS = `snapback.v1:sessions:inputs:sha256:${'3'.repeat(64)}`;
const DESCRIPTOR = `sha256:${'4'.repeat(64)}`;
const flush = () => new Promise((resolve) => setImmediate(resolve));

const app = Object.freeze({
  format: 'snapback.app.v1',
  identity: Object.freeze({
    app: APP_ID,
    schema: SCHEMA,
    functions: FUNCTIONS,
    descriptor: DESCRIPTOR,
  }),
  authBootstrap: Object.freeze({
    format: 'snapback.application-auth-bootstrap.v1',
    appId: APP_ID,
    mode: 'sessions',
    custody: 'volatile-explicit',
    entryMechanisms: Object.freeze(['password-v1']),
    anonymousPublic: 'refused',
    lifecycleProtocol: 1,
  }),
});

const binding = Object.freeze({
  format: 'snapback.app-binding.v1',
  source: 'supervised-dev',
  descriptorIdentity: DESCRIPTOR,
  target: Object.freeze({
    app: APP_ID,
    schema: SCHEMA,
    functions: FUNCTIONS,
    origin: 'http://127.0.0.1:4811',
    routing: 'loopback',
  }),
  capabilities: Object.freeze({ offered: Object.freeze(['auth.passwords']) }),
  provenance: Object.freeze({
    supervisorGeneration: 'react-auth-bootstrap-test',
    // Dynamic window: binding-expiry admission honors the boot clock, so a
    // hard-coded window rots the fixture (it did, on 2026-08-15).
    issuedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
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
  let handshakeFailure = null;
  let activeBearer = null;
  const session = () => ({
    protocolVersion: 1,
    serverStartupNonce: 'react-auth-bootstrap-test',
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
    authority: activeBearer === null
      ? { kind: 'anonymous', userId: null, sessionId: null, isAuthenticated: false }
      : { kind: 'humanSession', userId: USER, sessionId: SESSION, isAuthenticated: true },
    authorityDescriptor: {
      descriptorVersion: 1,
      authorityInstanceId: activeBearer === null ? INCARNATION : AUTHORITY,
      sessionGeneration: activeBearer === null ? 0 : 1,
    },
    deploymentIdentity: {
      schemaVersion: 'snapback.v1',
      authMode: 'sessions',
      appId: APP_ID,
      schemaHash: SCHEMA,
      bundleHash: FUNCTIONS,
      inputsHash: INPUTS,
    },
    authorizedLease: null,
  });
  const credential = (recovery = false) => ({
    tokenType: 'Bearer',
    token: BEARER,
    refreshAfter: Date.now() + 60_000,
    session: {
      id: SESSION,
      userId: USER,
      provider: 'local-password',
      createdAt: Date.now(),
      expiresAt: Date.now() + 120_000,
      absoluteExpiresAt: Date.now() + 240_000,
    },
    authorityDescriptor: {
      descriptorVersion: 1,
      authorityInstanceId: AUTHORITY,
      sessionGeneration: 1,
    },
    ...(recovery ? { recoveryCodes: [...RECOVERY_CODES] } : {}),
  });
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    requests.push({ path, method: init.method ?? 'GET' });
    if (path === '/auth/session') {
      if (handshakeFailure !== null) throw handshakeFailure;
      return Response.json(session());
    }
    if (path === '/auth/password/signin') {
      activeBearer = BEARER;
      return Response.json(credential());
    }
    if (path === '/auth/password/signup') {
      activeBearer = BEARER;
      return Response.json(credential(true));
    }
    if (path === '/auth/logout') {
      activeBearer = null;
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected React auth request: ${path}`);
  };
  return {
    requests,
    failHandshake(error) { handshakeFailure = error; },
    restore() { globalThis.fetch = originalFetch; },
  };
}

async function preparedBinding() {
  const functions = Object.freeze({
    artifactKind: 'functionManifest',
    schemaVersion: 'snapback.v0',
    appId: APP_ID,
    bundleHash: FUNCTIONS,
    functions: Object.freeze([]),
  });
  const schema = Object.freeze({
    artifactKind: 'schemaManifest',
    schemaVersion: 'snapback.v0',
    appId: APP_ID,
    schemaHash: SCHEMA,
    tables: Object.freeze([]),
    ephemeralCollections: Object.freeze([]),
  });
  const client = {
    liveQuery() {},
    async inspect() {
      return {
        targetProfileId: 'local-dev-sqlite-ibex',
        target: 'local',
        functions,
        schema,
        capabilityManifest: {
          artifactKind: 'capabilityManifest',
          schemaVersion: 'snapback.v0',
          targetProfileId: 'local-dev-sqlite-ibex',
          supportedCapabilities: [],
        },
      };
    },
    async authSession() { return { activeMode: 'sessions' }; },
    registerAuthBarrierParticipant() { return async () => {}; },
    liveStreamManager() { return { inspection: () => ({ socketDemand: 0 }) }; },
    async releaseConnection() {},
  };
  return prepareReactBindingForClient(client, { generatedManifest: functions });
}

const server = installAuthServer();
const priorRqs = process.env.SNAPBACK_CLIENT_RQS_STORE;
process.env.SNAPBACK_CLIENT_RQS_STORE = 'off';
const platform = Object.freeze({ kind: 'memory', cryptoObject: webcrypto });
const appClient = await createSnapbackAppClient({
  app,
  binding,
  platform,
});
const prepared = await preparedBinding();
appClient.client.prepareReactBinding = async () => prepared;

let observed = null;
let observedAuth = null;
function Probe() {
  observed = useSnapbackCurrentPrincipal();
  observedAuth = useSnapbackAuth();
  return null;
}

let renderer;
await act(async () => {
  renderer = TestRenderer.create(React.createElement(
    StrictMode,
    null,
    React.createElement(SnapbackProvider, { appClient }, React.createElement(Probe)),
  ));
  await flush();
  await flush();
});
assert.equal(observed.status, 'anonymous');
assert.strictEqual(observedAuth, appClient.auth);
assert.equal(server.requests.filter(({ path }) => path === '/auth/session').length, 1);

await act(async () => {
  renderer.update(React.createElement(
    StrictMode,
    null,
    React.createElement(
      React.Fragment,
      null,
      React.createElement(SnapbackProvider, { app, binding, platform }, React.createElement(Probe)),
      React.createElement(SnapbackProvider, { app, binding, platform }, React.createElement(Probe)),
    ),
  ));
  await flush();
  await flush();
});
const overlapping = await createSnapbackAppClient({
  app,
  binding,
  platform,
});
assert.strictEqual(overlapping.client, appClient.client);
assert.equal(server.requests.filter(({ path }) => path === '/auth/session').length, 1);
await overlapping.dispose();

assert.throws(
  () => SnapbackProvider({ appClient, binding: prepared }),
  (error) => error?.code === 'SNAPBACK_AUTH_BOOTSTRAP_INPUT_INVALID',
);
assert.throws(
  () => SnapbackProvider({ appClient, app }),
  (error) => error?.code === 'SNAPBACK_AUTH_BOOTSTRAP_INPUT_INVALID',
);

let signInResult;
await act(async () => {
  signInResult = await observedAuth.signInWithPassword({
    email: 'person@example.com',
    password: PASSWORD,
  });
  await flush();
});
assert.equal(signInResult.session.userId, USER);
assert.equal(Object.hasOwn(signInResult, 'token'), false);
assert.equal(observed.status, 'authenticated');

let releasePublication;
await act(async () => {
  releasePublication = appClient.client.__withholdCurrentPrincipalPublication();
  await flush();
});
assert.equal(observed.status, 'refreshing');
assert.equal(observed.principal.userId, USER);
await act(async () => {
  releasePublication();
  await flush();
});
assert.equal(observed.status, 'authenticated');

let signOutResult;
await act(async () => {
  signOutResult = await observedAuth.signOut();
  await flush();
});
assert.equal(signOutResult, null);
assert.equal(observed.status, 'anonymous');

let signUpResult;
await act(async () => {
  signUpResult = await observedAuth.signUpWithPassword({
    email: 'person@example.com',
    password: PASSWORD,
  });
  await flush();
});
assert.deepEqual(signUpResult.recoveryCodes, RECOVERY_CODES);
assert.equal(Object.hasOwn(signUpResult, 'token'), false);

const custodyError = Object.assign(new Error('test custody refusal'), {
  code: 'SNAPBACK_AUTH_CUSTODY_TEST',
});
server.failHandshake(custodyError);
await act(async () => {
  appClient.client.clearAuthSession();
  await flush();
});
assert.equal(observed.status, 'loading');
await act(async () => {
  await assert.rejects(appClient.client.auth.authSession({ force: true }), custodyError);
  await flush();
});
assert.equal(observed.status, 'blocked');
assert.equal(observed.diagnostic.details.causeCode, 'SNAPBACK_AUTH_CUSTODY_TEST');

await act(async () => {
  renderer.unmount();
  await flush();
});
await appClient.dispose();

let fallbackSnapshot = null;
await act(async () => {
  renderer = TestRenderer.create(React.createElement(SnapbackProvider, {
    app,
    binding,
    platform: { kind: 'unsupported-test-platform' },
    fallback(snapshot) {
      fallbackSnapshot = snapshot;
      return null;
    },
  }));
  await flush();
  await flush();
});
assert.equal(fallbackSnapshot.status, 'unsupported');
assert.equal(
  fallbackSnapshot.diagnostic.code,
  'SNAPBACK_AUTH_BOOTSTRAP_PLATFORM_UNSUPPORTED',
);
await act(async () => {
  renderer.unmount();
  await flush();
});
server.restore();
if (priorRqs === undefined) delete process.env.SNAPBACK_CLIENT_RQS_STORE;
else process.env.SNAPBACK_CLIENT_RQS_STORE = priorRqs;

console.log('auth-bootstrap.test.mjs: strict/remount owner, exclusivity, principal union, and auth facade projections pass');
