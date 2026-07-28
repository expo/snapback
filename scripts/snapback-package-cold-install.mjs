#!/usr/bin/env node

// @ref LLP 0041#acceptance — prove the published package closure from a fresh
// external project: tarball install, offline codegen, packaged CLI discovery,
// remote publication, and a browser-only adapter bundle.
// @ref LLP 0063#workstream-6--reduce-snapbacks-declaration-and-runtime-tax —
// repository-local imports and sibling source checkouts are forbidden here.

import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { release as osRelease, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseArguments,
  PUBLIC_NPM_REGISTRY,
  runAsync,
  usage,
  validatePublicPublicationLedger,
} from './snapback-package-cold-install-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  console.error(`snapback-package-cold-install: ${message}`);
  process.exit(1);
}

let parsedArgs;
try {
  parsedArgs = parseArguments(process.argv.slice(2));
} catch (error) {
  fail(error.message);
}
if (parsedArgs.help) {
  process.stdout.write(usage);
  process.exit(0);
}

const ledgerPath = resolve(parsedArgs.ledger ?? join(root, 'dist-publish', 'publish-ledger.json'));
const installSource = parsedArgs.installSource;
const registry = parsedArgs.registry;
const receiptPath = parsedArgs.receipt;
const keep = parsedArgs.keep;

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: 'utf8',
    timeout: options.timeout ?? 240_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    fail(`${command} ${commandArgs.join(' ')} failed (${result.status}):\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

async function runAsyncOrFail(command, commandArgs, options = {}) {
  try {
    return await runAsync(command, commandArgs, options);
  } catch (error) {
    fail(error.message);
  }
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function digest(path, algorithm, encoding) {
  return createHash(algorithm).update(readFileSync(path)).digest(encoding);
}

async function startStagedRegistry(ledgerDirectory, ledger) {
  const records = new Map();
  for (const entry of ledger.packages ?? []) {
    const tarballPath = join(ledgerDirectory, entry.tarball);
    const manifest = JSON.parse(run('tar', ['-xzOf', tarballPath, 'package/package.json']));
    records.set(entry.name, {
      entry,
      manifest,
      tarballPath,
      shasum: digest(tarballPath, 'sha1', 'hex'),
      integrity: `sha512-${digest(tarballPath, 'sha512', 'base64')}`,
    });
  }
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (pathname.startsWith('/tarballs/')) {
      const filename = decodeURIComponent(pathname.slice('/tarballs/'.length));
      const record = [...records.values()].find((candidate) => candidate.entry.tarball === filename);
      if (!record) {
        response.writeHead(404).end('missing tarball');
        return;
      }
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      response.end(readFileSync(record.tarballPath));
      return;
    }
    const name = decodeURIComponent(pathname.slice(1));
    const record = records.get(name);
    if (!record) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'not_found', reason: `staged package ${name} is absent` }));
      return;
    }
    const address = server.address();
    const tarball = `http://127.0.0.1:${address.port}/tarballs/${encodeURIComponent(record.entry.tarball)}`;
    const versionManifest = {
      ...record.manifest,
      dist: { tarball, shasum: record.shasum, integrity: record.integrity },
    };
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      _id: name,
      name,
      'dist-tags': { [ledger.tag ?? 'latest']: record.entry.version, latest: record.entry.version },
      versions: { [record.entry.version]: versionManifest },
    }));
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolveClose, rejectClose) => {
      server.close((error) => error ? rejectClose(error) : resolveClose());
    }),
  };
}

async function provePackagedDevLoop({ cli, scaffoldRoot }) {
  const readyFile = join(scaffoldRoot, '.snapback', 'dev.ready.json');
  const database = join(scaffoldRoot, '.snapback', 'dev.sqlite3');
  const functionsPath = join(scaffoldRoot, 'snapback', 'functions.mjs');
  const child = spawn(cli, ['dev', 'snapback'], {
    cwd: scaffoldRoot,
    env: process.env,
    // Watch mode owns a machine-readable stdin control channel. Keep it open
    // for the proof lifetime: EOF is intentionally interpreted as "stop".
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const events = () => stdout
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  const waitFor = async (predicate, label, timeoutMs = 30_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const match = events().find(predicate);
      if (match) return match;
      if (child.exitCode !== null) {
        fail(`${label}: dev process exited ${child.exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    fail(`${label}: timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  };
  try {
    await waitFor((event) => event.state === 'generated-and-loaded' && event.managed === true, 'initial managed dev load');
    if (!existsSync(readyFile)) fail('managed dev did not publish its ready-file descriptor');
    const descriptor = JSON.parse(readFileSync(readyFile, 'utf8'));
    const health = await fetch(`${descriptor.serverUrl}/health`).then((response) => response.json());
    if (health?.ok !== true || health?.binary?.startupNonce !== descriptor.startupNonce) {
      fail(`managed dev ready-file did not identify the live server: ${JSON.stringify(health)}`);
    }

    const mismatch = spawnSync(cli, [
      'dev', 'snapback', '--attach', '--no-watch',
      '--ready-file', readyFile,
      '--db', join(scaffoldRoot, '.snapback', 'different.sqlite3'),
    ], { cwd: scaffoldRoot, encoding: 'utf8', timeout: 30_000 });
    if (mismatch.status === 0 || !`${mismatch.stdout}\n${mismatch.stderr}`.includes('SNAPBACK_DEV_SERVER_TARGET_MISMATCH')) {
      fail(`mismatched attach did not fail closed: ${mismatch.stdout}\n${mismatch.stderr}`
        + `\nmanaged exit=${child.exitCode} readyFile=${existsSync(readyFile)}`
        + `\nmanaged stdout:\n${stdout}\nmanaged stderr:\n${stderr}`);
    }

    writeFileSync(functionsPath, `${readFileSync(functionsPath, 'utf8')}\n// packaged watch proof\n`);
    await waitFor(
      (event) => event.state === 'generated-and-loaded' && event.changed === 'functions.mjs',
      'watched regeneration and server load',
    );
  } finally {
    if (child.exitCode === null) child.kill('SIGINT');
    const deadline = Date.now() + 15_000;
    while (child.exitCode === null && Date.now() < deadline) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  if (existsSync(readyFile)) fail('managed dev stop left a stale ready-file descriptor');
  return { readyFile, database };
}

if (!existsSync(ledgerPath)) fail(`publication ledger is missing: ${ledgerPath}`);
const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
if (ledger.schemaVersion !== 'snapback.package-publication.v1') fail('unsupported publication ledger');
const ledgerDirectory = dirname(ledgerPath);
const dependencies = { react: '19.2.3', esbuild: '0.28.1' };
const runtimePackages = new Map([
  ['darwin-arm64', '@snapback/runtime-darwin-arm64'],
  ['linux-x64', '@snapback/runtime-linux-x64'],
]);
const hostPlatform = `${process.platform}-${process.arch}`;
const hostRuntime = runtimePackages.get(hostPlatform);
if (!hostRuntime) fail(`cold-install proof has no runtime package for ${hostPlatform}`);
const allExpectedPackages = [
  ...runtimePackages.values(),
  '@snapback/contract',
  '@snapback/client',
  '@snapback/codegen',
  '@snapback/react',
  '@snapback/app-cli',
  '@snapback/cli',
];
let publicEntries = null;
if (installSource === 'public') {
  try {
    publicEntries = validatePublicPublicationLedger(ledger, allExpectedPackages);
  } catch (error) {
    fail(error.message);
  }
  if (registry !== ledger.registry) {
    fail(`public install registry differs from publication ledger: ${registry}`);
  }
}
const tarballs = [];
for (const entry of ledger.packages ?? []) {
  const runtimePlatform = [...runtimePackages.entries()]
    .find(([, packageName]) => packageName === entry.sourceName)?.[0];
  if (runtimePlatform && runtimePlatform !== hostPlatform) continue;
  if (installSource === 'public') {
    dependencies[entry.sourceName] = `npm:${entry.name}@${entry.version}`;
  } else {
    const tarball = join(ledgerDirectory, entry.tarball);
    if (!existsSync(tarball)) fail(`tarball is missing: ${tarball}`);
    if (sha256(tarball) !== entry.sha256) fail(`tarball digest mismatch: ${entry.tarball}`);
    dependencies[entry.sourceName] = `file:${tarball}`;
    tarballs.push(tarball);
  }
}

const expectedPackages = [
  hostRuntime,
  '@snapback/contract',
  '@snapback/client',
  '@snapback/codegen',
  '@snapback/react',
  '@snapback/app-cli',
  '@snapback/cli',
];
for (const name of expectedPackages) {
  if (!dependencies[name]) fail(`publication closure omits ${name}`);
}

const temporary = mkdtempSync(join(tmpdir(), 'snapback-package-cold-'));
const registryTarballs = [];
if (installSource === 'public') {
  const downloadRoot = join(temporary, 'registry-tarballs');
  mkdirSync(downloadRoot, { recursive: true });
  for (const sourceName of allExpectedPackages) {
    const entry = publicEntries.get(sourceName);
    const packed = JSON.parse(run('npm', [
      'pack',
      `${entry.name}@${entry.version}`,
      '--pack-destination', downloadRoot,
      '--json',
      '--ignore-scripts',
      '--registry', registry,
    ], { cwd: temporary, timeout: 360_000 }))[0];
    const downloaded = join(downloadRoot, packed.filename);
    if (sha256(downloaded) !== entry.registrySha256) {
      fail(`public registry tarball digest mismatch for ${entry.name}@${entry.version}`);
    }
    const manifest = JSON.parse(run('tar', ['-xzOf', downloaded, 'package/package.json']));
    if (manifest.name !== entry.name || manifest.version !== entry.version) {
      fail(`public registry package identity drift for ${entry.name}@${entry.version}`);
    }
    registryTarballs.push({
      sourceName,
      publishedName: entry.name,
      version: entry.version,
      sha256: entry.registrySha256,
    });
  }
}
const stagedRegistry = installSource === 'staged'
  ? await startStagedRegistry(ledgerDirectory, ledger)
  : null;
const installRegistry = stagedRegistry?.url ?? registry;
const appRoot = join(temporary, 'partitime-external');
const backendRoot = join(appRoot, 'snapback');
mkdirSync(backendRoot, { recursive: true });

try {
  writeFileSync(join(appRoot, 'package.json'), `${JSON.stringify({
    name: 'partitime-external-package-proof',
    version: '1.0.0',
    private: true,
    type: 'module',
    dependencies,
  }, null, 2)}\n`);
  writeFileSync(
    join(appRoot, '.npmrc'),
    `registry=${PUBLIC_NPM_REGISTRY}\n@ccheever:registry=${installRegistry}\n`,
  );
  // Materialize the real Partitime backend source into the external checkout.
  // From this point onward the proof runs only against that copy and tarballs.
  for (const file of ['schema.mjs', 'functions.mjs', 'seed.json']) {
    cpSync(join(root, 'demos', 'partiful-matrix', 'snapback', file), join(backendRoot, file));
  }
  writeFileSync(join(backendRoot, 'remote-service.publication.json'), `${JSON.stringify({
    profileId: 'remote-service-sqlite-ibex',
    targetProfileId: 'remote-service-sqlite-ibex',
    authCapabilityId: 'snapback.auth.partitime-external',
    dataCapabilityId: 'snapback.data.partitime-external',
    operations: ['createEvent', 'rsvp', 'postMessage'],
  }, null, 2)}\n`);
  writeFileSync(join(appRoot, 'generate.mjs'), `
import { readFileSync } from 'node:fs';
import { generate } from '@snapback/codegen';
for (const targetProfile of ['local-dev-sqlite-ibex', 'remote-service-sqlite-ibex']) {
  const result = await generate(new URL('./snapback', import.meta.url).pathname, { targetProfile });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
}
const profile = JSON.parse(readFileSync(new URL('./snapback/generated-remote-service/remote-service.profile.json', import.meta.url), 'utf8'));
if (profile.publication.profilePath.includes('node_modules')) throw new Error('package-install path leaked into publication');
if (profile.publication.profilePath !== 'snapback/generated-remote-service/remote-service.profile.json') {
  throw new Error(\`unexpected publication path: \${profile.publication.profilePath}\`);
}
if (profile.dataTier.caseCount < 29) throw new Error('bundled data-tier corpus is incomplete');
`);
  writeFileSync(join(appRoot, 'browser-entry.mjs'), `
import { createMemorySnapbackClientStore } from '@snapback/contract';
import { SnapbackClient } from '@snapback/client';
import { useSnapbackQuery } from '@snapback/react';
globalThis.__snapbackPackageProof = [createMemorySnapbackClientStore, SnapbackClient, useSnapbackQuery];
`);
  writeFileSync(join(appRoot, 'bundle.mjs'), `
import { build } from 'esbuild';
await build({
  entryPoints: ['browser-entry.mjs'],
  outfile: 'dist/browser-entry.js',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  logLevel: 'silent',
});
`);

  run('git', ['init', '--quiet'], { cwd: appRoot });
  await runAsyncOrFail('npm', [
    'install',
    '--no-audit',
    '--no-fund',
    '--registry', PUBLIC_NPM_REGISTRY,
    ...tarballs,
  ], {
    cwd: appRoot,
    timeout: 360_000,
  });
  for (const name of expectedPackages) {
    const installPath = join(appRoot, 'node_modules', ...name.split('/'));
    if (!existsSync(installPath) || lstatSync(installPath).isSymbolicLink()) {
      fail(`${name} is not a materialized tarball install`);
    }
  }

  // Installation may use the network. Generation itself must not.
  run(process.execPath, ['generate.mjs'], {
    cwd: appRoot,
    env: { ...process.env, npm_config_offline: 'true' },
  });
  const cli = join(appRoot, 'node_modules', '.bin', 'snapback-app');
  chmodSync(cli, 0o755);
  const introspection = JSON.parse(run(cli, [
    '--artifacts', join(backendRoot, 'generated'), 'introspect',
  ], { cwd: appRoot }));
  if (introspection.appId !== 'partitime-external') fail(`unexpected CLI app id ${introspection.appId}`);
  if (!introspection.functions.some((entry) => entry.name === 'createEvent')) {
    fail('packaged CLI did not discover Partitime createEvent');
  }
  const developerCli = join(appRoot, 'node_modules', '.bin', 'snapback');
  chmodSync(developerCli, 0o755);
  const doctor = JSON.parse(run(developerCli, ['doctor', '--json'], { cwd: appRoot }));
  if (
    !doctor.ok
    || doctor.probe !== 'vertical-slice'
    || doctor.checks?.[0]?.code !== 'SNAPBACK_RUNTIME_LAUNCH_OK'
    || !doctor.checks.some((check) => check.code === 'SNAPBACK_DOCTOR_BUNDLE_LOAD_OK')
    || !doctor.checks.some((check) => check.code === 'SNAPBACK_DOCTOR_QUERY_OK')
    || !doctor.checks.some((check) => check.code === 'SNAPBACK_DOCTOR_MUTATION_OK')
    || !doctor.checks.some((check) => check.code === 'SNAPBACK_DOCTOR_LIVE_OK')
    || !doctor.checks.some((check) => check.code === 'SNAPBACK_DOCTOR_SHUTDOWN_OK')
  ) {
    fail(`packaged runtime doctor failed: ${JSON.stringify(doctor)}`);
  }
  const scaffoldRoot = join(appRoot, 'todo-contract');
  run(developerCli, ['new', scaffoldRoot, '--template', 'todo-contract', '--json'], { cwd: appRoot });
  const scaffoldManifestPath = join(scaffoldRoot, 'package.json');
  const scaffoldManifest = JSON.parse(readFileSync(scaffoldManifestPath, 'utf8'));
  for (const name of Object.keys(scaffoldManifest.dependencies ?? {})) {
    if (dependencies[name]) scaffoldManifest.dependencies[name] = dependencies[name];
  }
  writeFileSync(scaffoldManifestPath, `${JSON.stringify(scaffoldManifest, null, 2)}\n`);
  writeFileSync(
    join(scaffoldRoot, '.npmrc'),
    `registry=${PUBLIC_NPM_REGISTRY}\n@ccheever:registry=${installRegistry}\n`,
  );
  await runAsyncOrFail('npm', [
    'install',
    '--no-audit',
    '--no-fund',
    '--registry', PUBLIC_NPM_REGISTRY,
    ...tarballs,
  ], {
    cwd: scaffoldRoot,
    timeout: 360_000,
  });
  run(join(scaffoldRoot, 'node_modules', '.bin', 'snapback'), ['generate', 'snapback', '--json'], {
    cwd: scaffoldRoot,
    env: { ...process.env, npm_config_offline: 'true' },
  });
  run(process.execPath, ['acceptance.mjs'], { cwd: scaffoldRoot });
  run('git', ['init', '--quiet'], { cwd: scaffoldRoot });
  run('git', ['add', 'package.json', 'package-lock.json', 'acceptance.mjs', 'snapback'], { cwd: scaffoldRoot });
  run('git', [
    '-c', 'user.name=Snapback Package Proof',
    '-c', 'user.email=snapback-package-proof@example.invalid',
    'commit', '--quiet', '-m', 'cold install release fixture',
  ], { cwd: scaffoldRoot });
  const deployBuild = JSON.parse(run(
    join(scaffoldRoot, 'node_modules', '.bin', 'snapback'),
    [
      'deploy', 'build', 'snapback',
      '--target-profile', 'local-dev-sqlite-ibex',
      '--output', join(temporary, 'release-proof'),
      '--allow-dirty',
      '--json',
    ],
    { cwd: scaffoldRoot, env: { ...process.env, npm_config_offline: 'true' } },
  ));
  if (
    !deployBuild.ok
    || deployBuild.schemaVersion !== 'snapback.deploy-build.v1'
    || deployBuild.activationEligible !== false
    || deployBuild.componentCount < 1
    || !deployBuild.gaps?.some((gap) => gap.id === 'control-plane.backup-restore' && gap.blocking === true)
    || !existsSync(deployBuild.manifestPath)
  ) {
    fail(`packaged deploy build did not retain a verified fail-closed release: ${JSON.stringify(deployBuild)}`);
  }
  await provePackagedDevLoop({
    cli: join(scaffoldRoot, 'node_modules', '.bin', 'snapback'),
    scaffoldRoot,
  });

  // @ref LLP 0102#exact-executable-gate — the React release proof installs
  // materialized package tarballs in fresh web and Expo projects. Repository
  // workspaces and source-tree resolution cannot satisfy this gate.
  const installPackedFixture = async (fixtureRoot) => {
    const manifestPath = join(fixtureRoot, 'package.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      if (dependencies[name]) manifest.dependencies[name] = dependencies[name];
    }
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    writeFileSync(
      join(fixtureRoot, '.npmrc'),
      `registry=${PUBLIC_NPM_REGISTRY}\n@ccheever:registry=${installRegistry}\n`,
    );
    await runAsyncOrFail('npm', [
      'install',
      '--no-audit',
      '--no-fund',
      '--registry', PUBLIC_NPM_REGISTRY,
      ...tarballs,
    ], {
      cwd: fixtureRoot,
      timeout: 360_000,
    });
    for (const name of ['@snapback/client', '@snapback/react']) {
      const installed = join(fixtureRoot, 'node_modules', ...name.split('/'));
      if (!existsSync(installed) || lstatSync(installed).isSymbolicLink()) {
        fail(`${fixtureRoot}: ${name} is not a materialized tarball install`);
      }
      const resolved = realpathSync(installed);
      if (resolved.startsWith(join(root, 'packages'))) {
        fail(`${fixtureRoot}: ${name} resolved back into the repository source tree`);
      }
    }
    const packageText = readFileSync(manifestPath, 'utf8');
    const lockText = readFileSync(join(fixtureRoot, 'package-lock.json'), 'utf8');
    if (packageText.includes('workspace:') || lockText.includes('workspace:')) {
      fail(`${fixtureRoot}: packed fixture retains a workspace alias`);
    }
  };

  const reactScaffoldRoot = join(appRoot, 'react-starter');
  run(developerCli, ['new', reactScaffoldRoot, '--template', 'react', '--json'], { cwd: appRoot });
  await installPackedFixture(reactScaffoldRoot);
  run(
    join(reactScaffoldRoot, 'node_modules', '.bin', 'snapback'),
    ['generate', 'snapback', '--json'],
    { cwd: reactScaffoldRoot, env: { ...process.env, npm_config_offline: 'true' } },
  );
  run('npm', ['run', 'typecheck'], { cwd: reactScaffoldRoot });
  run('npm', ['test'], { cwd: reactScaffoldRoot });
  run('npm', ['run', 'build'], { cwd: reactScaffoldRoot });
  run('npm', ['run', 'test:live'], { cwd: reactScaffoldRoot, timeout: 120_000 });

  const expoFixtureRoot = join(appRoot, 'react-expo');
  cpSync(
    join(root, 'packages', 'snapback-react', 'fixtures', 'packed-expo'),
    expoFixtureRoot,
    { recursive: true },
  );
  await installPackedFixture(expoFixtureRoot);
  run(
    join(expoFixtureRoot, 'node_modules', '.bin', 'snapback'),
    ['generate', 'snapback', '--json'],
    { cwd: expoFixtureRoot, env: { ...process.env, npm_config_offline: 'true' } },
  );
  run('npm', ['run', 'typecheck'], { cwd: expoFixtureRoot });
  run('npm', ['run', 'export:ios'], { cwd: expoFixtureRoot, timeout: 240_000 });

  run(process.execPath, ['bundle.mjs'], { cwd: appRoot });
  const browserBundle = readFileSync(join(appRoot, 'dist', 'browser-entry.js'), 'utf8');
  if (/\bnode:/.test(browserBundle)) fail('browser adapter bundle contains a Node builtin import');

  const tree = JSON.parse(run('npm', ['ls', '--all', '--json'], { cwd: appRoot }));
  const cleanMachine = process.env.GITHUB_ACTIONS === 'true'
    && process.env.RUNNER_ENVIRONMENT === 'github-hosted';
  const receipt = {
    schemaVersion: 'snapback.package-cold-install.v1',
    ok: true,
    claimTreatment: 'checkpoint',
    claimSatisfied: false,
    platformClaimSatisfied: installSource === 'public' && cleanMachine,
    sourceRevision: ledger.revision,
    sourceDirty: ledger.sourceDirty,
    publicationMode: ledger.mode,
    installSource,
    registry: installSource === 'public' ? registry : 'disposable-loopback',
    scopePreset: ledger.scopePreset,
    version: ledger.version,
    machine: {
      platform: process.platform,
      architecture: process.arch,
      osRelease: osRelease(),
      nodeVersion: process.version,
      runtimePackage: hostRuntime,
      runnerEnvironment: process.env.RUNNER_ENVIRONMENT ?? 'local',
      separatelyProvisionedCleanMachine: cleanMachine,
      githubRunId: process.env.GITHUB_RUN_ID ?? null,
      githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
      githubRepository: process.env.GITHUB_REPOSITORY ?? null,
      githubWorkflowSha: process.env.GITHUB_SHA ?? null,
    },
    packages: ledger.packages.map((entry) => ({
      sourceName: entry.sourceName,
      publishedName: entry.name,
      version: entry.version,
      tarball: entry.tarball,
      sha256: entry.sha256,
      registrySha256: entry.registrySha256 ?? null,
    })),
    deployBuild: {
      releaseId: deployBuild.releaseId,
      targetProfileId: deployBuild.targetProfileId,
      activationEligible: deployBuild.activationEligible,
      componentCount: deployBuild.componentCount,
      gapCount: deployBuild.gaps.length,
    },
    checks: {
      materializedTarballInstall: true,
      stagedRegistryAliasResolution: installSource === 'staged',
      publicRegistryAliasResolution: installSource === 'public',
      publicRegistryTarballDigestMatch: installSource === 'public',
      registryTarballCount: registryTarballs.length,
      noSiblingSourceCheckout: true,
      partitimeBackendBuilt: true,
      localCodegenOffline: true,
      remoteCodegenOffline: true,
      bundledSchemasAndCorpus: true,
      repositoryRelativePublicationPaths: true,
      packagedCliIntrospection: true,
      packagedRuntimeDoctor: true,
      packagedScaffoldAndOfflineGenerate: true,
      packagedDeployBuildAndVerify: true,
      packagedManagedDevReadyAttachWatchAndStop: true,
      packedReactWebTypecheckTestBuildAndLiveAcceptance: true,
      packedReactExpoTypecheckAndIosExport: true,
      browserAdapterBundle: true,
      resolvedDependencyCount: Object.keys(tree.dependencies ?? {}).length,
      browserBundleBytes: Buffer.byteLength(browserBundle),
    },
    nonclaims: [
      ...(installSource === 'public' ? [] : [{
        id: 'public-registry-install',
        reason: 'The proof resolves the exact public aliases through a disposable loopback npm registry backed by immutable tarballs; the packages are not yet published in a public registry.',
      }]),
      ...(cleanMachine ? [] : [{
        id: 'separately-provisioned-clean-machine',
        reason: 'The proof uses a fresh external directory on the development host, not a separately provisioned clean machine.',
      }]),
      {
        id: 'other-runtime-platforms-not-executed',
        reason: `This receipt launches ${hostPlatform}; every other retained runtime package requires its own clean machine proof.`,
      },
    ],
  };
  const rendered = `${JSON.stringify(receipt, null, 2)}\n`;
  if (receiptPath) writeFileSync(resolve(receiptPath), rendered);
  process.stdout.write(rendered);
} finally {
  if (stagedRegistry) await stagedRegistry.close();
  if (keep) console.error(`kept ${temporary}`);
  else rmSync(temporary, { recursive: true, force: true });
}
