// LLP 0081 §6 client half: the migration-boundary quarantine UX through the
// real Contract adapter. The server contract these scenarios script is the
// engine-witnessed one (src/local.rs
// `quarantined_offline_mutation_settles_through_resync_before_replay` and
// `attest_refuses_predecessor_artifacts_after_successor_only_publication`):
// a stale replay refuses `SNAPBACK_MIGRATION_RESYNC_REQUIRED` without
// consuming the clientMutationId; an incompatible client refuses
// `SNAPBACK_MIGRATION_UPGRADE_REQUIRED` on every request; the re-baselined
// replay of the SAME id settles exactly once. Both refusals carry receipts —
// without boundary classification they would settle `failed` and drop the
// write.

import assert from 'node:assert/strict';

import {
  createMemorySnapbackClientStore,
  createSnapbackContractSurface,
} from './index.mjs';

const USER = 'user_quarantine';
const AUTH_STREAM = '018f0d91-7b21-7a22-8c33-445566778899';
const AUTHORITY_INSTANCE = '018f0d91-7b24-7a22-8c33-445566778899';

const makeManifest = (schemaHash) => ({
  artifactKind: 'contractDataManifest',
  manifestVersion: 2,
  schemaVersion: 'snapback.v0',
  inputsHash: `${schemaHash}-inputs`,
  schemaHash,
  bundleHash: `${schemaHash}-bundle`,
  capabilities: {
    derivedOptimisticOverlays: true,
    offlineReplay: true,
  },
  queries: {
    listTodos: { name: 'listTodos', mode: 'live', defaultLive: true, reads: ['todos'] },
  },
  mutations: {
    setCompleted: {
      optimistic: true,
      plan: {
        steps: [{
          Patch: {
            table: 'todos',
            id: { Arg: 'id' },
            values: { completed: { Arg: 'completed' } },
          },
        }],
        return_value: 'ChangedCount',
      },
    },
  },
});

const runtime = {
  createContractMockQueryBoundary(initialRows) {
    const rows = new Map(Object.entries(initialRows));
    return {
      current: (key) => rows.get(key) ?? [],
      query: (key, project = (value) => value) => project(rows.get(key) ?? []),
      write(key, update) {
        const next = update(rows.get(key) ?? []);
        rows.set(key, next);
        return next;
      },
    };
  },
  createBoundaryContractDataProvider(_manifest, boundary, options) {
    return {
      boundary,
      subscribe(name, args, observer) {
        observer({ status: 'ready', value: options.queries[name](args, boundary) });
        return { dispose() {} };
      },
      mutate(name, args) {
        return options.mutations[name](args, boundary);
      },
    };
  },
};

const migrationRefusal = (code) => {
  const error = new Error(`${code}: refused across the schema publication`);
  error.status = 409;
  error.diagnostic = { code, message: error.message };
  // The engine's refusal crossed the origin handler: it is receipted, which
  // is exactly why the pre-fix path would have settled it `failed`.
  error.receipt = { kind: 'mutation', outcome: 'REFUSED' };
  return error;
};

function makeClient() {
  const state = {
    online: true,
    rows: [{ _id: 'todo_1', _version: 1, title: 'seeded', completed: false, userId: USER }],
    version: 1,
    settlements: new Map(),
    deliveries: [],
    refuseMutationsWith: null,
    refuseMutationsOnce: null,
    refuseQueriesWith: null,
  };
  const snapshot = () => ({
    version: state.version,
    rows: state.rows.map((row) => ({ ...row })),
  });
  const offline = () => { throw new TypeError('network unavailable'); };
  return {
    state,
    async currentAuthorizationScope({ devUserId = null } = {}) {
      return {
        principalScope: {
          authMode: 'dev',
          authorizationStreamIncarnation: AUTH_STREAM,
          userId: devUserId,
        },
        authorityDescriptor: {
          descriptorVersion: 1,
          authorityInstanceId: AUTHORITY_INSTANCE,
          sessionGeneration: 0,
        },
        queryAuthorization: {},
      };
    },
    async query() {
      if (!state.online) offline();
      if (state.refuseQueriesWith) throw migrationRefusal(state.refuseQueriesWith);
      return snapshot();
    },
    async liveQuery(_name, options) {
      if (!state.online) offline();
      if (state.refuseQueriesWith) throw migrationRefusal(state.refuseQueriesWith);
      const current = snapshot();
      return {
        ...current,
        connection: 'live',
        dispose() {},
        push() {
          options.onUpdate?.(snapshot().rows, { version: state.version });
        },
      };
    },
    async mutate(name, request) {
      if (!state.online) offline();
      state.deliveries.push({
        name,
        id: request.clientMutationId,
        readSet: request.readSet ?? [],
      });
      if (state.refuseMutationsWith) throw migrationRefusal(state.refuseMutationsWith);
      if (state.refuseMutationsOnce) {
        const code = state.refuseMutationsOnce;
        state.refuseMutationsOnce = null;
        throw migrationRefusal(code);
      }
      const id = request.clientMutationId;
      assert.ok(id, 'replayed mutation must carry clientMutationId');
      if (state.settlements.has(id)) return state.settlements.get(id);
      state.version += 1;
      state.rows = state.rows.map((row) => row._id === request.args.id
        ? { ...row, completed: request.args.completed, _version: state.version }
        : row);
      const output = { version: state.version, changed_count: 1, result: null };
      state.settlements.set(id, output);
      return output;
    },
    async acknowledgeMutations({ clientMutationIds }) {
      if (!state.online) offline();
      let acknowledged = 0;
      for (const id of clientMutationIds) {
        if (state.settlements.delete(id)) acknowledged += 1;
      }
      return { acknowledged };
    },
  };
}

const identityFor = (schemaHash) => ({
  artifactIndex: { appId: 'quarantine-test-app' },
  schemaManifest: { schemaHash, targetProfile: 'local-dev-sqlite-ibex' },
  retainedIdentity: {
    databaseId: 'quarantine-test-db',
    versionStreamId: 'quarantine-test-stream-1',
  },
});

const makeSurface = (client, store, schemaHash) => createSnapbackContractSurface({
  runtime,
  client,
  clientStore: store,
  userId: USER,
  manifest: makeManifest(schemaHash),
  queryName: 'listTodos',
  boundaryKey: 'todos',
  livePush: false,
  ...identityFor(schemaHash),
});

// ---------------------------------------------------------------------------
// Scenario 1: `resync-required` — the quarantined write survives the refusal
// and settles through resync-before-replay with a re-baselined read set.
// ---------------------------------------------------------------------------
{
  const client = makeClient();
  const state = {};
  const store = createMemorySnapbackClientStore({ state });
  const surface = await makeSurface(client, store, 'schema-v1');
  assert.equal(surface.migrationBoundary(), null);

  // Enqueue offline, then hand-stamp the recorded pre-publication baseline
  // onto the durable record (the wire shape a baseline-bearing composing
  // layer records; Contract's own enqueue path writes an empty read set).
  client.state.online = false;
  await surface.links.setCompleted({ id: 'todo_1', completed: true });
  assert.equal(surface.pendingCount(), 1);
  {
    const [pendingRecord] = state.pending;
    assert.ok(pendingRecord, 'the offline write is durably queued');
    pendingRecord.readSet = [{ table: 'todos', id: 'todo_1', version: 1 }];
  }

  // The publication moves the row (interim write erased by the floor); the
  // stale-baseline replay refuses with the stable code, receipted.
  client.state.online = true;
  client.state.rows = [{ _id: 'todo_1', _version: 7, title: 'seeded', completed: false, userId: USER }];
  client.state.version = 7;
  client.state.refuseMutationsOnce = 'SNAPBACK_MIGRATION_RESYNC_REQUIRED';
  await assert.rejects(surface.reconnect(), /SNAPBACK_MIGRATION_RESYNC_REQUIRED/);

  // Quarantine, not failure: the record is still pending, nothing entered
  // the failed ledger, and the boundary state is app-renderable.
  assert.equal(surface.pendingCount(), 1);
  assert.deepEqual(await surface.failedMutations(), []);
  const boundary = surface.migrationBoundary();
  assert.equal(boundary?.kind, 'resync-required');
  assert.equal(boundary?.code, 'SNAPBACK_MIGRATION_RESYNC_REQUIRED');
  assert.ok(surface.retained(), 'quarantined offline work marks the surface retained');
  assert.ok(
    surface.diagnostics.some((entry) => entry.code === 'SNAPBACK_MIGRATION_RESYNC_REQUIRED'),
    'the stable server code is published once as a surface diagnostic',
  );

  // Resync-before-replay: the next reconnect resyncs, re-baselines the SAME
  // clientMutationId from the successor snapshot, and settles exactly once.
  const outcome = await surface.reconnect();
  assert.equal(outcome.replayed, 1);
  assert.equal(outcome.failed, 0);
  assert.equal(surface.migrationBoundary(), null);
  assert.equal(surface.pendingCount(), 0);
  const replays = client.state.deliveries.filter((entry) => entry.name === 'setCompleted');
  assert.equal(replays.length, 2, 'one refused stale form, one settled resynced form');
  assert.equal(replays[0].id, replays[1].id, 'the same logical mutation replays under the same id');
  assert.deepEqual(
    replays[1].readSet,
    [{ table: 'todos', id: 'todo_1', version: 7 }],
    'the settled form carries the successor-snapshot baseline, not the erased one',
  );
  assert.equal(
    client.state.rows[0].completed,
    true,
    'the quarantined write intent settled after resync',
  );
  surface.dispose();
}

// ---------------------------------------------------------------------------
// Scenario 2: `upgrade-required` — a stable observable state; the durable
// outbox survives the artifact upgrade and settles under successor artifacts.
// ---------------------------------------------------------------------------
{
  const client = makeClient();
  const state = {};
  const predecessorStore = createMemorySnapbackClientStore({ state });
  const predecessor = await makeSurface(client, predecessorStore, 'schema-v1');

  client.state.online = false;
  await predecessor.links.setCompleted({ id: 'todo_1', completed: true });
  assert.equal(predecessor.pendingCount(), 1);
  const [{ id: quarantinedId }] = state.pending;

  // The successor-only publication strands this client: every mutation
  // refuses with the stable upgrade-required code until the app runs
  // successor artifacts.
  client.state.online = true;
  client.state.refuseMutationsWith = 'SNAPBACK_MIGRATION_UPGRADE_REQUIRED';
  await assert.rejects(predecessor.reconnect(), /SNAPBACK_MIGRATION_UPGRADE_REQUIRED/);
  assert.equal(predecessor.migrationBoundary()?.kind, 'upgrade-required');
  assert.equal(predecessor.pendingCount(), 1);
  assert.deepEqual(await predecessor.failedMutations(), []);

  // The refusal is stable across retries — state persists, nothing settles,
  // nothing is dropped, and the surface does not misreport a failure.
  await assert.rejects(predecessor.reconnect(), /SNAPBACK_MIGRATION_UPGRADE_REQUIRED/);
  assert.equal(predecessor.migrationBoundary()?.kind, 'upgrade-required');
  assert.equal(predecessor.pendingCount(), 1);
  predecessor.dispose();

  // The app upgrades: a new surface over the SAME durable state, now bound
  // to successor artifacts. Cross-artifact payload custody is the store's
  // committed privacy boundary (`scopeToArtifacts`): the quarantined write
  // is never silently lost NOR blindly replayed under artifacts it was not
  // authored against — it surfaces as an explicit redacted
  // SNAPBACK_CLIENT_ARTIFACT_STALE entry for app re-entry, with identity
  // preserved and args discarded. (Automatic cross-artifact settlement
  // needs mutation-wire artifact identity — the LLP 0093-lane successor.)
  client.state.refuseMutationsWith = null;
  const successorStore = createMemorySnapbackClientStore({ state });
  const successor = await makeSurface(client, successorStore, 'schema-v2');
  assert.equal(successor.migrationBoundary(), null, 'successor artifacts boot clean');
  assert.equal(successor.pendingCount(), 0);
  const [tombstone, ...others] = await successor.failedMutations();
  assert.equal(others.length, 0);
  assert.equal(tombstone?.function, 'setCompleted');
  assert.equal(tombstone?.id, quarantinedId, 'the tombstone keeps the quarantined identity');
  assert.equal(tombstone?.diagnostic?.code, 'SNAPBACK_CLIENT_ARTIFACT_STALE');
  assert.equal(tombstone?.args, undefined, 'the artifact boundary redacts the payload');

  // The app re-enters the write under successor artifacts; the server (which
  // kept the id fresh through every refusal) settles the re-entered form.
  await successor.links.setCompleted({ id: 'todo_1', completed: true });
  assert.equal(successor.pendingCount(), 0, 'online delivery settles immediately');
  assert.equal(client.state.rows[0].completed, true);
  assert.equal(successor.migrationBoundary(), null);
  successor.dispose();
}

// ---------------------------------------------------------------------------
// Scenario 3: an incompatible client refuses even the resync read — the
// boundary is entered from the query path, and the queue is untouched.
// ---------------------------------------------------------------------------
{
  const client = makeClient();
  const state = {};
  const store = createMemorySnapbackClientStore({ state });
  const surface = await makeSurface(client, store, 'schema-v1');

  client.state.online = false;
  await surface.links.setCompleted({ id: 'todo_1', completed: true });
  client.state.online = true;
  client.state.refuseQueriesWith = 'SNAPBACK_MIGRATION_UPGRADE_REQUIRED';
  await assert.rejects(surface.reconnect(), /SNAPBACK_MIGRATION_UPGRADE_REQUIRED/);
  assert.equal(surface.migrationBoundary()?.kind, 'upgrade-required');
  assert.equal(surface.pendingCount(), 1);
  assert.deepEqual(await surface.failedMutations(), []);
  surface.dispose();
}

console.log('migration-quarantine.test.mjs: all cases passed');
