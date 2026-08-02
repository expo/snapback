import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { SnapbackClient } from './index.mjs';
import { createMicroCoreRuntime } from './micro-core.mjs';
import { withMicroLive } from './micro-live.mjs';

const encoder = new TextEncoder();
const endpoint = 'http://micro-operational.test';
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
  let requestBytes = 0;
  let responseBytes = 0;
  let roundTrips = 0;
  const fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const bodyText = typeof init.body === 'string' ? init.body : '';
    const answer = await route(path, bodyText === '' ? null : JSON.parse(bodyText), init);
    const responseText = JSON.stringify(answer.body);
    if (enabled) {
      requestBytes += encoder.encode(bodyText).byteLength;
      responseBytes += encoder.encode(responseText).byteLength;
      roundTrips += 1;
    }
    return new Response(responseText, {
      status: answer.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return {
    fetch,
    start() { enabled = true; },
    stop() { enabled = false; },
    receipt() {
      return Object.freeze({
        requestBytes,
        responseBytes,
        totalBytes: requestBytes + responseBytes,
        roundTrips,
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
          connectionId: 'full-wire',
          connectionToken: 'full-token',
          wireVersion: 'snapback.v1',
        },
      };
    }
    if (path === '/live/watchTodos/subscribe') {
      subscriptions += 1;
      return {
        body: {
          subscription_id: subscriptions === 1 ? 'sub-1' : `full-sub-${subscriptions}`,
          snapshot: { version: subscriptions, rows: [{ _id: `full-${subscriptions}` }] },
          permission_epochs: {},
          ...(body.supersedes ? { superseded: body.supersedes } : {}),
        },
      };
    }
    if (path === '/outbox/full-wire') {
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
      connectionId: 'full-wire',
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
    assert.deepEqual(handle.rows, [{ _id: 'full-2' }]);
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
          connectionId: 'micro-wire',
          connectionToken: 'micro-token',
          wireVersion: 'snapback.v1',
        },
      };
    }
    if (path === '/live/watchTodos/subscribe') {
      subscriptions += 1;
      return {
        body: {
          subscription_id: subscriptions === 1 ? 'sub-1' : `micro-sub-${subscriptions}`,
          snapshot: { version: subscriptions, rows: [{ _id: `micro-${subscriptions}` }] },
          permission_epochs: {},
          ...(body.supersedes ? { superseded: body.supersedes } : {}),
        },
      };
    }
    if (path === '/outbox/micro-wire') {
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
  assert.deepEqual(handle.rows, [{ _id: 'micro-2' }]);
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

const [fullReconnect, microReconnect] = await Promise.all([
  measureFullReconnect(),
  measureMicroReconnect(),
]);
const startup = {
  fullMillisecondsP50: median(Array.from({ length: 7 }, () => startupSample('full'))),
  microMillisecondsP50: median(Array.from({ length: 7 }, () => startupSample('micro'))),
};

assert.ok(
  microReconnect.totalBytes <= fullReconnect.totalBytes,
  `Micro reconnect ${microReconnect.totalBytes} B exceeds Full ${fullReconnect.totalBytes} B`,
);
assert.ok(
  microReconnect.roundTrips <= fullReconnect.roundTrips,
  `Micro reconnect ${microReconnect.roundTrips} rounds exceeds Full ${fullReconnect.roundTrips}`,
);
assert.ok(
  startup.microMillisecondsP50 <= startup.fullMillisecondsP50,
  `Micro startup ${startup.microMillisecondsP50} ms exceeds Full ${startup.fullMillisecondsP50} ms`,
);

console.log(JSON.stringify({
  artifactKind: 'snapback.micro-phase-b-operational.v1',
  workload: 'poll/local resync_required followed by exact superseding snapshot',
  fullReconnect,
  microReconnect,
  startup,
}));
