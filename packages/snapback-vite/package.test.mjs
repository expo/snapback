// @expo/snapback-vite acceptance (LLP 0079 SC-2a): the LLP 0030 MVP plugin against
// a real native server and a real Vite dev server on ephemeral ports with a
// temp database + ready file — managed spawn/handshake/bring-up/teardown,
// attach-mode refusals, the /__snapback method+path allowlist over live
// routes, WebSocket live-stream relaying, and virtual-module sanitization.

import assert from 'node:assert/strict';
import { createServer as createNetServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generateApp, scaffoldApp } from '@expo/snapback-cli';
import { SnapbackClient } from '@expo/snapback-client';

import {
  createSnapbackViteLifecycle,
  matchAppRoute,
  renderVirtualModule,
  resolveGeneratedImport,
  snapbackDev,
} from './index.mjs';

const packageDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageDir, '..', '..');
const runtimeBinary = process.env.SNAPBACK_RUNTIME_BINARY ?? join(repoRoot, 'target', 'debug', 'snapback');
assert.ok(
  existsSync(runtimeBinary),
  `native snapback binary missing at ${runtimeBinary}; run \`cargo build --bin snapback\` or set SNAPBACK_RUNTIME_BINARY`,
);

const ADA = 'user_ada';

function freePort() {
  return new Promise((resolvePort, rejectPort) => {
    const probe = createNetServer();
    probe.once('error', rejectPort);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolvePort(port));
    });
  });
}

async function eventually(check, { timeoutMs = 10_000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value !== false) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
}

// --- Allowlist matrix (no server) -------------------------------------------

{
  const allowed = [
    ['GET', '/'],
    ['GET', '/health'],
    ['GET', '/inspect'],
    ['POST', '/query/listTodos'],
    ['POST', '/mutation/createTodo'],
    ['POST', '/connection/open'],
    ['POST', '/client-mutations/acknowledge'],
    ['GET', '/live/conn_1/stream'],
    ['GET', '/outbox/conn_1'],
    ['POST', '/live/listTodos/subscribe'],
    ['POST', '/ephemeral/publish'],
    ['POST', '/ephemeral/subscribe'],
    ['POST', '/ephemeral/delete'],
    ['POST', '/ephemeral/collections/ensure'],
    ['GET', '/auth/session'],
    ['POST', '/auth/password/signup'],
    ['POST', '/auth/password/signin'],
    ['POST', '/auth/password/change'],
    ['POST', '/auth/password/reset'],
    ['POST', '/auth/recovery/consume'],
    ['POST', '/auth/recovery/rotate'],
    ['POST', '/assets/attempts'],
    ['GET', '/assets/attempts/att_1'],
    ['POST', '/assets/attempts/att_1/cancel'],
    ['POST', '/assets/attempts/att_1/finalize'],
    ['HEAD', '/assets/tus/att_1'],
    ['PATCH', '/assets/tus/att_1'],
    ['DELETE', '/assets/tus/att_1'],
    ['GET', '/assets/records/ast_1'],
    ['DELETE', '/assets/records/ast_1'],
    ['GET', '/assets/records/ast_1/bytes/primary'],
    ['POST', '/assets/records/ast_1/signed-url'],
    ['GET', '/assets/signed/ast_1/primary'],
    ['GET', '/assets/public/ast_1/display'],
  ];
  for (const [method, path] of allowed) {
    assert.equal(matchAppRoute(method, path).allowed, true, `${method} ${path} should forward`);
  }
  const refused = [
    ['POST', '/app/ensure'],
    ['POST', '/_snapback/api/host-ops'],
    ['GET', '/_snapback/api/inspect'],
    ['POST', '/_snapback/api/functions/echo/run'],
    ['GET', '/_snapback/admin'],
    ['POST', '/admin/reset'],
    ['POST', '/admin/schema'],
    ['POST', '/ephemeral/cleanup'],
    ['POST', '/ephemeral/collections'],
    ['POST', '/connections/conn_1/disconnect'],
    ['GET', '/query/listTodos'],
    ['POST', '/live/conn_1/stream'],
    ['POST', '/query/listTodos/extra/deep'],
    ['GET', '/assets/tus/att_1'],
    ['POST', '/assets/records/ast_1'],
    ['GET', '/assets/attempts/att_1/finalize'],
    ['POST', '/assets/public/ast_1/display'],
    ['GET', '/assets/records/ast_1/bytes/primary/extra'],
    ['GET', '/auth/password/signin'],
    ['POST', '/auth/password/unknown'],
    ['POST', '/auth/recovery/unknown'],
    ['POST', '/auth/unknown'],
    ['POST', '/_snapback/api/auth/password/unlock'],
  ];
  for (const [method, path] of refused) {
    assert.equal(matchAppRoute(method, path).allowed, false, `${method} ${path} should be refused`);
  }
  // WebSocket-eligible entry is only the live stream.
  assert.equal(matchAppRoute('GET', '/live/conn_1/stream').route.ws, true);
  assert.equal(matchAppRoute('GET', '/health').route.ws, false);
  console.log('allowlist matrix: app-data forwards, system/admin refused');
}

// --- Virtual module sanitization + factory validation (no server) ------------

{
  const rendered = renderVirtualModule({
    base: '/__snapback',
    state: {
      mode: 'managed',
      shape: 'managed',
      ready: true,
      serverUrl: 'http://127.0.0.1:45123',
      pid: 4242,
      devIdentityCapability: 'sbdev_virtual_module_must_not_leak',
      devIdentityCapabilityFile: '/tmp/virtual-module-must-not-leak.dev-identity',
    },
  });
  assert.match(rendered, /snapbackBasePath = "\/__snapback"/);
  assert.match(rendered, /createSnapbackDevAppBinding/);
  assert.match(rendered, /auth\.passwords/);
  assert.match(rendered, /supervisorGeneration: "vite-relay:standalone"/);
  assert.match(rendered, /"mode":"managed"/);
  assert.ok(!rendered.includes('45123'), 'virtual module must not leak the backend origin');
  assert.ok(!rendered.includes('serverUrl'), 'virtual module must not carry a serverUrl field');
  assert.ok(!rendered.includes('4242'), 'virtual module must not leak the backend pid');
  assert.ok(!rendered.includes('sbdev_'), 'virtual module must not leak the dev-identity capability');
  assert.ok(!rendered.includes('devIdentityCapability'), 'virtual module must not carry dev-identity fields');
  assert.ok(!rendered.includes('dev-identity'), 'virtual module must not leak the dev-identity file path');
  const executableModule = await import(`data:text/javascript;base64,${Buffer.from(renderVirtualModule({
    base: '/__snapback',
    state: { mode: 'managed', shape: 'managed', ready: true },
    supervisorGeneration: 'vite-relay:no-network-witness',
  })).toString('base64')}`);
  const generatedApp = Object.freeze({
    format: 'snapback.app.v1',
    identity: Object.freeze({
      app: 'vite-fixture',
      schema: 'sha256:schema',
      functions: 'sha256:functions',
      descriptor: 'sha256:descriptor',
    }),
    authBootstrap: Object.freeze({ entryMechanisms: Object.freeze(['password-v1']) }),
    capabilities: Object.freeze({ required: Object.freeze(['auth.application-bootstrap.v1']) }),
  });
  const appBinding = executableModule.createSnapbackDevAppBinding(generatedApp);
  assert.equal(appBinding.target.origin, '/__snapback');
  assert.equal(appBinding.provenance.supervisorGeneration, 'vite-relay:no-network-witness');
  assert.deepEqual(appBinding.capabilities.offered, [
    'auth.application-bootstrap.v1',
    'auth.passwords',
  ]);

  assert.throws(() => snapbackDev({ server: { mode: 'bogus' } }), (error) => error.code === 'SNAPBACK_DEV_SERVER_MODE_INVALID');
  assert.throws(() => snapbackDev({ server: { mode: 'external' } }), (error) => error.code === 'SNAPBACK_DEV_EXTERNAL_URL_REQUIRED');
  assert.throws(() => snapbackDev({ route: 'no-slash' }), (error) => error.code === 'SNAPBACK_DEV_PROXY_PATH_INVALID');
  console.log('virtual module sanitized; factory validation refuses bad config');
}

// --- Fixture app -------------------------------------------------------------

const root = realpathSync(mkdtempSync(join(tmpdir(), 'snapback-vite-package-')));
let viteServer = null;
let secondViteServer = null;
try {
  const project = join(root, 'todo-contract');
  assert.equal(scaffoldApp(project).ok, true);
  const backend = join(project, 'snapback');
  writeFileSync(join(backend, 'seed.json'), `${JSON.stringify({
    tables: { todos: [{ _id: 'seed_todo_1', title: 'Seeded during managed bring-up', completed: false, userId: ADA }] },
  })}\n`);
  const generated = await generateApp(backend);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics ?? null));
  const appRoot = join(root, 'app');
  const appImporter = join(appRoot, 'src', 'App.tsx');
  const materializedApiImport = relative(dirname(appImporter), join(backend, 'generated', 'api.mjs'));
  const verifiedApiPath = resolveGeneratedImport(materializedApiImport, appImporter);
  assert.notEqual(verifiedApiPath, join(backend, 'generated', 'api.mjs'));
  assert.match(verifiedApiPath, /[\\/]\.snapback[\\/]codegen-cache[\\/]/);
  const api = (await import(pathToFileURL(verifiedApiPath).href)).default;
  const reviewPlugin = snapbackDev({
    server: { mode: 'off' },
    projectRoot: project,
    generatedRoots: ['snapback/generated'],
  });
  reviewPlugin.config({}, { command: 'build' });
  reviewPlugin.configResolved({ root: project, server: {} });
  const materializedApiPath = join(backend, 'generated', 'api.mjs');
  const materializedApiBytes = readFileSync(materializedApiPath);
  writeFileSync(materializedApiPath, 'export default { stale: true };\n');
  assert.throws(
    () => reviewPlugin.configResolved({ root: project, server: {} }),
    (error) => error.code === 'SNAPBACK_CODEGEN_MATERIALIZATION_INVALID',
  );
  writeFileSync(materializedApiPath, materializedApiBytes);

  const database = join(project, '.snapback', 'dev.sqlite3');
  const readyFile = join(project, '.snapback', 'dev.ready.json');
  const events = [];

  // --- Managed end-to-end through a real Vite dev server ---------------------

  const { createServer } = await import('vite');
  scaffoldWebRoot(appRoot);
  const vitePort = await freePort();
  viteServer = await createServer({
    root: appRoot,
    configFile: false,
    logLevel: 'silent',
    plugins: [
      snapbackDev({
        server: {
          mode: 'managed',
          db: database,
          readyFile,
          runtimeBinary,
          stdio: 'ignore',
        },
        projectRoot: project,
        setup: { backendDirectory: backend },
        onEvent: (event) => events.push(event),
        logJson: false,
      }),
    ],
    server: { host: '127.0.0.1', port: vitePort, strictPort: true },
  });
  await viteServer.listen();
  const origin = `http://127.0.0.1:${vitePort}`;

  const readyEvent = events.find((event) => event.event === 'server-ready');
  assert.ok(readyEvent, 'lifecycle emitted server-ready');
  assert.equal(readyEvent.managed, true);
  const setupEvent = events.find((event) => event.event === 'server-setup');
  assert.ok(setupEvent?.loadedSchema && setupEvent?.loadedFunctions && setupEvent?.reset === true,
    `managed bring-up loaded artifacts and seeded: ${JSON.stringify(setupEvent)}`);
  const descriptor = JSON.parse(readFileSync(readyFile, 'utf8'));
  assert.equal(resolve(descriptor.database.path), database);
  console.log('managed spawn + ready handshake + host-ops bring-up pass');

  // The browser path: a client with zero admin authority, through the relay.
  const client = new SnapbackClient(`${origin}/__snapback`);
  const health = await client.health();
  assert.equal(health.ok, true, 'GET /health forwards through the relay');
  const seeded = await client.query(api.listTodos, { userId: ADA });
  assert.equal(seeded.rows.length, 1, `seed visible through relay: ${JSON.stringify(seeded.rows)}`);
  assert.equal(seeded.rows[0].title, 'Seeded during managed bring-up');

  // Refused surfaces: single-underscore admin/system namespace and the system
  // root routes, both direct and via the rewrite-onto-root path.
  for (const [method, path] of [
    ['POST', '/__snapback/_snapback/api/host-ops'],
    ['GET', '/__snapback/_snapback/api/inspect'],
    ['POST', '/__snapback/_snapback/api/app/reset'],
    ['POST', '/__snapback/admin/reset'],
    ['POST', '/__snapback/app/ensure'],
    ['POST', '/__snapback/ephemeral/cleanup'],
    ['POST', '/__snapback/ephemeral/collections'],
    ['POST', '/__snapback/connections/conn_1/disconnect'],
    ['POST', '/__snapback/query/../_snapback/api/host-ops'],
  ]) {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'GET' ? undefined : '{}',
    });
    assert.equal(response.status, 403, `${method} ${path} refused`);
    const body = await response.json();
    assert.equal(body.diagnostic?.code, 'SNAPBACK_DEV_PROXY_ROUTE_REFUSED', `${method} ${path} structured refusal`);
  }

  // Forwarded app-data ephemeral routes (LLP 0031 D1/D4): the register-shaped
  // system sibling is refused above, while ensure and delete reach the server.
  const ensureResponse = await fetch(`${origin}/__snapback/ephemeral/collections/ensure`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ collections: [] }),
  });
  assert.equal(ensureResponse.status, 200, 'POST /ephemeral/collections/ensure forwards');
  const deleteResponse = await fetch(`${origin}/__snapback/ephemeral/delete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  const deleteBody = await deleteResponse.json().catch(() => ({}));
  assert.notEqual(deleteResponse.status, 403, 'POST /ephemeral/delete is not refused by the relay');
  assert.notEqual(deleteBody?.diagnostic?.code, 'SNAPBACK_DEV_PROXY_ROUTE_REFUSED');
  console.log('proxy allowlist: refusals structured, app-data ephemeral routes forward');

  // Live WebSocket through the relay: open the durable stream, subscribe, and
  // observe a push triggered by a mutation that also rode the relay.
  const stream = client.openLiveStream('vite_ws');
  await stream.ready;
  await client.subscribeLive(api.listTodos, { connectionId: 'vite_ws', userId: ADA });
  await client.mutate(api.createTodo, { args: { title: 'Pushed over the proxied socket' }, userId: ADA });
  const update = await eventually(async () => {
    const next = await stream.nextUpdate();
    return next.kind === 'live_replace' ? next : false;
  }, { label: 'live_replace over the proxied WebSocket' });
  assert.equal(update.kind, 'live_replace');
  stream.close();
  const afterMutation = await client.query(api.listTodos, { userId: ADA });
  assert.equal(afterMutation.rows.length, 2);
  console.log('WebSocket live stream relays through /__snapback');

  // Virtual module: sanitized dev state, no token material, no backend origin.
  const virtualModule = await viteServer.ssrLoadModule('virtual:snapback/dev');
  assert.equal(virtualModule.snapbackBasePath, '/__snapback');
  assert.equal(virtualModule.snapbackDevState.mode, 'managed');
  assert.equal(virtualModule.snapbackDevState.ready, true);
  const generatedApp = (await import(join(backend, 'generated', 'app.mjs'))).app;
  const appBinding = virtualModule.createSnapbackDevAppBinding(generatedApp);
  assert.equal(appBinding.target.origin, '/__snapback');
  assert.equal(appBinding.descriptorIdentity, generatedApp.identity.descriptor);
  assert.deepEqual(appBinding.capabilities.offered, generatedApp.capabilities.required);
  const adminTokenValue = readFileSync(`${database}.admin-token`, 'utf8').trim();
  const virtualSource = renderVirtualModule({ base: '/__snapback', state: virtualModule.snapbackDevState });
  assert.ok(adminTokenValue.length > 0);
  assert.ok(!virtualSource.includes(adminTokenValue), 'no admin token in virtual module');
  assert.ok(!virtualSource.includes('admin-token'), 'no token file path in virtual module');
  assert.ok(!virtualSource.includes('devIdentityCapability'), 'no dev-identity fields in virtual module');
  assert.ok(!virtualSource.includes('dev-identity'), 'no dev-identity file path in virtual module');
  assert.ok(!JSON.stringify(virtualModule.snapbackDevState).includes(descriptor.serverUrl), 'no backend origin in dev state');
  console.log('virtual:snapback/dev is sanitized');

  // --- Attach-mode refusals against the live managed server ------------------

  const mismatch = createSnapbackViteLifecycle({
    mode: 'attach',
    projectRoot: project,
    database: join(project, '.snapback', 'other.sqlite3'),
    readyFile,
    logJson: false,
  });
  await assert.rejects(() => mismatch.start(), (error) => error.code === 'SNAPBACK_DEV_SERVER_TARGET_MISMATCH');

  const destructiveAttach = createSnapbackViteLifecycle({
    mode: 'attach',
    projectRoot: project,
    database,
    readyFile,
    setup: { backendDirectory: backend, reset: 'always' },
    logJson: false,
  });
  await assert.rejects(() => destructiveAttach.start(), (error) => error.code === 'SNAPBACK_DEV_SETUP_REFUSED');

  const missingReady = createSnapbackViteLifecycle({
    mode: 'attach',
    projectRoot: project,
    database,
    readyFile: join(project, '.snapback', 'nowhere.ready.json'),
    logJson: false,
  });
  await assert.rejects(() => missingReady.start(), (error) => error.code === 'SNAPBACK_DEV_READY_FILE_REQUIRED');

  const externalEvents = [];
  const external = createSnapbackViteLifecycle({
    mode: 'external',
    projectRoot: project,
    url: descriptor.serverUrl,
    setup: { backendDirectory: backend },
    onEvent: (event) => externalEvents.push(event),
    logJson: false,
  });
  const externalState = await external.start();
  assert.equal(externalState.ready, true);
  assert.ok(
    externalEvents.some((event) => event.code === 'SNAPBACK_DEV_SETUP_REFUSED'),
    'external mode refuses configured setup with a structured diagnostic',
  );
  await external.close();
  console.log('attach/external validation: mismatch, destructive opt-in, and ready-file fencing refuse correctly');

  // --- Attach-shaped auto from a second Vite server ---------------------------

  const secondEvents = [];
  const secondPort = await freePort();
  secondViteServer = await createServer({
    root: appRoot,
    configFile: false,
    logLevel: 'silent',
    plugins: [
      snapbackDev({
        server: { mode: 'auto', db: database, readyFile, runtimeBinary, stdio: 'ignore' },
        projectRoot: project,
        setup: { backendDirectory: backend },
        onEvent: (event) => secondEvents.push(event),
        logJson: false,
      }),
    ],
    server: { host: '127.0.0.1', port: secondPort, strictPort: true },
  });
  await secondViteServer.listen();
  const secondReady = secondEvents.find((event) => event.event === 'server-ready');
  assert.equal(secondReady.shape, 'attach', 'auto attaches when a valid ready file exists');
  assert.equal(secondReady.managed, false);
  assert.ok(
    secondEvents.some((event) => event.code === 'SNAPBACK_DEV_SETUP_REFUSED'),
    'attach-shaped auto refuses destructive setup without opt-in',
  );
  const throughSecond = new SnapbackClient(`http://127.0.0.1:${secondPort}/__snapback`);
  const rowsViaSecond = await throughSecond.query(api.listTodos, { userId: ADA });
  assert.equal(rowsViaSecond.rows.length, 2, 'attach did not reset the shared database');
  await secondViteServer.close();
  secondViteServer = null;
  const stillAlive = await fetch(`${descriptor.serverUrl}/health`);
  assert.equal(stillAlive.status, 200, 'closing an attached Vite session never stops the backend');
  console.log('auto attach: non-destructive, and teardown spares the attached server');

  // --- Teardown of the managed child -----------------------------------------

  await viteServer.close();
  viteServer = null;
  await eventually(async () => {
    try {
      await fetch(`${descriptor.serverUrl}/health`);
      return false;
    } catch {
      return true;
    }
  }, { label: 'managed backend teardown' });
  await eventually(() => !existsSync(readyFile), { label: 'ready-file cleanup' });
  console.log('closing Vite tears down only the plugin-spawned managed child');

  console.log('package.test.mjs: allowlist, managed lifecycle, proxy + WS relay, attach fencing, and sanitization pass');
} finally {
  try {
    await secondViteServer?.close();
  } catch {
    // best-effort cleanup
  }
  try {
    await viteServer?.close();
  } catch {
    // best-effort cleanup
  }
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

function scaffoldWebRoot(appRoot) {
  mkdirSync(appRoot, { recursive: true });
  writeFileSync(join(appRoot, 'index.html'), '<!doctype html><title>snapback-vite test app</title>\n');
}
