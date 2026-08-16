import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { StrictMode } from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { SnapbackClient } from '@expo/snapback-client';
import { SnapbackAssetClient } from '@expo/snapback-client/assets';

import {
  SnapbackExpoProvider,
  createSnapbackExpoBoot,
  defaultSnapbackExpoEnvironment,
} from './provider.mjs';
import { adaptExpoAssetSource } from './asset-source.mjs';
import { resolveDefaultAppState as resolveWebAppState } from './app-state.web.mjs';

const { resolveDefaultAppState } = await import('#app-state');
assert.equal(await resolveDefaultAppState(), null);
assert.equal(await resolveWebAppState(), null);

const generatedRoot = new URL(
  '../../demos/zero-bakeoff/apps/field-notebook/snapback/generated/',
  import.meta.url,
);
const app = JSON.parse(readFileSync(new URL('app.descriptor.json', generatedRoot)));
const functionManifest = JSON.parse(readFileSync(new URL('functions.manifest.json', generatedRoot)));
const schemaManifest = JSON.parse(readFileSync(new URL('schema.manifest.json', generatedRoot)));
const capabilityManifest = JSON.parse(readFileSync(new URL('capability.manifest.json', generatedRoot)));
const conversationGeneratedRoot = new URL(
  '../snapback-react/fixtures/conversation/app/snapback/generated/',
  import.meta.url,
);
const conversationApp = JSON.parse(readFileSync(new URL('app.descriptor.json', conversationGeneratedRoot)));
const conversationFunctions = JSON.parse(readFileSync(new URL('functions.manifest.json', conversationGeneratedRoot)));
const conversationSchema = JSON.parse(readFileSync(new URL('schema.manifest.json', conversationGeneratedRoot)));
const conversationCapabilities = JSON.parse(readFileSync(new URL('capability.manifest.json', conversationGeneratedRoot)));

// LLP 0179 descriptor input reaches the existing client admission owner
// directly; no function-manifest prop is needed on SnapbackExpoProvider.
const descriptorClient = new SnapbackClient('http://127.0.0.1:9');
descriptorClient.inspect = async () => ({
    targetProfileId: capabilityManifest.targetProfileId,
    target: 'local',
    functions: functionManifest,
    schema: schemaManifest,
    capabilityManifest,
    routeManifestHash: null,
  });
descriptorClient.authSession = async () => ({ activeMode: 'sessions' });
const descriptorPrepared = await descriptorClient.prepareReactBinding({ generatedManifest: app });
assert.equal(descriptorPrepared.appId, app.identity.app);
assert.deepEqual(Object.keys(descriptorPrepared.references).sort(), [
  'assignedRecords',
  'createRecord',
  'updateRecord',
]);

// The generated TypeScript binding hydrates portable references with a
// non-enumerable runtime-artifacts convenience. The Expo entry point accepts
// that exact module export, while the client admission owner hashes and
// validates only its portable descriptor projection.
const hydratedApp = structuredClone(app);
const runtimeArtifacts = Object.freeze({ trustedCompositionActivation: null });
for (const namespace of [hydratedApp.api.queries, hydratedApp.api.mutations]) {
  for (const reference of Object.values(namespace)) {
    Object.defineProperty(reference, 'artifacts', {
      value: runtimeArtifacts,
      enumerable: false,
    });
  }
}
const hydratedPrepared = await descriptorClient.prepareReactBinding({
  generatedManifest: hydratedApp,
});
assert.equal(hydratedPrepared.appId, app.identity.app);
assert.deepEqual(Object.keys(hydratedPrepared.references).sort(), [
  'assignedRecords',
  'createRecord',
  'updateRecord',
]);

const binding = Object.freeze({
  format: 'snapback.app-binding.v1',
  source: 'supervised-dev',
  descriptorIdentity: app.identity.descriptor,
  target: Object.freeze({
    app: app.identity.app,
    schema: app.identity.schema,
    functions: app.identity.functions,
    origin: 'http://127.0.0.1:4317',
    routing: 'loopback',
  }),
  capabilities: Object.freeze({ offered: Object.freeze([...app.capabilities.required]) }),
  provenance: Object.freeze({
    supervisorGeneration: 'provider-test-generation',
    issuedAt: '2026-08-05T20:00:00.000Z',
    expiresAt: '2026-08-05T21:00:00.000Z',
  }),
  integrity: Object.freeze({ channel: 'local-supervised-ipc' }),
});

function appStateHarness() {
  const listeners = new Set();
  return {
    currentState: 'active',
    addEventListener(event, listener) {
      assert.equal(event, 'change');
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
    emit(state) { for (const listener of [...listeners]) listener(state); },
    count: () => listeners.size,
  };
}

const states = [];
let authorityAdoptions = 0;
let preparedInput = null;
let providerDisposed = 0;
const lifecycleCalls = [];
const appState = appStateHarness();
const fakeClient = {
  async prepareReactBinding(options) {
    preparedInput = options.generatedManifest;
    return { prepared: true };
  },
};
const environment = Object.freeze({
  format: 'snapback.expo-environment.v1',
  appState,
  async resolveBinding({ bindingOverride }) {
    assert.equal(bindingOverride, null);
    return {
      binding,
      admission: {
        productionCondition: false,
        delivery: { channel: 'local-supervised-ipc' },
      },
    };
  },
  async adoptAuthority() {
    authorityAdoptions += 1;
    return {
      status: 'ready',
      client: fakeClient,
      publicFacts: {
        kind: 'session',
        authMode: 'sessions',
        sessionId: 'session-public-id',
        userId: 'user-public-id',
        bearerToken: 'must-not-project',
      },
    };
  },
});
const fakeProvider = {
  async pause() { lifecycleCalls.push('pause'); },
  async resume() { lifecycleCalls.push('resume'); },
  async dispose() { providerDisposed += 1; },
};
const boot = createSnapbackExpoBoot({
  app,
  environment,
  now: () => Date.parse('2026-08-05T20:30:00.000Z'),
  createProvider(prepared, options) {
    assert.deepEqual(prepared, { prepared: true });
    assert.strictEqual(options.assetSourceAdapter, adaptExpoAssetSource);
    assert.ok(options.assets instanceof SnapbackAssetClient);
    return fakeProvider;
  },
});
states.push(boot.getSnapshot());
const unsubscribe = boot.subscribe(() => states.push(boot.getSnapshot()));
const ready = await boot.start();
assert.deepEqual(states.map((state) => (
  state.status === 'starting' ? `${state.status}:${state.stage}` : state.status
)), [
  'starting:binding',
  'starting:authority',
  'starting:client',
  'ready',
]);
assert.equal(ready.status, 'ready');
assert.strictEqual(preparedInput, app);
assert.equal(ready.authority.bearerToken, undefined);
assert.equal(ready.authority.sessionId, 'session-public-id');
assert.equal(ready.binding.target.origin, binding.target.origin);
assert.equal(authorityAdoptions, 1);
assert.strictEqual(boot.lifecycleSource(), appState);
assert.equal(appState.count(), 1);
appState.emit('background');
appState.emit('active');
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(lifecycleCalls, ['pause', 'resume']);
unsubscribe();
await boot.dispose();
assert.equal(appState.count(), 0);
assert.equal(providerDisposed, 1);

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const strictBinding = Object.freeze({
  ...binding,
  provenance: Object.freeze({
    ...binding.provenance,
    issuedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }),
});
descriptorClient.releaseConnection = async () => ({ released: true });
const strictClient = {
  async prepareReactBinding() { return descriptorPrepared; },
};
const strictEnvironment = Object.freeze({
  format: 'snapback.expo-environment.v1',
  appState: appStateHarness(),
  async resolveBinding() {
    return {
      binding: strictBinding,
      admission: {
        productionCondition: false,
        delivery: { channel: 'local-supervised-ipc' },
      },
    };
  },
  async adoptAuthority() {
    return {
      status: 'ready',
      client: strictClient,
      publicFacts: {
        kind: 'session',
        authMode: 'sessions',
        sessionId: 'strict-session',
        userId: 'strict-user',
      },
    };
  },
});
let strictBootState = null;
let strictRenderer;
await act(async () => {
  strictRenderer = TestRenderer.create(React.createElement(
    StrictMode,
    null,
    React.createElement(
      SnapbackExpoProvider,
      {
        app,
        environment: strictEnvironment,
        fallback(state) {
          strictBootState = state;
          return React.createElement('fallback');
        },
      },
      React.createElement('ready'),
    ),
  ));
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
});
assert.equal(strictBootState?.status === 'error', false);
assert.equal(
  strictRenderer.root.findAllByType('ready').length,
  1,
  JSON.stringify({ strictBootState, tree: strictRenderer.toJSON() }),
);
await act(async () => {
  strictRenderer.unmount();
  await new Promise((resolve) => setImmediate(resolve));
});

// Node selects the default #app-state arm. An otherwise-working environment
// without either injection reaches the provider's coded unsupported state
// instead of crashing while evaluating React Native sources.
const { appState: unusedAppState, ...environmentWithoutAppStateFields } = environment;
assert.ok(unusedAppState);
let unsupportedBindLifecycleCalls = 0;
const noAppStateBoot = createSnapbackExpoBoot({
  app,
  environment: Object.freeze(environmentWithoutAppStateFields),
  now: () => Date.parse('2026-08-05T20:30:00.000Z'),
  createProvider: () => fakeProvider,
  bindLifecycle() {
    unsupportedBindLifecycleCalls += 1;
    return { dispose() {} };
  },
});
const noAppState = await noAppStateBoot.start();
assert.equal(noAppState.status, 'unsupported');
assert.equal(noAppState.diagnostic.code, 'SNAPBACK_EXPO_COMPATIBILITY_UNSUPPORTED');
assert.match(
  noAppState.diagnostic.message,
  /inject appState .*resolveAppState.*createSupervisedExpoEnvironment/u,
);
assert.equal(unsupportedBindLifecycleCalls, 0);
assert.equal(providerDisposed, 2, 'unsupported lifecycle resolution disposes the prepared provider');

// LLP 0179 S1: the maintained Expo fixture's generated conversation surface
// passes through the E1 boot owner unchanged and is bindable headlessly from
// the provider it creates. No URL or identity payload enters the surface call.
const conversationClient = new SnapbackClient('http://127.0.0.1:9');
conversationClient.inspect = async () => ({
  targetProfileId: conversationCapabilities.targetProfileId,
  target: 'local-dev-sqlite-ibex',
  functions: conversationFunctions,
  schema: conversationSchema,
  capabilityManifest: conversationCapabilities,
  routeManifestHash: null,
});
conversationClient.authSession = async () => ({ activeMode: 'sessions' });
const conversationBinding = Object.freeze({
  format: 'snapback.app-binding.v1',
  source: 'supervised-dev',
  descriptorIdentity: conversationApp.identity.descriptor,
  target: Object.freeze({
    app: conversationApp.identity.app,
    schema: conversationApp.identity.schema,
    functions: conversationApp.identity.functions,
    origin: 'http://127.0.0.1:4317',
    routing: 'loopback',
  }),
  capabilities: Object.freeze({ offered: Object.freeze([...conversationApp.capabilities.required]) }),
  provenance: Object.freeze({
    supervisorGeneration: 'surface-provider-test-generation',
    issuedAt: '2026-08-05T20:00:00.000Z',
    expiresAt: '2026-08-05T21:00:00.000Z',
  }),
  integrity: Object.freeze({ channel: 'local-supervised-ipc' }),
});
const surfaceBoot = createSnapbackExpoBoot({
  app: conversationApp,
  now: () => Date.parse('2026-08-05T20:30:00.000Z'),
  createApplicationClient: async () => Object.freeze({
    client: conversationClient,
    bootstrapState: () => Object.freeze({ status: 'ready' }),
    subscribeBootstrap: () => () => {},
    async dispose() {},
  }),
  environment: Object.freeze({
    format: 'snapback.expo-environment.v1',
    appState: appStateHarness(),
    resolveBinding: async () => ({
      binding: conversationBinding,
      admission: { delivery: { channel: 'local-supervised-ipc' } },
    }),
    adoptAuthority: async () => ({
      status: 'ready',
      client: conversationClient,
      publicFacts: { kind: 'session', authMode: 'sessions', sessionId: 'surface-session' },
    }),
  }),
});
assert.equal((await surfaceBoot.start()).status, 'ready');
const surfaceProvider = surfaceBoot.reactProvider();
const headlessConversation = surfaceProvider.surface(
  conversationApp.surfaces.conversation,
  { conversationId: 'g2_conversation_seed' },
);
assert.strictEqual(headlessConversation.descriptor, surfaceProvider.binding.surfaces.conversation);
assert.equal(headlessConversation.snapshot().state.messages.status, 'pending');
assert.equal(headlessConversation.snapshot().data.messages, undefined);
await headlessConversation.dispose();
await surfaceBoot.dispose();

// G2 capability-refusal witness: the exact conversation descriptor cannot
// boot against a supervised binding that omits one generated requirement.
// The app-level fallback receives this diagnostic before authority, stores,
// queries, rooms, mutations, or asset tasks can start.
let capabilityMismatchAuthorityAdoptions = 0;
const capabilityMismatchBinding = structuredClone(conversationBinding);
const missingConversationCapability = conversationApp.capabilities.required[0];
capabilityMismatchBinding.capabilities.offered = conversationApp.capabilities.required.slice(1);
const capabilityMismatchBoot = createSnapbackExpoBoot({
  app: conversationApp,
  now: () => Date.parse('2026-08-05T20:30:00.000Z'),
  environment: {
    format: 'snapback.expo-environment.v1',
    appState: appStateHarness(),
    resolveBinding: async () => ({
      binding: capabilityMismatchBinding,
      admission: { delivery: { channel: 'local-supervised-ipc' } },
    }),
    async adoptAuthority() {
      capabilityMismatchAuthorityAdoptions += 1;
      return null;
    },
  },
});
const capabilityMismatchState = await capabilityMismatchBoot.start();
assert.equal(capabilityMismatchState.status, 'unsupported');
assert.equal(capabilityMismatchState.diagnostic.code, 'SNAPBACK_APP_BINDING_CAPABILITY_MISMATCH');
assert.deepEqual(capabilityMismatchState.diagnostic.details.missingCapabilities, [missingConversationCapability]);
assert.equal(capabilityMismatchAuthorityAdoptions, 0);

let mismatchAuthorityAdoptions = 0;
const mismatch = structuredClone(binding);
mismatch.descriptorIdentity = 'sha256:foreign-descriptor';
const mismatchBoot = createSnapbackExpoBoot({
  app,
  now: () => Date.parse('2026-08-05T20:30:00.000Z'),
  environment: {
    format: 'snapback.expo-environment.v1',
    appState: appStateHarness(),
    resolveBinding: async () => ({
      binding: mismatch,
      admission: { delivery: { channel: 'local-supervised-ipc' } },
    }),
    async adoptAuthority() {
      mismatchAuthorityAdoptions += 1;
      return null;
    },
  },
});
const mismatchState = await mismatchBoot.start();
assert.equal(mismatchState.status, 'error');
assert.equal(mismatchState.diagnostic.code, 'SNAPBACK_APP_BINDING_IDENTITY_MISMATCH');
assert.equal(mismatchAuthorityAdoptions, 0, 'identity mismatch refuses before authority/store work');

const authorityBoot = createSnapbackExpoBoot({
  app,
  now: () => Date.parse('2026-08-05T20:30:00.000Z'),
  environment: {
    format: 'snapback.expo-environment.v1',
    appState: appStateHarness(),
    resolveBinding: async () => ({
      binding,
      admission: { delivery: { channel: 'local-supervised-ipc' } },
    }),
    adoptAuthority: async () => ({
      status: 'authority-required',
      diagnostic: {
        schemaVersion: 'snapback.client-diagnostic.v1',
        code: 'SNAPBACK_AUTH_POLICY_UNAVAILABLE',
        severity: 'error',
        message: 'Sessions auth mode is not settled.',
        details: {},
      },
      remediations: [],
    }),
  },
});
const authorityRequired = await authorityBoot.start();
assert.equal(authorityRequired.status, 'authority-required');
assert.equal(authorityRequired.diagnostic.code, 'SNAPBACK_AUTH_POLICY_UNAVAILABLE');
assert.equal(authorityRequired.diagnostic.details.cause, 'sessions-auth-mode-unavailable');

const unavailable = createSnapbackExpoBoot({ app, environment: defaultSnapbackExpoEnvironment });
const unavailableState = await unavailable.start();
assert.equal(unavailableState.status, 'error');
assert.equal(unavailableState.diagnostic.code, 'SNAPBACK_APP_BINDING_UNAVAILABLE');
assert.match(unavailableState.diagnostic.details.seam, /resolveBinding/u);

let completeAdoption;
let interruptedAuthorityDisposals = 0;
const interrupted = createSnapbackExpoBoot({
  app,
  now: () => Date.parse('2026-08-05T20:30:00.000Z'),
  environment: {
    format: 'snapback.expo-environment.v1',
    appState: appStateHarness(),
    resolveBinding: async () => ({
      binding,
      admission: { delivery: { channel: 'local-supervised-ipc' } },
    }),
    adoptAuthority: () => new Promise((resolve) => { completeAdoption = resolve; }),
  },
});
const interruptedStart = interrupted.start();
while (interrupted.getSnapshot().status === 'starting'
  && interrupted.getSnapshot().stage === 'binding') {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
await interrupted.dispose();
completeAdoption({
  status: 'ready',
  client: fakeClient,
  publicFacts: { kind: 'session', authMode: 'sessions' },
  dispose: async () => { interruptedAuthorityDisposals += 1; },
});
await interruptedStart;
assert.equal(interruptedAuthorityDisposals, 1, 'dispose racing authority adoption releases it');

console.log('provider.test.mjs: descriptor delegation, exact boot states, authority refusal, lifecycle, and pre-store mismatch pass');
