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

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SnapbackClient } from '../../../_kit/client.mjs';
import { startServer } from '../../../_kit/server-process.mjs';
import { generate } from '../../../_kit/codegen.mjs';
import { assert, assertEqual, assertThrows, createSuite } from '../../../_kit/harness.mjs';
import api from '../../snapback/generated/api.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const backendDir = join(here, '..', '..', 'snapback');
const gen = (f) => JSON.parse(readFileSync(join(backendDir, 'generated', f), 'utf8'));

const schemaManifest = gen('schema.manifest.json');
const functionManifest = gen('functions.manifest.json');
const seed = JSON.parse(readFileSync(join(backendDir, 'seed.json'), 'utf8'));

const ADA = 'user_ada';
const GRACE = 'user_grace';
const completedLiveRef = { name: 'listCompletedTodos', kind: 'LiveQuery' };
const completedLiveHandlerSource = `
globalThis.__snapbackHandlers = {
  async listCompletedTodos(ctx) {
    return await ctx.db
      .query('todos')
      .eq('userId', ctx.auth.userId)
      .eq('completed', true)
      .order('_createdAt', 'asc')
      .collect();
  }
};
`;

const server = await startServer({ port: 4399, db: ':memory:', cwd: repoRoot });
const db = new SnapbackClient(server.baseUrl);
const suite = createSuite('todo / headless');

try {
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
    assertEqual(state.runtime.ibex_ctx_db_host_bridge, 'Available', 'embedded ctx.db bridge capability');
    assert(!state.capability_gaps.includes('ibex_ctx_db_host_bridge'), 'ctx.db bridge should not be reported as a gap once wired');
    assert(state.capabilityManifest.supportedQueryForms.includes('ibex-live-eq-replace'), 'live matcher capability form');
    assert(state.capabilityManifest.supportedQueryForms.includes('websocket-live-replace'), 'websocket live replace capability form');
    assert(!state.capabilityManifest.capabilityGaps.includes('websocket_push_transport'), 'push transport should not be a gap once wired');
    assert(state.capabilityManifest.capabilityGaps.includes('precise_realtime_query_range_matcher'), 'precise range matcher should still be a gap');
    return { functions: names, capability_gaps: state.capability_gaps, bridge: state.runtime.ibex_ctx_db_host_bridge, generatedRef: api.createTodo };
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
    const rows = await b.poll();
    assertEqual(rows.length, 4, 'b did not receive realtime update');
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
      const update = await stream.nextUpdate();
      assertEqual(update.kind, 'live_replace', 'websocket update kind');
      assertEqual(update.subscription_id, live.subscription_id, 'subscription id');
      assert(update.rows.some((r) => r.title === 'Pushed over WebSocket'), 'pushed row missing');
      return { version: update.version, rows: update.rows.length };
    } finally {
      stream.close();
    }
  });

  await suite.check('realtime matcher skips unrelated user-scoped mutations', async () => {
    await db.reset();
    await db.seed(seed);
    await db.liveQuery(api.listTodos, { connectionId: 'client_disjoint', userId: ADA });
    await db.mutate(api.createTodo, { args: { title: 'Grace private todo' }, userId: GRACE });
    const updates = await db.drainUpdates('client_disjoint');
    assertEqual(updates, [], 'other-user create should not refresh Ada subscription');
    const state = await db.inspect();
    assertEqual(state.liveDelivery.last_skipped, 1, 'matcher skip count');
    assertEqual(state.liveDelivery.last_deliveries, 0, 'matcher delivery count');
    return { updates: updates.length, liveDelivery: state.liveDelivery };
  });

  await suite.check('realtime matcher skips hidden row patch and delete', async () => {
    await db.reset();
    const hidden = await db.mutate(api.createTodo, { args: { title: 'Grace hidden row' }, userId: GRACE });
    await db.liveQuery(api.listTodos, { connectionId: 'client_hidden', userId: ADA });
    await db.mutate(api.setCompleted, { args: { id: hidden.result, completed: true }, userId: GRACE });
    assertEqual(await db.drainUpdates('client_hidden'), [], 'hidden patch should not refresh Ada subscription');
    const patchState = await db.inspect();
    assertEqual(patchState.liveDelivery.last_skipped, 1, 'hidden patch skip count');
    assertEqual(patchState.liveDelivery.last_deliveries, 0, 'hidden patch delivery count');
    await db.mutate(api.deleteTodo, { args: { id: hidden.result }, userId: GRACE });
    assertEqual(await db.drainUpdates('client_hidden'), [], 'hidden delete should not refresh Ada subscription');
    const deleteState = await db.inspect();
    assertEqual(deleteState.liveDelivery.last_skipped, 1, 'hidden delete skip count');
    assertEqual(deleteState.liveDelivery.last_deliveries, 0, 'hidden delete delivery count');
    return { hiddenId: hidden.result, liveDelivery: deleteState.liveDelivery };
  });

  await suite.check('realtime matcher uses captured equality predicates beyond auth scope', async () => {
    await db.loadFunctions(functionManifestWithCompletedLiveQuery());
    await db.reset();
    const completed = await db.liveQuery(completedLiveRef, { connectionId: 'client_completed', userId: ADA });
    assertEqual(completed.rows, [], 'initial completed rows');

    const created = await db.mutate(api.createTodo, { args: { title: 'Still open' }, userId: ADA });
    assertEqual(await db.drainUpdates('client_completed'), [], 'completed=false insert should not refresh completed=true subscription');
    const skipped = await db.inspect();
    assertEqual(skipped.liveDelivery.last_skipped, 1, 'completed=false skip count');
    assertEqual(skipped.liveDelivery.last_deliveries, 0, 'completed=false delivery count');

    await db.mutate(api.setCompleted, { args: { id: created.result, completed: true }, userId: ADA });
    const rows = await completed.poll();
    assertEqual(rows.length, 1, 'completed=true update should refresh subscription');
    assertEqual(rows[0]._id, created.result, 'completed row id');
    assertEqual(rows[0].completed, true, 'completed row flag');
    const delivered = await db.inspect();
    assertEqual(delivered.liveDelivery.last_deliveries, 1, 'completed=true delivery count');
    assertEqual(delivered.liveDelivery.last_skipped, 0, 'completed=true skip count');
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
    await db.loadFunctions({
      bundle_hash: 'bad',
      functions: [{ name: 'badQuery', kind: 'Query', runtime: { HostPlan: { Query: { table: 'todos', filters: [{ field: 'nope', op: 'Eq', value: { Literal: 'x' } }], order: [], limit: null, indexed_by: null } } } }],
    });
    const err = await assertThrows(() => db.query('badQuery', { userId: ADA }), 'SNAPBACK_UNKNOWN_FIELD', 'expected unknown-field');
    return { code: err.diagnostic.code };
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
  console.log('\n--- machine-readable report ---');
  console.log(JSON.stringify(report));
  await server.stop();
  process.exit(report.ok ? 0 : 1);
} catch (error) {
  console.error('acceptance harness crashed:', error);
  await server.stop();
  process.exit(2);
}

async function adminRun(name, input) {
  const res = await fetch(`${server.baseUrl}/_snapback/api/functions/${name}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
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
