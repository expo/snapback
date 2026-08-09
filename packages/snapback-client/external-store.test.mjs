import assert from 'node:assert/strict';

import {
  SNAPBACK_EXTERNAL_STORE_PROTOCOL,
  ExternalQueryScope,
  createExternalQueryStore,
  createExternalQueryStoreRegistry,
  externalStoreIdentity,
} from './external-store.mjs';

const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
};

assert.equal(
  externalStoreIdentity({ provider: 'matrix', query: 'event', authority: 'alice', args: { z: 1, nested: { b: 2, a: 1 } } }),
  externalStoreIdentity({ provider: 'matrix', query: 'event', authority: 'alice', args: { nested: { a: 1, b: 2 }, z: 1 } }),
  'argument identity is canonical rather than insertion-order dependent',
);
assert.notEqual(
  externalStoreIdentity({ provider: 'matrix', query: 'event', authority: 'alice', args: { id: 'a' } }),
  externalStoreIdentity({ provider: 'matrix', query: 'event', authority: 'alice', args: { id: 'b' } }),
  'different arguments receive different identities',
);

{
  let controller;
  let disposed = 0;
  const store = createExternalQueryStore({
    identity: 'initial-and-updates',
    initialRows: [{ id: 'retained' }],
    start(next) {
      controller = next;
      next.ready([{ id: 'authoritative' }], 'live');
      return { protocol: SNAPBACK_EXTERNAL_STORE_PROTOCOL, dispose: () => { disposed += 1; } };
    },
  });
  const initial = store.getServerSnapshot();
  assert.equal(initial.status, 'pending');
  assert.deepEqual(initial.rows, [{ id: 'retained' }]);
  let notifications = 0;
  const unsubscribeA = store.subscribe(() => { notifications += 1; });
  const unsubscribeB = store.subscribe(() => { notifications += 1; });
  await tick();
  assert.equal(store.getSnapshot().status, 'ready');
  assert.equal(store.getSnapshot().connection, 'live');
  assert.deepEqual(store.getSnapshot().rows, [{ id: 'authoritative' }]);
  controller.connection('disconnected');
  assert.equal(store.getSnapshot().connection, 'disconnected');
  controller.refreshing([{ id: 'new' }], 'live');
  assert.equal(store.getSnapshot().status, 'refreshing');
  assert.deepEqual(store.getSnapshot().rows, [{ id: 'new' }]);
  assert(notifications >= 4, 'independent subscribers receive lifecycle updates');
  unsubscribeA();
  assert.equal(disposed, 0, 'one remaining listener retains the upstream handle');
  unsubscribeB();
  assert.equal(disposed, 1, 'last listener disposes the upstream handle');
}

{
  let attempts = 0;
  let disposals = 0;
  const registry = createExternalQueryStoreRegistry();
  const options = {
    identity: 'shared-siblings',
    start(controller) {
      attempts += 1;
      controller.ready([{ id: 'shared' }], 'live');
      return { dispose: () => { disposals += 1; } };
    },
  };
  const first = registry.get(options);
  const second = registry.get({ ...options });
  assert.equal(first, second, 'same identity and protocol share one logical store');
  const unsubscribeFirst = first.subscribe(() => {});
  const unsubscribeSecond = second.subscribe(() => {});
  await tick();
  assert.equal(attempts, 1, 'same-key siblings share one upstream attempt');
  unsubscribeFirst();
  assert.equal(disposals, 0, 'independent sibling cleanup retains the shared attempt');
  unsubscribeSecond();
  assert.equal(disposals, 1, 'last sibling cleanup disposes the shared attempt');
  await tick();
  assert.equal(registry.inspection().stores, 0, 'idle logical stores are evicted');
}

{
  const attempts = [];
  let staleDeliver;
  let staleDisposed = 0;
  const store = createExternalQueryStore({
    identity: 'strict-mode-replay',
    start(controller) {
      const handle = deferred();
      attempts.push({ controller, handle });
      if (attempts.length === 1) staleDeliver = controller;
      return handle.promise;
    },
  });
  const unsubscribeFirst = store.subscribe(() => {});
  unsubscribeFirst();
  const unsubscribeSecond = store.subscribe(() => {});
  await tick();
  assert.equal(attempts.length, 2, 'subscribe/unsubscribe/re-subscribe starts a fresh generation');
  staleDeliver.ready([{ id: 'stale' }], 'live');
  attempts[0].handle.resolve({ dispose: () => { staleDisposed += 1; } });
  attempts[1].controller.ready([{ id: 'current' }], 'live');
  attempts[1].handle.resolve({ dispose() {} });
  await tick();
  assert.deepEqual(store.getSnapshot().rows, [{ id: 'current' }]);
  assert.equal(staleDisposed, 1, 'a handle resolving after StrictMode cleanup is immediately disposed');
  assert(store.inspection().ignoredLateDeliveries >= 1, 'stale generation deliveries are fenced');
  assert.equal(store.inspection().lateHandleDisposals, 1);
  unsubscribeSecond();
}

{
  let disposed = 0;
  const store = createExternalQueryStore({
    identity: 'incompatible-handle-disposal',
    start() {
      return {
        protocol: 'snapback.external-store.v999',
        dispose: () => { disposed += 1; },
      };
    },
  });
  const unsubscribe = store.subscribe(() => {});
  await tick();
  assert.equal(store.getSnapshot().error.code, 'SNAPBACK_EXTERNAL_STORE_INCOMPATIBLE');
  assert.equal(disposed, 1, 'an incompatible resolved handle is disposed before refusal publishes');
  unsubscribe();
}

{
  let controller;
  const store = createExternalQueryStore({
    identity: 'error-and-mutations',
    start(next) {
      controller = next;
      next.ready([{ id: 'one' }], 'live');
      return { dispose() {} };
    },
  });
  const unsubscribe = store.subscribe(() => {});
  await tick();
  controller.error(Object.assign(new Error('network gone'), { code: 'NETWORK_GONE' }), {
    previous: [{ id: 'one' }],
    connection: 'disconnected',
  });
  assert.equal(store.getSnapshot().status, 'error');
  assert.equal(store.getSnapshot().error.code, 'NETWORK_GONE');
  assert.deepEqual(store.getSnapshot().rows, [{ id: 'one' }]);

  const confirmed = await store.runMutation(async () => 'ok', {
    id: 'confirmed',
    optimisticRows: (rows) => [...rows, { id: 'two' }],
  });
  assert.equal(confirmed, 'ok');
  assert.equal(store.getSnapshot().mutation.status, 'confirmed');
  assert.deepEqual(store.getSnapshot().rows, [{ id: 'one' }, { id: 'two' }]);

  await assert.rejects(
    store.runMutation(async () => { throw new Error('rejected'); }, {
      id: 'rejected',
      optimisticRows: [{ id: 'temporary' }],
    }),
    /rejected/,
  );
  assert.equal(store.getSnapshot().mutation.status, 'rejected');
  assert.deepEqual(store.getSnapshot().rows, [{ id: 'one' }, { id: 'two' }], 'rejection restores the pre-mutation snapshot');
  unsubscribe();
}

{
  let controller;
  let rejectMutation;
  const store = createExternalQueryStore({
    identity: 'authoritative-rollback-race',
    start(next) {
      controller = next;
      next.ready([{ id: 'base' }], 'live');
      return { dispose() {} };
    },
  });
  const unsubscribe = store.subscribe(() => {});
  await tick();
  const mutation = store.runMutation(
    () => new Promise((_resolve, reject) => { rejectMutation = reject; }),
    {
      id: 'racing-rejection',
      optimisticRows: (rows) => [...rows, { id: 'optimistic' }],
    },
  );
  assert.deepEqual(store.getSnapshot().rows, [{ id: 'base' }, { id: 'optimistic' }]);
  controller.ready([{ id: 'new-authoritative' }], 'live');
  assert.deepEqual(
    store.getSnapshot().rows,
    [{ id: 'new-authoritative' }, { id: 'optimistic' }],
    'pending overlays replay over newer authoritative delivery',
  );
  rejectMutation(new Error('server rejected after query advanced'));
  await assert.rejects(mutation, /server rejected/);
  assert.deepEqual(
    store.getSnapshot().rows,
    [{ id: 'new-authoritative' }],
    'rollback preserves the latest authoritative delivery instead of the mutation-start snapshot',
  );
  unsubscribe();
}

{
  const controllers = [];
  const store = createExternalQueryStore({
    identity: 'stale-controller-state-fence',
    start(controller) {
      controllers.push(controller);
      return { dispose() {} };
    },
  });
  const unsubscribeFirst = store.subscribe(() => {});
  await tick();
  controllers[0].ready([{ id: 'generation-one' }], 'live');
  unsubscribeFirst();
  const unsubscribeSecond = store.subscribe(() => {});
  await tick();
  controllers[1].ready([{ id: 'generation-two' }], 'live');
  controllers[0].ready([{ id: 'stale-generation-one' }], 'live');
  let resolveMutation;
  const mutation = store.runMutation(
    () => new Promise((resolve) => { resolveMutation = resolve; }),
    { id: 'after-stale', optimisticRows: (rows) => [...rows, { id: 'optimistic' }] },
  );
  assert.deepEqual(
    store.getSnapshot().rows,
    [{ id: 'generation-two' }, { id: 'optimistic' }],
    'a stale controller cannot mutate the hidden authoritative base',
  );
  resolveMutation('ok');
  await mutation;
  unsubscribeSecond();
}

{
  let controller;
  let resolveMutation;
  const store = createExternalQueryStore({
    identity: 'authoritative-before-confirmation',
    start(next) {
      controller = next;
      next.ready([{ id: 'base' }], 'live');
      return { dispose() {} };
    },
  });
  const unsubscribe = store.subscribe(() => {});
  await tick();
  const mutation = store.runMutation(
    () => new Promise((resolve) => { resolveMutation = resolve; }),
    {
      id: 'query-wins-race',
      optimisticRows: (rows) => [...rows, { id: 'optimistic' }],
      isAuthoritative: (rows) => rows.some((row) => row.id === 'server-created'),
    },
  );
  controller.ready([{ id: 'base' }, { id: 'server-created' }], 'live');
  assert.deepEqual(
    store.getSnapshot().rows,
    [{ id: 'base' }, { id: 'server-created' }],
    'a correlated authoritative delivery suppresses the overlay before transport confirmation',
  );
  resolveMutation({ id: 'server-created' });
  await mutation;
  assert.deepEqual(store.getSnapshot().rows, [{ id: 'base' }, { id: 'server-created' }]);
  assert.equal(store.inspection().optimisticLayers, 0);
  unsubscribe();
}

// LLP 0133 acceptance sketch 9: both delivery orders converge through the
// receipt id-map, while confirmation alone keeps an inspectable bridge.
{
  let controller;
  let resolveMutation;
  const seenMaps = [];
  const store = createExternalQueryStore({
    identity: 'llp0133-confirmation-before-delivery',
    start(next) {
      controller = next;
      next.ready([{ id: 'base' }], 'live');
      return { dispose() {} };
    },
  });
  const unsubscribe = store.subscribe(() => {});
  await tick();
  const mutation = store.runMutation(
    () => new Promise((resolve) => { resolveMutation = resolve; }),
    {
      id: 'local-mint',
      optimisticRows: (rows) => [...rows, { id: 'speculative-row' }],
      isAuthoritative: (rows, { idMap }) => {
        seenMaps.push(idMap);
        const authoritative = idMap?.find((entry) => entry.speculative === 'speculative-row')
          ?.authoritative;
        return typeof authoritative === 'string' && rows.some((row) => row.id === authoritative);
      },
    },
  );
  resolveMutation({
    receipt: {
      kind: 'mutation',
      idMap: [{
        speculative: 'speculative-row',
        authoritative: 'authoritative-row',
        site: 'insert:things:id',
        occurrence: 0,
        disposition: 'mapped',
      }],
    },
  });
  await mutation;
  assert.deepEqual(
    store.getSnapshot().rows,
    [{ id: 'base' }, { id: 'speculative-row' }],
    'confirmation retains the optimistic bridge instead of flickering to the base',
  );
  assert.equal(store.inspection().optimisticLayerStatuses[0].status, 'bridging');
  assert.equal(
    store.getSnapshot().mutation.idMap[0].authoritative,
    'authoritative-row',
    'the private receipt id-map reaches the store settlement seam',
  );
  controller.ready([{ id: 'base' }, { id: 'authoritative-row' }], 'live');
  assert.deepEqual(store.getSnapshot().rows, [{ id: 'base' }, { id: 'authoritative-row' }]);
  assert.equal(store.inspection().optimisticLayers, 0);
  assert(seenMaps.some((idMap) => idMap?.[0]?.authoritative === 'authoritative-row'));
  unsubscribe();
}

{
  let controller;
  let resolveMutation;
  const store = createExternalQueryStore({
    identity: 'llp0133-delivery-before-confirmation',
    start(next) {
      controller = next;
      next.ready([{ id: 'base' }], 'live');
      return { dispose() {} };
    },
  });
  const unsubscribe = store.subscribe(() => {});
  await tick();
  const mutation = store.runMutation(
    () => new Promise((resolve) => { resolveMutation = resolve; }),
    {
      id: 'local-mint-delivery-first',
      optimisticRows: (rows) => [...rows, { id: 'speculative-row' }],
      isAuthoritative: (rows, { idMap }) => {
        const authoritative = idMap?.find((entry) => entry.speculative === 'speculative-row')
          ?.authoritative;
        return typeof authoritative === 'string' && rows.some((row) => row.id === authoritative);
      },
    },
  );
  controller.ready([{ id: 'base' }, { id: 'authoritative-row' }], 'live');
  assert.deepEqual(
    store.getSnapshot().rows,
    [{ id: 'base' }, { id: 'authoritative-row' }, { id: 'speculative-row' }],
    'delivery cannot use a private id-map before confirmation supplies it',
  );
  resolveMutation({
    receipt: {
      kind: 'mutation',
      idMap: [{
        speculative: 'speculative-row',
        authoritative: 'authoritative-row',
        site: 'insert:things:id',
        occurrence: 0,
        disposition: 'mapped',
      }],
    },
  });
  await mutation;
  assert.deepEqual(
    store.getSnapshot().rows,
    [{ id: 'base' }, { id: 'authoritative-row' }],
    'confirmation rechecks the already-delivered base and splices the overlay',
  );
  assert.equal(store.inspection().optimisticLayers, 0);
  unsubscribe();
}

{
  let controller;
  const store = createExternalQueryStore({
    identity: 'llp0133-confirmation-fallback',
    start(next) {
      controller = next;
      next.ready([{ id: 'base' }], 'live');
      return { dispose() {} };
    },
  });
  const unsubscribe = store.subscribe(() => {});
  await tick();
  await store.runMutation(async () => ({ receipt: { kind: 'mutation', idMap: [] } }), {
    id: 'fallback',
    optimisticRows: (rows) => [...rows, { id: 'optimistic' }],
  });
  assert.equal(store.inspection().optimisticLayerStatuses[0].status, 'bridging');
  controller.ready([{ id: 'server-shape' }], 'live');
  assert.deepEqual(store.getSnapshot().rows, [{ id: 'server-shape' }]);
  assert.equal(store.inspection().optimisticLayers, 0, 'first post-confirm delivery bounds fallback');
  unsubscribe();
}

{
  let resolveOlder;
  let rejectNewer;
  let duplicateDispatched = false;
  const store = createExternalQueryStore({
    identity: 'overlapping-mutation-aggregation',
    start(controller) {
      controller.ready([], 'live');
      return { dispose() {} };
    },
  });
  const unsubscribe = store.subscribe(() => {});
  await tick();
  const older = store.runMutation(
    () => new Promise((resolve) => { resolveOlder = resolve; }),
    { id: 'older' },
  );
  const newer = store.runMutation(
    () => new Promise((_resolve, reject) => { rejectNewer = reject; }),
    { id: 'newer' },
  );
  assert.equal(store.getSnapshot().mutation.status, 'pending');
  assert.equal(store.getSnapshot().mutation.id, 'newer');
  assert.equal(store.getSnapshot().mutation.pendingCount, 2);
  await assert.rejects(
    store.runMutation(async () => { duplicateDispatched = true; }, { id: 'newer' }),
    (error) => error.code === 'SNAPBACK_EXTERNAL_STORE_MUTATION_ACTIVE'
      && error.diagnostic.code === error.code
      && /already has active mutation newer/u.test(error.message),
  );
  assert.equal(duplicateDispatched, false, 'a duplicate non-optimistic mutation id never dispatches');

  resolveOlder('older-result');
  await older;
  assert.equal(store.getSnapshot().mutation.status, 'pending', 'older settlement cannot hide newer pending work');
  assert.equal(store.getSnapshot().mutation.id, 'newer');
  assert.equal(store.getSnapshot().mutation.pendingCount, 1);
  assert.equal(store.getSnapshot().mutation.lastSettlement.id, 'older');
  assert.equal(store.getSnapshot().mutation.lastSettlement.status, 'confirmed');

  rejectNewer(new Error('newer rejected'));
  await assert.rejects(newer, /newer rejected/);
  assert.equal(store.getSnapshot().mutation.status, 'rejected');
  assert.equal(store.getSnapshot().mutation.id, 'newer');
  assert.equal(store.getSnapshot().mutation.pendingCount, 0);
  unsubscribe();
}

{
  const store = createExternalQueryStore({
    identity: 'protocol-refusal',
    provider: 'future-provider',
    start() { return { protocol: 'snapback.external-store.v999', dispose() {} }; },
  });
  const unsubscribe = store.subscribe(() => {});
  await tick();
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.status, 'error');
  assert.equal(snapshot.error.code, 'SNAPBACK_EXTERNAL_STORE_INCOMPATIBLE');
  assert.match(snapshot.error.message, /expected snapback\.external-store\.v1/);
  unsubscribe();
}

{
  const scope = new ExternalQueryScope();
  let delayedObserver;
  let resolveHandle;
  let applied = 0;
  let disposed = 0;
  scope.renew();
  const pending = scope.watch(
    (observer) => {
      delayedObserver = observer;
      return new Promise((resolve) => { resolveHandle = resolve; });
    },
    () => { applied += 1; },
  );
  await tick();
  scope.renew();
  delayedObserver([{ id: 'stale' }], 'live');
  resolveHandle({ dispose: () => { disposed += 1; } });
  await pending;
  await tick();
  assert.equal(applied, 0);
  assert.equal(disposed, 1);
  assert.equal(scope.snapshot().ignoredStaleUpdates, 1);

  const seen = [];
  for (const id of ['a', 'b', 'a']) {
    scope.renew();
    await scope.watch(
      async (observer) => {
        observer([{ id }], 'live');
        return { dispose() {} };
      },
      (rows) => seen.push(rows[0].id),
    );
    await tick();
  }
  assert.deepEqual(seen, ['a', 'b', 'a'], 'A to B to A remounts are live and do not reuse stale generations');
  scope.close();
  assert.equal(scope.snapshot().activeSubscriptions, 0);
  assert.equal(scope.snapshot().closed, true);
}

{
  const scope = new ExternalQueryScope();
  scope.renew();
  const deliveries = [];
  let caught = null;
  await scope.watch(
    async (observer) => {
      observer([{ id: 'authoritative' }], 'live', { kind: 'authoritative' });
      observer([{ id: 'cached' }], 'stale', { kind: 'connection' });
      return { dispose() {} };
    },
    (rows, connection, delivery) => deliveries.push({ rows, connection, delivery }),
  ).catch((error) => { caught = error; });
  assert.equal(caught, null);
  assert.deepEqual(deliveries.map(({ delivery }) => delivery.kind), ['authoritative', 'connection']);
  assert.deepEqual(deliveries[1].rows, [{ id: 'authoritative' }], 'connection-only delivery retains the authoritative rows');
  scope.close();

  const failedScope = new ExternalQueryScope();
  failedScope.renew();
  await assert.rejects(
    failedScope.watch(async () => { throw new Error('subscribe failed'); }, () => {}),
    /subscribe failed/,
  );
  assert.equal(failedScope.snapshot().activeSubscriptions, 0, 'startup failure disposes and removes its binding');
  failedScope.close();
}

{
  const store = createExternalQueryStore({ start: async () => ({ dispose() {} }) });
  store.close();
  await assert.rejects(
    store.runMutation(async () => {}),
    (error) => error.code === 'SNAPBACK_EXTERNAL_STORE_CLOSED'
      && error.diagnostic.schemaVersion === 'snapback.client-diagnostic.v1',
  );

  const registry = createExternalQueryStoreRegistry();
  registry.close();
  assert.throws(
    () => registry.get({ identity: 'closed' }),
    (error) => error.code === 'SNAPBACK_EXTERNAL_STORE_REGISTRY_CLOSED',
  );

  const scope = new ExternalQueryScope();
  scope.close();
  assert.throws(
    () => scope.renew(),
    (error) => error.code === 'SNAPBACK_EXTERNAL_STORE_SCOPE_CLOSED',
  );
}

console.log('external-store.test.mjs: lifecycle, identity, StrictMode, settlement, and handshake checks passed');
