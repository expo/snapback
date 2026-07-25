// Todo v2 — Channel C authenticated register-mode boot (LLP 0090 rollout
// step 7, ENG-25458; contracts LLP 0092 §0D + the LLP 0031 dated
// pending-registration-owner amendment).
//
// Drives the real client kit and the real Contract adapter (mock Exact
// runtime) against a live local server and proves the step-7 list at the
// wire level:
//   - boot produces exactly ONE snapshot per query on the wire — the
//     register-mode bundle's — and auth-scoped entries carry `resume: null`
//     in the raw response body (no resume token for auth-scoped queries);
//   - the surface adopts each bundle registration: bundle rows reach the
//     Contract boundary with zero `/live/*/subscribe` POSTs and zero
//     `/connection/open` handshakes (the bundle grant is adopted);
//   - the subsequent socket attach presents the bundle grant and delivers
//     nothing at attach; every later durable envelope carries a version
//     strictly past the bundle's commit cut (listTodos is ordered, so its
//     result-changing lane is replace-only per LLP 0090 D1.3 — the
//     no-duplicate fact is that the bundle snapshot itself never re-rides
//     the socket);
//   - a lost bundle response retried with the SAME boot key supersedes
//     (same connection identity, rotated grant secret) and does not
//     duplicate subscriptions: one delta per mutation, one server-side
//     subscription for the connection;
//   - deep-link cold start (D4): one bundle request into the parameterized
//     `/priority/:priority` route (params-v1) replaces two per-query
//     subscribe round trips, and both registrations are live;
//   - an anonymous register-mode request refuses
//     SNAPBACK_BUNDLE_REGISTER_REQUIRES_CREDENTIAL, and an anonymous READ of
//     this auth-scoped route refuses SNAPBACK_BUNDLE_NOT_PUBLIC (nothing
//     here is publicInline).
//
// Run: node demos/todo-v2/tests/acceptance/register-boot.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { SnapbackClient, createRqsRegisteredRegistry } from '../../../_kit/client.mjs';
import { createSnapbackContractSurface } from '../../../../packages/snapback-contract/index.mjs';
import { startServer } from '../../../_kit/server-process.mjs';
import { createSuite, runAcceptance, assert, assertEqual } from '../../../_kit/harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const backendDir = join(here, '..', '..', 'snapback');
const gen = (file) => JSON.parse(readFileSync(join(backendDir, 'generated', file), 'utf8'));

const schemaManifest = gen('schema.manifest.json');
const functionsManifest = gen('functions.manifest.json');
const routesManifest = gen('routes.manifest.json');
const contractDataManifest = gen('contract-data.manifest.json');
const artifactIndex = gen('artifacts.json');
const seed = JSON.parse(readFileSync(join(backendDir, 'seed.json'), 'utf8'));

const ADA = 'user_ada';
const ADA_SEED_IDS = ['seed_todo_1', 'seed_todo_2', 'seed_todo_3'];

// ---------------------------------------------------------------------------
// Wire instrumentation: every HTTP request and every socket frame in the run
// is recorded, so "exactly one snapshot on the wire" is a counted fact, not
// an inference.
// ---------------------------------------------------------------------------
const httpLog = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(typeof input === 'string' ? input : input?.url ?? input);
  const record = {
    url,
    path: (() => { try { return new URL(url).pathname; } catch { return url; } })(),
    method: init.method ?? 'GET',
    body: null,
    responseText: null,
  };
  try { record.body = init.body ? JSON.parse(init.body) : null; } catch { record.body = null; }
  httpLog.push(record);
  const response = await realFetch(input, init);
  if (record.path === '/app/bundle') {
    record.responseText = await response.clone().text();
  }
  return response;
};

const socketLog = [];
const RealWebSocket = globalThis.WebSocket;
globalThis.WebSocket = class extends RealWebSocket {
  constructor(url, protocols) {
    super(url, protocols);
    const record = { url: String(url), frames: [] };
    socketLog.push(record);
    this.addEventListener('message', (event) => {
      try { record.frames.push(JSON.parse(String(event.data))); } catch { /* control */ }
    });
  }
};

const subscribePosts = () => httpLog.filter((r) => /\/live\/[^/]+\/subscribe$/.test(r.path));
const connectionOpens = () => httpLog.filter((r) => r.path === '/connection/open');
const framesFor = (connectionId) => socketLog
  .filter((record) => record.url.includes(`/live/${connectionId}/stream`))
  .flatMap((record) => record.frames);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitUntil(predicate, { timeoutMs = 15_000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(100);
  }
}

// The Exact runtime stub the package tests use: a boundary the adapter
// writes server rows into, plus provider handles (the real runtime is
// exercised by the browser surface; this suite is about the wire).
function mockRuntime() {
  return {
    createContractMockQueryBoundary(initialRows) {
      const rows = new Map(Object.entries(initialRows));
      return {
        query(key, project = (value) => value) {
          return project(rows.get(key) ?? []);
        },
        write(key, updater) {
          const next = updater(rows.get(key) ?? []);
          rows.set(key, next);
          return next;
        },
      };
    },
    createBoundaryContractDataProvider(_manifest, boundary, options) {
      return {
        boundary,
        queries: options.queries ?? {},
        mutations: options.mutations ?? {},
        ephemerals: options.ephemerals ?? {},
        subscribe(name, args, observer) {
          const query = options.queries?.[name];
          if (!query) {
            observer({ status: 'error', rows: [] });
            return { dispose() {} };
          }
          observer({ status: 'ready', rows: query(args, boundary) });
          return { dispose() {} };
        },
      };
    },
    createProviderEphemeralHandle(provider, name, args) {
      return { provider, name, args };
    },
    createProviderQueryHandle(provider, name, args) {
      return { provider, name, args };
    },
  };
}

const EXPECTED_CHECKS = 7;
const suite = createSuite('todo-v2 register-mode boot (LLP 0090 step 7)', {
  expectedChecks: EXPECTED_CHECKS,
});
const cleanups = [() => { globalThis.fetch = realFetch; globalThis.WebSocket = RealWebSocket; }];

async function main() {
  await runAcceptance(suite, async () => {
    const server = await startServer({
      port: 0,
      db: ':memory:',
      cwd: repoRoot,
      provenance: {
        appId: 'todo-v2',
        artifactsPath: join(backendDir, 'generated', 'artifacts.json'),
      },
    });
    cleanups.push(() => server.stop());
    const apiUrl = server.baseUrl;

    await suite.check('one ensure provisions schema + functions + seed + routes', async () => {
      const client = new SnapbackClient(apiUrl, server.clientOptions);
      const outcome = await client.ensureApp({
        schema: schemaManifest,
        functions: functionsManifest,
        seed,
        routes: routesManifest,
      });
      assertEqual(outcome.routes, 'provisioned', 'routes manifest outcome');
      return outcome;
    });

    // The boot client: the same construction main.ts performs.
    const client = new SnapbackClient(apiUrl, server.clientOptions);
    let bootBundle = null;
    let registry = null;

    await suite.check('register-mode bundle is the one snapshot on the wire; auth-scoped entries carry resume: null', async () => {
      bootBundle = await client.fetchBundle({ route: '/', mode: 'register', userId: ADA });
      const wire = httpLog.findLast((record) => record.path === '/app/bundle');
      assert(wire?.responseText != null, 'raw bundle response captured');
      // Wire-level proof: the closed union serializes resume explicitly null
      // for the auth-scoped entry — no token anywhere in the response.
      const raw = JSON.parse(wire.responseText);
      assertEqual(raw.entries.length, 1, 'one entry for /');
      assertEqual(raw.entries[0].function, 'listTodos', 'entry names listTodos');
      assert('resume' in raw.entries[0], 'closed union serializes resume');
      assertEqual(raw.entries[0].resume, null, 'auth-scoped entry carries resume: null on the wire');
      assert(!wire.responseText.includes('"token"'), 'no resume token appears in the raw body');
      assert(typeof raw.entries[0].subscriptionId === 'string', 'register entry carries its subscription id');
      assertEqual(
        raw.entries[0].rows.map((row) => row._id),
        ADA_SEED_IDS,
        'the bundle snapshot is the seeded rows',
      );
      assert(raw.connection?.connectionId && raw.connection?.grant, 'connection grant minted in the same response');
      assertEqual(subscribePosts().length, 0, 'no snapshot-with-subscribe rode the wire');
      registry = createRqsRegisteredRegistry(bootBundle);
      assertEqual(registry.size, 1, 'registry holds the registration');
      return {
        commitVersion: raw.commitVersion,
        subscriptionId: raw.entries[0].subscriptionId,
        connectionId: raw.connection.connectionId,
      };
    });

    let surface = null;
    await suite.check('surface adopts the registration: bundle rows paint with zero subscribes and zero extra handshakes', async () => {
      surface = await createSnapbackContractSurface({
        queryName: 'listTodos',
        boundaryKey: 'todos',
        runtime: mockRuntime(),
        client,
        userId: ADA,
        manifest: contractDataManifest,
        artifactIndex,
        schemaManifest,
        functionManifest: functionsManifest,
        connectionId: registry.connection.connectionId,
        rqsRegistered: (name, args) => registry.consume(name, args),
      });
      cleanups.push(() => surface.dispose?.());
      assertEqual(
        surface.links.listTodos().map((row) => row._id),
        ADA_SEED_IDS,
        'the Contract boundary painted the bundle snapshot',
      );
      assertEqual(subscribePosts().length, 0, 'adoption opened no fresh snapshot-with-subscribe');
      assertEqual(connectionOpens().length, 0, 'the adopted bundle grant needs no /connection/open handshake');
      assertEqual(registry.consume('listTodos', {}), null, 'consumption is one-shot');
      return { boundaryRows: surface.links.listTodos().length };
    });

    await suite.check('socket attach presents the grant; nothing replays at attach and every later envelope advances past the cut', async () => {
      const connectionId = registry.connection.connectionId;
      const attached = await waitUntil(
        () => socketLog.find((record) => record.url.includes(`/live/${connectionId}/stream`)),
        { label: 'socket attach under the bundle connection' },
      );
      // Settle window: the attach handoff itself must deliver nothing — the
      // bundle response was the snapshot, and no duplicate rides the socket.
      await sleep(700);
      assertEqual(
        attached.frames.filter((frame) => frame.version != null).length,
        0,
        `attach replayed durable traffic: ${JSON.stringify(attached.frames)}`,
      );

      await client.mutate('createTodo', {
        args: { title: 'After the registered boot', priority: 'low' },
        userId: ADA,
      });
      await waitUntil(
        () => surface.links.listTodos().some((row) => row.title === 'After the registered boot'),
        { label: 'the mutation reaching the adopted subscription' },
      );
      // listTodos is an ORDERED query, so its live lane is replace-only
      // (DK-3 excludes ordered results — LLP 0090 D1.3); the no-duplicate
      // fact is version monotonicity: every envelope after boot carries a
      // version strictly past the bundle's commit cut — new state, never a
      // replay of the snapshot that rode the bundle response.
      const durable = framesFor(connectionId).filter((frame) => frame.version != null);
      assert(durable.length >= 1, 'the mutation arrived over the socket');
      const stale = durable.filter((frame) => frame.version <= bootBundle.commitVersion);
      assertEqual(stale.length, 0, `no envelope re-delivered the bundle cut: ${JSON.stringify(stale)}`);
      assertEqual(subscribePosts().length, 0, 'still zero subscribe POSTs after live traffic');
      return { durableFrames: durable.length, commitVersion: bootBundle.commitVersion };
    });

    await suite.check('lost-response retry with the same boot key: rotated grant, one registration set, one delta per mutation', async () => {
      const retryClient = new SnapbackClient(apiUrl, server.clientOptions);
      const bootKey = SnapbackClient.mintBundleBootKey();
      const first = await retryClient.fetchBundle({
        route: '/', mode: 'register', idempotencyKey: bootKey, userId: ADA,
      });
      // The response is "lost"; the client retries the same boot attempt.
      const second = await retryClient.fetchBundle({
        route: '/', mode: 'register', idempotencyKey: bootKey, userId: ADA,
      });
      assertEqual(
        second.connection.connectionId,
        first.connection.connectionId,
        'the retry keeps the connection identity',
      );
      assert(second.connection.grant !== first.connection.grant, 'the grant secret rotates on retry');

      const retryRegistry = createRqsRegisteredRegistry(second);
      const handle = await retryClient.liveQuery('listTodos', {
        connectionId: second.connection.connectionId,
        userId: ADA,
        transport: 'stream',
        persistResume: false,
        registeredSubscription: retryRegistry.consume('listTodos', {}),
      });
      cleanups.push(() => handle.dispose());
      const connectionId = second.connection.connectionId;
      await waitUntil(
        () => socketLog.some((record) => record.url.includes(`/live/${connectionId}/stream`)),
        { label: 'retry-boot socket attach' },
      );
      const title = 'Exactly one delivery after the superseded retry';
      await retryClient.mutate('createTodo', { args: { title, priority: 'low' }, userId: ADA });
      await waitUntil(
        () => handle.rows.some((row) => row.title === title),
        { label: 'the mutation reaching the retried registration' },
      );
      const deliveries = framesFor(connectionId).filter((frame) => (
        (frame.rows ?? []).some((row) => row.title === title)
        || (frame.ops ?? []).some((op) => op.row?.title === title)
      ));
      assertEqual(deliveries.length, 1, 'the superseded set does not double-deliver');

      // Server-side: the superseded registration is gone and the retry's
      // registration is the one that lives (no duplicate set).
      const firstSub = first.entries[0].subscriptionId;
      const secondSub = second.entries[0].subscriptionId;
      assert(firstSub !== secondSub, 'the retry minted a superseding registration');
      const inspect = await (await realFetch(`${apiUrl}/inspect`)).json();
      const liveIds = (inspect.subscriptions ?? []).map((sub) => sub.id);
      assert(liveIds.includes(secondSub), `the retried registration is live: ${JSON.stringify(liveIds)}`);
      assert(!liveIds.includes(firstSub), 'the superseded registration was purged, not duplicated');
      return { deliveries: deliveries.length, firstSub, secondSub };
    });

    await suite.check('deep-link cold start: one params-v1 bundle request replaces two per-query subscribes', async () => {
      const deepClient = new SnapbackClient(apiUrl, server.clientOptions);
      const before = httpLog.length;
      const bundle = await deepClient.fetchBundle({
        route: '/priority/:priority',
        params: { priority: 'high' },
        mode: 'register',
        userId: ADA,
      });
      assertEqual(bundle.entries.length, 2, 'both queries in one request');
      const byName = new Map(bundle.entries.map((entry) => [entry.function, entry]));
      assertEqual(
        byName.get('listTodosByPriority').args,
        { priority: 'high' },
        'params-v1 bound the route param into the args',
      );
      assertEqual(
        byName.get('listTodosByPriority').rows.map((row) => row._id),
        ['seed_todo_2'],
        'the parameterized slice is evaluated at the cut',
      );
      assertEqual(byName.get('listTodos').resume, null, 'auth-scoped: no token');
      assertEqual(byName.get('listTodosByPriority').resume, null, 'auth-scoped: no token');
      assert(
        byName.get('listTodos').subscriptionId !== byName.get('listTodosByPriority').subscriptionId,
        'each query owns its registration',
      );

      const deepRegistry = createRqsRegisteredRegistry(bundle);
      assertEqual(deepRegistry.size, 2);
      const handles = [];
      for (const [name, args] of [
        ['listTodos', {}],
        ['listTodosByPriority', { priority: 'high' }],
      ]) {
        handles.push(await deepClient.liveQuery(name, {
          connectionId: bundle.connection.connectionId,
          args,
          userId: ADA,
          transport: 'stream',
          persistResume: false,
          registeredSubscription: deepRegistry.consume(name, args),
        }));
      }
      cleanups.push(() => handles.forEach((handle) => handle.dispose()));
      const coldStartRequests = httpLog.slice(before);
      assertEqual(
        coldStartRequests.filter((r) => r.path === '/app/bundle').length,
        1,
        'the whole cold start paid one bundle request',
      );
      assertEqual(
        coldStartRequests.filter((r) => /\/live\/[^/]+\/subscribe$/.test(r.path)).length,
        0,
        'zero per-query subscribe round trips on the deep link',
      );

      // Both registrations are armed from the one request: a matching
      // mutation reaches both handles as deltas.
      const title = 'Deep-linked high-priority todo';
      await deepClient.mutate('createTodo', { args: { title, priority: 'high' }, userId: ADA });
      await waitUntil(
        () => handles[0].rows.some((row) => row.title === title)
          && handles[1].rows.some((row) => row.title === title),
        { label: 'both deep-link registrations receiving the delta' },
      );
      return {
        entries: bundle.entries.length,
        sliceRows: byName.get('listTodosByPriority').rows.length,
      };
    });

    await suite.check('anonymous register refuses to read mode; anonymous read of auth-scoped routes refuses NOT_PUBLIC', async () => {
      const post = async (body) => {
        const response = await realFetch(`${apiUrl}/app/bundle`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        return { status: response.status, body: await response.json() };
      };
      const register = await post({
        route: '/', params: {}, mode: 'register',
        idempotencyKey: SnapbackClient.mintBundleBootKey(),
      });
      assertEqual(
        register.body?.diagnostic?.code,
        'SNAPBACK_BUNDLE_REGISTER_REQUIRES_CREDENTIAL',
        `anonymous register is refused explicitly: ${JSON.stringify(register)}`,
      );
      const read = await post({ route: '/', params: {}, mode: 'read' });
      assertEqual(
        read.body?.diagnostic?.code,
        'SNAPBACK_BUNDLE_NOT_PUBLIC',
        `anonymous read of a non-publicInline route refuses: ${JSON.stringify(read)}`,
      );
      return { register: register.status, read: read.status };
    });
  }, { cleanups });
}

await main();
