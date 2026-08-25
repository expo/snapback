// Render-first surface mode (ENG-23736): links return synchronously with
// every binding pending; connection + subscription establishment run in the
// background with capped backoff; bindings go live in place on attach.
//
// Pure mock client/runtime; runs under plain node (no server, no Exact).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createRenderFirstSnapbackContractSurface, createDeferredContractLinks } from './index.mjs';

// Exact's Hermes fallback lowers this intentional barrel cycle to CommonJS.
// Named imports snapshot the still-partial exports object during startup;
// the namespace import remains live as the core adapter finishes initializing.
{
  const source = readFileSync(new URL('./render-first.mjs', import.meta.url), 'utf8');
  assert.match(source, /import \* as snapbackContract from '\.\/index\.mjs';/);
  assert.doesNotMatch(source, /import \{[^}]*createSnapbackContractSurface[^}]*\} from '\.\/index\.mjs';/s);
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const until = async (predicate, label, timeoutMs = 2_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await tick();
  }
};

const makeManifest = () => ({
  artifactKind: 'contractDataManifest',
  manifestVersion: 2,
  queries: {
    alpha: { mode: 'live', defaultLive: true },
    beta: { mode: 'snapshot', subscription: 'none' },
  },
  mutations: { doThing: {} },
});

const connectivityFailure = (message = 'Failed to fetch') => {
  const dispatchFailure = new Error(message);
  dispatchFailure.fetchDispatchFailed = true;
  const error = new Error(`SNAPBACK_CLIENT_REFUSED: ${message}`, { cause: dispatchFailure });
  error.diagnostic = {
    code: 'SNAPBACK_CLIENT_REFUSED',
    message,
  };
  return error;
};

const codeOnlyClientRefusal = () => {
  const error = new Error('SNAPBACK_CLIENT_REFUSED: malformed response');
  error.diagnostic = {
    code: 'SNAPBACK_CLIENT_REFUSED',
    message: 'malformed response',
  };
  return error;
};

const httpError = (status = 502) => {
  const error = new Error(`SNAPBACK_HTTP_ERROR: HTTP ${status} with non-JSON body`);
  error.status = status;
  error.diagnostic = {
    code: 'SNAPBACK_HTTP_ERROR',
    message: `HTTP ${status} with non-JSON body`,
  };
  return error;
};

// Mock kit client: liveQuery handles record their onUpdate fan-out so the
// test can push server rows. Failure counters throw diagnostic-bearing,
// transport-proven connectivity errors for the first N calls.
const makeClient = ({ failures = 0, liveFailures = 0 } = {}) => {
  const state = { healthCalls: 0, liveQueryCalls: 0, mutations: [], handles: [] };
  return {
    state,
    async health() {
      state.healthCalls += 1;
      if (state.healthCalls <= failures) {
        throw connectivityFailure(`health failed (${state.healthCalls})`);
      }
    },
    async liveQuery(name, { onUpdate }) {
      state.liveQueryCalls += 1;
      if (state.liveQueryCalls <= liveFailures) {
        throw connectivityFailure(`live subscribe failed (${state.liveQueryCalls})`);
      }
      const handle = {
        name,
        rows: [],
        connection: 'live',
        disposed: false,
        onUpdate,
        dispose() {
          this.disposed = true;
        },
      };
      state.handles.push(handle);
      return handle;
    },
    async query() {
      return { rows: [] };
    },
    async mutate(name, { args }) {
      state.mutations.push({ name, args });
    },
  };
};

// Mock Exact runtime: provider-backed query handles subscribe through the
// boundary so a boundary.write (the live push path) reaches subscribers.
const makeRuntime = ({ subscriptionDisposeError = null } = {}) => {
  const cells = new Map(); // key -> rows
  const observers = new Map(); // key -> Set<notify>
  const boundary = {
    write(key, produce) {
      cells.set(key, produce(cells.get(key) ?? []));
      for (const notify of [...(observers.get(key) ?? [])]) notify(cells.get(key));
    },
    query(key) {
      return { key };
    },
  };
  return {
    createContractMockQueryBoundary(initialRows) {
      for (const [key, rows] of Object.entries(initialRows)) cells.set(key, rows);
      return boundary;
    },
    createBoundaryContractDataProvider() {
      return { subscribe: () => ({ dispose: () => {} }) };
    },
    createProviderQueryHandle(_provider, name) {
      return {
        __exactContractQuery: true,
        table: name,
        key: `provider:${name}`,
        read: () => [...(cells.get(name) ?? [])],
        subscribe(notify) {
          if (!observers.has(name)) observers.set(name, new Set());
          observers.get(name).add(notify);
          return {
            current: cells.get(name) ?? [],
            dispose: () => {
              observers.get(name).delete(notify);
              if (subscriptionDisposeError) throw subscriptionDisposeError;
            },
          };
        },
      };
    },
  };
};

// --- links are synchronous; queries stay silent until attach; mutations queue ---
{
  const client = makeClient();
  let connectCalls = 0;
  let releaseConnect;
  const gate = new Promise((resolve) => {
    releaseConnect = resolve;
  });
  const handle = createRenderFirstSnapbackContractSurface({
    runtime: makeRuntime(),
    client,
    userId: 'u1',
    manifest: makeManifest(),
    liveQueries: ['alpha'],
    connect: async () => {
      connectCalls += 1;
      await gate;
    },
  });

  // Links exist synchronously for every manifest binding.
  assert.equal(typeof handle.links.alpha, 'function');
  assert.equal(typeof handle.links.beta, 'function');
  assert.equal(typeof handle.links.doThing, 'function');
  assert.equal(handle.surface(), null);

  // A pre-attach query handle is silent: no emission, empty reads.
  const deliveries = [];
  const queryHandle = handle.links.alpha({});
  const subscription = queryHandle.subscribe((rows) => deliveries.push(rows));
  assert.deepEqual(queryHandle.read(), []);
  assert.deepEqual([...subscription.current], []);

  // A pre-attach mutation queues (does not reach the client yet).
  let firstDelivery = false;
  handle.onFirstDelivery(() => {
    firstDelivery = true;
  });
  const mutation = handle.links.doThing({ n: 1 });
  await tick();
  assert.equal(client.state.mutations.length, 0, 'mutation must queue behind attach');
  assert.equal(firstDelivery, false);

  // Release the backend: the surface attaches, the queued mutation flushes,
  // and a live push forwards through the pre-attach subscription.
  releaseConnect();
  const surface = await handle.attached;
  assert.equal(connectCalls, 1);
  assert.equal(handle.surface(), surface);
  await mutation;
  assert.deepEqual(client.state.mutations, [{ name: 'doThing', args: { n: 1 } }]);

  const alphaHandle = client.state.handles.find((h) => h.name === 'alpha');
  alphaHandle.onUpdate([{ _id: 'r1' }]);
  await until(() => deliveries.length > 0, 'live push forwarded through deferred subscription');
  assert.deepEqual(deliveries.at(-1), [{ _id: 'r1' }]);
  assert.equal(firstDelivery, true, 'onFirstDelivery fires on the first forwarded delivery');
  assert.deepEqual(queryHandle.read(), [{ _id: 'r1' }]);

  // Post-attach link calls go straight to the real links (real provider key).
  assert.equal(handle.links.alpha({}).key, 'provider:alpha');

  handle.dispose();
  assert.equal(alphaHandle.disposed, true, 'dispose releases the real surface');
}

// --- diagnostic-bearing connectivity failures from connect retry, then attach ---
{
  const client = makeClient({ failures: 2 });
  const retries = [];
  const handle = createRenderFirstSnapbackContractSurface({
    runtime: makeRuntime(),
    client,
    userId: 'u1',
    manifest: makeManifest(),
    liveQueries: ['alpha'],
    retryBaseDelayMs: 1,
    retryMaxDelayMs: 4,
    connect: async ({ attempt }) => {
      assert.equal(attempt, retries.length);
      await client.health();
    },
    onRetry: (error, { attempt, delayMs }) => {
      retries.push({ message: error.message, attempt, delayMs });
    },
  });
  await handle.attached;
  assert.equal(client.state.healthCalls, 3);
  assert.deepEqual(
    retries.map(({ attempt, delayMs }) => ({ attempt, delayMs })),
    [
      { attempt: 0, delayMs: 1 },
      { attempt: 1, delayMs: 2 },
    ],
  );
  handle.dispose();
}

// --- the same connectivity provenance from live subscribe retries, then attaches ---
{
  const client = makeClient({ liveFailures: 1 });
  const retries = [];
  const handle = createRenderFirstSnapbackContractSurface({
    runtime: makeRuntime(),
    client,
    userId: 'u1',
    manifest: makeManifest(),
    liveQueries: ['alpha'],
    retryBaseDelayMs: 1,
    onRetry: (error, info) => retries.push({ error, ...info }),
  });
  await handle.attached;
  assert.equal(client.state.liveQueryCalls, 2);
  assert.equal(retries.length, 1);
  assert.equal(retries[0].error.diagnostic.code, 'SNAPBACK_CLIENT_REFUSED');
  assert.equal(retries[0].attempt, 0);
  handle.dispose();
}

// --- retry hooks are observational: throwing cannot strand attachment ---
{
  const client = makeClient({ failures: 1 });
  let hooks = 0;
  const handle = createRenderFirstSnapbackContractSurface({
    runtime: makeRuntime(),
    client,
    userId: 'u1',
    manifest: makeManifest(),
    liveQueries: ['alpha'],
    retryBaseDelayMs: 1,
    connect: async () => client.health(),
    onRetry: () => {
      hooks += 1;
      throw new Error('app telemetry failed');
    },
  });
  await handle.attached;
  assert.equal(hooks, 1);
  assert.equal(client.state.healthCalls, 2, 'attachment continues after throwing retry hook');
  handle.dispose();
}

// --- the fallback code alone is not transport provenance: terminal, no retry ---
{
  const refusal = codeOnlyClientRefusal();
  let connectCalls = 0;
  const retries = [];
  const handle = createRenderFirstSnapbackContractSurface({
    runtime: makeRuntime(),
    client: makeClient(),
    userId: 'u1',
    manifest: makeManifest(),
    liveQueries: ['alpha'],
    retryBaseDelayMs: 1,
    connect: async () => {
      connectCalls += 1;
      throw refusal;
    },
    onRetry: (...args) => retries.push(args),
  });
  await assert.rejects(handle.attached, (error) => error === refusal);
  assert.equal(connectCalls, 1);
  assert.equal(retries.length, 0);
  handle.dispose();
}

// --- an answered non-2xx HTTP response is terminal, even from a dead proxy origin ---
{
  const responseError = httpError(502);
  let connectCalls = 0;
  const retries = [];
  const handle = createRenderFirstSnapbackContractSurface({
    runtime: makeRuntime(),
    client: makeClient(),
    userId: 'u1',
    manifest: makeManifest(),
    liveQueries: ['alpha'],
    retryBaseDelayMs: 1,
    connect: async () => {
      connectCalls += 1;
      throw responseError;
    },
    onRetry: (...args) => retries.push(args),
  });
  await assert.rejects(handle.attached, (error) => error === responseError);
  assert.equal(connectCalls, 1);
  assert.equal(retries.length, 0);
  handle.dispose();
}

// --- a structured contract diagnostic is a build defect: no retry, attached rejects ---
{
  const client = makeClient();
  const retries = [];
  const handle = createRenderFirstSnapbackContractSurface({
    runtime: makeRuntime(),
    client,
    userId: 'u1',
    manifest: makeManifest(),
    // Single-query mode without queryName/boundaryKey produces the structured
    // SNAPBACK_CONTRACT_SURFACE_BINDING_REQUIRED diagnostic from the adapter.
    retryBaseDelayMs: 1,
    onRetry: () => retries.push(1),
  });
  await assert.rejects(handle.attached, /queryName and boundaryKey/);
  assert.equal(retries.length, 0, 'diagnostic failures must not retry');
  handle.dispose();
}

// --- a stale generated manifest rejects attached but still returns links ---
{
  const handle = createRenderFirstSnapbackContractSurface({
    runtime: makeRuntime(),
    client: makeClient(),
    userId: 'u1',
    manifest: { ...makeManifest(), artifactKind: 'wrong' },
    liveQueries: ['alpha'],
  });
  assert.equal(typeof handle.links.alpha, 'function', 'links must exist even over a build defect');
  assert.ok(handle.diagnostics.some((d) => d.code === 'SNAPBACK_STALE_CONTRACT_DATA_ARTIFACT_KIND'));
  await assert.rejects(handle.attached, /wrong artifact kind/);
  handle.dispose();
}

// --- dispose before attach cancels the loop; a racing construction is released ---
{
  const client = makeClient();
  let releaseConnect;
  const gate = new Promise((resolve) => {
    releaseConnect = resolve;
  });
  const handle = createRenderFirstSnapbackContractSurface({
    runtime: makeRuntime(),
    client,
    userId: 'u1',
    manifest: makeManifest(),
    liveQueries: ['alpha'],
    connect: async () => {
      await gate;
    },
  });
  handle.dispose();
  await assert.rejects(handle.attached, /disposed before attach/);
  // The in-flight connect resolves after dispose: the loop must release the
  // surface it constructs instead of leaking its live subscription.
  releaseConnect();
  await until(
    () => client.state.handles.length === 0 || client.state.handles.every((h) => h.disposed),
    'late-constructed surface released',
  );
}

// --- dispose during active backoff settles the timer and stops retrying ---
{
  const client = makeClient({ failures: 100 });
  const handle = createRenderFirstSnapbackContractSurface({
    runtime: makeRuntime(),
    client,
    userId: 'u1',
    manifest: makeManifest(),
    liveQueries: ['alpha'],
    retryBaseDelayMs: 10_000,
    retryMaxDelayMs: 10_000,
    connect: async () => client.health(),
  });
  await until(() => client.state.healthCalls === 1, 'first failed connect enters backoff');
  handle.dispose();
  const error = await handle.attached.catch((caught) => caught);
  assert.equal(error.code, 'SNAPBACK_CONTRACT_SURFACE_DISPOSED');
  await tick();
  assert.equal(client.state.healthCalls, 1, 'cancelled backoff never retries');
}

// --- runtime accepted as a promise (dynamic import shape) ---
{
  const client = makeClient();
  const handle = createRenderFirstSnapbackContractSurface({
    runtime: Promise.resolve(makeRuntime()),
    client,
    userId: 'u1',
    manifest: makeManifest(),
    liveQueries: ['alpha'],
  });
  const surface = await handle.attached;
  assert.equal(surface.livePush, true);
  handle.dispose();
}

// --- low-level deferred links: attach is idempotent; dispose settles waiters ---
{
  const deferred = createDeferredContractLinks({ queries: ['q'], mutations: ['m'], ephemerals: ['presence'] });
  assert.equal(deferred.attached, false);
  const cells = [];
  const ephemeralHandle = deferred.links.presence({ room: 'a' });
  ephemeralHandle.subscribe((cell) => cells.push(cell));
  const real = {
    q: () => ({ subscribe: () => ({ current: [], dispose() {} }) }),
    m: async () => 'ran',
    presence: () => ({
      subscribe(observer) {
        observer({ status: 'ready', entries: [] });
        return { dispose() {} };
      },
    }),
    presencePublish: async () => 'published',
  };
  const publish = deferred.links.presencePublish({ value: 1 });
  deferred.attach(real);
  deferred.attach({}); // second attach ignored
  assert.equal(deferred.attached, true);
  assert.equal(await publish, 'published');
  await until(() => cells.length > 0, 'ephemeral cell forwarded after attach');
  assert.deepEqual(cells[0], { status: 'ready', entries: [] });
  assert.equal(await deferred.links.m({}), 'ran');
  deferred.dispose();
  assert.equal(deferred.attached, false, 'disposed deferred links no longer report attached');
  for (const invoke of [
    () => deferred.links.m({ after: 'dispose' }),
    () => deferred.links.presencePublish({ after: 'dispose' }),
  ]) {
    assert.throws(invoke, (error) => error.code === 'SNAPBACK_CONTRACT_SURFACE_DISPOSED');
  }
}


// --- queued writes reject on disposal; silent subscriptions release waiters ---
{
  const deferred = createDeferredContractLinks({ queries: ['q'], mutations: ['m'], ephemerals: ['presence'] });
  const mutation = deferred.links.m({ value: 1 });
  const publish = deferred.links.presencePublish({ value: 1 });
  const querySubscription = deferred.links.q({}).subscribe(() => {});
  const ephemeralSubscription = deferred.links.presence({}).subscribe(() => {});
  deferred.dispose();
  for (const operation of [mutation, publish]) {
    const error = await operation.catch((caught) => caught);
    assert.equal(error.code, 'SNAPBACK_CONTRACT_SURFACE_DISPOSED');
  }
  assert.throws(() => deferred.links.q({}), (error) => error.code === 'SNAPBACK_CONTRACT_SURFACE_DISPOSED');
  await tick(); // subscription-owned waiter rejections are handled internally
  querySubscription.dispose();
  ephemeralSubscription.dispose();
}

// --- individual offline unmounts cancel their own pending attach work ---
{
  const deferred = createDeferredContractLinks({ queries: ['q'], ephemerals: ['presence'] });
  let realSubscriptions = 0;
  for (let index = 0; index < 1_000; index += 1) {
    const querySubscription = deferred.links.q({ index }).subscribe(() => {});
    const ephemeralSubscription = deferred.links.presence({ index }).subscribe(() => {});
    assert.equal(deferred.pendingAttachCount, 2, 'only this mounted pair may await attachment');
    querySubscription.dispose();
    ephemeralSubscription.dispose();
    assert.equal(deferred.pendingAttachCount, 0, 'unmount must remove and settle both pending waiters');
  }
  await tick();
  assert.equal(deferred.pendingAttachCount, 0, 'settled cancellation microtasks retain no waiters');

  deferred.attach({
    q: () => ({
      subscribe() {
        realSubscriptions += 1;
        return { current: [], dispose() {} };
      },
    }),
    presence: () => ({
      subscribe() {
        realSubscriptions += 1;
        return { dispose() {} };
      },
    }),
  });
  await tick();
  assert.equal(realSubscriptions, 0, 'cancelled mounts must not reappear when the backend attaches');
  deferred.dispose();
}

// --- low-level disposal releases forwarding subscriptions already attached ---
{
  const deferred = createDeferredContractLinks({ queries: ['q'], ephemerals: ['presence'] });
  let queryDisposals = 0;
  let ephemeralDisposals = 0;
  const querySubscription = deferred.links.q({}).subscribe(() => {});
  const ephemeralSubscription = deferred.links.presence({}).subscribe(() => {});
  deferred.attach({
    q: () => ({
      subscribe() {
        return { current: [], dispose() { queryDisposals += 1; } };
      },
    }),
    presence: () => ({
      subscribe() {
        return { dispose() { ephemeralDisposals += 1; } };
      },
    }),
  });
  await tick();
  deferred.dispose();
  assert.equal(queryDisposals, 1, 'deferred disposal closes an attached query forwarder');
  assert.equal(ephemeralDisposals, 1, 'deferred disposal closes an attached ephemeral forwarder');
  querySubscription.dispose();
  ephemeralSubscription.dispose();
  assert.equal(queryDisposals, 1, 'later query disposal is idempotent');
  assert.equal(ephemeralDisposals, 1, 'later ephemeral disposal is idempotent');
}

// A real handle may synchronously deliver before subscribe() returns. The
// observer can dispose the outer primitive in that window; the returned inner
// handle still has to be closed once it exists.
{
  const deferred = createDeferredContractLinks({ queries: ['q'] });
  let innerDisposals = 0;
  deferred.links.q({}).subscribe(() => deferred.dispose());
  deferred.attach({
    q: () => ({
      subscribe(observer) {
        observer([{ id: 'sync' }]);
        return { current: [], dispose() { innerDisposals += 1; } };
      },
    }),
  });
  await tick();
  assert.equal(innerDisposals, 1, 'reentrant disposal closes the synchronously-created inner handle');
}

// A broken inner disposer cannot abort the teardown fan-out and retain later
// subscriptions. Cleanup completes, then reports every failure in stable
// subscription order.
{
  const deferred = createDeferredContractLinks({ queries: ['q'] });
  let subscriptions = 0;
  let firstDisposals = 0;
  let secondDisposals = 0;
  let thirdDisposals = 0;
  deferred.links.q({ id: 'first' }).subscribe(() => {});
  deferred.links.q({ id: 'second' }).subscribe(() => {});
  deferred.links.q({ id: 'third' }).subscribe(() => {});
  deferred.attach({
    q: () => ({
      subscribe() {
        subscriptions += 1;
        const ordinal = subscriptions;
        return {
          current: [],
          dispose() {
            if (ordinal === 1) {
              firstDisposals += 1;
              throw new Error('fixture teardown failure 1');
            }
            if (ordinal === 2) {
              secondDisposals += 1;
              throw new Error('fixture teardown failure 2');
            }
            thirdDisposals += 1;
          },
        };
      },
    }),
  });
  await tick();
  let disposalError = null;
  try {
    deferred.dispose();
  } catch (error) {
    disposalError = error;
  }
  assert(disposalError instanceof AggregateError);
  assert.equal(disposalError.code, 'SNAPBACK_CONTRACT_SURFACE_DISPOSAL_FAILED');
  assert.deepEqual(
    disposalError.errors.map((error) => error.message),
    ['fixture teardown failure 1', 'fixture teardown failure 2'],
  );
  assert.equal(firstDisposals, 1, 'the throwing disposer is attempted once');
  assert.equal(secondDisposals, 1, 'each throwing disposer is attempted once');
  assert.equal(thirdDisposals, 1, 'throwing siblings cannot abort later disposal');
  assert.equal(deferred.pendingAttachCount, 0);
}

// High-level disposal must still release the attached Snapback surface when a
// deferred provider subscription throws, then expose the deterministic error.
{
  const client = makeClient();
  const providerError = new Error('provider teardown failed');
  const handle = createRenderFirstSnapbackContractSurface({
    runtime: makeRuntime({ subscriptionDisposeError: providerError }),
    client,
    userId: 'u1',
    manifest: makeManifest(),
    liveQueries: ['alpha'],
  });
  handle.links.alpha({}).subscribe(() => {});
  await handle.attached;
  await tick();
  let disposalError = null;
  try {
    handle.dispose();
  } catch (error) {
    disposalError = error;
  }
  assert(disposalError instanceof AggregateError);
  assert.equal(disposalError.code, 'SNAPBACK_CONTRACT_SURFACE_DISPOSAL_FAILED');
  assert.deepEqual(disposalError.errors, [providerError]);
  assert.equal(client.state.handles.every((inner) => inner.disposed), true);
  assert.equal(handle.surface(), null);
}

// --- a throwing first-delivery observer cannot starve the query observer ---
{
  const deferred = createDeferredContractLinks({ queries: ['q'] });
  const deliveries = [];
  deferred.onFirstDelivery(() => {
    throw new Error('app first-delivery hook failed');
  });
  deferred.links.q({}).subscribe((rows) => deliveries.push(rows));
  deferred.attach({
    q: () => ({
      subscribe(observer) {
        observer([{ id: 1 }]);
        return { dispose() {} };
      },
    }),
  });
  await until(() => deliveries.length === 1, 'delivery after throwing first-delivery hook');
  assert.deepEqual(deliveries[0], [{ id: 1 }]);
  deferred.dispose();
}

console.log('render-first.test.mjs: all assertions passed');
