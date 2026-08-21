#!/usr/bin/env node

// @ref LLP 0295#program-invariant-vertical-paved-path-coherence — keep the
// Guide, packed profile entrypoints, first generation, runtime, and clients on
// one Familiar document-result contract.
// @ref LLP 0253#s43-returns-lowering-kind-partitioned-refusing — supported
// document result kinds cross every phase; composite mutation/action document
// values refuse before artifacts with one stable repair route.

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
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { coldInstallStagedPackageClosure } from './snapback-package-cold-install-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = join(root, 'tests', 'fixtures', 'familiar-vdoc-vertical');
const packageRoots = Object.freeze([
  'snapback-contract',
  'snapback-codegen',
  'snapback-client',
  'snapback-react',
  'snapback-umbrella',
  'snapback-cli',
  'snapback-runtime-darwin-arm64',
]);
const guideSpelling = 'returns: v.union([v.doc("todos"), v.null()])';
const negativeCode = 'SNAPBACK_CODEGEN_FAMILIAR_RETURNS_UNLOWERABLE';
const negativeGuideAnchor = '/_snapback/guide/backend/familiar-profile.md#translate-the-familiar-handler-dialect';

function usage() {
  return `Usage: node scripts/familiar-vdoc-vertical-contract.mjs [options]

Options:
  --runtime-binary <path>  Qualified Snapback binary
                           (default: SNAPBACK_RUNTIME_BINARY or target/debug/snapback)
  --keep                   Keep the packed external application
  -h, --help               Print this help
`;
}

function parseArguments(argv) {
  const parsed = {
    runtimeBinary: process.env.SNAPBACK_RUNTIME_BINARY ?? join(root, 'target', 'debug', 'snapback'),
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
    if (child.exitCode !== null) {
      throw new Error(`runtime exited ${child.exitCode}\n${stderr || stdout}`);
    }
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
      const graceful = await Promise.race([
        closed.then(() => true),
        sleep(10_000).then(() => false),
      ]);
      if (!graceful && child.exitCode === null) {
        child.kill('SIGKILL');
        await closed;
      }
    },
  };
}

function copyFixtureFiles(target, names) {
  mkdirSync(target, { recursive: true });
  for (const name of names) cpSync(join(fixtureRoot, name), join(target, name));
}

async function waitFor(predicate, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(25);
  }
  assert.fail(`timed out waiting for ${label}`);
}

async function proveDocumentArrayRefusal(codegen, negativeRoot, fixtureName) {
  copyFixtureFiles(negativeRoot, ['codegen.policy.json', 'schema.ts']);
  cpSync(join(fixtureRoot, fixtureName), join(negativeRoot, 'negative.ts'));
  assert.equal(existsSync(join(negativeRoot, 'generated')), false);
  const refused = await codegen.generate(negativeRoot);
  assert.equal(refused.ok, false);
  const diagnostic = refused.diagnostics.find(({ code }) => code === negativeCode);
  assert(diagnostic, JSON.stringify(refused.diagnostics));
  assert.equal(
    diagnostic.guideAnchor,
    negativeGuideAnchor,
    `${fixtureName} refusal must route to the Familiar handler-dialect table`,
  );
  assert.match(
    diagnostic.message,
    /document-containing composite values require the explicit result: grammar/u,
  );
  assert.equal(
    existsSync(join(negativeRoot, 'generated', 'artifacts.json')),
    false,
    'unsupported Familiar document arrays must refuse before publishing generated artifacts',
  );
  assert.deepEqual(
    readdirSync(join(negativeRoot, 'generated')).sort(),
    ['api.d.ts', 'api.mjs', 'server.d.ts', 'server.mjs'],
    'a clean refusal may retain only LLP 0253 S2 bootstrap imports, never activation output',
  );
}

function proveRegenerationRefusalPreservesLastCompleteGraph(
  packedCli,
  backendRoot,
  generatedRoot,
  fixtureName,
) {
  const authoredName = fixtureName === 'negative-action.ts'
    ? 'watchNegativeAction.ts'
    : 'watchNegative.ts';
  const authoredPath = join(backendRoot, authoredName);
  const artifactsPath = join(generatedRoot, 'artifacts.json');
  const functionsPath = join(generatedRoot, 'functions.manifest.json');
  const artifactsBefore = readFileSync(artifactsPath);
  const functionsBefore = readFileSync(functionsPath);
  cpSync(join(fixtureRoot, fixtureName), authoredPath);
  try {
    const refused = spawnSync(packedCli, ['generate', backendRoot, '--json'], {
      cwd: root,
      env: process.env,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 240_000,
    });
    assert.notEqual(
      refused.status,
      0,
      `regeneration with ${fixtureName} must refuse instead of replacing the complete graph`,
    );
    assert.match(`${refused.stdout}\n${refused.stderr}`, new RegExp(negativeCode, 'u'));
    assert(
      readFileSync(artifactsPath).equals(artifactsBefore),
      `${fixtureName} refusal must preserve artifacts.json byte-for-byte`,
    );
    assert(
      readFileSync(functionsPath).equals(functionsBefore),
      `${fixtureName} refusal must preserve the prior function manifest`,
    );
    const retainedFunctions = readJson(functionsPath).functions.map(({ name }) => name);
    assert.equal(
      retainedFunctions.some((name) => name.includes('unsupportedDocumentArray')),
      false,
      `${fixtureName} must not enter the retained activation manifest`,
    );
  } finally {
    rmSync(authoredPath, { force: true });
  }
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

  const temporary = mkdtempSync(join(tmpdir(), 'snapback-familiar-vdoc-vertical-'));
  const stagedRoot = join(temporary, 'staged');
  const appRoot = join(temporary, 'external-app');
  const backendRoot = join(appRoot, 'snapback');
  const generatedRoot = join(backendRoot, 'generated');
  mkdirSync(stagedRoot, { recursive: true });
  mkdirSync(appRoot, { recursive: true });

  let runtime = null;
  let client = null;
  let renderer = null;
  let preparedBinding = null;
  let presentLiveHandle = null;
  let absentLiveHandle = null;
  try {
    // This acceptance carrier is intentionally not a publication candidate:
    // bootstrap already qualified the exact dirty-worktree binary, while the
    // production package sealer correctly accepts only clean 40-hex revisions.
    // Recreate the npm loader-relative layout in temporary custody and prove
    // the installed binary remains byte-identical to that qualified input.
    const runtimePackageDirectory = join(temporary, 'runtime-package-source');
    const runtimePackageSource = join(root, 'packages', 'snapback-runtime-darwin-arm64');
    mkdirSync(runtimePackageDirectory, { recursive: true });
    cpSync(join(runtimePackageSource, 'package.json'), join(runtimePackageDirectory, 'package.json'));
    cpSync(join(runtimePackageSource, 'README.md'), join(runtimePackageDirectory, 'README.md'));
    mkdirSync(join(runtimePackageDirectory, 'bin'), { recursive: true });
    cpSync(runtimeBinary, join(runtimePackageDirectory, 'bin', 'snapback'));
    chmodSync(join(runtimePackageDirectory, 'bin', 'snapback'), 0o755);
    cpSync(
      join(root, 'vendor', 'ibex', 'ios', 'Frameworks', 'hermesvm.framework', 'Versions', '1'),
      join(runtimePackageDirectory, 'Frameworks', 'hermesvm.framework', 'Versions', '1'),
      { recursive: true },
    );
    mkdirSync(join(runtimePackageDirectory, 'include', 'hermes'), { recursive: true });
    cpSync(
      join(root, 'vendor', 'ibex', 'ios', 'Frameworks', 'hermes-headers', 'hermes', 'hermes.h'),
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
        // The qualified debug binary is intentionally unstripped and can
        // approach 500 MiB. Give only that tarball enough time to compress on
        // a loaded developer machine; all semantic fixture timeouts stay
        // narrow below.
        timeout: packageRoot === 'snapback-runtime-darwin-arm64' ? 600_000 : 300_000,
      });
      assert.equal(lstatSync(tarball).isFile(), true, `${basename(tarball)} was not packed`);
    }

    writeFileSync(join(appRoot, 'package.json'), `${JSON.stringify({
      name: 'familiar-vdoc-packed-vertical-contract',
      private: true,
      type: 'module',
      dependencies: {
        react: '19.1.0',
        'react-test-renderer': '19.1.0',
      },
    }, null, 2)}\n`);
    const installed = await coldInstallStagedPackageClosure({
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
    assert.equal(installed.packageClosure.length, packageRoots.length);
    const packedRuntimeBinary = join(
      appRoot,
      'node_modules',
      '@expo',
      'snapback-runtime-darwin-arm64',
      'bin',
      'snapback',
    );
    const packedRuntimeMetadata = lstatSync(packedRuntimeBinary);
    assert.equal(packedRuntimeMetadata.isFile(), true, 'packed runtime must be a materialized file');
    assert.equal(packedRuntimeMetadata.isSymbolicLink(), false, 'packed runtime must not be a symlink');
    assert.equal(
      sha256(packedRuntimeBinary),
      sha256(runtimeBinary),
      'packed runtime must remain byte-identical to the bootstrap-qualified input',
    );

    copyFixtureFiles(backendRoot, [
      'client-projection.ts',
      'codegen.policy.json',
      'schema.ts',
      'todos.ts',
      'tsconfig.json',
    ]);
    assert.equal(existsSync(generatedRoot), false, 'positive fixture must begin without generated output');

    const packedCli = join(appRoot, 'node_modules', '.bin', 'snapback');
    run(packedCli, ['generate', backendRoot, '--json']);
    const codegen = await import(pathToFileURL(join(
      appRoot,
      'node_modules',
      '@expo',
      'snapback-codegen',
      'index.mjs',
    )).href);
    const functions = readJson(join(generatedRoot, 'functions.manifest.json'));
    const functionByName = new Map(functions.functions.map((definition) => [definition.name, definition]));
    assert.equal(functionByName.get('todos.get').resultContract.kind, 'value');
    assert.equal(functionByName.get('todos.getRequired').resultContract.kind, 'value');
    assert.equal(functionByName.get('todos.list').resultContract.kind, 'documents');
    assert.equal(functionByName.get('todos.create').resultContract.kind, 'document');
    assert.equal(functionByName.get('todos.remove').resultContract.kind, 'value');
    assert.equal(functionByName.get('todos.createFromAction').resultContract.kind, 'document');

    run(join(appRoot, 'node_modules', '.bin', 'tsc'), ['--project', 'tsconfig.json'], {
      cwd: backendRoot,
    });

    proveRegenerationRefusalPreservesLastCompleteGraph(
      packedCli,
      backendRoot,
      generatedRoot,
      'negative.ts',
    );
    proveRegenerationRefusalPreservesLastCompleteGraph(
      packedCli,
      backendRoot,
      generatedRoot,
      'negative-action.ts',
    );

    await proveDocumentArrayRefusal(
      codegen,
      join(appRoot, 'negative-mutation-snapback'),
      'negative.ts',
    );
    await proveDocumentArrayRefusal(
      codegen,
      join(appRoot, 'negative-action-snapback'),
      'negative-action.ts',
    );

    const guideLookup = run(packedCli, ['guide', 'point query', '--json'], {
      env: { ...process.env, SNAPBACK_RUNTIME_BINARY: packedRuntimeBinary },
    });
    const guideResult = JSON.parse(guideLookup.stdout);
    assert.equal(guideResult.mode, 'section-search');
    assert.equal(
      guideResult.matches.some(({ path }) => path === 'backend/familiar-profile.md'),
      true,
      'plausible point-query vocabulary must retrieve the Familiar Guide page',
    );

    runtime = await startRuntime(packedRuntimeBinary, join(temporary, 'runtime'));
    const guideResponse = await fetch(`${runtime.baseUrl}/_snapback/guide/backend/familiar-profile.md`);
    assert.equal(guideResponse.ok, true);
    assert.match(await guideResponse.text(), new RegExp(guideSpelling.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));

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
    const descriptor = readJson(join(generatedRoot, 'app.descriptor.json'));
    await client.ensureApp({
      schema,
      functions,
      seed: {
        tables: {
          todos: [{ _id: 'todo_welcome', title: 'packed seed', completed: false }],
        },
      },
    });
    const api = (await import(`${pathToFileURL(join(generatedRoot, 'api.mjs')).href}?vertical`)).api;

    const seeded = (await client.query(api.todos.get, { args: { id: 'todo_welcome' } })).rows;
    assert.equal(seeded.title, 'packed seed');
    assert.equal((await client.query(api.todos.get, { args: { id: 'todo_missing' } })).rows, null);
    const requiredSeeded = (await client.query(api.todos.getRequired, {
      args: { id: 'todo_welcome' },
    })).rows;
    assert.equal(requiredSeeded.title, 'packed seed');
    const listed = (await client.query(api.todos.list, { args: {} })).rows;
    assert.deepEqual(listed.map(({ title }) => title), ['packed seed']);

    const presentLiveUpdates = [];
    const absentLiveUpdates = [];
    presentLiveHandle = await client.liveQuery(api.todos.get, {
      connectionId: 'packed-point-present',
      args: { id: 'todo_welcome' },
      onUpdate: (todo) => presentLiveUpdates.push(todo),
    });
    absentLiveHandle = await client.liveQuery(api.todos.get, {
      connectionId: 'packed-point-absent',
      args: { id: 'todo_missing' },
      onUpdate: (todo) => absentLiveUpdates.push(todo),
    });
    assert.equal(presentLiveHandle.rows.title, 'packed seed');
    assert.equal(Array.isArray(presentLiveHandle.rows), false);
    assert.equal(absentLiveHandle.rows, null);
    await waitFor(
      () => presentLiveUpdates.some((todo) => todo?.title === 'packed seed')
        && absentLiveUpdates.includes(null),
      'headless live point-document projection',
    );

    const mutation = await client.mutate(api.todos.create, {
      args: { title: 'packed mutation' },
      queue: false,
    });
    assert.equal(mutation.result.title, 'packed mutation');
    const action = await client.run(api.todos.createFromAction, {
      args: { title: 'packed action' },
    });
    assert.equal(action.title, 'packed action');

    preparedBinding = await client.prepareReactBinding({ generatedManifest: descriptor });
    const React = await import(pathToFileURL(join(appRoot, 'node_modules', 'react', 'index.js')).href);
    const TestRenderer = await import(pathToFileURL(join(
      appRoot,
      'node_modules',
      'react-test-renderer',
      'index.js',
    )).href);
    const familiarReact = await import(pathToFileURL(join(
      appRoot,
      'node_modules',
      '@expo',
      'snapback',
      'react.mjs',
    )).href);
    const projected = [];
    const Probe = () => {
      projected.push(familiarReact.useQuery(api.todos.get, { id: 'todo_welcome' }));
      return null;
    };
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(React.createElement(
        familiarReact.SnapbackProvider,
        { binding: preparedBinding },
        React.createElement(Probe),
      ));
    });
    await waitFor(
      () => projected.some((value) => value?.title === 'packed seed'),
      'Familiar React point-document projection',
    );
    const projectedDocument = projected.find((value) => value?.title === 'packed seed');
    assert.equal(Array.isArray(projectedDocument), false, 'useQuery projects one document, not one row array');

    await client.mutate(api.todos.remove, {
      args: { id: 'todo_welcome' },
      queue: false,
    });
    const deleteDeadline = Date.now() + 15_000;
    while (presentLiveHandle.rows !== null && Date.now() < deleteDeadline) {
      await presentLiveHandle.poll();
      if (presentLiveHandle.rows !== null) await sleep(25);
    }
    assert.equal(
      presentLiveHandle.rows,
      null,
      'deleting the point row transitions the typed headless live handle to null',
    );
    await waitFor(
      () => presentLiveUpdates.at(-1) === null,
      'headless live delete transition callback',
    );

    process.stdout.write(`${JSON.stringify({
      schemaVersion: 'snapback.familiar-vdoc-vertical-contract.v1',
      ok: true,
      packageClosure: installed.packageClosure,
      guide: { query: guideResult.query, path: 'backend/familiar-profile.md', spelling: guideSpelling },
      generation: {
        cleanFirstPass: true,
        resultKinds: Object.fromEntries(
          [...functionByName].map(([name, definition]) => [name, definition.resultContract.kind]),
        ),
      },
      runtime: {
        packedByteIdenticalCarrier: true,
        bareDocumentQuery: true,
        nullablePoint: true,
        documentMutation: true,
        documentAction: true,
        documentArrayQuery: true,
      },
      clients: {
        headless: true,
        headlessLive: { present: true, absent: true, deleteTransition: true },
        react: true,
      },
      negative: {
        code: negativeCode,
        functionKinds: ['mutation', 'action'],
        activationOutput: false,
        bootstrapImportsOnly: true,
        regenerationPreservesCompleteGraph: true,
        rewrite: 'explicit result: grammar',
      },
    })}\n`);
  } finally {
    try { await presentLiveHandle?.dispose?.(); } catch { /* retain the primary proof failure */ }
    try { await absentLiveHandle?.dispose?.(); } catch { /* retain the primary proof failure */ }
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
    try { await client?.close?.(); } catch { /* retain the primary proof failure */ }
    try { await runtime?.stop?.(); } catch { /* retain the primary proof failure */ }
    if (args.keep) process.stderr.write(`kept packed fixture at ${temporary}\n`);
    else rmSync(temporary, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error?.stack ?? String(error));
  process.exitCode = 1;
});
