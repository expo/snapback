import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { SnapbackClient } from './index.mjs';
import { createMicroCoreRuntime } from './micro-core.mjs';
import { withMicroLive } from './micro-live.mjs';

const encoder = new TextEncoder();
const endpoint = 'http://micro-operational.test';
const wireId = 'comparison-wire';
const wireToken = 'comparison-token';
const generation = Object.freeze({
  schemaVersion: 'snapback.v0',
  appId: 'micro-operational',
  schemaHash: `sha256:${'1'.repeat(64)}`,
  bundleHash: `sha256:${'2'.repeat(64)}`,
  inputsHash: `sha256:${'3'.repeat(64)}`,
});
const operation = Object.freeze({
  artifactKind: 'functionReference',
  name: 'watchTodos',
  kind: 'LiveQuery',
  argsContract: { kind: 'object', fields: [] },
  expectedGeneration: generation,
});
const resync = {
  kind: 'resync_required',
  reason: 'live_refresh_failed',
  subscription_id: 'sub-1',
  clear_retained: false,
};
const durable = {
  Durable: {
    payload: [...encoder.encode(JSON.stringify(resync))],
  },
};

function meteredRouter(route) {
  let enabled = false;
  let startedAt = null;
  let stoppedAt = null;
  let requestBytes = 0;
  let responseBytes = 0;
  let roundTrips = 0;
  const exchanges = [];
  const fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const bodyText = typeof init.body === 'string' ? init.body : '';
    const answer = await route(path, bodyText === '' ? null : JSON.parse(bodyText), init);
    const responseText = JSON.stringify(answer.body);
    if (enabled) {
      const requestBodyBytes = encoder.encode(bodyText).byteLength;
      const responseBodyBytes = encoder.encode(responseText).byteLength;
      requestBytes += requestBodyBytes;
      responseBytes += responseBodyBytes;
      roundTrips += 1;
      exchanges.push(Object.freeze({
        method: init.method,
        path,
        requestBodyBytes,
        responseBodyBytes,
      }));
    }
    return new Response(responseText, {
      status: answer.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return {
    fetch,
    start() {
      startedAt = performance.now();
      stoppedAt = null;
      enabled = true;
    },
    stop() {
      stoppedAt = performance.now();
      enabled = false;
    },
    receipt() {
      assert.notEqual(startedAt, null, 'meter must be started');
      assert.notEqual(stoppedAt, null, 'meter must be stopped');
      return Object.freeze({
        requestBodyBytes: requestBytes,
        responseBodyBytes: responseBytes,
        totalBodyBytes: requestBytes + responseBytes,
        roundTrips,
        latencyMilliseconds: stoppedAt - startedAt,
        exchanges: Object.freeze(exchanges),
      });
    },
  };
}

async function measureFullReconnect() {
  let subscriptions = 0;
  let drain = true;
  let resolveResubscribed;
  const resubscribed = new Promise((resolve) => { resolveResubscribed = resolve; });
  const meter = meteredRouter(async (path, body) => {
    if (path === '/connection/open') {
      return {
        body: {
          connectionId: wireId,
          connectionToken: wireToken,
          wireVersion: 'snapback.v1',
        },
      };
    }
    if (path === '/live/watchTodos/subscribe') {
      subscriptions += 1;
      return {
        body: {
          subscription_id: `sub-${subscriptions}`,
          snapshot: { version: subscriptions, rows: [{ _id: `row-${subscriptions}` }] },
          permission_epochs: {},
          ...(body.supersedes ? { superseded: body.supersedes } : {}),
        },
      };
    }
    if (path === `/outbox/${wireId}`) {
      const batch = drain ? [durable] : [];
      drain = false;
      return { body: batch };
    }
    if (path === '/live/watchTodos/unsubscribe') return { body: { disposed: true } };
    throw new Error(`unexpected Full request ${path}`);
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = meter.fetch;
  try {
    const client = new SnapbackClient(endpoint, {
      rqsStore: null,
      offlineQueue: false,
      strictWireVersion: true,
      ephemeralExpiryProtocol: null,
    });
    const handle = await client.liveQuery(operation, {
      connectionId: wireId,
      transport: 'poll',
      persistResume: false,
      onSubscriptionEvent(receipt) {
        if (receipt.event === 'resubscribed') resolveResubscribed();
      },
    });
    meter.start();
    await handle.poll();
    await Promise.race([
      resubscribed,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Full resubscribe timed out')), 1_000)),
    ]);
    meter.stop();
    assert.deepEqual(handle.rows, [{ _id: 'row-2' }]);
    await handle.dispose();
    return meter.receipt();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function measureMicroReconnect() {
  let subscriptions = 0;
  let drain = true;
  const meter = meteredRouter(async (path, body) => {
    if (path === '/connection/open') {
      return {
        body: {
          connectionId: wireId,
          connectionToken: wireToken,
          wireVersion: 'snapback.v1',
        },
      };
    }
    if (path === '/live/watchTodos/subscribe') {
      subscriptions += 1;
      return {
        body: {
          subscription_id: `sub-${subscriptions}`,
          snapshot: { version: subscriptions, rows: [{ _id: `row-${subscriptions}` }] },
          permission_epochs: {},
          ...(body.supersedes ? { superseded: body.supersedes } : {}),
        },
      };
    }
    if (path === `/outbox/${wireId}`) {
      const batch = drain ? [durable] : [];
      drain = false;
      return { body: batch };
    }
    if (path === '/live/watchTodos/unsubscribe') return { body: { disposed: true } };
    throw new Error(`unexpected Micro request ${path}`);
  });
  const runtime = withMicroLive(createMicroCoreRuntime({
    endpoint,
    expectedGeneration: generation,
    fetch: meter.fetch,
  }));
  const handle = await runtime.subscribe(operation);
  meter.start();
  await handle.poll();
  meter.stop();
  assert.deepEqual(handle.rows, [{ _id: 'row-2' }]);
  await handle.dispose();
  return meter.receipt();
}

function startupSample(kind) {
  const source = kind === 'full'
    ? `const t=performance.now();const {SnapbackClient}=await import('./packages/snapback-client/index.mjs');new SnapbackClient('${endpoint}',{rqsStore:null,offlineQueue:false});console.log(performance.now()-t)`
    : `const t=performance.now();const [{createMicroCoreRuntime},{withMicroLive}]=await Promise.all([import('./packages/snapback-client/micro-core.mjs'),import('./packages/snapback-client/micro-live.mjs')]);withMicroLive(createMicroCoreRuntime({endpoint:'${endpoint}',expectedGeneration:${JSON.stringify(generation)},fetch:async()=>{throw new Error('unused')}}));console.log(performance.now()-t)`;
  const run = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: new URL('../..', import.meta.url),
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  const value = Number(run.stdout.trim());
  assert.ok(Number.isFinite(value) && value >= 0, `invalid ${kind} startup sample`);
  return value;
}

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)];
}

function reconnectSummary(samples) {
  const shape = ({ latencyMilliseconds: _latency, ...receipt }) => receipt;
  for (const sample of samples.slice(1)) {
    assert.deepEqual(shape(sample), shape(samples[0]), 'reconnect byte and request shape is deterministic');
  }
  return Object.freeze({
    ...shape(samples[0]),
    latencyMillisecondsP50: median(samples.map(({ latencyMilliseconds }) => latencyMilliseconds)),
    latencySamplesMilliseconds: Object.freeze(samples.map(({ latencyMilliseconds }) => latencyMilliseconds)),
  });
}

const fullReconnectSamples = [];
const microReconnectSamples = [];
const fullStartupSamples = [];
const microStartupSamples = [];
for (let sample = 0; sample < 9; sample += 1) {
  if (sample % 2 === 0) {
    fullReconnectSamples.push(await measureFullReconnect());
    microReconnectSamples.push(await measureMicroReconnect());
    fullStartupSamples.push(startupSample('full'));
    microStartupSamples.push(startupSample('micro'));
  } else {
    microReconnectSamples.push(await measureMicroReconnect());
    fullReconnectSamples.push(await measureFullReconnect());
    microStartupSamples.push(startupSample('micro'));
    fullStartupSamples.push(startupSample('full'));
  }
}
const fullReconnect = reconnectSummary(fullReconnectSamples);
const microReconnect = reconnectSummary(microReconnectSamples);
const startup = Object.freeze({
  samples: 9,
  fullMillisecondsP50: median(fullStartupSamples),
  microMillisecondsP50: median(microStartupSamples),
  fullSamplesMilliseconds: Object.freeze(fullStartupSamples),
  microSamplesMilliseconds: Object.freeze(microStartupSamples),
});

assert.ok(
  microReconnect.totalBodyBytes <= fullReconnect.totalBodyBytes,
  `Micro reconnect ${microReconnect.totalBodyBytes} B exceeds Full ${fullReconnect.totalBodyBytes} B`,
);
assert.ok(
  microReconnect.roundTrips <= fullReconnect.roundTrips,
  `Micro reconnect ${microReconnect.roundTrips} rounds exceeds Full ${fullReconnect.roundTrips}`,
);
assert.ok(
  microReconnect.latencyMillisecondsP50 <= fullReconnect.latencyMillisecondsP50,
  `Micro reconnect ${microReconnect.latencyMillisecondsP50} ms exceeds Full ${fullReconnect.latencyMillisecondsP50} ms`,
);
assert.ok(
  startup.microMillisecondsP50 <= startup.fullMillisecondsP50,
  `Micro startup ${startup.microMillisecondsP50} ms exceeds Full ${startup.fullMillisecondsP50} ms`,
);

console.log(JSON.stringify({
  artifactKind: 'snapback.micro-phase-b-operational.v1',
  workload: 'poll/local resync_required followed by exact superseding snapshot; UTF-8 JSON body bytes exclude equal transport framing and headers',
  fullReconnect,
  microReconnect,
  startup,
}));
