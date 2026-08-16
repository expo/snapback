import assert from 'node:assert/strict';

import { createSnapbackExpoBoot } from './provider.mjs';
import {
  SUPERVISED_EXCHANGE_FORMAT,
  SUPERVISED_EXCHANGE_PATH,
  SUPERVISED_DEV_IDENTITY_CHECKOUT_ENV,
  SUPERVISED_DEV_IDENTITY_CHECKOUT_HEADER,
  SUPERVISED_DEV_IDENTITY_CHECKOUT_PATH,
  createSupervisedExpoEnvironment,
  resolveSupervisedDevIdentityCheckoutNonce,
} from './supervised-environment.mjs';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const SUPERVISOR_DIAGNOSTIC_BEARER = 'sbs_supervisor_diagnostic_must_not_project';

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
              details: {
                cause: 'sessions-auth-mode-unavailable',
                bearer: SUPERVISOR_DIAGNOSTIC_BEARER,
              },
            },
            remediations: [{
              kind: 'settleSessionsMode',
              riskClass: 'mechanical',
              machineApplicable: false,
              requiresApproval: false,
              authorityEffect: 'none',
              precondition: {
                causeCode: 'SNAPBACK_AUTH_POLICY_UNAVAILABLE',
                bearer: SUPERVISOR_DIAGNOSTIC_BEARER,
              },
              description: 'Settle Sessions auth mode, then retry bootstrap.',
            }],
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
assert.equal(state.diagnostic.details.bearer, undefined);
assert.equal(state.remediations[0].precondition.bearer, undefined);
assert.equal(
  JSON.stringify(state).includes(SUPERVISOR_DIAGNOSTIC_BEARER),
  false,
  'supervisor-originated diagnostic and remediation state cannot publish bearer material',
);
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

const bootstrapCapability = 'auth.application-bootstrap.v1';
const bootstrapApp = Object.freeze({
  ...app,
  authBootstrap: Object.freeze({
    format: 'snapback.application-auth-bootstrap.v1',
    appId: app.identity.app,
    mode: 'sessions',
    custody: 'volatile-explicit',
    entryMechanisms: Object.freeze([]),
    anonymousPublic: 'allowed',
    lifecycleProtocol: 1,
  }),
  capabilities: Object.freeze({ required: Object.freeze([bootstrapCapability]) }),
});
const bootstrapBinding = Object.freeze({
  ...binding,
  capabilities: Object.freeze({ offered: Object.freeze([bootstrapCapability]) }),
});
const constructionEntered = deferred();
let partialCoordinatorDisposed = false;
let exchangeFetches = 0;
const abortingEnvironment = createSupervisedExpoEnvironment({
  exchangeOrigin: 'http://127.0.0.1:4321',
  appState: {
    currentState: 'active',
    addEventListener() { return { remove() {} }; },
  },
  resolveAppClientPlatform: async () => Object.freeze({ kind: 'memory' }),
  async fetch() {
    exchangeFetches += 1;
    return Response.json({
      format: SUPERVISED_EXCHANGE_FORMAT,
      correlationId: `abort-correlation-${exchangeFetches}`,
      binding: bootstrapBinding,
      authority: {
        status: 'ready',
        tokenType: 'Bearer',
        token: 'sbs_disposal_exchange_secret',
      },
    });
  },
});
const abortingBoot = createSnapbackExpoBoot({
  app: bootstrapApp,
  environment: abortingEnvironment,
  now: () => Date.parse('2026-08-05T20:30:00.000Z'),
  createApplicationClient(input) {
    constructionEntered.resolve();
    return new Promise((_resolve, reject) => {
      input.signal?.addEventListener('abort', () => {
        partialCoordinatorDisposed = true;
        reject(input.signal.reason);
      }, { once: true });
    });
  },
});
void abortingBoot.start();
await constructionEntered.promise;
await Promise.race([
  abortingBoot.dispose(),
  new Promise((_, reject) => setTimeout(
    () => reject(new Error('dispose did not join aborted app-client construction')),
    250,
  )),
]);
assert.equal(partialCoordinatorDisposed, true, 'mid-custody abort closes its partial coordinator');
await abortingEnvironment.resolveSupervisedAuthority({
  binding: bootstrapBinding,
  signal: new AbortController().signal,
});
assert.equal(exchangeFetches, 2, 'aborted construction deletes its retained bearer exchange');

const checkoutNonce = `native-checkout-${'n'.repeat(32)}`;
assert.equal(resolveSupervisedDevIdentityCheckoutNonce({
  runtimePlatform: 'web',
  nativeLaunchEnvironment: { [SUPERVISED_DEV_IDENTITY_CHECKOUT_ENV]: checkoutNonce },
}), null, 'Expo web ignores even a same-named launch-environment value');
assert.equal(resolveSupervisedDevIdentityCheckoutNonce({
  runtimePlatform: 'native',
  nativeLaunchEnvironment: { [SUPERVISED_DEV_IDENTITY_CHECKOUT_ENV]: checkoutNonce },
}), checkoutNonce);

let checkoutRedemptions = 0;
let checkoutBootstraps = 0;
const checkoutEnvironment = createSupervisedExpoEnvironment({
  exchangeOrigin: 'http://127.0.0.1:4321',
  runtimePlatform: 'native',
  nativeLaunchEnvironment: { [SUPERVISED_DEV_IDENTITY_CHECKOUT_ENV]: checkoutNonce },
  async fetch(url, options) {
    if (options.method === 'GET') {
      assert.equal(url, `http://127.0.0.1:4321${SUPERVISED_EXCHANGE_PATH}`);
      checkoutBootstraps += 1;
      return Response.json({
        format: SUPERVISED_EXCHANGE_FORMAT,
        correlationId: 'checkout-client-options-proof',
        binding,
        authority: {
          status: 'ready',
          tokenType: 'Bearer',
          token: 'sbs_checkout_client_options_proof',
        },
      });
    }
    assert.equal(url, `http://127.0.0.1:4321${SUPERVISED_DEV_IDENTITY_CHECKOUT_PATH}`);
    assert.equal(options.method, 'POST');
    assert.equal(options.headers[SUPERVISED_DEV_IDENTITY_CHECKOUT_HEADER], checkoutNonce);
    checkoutRedemptions += 1;
    return Response.json({
      ok: true,
      devIdentityCapability: 'sbdev_native_client_option_proof',
    });
  },
});
const checkoutAdmission = await checkoutEnvironment.resolveBinding({
  app,
  signal: new AbortController().signal,
});
const checkoutAuthority = await checkoutEnvironment.resolveSupervisedAuthority({
  app,
  binding: checkoutAdmission.binding,
  signal: new AbortController().signal,
  refresh: false,
});
assert.equal(checkoutAuthority.status, 'ready');
assert.deepEqual(checkoutAuthority.clientOptions, {
  devIdentityCapability: 'sbdev_native_client_option_proof',
});
assert.equal(
  await checkoutEnvironment.resolveDevIdentityCapability(),
  'sbdev_native_client_option_proof',
);
assert.equal(
  await checkoutEnvironment.resolveDevIdentityCapability(),
  'sbdev_native_client_option_proof',
);
assert.equal(checkoutBootstraps, 1);
assert.equal(checkoutRedemptions, 1, 'one native process redeems its checkout nonce once');

console.log('supervised-environment.test.mjs: no-prop exchange, sanitized refusal, abort cleanup, and one-shot native checkout pass');
