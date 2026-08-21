#!/usr/bin/env node

// @ref LLP 0295#program-invariant-vertical-paved-path-coherence — bind the
// Guide route, packed imports, first generation, runtime, headless/React/Expo
// lifecycle, and negative diagnostic into one activity-presence receipt.
// @ref LLP 0257#activity-model-absolute-deadline-plus-generation-fence —
// touch owns the activity deadline, provider heartbeat owns renewal, and
// idle/explicit/background transitions withdraw the entry.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { coldInstallStagedPackageClosure } from './snapback-package-cold-install-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = join(root, 'tests', 'fixtures', 'activity-presence-vertical');
const packageRoots = Object.freeze([
  'snapback-contract',
  'snapback-codegen',
  'snapback-client',
  'snapback-react',
  'snapback-expo',
  'snapback-cli',
  'snapback-runtime-darwin-arm64',
]);
const guidePath = 'recipes/activity-presence.md';
const negativeCode = 'SNAPBACK_REACT_ACTIVITY_IDLE_MS_INVALID';
const collectionTtlMs = 5_000;
const deleteVisibilityMs = 2_000;

function usage() {
  return `Usage: node scripts/activity-presence-vertical-contract.mjs [options]

Options:
  --runtime-binary <path>  Qualified Snapback binary
                           (default: SNAPBACK_RUNTIME_BINARY or target/debug/snapback)
  --reuse-root <path>      Re-run semantic layers in a retained --keep root
  --keep                   Keep the packed external application
  -h, --help               Print this help
`;
}

function parseArguments(argv) {
  const parsed = {
    runtimeBinary: process.env.SNAPBACK_RUNTIME_BINARY ?? join(root, 'target', 'debug', 'snapback'),
    reuseRoot: null,
    keep: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '-h' || argument === '--help') parsed.help = true;
    else if (argument === '--keep') parsed.keep = true;
    else if (argument === '--runtime-binary') {
      const value = argv[++index];
      if (!value || value.startsWith('-')) throw new TypeError('--runtime-binary requires a path');
      parsed.runtimeBinary = value;
    } else if (argument === '--reuse-root') {
      const value = argv[++index];
      if (!value || value.startsWith('-')) throw new TypeError('--reuse-root requires a path');
      parsed.reuseRoot = value;
    } else throw new TypeError(`unrecognized argument: ${argument}`);
  }
  return parsed;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeout ?? 240_000,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed (${result.status ?? result.signal}):\n${result.stderr || result.stdout}`,
  );
  return result;
}

const sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

async function waitFor(predicate, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
      lastError = null;
    } catch (error) {
      lastError = error;
    }
    await sleep(25);
  }
  if (lastError) throw lastError;
  assert.fail(`timed out waiting for ${label}`);
}

async function waitForDeleteBeforeTtl(predicate, label) {
  const startedAt = Date.now();
  await waitFor(predicate, label, deleteVisibilityMs);
  const elapsedMs = Date.now() - startedAt;
  assert(
    elapsedMs < deleteVisibilityMs,
    `${label} took ${elapsedMs}ms; delete must be visible before the ${collectionTtlMs}ms TTL`,
  );
  return elapsedMs;
}

function cleanRuntimeEnvironment() {
  const environment = {
    ...process.env,
    SNAPBACK_CRON_DISABLED: '1',
    SNAPBACK_JOBS_DISABLED: '1',
    SNAPBACK_PACKAGED_STORE_QUALIFICATION_MODE: '1',
  };
  for (const key of Object.keys(environment)) {
    if (key.startsWith('DYLD_') || key === 'LD_LIBRARY_PATH') delete environment[key];
  }
  return environment;
}

async function startRuntime(binary, stateRoot) {
  mkdirSync(stateRoot, { recursive: true });
  const readyFile = join(stateRoot, 'snapback.ready.json');
  const database = join(stateRoot, 'snapback.sqlite3');
  const child = spawn(binary, ['start', '--port', '0', '--ready-file', readyFile, '--db', database], {
    cwd: stateRoot,
    env: cleanRuntimeEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-32_000); });
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-32_000); });
  const deadline = Date.now() + 60_000;
  while (!existsSync(readyFile)) {
    if (child.exitCode !== null) throw new Error(`runtime exited ${child.exitCode}\n${stderr || stdout}`);
    if (Date.now() >= deadline) {
      child.kill('SIGTERM');
      throw new Error(`runtime did not publish readiness\n${stderr || stdout}`);
    }
    await sleep(50);
  }
  const ready = readJson(readyFile);
  assert.equal(ready.ready, true);
  const adminToken = ready.adminTokenFile
    ? readFileSync(ready.adminTokenFile, 'utf8').trim()
    : process.env.SNAPBACK_ADMIN_TOKEN;
  assert(adminToken, 'runtime readiness must expose an admin token');
  return {
    adminToken,
    baseUrl: ready.serverUrl,
    child,
    async stop() {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      const closed = new Promise((resolveClose) => child.once('close', resolveClose));
      const graceful = await Promise.race([closed.then(() => true), sleep(10_000).then(() => false)]);
      if (!graceful && child.exitCode === null) {
        child.kill('SIGKILL');
        await closed;
      }
    },
  };
}

function copyFixtureFiles(target) {
  mkdirSync(target, { recursive: true });
  for (const name of [
    'client-projection.ts',
    'codegen.policy.json',
    'functions.mjs',
    'schema.mjs',
    'surface-model.mjs',
    'tsconfig.json',
  ]) {
    cpSync(join(fixtureRoot, name), join(target, name));
  }
}

function lifecycleSource(initialState = 'active') {
  const listeners = new Set();
  return {
    currentState: initialState,
    addEventListener(type, listener) {
      assert.equal(type, 'change');
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
    transition(next) {
      this.currentState = next;
      for (const listener of [...listeners]) listener(next);
    },
  };
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }
  const runtimeBinary = resolve(args.runtimeBinary);
  const runtimeMetadata = lstatSync(runtimeBinary);
  assert.equal(runtimeMetadata.isFile(), true, `runtime binary must be a file: ${runtimeBinary}`);
  assert.equal(runtimeMetadata.isSymbolicLink(), false, 'runtime binary must not be a symlink');
  const runtimeCheckout = dirname(dirname(dirname(runtimeBinary)));

  const temporary = args.reuseRoot === null
    ? mkdtempSync(join(tmpdir(), 'snapback-activity-presence-vertical-'))
    : resolve(args.reuseRoot);
  const stagedRoot = join(temporary, 'staged');
  const appRoot = join(temporary, 'external-app');
  const backendRoot = join(appRoot, 'snapback');
  const generatedRoot = join(backendRoot, 'generated');
  mkdirSync(stagedRoot, { recursive: true });
  mkdirSync(appRoot, { recursive: true });

  let runtime = null;
  let client = null;
  let observer = null;
  let headlessPublisher = null;
  let renderer = null;
  try {
    let installed;
    if (args.reuseRoot === null) {
      const runtimePackageDirectory = join(temporary, 'runtime-package-source');
      const runtimePackageSource = join(root, 'packages', 'snapback-runtime-darwin-arm64');
      mkdirSync(runtimePackageDirectory, { recursive: true });
      cpSync(join(runtimePackageSource, 'package.json'), join(runtimePackageDirectory, 'package.json'));
      cpSync(join(runtimePackageSource, 'README.md'), join(runtimePackageDirectory, 'README.md'));
      mkdirSync(join(runtimePackageDirectory, 'bin'), { recursive: true });
      cpSync(runtimeBinary, join(runtimePackageDirectory, 'bin', 'snapback'));
      chmodSync(join(runtimePackageDirectory, 'bin', 'snapback'), 0o755);
      cpSync(
        join(runtimeCheckout, 'vendor', 'ibex', 'ios', 'Frameworks', 'hermesvm.framework', 'Versions', '1'),
        join(runtimePackageDirectory, 'Frameworks', 'hermesvm.framework', 'Versions', '1'),
        { recursive: true },
      );
      mkdirSync(join(runtimePackageDirectory, 'include', 'hermes'), { recursive: true });
      cpSync(
        join(runtimeCheckout, 'vendor', 'ibex', 'ios', 'Frameworks', 'hermes-headers', 'hermes', 'hermes.h'),
        join(runtimePackageDirectory, 'include', 'hermes', 'hermes.h.artifact'),
      );

      for (const packageRoot of packageRoots) {
        const packageDirectory = packageRoot === 'snapback-runtime-darwin-arm64'
          ? runtimePackageDirectory
          : join(root, 'packages', packageRoot);
        const tarball = join(stagedRoot, `${packageRoot}.tgz`);
        run('bun', [
          'pm',
          'pack',
          ...(packageRoot === 'snapback-runtime-darwin-arm64' ? ['--ignore-scripts'] : []),
          '--filename',
          tarball,
          '--quiet',
        ], {
          cwd: packageDirectory,
          timeout: packageRoot === 'snapback-runtime-darwin-arm64' ? 600_000 : 300_000,
        });
        assert.equal(lstatSync(tarball).isFile(), true, `${basename(tarball)} was not packed`);
      }

      writeFileSync(join(appRoot, 'package.json'), `${JSON.stringify({
        name: 'activity-presence-packed-vertical-contract',
        private: true,
        type: 'module',
        dependencies: {
          react: '^19.2.3',
          'react-test-renderer': '^19.2.3',
        },
      }, null, 2)}\n`);
      installed = await coldInstallStagedPackageClosure({
        stagedDir: stagedRoot,
        appDir: appRoot,
        environment: {
          ...process.env,
          npm_config_audit: 'false',
          npm_config_cache: join(temporary, 'npm-cache'),
          npm_config_fund: 'false',
        },
        timeoutMs: 300_000,
      });
    } else {
      installed = {
        packageClosure: packageRoots.map((packageRoot) => {
          const tarball = join(stagedRoot, `${packageRoot}.tgz`);
          const packageDirectory = packageRoot === 'snapback-runtime-darwin-arm64'
            ? join(temporary, 'runtime-package-source')
            : join(root, 'packages', packageRoot);
          const manifest = readJson(join(packageDirectory, 'package.json'));
          return Object.freeze({
            name: manifest.name,
            version: manifest.version,
            sha256: `sha256:${sha256(tarball)}`,
          });
        }),
      };
    }
    assert.equal(installed.packageClosure.length, packageRoots.length);
    const packedRuntimeBinary = join(
      appRoot,
      'node_modules',
      '@expo',
      'snapback-runtime-darwin-arm64',
      'bin',
      'snapback',
    );
    assert.equal(sha256(packedRuntimeBinary), sha256(runtimeBinary));

    copyFixtureFiles(backendRoot);
    if (args.reuseRoot === null) {
      assert.equal(existsSync(generatedRoot), false, 'fixture must begin without generated output');
    }
    const packedCli = join(appRoot, 'node_modules', '.bin', 'snapback');
    run(packedCli, ['generate', backendRoot, '--json'], {
      env: { ...process.env, SNAPBACK_RUNTIME_BINARY: packedRuntimeBinary },
    });
    run(join(appRoot, 'node_modules', '.bin', 'tsc'), ['--project', 'tsconfig.json'], {
      cwd: backendRoot,
    });

    const guideLookup = run(packedCli, ['guide', 'typing', '--json'], {
      env: { ...process.env, SNAPBACK_RUNTIME_BINARY: packedRuntimeBinary },
    });
    const guideResult = JSON.parse(guideLookup.stdout);
    assert.equal(
      guideResult.matches.some(({ path }) => path === guidePath),
      true,
      `snapback guide typing must retrieve ${guidePath}`,
    );

    runtime = await startRuntime(packedRuntimeBinary, join(temporary, 'runtime'));
    const guideResponse = await fetch(`${runtime.baseUrl}/_snapback/guide/${guidePath}`);
    assert.equal(guideResponse.ok, true);
    assert.match(await guideResponse.text(), /surface presence value is a continuous publish/u);

    const clientPackage = await import(pathToFileURL(join(
      appRoot,
      'node_modules',
      '@expo',
      'snapback-client',
      'index.mjs',
    )).href);
    client = new clientPackage.SnapbackClient(runtime.baseUrl, {
      adminToken: runtime.adminToken,
      rqsStore: null,
      offlineQueue: false,
    });
    const schema = readJson(join(generatedRoot, 'schema.manifest.json'));
    const functions = readJson(join(generatedRoot, 'functions.manifest.json'));
    const descriptor = readJson(join(generatedRoot, 'app.descriptor.json'));
    await client.ensureApp({ schema, functions });
    const generatedApp = (await import(
      `${pathToFileURL(join(generatedRoot, 'app.mjs')).href}?activity-presence-vertical`
    )).app;
    const typing = generatedApp.api.ephemeral.typing;
    assert.equal(
      typing.defaultTtlMs,
      collectionTtlMs,
      'generated typing reference must carry the 5s fixture TTL used by delete timing assertions',
    );
    const scope = { roomId: 'room-one' };

    observer = await client.subscribeEphemeral(typing, {
      connectionId: 'packed-observer',
      scope,
      transport: 'poll',
    });
    headlessPublisher = await client.subscribeEphemeral(typing, {
      connectionId: 'packed-headless-publisher',
      scope,
      transport: 'poll',
    });
    await headlessPublisher.publish({ userHandle: 'headless', name: 'Headless' });
    await waitFor(async () => {
      await observer.drain();
      return observer.currentEntries().some(({ value }) => value.userHandle === 'headless');
    }, 'headless publish visibility');
    await headlessPublisher.delete();
    const headlessDeleteMs = await waitForDeleteBeforeTtl(async () => {
      await observer.drain();
      return !observer.currentEntries().some(({ value }) => value.userHandle === 'headless');
    }, 'headless delete visibility');

    const React = await import(pathToFileURL(join(appRoot, 'node_modules', 'react', 'index.js')).href);
    const TestRenderer = await import(pathToFileURL(join(
      appRoot,
      'node_modules',
      'react-test-renderer',
      'index.js',
    )).href);
    const reactPackage = await import(pathToFileURL(join(
      appRoot,
      'node_modules',
      '@expo',
      'snapback-react',
      'index.mjs',
    )).href);
    const binding = await client.prepareReactBinding({ generatedManifest: descriptor });
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    let activity = null;
    function ReactProbe() {
      activity = reactPackage.useSnapbackActivityPresence(typing, {
        scope,
        value: () => ({ userHandle: 'react', name: 'React' }),
        idleMs: 300,
      });
      return null;
    }
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(React.createElement(
        reactPackage.SnapbackProvider,
        { binding },
        React.createElement(ReactProbe),
      ));
      await sleep(0);
    });
    TestRenderer.act(() => { activity.touch(); });
    await waitFor(async () => {
      await observer.drain();
      return observer.currentEntries().some(({ value }) => value.userHandle === 'react');
    }, 'React touch visibility');
    const idleDeleteMs = await waitForDeleteBeforeTtl(async () => {
      await observer.drain();
      return !observer.currentEntries().some(({ value }) => value.userHandle === 'react');
    }, 'React idle withdrawal');
    TestRenderer.act(() => { activity.touch(); });
    await waitFor(async () => {
      await observer.drain();
      return observer.currentEntries().some(({ value }) => value.userHandle === 'react');
    }, 'React second touch visibility');
    await TestRenderer.act(async () => { await activity.withdraw(); });
    const explicitDeleteMs = await waitForDeleteBeforeTtl(async () => {
      await observer.drain();
      return !observer.currentEntries().some(({ value }) => value.userHandle === 'react');
    }, 'React explicit withdrawal');
    await TestRenderer.act(async () => { renderer.unmount(); });
    renderer = null;

    function BoundValueProbe({ enabled }) {
      reactPackage.useSurface(generatedApp.surfaces.typingRoom, scope, {
        presence: {
          typing: enabled
            ? { userHandle: 'bound-react', name: 'Bound React' }
            : reactPackage.skip,
        },
      });
      return null;
    }
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(React.createElement(
        reactPackage.SnapbackProvider,
        { binding },
        React.createElement(BoundValueProbe, { enabled: true }),
      ));
      await sleep(0);
    });
    await waitFor(async () => {
      await observer.drain();
      return observer.currentEntries().some(({ value }) => value.userHandle === 'bound-react');
    }, 'bound surface presence visibility');
    await sleep(collectionTtlMs + 750);
    await observer.drain();
    assert.equal(
      observer.currentEntries().some(({ value }) => value.userHandle === 'bound-react'),
      true,
      'truthy useSurface presence must remain visible beyond TTL while mounted',
    );
    await TestRenderer.act(async () => {
      renderer.update(React.createElement(
        reactPackage.SnapbackProvider,
        { binding },
        React.createElement(BoundValueProbe, { enabled: false }),
      ));
      await sleep(0);
    });
    const boundSkipDeleteMs = await waitForDeleteBeforeTtl(async () => {
      await observer.drain();
      return !observer.currentEntries().some(({ value }) => value.userHandle === 'bound-react');
    }, 'bound surface skip withdrawal');
    await TestRenderer.act(async () => { renderer.unmount(); });
    renderer = null;

    const expoPackageRoot = join(appRoot, 'node_modules', '@expo', 'snapback-expo');
    const expoPackage = await import(pathToFileURL(join(expoPackageRoot, 'index.mjs')).href);
    const expoProvider = await import(pathToFileURL(join(expoPackageRoot, 'provider.mjs')).href);
    const appState = lifecycleSource('active');
    let expoActivity = null;
    function ExpoProbe() {
      expoActivity = expoPackage.useSnapbackActivityPresence(typing, {
        scope,
        value: () => ({ userHandle: 'expo', name: 'Expo' }),
        idleMs: 60_000,
      });
      return null;
    }
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(React.createElement(
        expoProvider.SnapbackExpoLifecycleContextProvider,
        { value: { source: appState, environment: null } },
        React.createElement(
          reactPackage.SnapbackProvider,
          { binding },
          React.createElement(ExpoProbe),
        ),
      ));
      await sleep(0);
    });
    TestRenderer.act(() => { expoActivity.touch(); });
    await waitFor(async () => {
      await observer.drain();
      return observer.currentEntries().some(({ value }) => value.userHandle === 'expo');
    }, 'Expo touch visibility');
    await TestRenderer.act(async () => {
      appState.transition('background');
      await sleep(0);
    });
    const backgroundDeleteMs = await waitForDeleteBeforeTtl(async () => {
      await observer.drain();
      return !observer.currentEntries().some(({ value }) => value.userHandle === 'expo');
    }, 'Expo background withdrawal');
    await TestRenderer.act(async () => { renderer.unmount(); });
    renderer = null;

    function InvalidProbe() {
      reactPackage.useSnapbackActivityPresence(typing, {
        scope,
        value: () => ({ userHandle: 'invalid', name: 'Invalid' }),
        idleMs: 0,
      });
      return null;
    }
    const originalConsoleError = console.error;
    console.error = () => {};
    try {
      await assert.rejects(
        Promise.resolve(TestRenderer.act(async () => {
          TestRenderer.create(React.createElement(
            reactPackage.SnapbackProvider,
            { binding },
            React.createElement(InvalidProbe),
          ));
        })),
        (error) => reactPackage.isSnapbackDiagnosticError(error) && error.code === negativeCode,
      );
    } finally {
      console.error = originalConsoleError;
    }

    process.stdout.write(`${JSON.stringify({
      schemaVersion: 'snapback.activity-presence-vertical-contract.v2',
      ok: true,
      packageClosure: installed.packageClosure,
      guide: { query: 'typing', path: guidePath },
      generation: {
        cleanFirstPass: args.reuseRoot === null,
        reusedPackedRoot: args.reuseRoot !== null,
        typedGeneratedEphemeralReference: true,
      },
      runtime: {
        packedByteIdenticalCarrier: true,
        collectionTtlMs,
        deleteVisibilityMs,
        headlessPublishDelete: true,
        headlessDeleteMs,
      },
      clients: {
        react: {
          touch: true,
          idleWithdrawalBeforeTtl: true,
          idleDeleteMs,
          explicitWithdrawal: true,
          explicitDeleteMs,
          boundValueContinuousRenewal: true,
          boundValuePersistedBeyondTtl: true,
          boundSkipWithdrawalBeforeTtl: true,
          boundSkipDeleteMs,
        },
        expo: { touch: true, backgroundWithdrawal: true, backgroundDeleteMs },
      },
      negative: {
        code: negativeCode,
        rewrite: 'set idleMs to a finite safe integer in [250, 2147483647]',
      },
    })}\n`);
  } finally {
    if (renderer !== null) {
      try {
        const TestRenderer = await import(pathToFileURL(join(
          appRoot,
          'node_modules',
          'react-test-renderer',
          'index.js',
        )).href);
        await TestRenderer.act(async () => { renderer.unmount(); });
      } catch { /* retain the primary proof failure */ }
    }
    try { await headlessPublisher?.delete?.(); } catch { /* retain the primary proof failure */ }
    try { headlessPublisher?.dispose?.(); } catch { /* retain the primary proof failure */ }
    try { observer?.dispose?.(); } catch { /* retain the primary proof failure */ }
    try { await client?.close?.(); } catch { /* retain the primary proof failure */ }
    try { await runtime?.stop?.(); } catch { /* retain the primary proof failure */ }
    if (args.keep || args.reuseRoot !== null) {
      process.stderr.write(`kept packed fixture at ${temporary}\n`);
    } else rmSync(temporary, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error?.stack ?? String(error));
  process.exitCode = 1;
});
