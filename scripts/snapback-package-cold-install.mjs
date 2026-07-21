#!/usr/bin/env node

// @ref LLP 0041#acceptance — prove the published package closure from a fresh
// external project: tarball install, offline codegen, packaged CLI discovery,
// remote publication, and a browser-only adapter bundle.
// @ref LLP 0063#workstream-6--reduce-snapbacks-declaration-and-runtime-tax —
// repository-local imports and sibling source checkouts are forbidden here.

import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
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
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const valueAfter = (flag, fallback = null) => {
  const index = args.indexOf(flag);
  return index === -1 ? fallback : args[index + 1] ?? fallback;
};
const ledgerPath = resolve(valueAfter('--ledger', join(root, 'dist-publish', 'publish-ledger.json')));
const receiptPath = valueAfter('--receipt');
const keep = args.includes('--keep');

function fail(message) {
  console.error(`snapback-package-cold-install: ${message}`);
  process.exit(1);
}

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

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

async function provePackagedDevLoop({ cli, scaffoldRoot }) {
  const readyFile = join(scaffoldRoot, '.snapback', 'dev.ready.json');
  const database = join(scaffoldRoot, '.snapback', 'dev.sqlite3');
  const functionsPath = join(scaffoldRoot, 'snapback', 'functions.mjs');
  const child = spawn(cli, ['dev', 'snapback'], {
    cwd: scaffoldRoot,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
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
      fail(`mismatched attach did not fail closed: ${mismatch.stdout}\n${mismatch.stderr}`);
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
const tarballs = [];
for (const entry of ledger.packages ?? []) {
  const tarball = join(ledgerDirectory, entry.tarball);
  if (!existsSync(tarball)) fail(`tarball is missing: ${tarball}`);
  if (sha256(tarball) !== entry.sha256) fail(`tarball digest mismatch: ${entry.tarball}`);
  dependencies[entry.sourceName] = `file:${tarball}`;
  tarballs.push(tarball);
}

const expectedPackages = [
  '@snapback/runtime-darwin-arm64',
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
  run('npm', ['install', '--no-audit', '--no-fund', ...tarballs], { cwd: appRoot, timeout: 360_000 });
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
  if (!doctor.ok || doctor.checks?.[0]?.code !== 'SNAPBACK_RUNTIME_LAUNCH_OK') {
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
  run('npm', ['install', '--no-audit', '--no-fund', ...tarballs], { cwd: scaffoldRoot, timeout: 360_000 });
  run(join(scaffoldRoot, 'node_modules', '.bin', 'snapback'), ['generate', 'snapback', '--json'], {
    cwd: scaffoldRoot,
    env: { ...process.env, npm_config_offline: 'true' },
  });
  run(process.execPath, ['acceptance.mjs'], { cwd: scaffoldRoot });
  await provePackagedDevLoop({
    cli: join(scaffoldRoot, 'node_modules', '.bin', 'snapback'),
    scaffoldRoot,
  });
  run(process.execPath, ['bundle.mjs'], { cwd: appRoot });
  const browserBundle = readFileSync(join(appRoot, 'dist', 'browser-entry.js'), 'utf8');
  if (/\bnode:/.test(browserBundle)) fail('browser adapter bundle contains a Node builtin import');

  const tree = JSON.parse(run('npm', ['ls', '--all', '--json'], { cwd: appRoot }));
  const receipt = {
    schemaVersion: 'snapback.package-cold-install.v1',
    ok: true,
    sourceRevision: ledger.revision,
    sourceDirty: ledger.sourceDirty,
    scopePreset: ledger.scopePreset,
    version: ledger.version,
    packages: ledger.packages.map((entry) => ({
      sourceName: entry.sourceName,
      publishedName: entry.name,
      version: entry.version,
      tarball: entry.tarball,
      sha256: entry.sha256,
    })),
    checks: {
      materializedTarballInstall: true,
      noSiblingSourceCheckout: true,
      partitimeBackendBuilt: true,
      localCodegenOffline: true,
      remoteCodegenOffline: true,
      bundledSchemasAndCorpus: true,
      repositoryRelativePublicationPaths: true,
      packagedCliIntrospection: true,
      packagedRuntimeDoctor: true,
      packagedScaffoldAndOfflineGenerate: true,
      packagedManagedDevReadyAttachWatchAndStop: true,
      browserAdapterBundle: true,
      resolvedDependencyCount: Object.keys(tree.dependencies ?? {}).length,
      browserBundleBytes: Buffer.byteLength(browserBundle),
    },
  };
  const rendered = `${JSON.stringify(receipt, null, 2)}\n`;
  if (receiptPath) writeFileSync(resolve(receiptPath), rendered);
  process.stdout.write(rendered);
} finally {
  if (keep) console.error(`kept ${temporary}`);
  else rmSync(temporary, { recursive: true, force: true });
}
