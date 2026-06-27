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

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const backendDir = join(here, '..', '..', 'snapback');
const gen = (f) => JSON.parse(readFileSync(join(backendDir, 'generated', f), 'utf8'));

const schemaManifest = gen('schema.manifest.json');
const functionManifest = gen('functions.manifest.json');
const seed = JSON.parse(readFileSync(join(backendDir, 'seed.json'), 'utf8'));

const ADA = 'user_ada';
const GRACE = 'user_grace';

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
    assert(state.capability_gaps.includes('ibex_ctx_db_host_bridge'), 'expected honest ctx.db gap');
    return { functions: names, capability_gaps: state.capability_gaps };
  });

  await suite.check('deterministic reset + declarative seed', async () => {
    await db.reset();
    await db.seed(seed);
    const ada = await db.query('listTodosOnce', { userId: ADA });
    assertEqual(ada.rows.map((r) => r._id), ['seed_todo_1', 'seed_todo_2', 'seed_todo_3'], 'seed order');
    return { rows: ada.rows.length };
  });

  await suite.check('user-scoped query (auth filter) isolates users', async () => {
    const grace = await db.query('listTodosOnce', { userId: GRACE });
    assertEqual(grace.rows.map((r) => r.title), ['Plan the kanban demo'], 'grace todos');
  });

  await suite.check('mutation: createTodo returns id; ctx.db write + system fields', async () => {
    await db.reset();
    const created = await db.mutate('createTodo', { args: { title: 'Buy milk' }, userId: ADA });
    assert(typeof created.result === 'string' && created.result.length > 0, 'no id returned');
    assertEqual(created.changed_count, 1, 'changed_count');
    const rows = (await db.query('listTodos', { userId: ADA })).rows;
    assertEqual(rows.length, 1, 'one row');
    const row = rows[0];
    for (const f of ['_id', '_version', '_createdAt', '_updatedAt']) assert(row[f] !== undefined, `missing system field ${f}`);
    assertEqual(row.title, 'Buy milk', 'title');
    assertEqual(row.completed, false, 'completed default');
    assertEqual(row.userId, ADA, 'userId from auth');
    return { id: created.result, version: row._version };
  });

  await suite.check('mutations: toggle, edit, delete', async () => {
    const id = (await db.query('listTodos', { userId: ADA })).rows[0]._id;
    await db.mutate('setCompleted', { args: { id, completed: true }, userId: ADA });
    assertEqual((await db.query('listTodos', { userId: ADA })).rows[0].completed, true, 'toggle');
    await db.mutate('editTitle', { args: { id, title: 'Buy oat milk' }, userId: ADA });
    assertEqual((await db.query('listTodos', { userId: ADA })).rows[0].title, 'Buy oat milk', 'edit');
    const del = await db.mutate('deleteTodo', { args: { id }, userId: ADA });
    assertEqual(del.changed_count, 1, 'delete count');
    assertEqual((await db.query('listTodos', { userId: ADA })).rows.length, 0, 'deleted');
  });

  await suite.check('live subscription returns authoritative initial snapshot', async () => {
    await db.reset();
    await db.seed(seed);
    const handle = await db.liveQuery('listTodos', { connectionId: 'client_a', userId: ADA });
    assertEqual(handle.rows.length, 3, 'snapshot rows');
    return { subscriptionId: handle.subscriptionId, version: handle.version };
  });

  await suite.check('realtime update reaches a second client', async () => {
    // client_b subscribes; client_a issues a mutation; client_b sees the update.
    const b = await db.liveQuery('listTodos', { connectionId: 'client_b', userId: ADA });
    assertEqual(b.rows.length, 3, 'b initial');
    await db.mutate('createTodo', { args: { title: 'Added by another client' }, userId: ADA });
    const rows = await b.poll();
    assertEqual(rows.length, 4, 'b did not receive realtime update');
    assert(rows.some((r) => r.title === 'Added by another client'), 'new row missing');
    return { rows: rows.length };
  });

  await suite.check('ordinary query is honestly reported as NOT syncable', async () => {
    // @ref LLP 0004#relationship-to-sync-and-realtime — callable != syncable-live.
    const err = await assertThrows(
      () => db.subscribeLive('listTodosOnce', { connectionId: 'client_c', userId: ADA }),
      'SNAPBACK_FUNCTION_NOT_LIVE',
      'expected non-live rejection',
    );
    return { code: err.diagnostic.code };
  });

  await suite.check('read-set conflict prevents a stale-invariant commit', async () => {
    await db.reset();
    const created = await db.mutate('createTodo', { args: { title: 'Conflict' }, userId: ADA });
    const id = created.result;
    const observed = (await db.query('listTodos', { userId: ADA })).rows[0]._version;
    // A concurrent writer advances the row...
    await db.mutate('setCompleted', { args: { id, completed: true }, userId: ADA });
    // ...so a mutation carrying the stale read-set must be rejected as a conflict.
    const err = await assertThrows(
      () => db.mutate('setCompleted', {
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
