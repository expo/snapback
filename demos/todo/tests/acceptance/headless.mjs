// Todo demo — headless acceptance suite (the required surface).
//
// @ref LLP 0010#first-acceptance-app — proves schema load, generated function
//   references, query, mutation, ctx.db read/write, system fields, one live
//   subscription, one realtime update from a second client, an ordinary callable
//   query reported as not syncable, a read-set mutation conflict, deterministic
//   reset, and machine-readable diagnostics for one invalid schema and one
//   invalid query.
// @ref LLP 0015#acceptance-rules — a demo is complete only when its required
//   checks pass on its required surface (headless), with explicit results.

import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { SnapbackClient } from '../../../_kit/client.mjs';
import { importGeneratedModule, readGeneratedJson } from '../../../_kit/generated-artifacts.mjs';
import { startServer } from '../../../_kit/server-process.mjs';
import { generate } from '../../../_kit/codegen.mjs';
import { assert, assertEqual, assertThrows, createSuite, eventually, writeMachineReport } from '../../../_kit/harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const backendDir = join(here, '..', '..', 'snapback');
const generatedRoot = join(backendDir, 'generated');
const gen = (f) => readGeneratedJson(generatedRoot, f);
const { default: api } = await importGeneratedModule(generatedRoot, 'api.mjs');

const schemaManifest = gen('schema.manifest.json');
const functionManifest = gen('functions.manifest.json');
const seed = JSON.parse(readFileSync(join(backendDir, 'seed.json'), 'utf8'));
const option = (name) => { const at = process.argv.indexOf(`--${name}`); return at < 0 ? null : process.argv[at + 1]; };
const receiptFile = option('receipt');

const ADA = 'user_ada';
const GRACE = 'user_grace';
const completedLiveRef = { name: 'listCompletedTodos', kind: 'LiveQuery' };
const completedLiveHandlerSource = `
globalThis.__snapbackHandlers = {
  async listCompletedTodos(ctx) {
    return await ctx.db
      .query('todos')
      .eq('userId', ctx.auth.userId)
      .in('completed', [true])
      .order('_createdAt', 'asc')
      .collect();
  }
};
`;

const server = await startServer({ port: 4399, db: ':memory:', cwd: repoRoot,
  provenance: { appId: 'todo', artifactsPath: join(repoRoot, 'demos', 'todo', 'snapback', 'generated', 'artifacts.json') } });
const db = new SnapbackClient(server.baseUrl, server.clientOptions);
const suite = createSuite('todo / headless', { expectedChecks: 25 });

try {
  await suite.check('headless ready-descriptor capability admits only the witnessed boot', async () => {
    assert(server.devIdentityCapability?.startsWith('sbdev_'), 'ready descriptor omitted dev identity capability');
    assertEqual(
      server.clientOptions.devIdentityCapability,
      server.devIdentityCapability,
      'headless client option did not use the harvested capability',
    );
    const open = (headers = {}) => fetch(`${server.baseUrl}/connection/open`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-snapback-auth-client-protocol': '1',
        ...headers,
      },
      body: '{}',
    });
    const accepted = await open({
      'x-snapback-dev-identity': server.devIdentityCapability,
    });
    assertEqual(accepted.status, 200, 'current boot capability was not admitted');
    const acceptedBody = await accepted.json();
    assertEqual(
      acceptedBody.devIdentityCapabilityWitnessed,
      true,
      'current boot capability was admitted without a server witness',
    );
    const headerless = await open();
    assertEqual(headerless.status, 200, 'stage-2 headerless control was not admitted');
    const headerlessBody = await headerless.json();
    assertEqual(
      headerlessBody.devIdentityCapabilityWitnessed,
      false,
      'headerless control did not expose an unwitnessed server verdict',
    );
    const refused = await open({
      'x-snapback-dev-identity': 'sbdev_headless_wrong_boot',
    });
    assertEqual(refused.status, 403, 'mismatched capability was not refused');
    const refusal = await refused.json();
    assertEqual(refusal.diagnostic?.code, 'SNAPBACK_DEV_IDENTITY_REFUSED', 'generic refusal code');
    return {
      carrier: 'ready-descriptor-sidecar',
      acceptedStatus: accepted.status,
      acceptedCapabilityWitnessed: acceptedBody.devIdentityCapabilityWitnessed,
      headerlessStatus: headerless.status,
      headerlessCapabilityWitnessed: headerlessBody.devIdentityCapabilityWitnessed,
      refusedStatus: refused.status,
      refusalCode: refusal.diagnostic.code,
    };
  });

  await suite.check('health reports local ibex+sqlite target', async () => {
    const health = await db.health();
    assert(health.ok, 'server not ok');
    return health;
  });

  await suite.check('schema load (no error diagnostics)', async () => {
    const res = await db.loadSchema(schemaManifest);
    assertEqual(res.diagnostics.filter((d) => d.severity === 'Error' || d.severity === 'Fatal'), [], 'schema errors');
    return res;
  });

  await suite.check('generated function references load + are inspectable', async () => {
    await db.loadFunctions(functionManifest);
    const state = await db.inspect();
    const names = state.functions.functions.map((f) => f.name).sort();
    assert(names.includes('listTodos') && names.includes('createTodo'), `missing functions: ${names}`);
    assertEqual(api.listTodos.name, 'listTodos', 'generated listTodos reference');
    assertEqual(api.createTodo.kind, 'Mutation', 'generated createTodo reference kind');
    assertEqual(state.functions.artifactKind, 'functionManifest', 'function manifest artifact kind');
    assertEqual(state.capabilityManifest.artifactKind, 'capabilityManifest', 'capability manifest artifact kind');
    assertEqual(state.runtime.ibexCtxDbHostBridge, 'Available', 'embedded ctx.db bridge capability');
    assert(!state.capabilityGaps.includes('ibex_ctx_db_host_bridge'), 'ctx.db bridge should not be reported as a gap once wired');
    assert(state.capabilityManifest.supportedQueryForms.includes('ibex-live-eq-replace'), 'live matcher capability form');
    assert(state.capabilityManifest.supportedQueryForms.includes('ibex-live-in-replace'), 'live matcher In capability form');
    assert(state.capabilityManifest.supportedQueryForms.includes('ibex-live-range-replace'), 'live matcher range capability form');
    assert(state.capabilityManifest.supportedQueryForms.includes('ibex-live-limited-boundary-replace'), 'live matcher limited-boundary capability form');
    assert(state.capabilityManifest.supportedQueryForms.includes('websocket-live-replace'), 'websocket live replace capability form');
    assert(!state.capabilityManifest.capabilityGaps.includes('websocket_push_transport'), 'push transport should not be a gap once wired');
    assert(!state.capabilityManifest.capabilityGaps.includes('precise_realtime_query_range_matcher'), 'precise range matcher should not be a gap once reconnect epochs are covered');
    return { functions: names, capabilityGaps: state.capabilityGaps, bridge: state.runtime.ibexCtxDbHostBridge, generatedRef: api.createTodo };
  });

  await suite.check('deterministic reset + declarative seed', async () => {
    await db.reset();
    await db.seed(seed);
    const ada = await db.query(api.listTodosOnce, { userId: ADA });
    assertEqual(ada.rows.map((r) => r._id), ['seed_todo_1', 'seed_todo_2', 'seed_todo_3'], 'seed order');
    return { rows: ada.rows.length };
  });

  await suite.check('user-scoped query (auth filter) isolates users', async () => {
    const grace = await db.query(api.listTodosOnce, { userId: GRACE });
    assertEqual(grace.rows.map((r) => r.title), ['Plan the kanban demo'], 'grace todos');
  });

  await suite.check('mutation: createTodo returns id; ctx.db write + system fields', async () => {
    await db.reset();
    const created = await db.mutate(api.createTodo, { args: { title: 'Buy milk' }, userId: ADA });
    assert(typeof created.result === 'string' && created.result.length > 0, 'no id returned');
    assertEqual(created.changed_count, 1, 'changed_count');
    const rows = (await db.query(api.listTodos, { userId: ADA })).rows;
    assertEqual(rows.length, 1, 'one row');
    const row = rows[0];
    for (const f of ['_id', '_version', '_createdAt', '_updatedAt']) assert(row[f] !== undefined, `missing system field ${f}`);
    assertEqual(row.title, 'Buy milk', 'title');
    assertEqual(row.completed, false, 'completed default');
    assertEqual(row.userId, ADA, 'userId from auth');
    return { id: created.result, version: row._version };
  });

  await suite.check('mutation: createTodo rejects empty titles', async () => {
    const before = (await db.query(api.listTodos, { userId: ADA })).rows.length;
    await assertThrows(
      () => db.mutate(api.createTodo, { args: { title: '   ' }, userId: ADA }),
      null,
      'expected blank title rejection',
    );
    const after = (await db.query(api.listTodos, { userId: ADA })).rows.length;
    assertEqual(after, before, 'blank title must not insert a row');
  });

  await suite.check('mutations: toggle, edit, delete', async () => {
    const id = (await db.query(api.listTodos, { userId: ADA })).rows[0]._id;
    await db.mutate(api.setCompleted, { args: { id, completed: true }, userId: ADA });
    assertEqual((await db.query(api.listTodos, { userId: ADA })).rows[0].completed, true, 'toggle');
    await db.mutate(api.editTitle, { args: { id, title: 'Buy oat milk' }, userId: ADA });
    assertEqual((await db.query(api.listTodos, { userId: ADA })).rows[0].title, 'Buy oat milk', 'edit');
    const del = await db.mutate(api.deleteTodo, { args: { id }, userId: ADA });
    assertEqual(del.changed_count, 1, 'delete count');
    assertEqual((await db.query(api.listTodos, { userId: ADA })).rows.length, 0, 'deleted');
  });

  await suite.check('admin runner surfaces captured handler read/write facts', async () => {
    await db.reset();
    const created = await db.mutate(api.createTodo, { args: { title: 'Captured facts' }, userId: ADA });
    const run = await adminRun('setCompleted', {
      args: { id: created.result, completed: true },
      auth: SnapbackClient.auth(ADA),
      read_set: [],
    });
    assert(run.ok, 'function runner failed');
    assert(run.captured_reads.some((d) => d.kind === 'row' && d.table === 'todos' && d.id === created.result), 'missing captured row read');
    assert(run.captured_writes.some((d) => d.op === 'Update' && d.table === 'todos' && d.id === created.result), 'missing captured update write');
    return { reads: run.captured_reads, writes: run.captured_writes };
  });

  await suite.check('live subscription returns authoritative initial snapshot', async () => {
    await db.reset();
    await db.seed(seed);
    const handle = await db.liveQuery(api.listTodos, { connectionId: 'client_a', userId: ADA });
    assertEqual(handle.rows.length, 3, 'snapshot rows');
    return { subscriptionId: handle.subscriptionId, version: handle.version };
  });

  await suite.check('realtime update reaches a second client', async () => {
    // client_b subscribes; client_a issues a mutation; client_b sees the update.
    const b = await db.liveQuery(api.listTodos, { connectionId: 'client_b', userId: ADA });
    assertEqual(b.rows.length, 3, 'b initial');
    await db.mutate(api.createTodo, { args: { title: 'Added by another client' }, userId: ADA });
    // Phase 1 (LLP 0200): fan-out is scheduled off the commit turn, so poll
    // until the frame lands instead of asserting one immediate drain.
    const rows = await eventually(async () => {
      const polled = await b.poll();
      assertEqual(polled.length, 4, 'b did not receive realtime update');
      return polled;
    }, 'realtime update for client_b');
    assert(rows.some((r) => r.title === 'Added by another client'), 'new row missing');
    return { rows: rows.length };
  });

  await suite.check('websocket stream pushes live replace without outbox polling', async () => {
    await db.reset();
    await db.seed(seed);
    const stream = db.openLiveStream('client_ws');
    try {
      await stream.ready;
      const live = await db.subscribeLive(api.listTodos, { connectionId: 'client_ws', userId: ADA });
      await db.mutate(api.createTodo, { args: { title: 'Pushed over WebSocket' }, userId: ADA });
      // Phase 1 (LLP 0200): the 2 s nextUpdate default is no longer a safe
      // whole-fan-out window once delivery is scheduled off the commit turn.
      const update = await stream.nextUpdate(10_000);
      assertEqual(update.kind, 'live_replace', 'websocket update kind');
      assertEqual(update.subscription_id, live.subscription_id, 'subscription id');
      assert(update.rows.some((r) => r.title === 'Pushed over WebSocket'), 'pushed row missing');
      return { version: update.version, rows: update.rows.length };
    } finally {
      stream.close();
    }
  });

  await suite.check('generated ephemeral board cursors use product API and preserve durable lane', async () => {
    const fixtureSourceDir = join(here, 'fixtures', 'ephemeral-backend');
    const fixtureDir = mkdtempSync(join(here, 'fixtures', '.tmp-ephemeral-'));
    cpSync(fixtureSourceDir, fixtureDir, { recursive: true });
    let generated;
    let cursorRef;
    try {
      generated = await generate(fixtureDir);
      assert(generated.ok, `ephemeral codegen failed: ${JSON.stringify(generated.diagnostics)}`);
      const { ephemeral } = await import(`${pathToFileURL(join(fixtureDir, 'generated', 'api.mjs')).href}?t=${Date.now()}`);
      cursorRef = ephemeral.boardCursors;
      assertEqual(cursorRef.artifactKind, 'ephemeralCollectionReference', 'ephemeral ref kind');
      assertEqual(cursorRef.routingFields, ['boardId'], 'routing fields');
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }

    const schemaWithCursors = {
      ...schemaManifest,
      schemaHash: 'sha256:todo-plus-board-cursors',
      inputsHash: 'todo-plus-board-cursors',
      ephemeralCollections: generated.schemaManifest.ephemeralCollections,
    };
    await db.loadSchema(schemaWithCursors);
    await db.loadFunctions(functionManifest);
    await db.reset();
    await db.seed(seed);

    const scope = { boardId: 'board_1' };
    const permissions = [SnapbackClient.roomPermission('boardMember', scope)];
    await assertThrows(
      () => db.subscribeEphemeral(cursorRef, {
        connectionId: 'blocked_sub',
        scope,
        userId: GRACE,
        transport: 'poll',
      }),
      'SNAPBACK_EPHEMERAL_UNAUTHORIZED',
      'non-member subscribe should fail',
    );
    await assertThrows(
      () => db.publishEphemeral(cursorRef, { connectionId: 'blocked_pub', scope, userId: GRACE, value: { x: 1, y: 1 } }),
      'SNAPBACK_EPHEMERAL_UNAUTHORIZED',
      'non-member publish should fail',
    );

    const durableBefore = (await db.inspect()).storage.version;
    const overlay = await db.subscribeEphemeral(cursorRef, {
      connectionId: 'cursor_observer',
      scope,
      userId: ADA,
      permissions,
      transport: 'poll',
    });
    assertEqual(overlay.currentEntries(), [], 'initial cursor snapshot');
    await overlay.publish({ x: 1, y: 2, color: 'red' }, {
      connectionId: 'cursor_publisher',
      userId: ADA,
      permissions,
    });
    await overlay.drain();
    assertEqual(overlay.currentEntries().map((entry) => entry.value), [{ x: 1, y: 2, color: 'red' }], 'cursor upsert');
    assertEqual((await db.inspect()).storage.version, durableBefore, 'cursor publish must not advance durable version');

    for (let i = 0; i < 6; i += 1) {
      await db.publishEphemeral(cursorRef, {
        connectionId: 'cursor_publisher',
        scope,
        userId: ADA,
        permissions,
        value: { x: i, y: i + 1 },
      });
    }
    await overlay.drain();
    assertEqual(overlay.currentEntries().map((entry) => entry.value), [{ x: 5, y: 6 }], 'coalesced latest cursor value');

    const gonePublish = await db.publishEphemeral(cursorRef, {
      connectionId: 'cursor_gone',
      scope,
      userId: ADA,
      permissions,
      value: { x: 30, y: 40 },
    });
    await overlay.drain();
    // @ref LLP 0031#connection-capability-grants — reset/retirement containment
    // may map the kit's readable label to an opaque wire connection id.
    // Connection-owned entries use that granted identity, which the confirmed
    // publish returns as its key.
    assert(overlay.currentEntries().some((entry) => entry.key === gonePublish.key), 'disconnect cursor missing before disconnect');
    await db.disconnect('cursor_gone');
    await overlay.drain();
    assert(!overlay.currentEntries().some((entry) => entry.key === gonePublish.key), 'disconnect should remove connection-owned cursor');

    const mixedOverlay = await db.subscribeEphemeral(cursorRef, {
      connectionId: 'mixed_lane',
      scope,
      userId: ADA,
      permissions,
      transport: 'poll',
    });
    await db.liveQuery(api.listTodos, { connectionId: 'mixed_lane', userId: ADA });
    for (let i = 0; i < 6; i += 1) {
      await db.publishEphemeral(cursorRef, {
        connectionId: 'mixed_publisher',
        scope,
        userId: ADA,
        permissions,
        value: { x: 100 + i, y: 200 + i },
      });
    }
    const mixedDeliveriesBefore = (await db.inspect()).liveDelivery.totalDeliveries;
    await db.mutate(api.createTodo, { args: { title: 'Durable during cursor flood' }, userId: ADA });
    // Phase 1 (LLP 0200): wait until the scheduled fan-out has enqueued the
    // durable frame, then prove durable-lane priority within a single drain.
    await eventually(async () => {
      assert(
        (await db.inspect()).liveDelivery.totalDeliveries > mixedDeliveriesBefore,
        'durable fan-out for the flood mutation not yet delivered',
      );
    }, 'durable frame enqueued under cursor flood');
    const mixedEnvelopes = await db.drainEnvelopes('mixed_lane');
    assert(mixedEnvelopes[0]?.Durable, `first mixed-lane message was not durable: ${JSON.stringify(mixedEnvelopes[0])}`);
    const durableUpdate = JSON.parse(Buffer.from(mixedEnvelopes[0].Durable.payload).toString('utf8'));
    assert(durableUpdate.rows.some((row) => row.title === 'Durable during cursor flood'), 'durable update missing under cursor load');
    for (const envelope of mixedEnvelopes.slice(1)) mixedOverlay.apply(envelope);
    assert(mixedOverlay.currentEntries().some((entry) => entry.value.x === 105), 'mixed lane cursor latest value missing');

    await assertThrows(
      () => db.publishEphemeral(cursorRef, {
        connectionId: 'oversized_cursor',
        scope,
        userId: ADA,
        permissions,
        value: 'x'.repeat(1_100),
      }),
      'SNAPBACK_EPHEMERAL_VALUE_TOO_LARGE',
      'oversized cursor should fail',
    );
    let rateLimited = 0;
    for (let i = 0; i < 16; i += 1) {
      try {
        await db.publishEphemeral(cursorRef, {
          connectionId: 'rate_cursor',
          scope,
          userId: ADA,
          permissions,
          value: { x: i, y: i },
        });
      } catch (error) {
        if (error.diagnostic?.code === 'SNAPBACK_EPHEMERAL_RATE_LIMITED') rateLimited += 1;
        else throw error;
      }
    }
    assert(rateLimited > 0, 'expected at least one rate-limited cursor publish');

    const stream = db.openLiveStream('ws_cursor');
    try {
      await stream.ready;
      // @ref LLP 0031#connection-capability-grants — raw wire frames assert
      // the granted id bound to this socket, not the kit's readable label.
      const wsCursorGrant = await db.connectionGrant('ws_cursor');
      stream.sendJson({
        type: 'ephemeral_subscribe',
        requestId: 'sub-1',
        request: {
          collection: 'boardCursors',
          scope,
          connection_id: wsCursorGrant.id,
          auth: SnapbackClient.auth(ADA, { permissions }),
        },
      });
      const subAck = await stream.nextUpdate();
      assertEqual(subAck.kind, 'ephemeral_ack', 'ws subscribe ack kind');
      assertEqual(subAck.operation, 'subscribe', 'ws subscribe ack operation');
      stream.sendJson({
        type: 'ephemeral_publish',
        requestId: 'pub-1',
        request: {
          collection: 'boardCursors',
          scope,
          connection_id: wsCursorGrant.id,
          session_id: null,
          user_id: null,
          custom_key: null,
          value: [...new TextEncoder().encode(JSON.stringify({ x: 7, y: 8 }))],
          ttl_ms: null,
          auth: SnapbackClient.auth(ADA, { permissions }),
        },
      });
      const pubAck = await stream.nextUpdate();
      assertEqual(pubAck.kind, 'ephemeral_ack', 'ws publish ack kind');
      assertEqual(pubAck.operation, 'publish', 'ws publish ack operation');
      return { coalesced: (await db.inspect()).ephemeral.coalescedUpdates, rateLimited };
    } finally {
      stream.close();
    }
  });

  // Phase 1 (LLP 0200): live fan-out is scheduled off the commit turn, and a
  // subscription the matcher skips converges through a rows-free
  // `current_as_of` watermark at the commit's version instead of silence.
  // Draining until that watermark arrives is the deterministic "the fan-out
  // pass for this commit ran" signal; only then are an empty row-bearing
  // drain and the per-pass matcher counters meaningful.
  const drainUpdatesUntilWatermark = async (connectionId, version) => {
    const updates = [];
    await eventually(async () => {
      updates.push(...await db.drainUpdates(connectionId));
      assert(
        updates.some((u) => u.kind === 'current_as_of' && u.version >= version),
        `no current_as_of watermark at version ${version} yet`,
      );
    }, `convergence watermark for ${connectionId}`);
    return updates;
  };
  const rowBearing = (updates) => updates.filter((u) => u.kind !== 'current_as_of');

  await suite.check('realtime matcher skips unrelated user-scoped mutations', async () => {
    await db.reset();
    await db.seed(seed);
    await db.liveQuery(api.listTodos, { connectionId: 'client_disjoint', userId: ADA });
    const graceCreate = await db.mutate(api.createTodo, { args: { title: 'Grace private todo' }, userId: GRACE });
    const updates = await drainUpdatesUntilWatermark('client_disjoint', graceCreate.version);
    assertEqual(rowBearing(updates), [], 'other-user create should not refresh Ada subscription');
    const state = await db.inspect();
    assertEqual(state.liveDelivery.lastSkipped, 1, 'matcher skip count');
    // Phase 1 (LLP 0200): the skipped subscription's convergence watermark is
    // itself counted as one (rows-free) delivery; the drain filter above
    // proves nothing row-bearing crossed.
    assertEqual(state.liveDelivery.lastDeliveries, 1, 'watermark-only delivery count');
    return { updates: updates.length, liveDelivery: state.liveDelivery };
  });

  await suite.check('realtime matcher skips hidden row patch and delete', async () => {
    await db.reset();
    const hidden = await db.mutate(api.createTodo, { args: { title: 'Grace hidden row' }, userId: GRACE });
    await db.liveQuery(api.listTodos, { connectionId: 'client_hidden', userId: ADA });
    const hiddenPatch = await db.mutate(api.setCompleted, { args: { id: hidden.result, completed: true }, userId: GRACE });
    assertEqual(
      rowBearing(await drainUpdatesUntilWatermark('client_hidden', hiddenPatch.version)),
      [],
      'hidden patch should not refresh Ada subscription',
    );
    const patchState = await db.inspect();
    assertEqual(patchState.liveDelivery.lastSkipped, 1, 'hidden patch skip count');
    // Phase 1 (LLP 0200): the skip's convergence watermark counts as one
    // rows-free delivery (see the unrelated-mutation check above).
    assertEqual(patchState.liveDelivery.lastDeliveries, 1, 'hidden patch watermark-only delivery count');
    const hiddenDelete = await db.mutate(api.deleteTodo, { args: { id: hidden.result }, userId: GRACE });
    assertEqual(
      rowBearing(await drainUpdatesUntilWatermark('client_hidden', hiddenDelete.version)),
      [],
      'hidden delete should not refresh Ada subscription',
    );
    const deleteState = await db.inspect();
    assertEqual(deleteState.liveDelivery.lastSkipped, 1, 'hidden delete skip count');
    assertEqual(deleteState.liveDelivery.lastDeliveries, 1, 'hidden delete watermark-only delivery count');
    return { hiddenId: hidden.result, liveDelivery: deleteState.liveDelivery };
  });

  await suite.check('realtime matcher uses captured In predicates beyond auth scope', async () => {
    await db.loadFunctions(functionManifestWithCompletedLiveQuery());
    await db.reset();
    const completed = await db.liveQuery(completedLiveRef, { connectionId: 'client_completed', userId: ADA });
    assertEqual(completed.rows, [], 'initial completed rows');

    const created = await db.mutate(api.createTodo, { args: { title: 'Still open' }, userId: ADA });
    assertEqual(
      rowBearing(await drainUpdatesUntilWatermark('client_completed', created.version)),
      [],
      'completed=false insert should not refresh completed=true subscription',
    );
    const skipped = await db.inspect();
    assertEqual(skipped.liveDelivery.lastSkipped, 1, 'completed=false skip count');
    // Phase 1 (LLP 0200): the skip's convergence watermark counts as one
    // rows-free delivery (see the unrelated-mutation check above).
    assertEqual(skipped.liveDelivery.lastDeliveries, 1, 'completed=false watermark-only delivery count');

    await db.mutate(api.setCompleted, { args: { id: created.result, completed: true }, userId: ADA });
    const rows = await eventually(async () => {
      const polled = await completed.poll();
      assertEqual(polled.length, 1, 'completed=true update should refresh subscription');
      return polled;
    }, 'completed=true refresh for client_completed');
    assertEqual(rows[0]._id, created.result, 'completed row id');
    assertEqual(rows[0].completed, true, 'completed row flag');
    const delivered = await db.inspect();
    assertEqual(delivered.liveDelivery.lastDeliveries, 1, 'completed=true delivery count');
    assertEqual(delivered.liveDelivery.lastSkipped, 0, 'completed=true skip count');
    return { id: created.result, liveDelivery: delivered.liveDelivery };
  });

  await suite.check('ordinary query is honestly reported as NOT syncable', async () => {
    // @ref LLP 0004#relationship-to-sync-and-realtime — callable != syncable-live.
    const err = await assertThrows(
      () => db.subscribeLive(api.listTodosOnce, { connectionId: 'client_c', userId: ADA }),
      'SNAPBACK_FUNCTION_NOT_LIVE',
      'expected non-live rejection',
    );
    return { code: err.diagnostic.code };
  });

  await suite.check('read-set conflict prevents a stale-invariant commit', async () => {
    await db.reset();
    const created = await db.mutate(api.createTodo, { args: { title: 'Conflict' }, userId: ADA });
    const id = created.result;
    const observed = (await db.query(api.listTodos, { userId: ADA })).rows[0]._version;
    // A concurrent writer advances the row...
    await db.mutate(api.setCompleted, { args: { id, completed: true }, userId: ADA });
    // ...so a mutation carrying the stale read-set must be rejected as a conflict.
    const err = await assertThrows(
      () => db.mutate(api.setCompleted, {
        args: { id, completed: false },
        userId: ADA,
        readSet: [{ table: 'todos', id, version: observed }],
      }),
      'SNAPBACK_MUTATION_CONFLICT',
      'expected conflict',
    );
    return { code: err.diagnostic.code, dependency: err.diagnostic.details?.dependency ?? null };
  });

  await suite.check('diagnostic: invalid schema (system field) fails loud', async () => {
    const err = await assertThrows(
      () => db.loadSchema({ schema_hash: 'bad', tables: [{ name: 'bad', fields: [{ name: '_id', field_type: 'String', optional: false }], indexes: [], syncable: false }] }),
      'SNAPBACK_SCHEMA_SYSTEM_FIELD',
      'expected system-field rejection',
    );
    return { code: err.diagnostic.code };
  });

  await suite.check('diagnostic: artifact version mismatch is structured', async () => {
    const err = await assertThrows(
      () => db.loadSchema({ ...schemaManifest, schemaVersion: 'snapback.v999' }),
      'SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION',
      'expected stale schema artifact version',
    );
    assertEqual(err.diagnostic.details.expectedSchemaVersion, 'snapback.v0', 'expected schema version detail');
    return { code: err.diagnostic.code, details: err.diagnostic.details };
  });

  await suite.check('diagnostic: invalid query (unknown field) fails loud at the server', async () => {
    // Hand-built bad function (bypasses codegen) to prove the SERVER also rejects it.
    await db.loadSchema(schemaManifest);
    const load = await db.loadFunctions({
      artifactKind: 'functionManifest',
      schemaVersion: 'snapback.v0',
      appId: 'todo',
      bundleHash: 'bad-query',
      inputsHash: 'bad-query',
      functions: [{ id: 'todo:badQuery', name: 'badQuery', kind: 'Query', runtime: { HostPlan: { Query: { table: 'todos', filters: [{ field: 'nope', op: 'Eq', value: { Literal: 'x' } }], order: [], limit: null, indexed_by: null } } } }],
    });
    const invalid = load.diagnostics.find(
      (diagnostic) => diagnostic.code === 'SNAPBACK_FUNCTION_SCHEMA_REFERENCE_INVALID',
    );
    assert(
      invalid && invalid.message.includes('unknown field todos.nope'),
      `expected load-time unknown-field schema-reference rejection, got ${load.diagnostics.map((diagnostic) => diagnostic.code)}`,
    );
    const absent = await assertThrows(
      () => db.query('badQuery', { userId: ADA }),
      'SNAPBACK_UNKNOWN_FUNCTION',
      'an invalid function manifest must install nothing',
    );
    return { code: invalid.code, installCode: absent.diagnostic.code };
  });

  await suite.check('diagnostic: handler ambient capability denial is structured', async () => {
    await db.loadSchema(schemaManifest);
    await db.loadFunctions({
      artifactKind: 'functionManifest',
      schemaVersion: 'snapback.v0',
      appId: 'todo',
      bundleHash: 'bad-handler',
      inputsHash: 'bad-handler',
      functions: [{
        id: 'todo:badFetch',
        name: 'badFetch',
        kind: 'Query',
        runtime: { IbexModule: { export: 'badFetch', source: 'globalThis.__snapbackHandlers = { async badFetch() { return await fetch("https://example.com/"); } };' } },
      }],
    });
    const err = await assertThrows(() => db.query('badFetch', { userId: ADA }), 'SNAPBACK_HANDLER_CAPABILITY_DENIED', 'expected denied fetch');
    return { code: err.diagnostic.code };
  });

  await suite.check('diagnostic: handler throw is structured', async () => {
    await db.loadSchema(schemaManifest);
    await db.loadFunctions({
      artifactKind: 'functionManifest',
      schemaVersion: 'snapback.v0',
      appId: 'todo',
      bundleHash: 'bad-handler',
      inputsHash: 'bad-handler',
      functions: [{
        id: 'todo:badThrow',
        name: 'badThrow',
        kind: 'Query',
        runtime: { IbexModule: { export: 'badThrow', source: 'globalThis.__snapbackHandlers = { async badThrow() { throw new Error("boom"); } };' } },
      }],
    });
    const err = await assertThrows(() => db.query('badThrow', { userId: ADA }), 'SNAPBACK_HANDLER_FAILED', 'expected structured handler failure');
    return { code: err.diagnostic.code };
  });

  await suite.check('codegen fails closed on an invalid definition (no silent drop)', async () => {
    // @ref LLP 0010#generated-artifacts — codegen catches the same class early.
    const result = await generate(join(here, 'fixtures', 'invalid-backend'));
    assert(!result.ok, 'codegen should have failed');
    const codes = result.diagnostics.map((d) => d.code);
    assert(codes.includes('QUERY_UNKNOWN_FIELD'), `expected QUERY_UNKNOWN_FIELD, got ${codes}`);
    return { codes };
  });

  const report = suite.finish();
  const cleanupErrors = [];
  try {
    await server.stop();
  } catch (error) {
    cleanupErrors.push(error instanceof Error ? error.message : String(error));
  }
  const retainedReport = {
    schemaVersion: 'snapback.todo-v0-receipt.v1',
    ...report,
    ok: report.ok && cleanupErrors.length === 0,
    outcome: report.ok && cleanupErrors.length === 0 ? 'pass' : 'fail',
    cleanupErrors,
    cleanupErrorCount: cleanupErrors.length,
  };
  if (receiptFile !== null) writeMachineReport(receiptFile, retainedReport);
  console.log('\n--- machine-readable report ---');
  console.log(JSON.stringify(retainedReport));
  process.exit(retainedReport.ok ? 0 : 1);
} catch (error) {
  console.error('acceptance harness crashed:', error);
  await server.stop();
  process.exit(2);
}

async function adminRun(name, input) {
  assert(
    typeof server.adminToken === 'string' && server.adminToken.length > 0,
    'startServer returned no admin token for the Todo acceptance function runner',
  );
  const res = await fetch(`${server.baseUrl}/_snapback/api/functions/${name}/run`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-snapback-admin-token': server.adminToken,
    },
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (!res.ok) {
    const error = new Error(json?.diagnostic?.code ?? `HTTP_${res.status}`);
    error.diagnostic = json?.diagnostic;
    throw error;
  }
  return json;
}

function functionManifestWithCompletedLiveQuery() {
  return {
    ...functionManifest,
    bundleHash: `${functionManifest.bundleHash}:completed-live-test`,
    functions: [
      ...functionManifest.functions,
      {
        id: 'todo:listCompletedTodos',
        name: 'listCompletedTodos',
        exportedName: 'listCompletedTodos',
        kind: 'LiveQuery',
        sourceSpan: null,
        requiredCapabilities: ['live_subscriptions', 'ibex_ctx_db_host_bridge'],
        authRequirement: 'optional-user',
        syncabilityClass: 'syncable-live',
        readSetSummary: {
          mode: 'handlerDeclared',
          primaryTable: 'todos',
          tables: ['todos'],
          authScopeField: 'userId',
        },
        writeSetSummary: {
          mode: 'handlerDeclared',
          primaryTable: null,
          tables: [],
        },
        bundleEntrypoint: 'listCompletedTodos',
        runtime: {
          IbexModule: {
            export: 'listCompletedTodos',
            source: completedLiveHandlerSource,
          },
        },
      },
    ],
  };
}
