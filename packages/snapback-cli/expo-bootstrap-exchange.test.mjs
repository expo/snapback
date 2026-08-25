import assert from 'node:assert/strict';

import {
  SUPERVISED_CONTROL_PATH,
  SUPERVISED_EXCHANGE_PATH,
  admittedBrowserExchangeOrigin,
  startBootstrapExchange,
} from './expo-dev.mjs';
import { createSupervisedBindingPublisher } from './expo-binding-refresh.mjs';
import { admitAppBindingV1 } from '../snapback-expo/app-binding.mjs';

const BASE_NOW = Date.parse('2026-08-21T12:00:00.000Z');
const TEST_TTL_MS = 1_000;
const TEST_REFRESH_WINDOW_MS = 200;
const TEST_GENERATION = 'supervisor-fake-clock';

function descriptor(
  suffix = 'a',
  required = ['auth.application-bootstrap.v1'],
) {
  return Object.freeze({
    format: 'snapback.app.v1',
    authoringProfile: 'snapback-explicit-v1',
    identity: Object.freeze({
      app: 'app:binding-refresh',
      schema: `sha256:schema-${suffix}`,
      functions: `sha256:functions-${suffix}`,
      descriptor: `sha256:descriptor-${suffix}`,
    }),
    capabilities: Object.freeze({
      required: Object.freeze([...required]),
    }),
    api: Object.freeze({
      queries: Object.freeze({}),
      mutations: Object.freeze({}),
      assets: Object.freeze({}),
      ephemeral: Object.freeze({}),
      queryGroups: Object.freeze({}),
    }),
    commands: Object.freeze({}),
    surfaces: Object.freeze({}),
    authBootstrap: Object.freeze({ entryMechanisms: Object.freeze(['password-v1']) }),
  });
}

// The settlement-ledger offer is target-grounded. A descriptor requirement
// cannot make the supervised binding claim it by itself.
{
  const publisher = createSupervisedBindingPublisher({
    generation: 'supervisor-offline-replay-ledger',
    now: () => BASE_NOW,
  });
  const replayDescriptor = descriptor('offline-replay', [
    'auth.application-bootstrap.v1',
    'offline_mutation_replay',
  ]);
  assert.throws(
    () => publisher.issue({
      descriptor: replayDescriptor,
      origin: 'http://127.0.0.1:4310',
      routing: 'loopback',
    }),
    (error) => (
      error.code === 'SNAPBACK_CAPABILITY_UNSUPPORTED'
      && error.diagnostic.details.capability === 'offline_mutation_replay'
      && error.diagnostic.details.vocabulary.bindingOffers === 'not-offered'
    ),
  );
  const binding = publisher.issue({
    descriptor: replayDescriptor,
    capabilityManifest: {
      targetProfileId: 'local-dev-sqlite-ibex',
      supportedCapabilities: ['offline_mutation_replay'],
    },
    origin: 'http://127.0.0.1:4310',
    routing: 'loopback',
  });
  assert(binding.capabilities.offered.includes('offline_mutation_replay'));
  publisher.close();
}

function refreshIssuance(binding, { now, ttlMs }) {
  return Object.freeze({
    ...binding,
    provenance: Object.freeze({
      supervisorGeneration: binding.provenance.supervisorGeneration,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
    }),
  });
}

function nonIssuanceFacts(binding) {
  const clone = structuredClone(binding);
  delete clone.provenance.issuedAt;
  delete clone.provenance.expiresAt;
  return clone;
}

function issueTestBinding(publisher, suffix = 'a') {
  return publisher.issue({
    descriptor: descriptor(suffix),
    origin: 'http://127.0.0.1:4310',
    routing: 'loopback',
  });
}

function assertDeeplyFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeeplyFrozen(child);
}

// Unconfigured production timing is one hour with a five-minute refresh
// window. A short configured TTL caps that default window at one quarter.
let defaultSupervisorNow = BASE_NOW;
const defaultPublisher = createSupervisedBindingPublisher({
  generation: 'supervisor-default-arithmetic',
  now: () => defaultSupervisorNow,
});
const defaultPredecessor = issueTestBinding(defaultPublisher, 'default');
assert.equal(
  Date.parse(defaultPredecessor.provenance.expiresAt)
    - Date.parse(defaultPredecessor.provenance.issuedAt),
  60 * 60 * 1_000,
);
assert.equal(defaultPublisher.refreshWindowMs, 5 * 60 * 1_000);
defaultSupervisorNow = Date.parse(defaultPredecessor.provenance.expiresAt)
  - defaultPublisher.refreshWindowMs - 1;
assert.strictEqual(await defaultPublisher.bindingForExchange(), defaultPredecessor);
defaultSupervisorNow += 1;
const defaultSuccessor = await defaultPublisher.bindingForExchange();
assert.notStrictEqual(defaultSuccessor, defaultPredecessor);

const distinctAppNow = defaultSupervisorNow - 60_000;
assert.deepEqual(
  await admitAppBindingV1(defaultSuccessor, descriptor('default'), {
    now: distinctAppNow,
    delivery: { channel: 'local-supervised-ipc' },
  }),
  defaultSuccessor,
  'the app clock independently admits a supervisor-issued binding at the skew boundary',
);

let quarterCapNow = BASE_NOW;
const quarterCapPublisher = createSupervisedBindingPublisher({
  generation: 'supervisor-quarter-cap',
  now: () => quarterCapNow,
  ttlMs: TEST_TTL_MS,
});
const quarterCapPredecessor = issueTestBinding(quarterCapPublisher, 'quarter-cap');
assert.equal(quarterCapPublisher.refreshWindowMs, TEST_TTL_MS / 4);
quarterCapNow = BASE_NOW + TEST_TTL_MS - quarterCapPublisher.refreshWindowMs - 1;
assert.strictEqual(await quarterCapPublisher.bindingForExchange(), quarterCapPredecessor);
quarterCapNow += 1;
assert.notStrictEqual(await quarterCapPublisher.bindingForExchange(), quarterCapPredecessor);

// Fake-clock concurrency: every exchange crossing the window joins one mint
// and receives the exact same complete successor publication.
let fakeNow = BASE_NOW;
let releaseConcurrentMint;
let markConcurrentMintStarted;
let concurrentMintCalls = 0;
const concurrentMintStarted = new Promise((resolve) => { markConcurrentMintStarted = resolve; });
const concurrentMintGate = new Promise((resolve) => { releaseConcurrentMint = resolve; });
const refreshEvents = [];
const concurrentPublisher = createSupervisedBindingPublisher({
  generation: TEST_GENERATION,
  now: () => fakeNow,
  ttlMs: TEST_TTL_MS,
  refreshWindowMs: TEST_REFRESH_WINDOW_MS,
  async mintRefresh(binding, timing) {
    concurrentMintCalls += 1;
    markConcurrentMintStarted();
    await concurrentMintGate;
    return refreshIssuance(binding, timing);
  },
  onEvent: (event) => refreshEvents.push(event),
});
const concurrentPredecessor = issueTestBinding(concurrentPublisher);
fakeNow = BASE_NOW + TEST_TTL_MS - TEST_REFRESH_WINDOW_MS - 1;
assert.strictEqual(
  await concurrentPublisher.bindingForExchange(),
  concurrentPredecessor,
  'the publisher retains a binding immediately before the bounded refresh window',
);
fakeNow += 1;
const concurrentExchanges = [
  concurrentPublisher.bindingForExchange(),
  concurrentPublisher.bindingForExchange(),
  concurrentPublisher.bindingForExchange(),
];
await concurrentMintStarted;
assert.equal(concurrentMintCalls, 1);
releaseConcurrentMint();
const concurrentSuccessors = await Promise.all(concurrentExchanges);
assert(concurrentSuccessors.every((binding) => binding === concurrentSuccessors[0]));
assert.deepEqual(nonIssuanceFacts(concurrentSuccessors[0]), nonIssuanceFacts(concurrentPredecessor));
assert.notEqual(
  concurrentSuccessors[0].provenance.issuedAt,
  concurrentPredecessor.provenance.issuedAt,
);
assert.deepEqual(refreshEvents.map(({ state }) => state), ['binding-refreshed']);
assert.equal(JSON.stringify(refreshEvents).includes('sbs_'), false);
fakeNow = Date.parse(concurrentPredecessor.provenance.expiresAt) + 1;
assert.throws(
  () => concurrentPublisher.publish(concurrentPredecessor),
  (error) => error.code === 'SNAPBACK_EXPO_BINDING_PUBLICATION_STALE',
  'an expired cached predecessor cannot replace the refreshed exchange successor',
);
assert.strictEqual(concurrentPublisher.current, concurrentSuccessors[0]);

// The five-minute production window exceeds AppBinding's admitted one-minute
// host/device skew. Model the same ratio here: when the client reaches expiry
// 60 ms ahead of this scaled fake host, the host is already inside the window.
let skewedHostNow = BASE_NOW;
const skewedPublisher = createSupervisedBindingPublisher({
  generation: 'supervisor-skewed-clock',
  now: () => skewedHostNow,
  ttlMs: TEST_TTL_MS,
  refreshWindowMs: TEST_REFRESH_WINDOW_MS,
});
const skewedPredecessor = issueTestBinding(skewedPublisher);
skewedHostNow = BASE_NOW + TEST_TTL_MS - 60;
const skewedSuccessor = await skewedPublisher.bindingForExchange();
assert.notStrictEqual(skewedSuccessor, skewedPredecessor);
assert(Date.parse(skewedSuccessor.provenance.expiresAt) > BASE_NOW + TEST_TTL_MS);

// Descriptor publication wins atomically over an expiry refresh already in
// flight. The late predecessor refresh converges on the descriptor successor,
// and the cached predecessor cannot subsequently replace it.
let racingNow = BASE_NOW;
let releaseRacingMint;
let markRacingMintStarted;
const racingMintStarted = new Promise((resolve) => { markRacingMintStarted = resolve; });
const racingMintGate = new Promise((resolve) => { releaseRacingMint = resolve; });
const racingPublisher = createSupervisedBindingPublisher({
  generation: 'supervisor-descriptor-race',
  now: () => racingNow,
  ttlMs: TEST_TTL_MS,
  refreshWindowMs: TEST_REFRESH_WINDOW_MS,
  async mintRefresh(binding, timing) {
    markRacingMintStarted();
    await racingMintGate;
    return refreshIssuance(binding, timing);
  },
});
const racingPredecessor = issueTestBinding(racingPublisher);
racingNow = BASE_NOW + TEST_TTL_MS - TEST_REFRESH_WINDOW_MS;
const racingExchange = racingPublisher.bindingForExchange();
await racingMintStarted;
racingNow += 1;
const descriptorSuccessor = issueTestBinding(racingPublisher, 'b');
releaseRacingMint();
assert.strictEqual(await racingExchange, descriptorSuccessor);
assert.strictEqual(racingPublisher.current, descriptorSuccessor);
assert.throws(
  () => racingPublisher.publish(racingPredecessor),
  (error) => error.code === 'SNAPBACK_EXPO_BINDING_PUBLICATION_STALE',
);

// Reverse ordering: refresh A publishes first, then its synchronous event
// observer publishes descriptor successor B. The exchange must converge on B.
let eventNow = BASE_NOW;
let eventPublisher;
let eventDescriptorSuccessor;
eventPublisher = createSupervisedBindingPublisher({
  generation: 'supervisor-event-reentrancy',
  now: () => eventNow,
  ttlMs: TEST_TTL_MS,
  refreshWindowMs: TEST_REFRESH_WINDOW_MS,
  onEvent(event) {
    if (event.state === 'binding-refreshed') {
      eventNow += 1;
      eventDescriptorSuccessor = issueTestBinding(eventPublisher, 'event-b');
    }
  },
});
issueTestBinding(eventPublisher, 'event-a');
eventNow = BASE_NOW + TEST_TTL_MS - TEST_REFRESH_WINDOW_MS;
const eventExchangeSuccessor = await eventPublisher.bindingForExchange();
assert.strictEqual(eventExchangeSuccessor, eventDescriptorSuccessor);
assert.strictEqual(eventPublisher.current, eventDescriptorSuccessor);

// Failed minting is visible, keeps the predecessor published, and retries on
// the next exchange instead of installing a partial or invalid successor.
let failureNow = BASE_NOW;
let failureMintCalls = 0;
const failureEvents = [];
const failurePublisher = createSupervisedBindingPublisher({
  generation: 'supervisor-refresh-failure',
  now: () => failureNow,
  ttlMs: TEST_TTL_MS,
  refreshWindowMs: TEST_REFRESH_WINDOW_MS,
  mintRefresh() {
    failureMintCalls += 1;
    throw Object.assign(new Error('injected refresh failure'), { code: 'INJECTED' });
  },
  onEvent: (event) => failureEvents.push(event),
});
const failurePredecessor = issueTestBinding(failurePublisher);
failureNow = BASE_NOW + TEST_TTL_MS - TEST_REFRESH_WINDOW_MS;
await assert.rejects(failurePublisher.bindingForExchange(), /injected refresh failure/u);
assert.strictEqual(failurePublisher.current, failurePredecessor);
assert.equal(failureEvents.at(-1).state, 'binding-refresh-failed');
assert.equal(
  failureEvents.at(-1).diagnostics[0].code,
  'SNAPBACK_EXPO_BINDING_REFRESH_FAILED',
);
assert.equal(JSON.stringify(failureEvents).includes('injected refresh failure'), false);
failureNow = Date.parse(failurePredecessor.provenance.expiresAt) - 1;
await assert.rejects(failurePublisher.bindingForExchange(), /injected refresh failure/u);
assert.strictEqual(failurePublisher.current, failurePredecessor);
failureNow += 1;
await assert.rejects(failurePublisher.bindingForExchange(), /injected refresh failure/u);
assert.strictEqual(failurePublisher.current, failurePredecessor);
assert.equal(failureMintCalls, 3, 'persistent failures are retried before and through expiry');
await assert.rejects(
  admitAppBindingV1(failurePublisher.current, descriptor(), {
    now: failureNow,
    delivery: { channel: 'local-supervised-ipc' },
  }),
  (error) => error.code === 'SNAPBACK_APP_BINDING_EXPIRED',
  'expiry equality is a clear refusal and never stale-serves the predecessor',
);

let mutableNow = BASE_NOW;
let rawMutableSuccessor;
const canonicalPublisher = createSupervisedBindingPublisher({
  generation: 'supervisor-canonical-refresh',
  now: () => mutableNow,
  ttlMs: TEST_TTL_MS,
  refreshWindowMs: TEST_REFRESH_WINDOW_MS,
  mintRefresh(binding, timing) {
    rawMutableSuccessor = structuredClone(refreshIssuance(binding, timing));
    return rawMutableSuccessor;
  },
});
issueTestBinding(canonicalPublisher);
mutableNow = BASE_NOW + TEST_TTL_MS - TEST_REFRESH_WINDOW_MS;
const canonicalSuccessor = await canonicalPublisher.bindingForExchange();
assert.notStrictEqual(canonicalSuccessor, rawMutableSuccessor);
assertDeeplyFrozen(canonicalSuccessor);

let invalidNow = BASE_NOW;
const invalidPublisher = createSupervisedBindingPublisher({
  generation: 'supervisor-invalid-refresh',
  now: () => invalidNow,
  ttlMs: TEST_TTL_MS,
  refreshWindowMs: TEST_REFRESH_WINDOW_MS,
  mintRefresh(binding, timing) {
    const refreshed = refreshIssuance(binding, timing);
    return Object.freeze({
      ...refreshed,
      target: Object.freeze({ ...refreshed.target, origin: 'http://127.0.0.1:9999' }),
    });
  },
});
const invalidPredecessor = issueTestBinding(invalidPublisher);
invalidNow = BASE_NOW + TEST_TTL_MS - TEST_REFRESH_WINDOW_MS;
await assert.rejects(
  invalidPublisher.bindingForExchange(),
  (error) => error.code === 'SNAPBACK_EXPO_BINDING_REFRESH_INVALID',
);
assert.strictEqual(invalidPublisher.current, invalidPredecessor);

let extraFactNow = BASE_NOW;
const extraFactPublisher = createSupervisedBindingPublisher({
  generation: 'supervisor-extra-fact-refresh',
  now: () => extraFactNow,
  ttlMs: TEST_TTL_MS,
  refreshWindowMs: TEST_REFRESH_WINDOW_MS,
  mintRefresh(binding, timing) {
    return Object.freeze({
      ...refreshIssuance(binding, timing),
      sessionBearer: 'must-not-fit',
    });
  },
});
const extraFactPredecessor = issueTestBinding(extraFactPublisher);
extraFactNow = BASE_NOW + TEST_TTL_MS - TEST_REFRESH_WINDOW_MS;
await assert.rejects(
  extraFactPublisher.bindingForExchange(),
  (error) => error.code === 'SNAPBACK_EXPO_BINDING_REFRESH_INVALID',
);
assert.strictEqual(extraFactPublisher.current, extraFactPredecessor);

// Cleanup invalidates a pending refresh. This is the publisher half of the
// existing real SIGINT supervisor test in the dev-loop suite.
let cleanupNow = BASE_NOW;
let releaseCleanupMint;
let markCleanupMintStarted;
const cleanupMintStarted = new Promise((resolve) => { markCleanupMintStarted = resolve; });
const cleanupMintGate = new Promise((resolve) => { releaseCleanupMint = resolve; });
const cleanupEvents = [];
const cleanupPublisher = createSupervisedBindingPublisher({
  generation: 'supervisor-cleanup',
  now: () => cleanupNow,
  ttlMs: TEST_TTL_MS,
  refreshWindowMs: TEST_REFRESH_WINDOW_MS,
  async mintRefresh(binding, timing) {
    markCleanupMintStarted();
    await cleanupMintGate;
    return refreshIssuance(binding, timing);
  },
  onEvent: (event) => cleanupEvents.push(event),
});
issueTestBinding(cleanupPublisher);
cleanupNow = BASE_NOW + TEST_TTL_MS - TEST_REFRESH_WINDOW_MS;
const cleanupExchange = cleanupPublisher.bindingForExchange();
await cleanupMintStarted;
cleanupPublisher.close();
releaseCleanupMint();
assert.equal(await cleanupExchange, null);
assert.equal(cleanupPublisher.current, null);
assert.deepEqual(cleanupEvents, []);

const admittedOrigins = [
  'http://127.0.0.1:8081',
  'https://127.0.0.1:8081',
  'http://localhost:8081',
  'https://localhost:8081',
  'http://[::1]:8081',
  'https://[::1]:8081',
];
for (const origin of admittedOrigins) {
  assert.equal(admittedBrowserExchangeOrigin(origin), origin);
}
assert.equal(admittedBrowserExchangeOrigin('http://localhost:'), 'http://localhost:');
for (const origin of [
  undefined,
  '',
  'https://example.com:8081',
  'http://192.0.2.10:8081',
  'http://127.0.0.1',
  'http://localhost',
]) {
  assert.equal(admittedBrowserExchangeOrigin(origin), null);
}

const browserOrigin = 'http://localhost:8081';
const payload = {
  ok: true,
  format: 'snapback.expo-supervised-exchange.v1',
  binding: { appId: 'test-app' },
  session: { accessToken: 'ordinary-session' },
};
let currentPayload = payload;
let payloadFailure = null;
const payloadRequests = [];
const exchange = await startBootstrapExchange(async (request) => {
  payloadRequests.push(request);
  if (payloadFailure !== null) throw payloadFailure;
  return currentPayload;
});

try {
  const admittedGet = await fetch(`${exchange.origin}${SUPERVISED_EXCHANGE_PATH}`, {
    headers: { Origin: browserOrigin },
  });
  assert.equal(admittedGet.status, 200);
  assert.equal(admittedGet.headers.get('access-control-allow-origin'), browserOrigin);
  assert.equal(admittedGet.headers.get('vary'), 'Origin');
  assert.equal(admittedGet.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
  assert.equal(admittedGet.headers.get('access-control-allow-headers'), 'accept');
  assert.deepEqual(await admittedGet.json(), payload);
  assert.deepEqual(payloadRequests.at(-1), { requestAuthority: false });

  const authorityGet = await fetch(
    `${exchange.origin}${SUPERVISED_EXCHANGE_PATH}?authority=mint`,
    { headers: { Origin: browserOrigin } },
  );
  assert.equal(authorityGet.status, 200);
  assert.deepEqual(await authorityGet.json(), payload);
  assert.deepEqual(payloadRequests.at(-1), { requestAuthority: true });

  const requestsBeforeInvalidQuery = payloadRequests.length;
  const invalidAuthorityGet = await fetch(
    `${exchange.origin}${SUPERVISED_EXCHANGE_PATH}?authority=ambient`,
    { headers: { Origin: browserOrigin } },
  );
  assert.equal(invalidAuthorityGet.status, 404);
  assert.equal(payloadRequests.length, requestsBeforeInvalidQuery);

  const preflight = await fetch(`${exchange.origin}${SUPERVISED_EXCHANGE_PATH}`, {
    method: 'OPTIONS',
    headers: {
      Origin: browserOrigin,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'accept',
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), browserOrigin);
  assert.match(preflight.headers.get('access-control-allow-methods'), /\bGET\b/u);
  assert.equal(preflight.headers.get('access-control-max-age'), '600');
  assert.equal(await preflight.text(), '');

  const unadmittedGet = await fetch(`${exchange.origin}${SUPERVISED_EXCHANGE_PATH}`, {
    headers: { Origin: 'http://192.0.2.10:8081' },
  });
  assert.equal(unadmittedGet.status, 200);
  assert.equal(unadmittedGet.headers.get('access-control-allow-origin'), null);
  assert.equal(unadmittedGet.headers.get('access-control-allow-methods'), null);
  assert.deepEqual(await unadmittedGet.json(), payload);

  const originlessGet = await fetch(`${exchange.origin}${SUPERVISED_EXCHANGE_PATH}`);
  assert.equal(originlessGet.status, 200);
  assert.equal(originlessGet.headers.get('access-control-allow-origin'), null);
  assert.equal(originlessGet.headers.get('access-control-allow-methods'), null);
  assert.equal(originlessGet.headers.get('cache-control'), 'no-store, max-age=0');
  assert.deepEqual(await originlessGet.json(), payload);

  payloadFailure = new Error('injected lazy refresh failure');
  const failedRefreshGet = await fetch(`${exchange.origin}${SUPERVISED_EXCHANGE_PATH}`);
  assert.equal(failedRefreshGet.status, 503);
  assert.deepEqual(await failedRefreshGet.json(), {
    ok: false,
    code: 'SNAPBACK_EXPO_BOOTSTRAP_UNAVAILABLE',
  });
  payloadFailure = null;

  currentPayload = null;
  const unavailableGet = await fetch(`${exchange.origin}${SUPERVISED_EXCHANGE_PATH}`, {
    headers: { Origin: browserOrigin },
  });
  assert.equal(unavailableGet.status, 503);
  assert.equal(unavailableGet.headers.get('access-control-allow-origin'), browserOrigin);
  assert.deepEqual(await unavailableGet.json(), {
    ok: false,
    code: 'SNAPBACK_EXPO_BOOTSTRAP_UNAVAILABLE',
  });

  const missingGet = await fetch(`${exchange.origin}/not-the-bootstrap`, {
    headers: { Origin: browserOrigin },
  });
  assert.equal(missingGet.status, 404);
  assert.equal(missingGet.headers.get('access-control-allow-origin'), browserOrigin);

  const noHandlerControl = await fetch(`${exchange.origin}${SUPERVISED_CONTROL_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ verb: 'dev-fresh' }),
  });
  assert.equal(noHandlerControl.status, 404);
  assert.deepEqual(await noHandlerControl.json(), {
    ok: false,
    code: 'SNAPBACK_EXPO_BOOTSTRAP_ROUTE_NOT_FOUND',
  });

  const missingPreflight = await fetch(`${exchange.origin}/not-the-bootstrap`, {
    method: 'OPTIONS',
    headers: { Origin: browserOrigin },
  });
  assert.equal(missingPreflight.status, 404);
  assert.equal(missingPreflight.headers.get('access-control-allow-origin'), browserOrigin);
  assert.deepEqual(await missingPreflight.json(), {
    ok: false,
    code: 'SNAPBACK_EXPO_BOOTSTRAP_ROUTE_NOT_FOUND',
  });

  console.log('expo-bootstrap-exchange.test.mjs: scoped loopback CORS, binding-only and explicit authority requests, preflight, payload refusal, and route handling pass');
} finally {
  await exchange.close();
}
