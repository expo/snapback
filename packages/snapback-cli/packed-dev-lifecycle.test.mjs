// @ref LLP 0223#dated-amendment--2026-08-21-d01-ruling--the-canonical-development-lifecycle — packed Expo, Vite/Exact, and headless consumers share the receipt-bound dev lifecycle and prove additive sessions continuity without their own carrier or binding environment.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageRoot, '..', '..');
const packagesRoot = join(repoRoot, 'packages');
const runtimeBinary = process.env.SNAPBACK_RUNTIME_BINARY
  ?? join(repoRoot, 'target', 'debug', 'snapback');
const runtimeReadiness = `${runtimeBinary}.runtime-readiness.json`;

assert.ok(
  existsSync(runtimeBinary) && existsSync(runtimeReadiness),
  'packed lifecycle proof requires the bootstrap-qualified native runtime',
);

const scratchRoot = realpathSync(mkdtempSync(join(tmpdir(), 'snapback-packed-dev-lifecycle-')));
const externalRoot = join(scratchRoot, 'external-consumer');
const artifactRoot = join(externalRoot, '.snapback', 'packed-packages');
const externalRuntimeRoot = join(scratchRoot, 'qualified-runtime');
const qualifiedRuntimeBinary = join(externalRuntimeRoot, 'bin', 'snapback');
const metroScript = join(externalRoot, 'packed-metro.mjs');
const packageManager = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).packageManager;
const expectedBun = /^bun@(.+)$/u.exec(packageManager)?.[1];
assert.ok(expectedBun, 'repository packageManager must pin Bun');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? externalRoot,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env ?? {}) },
    timeout: options.timeout ?? 600_000,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed:\n${result.stderr || result.stdout || result.error?.message}`,
  );
  return result;
}

function packageInventory() {
  const inventory = new Map();
  for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const root = join(packagesRoot, entry.name);
    const manifestPath = join(root, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    inventory.set(manifest.name, { manifest, root: realpathSync(root) });
  }
  return inventory;
}

function packedDependencyClosure(rootNames) {
  const inventory = packageInventory();
  const closure = new Map();
  const pending = [...rootNames];
  while (pending.length > 0) {
    const name = pending.shift();
    if (closure.has(name)) continue;
    const source = inventory.get(name);
    assert.ok(source, `local packed closure is missing ${name}`);
    closure.set(name, source);
    for (const dependency of Object.keys(source.manifest.dependencies ?? {})) {
      if (dependency.startsWith('@expo/snapback-')) pending.push(dependency);
    }
  }
  return closure;
}

function localSpecifier(from, path) {
  let value = relative(from, path).split(sep).join('/');
  if (!value.startsWith('.')) value = `./${value}`;
  return `file:${value}`;
}

function materializePackedPackages() {
  assert.equal(run('bun', ['--version']).stdout.trim(), expectedBun);
  mkdirSync(artifactRoot, { recursive: true });
  const closure = packedDependencyClosure([
    '@expo/snapback-cli',
    '@expo/snapback-client',
    '@expo/snapback-vite',
  ]);
  const specifiers = {};
  for (const [name, source] of [...closure].sort(([left], [right]) => left.localeCompare(right))) {
    if (name === '@expo/snapback-codegen') {
      run(process.execPath, ['prepare-runtime-artifacts.mjs'], { cwd: source.root });
    }
    const filename = `${name.slice('@expo/snapback-'.length)}.tgz`;
    const artifact = join(artifactRoot, filename);
    run('bun', [
      'pm',
      'pack',
      '--ignore-scripts',
      '--filename', artifact,
      '--quiet',
    ], { cwd: source.root });
    assert.ok(existsSync(artifact), `${name} produced a package tarball`);
    specifiers[name] = localSpecifier(externalRoot, artifact);
  }

  writeFileSync(join(externalRoot, 'package.json'), `${JSON.stringify({
    name: 'snapback-packed-dev-lifecycle-consumer',
    version: '1.0.0',
    private: true,
    type: 'module',
    packageManager,
    dependencies: {
      '@expo/snapback-cli': specifiers['@expo/snapback-cli'],
      '@expo/snapback-client': specifiers['@expo/snapback-client'],
      '@expo/snapback-vite': specifiers['@expo/snapback-vite'],
      'fake-indexeddb': '^6.2.5',
    },
    overrides: specifiers,
  }, null, 2)}\n`);
  run('bun', ['install']);

  for (const name of closure.keys()) {
    const installed = join(externalRoot, 'node_modules', ...name.split('/'));
    if (!existsSync(installed)) continue;
    assert.equal(lstatSync(installed).isSymbolicLink(), false, `${name} is materialized`);
    assert.ok(
      !realpathSync(installed).startsWith(packagesRoot),
      `${name} must not resolve into the source workspace`,
    );
  }
}

function materializeQualifiedRuntime() {
  const receipt = JSON.parse(readFileSync(runtimeReadiness, 'utf8'));
  mkdirSync(dirname(qualifiedRuntimeBinary), { recursive: true });
  symlinkSync(runtimeBinary, qualifiedRuntimeBinary);
  copyFileSync(runtimeReadiness, `${qualifiedRuntimeBinary}.runtime-readiness.json`);
  for (const artifact of receipt.artifacts) {
    const target = join(externalRuntimeRoot, artifact.path);
    mkdirSync(dirname(target), { recursive: true });
    symlinkSync(join(repoRoot, artifact.path), target);
  }
}

function writeMetroFixture() {
  writeFileSync(metroScript, `
import { createServer } from 'node:http';

const port = Number(process.env.SNAPBACK_EXPO_METRO_PORT);
const server = createServer((_request, response) => {
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({ ok: true }));
});
server.listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ event: 'metro-ready', host: '127.0.0.1', port }));
});
const close = () => server.close(() => process.exit(0));
process.once('SIGINT', close);
process.once('SIGTERM', close);
`);
}

async function freeLoopbackPort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
  return address.port;
}

async function eventually(check, { timeoutMs = 15_000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
}

function scaffoldLane(scaffoldApp, name) {
  const projectRoot = join(externalRoot, name);
  assert.equal(scaffoldApp(projectRoot, { template: 'react' }).ok, true);
  const backendRoot = join(projectRoot, 'snapback');
  return {
    name,
    projectRoot,
    backendRoot,
    schemaPath: join(backendRoot, 'schema.mjs'),
    generatedApiPath: join(backendRoot, 'generated', 'api.mjs'),
    stateRoot: join(projectRoot, '.snapback'),
    readyFile: join(projectRoot, '.snapback', 'dev.ready.json'),
    database: join(projectRoot, '.snapback', 'dev.sqlite3'),
  };
}

function writeAdditiveSchema(lane) {
  const predecessor = readFileSync(lane.schemaPath, 'utf8');
  const successor = predecessor.replace(
    '    todos: defineTable({',
    `    lifecycleLabels: defineTable({
      name: v.string(),
    }).visibility({ kind: 'public-read' }).sync(),
    todos: defineTable({`,
  );
  assert.notEqual(successor, predecessor, `${lane.name} must add one compatible table`);
  writeFileSync(lane.schemaPath, successor);
}

function deploymentEvent(events, requestId) {
  for (const event of events) {
    const candidate = event?.state === 'backend-event' ? event.backend : event;
    if (candidate?.state === 'startup-successor-activated' && candidate.requestId === requestId) {
      return candidate;
    }
  }
  return null;
}

async function importGeneratedApp(lane, generation) {
  return import(`${pathToFileURL(lane.generatedApiPath).href}?generation=${generation}-${Date.now()}`);
}

async function proveM1ToM2({
  lane,
  IDBFactory,
  createSnapbackAppClient,
  readApplicationReadyReceipt,
  binding,
  refreshBinding = async () => {},
  reload,
  events,
  expectedClientOrigins,
}) {
  const applicationReadyFile = `${lane.readyFile}.application-ready`;
  const m1Receipt = readApplicationReadyReceipt(applicationReadyFile);
  assert.equal(m1Receipt.formatVersion, 'snapback.application-ready.v1');
  assert.deepEqual([...m1Receipt.clientOrigins].sort(), [...expectedClientOrigins].sort());
  assert.equal(m1Receipt.binding.descriptorIdentity, binding().descriptorIdentity);
  assert.equal(m1Receipt.runtimeIdentity.wrapper.package, '@expo/snapback-cli');
  assert.equal(m1Receipt.runtimeIdentity.qualifiedBinary.path, qualifiedRuntimeBinary);

  const platform = Object.freeze({
    kind: 'browser',
    indexedDB: new IDBFactory(),
    cryptoObject: webcrypto,
    databaseName: `snapback-packed-lifecycle-${lane.name}`,
  });
  const m1Generated = await importGeneratedApp(lane, 'm1');
  let appClient = await createSnapbackAppClient({
    app: m1Generated.app,
    binding: binding(),
    platform,
  });
  const email = `${lane.name}@packed-lifecycle.test`;
  const title = `${lane.name} M1 row`;
  await appClient.auth.signUpWithPassword({
    email,
    password: 'PackedLifecyclePassword!2026',
  });
  const originalPrincipal = appClient.auth.currentPrincipal();
  assert.equal(originalPrincipal.status, 'authenticated');
  const originalSession = await appClient.client.authSession();
  assert.equal(originalSession.authority.userId, originalPrincipal.userId);
  assert.equal(typeof originalSession.authority.sessionId, 'string');
  await appClient.client.mutate(m1Generated.default.createTodo, {
    args: { title },
    queue: false,
  });
  assert.ok(
    (await appClient.client.query(m1Generated.default.listTodos)).rows.some(
      (row) => row.title === title,
    ),
    `${lane.name} reaches M1 green before schema evolution`,
  );
  await appClient.dispose();
  appClient = null;

  writeAdditiveSchema(lane);
  const requestId = `${lane.name}-m2-additive`;
  const result = await reload({ requestId });
  assert.equal(result.state, 'generated-and-loaded', JSON.stringify(result));
  const advance = deploymentEvent(events, requestId);
  assert.ok(advance, `${lane.name} reports its M1 -> M2 deployment identity advance`);
  assert.notDeepEqual(advance.fromDeployment, advance.toDeployment);
  assert.notEqual(advance.fromDeployment.schemaHash, advance.toDeployment.schemaHash);
  assert.deepEqual(advance.continuity, {
    database: 'preserved',
    accounts: 'preserved',
    sessions: 'preserved',
    stores: 'preserved',
  });
  await refreshBinding();

  const m2Receipt = readApplicationReadyReceipt(applicationReadyFile);
  assert.deepEqual(m2Receipt.application.deployment, advance.toDeployment);
  assert.deepEqual(m1Receipt.application.deployment, advance.fromDeployment);
  assert.notEqual(m2Receipt.binding.descriptorIdentity, m1Receipt.binding.descriptorIdentity);
  const m2Generated = await importGeneratedApp(lane, 'm2');
  assert.equal(binding().descriptorIdentity, m2Generated.app.identity.descriptor);
  appClient = await createSnapbackAppClient({
    app: m2Generated.app,
    binding: binding(),
    platform,
  });
  try {
    const survivingPrincipal = appClient.auth.currentPrincipal();
    assert.equal(survivingPrincipal.status, 'authenticated');
    assert.equal(survivingPrincipal.userId, originalPrincipal.userId);
    const survivingSession = await appClient.client.authSession();
    assert.equal(survivingSession.authority.sessionId, originalSession.authority.sessionId);
    assert.ok(
      (await appClient.client.query(m2Generated.default.listTodos)).rows.some(
        (row) => row.title === title,
      ),
      `${lane.name} preserves the original product row through M2`,
    );
  } finally {
    await appClient.dispose();
  }
}

async function assertOwnerStillRunning(owner, consumerLabel) {
  const response = await fetch(`${owner.serverUrl}/health`);
  assert.equal(response.ok, true, `${consumerLabel} shutdown must leave the lifecycle owner's backend running`);
}

async function closeOwner(owner, consumerLabel) {
  const origin = owner.serverUrl;
  await owner.close();
  await eventually(async () => {
    try {
      await fetch(`${origin}/health`);
      return false;
    } catch {
      return true;
    }
  }, { label: `${consumerLabel} owned backend shutdown` });
}

let activeOwner = null;
let activeConsumer = null;
try {
  mkdirSync(externalRoot, { recursive: true });
  materializePackedPackages();
  materializeQualifiedRuntime();
  writeMetroFixture();

  const installedCli = join(externalRoot, 'node_modules', '@expo', 'snapback-cli');
  const installedClient = join(externalRoot, 'node_modules', '@expo', 'snapback-client');
  const installedVite = join(externalRoot, 'node_modules', '@expo', 'snapback-vite');
  const cli = await import(pathToFileURL(join(installedCli, 'index.mjs')).href);
  const expoDev = await import(pathToFileURL(join(installedCli, 'expo-dev.mjs')).href);
  const client = await import(pathToFileURL(join(installedClient, 'index.mjs')).href);
  const vite = await import(pathToFileURL(join(installedVite, 'lifecycle.mjs')).href);
  const consumerRequire = createRequire(join(externalRoot, 'package.json'));
  const { IDBFactory } = await import(pathToFileURL(
    consumerRequire.resolve('fake-indexeddb'),
  ).href);

  // Headless: a second packed CLI instance attaches to the receipt-bound owner,
  // advances the schema, and closes without terminating the owner.
  {
    const lane = scaffoldLane(cli.scaffoldApp, 'headless');
    const events = [];
    activeOwner = await cli.runDev({
      backendDirectory: lane.backendRoot,
      projectRoot: lane.projectRoot,
      readyFile: lane.readyFile,
      database: lane.database,
      runtimeBinary,
      qualifiedRuntimeBinary,
      watch: false,
      serverStdio: ['ignore', 'ignore', 'ignore'],
    });
    activeConsumer = await cli.runDev({
      backendDirectory: lane.backendRoot,
      projectRoot: lane.projectRoot,
      readyFile: lane.readyFile,
      database: lane.database,
      runtimeBinary,
      qualifiedRuntimeBinary,
      attach: true,
      watch: true,
      serverStdio: ['ignore', 'ignore', 'ignore'],
      onEvent: (event) => events.push(event),
    });
    await proveM1ToM2({
      lane,
      IDBFactory,
      createSnapbackAppClient: client.createSnapbackAppClient,
      readApplicationReadyReceipt: cli.readApplicationReadyReceipt,
      binding: () => cli.readApplicationReadyReceipt(`${lane.readyFile}.application-ready`).binding,
      reload: activeConsumer.verbs.reload,
      events,
      expectedClientOrigins: [],
    });
    await activeConsumer.close();
    activeConsumer = null;
    await assertOwnerStillRunning(activeOwner, 'headless attach');
    await closeOwner(activeOwner, 'headless');
    activeOwner = null;
  }

  // Vite/Exact: the packed plugin's attach controller consumes the application
  // receipt directly; there is no fake host-only descriptor or custom relay.
  {
    const lane = scaffoldLane(cli.scaffoldApp, 'vite-exact');
    const events = [];
    const backendPort = await freeLoopbackPort();
    const clientPort = await freeLoopbackPort();
    const clientOrigin = `http://127.0.0.1:${clientPort}`;
    activeOwner = await cli.runDev({
      backendDirectory: lane.backendRoot,
      projectRoot: lane.projectRoot,
      readyFile: lane.readyFile,
      database: lane.database,
      runtimeBinary,
      qualifiedRuntimeBinary,
      port: backendPort,
      externalClientOrigin: clientOrigin,
      watch: true,
      serverStdio: ['ignore', 'ignore', 'ignore'],
      onEvent: (event) => events.push(event),
    });
    activeConsumer = vite.createSnapbackViteLifecycle({
      mode: 'attach',
      projectRoot: lane.projectRoot,
      database: lane.database,
      readyFile: lane.readyFile,
      clientOrigin,
      logJson: false,
    });
    await activeConsumer.start();
    await proveM1ToM2({
      lane,
      IDBFactory,
      createSnapbackAppClient: client.createSnapbackAppClient,
      readApplicationReadyReceipt: cli.readApplicationReadyReceipt,
      binding: () => activeConsumer.binding(),
      refreshBinding: () => activeConsumer.refreshTarget(),
      reload: activeOwner.verbs.reload,
      events,
      expectedClientOrigins: [clientOrigin],
    });
    const m2App = await importGeneratedApp(lane, 'vite-binding-refresh');
    assert.equal(activeConsumer.binding().descriptorIdentity, m2App.app.identity.descriptor);
    await activeConsumer.close();
    activeConsumer = null;
    await assertOwnerStillRunning(activeOwner, 'Vite/Exact attach');
    await closeOwner(activeOwner, 'Vite/Exact');
    activeOwner = null;
  }

  // Expo: the packed supervisor attaches to an existing intended child and
  // projects the same authoritative receipt onto its rendezvous carrier.
  {
    const lane = scaffoldLane(cli.scaffoldApp, 'expo');
    const events = [];
    activeOwner = await cli.runDev({
      backendDirectory: lane.backendRoot,
      projectRoot: lane.projectRoot,
      readyFile: lane.readyFile,
      database: lane.database,
      runtimeBinary,
      qualifiedRuntimeBinary,
      watch: false,
      serverStdio: ['ignore', 'ignore', 'ignore'],
    });
    activeConsumer = await expoDev.runExpoDev({
      backendDirectory: lane.backendRoot,
      projectRoot: lane.projectRoot,
      expoDirectory: lane.projectRoot,
      readyFile: lane.readyFile,
      database: lane.database,
      runtimeBinary,
      devOptions: { qualifiedRuntimeBinary },
      attach: true,
      platform: 'web',
      email: 'expo-supervisor@packed-lifecycle.test',
      metroCommand: { command: process.execPath, args: [metroScript] },
      env: process.env,
      serverStdio: ['ignore', 'ignore', 'ignore'],
      onEvent: (event) => events.push(event),
    });
    assert.equal(activeConsumer.connectCarrier, 'supervisor-rendezvous');
    assert.equal(activeConsumer.applicationReady.formatVersion, 'snapback.application-ready.v1');
    await proveM1ToM2({
      lane,
      IDBFactory,
      createSnapbackAppClient: client.createSnapbackAppClient,
      readApplicationReadyReceipt: cli.readApplicationReadyReceipt,
      binding: () => activeConsumer.binding,
      reload: activeConsumer.verbs.reload,
      events,
      expectedClientOrigins: [activeConsumer.metroOrigin],
    });
    assert.equal(
      activeConsumer.inspection().applicationReady.hostReadyDescriptorDigest,
      cli.readApplicationReadyReceipt(`${lane.readyFile}.application-ready`).hostReadyDescriptorDigest,
    );
    await activeConsumer.close();
    activeConsumer = null;
    await assertOwnerStillRunning(activeOwner, 'Expo attach');
    await closeOwner(activeOwner, 'Expo');
    activeOwner = null;
  }

  console.log(
    'packed-dev-lifecycle.test.mjs: packed headless, Vite/Exact, and Expo M1 -> M2 receipt-bound continuity passes',
  );
} finally {
  await activeConsumer?.close?.().catch(() => {});
  await activeOwner?.close?.().catch(() => {});
  rmSync(scratchRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
