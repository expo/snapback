#!/usr/bin/env node

// @ref LLP 0110#single-table-public-package-advertisement-amendment--2026-08-06
// — qualify one immutable packaged closure before minting its binary/carrier-
// bound single_table_v1 advertisement receipt.
// @ref LLP 0166#public-package-advertisement-amendment--2026-08-06 — the
// bootstrap run is visibly qualification-only and must prove retained render.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
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

const RECEIPT_ENV = 'SNAPBACK_PACKAGED_STORE_QUALIFICATION_RECEIPT';
const MODE_ENV = 'SNAPBACK_PACKAGED_STORE_QUALIFICATION_MODE';
const RECEIPT_FILE = 'packaged-store-qualification.receipt.json';
const SUITE_ID = 'packaged-store-qualification-v1';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function usage() {
  return `Usage: node scripts/packaged-store-qualification.mjs [options]

Options:
  --staged-dir <dir>       Directory containing the staged *.tgz closure
                           (default: dist-publish)
  --runtime-binary <path>  Clean public-package release snapback binary
                           (default: SNAPBACK_RUNTIME_BINARY or target/release/snapback)
  --keep                   Keep the temporary cold-install application
  -h, --help               Print this help
`;
}

function parseArguments(argv) {
  const parsed = {
    stagedDir: join(root, 'dist-publish'),
    runtimeBinary: process.env.SNAPBACK_RUNTIME_BINARY ?? join(root, 'target', 'release', 'snapback'),
    keep: false,
    help: false,
  };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '-h' || argument === '--help') {
      if (seen.has('help')) throw new TypeError('duplicate --help');
      seen.add('help');
      parsed.help = true;
      continue;
    }
    if (argument === '--keep') {
      if (seen.has('keep')) throw new TypeError('duplicate --keep');
      seen.add('keep');
      parsed.keep = true;
      continue;
    }
    if (argument === '--staged-dir' || argument === '--runtime-binary') {
      if (seen.has(argument)) throw new TypeError(`duplicate ${argument}`);
      seen.add(argument);
      const value = argv[++index];
      if (!value || value.startsWith('-')) throw new TypeError(`${argument} requires a path`);
      parsed[argument === '--staged-dir' ? 'stagedDir' : 'runtimeBinary'] = value;
      continue;
    }
    throw new TypeError(`unrecognized argument: ${argument}`);
  }
  return parsed;
}

function cleanRuntimeEnvironment(extra = {}) {
  const environment = { ...process.env };
  delete environment[RECEIPT_ENV];
  delete environment[MODE_ENV];
  for (const key of Object.keys(environment)) {
    if (key.startsWith('DYLD_') || key === 'LD_LIBRARY_PATH') delete environment[key];
  }
  return { ...environment, ...extra };
}

const sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

async function startRuntime({ binary, stateRoot, label, environment }) {
  mkdirSync(stateRoot, { recursive: true });
  const readyFile = join(stateRoot, `${label}.ready.json`);
  const database = join(stateRoot, `${label}.sqlite3`);
  rmSync(readyFile, { force: true });
  const child = spawn(binary, ['start', '--port', '0', '--ready-file', readyFile, '--db', database], {
    cwd: stateRoot,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-16_000); });
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-16_000); });
  const deadline = Date.now() + 30_000;
  while (!existsSync(readyFile)) {
    if (child.exitCode !== null) {
      throw new Error(`${label} runtime exited ${child.exitCode}\n${stderr || stdout}`);
    }
    if (Date.now() >= deadline) {
      child.kill('SIGTERM');
      throw new Error(`${label} runtime did not publish readiness\n${stderr || stdout}`);
    }
    await sleep(50);
  }
  const descriptor = JSON.parse(readFileSync(readyFile, 'utf8'));
  assert.equal(descriptor.ready, true, `${label} readiness`);
  assert.equal(typeof descriptor.serverUrl, 'string', `${label} server URL`);
  const adminToken = descriptor.adminTokenFile
    ? readFileSync(descriptor.adminTokenFile, 'utf8').trim()
    : environment.SNAPBACK_ADMIN_TOKEN;
  assert(adminToken, `${label} admin token`);
  return {
    adminToken,
    baseUrl: descriptor.serverUrl,
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

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function assertAdvertised(manifest, { qualificationMode }) {
  assert.equal(manifest.targetProfileId, 'local-dev-sqlite-ibex');
  assert.equal(manifest.supportedCapabilities.includes('single_table_v1'), true);
  assert.equal(manifest.capabilityGaps.includes('single_table_v1'), false);
  assert.equal(
    manifest.packagedStoreQualificationMode === true,
    qualificationMode,
    'qualification-mode honesty marker',
  );
  if (!qualificationMode) {
    assert.equal(
      Object.hasOwn(manifest, 'packagedStoreQualificationMode'),
      false,
      'receipt-backed production manifest omits the qualification marker',
    );
  }
}

async function closeLive(handle) {
  if (!handle) return;
  handle.dispose();
  await handle.settled?.();
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }
  const stagedDir = resolve(args.stagedDir);
  const runtimeBinary = resolve(args.runtimeBinary);
  for (const [label, path, directory] of [
    ['staged directory', stagedDir, true],
    ['runtime binary', runtimeBinary, false],
  ]) {
    const metadata = lstatSync(path);
    assert.equal(directory ? metadata.isDirectory() : metadata.isFile(), true, `${label}: ${path}`);
    assert.equal(metadata.isSymbolicLink(), false, `${label} must not be a symlink`);
  }

  const temporary = mkdtempSync(join(tmpdir(), 'snapback-packaged-store-qualification-'));
  const appRoot = join(temporary, 'app');
  const backendRoot = join(appRoot, 'snapback');
  const generatedRoot = join(backendRoot, 'generated');
  const stateRoot = join(temporary, 'runtime');
  const storeRoot = join(temporary, 'store');
  mkdirSync(backendRoot, { recursive: true });
  writeFileSync(join(appRoot, 'package.json'), `${JSON.stringify({
    name: 'snapback-packaged-store-qualification-app',
    private: true,
    type: 'module',
  }, null, 2)}\n`);

  let activeRuntime = null;
  let activeLive = null;
  let activeStore = null;
  const suite = { id: SUITE_ID, pass: 0, fail: 0, skipped: 0 };
  const failures = [];
  const check = async (name, operation) => {
    try {
      await operation();
      suite.pass += 1;
    } catch (error) {
      suite.fail += 1;
      failures.push({ name, message: error?.stack ?? String(error) });
    }
  };

  try {
    const installed = await coldInstallStagedPackageClosure({
      stagedDir,
      appDir: appRoot,
      environment: {
        ...process.env,
        npm_config_audit: 'false',
        npm_config_cache: join(temporary, 'npm-cache'),
        npm_config_fund: 'false',
      },
    });
    writeFileSync(join(backendRoot, 'schema.mjs'), `
import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';
export default defineSchema({
  items: defineTable({ bucket: v.string(), label: v.string() })
    // @ref LLP 0234#phase-g2--d2-enforcing-closure — this synthetic
    // qualification probe serves anonymous public functions only, so every
    // row is public by design.
    .visibility({ kind: 'public-read' })
    .index('by_bucket', ['bucket'])
    .sync(),
});
`);
    writeFileSync(join(backendRoot, 'functions.mjs'), `
import {
  arg, defineLiveQuery, defineMutation, eq, insert, returnBinding, v,
} from '@expo/snapback-codegen/define';
export const retainedItems = defineLiveQuery({
  table: 'items',
  args: { bucket: v.string() },
  filter: [eq('bucket', arg('bucket'))],
  index: 'by_bucket',
  auth: 'public',
  authorityIndependent: true,
});
export const addItem = defineMutation({
  args: { bucket: v.string(), label: v.string() },
  plan: insert('items', { bucket: arg('bucket'), label: arg('label') }, { bindIdAs: 'itemId' }),
  returns: returnBinding('itemId'),
});
`);
    writeFileSync(join(backendRoot, 'seed.json'), `${JSON.stringify({
      tables: { items: [{ _id: 'seed_item', bucket: 'qualified', label: 'seed' }] },
    }, null, 2)}\n`);

    const codegen = await import(pathToFileURL(join(
      appRoot,
      'node_modules',
      '@expo',
      'snapback-codegen',
      'index.mjs',
    )).href);
    const generated = await codegen.generate(backendRoot);
    assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
    const clientPackage = await import(pathToFileURL(join(
      appRoot,
      'node_modules',
      '@expo',
      'snapback-client',
      'index.mjs',
    )).href);
    const { SnapbackClient, createFileRqsResumeStore } = clientPackage;
    const api = (await import(`${pathToFileURL(join(generatedRoot, 'api.mjs')).href}?qualification`)).default;
    const schema = readJson(join(generatedRoot, 'schema.manifest.json'));
    const functions = readJson(join(generatedRoot, 'functions.manifest.json'));
    const seed = readJson(join(backendRoot, 'seed.json'));
    assert.equal(
      functions.acknowledgedExperimentalCapabilities?.includes('single_table_v1'),
      true,
      'generated artifact acknowledges single_table_v1',
    );

    activeRuntime = await startRuntime({
      binary: runtimeBinary,
      stateRoot,
      label: 'qualification-mode',
      environment: cleanRuntimeEnvironment({ [MODE_ENV]: '1' }),
    });
    activeStore = createFileRqsResumeStore({
      directory: storeRoot,
      clientStoreId: 'packaged-store-qualification-v1',
    });
    const qualificationClient = new SnapbackClient(activeRuntime.baseUrl, {
      adminToken: activeRuntime.adminToken,
      rqsStore: activeStore,
    });

    await check('qualification manifest advertises single_table_v1 with honesty marker', async () => {
      const inspection = await qualificationClient.inspect();
      assertAdvertised(inspection.capabilityManifest, { qualificationMode: true });
    });
    await check('packaged artifact admits and live subscription observes inserted rows', async () => {
      await qualificationClient.ensureApp({ schema, functions, seed });
      activeLive = await qualificationClient.liveQuery(api.retainedItems, {
        connectionId: 'packaged-store-qualification-live',
        args: { bucket: 'qualified' },
        persistResume: true,
      });
      assert.deepEqual(activeLive.rows.map((row) => row.label), ['seed']);
      await qualificationClient.mutate(api.addItem, {
        args: { bucket: 'qualified', label: 'inserted' },
      });
      const rows = await activeLive.poll();
      assert.deepEqual(rows.map((row) => row.label).sort(), ['inserted', 'seed']);
      assert.equal(activeLive.retention?.retainable, true);
      assert(activeLive.rqsResume?.token, 'server minted a resume token');
      await activeLive.flushResumeState();
    });
    await closeLive(activeLive);
    activeLive = null;
    await activeStore.close?.();
    activeStore = null;
    const qualificationOrigin = activeRuntime.baseUrl;
    await activeRuntime.stop();
    activeRuntime = null;

    await check('fresh file-store client renders retained rows with runtime stopped', async () => {
      activeStore = createFileRqsResumeStore({
        directory: storeRoot,
        clientStoreId: 'packaged-store-qualification-v1',
      });
      const offlineClient = new SnapbackClient(qualificationOrigin, { rqsStore: activeStore });
      activeLive = await offlineClient.liveQuery(api.retainedItems, {
        connectionId: 'packaged-store-qualification-offline',
        args: { bucket: 'qualified' },
      });
      assert.equal(activeLive.freshness, 'retained');
      assert.deepEqual(activeLive.rows.map((row) => row.label).sort(), ['inserted', 'seed']);
    });
    await closeLive(activeLive);
    activeLive = null;
    await activeStore.close?.();
    activeStore = null;

    if (suite.fail !== 0 || suite.skipped !== 0 || suite.pass === 0) {
      throw new Error(`qualification suite failed: ${JSON.stringify({ suite, failures })}`);
    }
    const closureManifest = join(temporary, 'package-closure.json');
    const suiteResult = join(temporary, 'suite-result.json');
    writeFileSync(closureManifest, `${JSON.stringify(installed.packageClosure, null, 2)}\n`);
    writeFileSync(suiteResult, `${JSON.stringify(suite, null, 2)}\n`);
    const receipt = join(dirname(runtimeBinary), RECEIPT_FILE);
    const mint = spawnSync(runtimeBinary, [
      'packaged-store-qualification-receipt',
      '--closure-manifest', closureManifest,
      '--suite-result', suiteResult,
      '--out', receipt,
    ], {
      encoding: 'utf8',
      env: cleanRuntimeEnvironment(),
      timeout: 30_000,
    });
    if (mint.status !== 0) {
      throw new Error(`receipt mint failed (${mint.status}): ${mint.stderr || mint.stdout}`);
    }
    assert.equal(existsSync(receipt), true, 'minted receipt exists adjacent to runtime');

    activeRuntime = await startRuntime({
      binary: runtimeBinary,
      stateRoot,
      label: 'receipt-backed',
      environment: cleanRuntimeEnvironment({ [RECEIPT_ENV]: receipt }),
    });
    const receiptClient = new SnapbackClient(activeRuntime.baseUrl, {
      adminToken: activeRuntime.adminToken,
      rqsStore: null,
    });
    assertAdvertised((await receiptClient.inspect()).capabilityManifest, {
      qualificationMode: false,
    });
    await receiptClient.ensureApp({ schema, functions, seed });
    await activeRuntime.stop();
    activeRuntime = null;

    activeRuntime = await startRuntime({
      binary: runtimeBinary,
      stateRoot,
      label: 'unqualified-negative',
      environment: cleanRuntimeEnvironment(),
    });
    const negativeClient = new SnapbackClient(activeRuntime.baseUrl, {
      adminToken: activeRuntime.adminToken,
      rqsStore: null,
    });
    const negativeManifest = (await negativeClient.inspect()).capabilityManifest;
    assert.equal(negativeManifest.supportedCapabilities.includes('single_table_v1'), false);
    assert.equal(negativeManifest.capabilityGaps.includes('single_table_v1'), true);
    assert.equal(Object.hasOwn(negativeManifest, 'packagedStoreQualificationMode'), false);
    await assert.rejects(
      negativeClient.ensureApp({ schema, functions, seed }),
      (error) => error?.diagnostic?.code === 'SNAPBACK_CAPABILITY_UNSUPPORTED',
      'artifact admission must refuse without qualification mode or receipt',
    );
    await activeRuntime.stop();
    activeRuntime = null;

    console.log(JSON.stringify({
      schemaVersion: 'snapback.packaged-store-qualification-run.v1',
      ok: true,
      suite,
      packages: installed.packageClosure.length,
      receipt,
      temporary: args.keep ? temporary : null,
    }));
  } finally {
    await closeLive(activeLive).catch(() => {});
    if (activeStore?.close) await activeStore.close().catch(() => {});
    await activeRuntime?.stop().catch(() => {});
    if (!args.keep) rmSync(temporary, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  console.error(error?.stack ?? String(error));
  console.log(JSON.stringify({
    schemaVersion: 'snapback.packaged-store-qualification-run.v1',
    ok: false,
    error: error?.message ?? String(error),
  }));
  process.exitCode = 1;
}
