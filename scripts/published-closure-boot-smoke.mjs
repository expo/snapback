#!/usr/bin/env node

// @ref LLP 0041#fast-path-pre-consumer-release-2026-08-01 — the fast path
// proves the exact registry closure outside the checkout before latest moves.
// @ref LLP 0166#public-package-advertisement-amendment--2026-08-06 — booting
// must observe the receipt-backed single_table_v1 advertisement, not merely
// the presence of an inert receipt file.

import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import { validateAdminConsoleSnapshot } from '../packages/snapback-cli/admin-snapshot.mjs';
import { assertCodegenRuntimeCapabilityCoherence } from './publication-store-qualification-gate.mjs';

const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const RECEIPT_SCHEMA_VERSION = 'snapback.packaged-store-qualification.v1';
const RECEIPT_CAPABILITY_ID = 'single_table_v1';
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const CHILD_OUTPUT_BYTES = 32 * 1024;
const INSTALL_PACKAGES = [
  '@expo/snapback-cli',
  '@expo/snapback-codegen',
  '@expo/snapback-client',
  '@expo/snapback-contract',
];
const RUNTIME_PACKAGES = new Map([
  ['darwin-arm64', '@expo/snapback-runtime-darwin-arm64'],
  ['linux-x64', '@expo/snapback-runtime-linux-x64'],
]);
const EXACT_SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*|0|[1-9]\d*)(?:\.(?:[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*|0|[1-9]\d*))*)?$/u;

function codedError(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function takeValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) {
    throw codedError('SNAPBACK_PUBLISHED_SMOKE_ARGUMENT_INVALID', `${flag} requires a value`);
  }
  return value;
}

export function parseArguments(argv) {
  const options = {
    version: null,
    registry: DEFAULT_REGISTRY,
    out: null,
    keep: false,
    help: false,
  };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--keep' || argument === '--help' || argument === '-h') {
      const key = argument === '-h' ? '--help' : argument;
      if (seen.has(key)) {
        throw codedError('SNAPBACK_PUBLISHED_SMOKE_ARGUMENT_INVALID', `duplicate ${key}`);
      }
      seen.add(key);
      if (key === '--keep') options.keep = true;
      else options.help = true;
      continue;
    }
    if (['--version', '--registry', '--out'].includes(argument)) {
      if (seen.has(argument)) {
        throw codedError('SNAPBACK_PUBLISHED_SMOKE_ARGUMENT_INVALID', `duplicate ${argument}`);
      }
      seen.add(argument);
      const value = takeValue(argv, index, argument);
      index += 1;
      if (argument === '--version') options.version = value;
      else if (argument === '--registry') options.registry = value;
      else options.out = resolve(value);
      continue;
    }
    throw codedError(
      'SNAPBACK_PUBLISHED_SMOKE_ARGUMENT_INVALID',
      `unrecognized argument: ${argument}`,
    );
  }
  if (!options.help) {
    if (options.version === null) {
      throw codedError('SNAPBACK_PUBLISHED_SMOKE_ARGUMENT_INVALID', '--version is required');
    }
    if (!EXACT_SEMVER.test(options.version)) {
      throw codedError(
        'SNAPBACK_PUBLISHED_SMOKE_ARGUMENT_INVALID',
        `--version must be an exact semantic version, observed ${options.version}`,
      );
    }
    let registry;
    try {
      registry = new URL(options.registry);
    } catch {
      throw codedError('SNAPBACK_PUBLISHED_SMOKE_ARGUMENT_INVALID', '--registry must be a URL');
    }
    if (!['http:', 'https:'].includes(registry.protocol)) {
      throw codedError('SNAPBACK_PUBLISHED_SMOKE_ARGUMENT_INVALID', '--registry must use http or https');
    }
    options.registry = registry.href.replace(/\/$/u, '');
  }
  return options;
}

export function validateRuntimeReceiptShape(receipt) {
  if (receipt?.schemaVersion !== RECEIPT_SCHEMA_VERSION
      || receipt?.capabilityId !== RECEIPT_CAPABILITY_ID) {
    throw codedError(
      'SNAPBACK_PUBLISHED_SMOKE_RECEIPT_ABSENT',
      `installed runtime receipt must have schemaVersion '${RECEIPT_SCHEMA_VERSION}' and capabilityId '${RECEIPT_CAPABILITY_ID}'`,
    );
  }
  return receipt;
}

// @ref LLP 0017#validation-requirements — the installed-closure smoke must prove
// the real console route serves the exact index sealed into the runtime
// package, rather than accepting the source-only missing-dist diagnostic.
export async function validateAdminConsoleResponse({ response, manifest }) {
  if (response?.status !== 200) {
    throw codedError(
      'SNAPBACK_PUBLISHED_SMOKE_CAPABILITY_UNADVERTISED',
      `installed admin console returned HTTP ${response?.status ?? 'unknown'}`,
    );
  }
  const contentType = response.headers?.get?.('content-type') ?? '';
  if (!contentType.toLowerCase().includes('text/html')) {
    throw codedError(
      'SNAPBACK_PUBLISHED_SMOKE_CAPABILITY_UNADVERTISED',
      `installed admin console returned non-HTML content type '${contentType}'`,
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const text = bytes.toString('utf8');
  if (text.includes('SNAPBACK_CAPABILITY_EXACT_ADMIN_DIST_MISSING')) {
    throw codedError(
      'SNAPBACK_PUBLISHED_SMOKE_CAPABILITY_UNADVERTISED',
      'installed admin console returned the source-only missing-dist diagnostic',
    );
  }
  const index = manifest?.files?.find((file) => file.path === 'index.html');
  const observedSha256 = createHash('sha256').update(bytes).digest('hex');
  if (!index || index.bytes !== bytes.byteLength || index.sha256 !== observedSha256) {
    throw codedError(
      'SNAPBACK_PUBLISHED_SMOKE_CAPABILITY_UNADVERTISED',
      'installed admin console route did not serve its sealed index.html bytes',
    );
  }
  return { bytes: bytes.byteLength, sha256: observedSha256 };
}

function readBoundedJson(path, code, label) {
  let metadata;
  try {
    metadata = statSync(path);
  } catch (error) {
    throw codedError(code, `${label} is absent at ${path}: ${error.message}`);
  }
  if (!metadata.isFile() || metadata.size > MAX_JSON_BYTES) {
    throw codedError(code, `${label} is not a bounded regular file at ${path}`);
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw codedError(code, `${label} is invalid JSON at ${path}: ${error.message}`);
  }
}

function readBoundedBytes(path, code, label) {
  let metadata;
  try {
    metadata = statSync(path);
  } catch (error) {
    throw codedError(code, `${label} is absent at ${path}: ${error.message}`);
  }
  if (!metadata.isFile() || metadata.size > MAX_JSON_BYTES) {
    throw codedError(code, `${label} is not a bounded regular file at ${path}`);
  }
  return readFileSync(path);
}

const sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

export async function waitForReadyFile({
  readyFile,
  child = null,
  timeoutMs = 120_000,
  pollMs = 50,
}) {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(readyFile)) {
    if (child?.spawnFailure) {
      throw codedError(
        'SNAPBACK_PUBLISHED_SMOKE_BOOT_FAILED',
        `installed CLI could not be spawned: ${child.spawnFailure.message}`,
        { stdout: child.capturedStdout ?? '', stderr: child.capturedStderr ?? '' },
      );
    }
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw codedError(
        'SNAPBACK_PUBLISHED_SMOKE_BOOT_FAILED',
        `installed CLI exited ${child.exitCode} before publishing readiness`,
        {
          status: child.exitCode,
          signal: child.signalCode ?? null,
          stdout: child.capturedStdout ?? '',
          stderr: child.capturedStderr ?? '',
        },
      );
    }
    if (Date.now() >= deadline) {
      throw codedError(
        'SNAPBACK_PUBLISHED_SMOKE_BOOT_FAILED',
        `installed CLI did not publish readiness within ${timeoutMs}ms`,
        {
          status: child?.exitCode ?? null,
          signal: child?.signalCode ?? null,
          stdout: child?.capturedStdout ?? '',
          stderr: child?.capturedStderr ?? '',
        },
      );
    }
    await sleep(pollMs);
  }
  return readBoundedJson(
    readyFile,
    'SNAPBACK_PUBLISHED_SMOKE_BOOT_FAILED',
    'ready file',
  );
}

function appendBounded(current, chunk) {
  return `${current}${chunk}`.slice(-CHILD_OUTPUT_BYTES);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  const closed = new Promise((resolveClose) => child.once('close', resolveClose));
  child.kill('SIGTERM');
  const graceful = await Promise.race([
    closed.then(() => true),
    sleep(10_000).then(() => false),
  ]);
  if (!graceful && child.exitCode === null) {
    child.kill('SIGKILL');
    await closed;
  }
}

function writeBackend(backendRoot) {
  mkdirSync(backendRoot, { recursive: true });
  writeFileSync(join(backendRoot, 'schema.mjs'), `
import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';
export default defineSchema({
  // Anonymous, disposable smoke fixture served by public functions only:
  // public-read is the honest declaration (LLP 0234 G2), matching 18607c046.
  items: defineTable({ bucket: v.string(), label: v.string() })
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
}

function diagnosticOf(error) {
  return {
    code: error?.code ?? 'SNAPBACK_PUBLISHED_SMOKE_CAPABILITY_UNADVERTISED',
    severity: 'error',
    subsystem: 'publish',
    message: error?.message ?? String(error),
    ...(error?.details === undefined ? {} : { details: error.details }),
  };
}

function receiptTemplate({ version, registry, platform, runtimePackage, startedAt }) {
  return {
    schemaVersion: 'snapback.published-closure-boot-smoke.v1',
    ok: false,
    version,
    registry,
    platform,
    startedAt,
    finishedAt: null,
    durationMs: null,
    runtimePackage,
    receiptSha256: null,
    adminSnapshotSha256: null,
    capabilitiesCompared: 0,
    checks: {
      installed: false,
      receiptPresent: false,
      adminSnapshotPresent: false,
      adminBuildMatched: false,
      codegen: false,
      capabilityAcknowledged: false,
      ready: false,
      adminRoute: false,
      capabilityAdvertised: false,
      ensureApp: false,
      liveQuery: false,
    },
    diagnostics: [],
  };
}

async function runSmoke(options) {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const platform = `${process.platform}-${process.arch}`;
  const runtimePackage = RUNTIME_PACKAGES.get(platform) ?? null;
  const receipt = receiptTemplate({
    version: options.version,
    registry: options.registry,
    platform,
    runtimePackage,
    startedAt,
  });
  const temporary = mkdtempSync(join(tmpdir(), 'snapback-published-smoke-'));
  const appRoot = join(temporary, 'app');
  const backendRoot = join(appRoot, 'snapback');
  const readyFile = join(temporary, 'runtime.ready.json');
  const database = join(temporary, 'runtime.sqlite3');
  let child = null;
  let live = null;
  try {
    mkdirSync(appRoot, { recursive: true });
    writeFileSync(join(appRoot, '.npmrc'), `registry=${options.registry}\n`);
    writeFileSync(join(appRoot, 'package.json'), `${JSON.stringify({
      name: 'snapback-published-closure-smoke',
      private: true,
      type: 'module',
    }, null, 2)}\n`);
    const install = spawnSync('npm', [
      'install', '--no-audit', '--no-fund',
      ...INSTALL_PACKAGES.map((name) => `${name}@${options.version}`),
    ], {
      cwd: appRoot,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      timeout: 360_000,
      env: { ...process.env, npm_config_registry: options.registry },
    });
    if (install.error || install.status !== 0) {
      throw codedError(
        'SNAPBACK_PUBLISHED_SMOKE_INSTALL_FAILED',
        `exact published closure install failed (${install.signal ?? install.status ?? install.error?.message})`,
        { stdout: install.stdout?.slice(-CHILD_OUTPUT_BYTES), stderr: install.stderr?.slice(-CHILD_OUTPUT_BYTES) },
      );
    }
    receipt.checks.installed = true;

    if (runtimePackage === null) {
      throw codedError(
        'SNAPBACK_PUBLISHED_SMOKE_RECEIPT_ABSENT',
        `no published runtime package is defined for ${platform}`,
      );
    }
    const runtimeRoot = join(appRoot, 'node_modules', ...runtimePackage.split('/'));
    const runtimeReceiptPath = join(
      runtimeRoot,
      'bin',
      'packaged-store-qualification.receipt.json',
    );
    const runtimeReceiptBytes = readBoundedBytes(
      runtimeReceiptPath,
      'SNAPBACK_PUBLISHED_SMOKE_RECEIPT_ABSENT',
      `installed ${runtimePackage} packaged-store qualification receipt`,
    );
    let runtimeReceipt;
    try {
      runtimeReceipt = JSON.parse(runtimeReceiptBytes.toString('utf8'));
    } catch (error) {
      throw codedError(
        'SNAPBACK_PUBLISHED_SMOKE_RECEIPT_ABSENT',
        `installed ${runtimePackage} receipt is invalid JSON: ${error.message}`,
      );
    }
    validateRuntimeReceiptShape(runtimeReceipt);
    receipt.receiptSha256 = createHash('sha256').update(runtimeReceiptBytes).digest('hex');
    receipt.checks.receiptPresent = true;

    const runtimeReadiness = readBoundedJson(
      join(runtimeRoot, 'runtime-readiness.json'),
      'SNAPBACK_PUBLISHED_SMOKE_RECEIPT_ABSENT',
      `installed ${runtimePackage} runtime readiness receipt`,
    );
    let adminSnapshot;
    try {
      adminSnapshot = validateAdminConsoleSnapshot({
        root: join(runtimeRoot, 'admin'),
        expectedSourceRevision: runtimeReadiness.sourceRevision,
        requireClean: true,
      });
    } catch (error) {
      throw codedError(
        'SNAPBACK_PUBLISHED_SMOKE_CAPABILITY_UNADVERTISED',
        `installed ${runtimePackage} has no clean build-matched admin console: ${error.message}`,
      );
    }
    receipt.adminSnapshotSha256 = adminSnapshot.manifest.snapshotSha256;
    receipt.checks.adminSnapshotPresent = true;
    if (runtimeReadiness.sourceRevision !== runtimeReceipt.binaryIdentity?.gitCommit) {
      throw codedError(
        'SNAPBACK_PUBLISHED_SMOKE_RECEIPT_ABSENT',
        'installed admin console and packaged-store qualification bind different revisions',
      );
    }
    receipt.checks.adminBuildMatched = true;

    writeBackend(backendRoot);
    const codegenPath = join(appRoot, 'node_modules', '@expo', 'snapback-codegen', 'index.mjs');
    let generated;
    let codegenRequiredCapabilities;
    try {
      const codegen = await import(`${pathToFileURL(codegenPath).href}?published-smoke`);
      if (typeof codegen.codegenRequiredTargetCapabilityIdsCanonicalJson !== 'function') {
        throw new Error('installed codegen does not export its publication requirement set');
      }
      codegenRequiredCapabilities = JSON.parse(
        codegen.codegenRequiredTargetCapabilityIdsCanonicalJson(),
      );
      generated = await codegen.generate(backendRoot);
      if (generated?.ok !== true) {
        throw new Error(JSON.stringify(generated?.diagnostics ?? generated));
      }
    } catch (error) {
      throw codedError(
        'SNAPBACK_PUBLISHED_SMOKE_CODEGEN_FAILED',
        `installed codegen failed: ${error.message}`,
      );
    }
    receipt.checks.codegen = true;
    const generatedRoot = join(backendRoot, 'generated');
    const functions = readBoundedJson(
      join(generatedRoot, 'functions.manifest.json'),
      'SNAPBACK_PUBLISHED_SMOKE_CODEGEN_FAILED',
      'generated functions manifest',
    );
    if (!functions.acknowledgedExperimentalCapabilities?.includes('single_table_v1')) {
      throw codedError(
        'SNAPBACK_PUBLISHED_SMOKE_CAPABILITY_NOT_EXERCISED',
        'generated functions manifest does not acknowledge single_table_v1',
      );
    }
    receipt.checks.capabilityAcknowledged = true;

    const cliPath = join(appRoot, 'node_modules', '@expo', 'snapback-cli', 'cli.mjs');
    child = spawn(process.execPath, [
      cliPath,
      'dev', backendRoot,
      '--db', database,
      '--ready-file', readyFile,
      '--json',
    ], {
      cwd: appRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.capturedStdout = '';
    child.capturedStderr = '';
    child.spawnFailure = null;
    child.on('error', (error) => {
      child.spawnFailure = error;
    });
    child.stdout.on('data', (chunk) => {
      child.capturedStdout = appendBounded(child.capturedStdout, chunk);
    });
    child.stderr.on('data', (chunk) => {
      child.capturedStderr = appendBounded(child.capturedStderr, chunk);
    });
    const descriptor = await waitForReadyFile({ readyFile, child });
    if (descriptor?.ready !== true || typeof descriptor?.serverUrl !== 'string') {
      throw codedError(
        'SNAPBACK_PUBLISHED_SMOKE_BOOT_FAILED',
        'installed CLI ready file did not describe a ready server',
      );
    }
    receipt.checks.ready = true;

    const adminResponse = await fetch(
      `${descriptor.serverUrl.replace(/\/$/u, '')}/_snapback/admin/`,
    );
    await validateAdminConsoleResponse({
      response: adminResponse,
      manifest: adminSnapshot.manifest,
    });
    receipt.checks.adminRoute = true;

    try {
      const adminToken = descriptor.adminTokenFile
        ? readBoundedBytes(
          descriptor.adminTokenFile,
          'SNAPBACK_PUBLISHED_SMOKE_CAPABILITY_UNADVERTISED',
          'runtime admin token',
        ).toString('utf8').trim()
        : process.env.SNAPBACK_ADMIN_TOKEN;
      const clientPath = join(appRoot, 'node_modules', '@expo', 'snapback-client', 'index.mjs');
      const { SnapbackClient } = await import(`${pathToFileURL(clientPath).href}?published-smoke`);
      const client = new SnapbackClient(descriptor.serverUrl, { adminToken, rqsStore: null });
      const inspection = await client.inspect();
      const manifest = inspection.capabilityManifest;
      const compared = assertCodegenRuntimeCapabilityCoherence({
        codegenRequiredCapabilities,
        runtimeManifest: manifest,
        platform,
      });
      receipt.capabilitiesCompared = compared.required.length;
      receipt.checks.capabilityAdvertised = true;
      const schema = readBoundedJson(
        join(generatedRoot, 'schema.manifest.json'),
        'SNAPBACK_PUBLISHED_SMOKE_CAPABILITY_UNADVERTISED',
        'generated schema manifest',
      );
      const seed = readBoundedJson(
        join(backendRoot, 'seed.json'),
        'SNAPBACK_PUBLISHED_SMOKE_CAPABILITY_UNADVERTISED',
        'seed',
      );
      await client.ensureApp({ schema, functions, seed });
      receipt.checks.ensureApp = true;
      const api = (await import(
        `${pathToFileURL(join(generatedRoot, 'api.mjs')).href}?published-smoke`
      )).default;
      live = await client.liveQuery(api.retainedItems, {
        connectionId: 'published-closure-smoke-live',
        args: { bucket: 'qualified' },
      });
      if (!Array.isArray(live.rows) || !live.rows.some((row) => row.label === 'seed')) {
        throw new Error('live query did not return the seeded item');
      }
      receipt.checks.liveQuery = true;
    } catch (error) {
      throw codedError(
        'SNAPBACK_PUBLISHED_SMOKE_CAPABILITY_UNADVERTISED',
        `published capability journey was refused: ${error.message}`,
      );
    }
    receipt.ok = true;
  } catch (error) {
    receipt.diagnostics.push(diagnosticOf(error));
  } finally {
    live?.dispose?.();
    await live?.settled?.().catch(() => {});
    await stopChild(child).catch(() => {});
    if (!options.keep) rmSync(temporary, { recursive: true, force: true });
  }
  const finished = Date.now();
  receipt.finishedAt = new Date(finished).toISOString();
  receipt.durationMs = finished - started;
  return { receipt, temporary: options.keep ? temporary : null };
}

function usage() {
  return `usage: node scripts/published-closure-boot-smoke.mjs --version <x.y.z> [--registry <url>] [--out <receipt.json>] [--keep]\n`;
}

const invoked = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  let options;
  let receipt;
  try {
    options = parseArguments(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(usage());
    } else {
      ({ receipt } = await runSmoke(options));
    }
  } catch (error) {
    const now = new Date().toISOString();
    receipt = receiptTemplate({
      version: options?.version ?? null,
      registry: options?.registry ?? DEFAULT_REGISTRY,
      platform: `${process.platform}-${process.arch}`,
      runtimePackage: RUNTIME_PACKAGES.get(`${process.platform}-${process.arch}`) ?? null,
      startedAt: now,
    });
    receipt.finishedAt = now;
    receipt.durationMs = 0;
    receipt.diagnostics.push(diagnosticOf(error));
  }
  if (receipt) {
    const line = `${JSON.stringify(receipt)}\n`;
    process.stdout.write(line);
    if (options?.out) {
      mkdirSync(dirname(options.out), { recursive: true });
      writeFileSync(options.out, line);
    }
    if (!receipt.ok) process.exitCode = 1;
  }
}
