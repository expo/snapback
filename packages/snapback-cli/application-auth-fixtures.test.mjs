import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { IDBFactory } from 'fake-indexeddb';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { createSnapbackAppClient } from '@expo/snapback-client';
import { generateApp } from './index.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageRoot, '..', '..');
const fixtureSource = join(repoRoot, 'tests', 'fixtures', 'application-auth');
const root = mkdtempSync(join(tmpdir(), 'snapback-application-auth-fixtures-'));
const fixtureRoot = join(root, 'application-auth');
cpSync(fixtureSource, fixtureRoot, { recursive: true });
const fixtureModules = join(root, 'node_modules');
mkdirSync(join(fixtureModules, '@expo'), { recursive: true });
for (const packageName of ['snapback-client', 'snapback-expo', 'snapback-react']) {
  symlinkSync(
    join(repoRoot, 'packages', packageName),
    join(fixtureModules, '@expo', packageName),
    'dir',
  );
}
const packageLocalReact = join(
  repoRoot,
  'packages',
  'snapback-react',
  'node_modules',
  'react',
);
symlinkSync(
  existsSync(packageLocalReact) ? packageLocalReact : join(repoRoot, 'node_modules', 'react'),
  join(fixtureModules, 'react'),
  'dir',
);
const priorRqsStore = process.env.SNAPBACK_CLIENT_RQS_STORE;
process.env.SNAPBACK_CLIENT_RQS_STORE = 'off';

after(() => {
  if (priorRqsStore === undefined) delete process.env.SNAPBACK_CLIENT_RQS_STORE;
  else process.env.SNAPBACK_CLIENT_RQS_STORE = priorRqsStore;
  rmSync(root, { recursive: true, force: true });
});

const FIXTURES = Object.freeze([
  { name: 'browser-explicit', platform: 'browser', profile: 'snapback-explicit-v1' },
  { name: 'expo-explicit', platform: 'expo-web', profile: 'snapback-explicit-v1' },
  { name: 'browser-familiar', platform: 'browser', profile: 'snapback-familiar-ts-v1' },
  { name: 'expo-familiar', platform: 'expo-web', profile: 'snapback-familiar-ts-v1' },
]);
const TEST_NOW = Date.parse('2026-08-16T12:30:00.000Z');
const USER = '018f0d90-8c22-7a22-8c33-445566778899';
const SESSION = '018f0d90-8c23-7a22-8c33-445566778899';
const AUTHORITY = '018f0d90-8c24-7a22-8c33-445566778899';
const ANONYMOUS_AUTHORITY = '018f0d90-8c25-7a22-8c33-445566778899';
const INCARNATION = '018f0d90-8c21-7a22-8c33-445566778899';
const BEARER = 'sbs_clean_application_fixture_secret';
const RECOVERY_CODES = Object.freeze(Array.from(
  { length: 8 },
  (_, index) => `sbrv1_${String(index).padStart(2, '0')}${'R'.repeat(25)}`,
));
const flush = () => new Promise((resolveFlush) => setImmediate(resolveFlush));

function bindingFor(app, name, now) {
  const port = 4918 + FIXTURES.findIndex((fixture) => fixture.name === name);
  return Object.freeze({
    format: 'snapback.app-binding.v1',
    source: 'supervised-dev',
    descriptorIdentity: app.identity.descriptor,
    target: Object.freeze({
      app: app.identity.app,
      schema: app.identity.schema,
      functions: app.identity.functions,
      origin: `http://127.0.0.1:${port}`,
      routing: 'loopback',
    }),
    capabilities: Object.freeze({
      offered: Object.freeze([...new Set([
        ...app.capabilities.required,
        'auth.passwords',
      ])].sort()),
    }),
    provenance: Object.freeze({
      supervisorGeneration: `application-auth-fixture-${name}`,
      issuedAt: new Date(now - 60_000).toISOString(),
      expiresAt: new Date(now + 60 * 60_000).toISOString(),
    }),
    integrity: Object.freeze({ channel: 'local-supervised-ipc' }),
  });
}

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

function installServer({ app, generated }) {
  const originalFetch = globalThis.fetch;
  const requests = [];
  let activeBearer = null;
  const session = () => ({
    protocolVersion: 1,
    serverStartupNonce: 'application-auth-fixture',
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
      authorityInstanceId: activeBearer === null ? ANONYMOUS_AUTHORITY : AUTHORITY,
      sessionGeneration: activeBearer === null ? 0 : 1,
    },
    deploymentIdentity: {
      schemaVersion: generated.schemaManifest.schemaVersion,
      authMode: 'sessions',
      appId: app.identity.app,
      schemaHash: app.identity.schema,
      bundleHash: app.identity.functions,
      inputsHash: generated.schemaManifest.inputsHash,
    },
    authorizedLease: null,
  });
  const credential = (includeRecovery) => ({
    tokenType: 'Bearer',
    token: BEARER,
    refreshAfter: TEST_NOW + 60_000,
    session: {
      id: SESSION,
      userId: USER,
      provider: 'local-password',
      createdAt: TEST_NOW,
      expiresAt: TEST_NOW + 120_000,
      absoluteExpiresAt: TEST_NOW + 240_000,
    },
    authorityDescriptor: {
      descriptorVersion: 1,
      authorityInstanceId: AUTHORITY,
      sessionGeneration: 1,
    },
    ...(includeRecovery ? { recoveryCodes: [...RECOVERY_CODES] } : {}),
  });

  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    requests.push(Object.freeze({ path, method: init.method ?? 'GET' }));
    if (path === '/inspect') {
      return Response.json({
        target: 'local',
        targetProfileId: 'local-dev-sqlite-ibex',
        schema: generated.schemaManifest,
        functions: generated.functionManifest,
        capabilityManifest: generated.capabilityManifest,
      });
    }
    if (path === '/auth/session') return Response.json(session());
    if (path === '/auth/password/signup') {
      activeBearer = BEARER;
      return Response.json(credential(true));
    }
    if (path === '/auth/password/signin') {
      activeBearer = BEARER;
      return Response.json(credential(false));
    }
    if (path === '/auth/logout') {
      activeBearer = null;
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected clean application fixture request: ${init.method ?? 'GET'} ${path}`);
  };
  return Object.freeze({
    requests,
    restore() { globalThis.fetch = originalFetch; },
  });
}

function appStateSource() {
  return Object.freeze({
    currentState: 'active',
    addEventListener() { return Object.freeze({ remove() {} }); },
  });
}

function expoEnvironment(binding, platform, diagnostics) {
  const admission = Object.freeze({
    productionCondition: false,
    delivery: Object.freeze({ channel: 'local-supervised-ipc' }),
  });
  return Object.freeze({
    format: 'snapback.expo-environment.v1',
    appState: appStateSource(),
    resolveAppClientPlatform: async () => platform,
    resolveBinding: async () => ({ binding, admission }),
    resolveSupervisedAuthority: async () => ({ status: 'unavailable' }),
    async adoptAuthority() {
      throw new Error('clean opted-in fixture must not call legacy adoptAuthority');
    },
    onDiagnostic(diagnostic) { diagnostics.push(diagnostic); },
  });
}

async function generateFixture(definition) {
  const applicationRoot = join(fixtureRoot, definition.name, 'application');
  const backendRoot = join(applicationRoot, 'snapback');
  const generated = await generateApp(backendRoot);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  const module = await import(`${pathToFileURL(join(applicationRoot, 'App.mjs')).href}?fixture=${definition.name}`);
  return Object.freeze({ definition, applicationRoot, backendRoot, generated, module, app: module.app });
}

async function journey(fixture) {
  const { app, definition, generated, module } = fixture;
  assert.equal(app.authoringProfile, definition.profile);
  assert.equal(app.authBootstrap.format, 'snapback.application-auth-bootstrap.v1');
  assert.equal(app.authBootstrap.custody, 'durable-required');
  assert.deepEqual(app.authBootstrap.entryMechanisms, ['password-v1']);
  assert(app.capabilities.required.includes('auth.application-bootstrap.v1'));

  const journeyNow = Date.now();
  const binding = bindingFor(app, definition.name, journeyNow);
  const indexedDB = new IDBFactory();
  const platform = Object.freeze({
    kind: definition.platform,
    indexedDB,
    lockManager: Object.freeze({ request: (_name, _options, operation) => operation() }),
    cryptoObject: webcrypto,
    databaseName: `snapback-${definition.name}`,
  });
  const server = installServer({ app, generated });
  const hadSupervisorOrigin = Object.hasOwn(
    globalThis,
    '__SNAPBACK_EXPO_SUPERVISOR_ORIGIN__',
  );
  const priorSupervisorOrigin = globalThis.__SNAPBACK_EXPO_SUPERVISOR_ORIGIN__;
  let latest = null;
  const diagnostics = [];
  let appClient = null;
  let expoHarnessProjection = null;
  let renderer = null;
  try {
    if (definition.platform === 'browser') {
      const application = await module.createApplication({
        binding,
        platform,
        now: () => journeyNow,
        onSnapshot: (snapshot) => { latest = snapshot; },
      });
      appClient = application.appClient;
      const prepared = await appClient.client.prepareReactBinding({ generatedManifest: app });
      // The application still constructs exclusively through the published
      // owner/provider surfaces. The fake server harness freezes the already
      // real-prepared binding so provider startup does not open a second
      // inspection/receipt lease against the same in-process fake target.
      appClient.client.prepareReactBinding = async () => prepared;
      await act(async () => {
        renderer = TestRenderer.create(application.element);
        for (let index = 0; index < 100 && latest === null; index += 1) await flush();
      });
      assert.equal(appClient.bootstrapState().status, 'ready');
      assert.equal(appClient.bootstrapState().custody.carrier, 'indexeddb-web-locks');
    } else {
      // The injected rendezvous signal, not an optional environment method,
      // is the provider's configured/absent source of truth.
      globalThis.__SNAPBACK_EXPO_SUPERVISOR_ORIGIN__ = binding.target.origin;
      expoHarnessProjection = await createSnapbackAppClient({
        app,
        binding,
        platform,
        now: () => journeyNow,
        rqsStore: null,
      });
      const prepared = await expoHarnessProjection.client.prepareReactBinding({
        generatedManifest: app,
      });
      expoHarnessProjection.client.prepareReactBinding = async () => prepared;
      await act(async () => {
        renderer = TestRenderer.create(React.createElement(module.Application, {
          environment: expoEnvironment(binding, platform, diagnostics),
          onSnapshot: (snapshot) => { latest = snapshot; },
        }));
        await flush();
        await flush();
        await flush();
        for (let index = 0; index < 40 && latest === null; index += 1) {
          await new Promise((resolveWait) => setTimeout(resolveWait, 10));
        }
      });
    }
    assert.equal(
      latest?.principal.status,
      'anonymous',
      `${definition.name}: ${JSON.stringify({ tree: renderer.toJSON(), diagnostics })}`,
    );

    const click = async (action) => {
      await act(async () => {
        await renderer.root.findByProps({ 'data-action': action }).props.onClick();
        await flush();
        await flush();
      });
    };

    await click('signup');
    assert.equal(latest.principal.status, 'authenticated');
    assert.equal(latest.principal.userId, USER);
    assert.deepEqual(latest.recoveryCodes, RECOVERY_CODES);
    assert.equal(renderer.root.findAllByProps({ 'data-fixture': 'recovery-codes' }).length, 1);

    await click('signout');
    assert.equal(latest.principal.status, 'anonymous');
    assert.equal(latest.recoveryCodes, null);
    assert.equal(renderer.root.findAllByProps({ 'data-fixture': 'recovery-codes' }).length, 0);

    await click('signin');
    assert.equal(latest.principal.status, 'authenticated');
    assert.equal(latest.principal.userId, USER);
    assert.equal(latest.recoveryCodes, null);

    await click('signout');
    assert.equal(latest.principal.status, 'anonymous');
    return Object.freeze({
      requests: server.requests.map(({ path, method }) => ({ path, method })),
      custody: definition.platform === 'browser'
        ? appClient.bootstrapState().custody
        : expoHarnessProjection.bootstrapState().custody,
    });
  } finally {
    if (renderer !== null) {
      await act(async () => {
        renderer.unmount();
        await flush();
      });
    }
    await appClient?.dispose();
    await expoHarnessProjection?.dispose();
    if (hadSupervisorOrigin) {
      globalThis.__SNAPBACK_EXPO_SUPERVISOR_ORIGIN__ = priorSupervisorOrigin;
    } else {
      delete globalThis.__SNAPBACK_EXPO_SUPERVISOR_ORIGIN__;
    }
    server.restore();
  }
}

function runtimeClientCustodyRows(generated) {
  const rows = generated.clientLifecycleManifest.rows;
  return {
    authEntryMechanisms: rows.authEntryMechanisms,
    authRecoveryLifecycle: rows.authRecoveryLifecycle,
    authCustodyPlatforms: rows.authCustodyPlatforms,
    authBootstrapState: rows.authBootstrapState,
    authOwnership: rows.authOwnership,
    authSupervisedPrecedence: rows.authSupervisedPrecedence,
  };
}

test('four clean generated applications prove the ordinary auth journey and profile parity', async () => {
  const fixtures = [];
  for (const definition of FIXTURES) fixtures.push(await generateFixture(definition));

  const byName = new Map(fixtures.map((fixture) => [fixture.definition.name, fixture]));
  for (const fixture of fixtures) {
    assert.equal(fixture.app.identity.app, 'application');
  }

  for (const platform of ['browser', 'expo']) {
    const explicit = byName.get(`${platform}-explicit`);
    const familiar = byName.get(`${platform}-familiar`);
    assert.deepEqual(familiar.app.authBootstrap, explicit.app.authBootstrap);
    assert.deepEqual(
      JSON.parse(readFileSync(join(familiar.backendRoot, 'generated', 'normalized-definition.v1.json'), 'utf8')),
      JSON.parse(readFileSync(join(explicit.backendRoot, 'generated', 'normalized-definition.v1.json'), 'utf8')),
    );
    assert.equal(
      familiar.generated.identities.normalizedContractId,
      explicit.generated.identities.normalizedContractId,
    );
    assert.equal(
      familiar.generated.identities.normalizedSchemaId,
      explicit.generated.identities.normalizedSchemaId,
    );
    assert.notEqual(familiar.generated.identities.semanticId, explicit.generated.identities.semanticId);
    assert.notEqual(familiar.generated.identities.evidenceId, explicit.generated.identities.evidenceId);
    assert.notEqual(familiar.generated.identities.generationId, explicit.generated.identities.generationId);
    assert.equal(
      JSON.stringify(runtimeClientCustodyRows(familiar.generated)),
      JSON.stringify(runtimeClientCustodyRows(explicit.generated)),
      `${platform} Explicit/Familiar runtime, client, and custody path bytes must match`,
    );
  }

  const receipts = new Map();
  for (const fixture of fixtures) receipts.set(fixture.definition.name, await journey(fixture));
  assert.deepEqual(receipts.get('browser-familiar').requests, receipts.get('browser-explicit').requests);
  assert.deepEqual(receipts.get('expo-familiar').requests, receipts.get('expo-explicit').requests);
  assert.equal(receipts.get('browser-explicit').custody.grade, 'durable');
  assert.equal(receipts.get('expo-explicit').custody.grade, 'durable');
});
