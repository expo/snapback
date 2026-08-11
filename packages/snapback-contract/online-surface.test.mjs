import assert from 'node:assert/strict';

import { createOnlineSnapbackContractSurface } from './online-surface.mjs';

function mockRuntime() {
  return {
    createContractMockQueryBoundary(initialRows) {
      const rows = new Map(Object.entries(initialRows));
      const listeners = new Map();
      return {
        query(key, project = (value) => value) {
          return project(rows.get(key) ?? []);
        },
        write(key, update) {
          const next = update(rows.get(key) ?? []);
          rows.set(key, next);
          for (const listener of listeners.get(key) ?? []) listener(next);
          return next;
        },
        listen(key, listener) {
          let set = listeners.get(key);
          if (!set) {
            set = new Set();
            listeners.set(key, set);
          }
          set.add(listener);
          return () => set.delete(listener);
        },
      };
    },
    createBoundaryContractDataProvider(manifest, boundary, options) {
      const observers = new Map();
      return {
        manifest,
        subscribe(name, args, observer) {
          let set = observers.get(name);
          if (!set) {
            set = new Set();
            observers.set(name, set);
          }
          set.add(observer);
          const emit = (rows) => observer({
            status: 'ready',
            value: rows,
            rows,
            empty: rows.length === 0,
            connection: 'connecting',
          });
          emit(options.queries[name](args, boundary));
          const off = boundary.listen(name, emit);
          return { dispose() { off(); set.delete(observer); } };
        },
        async mutate(name, args) {
          try {
            return { ok: true, value: await options.mutations[name](args, boundary) };
          } catch (error) {
            return { ok: false, error: { message: error.message } };
          }
        },
        forceQueryState(name, state) {
          for (const observer of observers.get(name) ?? []) observer(state);
          return { dispose() {} };
        },
      };
    },
    createProviderQueryHandle(provider, name, args) {
      return { subscribe(observer) { return provider.subscribe(name, args, observer); } };
    },
    // Deliberately no rotatePartition(): this is the published-runtime
    // compatibility contract that the keyed provider correctly refuses.
  };
}

const manifest = {
  artifactKind: 'contractDataManifest',
  manifestVersion: 2,
  provider: 'snapback-online-test',
  queries: {
    listEvents: { name: 'listEvents', mode: 'live', livePush: true },
    eventDetails: { name: 'eventDetails', mode: 'live', livePush: true },
  },
  mutations: { rsvp: { name: 'rsvp' } },
};

const opens = [];
const mutations = [];
const client = {
  liveQuery(name, options) {
    const handle = {
      rows: [{ _id: options.args.eventId ?? 'feed' }],
      connection: 'connecting',
      disposed: false,
      dispose() { this.disposed = true; },
    };
    opens.push({ name, options, handle });
    return Promise.resolve(handle);
  },
  async mutate(name, options) {
    mutations.push({ name, options });
    return { settled: true };
  },
};

const surface = await createOnlineSnapbackContractSurface({
  runtime: mockRuntime(),
  client,
  manifest,
  userId: 'user-a',
  liveQueries: [{ name: 'eventDetails', args: { eventId: 'event-a' } }],
  requiredQueries: ['eventDetails'],
  rootId: 'online-root',
});
assert.equal(surface.capabilityClass, 'Online');
assert.deepEqual(opens.map(({ options }) => options.args), [{ eventId: 'event-a' }]);

const cells = [];
const subscription = surface.links.eventDetails({ eventId: 'event-a' })
  .subscribe((cell) => cells.push(cell));
assert.equal(cells.at(-1).value[0]._id, 'event-a');
assert.equal(cells.at(-1).connection, 'connecting');
opens[0].handle.connection = 'live';
opens[0].options.onConnectionChange('live', { transport: 'stream' });
assert.equal(cells.at(-1).connection, 'live');
opens[0].options.onUpdate([{ _id: 'event-a', title: 'updated' }]);
assert.equal(cells.at(-1).value[0].title, 'updated');

const forced = { status: 'error', error: { message: 'forced' }, connection: 'disconnected' };
surface.provider.forceQueryState('eventDetails', forced);
assert.deepEqual(cells.at(-1), forced, 'the Exact provider keeps force-state drivability');

const mutation = await surface.links.rsvp({ eventId: 'event-a', status: 'going' });
assert.deepEqual(mutation, { settled: true });
assert.equal(mutations[0].name, 'rsvp');
assert.equal(mutations[0].options.queue, false);
assert.equal(mutations[0].options.correlation.rootId, 'online-root');

subscription.dispose();
surface.dispose();
assert.equal(opens[0].handle.disposed, true);

await assert.rejects(
  () => createOnlineSnapbackContractSurface({
    runtime: mockRuntime(),
    client: { ...client, authorityFence: {} },
    manifest,
    userId: 'user-a',
    liveQueries: ['listEvents'],
  }),
  (error) => error?.code === 'SNAPBACK_CONTRACT_ONLINE_AUTH_UNSUPPORTED',
);

await assert.rejects(
  () => createOnlineSnapbackContractSurface({
    runtime: mockRuntime(),
    client,
    manifest: { ...manifest, bundleHash: 'stale' },
    functionManifest: { bundleHash: 'current' },
    userId: 'user-a',
    liveQueries: ['listEvents'],
  }),
  (error) => error?.code === 'SNAPBACK_STALE_CONTRACT_DATA_BUNDLE_HASH',
);

let partiallyOpenedHandle = null;
await assert.rejects(
  () => createOnlineSnapbackContractSurface({
    runtime: mockRuntime(),
    client: {
      ...client,
      liveQuery(name, options) {
        if (name === 'eventDetails') return Promise.reject(new Error('second open failed'));
        partiallyOpenedHandle = {
          rows: [],
          connection: 'live',
          disposed: false,
          dispose() { this.disposed = true; },
        };
        opens.push({ name, options, handle: partiallyOpenedHandle });
        return Promise.resolve(partiallyOpenedHandle);
      },
    },
    manifest,
    userId: 'user-a',
    liveQueries: ['listEvents', { name: 'eventDetails', args: { eventId: 'event-a' } }],
  }),
  /second open failed/,
);
assert.equal(partiallyOpenedHandle.disposed, true, 'a sibling open failure disposes handles already opened');

console.log('snapback Online Contract surface: published-runtime live, force, mutation, refusal, and cleanup paths pass');
