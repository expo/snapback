import assert from 'node:assert/strict';

import { createMicroCoreRuntime } from './micro-core.mjs';
import { withMicroLive } from './micro-live.mjs';

const createMicroRuntime = (options) => withMicroLive(createMicroCoreRuntime(options));

const generation = Object.freeze({
  schemaVersion: 'snapback.v0',
  appId: 'micro-test',
  schemaHash: `sha256:${'1'.repeat(64)}`,
  bundleHash: `sha256:${'2'.repeat(64)}`,
  inputsHash: `sha256:${'3'.repeat(64)}`,
});
const grant = {
  connectionId: 'micro-wire',
  connectionToken: 'micro-token',
  wireVersion: 'snapback.v1',
};
const mutationOutput = (result = null) => ({
  version: 1,
  changed_count: 1,
  result,
  authorityDescriptor: { descriptorVersion: 1 },
  receipt: { kind: 'mutation' },
});
const durable = (frame) => ({
  Durable: {
    payload: [...new TextEncoder().encode(JSON.stringify(frame))],
  },
});

{
  const requests = [];
  let queryAttempts = 0;
  const runtime = createMicroRuntime({
    endpoint: 'http://micro.test',
    expectedGeneration: generation,
    fetch: async (url, init) => {
      const path = new URL(url).pathname;
      requests.push({ path, init, body: init.body ? JSON.parse(init.body) : null });
      if (path === '/query/listTodos' && queryAttempts++ === 0) throw new TypeError('offline');
      if (path === '/query/listTodos') return Response.json({ version: 1, rows: [{ _id: 'todo_1' }] });
      if (path === '/mutation/createTodo') return Response.json(mutationOutput('todo_2'));
      if (path === '/action/echo') return Response.json({ ok: true, result: 'ok' });
      throw new Error(`unexpected ${path}`);
    },
  });
  assert.deepEqual(
    await runtime.invoke({ name: 'listTodos', kind: 'Query' }, {}),
    { version: 1, rows: [{ _id: 'todo_1' }] },
  );
  assert.equal(queryAttempts, 2, 'reads take the one bounded transport retry');
  assert.equal((await runtime.invoke({ name: 'createTodo', kind: 'Mutation' }, {})).result, 'todo_2');
  assert.equal((await runtime.invoke({ name: 'echo', kind: 'Action' }, {})).result, 'ok');
  assert.deepEqual(
    requests[0].body.expectedGeneration,
    generation,
    'every generated invocation carries the shared generation',
  );
  assert.equal(
    requests.find(({ path }) => path === '/mutation/createTodo').body.clientMutationId,
    undefined,
    'Micro v1 never emits the Full settlement identity',
  );
  await runtime.dispose();
}

{
  let attempts = 0;
  const runtime = createMicroRuntime({
    endpoint: 'http://micro.test',
    expectedGeneration: generation,
    fetch: async () => {
      attempts += 1;
      throw new TypeError('connection lost after dispatch');
    },
  });
  await assert.rejects(
    runtime.invoke({ name: 'createTodo', kind: 'Mutation' }, {}),
    (error) => error.code === 'SNAPBACK_MICRO_INDETERMINATE_OUTCOME',
  );
  assert.equal(attempts, 1, 'an ambiguous mutation is never retried');
}

for (const [name, response, code] of [
  ['non-json', new Response('<html>', { status: 200 }), 'SNAPBACK_MICRO_RESPONSE_NOT_JSON'],
  ['wrong query envelope', Response.json({ ok: true, result: [] }), 'SNAPBACK_MICRO_ENVELOPE_INVALID'],
  ['malformed cursor', Response.json({ version: 1, rows: [], cursor: 3 }), 'SNAPBACK_MICRO_ENVELOPE_INVALID'],
  ['malformed diagnostic', Response.json({ diagnostic: { code: 3 } }, { status: 400 }), 'SNAPBACK_MICRO_DIAGNOSTIC_INVALID'],
]) {
  const runtime = createMicroRuntime({
    endpoint: 'http://micro.test',
    expectedGeneration: generation,
    fetch: async () => response,
  });
  await assert.rejects(
    runtime.invoke({ name: 'listTodos', kind: 'Query' }, {}),
    (error) => error.code === code,
    name,
  );
}

for (const [name, response] of [
  ['malformed mutation success', Response.json({ version: 1, result: null })],
  ['over-budget mutation success', Response.json(mutationOutput('x'))],
]) {
  const runtime = createMicroRuntime({
    endpoint: 'http://micro.test',
    expectedGeneration: generation,
    maximumResponseBytes: name.startsWith('over-budget') ? 8 : 4 * 1024 * 1024,
    fetch: async () => response,
  });
  await assert.rejects(
    runtime.invoke({ name: 'createTodo', kind: 'Mutation' }, {}),
    (error) => error.code === 'SNAPBACK_MICRO_INDETERMINATE_OUTCOME',
    name,
  );
}

{
  const runtime = createMicroRuntime({
    endpoint: 'http://micro.test',
    expectedGeneration: generation,
    maximumResponseBytes: 8,
    fetch: async () => Response.json({ version: 1, rows: [] }),
  });
  await assert.rejects(
    runtime.invoke({ name: 'listTodos', kind: 'Query' }, {}),
    (error) => error.code === 'SNAPBACK_MICRO_RESPONSE_TOO_LARGE',
  );
}

{
  let release;
  const runtime = createMicroRuntime({
    endpoint: 'http://micro.test',
    expectedGeneration: generation,
    fetch: async () => {
      await new Promise((resolve) => { release = resolve; });
      return Response.json({ version: 1, rows: [] });
    },
  });
  const predecessor = runtime.invoke({ name: 'listTodos', kind: 'Query' }, {});
  await new Promise((resolve) => setTimeout(resolve, 0));
  const transition = runtime.setIdentity('successor');
  release();
  await transition;
  await assert.rejects(
    predecessor,
    (error) => error.code === 'SNAPBACK_MICRO_AUTHORITY_STALE',
    'a delayed predecessor cannot publish after the identity transition',
  );
}

{
  let release;
  const runtime = createMicroRuntime({
    endpoint: 'http://micro.test',
    expectedGeneration: generation,
    fetch: async () => {
      await new Promise((resolve) => { release = resolve; });
      return Response.json(mutationOutput('maybe'));
    },
  });
  const predecessor = runtime.invoke({ name: 'createTodo', kind: 'Mutation' }, {});
  await new Promise((resolve) => setTimeout(resolve, 0));
  const transition = runtime.setIdentity('successor');
  release();
  await transition;
  await assert.rejects(
    predecessor,
    (error) => error.code === 'SNAPBACK_MICRO_INDETERMINATE_OUTCOME',
    'an effectful authority race stays indeterminate while publication remains fenced',
  );
}

{
  let subscription = 0;
  const outbox = [];
  const updates = [];
  const requests = [];
  const runtime = createMicroRuntime({
    endpoint: 'http://micro.test',
    expectedGeneration: generation,
    userId: 'ada',
    fetch: async (url, init) => {
      const path = new URL(url).pathname;
      const body = init.body ? JSON.parse(init.body) : null;
      requests.push({ path, body, headers: new Headers(init.headers) });
      if (path === '/connection/open') return Response.json(grant);
      if (path === '/live/watchTodos/subscribe') {
        subscription += 1;
        return Response.json({
          subscription_id: `sub_${subscription}`,
          snapshot: {
            version: subscription === 1 ? 1 : subscription + 3,
            rows: [{ _id: `snapshot_${subscription}` }],
          },
          permission_epochs: {},
          ...(body.supersedes ? { superseded: body.supersedes } : {}),
        });
      }
      if (path === '/live/watchTodos/unsubscribe') {
        return Response.json({ subscription_id: body.subscription_id, disposed: true });
      }
      if (path === '/outbox/micro-wire') return Response.json(outbox.splice(0));
      throw new Error(`unexpected ${path}`);
    },
  });
  const handle = await runtime.subscribe(
    { name: 'watchTodos', kind: 'LiveQuery' },
    {},
    { onUpdate: (rows, detail) => updates.push({ rows, detail }) },
  );
  assert.deepEqual(handle.rows, [{ _id: 'snapshot_1' }]);
  outbox.push(
    durable({ kind: 'future_kind', value: true }),
    durable({
      kind: 'live_delta',
      subscription_id: 'sub_1',
      function: 'watchTodos',
      version: 2,
      ops: [{ op: 'add', id: 'todo_2', row: { _id: 'todo_2' } }],
    }),
  );
  await handle.poll();
  assert.deepEqual(handle.rows, [{ _id: 'snapshot_1' }, { _id: 'todo_2' }]);
  outbox.push(
    { Durable: 3 },
    { Durable: { payload: [255] } },
    durable({
      kind: 'live_delta',
      subscription_id: 'sub_1',
      function: 'watchTodos',
      version: 3,
      ops: [{ op: 'add', id: 'todo_3', row: { _id: 'todo_3' } }],
    }),
  );
  await assert.rejects(
    handle.poll(),
    (error) => error.code === 'SNAPBACK_MICRO_LIVE_DECODE_FAILED',
    'a malformed post-cut item is surfaced only after the valid batch remainder is processed and state resnapshots',
  );
  assert.deepEqual(handle.rows, [{ _id: 'snapshot_2' }]);
  outbox.push(durable({
    kind: 'live_replace',
    subscription_id: 'sub_2',
    function: 'watchTodos',
    version: 10,
    rows: [{ _id: 'gap' }],
  }));
  await handle.poll();
  assert.deepEqual(handle.rows, [{ _id: 'snapshot_3' }], 'a version gap blanks and resnapshots');
  await runtime.setIdentity('grace');
  assert.deepEqual(handle.rows, [{ _id: 'snapshot_4' }], 'identity change blanks then establishes a successor snapshot');
  assert.ok(
    updates.some(({ detail, rows }) => detail.kind === 'blank' && rows.length === 0),
    'blanking is observable before resnapshot publication',
  );
  await handle.dispose();
  assert.ok(
    requests.some(({ path }) => path.endsWith('/unsubscribe')),
    'normal disposal explicitly unsubscribes with the grant owner',
  );
  assert.ok(
    requests
      .filter(({ path }) => path.includes('/live/') || path.startsWith('/outbox/'))
      .every(({ headers }) => headers.get('x-snapback-connection-token') === 'micro-token'),
    'every grant-owned live route carries the connection token',
  );
}

{
  let subscribeAttempts = 0;
  let outboxDrains = 0;
  const runtime = createMicroRuntime({
    endpoint: 'http://micro.test',
    expectedGeneration: generation,
    requireGenerationFacts: true,
    fetch: async (url, init) => {
      const path = new URL(url).pathname;
      if (path === '/connection/open') return Response.json(grant);
      if (path === '/live/watchTodos/subscribe') {
        subscribeAttempts += 1;
        if (subscribeAttempts > 1) {
          return Response.json({
            subscription_id: 'sub_nonconforming_success',
            snapshot: { version: 2, rows: [{ _id: 'must-not-publish' }] },
            permission_epochs: {},
            facts: { activeGeneration: { ...generation, bundleHash: 'sha256:successor' } },
            superseded: 'sub_stale',
          });
        }
        return Response.json({
          subscription_id: 'sub_stale',
          snapshot: { version: 1, rows: [] },
          permission_epochs: {},
          facts: { activeGeneration: generation },
        });
      }
      if (path === '/outbox/micro-wire') {
        outboxDrains += 1;
        return Response.json([durable({
          kind: 'resync_required',
          reason: 'auth_deployment_activated',
          subscription_id: 'sub_stale',
          clear_retained: true,
        })]);
      }
      if (path === '/live/watchTodos/unsubscribe') return Response.json({ disposed: true });
      throw new Error(`unexpected ${path}`);
    },
  });
  const handle = await runtime.subscribe({ name: 'watchTodos', kind: 'LiveQuery' });
  await assert.rejects(handle.poll(), (error) => error.code === 'SNAPBACK_MICRO_STALE_ARTIFACT');
  await assert.rejects(handle.poll(), (error) => error.code === 'SNAPBACK_MICRO_STALE_ARTIFACT');
  assert.equal(subscribeAttempts, 2, 'a stale generated client makes one refused resubscribe and stops');
  assert.equal(outboxDrains, 1, 'the stopped client never polls or loops again');
  await handle.dispose();
}

{
  let opens = 0;
  let subscribes = 0;
  let drains = 0;
  const runtime = createMicroRuntime({
    endpoint: 'http://micro.test',
    expectedGeneration: generation,
    requireGenerationFacts: true,
    fetch: async (url) => {
      const path = new URL(url).pathname;
      if (path === '/connection/open') {
        opens += 1;
        return Response.json({
          connectionId: `stale-reconnect-wire-${opens}`,
          connectionToken: `stale-reconnect-token-${opens}`,
          wireVersion: 'snapback.v1',
        });
      }
      if (path === '/live/watchTodos/subscribe') {
        subscribes += 1;
        return Response.json({
          subscription_id: `stale-reconnect-sub-${subscribes}`,
          snapshot: { version: subscribes, rows: [{ _id: `candidate-${subscribes}` }] },
          permission_epochs: {},
          facts: {
            activeGeneration: subscribes === 1
              ? generation
              : { ...generation, inputsHash: 'sha256:stale-successor' },
          },
        });
      }
      if (path.startsWith('/outbox/')) {
        drains += 1;
        throw new TypeError('connection lost before fresh grant');
      }
      if (path === '/live/watchTodos/unsubscribe') return Response.json({ disposed: true });
      throw new Error(`unexpected ${path}`);
    },
  });
  const handle = await runtime.subscribe({ name: 'watchTodos', kind: 'LiveQuery' });
  await assert.rejects(
    handle.poll(),
    (error) => error.code === 'SNAPBACK_MICRO_STALE_ARTIFACT',
    'a non-conforming fresh-grant success permanently stops the generated client',
  );
  await assert.rejects(handle.poll(), (error) => error.code === 'SNAPBACK_MICRO_STALE_ARTIFACT');
  assert.equal(opens, 2, 'transport loss opens exactly one successor grant');
  assert.equal(subscribes, 2, 'the refused successor snapshot is attempted once');
  assert.equal(drains, 1, 'the stopped client never drains or resubscribes again');
  assert.deepEqual(handle.rows, [], 'a refused successor never becomes readable');
  await handle.dispose();
}

{
  let opens = 0;
  let subscribes = 0;
  let rejectGrant = true;
  const updates = [];
  const runtime = createMicroRuntime({
    endpoint: 'http://micro.test',
    expectedGeneration: generation,
    fetch: async (url, init) => {
      const path = new URL(url).pathname;
      if (path === '/connection/open') {
        opens += 1;
        return Response.json({
          connectionId: `reconnect-wire-${opens}`,
          connectionToken: `reconnect-token-${opens}`,
          wireVersion: 'snapback.v1',
        });
      }
      if (path === '/live/watchTodos/subscribe') {
        subscribes += 1;
        return Response.json({
          subscription_id: `reconnect-sub-${subscribes}`,
          snapshot: { version: subscribes, rows: [{ _id: `fresh-${subscribes}` }] },
          permission_epochs: {},
        });
      }
      if (path.startsWith('/outbox/')) {
        if (rejectGrant) {
          rejectGrant = false;
          return Response.json({
            diagnostic: {
              code: 'SNAPBACK_CONNECTION_TOKEN_INVALID',
              message: 'the connection grant was reaped',
            },
          }, { status: 403 });
        }
        return Response.json([]);
      }
      if (path === '/live/watchTodos/unsubscribe') return Response.json({ disposed: true });
      throw new Error(`unexpected ${path} ${init.method}`);
    },
  });
  const handle = await runtime.subscribe(
    { name: 'watchTodos', kind: 'LiveQuery' },
    {},
    { onUpdate: (rows, detail) => updates.push({ rows, detail }) },
  );
  await handle.poll();
  assert.equal(opens, 2, 'grant loss reopens a new grant');
  assert.equal(subscribes, 2, 'grant loss completely re-establishes the subscription');
  assert.deepEqual(handle.rows, [{ _id: 'fresh-2' }]);
  assert.ok(updates.some(({ detail }) => detail.kind === 'blank'));
  await handle.dispose();
}

{
  const runtime = createMicroRuntime({
    endpoint: 'http://micro.test',
    expectedGeneration: generation,
    fetch: async () => Response.json({ ...grant, wireVersion: undefined }),
  });
  await assert.rejects(
    runtime.subscribe({ name: 'watchTodos', kind: 'LiveQuery' }),
    (error) => error.code === 'SNAPBACK_MICRO_LIVE_GRANT_INVALID',
    'an offered wire version must be echoed before a live grant is trusted',
  );
}

console.log('micro client tests passed');
