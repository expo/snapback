// @ref LLP 0223#dated-amendment--2026-08-21-d01-ruling--the-canonical-development-lifecycle — packed Expo-provider, real-Vite, and headless consumers share the receipt-bound dev lifecycle and prove additive sessions continuity without their own carrier or binding environment. Exact-runtime evidence remains LLP 0295 W7.

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
import { createServer as createNetServer } from 'node:net';
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
    for (const dependency of Object.keys({
      ...(source.manifest.dependencies ?? {}),
      ...(source.manifest.optionalDependencies ?? {}),
    })) {
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
    '@expo/snapback-expo',
    '@expo/snapback-vite',
  ]);
  const specifiers = {};
  const tarballs = {};
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
    tarballs[name] = artifact;
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
      '@expo/snapback-expo': specifiers['@expo/snapback-expo'],
      '@expo/snapback-vite': specifiers['@expo/snapback-vite'],
      'fake-indexeddb': '^6.2.5',
      'vite': '^8.0.0',
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
  return Object.freeze(tarballs);
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
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';

const port = Number(process.env.SNAPBACK_EXPO_METRO_PORT);
const supervisorDescriptor = process.env.SNAPBACK_PACKED_SUPERVISOR_DESCRIPTOR;
const server = createServer((_request, response) => {
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({ ok: true }));
});
server.listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ event: 'metro-ready', host: '127.0.0.1', port }));
});
let closing = false;
let observedSupervisorDescriptor = false;
const close = () => {
  if (closing) return;
  closing = true;
  clearInterval(supervisorWatch);
  server.close(() => process.exit(0));
};
const supervisorWatch = setInterval(() => {
  if (existsSync(supervisorDescriptor)) observedSupervisorDescriptor = true;
  else if (observedSupervisorDescriptor) close();
}, 50);
supervisorWatch.unref();
process.once('SIGINT', close);
process.once('SIGTERM', close);
`);
}

async function freeLoopbackPort() {
  const server = createNetServer();
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

function scaffoldLane(scaffoldApp, name, template = 'react') {
  const projectRoot = join(externalRoot, name);
  const scaffolded = scaffoldApp(projectRoot, { template });
  assert.equal(scaffolded.ok, true);
  assert.deepEqual(
    scaffolded.lifecycle.stages,
    ['scaffold', 'install', 'generate', 'dev', 'prove'],
    `${template} must bind W1's runtime lifecycle to VCF-E-L1's scaffolded command path`,
  );
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

function installScaffoldLane(lane, packedTarballs) {
  const manifestPath = join(lane.projectRoot, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const requiredPackages = new Set();
  const overrides = Object.fromEntries(
    Object.entries(packedTarballs).map(([name, tarball]) => [name, `file:${tarball}`]),
  );
  for (const section of ['dependencies', 'devDependencies']) {
    for (const name of Object.keys(manifest[section] ?? {})) {
      const tarball = packedTarballs[name];
      if (tarball === undefined) continue;
      const specifier = `file:${tarball}`;
      manifest[section][name] = specifier;
      requiredPackages.add(name);
    }
  }
  manifest.overrides = { ...(manifest.overrides ?? {}), ...overrides };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  run('bun', ['install'], { cwd: lane.projectRoot });
  for (const name of requiredPackages) {
    const installed = join(lane.projectRoot, 'node_modules', ...name.split('/'));
    assert.ok(existsSync(installed), `${lane.name} install materializes ${name}`);
    assert.equal(lstatSync(installed).isSymbolicLink(), false, `${name} must not be a workspace link`);
  }
}

function writeAdditiveSchema(lane) {
  const predecessor = readFileSync(lane.schemaPath, 'utf8');
  const anchor = predecessor.includes('    todos: defineTable({')
    ? '    todos: defineTable({'
    : '    users: defineTable({';
  const successor = predecessor.replace(
    anchor,
    `    lifecycleLabels: defineTable({
      name: v.string(),
    }).visibility({ kind: 'public-read' }).sync(),
${anchor}`,
  );
  assert.notEqual(successor, predecessor, `${lane.name} must add one compatible table`);
  writeFileSync(lane.schemaPath, successor);
}

function deploymentEvent(events, requestId) {
  const candidates = [];
  for (const event of events) {
    const candidate = event?.backend ?? event;
    if (candidate?.state === 'startup-successor-activated' && candidate.requestId === requestId) {
      return candidate;
    }
    if (candidate?.state === 'startup-successor-activated') candidates.push(candidate);
  }
  return candidates.length === 1 ? candidates[0] : null;
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
  expectedBindingOrigin = null,
}) {
  const applicationReadyFile = `${lane.readyFile}.application-ready`;
  const m1Receipt = readApplicationReadyReceipt(applicationReadyFile);
  const m1Generated = await importGeneratedApp(lane, 'm1');
  const m1Binding = binding(m1Generated.app);
  assert.equal(m1Receipt.formatVersion, 'snapback.application-ready.v1');
  assert.deepEqual([...m1Receipt.clientOrigins].sort(), [...expectedClientOrigins].sort());
  assert.equal(m1Receipt.binding.descriptorIdentity, m1Binding.descriptorIdentity);
  if (expectedBindingOrigin !== null) assert.equal(m1Binding.target.origin, expectedBindingOrigin);
  assert.equal(m1Receipt.runtimeIdentity.wrapper.package, '@expo/snapback-cli');
  assert.equal(m1Receipt.runtimeIdentity.qualifiedBinary.path, qualifiedRuntimeBinary);

  const platform = Object.freeze({
    kind: 'browser',
    indexedDB: new IDBFactory(),
    cryptoObject: webcrypto,
    databaseName: `snapback-packed-lifecycle-${lane.name}`,
  });
  let appClient = await createSnapbackAppClient({
    app: m1Generated.app,
    binding: m1Binding,
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
  const m2Receipt = readApplicationReadyReceipt(applicationReadyFile);
  assert.deepEqual(m2Receipt.application.deployment, advance.toDeployment);
  assert.deepEqual(m1Receipt.application.deployment, advance.fromDeployment);
  assert.notEqual(m2Receipt.binding.descriptorIdentity, m1Receipt.binding.descriptorIdentity);
  const m2Generated = await importGeneratedApp(lane, 'm2');
  await refreshBinding(m2Generated.app);
  const m2Binding = binding(m2Generated.app);
  assert.equal(m2Binding.descriptorIdentity, m2Generated.app.identity.descriptor);
  assert.equal(m2Binding.descriptorIdentity, m2Receipt.binding.descriptorIdentity);
  assert.notEqual(m2Binding.descriptorIdentity, m1Binding.descriptorIdentity);
  if (expectedBindingOrigin !== null) assert.equal(m2Binding.target.origin, expectedBindingOrigin);
  appClient = await createSnapbackAppClient({
    app: m2Generated.app,
    binding: m2Binding,
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
  const packedTarballs = materializePackedPackages();
  materializeQualifiedRuntime();
  writeMetroFixture();

  const installedCli = join(externalRoot, 'node_modules', '@expo', 'snapback-cli');
  const installedClient = join(externalRoot, 'node_modules', '@expo', 'snapback-client');
  const installedExpo = join(externalRoot, 'node_modules', '@expo', 'snapback-expo');
  const installedVite = join(externalRoot, 'node_modules', '@expo', 'snapback-vite');
  const cli = await import(pathToFileURL(join(installedCli, 'index.mjs')).href);
  const expoDev = await import(pathToFileURL(join(installedCli, 'expo-dev.mjs')).href);
  const client = await import(pathToFileURL(join(installedClient, 'index.mjs')).href);
  const expo = await import(pathToFileURL(join(installedExpo, 'index.mjs')).href);
  const vite = await import(pathToFileURL(join(installedVite, 'index.mjs')).href);
  const consumerRequire = createRequire(join(externalRoot, 'package.json'));
  const installedViteEntry = consumerRequire.resolve('vite');
  const { createServer: createViteServer } = await import(pathToFileURL(
    installedViteEntry,
  ).href);
  const { IDBFactory } = await import(pathToFileURL(
    consumerRequire.resolve('fake-indexeddb'),
  ).href);

  // VCF-E-L1 negative: corrupt the materialized packed template, not the
  // source workspace, and prove the shipped scaffold entrypoint refuses
  // before creating output with the missing stage named.
  const packedReactManifestPath = join(installedCli, 'templates', 'react', 'package.json');
  const packedReactManifestBytes = readFileSync(packedReactManifestPath, 'utf8');
  const packedReactManifest = JSON.parse(packedReactManifestBytes);
  delete packedReactManifest.scripts.prove;
  const missingLifecycleTarget = join(externalRoot, 'missing-lifecycle-stage');
  try {
    writeFileSync(
      packedReactManifestPath,
      `${JSON.stringify(packedReactManifest, null, 2)}\n`,
    );
    assert.throws(
      () => cli.scaffoldApp(missingLifecycleTarget, { template: 'react' }),
      (error) => error?.code === 'SNAPBACK_SCAFFOLD_LIFECYCLE_STAGE_MISSING'
        && error?.diagnostic?.details?.stage === 'prove',
    );
    assert.equal(existsSync(missingLifecycleTarget), false);
  } finally {
    writeFileSync(packedReactManifestPath, packedReactManifestBytes);
  }

  // Headless: a second packed CLI instance attaches to the receipt-bound owner,
  // advances the schema, and closes without terminating the owner.
  {
    const lane = scaffoldLane(cli.scaffoldApp, 'react');
    installScaffoldLane(lane, packedTarballs);
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
    const projectReadiness = cli.packagedRuntimeReadiness({
      runtimeBinary: qualifiedRuntimeBinary,
      projectRoot: lane.projectRoot,
    });
    assert.equal(projectReadiness.ok, true, JSON.stringify(projectReadiness.diagnostic));
    const prove = run('npm', ['run', 'prove'], {
      cwd: lane.projectRoot,
      timeout: 180_000,
      env: { SNAPBACK_RUNTIME_BINARY: qualifiedRuntimeBinary },
    });
    const proveReceipt = JSON.parse(readFileSync(
      join(lane.projectRoot, '.snapback', 'verify-receipt.json'),
      'utf8',
    ));
    assert.equal(proveReceipt.ok, true, prove.stdout);
  }

  // Vite: a real Vite server loads the packed plugin. Its configure cut
  // consumes the application receipt through the shared CLI attach path; no
  // direct lifecycle controller, fake host descriptor, or custom relay stands
  // in for the shipped arm.
  {
    const lane = scaffoldLane(cli.scaffoldApp, 'vite-exact');
    const viteEvents = [];
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
      watch: false,
      serverStdio: ['ignore', 'ignore', 'ignore'],
    });

    const startViteConsumer = async (mode) => {
      const server = await createViteServer({
        root: lane.projectRoot,
        configFile: false,
        logLevel: 'silent',
        plugins: [vite.snapbackDev({
          server: {
            mode,
            db: lane.database,
            readyFile: lane.readyFile,
            runtimeBinary,
            qualifiedRuntimeBinary,
            stdio: 'ignore',
          },
          projectRoot: lane.projectRoot,
          setup: { backendDirectory: lane.backendRoot, reset: 'never' },
          onEvent: (event) => viteEvents.push(event),
          logJson: false,
        })],
        server: { host: '127.0.0.1', port: clientPort, strictPort: true },
      });
      await server.listen();
      return server;
    };

    // Same host, same browser origin, stale capability identity: the actual
    // packed Vite attach refuses before changing the owner receipt or child.
    const applicationReadyFile = `${lane.readyFile}.application-ready`;
    const correctReceiptBytes = readFileSync(applicationReadyFile, 'utf8');
    const staleReceipt = JSON.parse(correctReceiptBytes);
    staleReceipt.capabilityManifestDigest = `sha256:${'0'.repeat(64)}`;
    writeFileSync(applicationReadyFile, `${JSON.stringify(staleReceipt, null, 2)}\n`, { mode: 0o600 });
    const staleViteWitness = join(lane.stateRoot, 'stale-vite-witness.mjs');
    writeFileSync(staleViteWitness, `
import { createServer } from ${JSON.stringify(pathToFileURL(installedViteEntry).href)};
import { snapbackDev } from ${JSON.stringify(pathToFileURL(join(installedVite, 'index.mjs')).href)};
try {
  await createServer({
    root: ${JSON.stringify(lane.projectRoot)},
    configFile: false,
    logLevel: 'silent',
    plugins: [snapbackDev({
      server: {
        mode: 'attach',
        db: ${JSON.stringify(lane.database)},
        readyFile: ${JSON.stringify(lane.readyFile)},
        runtimeBinary: ${JSON.stringify(runtimeBinary)},
        qualifiedRuntimeBinary: ${JSON.stringify(qualifiedRuntimeBinary)},
        stdio: 'ignore',
      },
      projectRoot: ${JSON.stringify(lane.projectRoot)},
      setup: { backendDirectory: ${JSON.stringify(lane.backendRoot)}, reset: 'never' },
      logJson: false,
    })],
    server: { host: '127.0.0.1', port: ${clientPort}, strictPort: true },
  });
  process.exitCode = 2;
} catch (error) {
  if (error?.code !== 'SNAPBACK_DEV_APPLICATION_READY_STALE') throw error;
  process.stdout.write(error.code + '\\n');
  process.exitCode = 0;
}
process.exit();
`);
    assert.equal(
      run(process.execPath, [staleViteWitness], { cwd: lane.projectRoot }).stdout.trim(),
      'SNAPBACK_DEV_APPLICATION_READY_STALE',
    );
    assert.equal(readFileSync(applicationReadyFile, 'utf8').includes(`sha256:${'0'.repeat(64)}`), true);
    await assertOwnerStillRunning(activeOwner, 'stale Vite attach');
    writeFileSync(applicationReadyFile, correctReceiptBytes, { mode: 0o600 });
    await closeOwner(activeOwner, 'stale Vite attach owner');
    activeOwner = null;

    activeConsumer = await startViteConsumer('managed');
    const originalViteServer = activeConsumer;
    let virtual = await activeConsumer.ssrLoadModule('virtual:snapback/dev');
    const m1App = await importGeneratedApp(lane, 'vite-real-m1');
    assert.equal(virtual.snapbackDevState.ready, true);
    assert.equal(
      virtual.createSnapbackDevAppBinding(m1App.app).descriptorIdentity,
      m1App.app.identity.descriptor,
    );
    assert.equal((await fetch(`${clientOrigin}/__snapback/health`)).status, 200);
    const originalFetch = globalThis.fetch;
    const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: new URL(`${clientOrigin}/`),
    });
    globalThis.fetch = (input, init) => {
      const resolved = typeof input === 'string' && input.startsWith('/')
        ? new URL(input, clientOrigin).href
        : input;
      return originalFetch(resolved, init);
    };
    try {
      await proveM1ToM2({
        lane,
        IDBFactory,
        createSnapbackAppClient: client.createSnapbackAppClient,
        readApplicationReadyReceipt: cli.readApplicationReadyReceipt,
        binding: (app) => virtual.createSnapbackDevAppBinding(app),
        refreshBinding: async (m2App) => {
          assert.equal(activeConsumer, originalViteServer, 'M2 keeps the same Vite server alive');
          virtual = await eventually(async () => {
            const projected = await activeConsumer.ssrLoadModule('virtual:snapback/dev');
            try {
              projected.createSnapbackDevAppBinding(m2App);
              return projected;
            } catch {
              return false;
            }
          }, { label: 'Vite virtual module M2 binding projection' });
        },
        reload: async () => {
          const eventStart = viteEvents.length;
          return eventually(() => viteEvents.slice(eventStart)
            .map((event) => event.backend)
            .find((event) => event?.state === 'generated-and-loaded') ?? false, {
            label: 'managed Vite M2 generated-and-loaded event',
          });
        },
        events: viteEvents,
        expectedClientOrigins: [clientOrigin],
        expectedBindingOrigin: '/__snapback',
      });
    } finally {
      globalThis.fetch = originalFetch;
      if (originalLocation === undefined) delete globalThis.location;
      else Object.defineProperty(globalThis, 'location', originalLocation);
    }
    assert.ok(viteEvents.some((event) => event.event === 'server-ready' && event.shape === 'managed'));
    const managedServerUrl = cli.readReadyDescriptor(lane.readyFile).serverUrl;
    await activeConsumer.close();
    activeConsumer = null;
    await eventually(async () => {
      try {
        await fetch(`${managedServerUrl}/health`);
        return false;
      } catch {
        return true;
      }
    }, { label: 'managed Vite backend shutdown' });
  }

  // Expo: the actual packed Expo provider boots through the supervisor
  // rendezvous. Metro's complete loopback-alias set is declared before the
  // backend cut, and two sequential supervisors prove attach-after-projection
  // remains idempotent without Expo rewriting the application-ready carrier.
  {
    const lane = scaffoldLane(cli.scaffoldApp, 'expo', 'expo-chat');
    const events = [];
    const backendPort = await freeLoopbackPort();
    const metroPort = await freeLoopbackPort();
    const metroClientOrigins = expoDev.expoBackendClientOrigins(metroPort);
    activeOwner = await cli.runDev({
      backendDirectory: lane.backendRoot,
      projectRoot: lane.projectRoot,
      readyFile: lane.readyFile,
      database: lane.database,
      runtimeBinary,
      qualifiedRuntimeBinary,
      port: backendPort,
      externalClientOrigins: metroClientOrigins,
      watch: false,
      serverStdio: ['ignore', 'ignore', 'ignore'],
    });

    const startExpoConsumer = () => expoDev.runExpoDev({
      backendDirectory: lane.backendRoot,
      projectRoot: lane.projectRoot,
      expoDirectory: lane.projectRoot,
      readyFile: lane.readyFile,
      database: lane.database,
      runtimeBinary,
      devOptions: { qualifiedRuntimeBinary },
      attach: true,
      platform: 'web',
      metroPort,
      email: 'expo-supervisor@packed-lifecycle.test',
      metroCommand: { command: process.execPath, args: [metroScript] },
      env: {
        ...process.env,
        SNAPBACK_PACKED_SUPERVISOR_DESCRIPTOR: join(
          dirname(lane.readyFile),
          'expo-supervisor.json',
        ),
      },
      serverStdio: ['ignore', 'ignore', 'ignore'],
      onEvent: (event) => events.push(event),
    });

    activeConsumer = await startExpoConsumer();
    assert.equal(activeConsumer.connectCarrier, 'supervisor-rendezvous');
    assert.equal(activeConsumer.applicationReady.formatVersion, 'snapback.application-ready.v1');
    assert.deepEqual(activeConsumer.applicationReady.clientOrigins, metroClientOrigins);
    assert.notEqual(
      activeConsumer.applicationReady.binding.provenance.supervisorGeneration,
      activeConsumer.binding.provenance.supervisorGeneration,
    );
    const expoReadyDescriptor = cli.readReadyDescriptor(lane.readyFile);
    const expoReadiness = await cli.readOperationalReadiness(
      expoReadyDescriptor,
      cli.managedAdminToken(expoReadyDescriptor, lane.database),
    );
    assert.deepEqual(
      [...activeConsumer.applicationReady.clientOrigins].sort(),
      [...expoReadiness.clientOrigins].sort(),
      'Metro aliases are admitted by the Rust dev-body origin predicate and projected unchanged',
    );

    const firstReceipt = cli.readApplicationReadyReceipt(`${lane.readyFile}.application-ready`);
    const firstProjectionBytes = readFileSync(`${lane.readyFile}.application-ready`, 'utf8');
    await activeConsumer.close();
    activeConsumer = null;
    assert.equal(
      readFileSync(`${lane.readyFile}.application-ready`, 'utf8'),
      firstProjectionBytes,
      'closing the Expo projection must not rewrite/remove the CLI-owned receipt',
    );
    await assertOwnerStillRunning(activeOwner, 'first Expo attach');
    activeConsumer = await startExpoConsumer();
    const secondReceipt = cli.readApplicationReadyReceipt(`${lane.readyFile}.application-ready`);
    assert.equal(secondReceipt.startupNonce, firstReceipt.startupNonce);
    assert.deepEqual(secondReceipt.application, firstReceipt.application);
    assert.deepEqual(secondReceipt.clientOrigins, metroClientOrigins);

    const indexedDB = new IDBFactory();
    const lockManager = Object.freeze({
      request: (_name, _options, operation) => operation(),
    });
    const expoPlatform = Object.freeze({
      kind: 'expo-web',
      indexedDB,
      lockManager,
      cryptoObject: webcrypto,
      databaseName: 'snapback-packed-lifecycle-expo',
    });
    const appState = () => {
      const listeners = new Set();
      return {
        currentState: 'active',
        addEventListener(_event, listener) {
          listeners.add(listener);
          return { remove: () => listeners.delete(listener) };
        },
      };
    };
    const bootEnvironment = () => Object.freeze({
      ...expo.createSupervisedExpoEnvironment({
        exchangeOrigin: activeConsumer.exchangeOrigin,
        appState: appState(),
        clientOptions: {
          rqsStore: null,
          offlineQueue: false,
          clientStoreId: 'packed-expo-provider',
        },
      }),
      resolveAppClientPlatform: () => expoPlatform,
    });

    const m1Generated = await importGeneratedApp(lane, 'expo-provider-m1');
    let boot = expo.createSnapbackExpoBoot({
      app: m1Generated.app,
      environment: bootEnvironment(),
    });
    let bootState = await boot.start();
    assert.equal(bootState.status, 'ready', JSON.stringify(bootState));
    assert.ok(boot.reactProvider(), 'packed Expo arm must construct the canonical React provider');
    let appClient = boot.appClient();
    assert.ok(appClient, 'packed Expo arm must construct the application client');
    const principal = appClient.auth.currentPrincipal();
    assert.equal(principal.status, 'authenticated');
    const originalSession = await appClient.client.authSession();
    const conversations = (await appClient.client.query(m1Generated.conversations)).rows;
    const users = (await appClient.client.query(m1Generated.users)).rows;
    assert.ok(conversations.length > 0 && users.length > 0);
    const conversationId = conversations[0]._id;
    const senderId = users[0]._id;
    const text = 'Packed Expo provider survives M1 to M2';
    await appClient.client.mutate(m1Generated.sendText, {
      args: { conversationId, senderId, text },
      queue: false,
    });
    assert.ok(
      (await appClient.client.query(m1Generated.messagesForConversation, {
        args: { conversationId },
      }))
        .rows.some((row) => row.text === text),
    );
    await boot.dispose();
    boot = null;
    appClient = null;

    writeAdditiveSchema(lane);
    const requestId = 'expo-m2-additive';
    const reloaded = await activeConsumer.verbs.reload({ requestId });
    assert.equal(reloaded.state, 'generated-and-loaded', JSON.stringify(reloaded));
    const advance = deploymentEvent(events, requestId);
    assert.ok(advance, 'Expo reports the M1 -> M2 deployment identity advance');
    assert.deepEqual(advance.continuity, {
      database: 'preserved',
      accounts: 'preserved',
      sessions: 'preserved',
      stores: 'preserved',
    });
    const m2Generated = await importGeneratedApp(lane, 'expo-provider-m2');
    assert.equal(activeConsumer.binding.descriptorIdentity, m2Generated.app.identity.descriptor);
    boot = expo.createSnapbackExpoBoot({
      app: m2Generated.app,
      environment: bootEnvironment(),
    });
    bootState = await boot.start();
    assert.equal(bootState.status, 'ready', JSON.stringify(bootState));
    assert.ok(boot.reactProvider());
    appClient = boot.appClient();
    const survivingPrincipal = appClient.auth.currentPrincipal();
    assert.equal(survivingPrincipal.userId, principal.userId);
    const survivingSession = await appClient.client.authSession();
    assert.equal(survivingSession.authority.sessionId, originalSession.authority.sessionId);
    assert.ok(
      (await appClient.client.query(m2Generated.messagesForConversation, {
        args: { conversationId },
      }))
        .rows.some((row) => row.text === text),
      'packed Expo provider preserves its product row through M2',
    );
    await boot.dispose();
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
    'packed-dev-lifecycle.test.mjs: VCF-E-L1 scaffold -> install -> generate -> dev -> prove plus packed headless, real Vite, and Expo provider M1 -> M2 continuity passes',
  );
} finally {
  await activeConsumer?.close?.().catch(() => {});
  await activeOwner?.close?.().catch(() => {});
  rmSync(scratchRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
