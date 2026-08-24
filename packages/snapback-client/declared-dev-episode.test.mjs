import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

import { SnapbackClient } from './index.mjs';
import { createSnapbackAppClient } from './app-client.mjs';
import { createDeclaredDevEpisodeGate } from './declared-dev-episode.mjs';
import {
  mintDeclaredDevCapability,
  unsafeInstallDeclaredDevCapabilityForGeneratedCode,
} from './declared-dev-capability.mjs';

const identity = Object.freeze({
  schemaVersion: 'snapback.v1',
  authMode: 'sessions',
  appId: 'fixture-app',
  schemaHash: 'snapback.v1:sessions:schema:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  bundleHash: 'snapback.v1:sessions:function:sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  inputsHash: 'snapback.v1:sessions:inputs:sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
});
const wrongIdentity = Object.freeze({ ...identity, inputsHash: identity.inputsHash.replace(/c+$/u, 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd') });
const fact = (deployment = identity) => ({
  formatVersion: 'snapback.app-identity.v1',
  deployment,
  admissionPosture: 'loopback-any',
});

const startFixture = async ({
  port = 0,
  deployment = identity,
  healthStatus = 200,
  liveStream = false,
  connectionOpenResetOnce = false,
} = {}) => {
  const requests = [];
  const sockets = new Set();
  let connectionOpenAttempts = 0;
  const server = createServer(async (request, response) => {
    const recorded = {
      method: request.method,
      path: request.url,
      headers: { ...request.headers },
      body: null,
    };
    requests.push(recorded);
    response.setHeader('content-type', 'application/json');
    response.setHeader('connection', 'close');
    if (request.url === '/_snapback/api/app/identity') {
      response.setHeader('cache-control', 'no-store');
      response.end(JSON.stringify(fact(deployment)));
      return;
    }
    if (request.url === '/connection/open') {
      let source = '';
      for await (const chunk of request) source += chunk;
      recorded.body = source === '' ? null : JSON.parse(source);
      connectionOpenAttempts += 1;
      if (connectionOpenResetOnce && connectionOpenAttempts === 1) {
        response.statusCode = 401;
        response.end(JSON.stringify({
          diagnostic: {
            code: 'SNAPBACK_AUTH_STREAM_RESET',
            message: 'fixture reset before retry',
            details: { retryable: true },
          },
        }));
        return;
      }
      response.end(JSON.stringify({
        connectionId: recorded.body?.connectionId ?? 'retry-connection',
        connectionToken: 'fixture-retry-token',
        wireVersion: recorded.body?.wireVersion ?? null,
      }));
      return;
    }
    response.statusCode = healthStatus;
    if (healthStatus >= 300 && healthStatus < 400) {
      response.setHeader('location', '/redirect-target');
    }
    response.end(JSON.stringify(healthStatus >= 200 && healthStatus < 300
      ? { ok: true }
      : { diagnostic: { code: 'FIXTURE_REFUSAL', message: 'fixture refusal' } }));
  });
  server.on('upgrade', (request, socket) => {
    requests.push({
      method: 'UPGRADE',
      path: request.url,
      headers: { ...request.headers },
    });
    if (!liveStream || typeof request.headers['sec-websocket-key'] !== 'string') {
      socket.destroy();
      return;
    }
    const accept = createHash('sha1')
      .update(`${request.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      'Sec-WebSocket-Protocol: snapback.v1',
      '',
      '',
    ].join('\r\n'));
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    port: address.port,
    requests,
    close: () => new Promise((resolve, reject) => {
      for (const socket of sockets) socket.destroy();
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
};

const until = async (predicate, label, timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  assert(predicate(), `timed out waiting for ${label}`);
};

const startAuthFixture = async () => {
  const requests = [];
  const credentials = new Map();
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({
      path: request.url,
      headers: { ...request.headers },
      body: body === '' ? null : JSON.parse(body),
    });
    response.setHeader('content-type', 'application/json');
    if (request.url === '/_snapback/api/app/identity') {
      response.end(JSON.stringify(fact()));
      return;
    }
    if (request.url === '/auth/session') {
      const bearer = request.headers.authorization?.replace(/^Bearer /u, '') ?? null;
      const credential = bearer === null ? null : credentials.get(bearer) ?? null;
      response.end(JSON.stringify({
        protocolVersion: 1,
        serverStartupNonce: 'declared-dev-auth-fixture',
        authorizationStreamIncarnation: '018f0d90-8c21-7a22-8c33-445566778899',
        transitionGeneration: 0,
        activeMode: 'sessions',
        desiredMode: 'sessions',
        modeState: 'settled',
        appDataAvailability: 'available',
        quarantineCode: null,
        clientProtocols: { authClient: 1, authInvalidation: 1, authorityDescriptor: 1, authorizedLease: null },
        availability: {
          onlineRequestResponse: { available: true, reason: null },
          authScopedLive: { available: true, minimumAuthInvalidationProtocol: 1, reason: null },
          retainedReads: { available: false, minimumAuthInvalidationProtocol: 1, minimumAuthorizedLeaseProtocol: 1, reason: 'fixture' },
          queuedReplay: { available: true, minimumAuthorityDescriptorProtocol: 1, reason: null },
        },
        provider: { key: 'local-password', available: true },
        transports: ['bearer'],
        authority: credential === null
          ? { kind: 'anonymous', userId: null, sessionId: null, isAuthenticated: false }
          : {
              kind: 'humanSession',
              userId: credential.session.userId,
              sessionId: credential.session.id,
              isAuthenticated: true,
            },
        authorityDescriptor: credential?.authorityDescriptor
          ?? { descriptorVersion: 1, authorityInstanceId: '018f0d90-8c21-7a22-8c33-445566778899', sessionGeneration: 0 },
        deploymentIdentity: identity,
        authorizedLease: null,
      }));
      return;
    }
    if (request.url === '/auth/password/signup') {
      const suffix = requests.filter(({ path }) => path === '/auth/password/signup').length;
      const credential = {
        tokenType: 'Bearer',
        token: `sbs_declared_dev_fixture_${suffix}`,
        refreshAfter: Date.now() + 60_000,
        session: {
          id: `018f0d90-8c2${suffix}-7a22-8c33-445566778899`,
          userId: `018f0d90-8d2${suffix}-7a22-8c33-445566778899`,
          provider: 'local-password',
          createdAt: Date.now(),
          expiresAt: Date.now() + 120_000,
          absoluteExpiresAt: Date.now() + 240_000,
        },
        authorityDescriptor: {
          descriptorVersion: 1,
          authorityInstanceId: `018f0d90-8e2${suffix}-7a22-8c33-445566778899`,
          sessionGeneration: 1,
        },
        recoveryCodes: Array.from({ length: 8 }, (_, index) => `sbrv1_${String(index).padStart(2, '0')}${'R'.repeat(25)}`),
      };
      credentials.set(credential.token, credential);
      response.end(JSON.stringify(credential));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ diagnostic: { code: 'FIXTURE_NOT_FOUND', message: request.url } }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
};

const nativeFetch = globalThis.fetch;
const observedIdentityFetches = [];
const observedHealthFetches = [];
globalThis.fetch = (input, options) => {
  const requested = String(input);
  if (requested.endsWith('/_snapback/api/app/identity')) {
    observedIdentityFetches.push(structuredClone(options));
  }
  if (requested.endsWith('/health')) {
    observedHealthFetches.push(structuredClone(options));
  }
  if (requested.startsWith('https://release.example/') && authFixture !== undefined) {
    const url = new URL(requested);
    return nativeFetch(`${authFixture.origin}${url.pathname}${url.search}`, options);
  }
  return nativeFetch(input, options);
};

let first;
let replacement;
let streamed;
let streamDemandRelease;
let httpOnly;
let retryClient;
let retryDemandRelease;
let redirectFixture;
let redirectClient;
let siblingFixture;
let siblingClient;
let siblingReleaseA;
let siblingReleaseB;
let authFixture;
try {
  first = await startFixture({ liveStream: true });
  streamed = new SnapbackClient(first.origin, {
    rqsStore: null,
    offlineQueue: false,
    declaredDevDeploymentIdentity: identity,
  });
  streamed.authSession = async () => null;
  streamed.connectionGrant = async () => Object.freeze({
    id: 'declared-live',
    token: 'fixture-connection-token',
    wireVersion: null,
  });
  streamed.refreshConnectionGrant = streamed.connectionGrant;
  const streamStates = [];
  const manager = streamed.liveStreamManager('declared-live', {
    heartbeatIntervalMs: 60_000,
    freshnessBudgetMs: 60_000,
    reconnectBaseDelayMs: 5,
    reconnectMaxDelayMs: 20,
  });
  streamDemandRelease = manager.onState((state, detail) => streamStates.push({ state, detail }));
  await until(() => manager.inspection().open, 'open declared-development live stream');
  assert(first.requests.some(({ method }) => method === 'UPGRADE'));
  assert.equal(observedIdentityFetches[0].cache, 'no-store');
  assert.equal(observedIdentityFetches[0].credentials, 'omit');
  assert.equal(observedIdentityFetches[0].redirect, 'manual');
  assert.equal(Object.hasOwn(observedIdentityFetches[0].headers, 'origin'), false);
  assert.equal(Object.keys(observedIdentityFetches[0].headers).some((name) => /^if-/iu.test(name)), false);

  const port = first.port;
  await first.close();
  first = null;
  replacement = await startFixture({ port, deployment: wrongIdentity });
  await until(
    () => streamStates.some(({ state, detail }) => (
      state === 'closed' && detail.code === 'SNAPBACK_APP_BINDING_IDENTITY_MISMATCH'
    )),
    'terminal identity mismatch after live-stream drop',
  );
  assert.deepEqual(replacement.requests.map(({ path }) => path), [
    '/_snapback/api/app/identity',
  ], 'replacement receives no grant, signup, or credentialed call after the open stream drops');

  await replacement.close();
  replacement = await startFixture({ port, deployment: identity });
  httpOnly = new SnapbackClient(replacement.origin, {
    rqsStore: null,
    offlineQueue: false,
    declaredDevDeploymentIdentity: identity,
  });
  await httpOnly.health();
  const paths = replacement.requests.map(({ path }) => path);
  assert.equal(paths.filter((path) => path === '/_snapback/api/app/identity').length, 1);
  assert.equal(paths.filter((path) => path === '/health').length, 1);
  assert(paths.indexOf('/_snapback/api/app/identity') < paths.indexOf('/health'));
  await replacement.close();
  replacement = await startFixture({ port, deployment: wrongIdentity });
  await assert.rejects(
    httpOnly.health(),
    (error) => error.code === 'SNAPBACK_APP_BINDING_IDENTITY_MISMATCH',
  );
  assert.deepEqual(
    replacement.requests.map(({ path }) => path),
    ['/_snapback/api/app/identity'],
    'HTTP-only replacement is caught by per-operation preflight without an intervening failed call',
  );

  await replacement.close();
  replacement = await startFixture({
    port,
    deployment: identity,
    liveStream: true,
    connectionOpenResetOnce: true,
  });
  retryClient = new SnapbackClient(replacement.origin, {
    rqsStore: null,
    offlineQueue: false,
    authInvalidationProtocol: null,
    authorityDescriptorProtocol: null,
    ephemeralExpiryProtocol: null,
    declaredDevDeploymentIdentity: identity,
  });
  retryClient.authSession = async () => null;
  const retryStates = [];
  const retryManager = retryClient.liveStreamManager('retry-connection', {
    heartbeatIntervalMs: 60_000,
    freshnessBudgetMs: 60_000,
    reconnectBaseDelayMs: 5,
    reconnectMaxDelayMs: 20,
  });
  retryDemandRelease = retryManager.onState((state) => retryStates.push(state));
  await until(() => retryManager.inspection().open, 'live stream after connection-open reset');
  assert.equal(retryManager.inspection().open, true);
  assert.equal(retryStates.filter((state) => state === 'lost').length, 0);
  assert.deepEqual(
    replacement.requests.map(({ path }) => path),
    [
      '/_snapback/api/app/identity',
      '/connection/open',
      '/_snapback/api/app/identity',
      '/connection/open',
      '/live/retry-connection/stream',
    ],
    'the failed non-2xx call is re-verified before retry and the same stream epoch opens',
  );

  redirectFixture = await startFixture({ deployment: identity, healthStatus: 301 });
  redirectClient = new SnapbackClient(redirectFixture.origin, {
    rqsStore: null,
    offlineQueue: false,
    declaredDevDeploymentIdentity: identity,
  });
  await assert.rejects(redirectClient.health());
  await assert.rejects(redirectClient.health());
  assert.equal(observedHealthFetches.at(-1).redirect, 'manual');
  assert.deepEqual(
    redirectFixture.requests.map(({ path }) => path),
    [
      '/_snapback/api/app/identity',
      '/health',
      '/_snapback/api/app/identity',
      '/health',
    ],
    'a manual 301 un-verifies the episode and the next health call re-verifies',
  );

  siblingFixture = await startFixture({ deployment: identity, liveStream: true });
  siblingClient = new SnapbackClient(siblingFixture.origin, {
    rqsStore: null,
    offlineQueue: false,
    declaredDevDeploymentIdentity: identity,
  });
  siblingClient.authSession = async () => null;
  siblingClient.connectionGrant = async (connectionId) => Object.freeze({
    id: connectionId,
    token: `fixture-${connectionId}-token`,
    wireVersion: null,
  });
  siblingClient.refreshConnectionGrant = siblingClient.connectionGrant;
  const siblingStatesA = [];
  const siblingStatesB = [];
  const siblingManagerA = siblingClient.liveStreamManager('sibling-a', {
    heartbeatIntervalMs: 60_000,
    freshnessBudgetMs: 60_000,
    reconnectBaseDelayMs: 5,
    reconnectMaxDelayMs: 20,
  });
  const siblingManagerB = siblingClient.liveStreamManager('sibling-b', {
    heartbeatIntervalMs: 60_000,
    freshnessBudgetMs: 60_000,
    reconnectBaseDelayMs: 5,
    reconnectMaxDelayMs: 20,
  });
  siblingReleaseA = siblingManagerA.onState((state) => siblingStatesA.push(state));
  siblingReleaseB = siblingManagerB.onState((state) => siblingStatesB.push(state));
  await until(
    () => siblingManagerA.inspection().open && siblingManagerB.inspection().open,
    'two interleaved standing-stream managers',
  );
  assert.equal(siblingStatesA.includes('lost'), false);
  assert.equal(siblingStatesB.includes('lost'), false);
  const identityFetchesBeforeSiblingCleanup = siblingFixture.requests
    .filter(({ path }) => path === '/_snapback/api/app/identity').length;
  siblingReleaseA();
  siblingReleaseA = null;
  await siblingClient.health();
  assert.equal(siblingManagerB.inspection().open, true);
  assert.equal(
    siblingFixture.requests.filter(({ path }) => path === '/_snapback/api/app/identity').length,
    identityFetchesBeforeSiblingCleanup,
    'cleanup of a stale sibling token cannot un-verify the current stream epoch',
  );

  for (const [name, malformed] of [
    ['formatVersion-wrong-or-missing', { deployment: identity, admissionPosture: 'loopback-any' }],
    ['deployment-missing-or-digest-incomplete', { formatVersion: 'snapback.app-identity.v1', admissionPosture: 'loopback-any' }],
    ['deployment-missing-or-digest-incomplete', { ...fact(), deployment: { ...identity, inputsHash: '' } }],
    ['admissionPosture-missing-or-invalid', { formatVersion: 'snapback.app-identity.v1', deployment: identity }],
  ]) {
    const gate = createDeclaredDevEpisodeGate({
      origin: 'http://127.0.0.1:4287',
      expectedDeploymentIdentity: identity,
      fetch: async () => new Response(JSON.stringify(malformed), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    });
    await assert.rejects(
      gate.ensureVerified(),
      (error) => error.code === 'SNAPBACK_APP_IDENTITY_FACT_INVALID'
        && error.diagnostic.details.reason === name,
    );
  }

  authFixture = await startAuthFixture();
  const generatedApp = {
    format: 'snapback.app.v1',
    identity: {
      app: identity.appId,
      schema: identity.schemaHash,
      functions: identity.bundleHash,
      descriptor: `sha256:${'d'.repeat(64)}`,
    },
    authBootstrap: {
      format: 'snapback.application-auth-bootstrap.v1',
      appId: identity.appId,
      mode: 'sessions',
      custody: 'volatile-explicit',
      entryMechanisms: ['password-v1'],
      anonymousPublic: 'refused',
      lifecycleProtocol: 1,
    },
    capabilities: { required: ['auth.application-bootstrap.v1'] },
  };
  unsafeInstallDeclaredDevCapabilityForGeneratedCode(generatedApp, identity);
  Object.freeze(generatedApp);
  const releaseApp = { ...generatedApp };
  Object.defineProperty(releaseApp, 'declaredDev', { value: null, enumerable: false });
  Object.freeze(releaseApp);
  const releaseBinding = Object.freeze({
    format: 'snapback.app-binding.v1',
    source: 'release',
    descriptorIdentity: generatedApp.identity.descriptor,
    target: Object.freeze({
      app: generatedApp.identity.app,
      schema: generatedApp.identity.schema,
      functions: generatedApp.identity.functions,
      origin: 'https://release.example',
      routing: 'https',
    }),
    capabilities: Object.freeze({ offered: Object.freeze([
      'auth.application-bootstrap.v1',
      'auth.passwords',
    ]) }),
    provenance: Object.freeze({
      environment: 'production',
      releaseChannel: 'stable',
      buildReceipt: 'fixture-release-receipt',
    }),
    integrity: Object.freeze({ channel: 'embedded-at-build' }),
  });
  const releaseStart = authFixture.requests.length;
  const viteDiagnostics = [];
  const previousViteUrl = process.env.VITE_SNAPBACK_URL;
  process.env.VITE_SNAPBACK_URL = authFixture.origin;
  const releaseClient = await createSnapbackAppClient({
    app: releaseApp,
    binding: releaseBinding,
    url: process.env.VITE_SNAPBACK_URL,
    platform: { kind: 'memory', cryptoObject: globalThis.crypto },
    rqsStore: null,
    onDiagnostic: (event) => viteDiagnostics.push(event),
  });
  assert.equal(authFixture.requests[releaseStart].path, '/auth/session');
  assert.equal(
    authFixture.requests.slice(releaseStart).some(({ path }) => path === '/_snapback/api/app/identity'),
    false,
  );
  assert(viteDiagnostics.some((event) => (
    event.schemaVersion === 'snapback.client-debug-event.v1'
    && event.event === 'snapback.declared-dev-url-ignored'
    && !Object.hasOwn(event, 'code')
  )));
  await releaseClient.dispose();
  const undefinedUrlClient = await createSnapbackAppClient({
    app: releaseApp,
    binding: releaseBinding,
    url: undefined,
    platform: { kind: 'memory', cryptoObject: globalThis.crypto },
    rqsStore: null,
  });
  await undefinedUrlClient.dispose();
  await assert.rejects(
    createSnapbackAppClient({
      app: releaseApp,
      url: '',
      platform: { kind: 'memory', cryptoObject: globalThis.crypto },
      rqsStore: null,
    }),
    (error) => error.code === 'SNAPBACK_APP_BINDING_UNAVAILABLE'
      && error.message.includes('url option'),
  );
  if (previousViteUrl === undefined) delete process.env.VITE_SNAPBACK_URL;
  else process.env.VITE_SNAPBACK_URL = previousViteUrl;
  await assert.rejects(
    createSnapbackAppClient({
      app: generatedApp,
      declaredDevCapability: mintDeclaredDevCapability(identity),
      url: authFixture.origin,
      platform: { kind: 'memory', cryptoObject: globalThis.crypto },
      rqsStore: null,
    }),
    (error) => error.code === 'SNAPBACK_APP_BINDING_DECLARED_DEV_REFUSED',
  );
  await assert.rejects(
    createSnapbackAppClient({
      app: generatedApp,
      binding: {
        format: 'snapback.app-binding.v1',
        source: 'declared-dev',
        descriptorIdentity: generatedApp.identity.descriptor,
        target: {
          app: generatedApp.identity.app,
          schema: generatedApp.identity.schema,
          functions: generatedApp.identity.functions,
          origin: authFixture.origin,
          routing: 'declared-dev',
        },
        capabilities: { offered: ['auth.application-bootstrap.v1', 'auth.passwords'] },
        provenance: { deploymentIdentity: identity },
        integrity: { channel: 'generated-declared-dev' },
      },
      platform: { kind: 'memory', cryptoObject: globalThis.crypto },
      rqsStore: null,
    }),
    (error) => error.code === 'SNAPBACK_APP_BINDING_DECLARED_DEV_REFUSED',
  );
  const principalIds = [];
  for (const context of ['browser-context-a', 'browser-context-b']) {
    const start = authFixture.requests.length;
    const appClient = await createSnapbackAppClient({
      app: generatedApp,
      url: authFixture.origin,
      platform: { kind: 'memory', cryptoObject: globalThis.crypto },
      storagePartition: context,
      rqsStore: null,
    });
    const signup = await appClient.auth.signUpWithPassword({
      email: `${context}@example.com`,
      password: 'fixture-password',
    });
    principalIds.push(signup.session.userId);
    const paths = authFixture.requests.slice(start).map(({ path }) => path);
    assert.equal(paths[0], '/_snapback/api/app/identity');
    assert(paths.indexOf('/_snapback/api/app/identity') < paths.indexOf('/auth/session'));
    assert(paths.indexOf('/_snapback/api/app/identity') < paths.indexOf('/auth/password/signup'));
    await appClient.dispose();
  }
  assert.notEqual(principalIds[0], principalIds[1]);
  for (const request of authFixture.requests.filter(({ path }) => path === '/_snapback/api/app/identity')) {
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.headers.origin, undefined);
  }
} finally {
  globalThis.fetch = nativeFetch;
  await Promise.allSettled([
    streamed?.close?.(),
    Promise.resolve(streamDemandRelease?.()),
    Promise.resolve(retryDemandRelease?.()),
    Promise.resolve(siblingReleaseA?.()),
    Promise.resolve(siblingReleaseB?.()),
    httpOnly?.close?.(),
    retryClient?.close?.(),
    redirectClient?.close?.(),
    siblingClient?.close?.(),
    first?.close?.(),
    replacement?.close?.(),
    redirectFixture?.close?.(),
    siblingFixture?.close?.(),
    authFixture?.close?.(),
  ]);
}

console.log('declared-dev-episode.test.mjs: open-stream and HTTP-only replacement gates, reset and sibling stream epochs, redirect invalidation, app auth, and release URL-ignore pass');
