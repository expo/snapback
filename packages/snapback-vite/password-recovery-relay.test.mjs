// Packed external-app acceptance for the first-party password/recovery journey.
//
// @ref LLP 0295#1a-published-package-and-compilerruntime-parity — a Vite
//   relay repair closes only when the failure reproduces before the fix and
//   the complete lifecycle passes from packed packages outside the checkout.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageDir, '..', '..');
const runtimeBinary = process.env.SNAPBACK_RUNTIME_BINARY
  ?? join(repoRoot, 'target', 'debug', 'snapback');
const packedVersion = '0.1.99';
const packageDirectories = Object.freeze([
  'snapback-contract',
  'snapback-client',
  'snapback-codegen',
  'snapback-react',
  'snapback-cli',
  'snapback-vite',
]);
const dependencySections = Object.freeze([
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
]);

assert.ok(
  existsSync(runtimeBinary),
  `native snapback binary missing at ${runtimeBinary}; set SNAPBACK_RUNTIME_BINARY`,
);

function run(command, args, { cwd, timeout = 240_000 } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`,
  );
  return result.stdout;
}

function stagePackedClosure(root) {
  const stageRoot = join(root, 'stage');
  const tarballRoot = join(root, 'tarballs');
  mkdirSync(stageRoot, { recursive: true });
  mkdirSync(tarballRoot, { recursive: true });
  const manifests = new Map(packageDirectories.map((directory) => {
    const sourceManifest = JSON.parse(readFileSync(
      join(repoRoot, 'packages', directory, 'package.json'),
      'utf8',
    ));
    return [sourceManifest.name, { directory, sourceManifest }];
  }));
  const tarballs = [];
  for (const directory of packageDirectories) {
    const sourceDir = join(repoRoot, 'packages', directory);
    const sourceManifest = JSON.parse(readFileSync(join(sourceDir, 'package.json'), 'utf8'));
    if (directory === 'snapback-codegen') {
      run('node', ['prepare-runtime-artifacts.mjs'], { cwd: sourceDir });
    }
    const stageDir = join(stageRoot, directory);
    mkdirSync(stageDir, { recursive: true });
    for (const entry of sourceManifest.files) {
      const source = join(sourceDir, entry);
      assert.ok(existsSync(source), `${sourceManifest.name} files entry is missing: ${entry}`);
      cpSync(source, join(stageDir, entry), { recursive: true });
    }
    const manifest = structuredClone(sourceManifest);
    manifest.version = packedVersion;
    delete manifest.scripts;
    for (const section of dependencySections) {
      for (const [dependency, value] of Object.entries(manifest[section] ?? {})) {
        if (
          section === 'optionalDependencies'
          && dependency.startsWith('@expo/snapback-runtime-')
        ) {
          // This focused closure exercises the caller-supplied native binary;
          // runtime tarball sealing belongs to the full cold-install proof.
          delete manifest[section][dependency];
        } else if (manifests.has(dependency)) {
          manifest[section][dependency] = packedVersion;
        } else {
          assert.equal(
            String(value).startsWith('workspace:'),
            false,
            `${sourceManifest.name} leaves external ${section}.${dependency}=${value}`,
          );
        }
      }
    }
    writeFileSync(join(stageDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    const packed = JSON.parse(run(
      'npm',
      ['pack', stageDir, '--pack-destination', tarballRoot, '--json'],
      { cwd: root },
    ));
    assert.equal(packed.length, 1, `${sourceManifest.name} produced one tarball`);
    tarballs.push(join(tarballRoot, packed[0].filename));
  }
  return tarballs;
}

function materializeQualifiedRuntime(root) {
  const readinessPath = `${runtimeBinary}.runtime-readiness.json`;
  const receipt = JSON.parse(readFileSync(readinessPath, 'utf8'));
  const qualifiedRoot = join(root, 'qualified-runtime');
  const binary = join(qualifiedRoot, 'bin', 'snapback');
  mkdirSync(dirname(binary), { recursive: true });
  symlinkSync(runtimeBinary, binary);
  cpSync(readinessPath, `${binary}.runtime-readiness.json`);
  for (const artifact of receipt.artifacts) {
    const source = join(repoRoot, artifact.path);
    const target = join(qualifiedRoot, artifact.path);
    assert.ok(existsSync(source), `qualified runtime artifact is missing: ${artifact.path}`);
    mkdirSync(dirname(target), { recursive: true });
    symlinkSync(source, target);
  }
  return binary;
}

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

const root = realpathSync(mkdtempSync(join(tmpdir(), 'snapback-vite-password-relay-')));
let viteServer = null;
let dev = null;
let appClient = null;
let live = null;
const originalFetch = globalThis.fetch;
const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');

try {
  const externalRoot = join(root, 'external-app');
  mkdirSync(externalRoot, { recursive: true });
  writeFileSync(join(externalRoot, 'package.json'), `${JSON.stringify({
    name: 'snapback-vite-password-relay-external',
    private: true,
    type: 'module',
  }, null, 2)}\n`);
  const tarballs = stagePackedClosure(root);
  const qualifiedRuntimeBinary = materializeQualifiedRuntime(root);
  run('npm', [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    'react@19.1.0',
    'fake-indexeddb@6.2.5',
    'vite@8.0.0',
    ...tarballs,
  ], { cwd: externalRoot });

  const installed = (specifier) => pathToFileURL(join(
    externalRoot,
    'node_modules',
    ...specifier.split('/'),
  )).href;
  const externalRequire = createRequire(join(externalRoot, 'package.json'));
  const [{ scaffoldApp, generateApp, runDev }, { snapbackDev }, { createSnapbackAppClient }, { createServer }, { IDBFactory }] = await Promise.all([
    import(installed('@expo/snapback-cli/index.mjs')),
    import(installed('@expo/snapback-vite/index.mjs')),
    import(installed('@expo/snapback-client/index.mjs')),
    import(installed('vite/dist/node/index.js')),
    import(pathToFileURL(externalRequire.resolve('fake-indexeddb')).href),
  ]);

  const project = join(externalRoot, 'project');
  assert.equal(scaffoldApp(project, { template: 'react' }).ok, true);
  const backend = join(project, 'snapback');
  const generated = await generateApp(backend);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics ?? null));

  const webRoot = join(externalRoot, 'web');
  mkdirSync(webRoot, { recursive: true });
  writeFileSync(
    join(webRoot, 'index.html'),
    '<!doctype html><title>Snapback password relay lifecycle</title>\n',
  );
  const database = join(project, '.snapback', 'dev.sqlite3');
  const readyFile = join(project, '.snapback', 'dev.ready.json');
  const vitePort = await freePort();
  const backendPort = await freePort();
  const origin = `http://127.0.0.1:${vitePort}`;
  dev = await runDev({
    backendDirectory: backend,
    projectRoot: project,
    database,
    readyFile,
    runtimeBinary,
    qualifiedRuntimeBinary,
    port: backendPort,
    externalClientOrigin: origin,
    watch: false,
    serverStdio: ['ignore', 'ignore', 'ignore'],
  });
  assert.equal(dev.ok, true, JSON.stringify(dev.diagnostics ?? null));
  viteServer = await createServer({
    root: webRoot,
    configFile: false,
    logLevel: 'silent',
    plugins: [snapbackDev({
      server: {
        mode: 'attach',
        db: database,
        readyFile,
        runtimeBinary,
        qualifiedRuntimeBinary,
      },
      projectRoot: project,
      setup: { backendDirectory: backend, reset: 'never' },
      logJson: false,
    })],
    server: { host: '127.0.0.1', port: vitePort, strictPort: true },
  });
  await viteServer.listen();
  const page = await originalFetch(`${origin}/`);
  assert.equal(page.status, 200, 'external Vite page origin is serving');

  const admissionProbe = await originalFetch(`${origin}/__snapback/auth/password/signin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'relay-admission-probe@example.com',
      password: 'relay-admission-probe-password-42!',
    }),
  });
  const admissionBody = await admissionProbe.text();
  assert.notEqual(
    admissionProbe.status,
    403,
    `packed page-origin password sign-in was refused by the relay: ${admissionBody}`,
  );
  const cacheControl = admissionProbe.headers.get('cache-control') ?? '';
  assert.ok(
    cacheControl.split(',').map((directive) => directive.trim()).includes('no-store'),
    `credential no-store response policy survives the relay: ${cacheControl}`,
  );

  const virtualModule = await viteServer.ssrLoadModule('virtual:snapback/dev');
  const generatedApp = (await import(pathToFileURL(join(backend, 'generated', 'app.mjs')).href)).app;
  const api = (await import(pathToFileURL(join(backend, 'generated', 'api.mjs')).href)).default;
  const binding = virtualModule.createSnapbackDevAppBinding(generatedApp);
  assert.equal(binding.target.origin, '/__snapback', 'generated binding stays page-relative');

  const pageOriginRequests = [];
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: new URL(`${origin}/`),
  });
  globalThis.fetch = (input, init) => {
    const resolved = typeof input === 'string' && input.startsWith('/')
      ? new URL(input, origin).href
      : input;
    if (typeof resolved === 'string' && resolved.startsWith(origin)) {
      pageOriginRequests.push(new URL(resolved).pathname);
    }
    return originalFetch(resolved, init);
  };

  appClient = await createSnapbackAppClient({
    app: generatedApp,
    binding,
    platform: {
      kind: 'browser',
      indexedDB: new IDBFactory(),
      lockManager: { request: (_name, _options, operation) => operation() },
      cryptoObject: webcrypto,
      databaseName: `snapback-vite-password-relay-${process.pid}`,
    },
    storagePartition: `vite-password-relay-${Date.now()}`,
    rqsStore: null,
  });
  live = await appClient.client.liveQuery(api.listTodos, {
    args: {},
    connectionId: 'vite-password-relay-live',
    transport: 'stream',
    fallbackToPoll: false,
  });
  assert.ok(Array.isArray(live.rows), 'live query is armed before application auth');
  const liveTitle = 'Live before password auth';
  await appClient.client.mutate(api.createTodo, { args: { title: liveTitle } });
  await eventually(
    () => live.rows.some((row) => row.title === liveTitle),
    { label: 'already-armed live query on the page origin' },
  );

  const email = `vite-relay-${Date.now()}@example.com`;
  const password = 'vite-relay-password-42!';
  const signup = await appClient.auth.signUpWithPassword({ email, password });
  assert.equal(signup.recoveryCodes.length, 8, 'signup returns the one-time recovery set');
  const recoveryCode = signup.recoveryCodes[0];
  await appClient.auth.signOut();

  const signin = await appClient.auth.signInWithPassword({ email, password });
  assert.equal(signin.session.userId, signup.session.userId, 'sign-in restores the signup principal');
  await appClient.auth.signOut();

  const recovered = await appClient.auth.consumeRecoveryCode({ email, code: recoveryCode });
  assert.equal(recovered.session.userId, signup.session.userId, 'recovery restores the same principal');
  assert.equal(recovered.recoveryCodes.length, 8, 'consumption rotates the recovery set');
  await appClient.auth.signOut();

  assert.ok(pageOriginRequests.length > 0, 'generated binding issued requests');
  assert.ok(
    pageOriginRequests.every((path) => path.startsWith('/__snapback/')),
    `all generated-binding requests stay on the one Vite origin: ${JSON.stringify(pageOriginRequests)}`,
  );
  console.log(
    'password-recovery-relay.test.mjs: packed generated binding signup, sign-in, recovery, logout, and pre-armed live query pass through one Vite origin',
  );
} finally {
  await live?.dispose?.().catch?.(() => {});
  await appClient?.dispose?.().catch?.(() => {});
  if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation);
  else delete globalThis.location;
  globalThis.fetch = originalFetch;
  await viteServer?.close?.().catch?.(() => {});
  await dev?.close?.().catch?.(() => {});
  rmSync(root, { recursive: true, force: true });
}
