import assert from 'node:assert/strict';

import { createSnapbackExpoBoot } from './provider.mjs';
import {
  SUPERVISED_EXCHANGE_FORMAT,
  SUPERVISED_EXCHANGE_PATH,
  createSupervisedExpoEnvironment,
} from './supervised-environment.mjs';

const app = Object.freeze({
  format: 'snapback.app.v1',
  authoringProfile: 'snapback-explicit-v1',
  identity: Object.freeze({
    app: 'expo-supervised-test',
    schema: 'sha256:schema',
    functions: 'sha256:functions',
    descriptor: 'sha256:descriptor',
  }),
  api: Object.freeze({ queries: {}, mutations: {}, assets: {}, ephemeral: {}, queryGroups: {} }),
  commands: Object.freeze({}),
  surfaces: Object.freeze({}),
  capabilities: Object.freeze({ required: Object.freeze([]) }),
});
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
  capabilities: Object.freeze({ offered: Object.freeze([]) }),
  provenance: Object.freeze({
    supervisorGeneration: 'supervised-environment-test',
    issuedAt: '2026-08-05T20:00:00.000Z',
    expiresAt: '2026-08-05T21:00:00.000Z',
  }),
  integrity: Object.freeze({ channel: 'local-supervised-ipc' }),
});

const requests = [];
const environment = createSupervisedExpoEnvironment({
  exchangeOrigin: 'http://127.0.0.1:4321',
  appState: {
    currentState: 'active',
    addEventListener() { return { remove() {} }; },
  },
  async fetch(url, options) {
    requests.push({ url, options });
    return {
      ok: true,
      async json() {
        return {
          format: SUPERVISED_EXCHANGE_FORMAT,
          correlationId: 'supervised-environment-correlation',
          binding,
          authority: {
            status: 'authority-required',
            diagnostic: {
              schemaVersion: 'snapback.client-diagnostic.v1',
              code: 'SNAPBACK_AUTH_POLICY_UNAVAILABLE',
              severity: 'error',
              message: 'Sessions auth mode is not settled.',
              details: {},
            },
            remediations: [],
          },
        };
      },
    };
  },
});

const boot = createSnapbackExpoBoot({
  app,
  environment,
  now: () => Date.parse('2026-08-05T20:30:00.000Z'),
});
const state = await boot.start();
assert.equal(state.status, 'authority-required');
assert.equal(state.diagnostic.code, 'SNAPBACK_AUTH_POLICY_UNAVAILABLE');
assert.equal(state.diagnostic.details.cause, 'sessions-auth-mode-unavailable');
assert.equal(requests.length, 1, 'binding and refusal travel in one bootstrap exchange');
assert.equal(requests[0].url, `http://127.0.0.1:4321${SUPERVISED_EXCHANGE_PATH}`);
assert.equal(requests[0].options.cache, 'no-store');
assert.equal(requests[0].options.method, 'GET');
assert.equal(JSON.stringify(binding).includes('token'), false);
await boot.dispose();

await assert.rejects(
  () => createSupervisedExpoEnvironment({ exchangeOrigin: 'https://example.test' })
    .resolveBinding({ signal: new AbortController().signal }),
  (error) => error?.code === 'SNAPBACK_EXPO_BOOTSTRAP_ORIGIN_INVALID',
);
await assert.rejects(
  () => createSupervisedExpoEnvironment({ exchangeOrigin: 'http://192.0.2.10:4321' })
    .resolveBinding({ signal: new AbortController().signal }),
  (error) => error?.code === 'SNAPBACK_EXPO_BOOTSTRAP_ORIGIN_INVALID',
);

console.log('supervised-environment.test.mjs: no-prop no-store exchange and explicit Sessions refusal pass');
