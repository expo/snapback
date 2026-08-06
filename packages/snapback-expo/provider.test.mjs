import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { SnapbackClient } from '@expo/snapback-client';

import {
  createSnapbackExpoBoot,
  defaultSnapbackExpoEnvironment,
} from './provider.mjs';

const generatedRoot = new URL(
  '../../demos/zero-bakeoff/apps/field-notebook/snapback/generated/',
  import.meta.url,
);
const app = JSON.parse(readFileSync(new URL('app.descriptor.json', generatedRoot)));
const functionManifest = JSON.parse(readFileSync(new URL('functions.manifest.json', generatedRoot)));
const schemaManifest = JSON.parse(readFileSync(new URL('schema.manifest.json', generatedRoot)));
const capabilityManifest = JSON.parse(readFileSync(new URL('capability.manifest.json', generatedRoot)));

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
  createProvider(prepared) {
    assert.deepEqual(prepared, { prepared: true });
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
assert.equal(appState.count(), 1);
appState.emit('background');
appState.emit('active');
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(lifecycleCalls, ['pause', 'resume']);
unsubscribe();
await boot.dispose();
assert.equal(appState.count(), 0);
assert.equal(providerDisposed, 1);

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
