#!/usr/bin/env node

// Chrome standards-real reproduction arm for LLP 0317.000 O14 shapes (a)-(c).
//
// Every requested check starts a fresh real server. Shapes (a) and (c) use two
// genuinely separate CDP Target browser contexts; shape (b) uses one context.
// The browser page owns the real @expo/snapback-client bundle, IndexedDB, Web
// Locks, managed WebSocket, live handles, writes, and authoritative witnesses.
// Node only creates contexts, invokes the page API, and retains the report.
//
// @ref LLP 0317.000#design-principles — a terminal negative requires the
// reported platform/client arm and at least ten consecutive fresh-server runs.
// @ref LLP 0258#d2-one-bootstrap-owner-constructs-the-auth-bearing-application-client
//   — distinct personas use explicit distinct storage partitions.
// @ref LLP 0258#d3-custody-is-selected-by-capability-never-convenience-fallback
//   — Chrome supplies real IndexedDB and Web Locks; absence fails loudly.

import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from '../../packages/snapback-codegen/index.mjs';
import { createSuite, runAcceptance } from '../../demos/_kit/harness.mjs';
import { startServer } from '../../demos/_kit/server-process.mjs';
import { liveQueryInvalidationBackendSources } from '../../demos/_kit/tests/live-query-invalidation-fixture.mjs';
import {
  bundleBrowserPage,
  connectRawCdp,
  launchRawCdpChrome,
  resolveChromeExecutable,
  startBrowserBundleProxy,
  chromeSandboxDisabled,
  chromeSandboxMode,
} from './browser-raw-cdp-v1.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..', '..');
const PAGE_MODULE_PATH = join(here, 'browser-live-invalidation-v1-page.mjs');
const PAGE_GLOBAL = 'snapbackBrowserLiveInvalidation';
const PROFILE_TEMP_ROOT = process.platform === 'darwin' ? '/tmp' : tmpdir();
const DEFAULT_SERVER_BINARY = join(ROOT, 'target', 'debug', 'snapback');
const DEFAULT_DELIVERY_DEADLINE_MS = 2_500;
const PAGE_READY_TIMEOUT_MS = 30_000;
const REPORTED_STALE_WINDOW_MS = 3_000;
const SHAPE_ORDER = Object.freeze(['a', 'b', 'c']);
const SHAPES = new Set(SHAPE_ORDER);
const defineUrl = pathToFileURL(join(ROOT, 'packages', 'snapback-codegen', 'define.mjs')).href;

function diagnosticError(code, message, details = {}, classification = 'inconclusive') {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = { code, classification, details };
  return error;
}

function fail(code, message, details = {}) {
  throw diagnosticError(code, message, details);
}

function classifiedError(error, fallbackCode, fallbackMessage) {
  if (error?.diagnostic?.code && error?.code) return error;
  const message = String(error?.message ?? error);
  return diagnosticError(error?.code ?? fallbackCode, fallbackMessage, { message });
}

function reportedDiagnostic(error) {
  return error?.diagnostic ?? {
    code: error?.code ?? 'O14_BROWSER_ITERATION_FAILED',
    classification: 'inconclusive',
    details: { message: String(error?.message ?? error) },
  };
}

function positiveInteger(raw, flag) {
  if (raw === undefined) fail('O14_BROWSER_USAGE', `${flag} requires a value`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    fail('O14_BROWSER_USAGE', `${flag} must be a positive integer`);
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    browser: process.env.CHROME_PATH ?? process.env.SNAPBACK_BROWSER_EXECUTABLE ?? null,
    deadlineMs: DEFAULT_DELIVERY_DEADLINE_MS,
    developmentSmoke: false,
    reportFile: null,
    runs: 1,
    serverBinary: process.env.SNAPBACK_RUNTIME_BINARY ?? DEFAULT_SERVER_BINARY,
    shapes: [...SHAPE_ORDER],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--shape') {
      const raw = argv[++index];
      if (!raw) fail('O14_BROWSER_USAGE', '--shape requires a, b, c, all, or a comma-separated list');
      const requested = raw === 'all' ? [...SHAPE_ORDER] : raw.split(',');
      for (const shape of requested) {
        if (!SHAPES.has(shape)) fail('O14_BROWSER_USAGE', `unknown shape ${JSON.stringify(shape)}`);
      }
      options.shapes = SHAPE_ORDER.filter((shape) => requested.includes(shape));
    } else if (flag === '--runs') {
      options.runs = positiveInteger(argv[++index], '--runs');
    } else if (flag === '--deadline-ms') {
      options.deadlineMs = positiveInteger(argv[++index], '--deadline-ms');
    } else if (flag === '--report-file') {
      options.reportFile = argv[++index] ?? null;
      if (!options.reportFile) fail('O14_BROWSER_USAGE', '--report-file requires a path');
    } else if (flag === '--development-smoke') {
      options.developmentSmoke = true;
    } else if (flag === '--browser') {
      const raw = argv[++index];
      if (!raw) fail('O14_BROWSER_USAGE', '--browser requires a path');
      options.browser = resolve(raw);
    } else if (flag === '--server-binary') {
      const raw = argv[++index];
      if (!raw) fail('O14_BROWSER_USAGE', '--server-binary requires a path');
      options.serverBinary = resolve(raw);
    } else if (flag === '--help' || flag === '-h') {
      console.log(`Usage: node tests/acceptance/browser-live-invalidation-v1.mjs [options]

Options:
  --shape a|b|c|all    Shape(s) to run; comma-separated values accepted (default: all)
  --runs N             Fresh-server consecutive runs (default: 1; use 10 for negative evidence)
  --deadline-ms N      Original-subscription delivery deadline (default: ${DEFAULT_DELIVERY_DEADLINE_MS}; maximum ${DEFAULT_DELIVERY_DEADLINE_MS})
  --report-file PATH   Atomically retain the machine-readable report after cleanup
  --development-smoke Permit a dirty or mismatched binary and sub-10 run count;
                      passing shapes remain inconclusive and evidence-ineligible
  --browser PATH       Chrome-family executable (CHROME_PATH is preferred for hosts)
  --server-binary PATH
                      Qualified Snapback binary (default: SNAPBACK_RUNTIME_BINARY or target/debug/snapback)
`);
      process.exit(0);
    } else {
      fail('O14_BROWSER_USAGE', `unknown argument ${JSON.stringify(flag)}`);
    }
  }
  if (options.deadlineMs > DEFAULT_DELIVERY_DEADLINE_MS) {
    fail(
      'O14_BROWSER_USAGE',
      `--deadline-ms must be <= ${DEFAULT_DELIVERY_DEADLINE_MS}ms so a pass stays strictly inside the reported ${REPORTED_STALE_WINDOW_MS}ms stale window`,
    );
  }
  return options;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

async function prepareBackend(scratch) {
  const backendDir = join(scratch, 'snapback');
  mkdirSync(backendDir, { recursive: true });
  const sources = liveQueryInvalidationBackendSources({ defineUrl });
  writeFileSync(join(backendDir, 'schema.mjs'), sources.schema);
  writeFileSync(join(backendDir, 'functions.mjs'), sources.functions);
  writeFileSync(
    join(backendDir, 'seed.json'),
    '{"tables":{"parents":[],"children":[],"messages":[],"posts":[]}}\n',
  );
  const generated = await generate(backendDir);
  if (!generated.ok) {
    fail('O14_BROWSER_CODEGEN_FAILED', 'O14 browser fixture codegen failed', {
      diagnostics: generated.diagnostics,
    });
  }
  const generatedDir = join(backendDir, 'generated');
  const schema = readJson(join(generatedDir, 'schema.manifest.json'));
  const functions = readJson(join(generatedDir, 'functions.manifest.json'));
  const app = generated.appDescriptor ?? readJson(join(generatedDir, 'app.descriptor.json'));
  const startupArtifacts = join(scratch, 'startup-artifacts.json');
  writeFileSync(
    startupArtifacts,
    `${JSON.stringify({ formatVersion: 1, schema, functions })}\n`,
    { mode: 0o600 },
  );
  return {
    app,
    backendDir,
    generatedApp: join(generatedDir, 'app.mjs'),
    startupArtifacts,
  };
}

async function readAndValidateRuntimeIdentity(server, runtimeBinary, developmentSmoke) {
  const response = await fetch(`${server.baseUrl}/health`);
  if (!response.ok) {
    fail('O14_BROWSER_RUNTIME_HEALTH_FAILED', `runtime health returned HTTP ${response.status}`, {
      runtimeBinary,
      status: response.status,
    });
  }
  const health = await response.json();
  const binary = health?.binary;
  if (
    binary === null
    || typeof binary !== 'object'
    || typeof binary.gitCommit !== 'string'
    || !/^[0-9a-f]{40}$/u.test(binary.gitCommit)
    || typeof binary.gitDirty !== 'boolean'
  ) {
    fail(
      'O14_BROWSER_RUNTIME_IDENTITY_INVALID',
      'health.binary must directly carry a full gitCommit and boolean gitDirty',
      { binary: binary ?? null, runtimeBinary },
    );
  }
  if (binary.gitDirty !== false && !developmentSmoke) {
    fail(
      'O14_BROWSER_RUNTIME_DIRTY_REFUSED',
      `runtime ${binary.gitCommit} was built from a dirty tree`,
      { binary, runtimeBinary },
    );
  }
  const checkoutCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
  if (binary.gitCommit !== checkoutCommit && !developmentSmoke) {
    fail(
      'O14_BROWSER_RUNTIME_COMMIT_MISMATCH',
      `runtime ${binary.gitCommit} does not match checkout ${checkoutCommit}`,
      { binary, checkoutCommit, runtimeBinary },
    );
  }
  return { binary, health };
}

function unwrap(result, label) {
  if (result?.ok === true) return result.value;
  throw diagnosticError(
    result?.code ?? 'O14_BROWSER_PAGE_OPERATION_FAILED',
    `${label}: ${result?.message ?? 'browser page operation failed'}`,
    { pageResult: result ?? null },
  );
}

function transportContinuityFailed(delivery) {
  return delivery.failures.some((failure) => (
    failure === 'connection-detached'
    || failure === 'resubscribed-event'
    || failure === 'subscription-id-changed'
  ));
}

function shapeContextControls(contexts) {
  const { envA, envB = null, principalA, principalB = null, topology } = contexts;
  const capabilitiesPresent = envA.indexedDb === true
    && envA.webLocks === true
    && (envB === null || (envB.indexedDb === true && envB.webLocks === true));
  const distinctContexts = envB === null || (
    topology.browserContextIds.length === 2
    && topology.browserContextIds[0] !== topology.browserContextIds[1]
    && envA.contextNonce !== envB.contextNonce
  );
  const sameOrigin = envB === null || envA.origin === envB.origin;
  const distinctPrincipals = principalB === null || (
    typeof principalA.userId === 'string'
    && typeof principalB.userId === 'string'
    && principalA.userId !== principalB.userId
  );
  const distinctPartitions = principalB === null || (
    principalA.storagePartition === 'o14-persona-a'
    && principalB.storagePartition === 'o14-persona-b'
    && principalA.storagePartitionIdentityHash !== null
    && principalB.storagePartitionIdentityHash !== null
    && principalA.storagePartitionIdentityHash !== principalB.storagePartitionIdentityHash
  );
  return {
    capabilitiesPresent,
    distinctContexts,
    sameOrigin,
    distinctPrincipals,
    distinctPartitions,
  };
}

function requireContextControls(contexts, shape) {
  const controls = shapeContextControls(contexts);
  if (!Object.values(controls).every(Boolean)) {
    throw diagnosticError(
      `O14_BROWSER_${shape.toUpperCase()}_CONTEXT_CONTROL_INVALID`,
      `shape (${shape}) did not establish its real-browser custody/context controls`,
      { controls, contexts },
    );
  }
  return controls;
}

async function shapeA({ contexts, pageA, pageB, run, deadlineMs }) {
  const contextControls = requireContextControls(contexts, 'a');
  const parent = unwrap(
    await pageA.call('createParent', { name: `shape-a-parent-${run}` }),
    'shape (a) create parent',
  );
  if (parent.status !== 'settled' || typeof parent.parentId !== 'string') {
    throw diagnosticError('O14_BROWSER_A_PARENT_CONTROL_FAILED', 'shape (a) parent did not settle', {
      parent,
    });
  }
  const lookupKey = `shape-a-child-${process.pid}-${run}-${randomUUID()}`;
  const opened = unwrap(await pageB.call('openSubscriptions', {
    connectionId: `o14_browser_a_cross_${run}`,
    subscriptions: [{
      key: 'list',
      functionName: 'childrenForParent',
      args: { parentId: parent.parentId },
    }],
  }), 'shape (a) open cross-context subscription');
  unwrap(await pageB.call('captureBaselines', { phase: 'insert' }), 'shape (a) baseline');
  const mutation = unwrap(await pageA.call('createChild', {
    parentId: parent.parentId,
    lookupKey,
    body: 'shape-a',
  }), 'shape (a) create child');
  const deliveries = unwrap(await pageB.call('awaitDeliveries', {
    phase: 'insert',
    expectations: { list: { kind: 'child-row', childId: mutation.childId } },
    settledAt: mutation.settledAt,
    deadlineMs,
  }), 'shape (a) await original subscription');
  const fresh = unwrap(await pageB.call('freshChild', { lookupKey }), 'shape (a) fresh query');
  const details = {
    contextControls,
    contexts,
    opened,
    mutation,
    freshRows: fresh.rows,
    delivery: deliveries.list,
  };
  const committed = mutation.status === 'settled'
    && fresh.rows.length === 1
    && fresh.rows[0]?._id === mutation.childId;
  if (!committed) {
    throw diagnosticError(
      'O14_BROWSER_A_COMMITTED_READ_CONTROL_FAILED',
      'shape (a) is inconclusive: the committed/fresh child-row control failed',
      details,
    );
  }
  if (!deliveries.list.delivered) {
    if (transportContinuityFailed(deliveries.list)) {
      throw diagnosticError(
        'O14_BROWSER_A_TRANSPORT_INCONCLUSIVE',
        'shape (a) is inconclusive: transport continuity failed before cross-context invalidation could be judged',
        details,
      );
    }
    throw diagnosticError(
      'O14_BROWSER_A_CROSS_CONTEXT_INVALIDATION_CONFIRMED',
      'shape (a) confirmed: a committed distinct-principal child insert produced no authoritative frame on the still-attached original cross-context subscription',
      details,
      'confirmed',
    );
  }
  return details;
}

async function shapeB({ contexts, pageA, run, deadlineMs }) {
  const contextControls = requireContextControls(contexts, 'b');
  const parent = unwrap(
    await pageA.call('createParent', { name: `shape-b-parent-${run}` }),
    'shape (b) create parent',
  );
  if (parent.status !== 'settled' || typeof parent.parentId !== 'string') {
    throw diagnosticError('O14_BROWSER_B_PARENT_CONTROL_FAILED', 'shape (b) parent did not settle', {
      parent,
    });
  }
  const lookupKey = `shape-b-child-${process.pid}-${run}-${randomUUID()}`;
  const opened = unwrap(await pageA.call('openSubscriptions', {
    connectionId: `o14_browser_b_same_${run}`,
    subscriptions: [{
      key: 'list',
      functionName: 'childrenForParent',
      args: { parentId: parent.parentId },
    }],
  }), 'shape (b) open same-client subscription');
  unwrap(await pageA.call('captureBaselines', { phase: 'insert' }), 'shape (b) baseline');
  const mutation = unwrap(await pageA.call('createChild', {
    parentId: parent.parentId,
    lookupKey,
    body: 'shape-b',
  }), 'shape (b) create child');
  const deliveries = unwrap(await pageA.call('awaitDeliveries', {
    phase: 'insert',
    expectations: { list: { kind: 'child-row', childId: mutation.childId } },
    settledAt: mutation.settledAt,
    deadlineMs,
  }), 'shape (b) await original subscription');
  const fresh = unwrap(await pageA.call('freshChild', { lookupKey }), 'shape (b) fresh query');
  const details = {
    contextControls,
    contexts,
    opened,
    mutation,
    presentAtSettlement: mutation.presentAtSettlement.list ?? null,
    freshRows: fresh.rows,
    delivery: deliveries.list,
  };
  const committed = mutation.status === 'settled'
    && fresh.rows.length === 1
    && fresh.rows[0]?._id === mutation.childId;
  if (!committed) {
    throw diagnosticError(
      'O14_BROWSER_B_COMMITTED_READ_CONTROL_FAILED',
      'shape (b) is inconclusive: the settled own-write/fresh-query control failed',
      details,
    );
  }
  if (!deliveries.list.delivered) {
    if (transportContinuityFailed(deliveries.list)) {
      throw diagnosticError(
        'O14_BROWSER_B_TRANSPORT_INCONCLUSIVE',
        'shape (b) is inconclusive: transport continuity failed before own-write invalidation could be judged',
        details,
      );
    }
    throw diagnosticError(
      'O14_BROWSER_B_OWN_WRITE_INVALIDATION_CONFIRMED',
      'shape (b) confirmed: the settled own-write was fresh-query visible but absent from the same client original live subscription',
      details,
      'confirmed',
    );
  }
  return details;
}

const trioSubscriptions = (parentId, lookupKey) => [
  {
    key: 'nested',
    functionName: 'parentWithChildren',
    args: { parentId },
  },
  {
    key: 'list',
    functionName: 'childrenForParent',
    args: { parentId },
  },
  {
    key: 'point',
    functionName: 'childByKey',
    args: { lookupKey },
  },
];

const trioExpectations = (childId, body, revision) => ({
  nested: { kind: 'nested-child', childId, body, revision },
  list: { kind: 'child-row', childId, body, revision },
  point: { kind: 'child-row', childId, body, revision },
});

function deliveriesPassed(deliveries) {
  return ['nested', 'list', 'point'].every((key) => deliveries[key]?.delivered === true);
}

function deliveriesKeptContinuity(deliveries) {
  return ['nested', 'list', 'point'].every((key) => !transportContinuityFailed(deliveries[key]));
}

async function shapeC({ contexts, pageA, pageB, run, deadlineMs }) {
  const contextControls = requireContextControls(contexts, 'c');
  const parent = unwrap(
    await pageA.call('createParent', { name: `shape-c-parent-${run}` }),
    'shape (c) create parent',
  );
  if (parent.status !== 'settled' || typeof parent.parentId !== 'string') {
    throw diagnosticError('O14_BROWSER_C_PARENT_CONTROL_FAILED', 'shape (c) parent did not settle', {
      parent,
    });
  }
  const lookupKey = `shape-c-child-${process.pid}-${run}-${randomUUID()}`;
  const subscriptions = trioSubscriptions(parent.parentId, lookupKey);
  const [sameOpened, crossOpened] = await Promise.all([
    pageA.call('openSubscriptions', {
      connectionId: `o14_browser_c_same_${run}`,
      subscriptions,
    }),
    pageB.call('openSubscriptions', {
      connectionId: `o14_browser_c_cross_${run}`,
      subscriptions,
    }),
  ]).then(([same, cross]) => [
    unwrap(same, 'shape (c) open same-client trio'),
    unwrap(cross, 'shape (c) open cross-context trio'),
  ]);
  await Promise.all([
    pageA.call('captureBaselines', { phase: 'insert' }),
    pageB.call('captureBaselines', { phase: 'insert' }),
  ]).then(([same, cross]) => {
    unwrap(same, 'shape (c) same-client insert baseline');
    unwrap(cross, 'shape (c) cross-context insert baseline');
  });

  const inserted = unwrap(await pageA.call('createChild', {
    parentId: parent.parentId,
    lookupKey,
    body: 'inserted',
  }), 'shape (c) create child');
  const insertExpectations = trioExpectations(inserted.childId, 'inserted', 1);
  const [sameInsert, crossInsert] = await Promise.all([
    pageA.call('awaitDeliveries', {
      phase: 'insert',
      expectations: insertExpectations,
      settledAt: inserted.settledAt,
      deadlineMs,
    }),
    pageB.call('awaitDeliveries', {
      phase: 'insert',
      expectations: insertExpectations,
      settledAt: inserted.settledAt,
      deadlineMs,
    }),
  ]).then(([same, cross]) => [
    unwrap(same, 'shape (c) same-client insert delivery'),
    unwrap(cross, 'shape (c) cross-context insert delivery'),
  ]);
  const freshAfterInsert = unwrap(
    await pageB.call('freshChild', { lookupKey }),
    'shape (c) fresh child after insert',
  );

  await Promise.all([
    pageA.call('captureBaselines', { phase: 'patch' }),
    pageB.call('captureBaselines', { phase: 'patch' }),
  ]).then(([same, cross]) => {
    unwrap(same, 'shape (c) same-client patch baseline');
    unwrap(cross, 'shape (c) cross-context patch baseline');
  });
  const patched = unwrap(await pageA.call('patchChild', {
    childId: inserted.childId,
    body: 'patched',
    revision: 2,
  }), 'shape (c) patch child');
  const patchExpectations = trioExpectations(inserted.childId, 'patched', 2);
  const [samePatch, crossPatch] = await Promise.all([
    pageA.call('awaitDeliveries', {
      phase: 'patch',
      expectations: patchExpectations,
      settledAt: patched.settledAt,
      deadlineMs,
    }),
    pageB.call('awaitDeliveries', {
      phase: 'patch',
      expectations: patchExpectations,
      settledAt: patched.settledAt,
      deadlineMs,
    }),
  ]).then(([same, cross]) => [
    unwrap(same, 'shape (c) same-client patch delivery'),
    unwrap(cross, 'shape (c) cross-context patch delivery'),
  ]);
  const freshAfterPatch = unwrap(
    await pageB.call('freshChild', { lookupKey }),
    'shape (c) fresh child after patch',
  );

  const details = {
    contextControls,
    contexts,
    subscriptions: { sameClient: sameOpened, crossContext: crossOpened },
    insert: {
      mutation: inserted,
      freshRows: freshAfterInsert.rows,
      sameClient: sameInsert,
      crossContext: crossInsert,
    },
    patch: {
      mutation: patched,
      freshRows: freshAfterPatch.rows,
      sameClient: samePatch,
      crossContext: crossPatch,
    },
  };
  const committedControls = inserted.status === 'settled'
    && patched.status === 'settled'
    && freshAfterInsert.rows.length === 1
    && freshAfterInsert.rows[0]?._id === inserted.childId
    && freshAfterPatch.rows.length === 1
    && freshAfterPatch.rows[0]?._id === inserted.childId
    && freshAfterPatch.rows[0]?.body === 'patched'
    && freshAfterPatch.rows[0]?.revision === 2;
  if (!committedControls) {
    throw diagnosticError(
      'O14_BROWSER_C_COMMITTED_READ_CONTROL_FAILED',
      'shape (c) is inconclusive: the insert/patch fresh-query controls failed',
      details,
    );
  }
  const sameClientPassed = deliveriesPassed(sameInsert) && deliveriesPassed(samePatch);
  if (!sameClientPassed) {
    throw diagnosticError(
      'O14_BROWSER_C_SAME_CLIENT_CONTROL_INCONCLUSIVE',
      'shape (c) is inconclusive: its same-client nested/list/point discriminator did not converge',
      details,
    );
  }
  const crossContextPassed = deliveriesPassed(crossInsert) && deliveriesPassed(crossPatch);
  if (!crossContextPassed) {
    if (!deliveriesKeptContinuity(crossInsert) || !deliveriesKeptContinuity(crossPatch)) {
      throw diagnosticError(
        'O14_BROWSER_C_TRANSPORT_INCONCLUSIVE',
        'shape (c) is inconclusive: cross-context transport continuity failed',
        details,
      );
    }
    const nestedOnly = crossInsert.list.delivered
      && crossInsert.point.delivered
      && crossPatch.list.delivered
      && crossPatch.point.delivered
      && (!crossInsert.nested.delivered || !crossPatch.nested.delivered);
    throw diagnosticError(
      nestedOnly
        ? 'O14_BROWSER_C_NESTED_INVALIDATION_CONFIRMED'
        : 'O14_BROWSER_C_CROSS_CONTEXT_INVALIDATION_CONFIRMED',
      nestedOnly
        ? 'shape (c) confirmed: direct cross-context controls converged while the nested original subscription stayed stale and the same-client projection updated'
        : 'shape (c) confirmed: the same-client projection updated while at least one still-attached cross-context original subscription stayed stale',
      details,
      'confirmed',
    );
  }
  return details;
}

const shapeFunctions = Object.freeze({ a: shapeA, b: shapeB, c: shapeC });

async function cleanupIteration(iteration) {
  const cleanupErrors = [];
  for (const page of [iteration.pageB, iteration.pageA]) {
    if (page === null) continue;
    try { unwrap(await page.call('dispose'), 'browser page disposal'); } catch (error) {
      cleanupErrors.push(error);
    }
    try { await page.close(); } catch (error) { cleanupErrors.push(error); }
  }
  for (const contextId of [...iteration.contextIds].reverse()) {
    try { await iteration.cdp.disposeBrowserContext(contextId); } catch (error) {
      cleanupErrors.push(error);
    }
  }
  try { await iteration.proxy?.close(); } catch (error) { cleanupErrors.push(error); }
  try { await iteration.server?.stop(); } catch (error) { cleanupErrors.push(error); }
  if (cleanupErrors.length > 0) {
    throw diagnosticError(
      'O14_BROWSER_ITERATION_CLEANUP_FAILED',
      'O14 browser iteration cleanup failed',
      {
        failures: cleanupErrors.map((error) => ({
          code: error?.code ?? error?.diagnostic?.code ?? null,
          message: String(error?.message ?? error),
        })),
      },
    );
  }
}

async function startIteration({ cdp, prepared, runtimeBinary, shape, run, bundle, options }) {
  const iteration = {
    cdp,
    contextIds: [],
    pageA: null,
    pageB: null,
    proxy: null,
    server: null,
  };
  try {
    iteration.server = await startServer({
      port: 0,
      db: ':memory:',
      cwd: ROOT,
      startupArtifacts: prepared.startupArtifacts,
      governanceBackendRoot: prepared.backendDir,
      serverBinary: runtimeBinary,
    });
    const identity = await readAndValidateRuntimeIdentity(
      iteration.server,
      runtimeBinary,
      options.developmentSmoke,
    );
    iteration.proxy = await startBrowserBundleProxy({
      bundle,
      upstreamOrigin: iteration.server.baseUrl,
      title: 'browser-live-invalidation-v1',
      bodyText: 'browser-live-invalidation-v1',
      fail,
      bindFailureCode: 'O14_BROWSER_PROXY_BIND_FAILED',
      bodyLimitCode: 'O14_BROWSER_PROXY_BODY_LIMIT',
      proxyFailureCode: 'O14_BROWSER_PROXY_FAILED',
      bodyLimitMessage: 'request body exceeded 1 MiB',
    });
    const contextA = await cdp.createBrowserContext();
    iteration.contextIds.push(contextA);
    const contextB = shape === 'a' || shape === 'c'
      ? await cdp.createBrowserContext()
      : null;
    if (contextB !== null) iteration.contextIds.push(contextB);
    const databaseName = `snapback-o14-browser-${shape}-${run}-${randomUUID()}`;
    const urlFor = (partition) => (
      `${iteration.proxy.origin}/?database=${encodeURIComponent(databaseName)}`
      + `&partition=${encodeURIComponent(partition)}`
      + `&run=${encodeURIComponent(`${shape}-${run}`)}`
    );
    iteration.pageA = await cdp.newPage(urlFor('o14-persona-a'), {
      browserContextId: contextA,
    });
    if (contextB !== null) {
      iteration.pageB = await cdp.newPage(urlFor('o14-persona-b'), {
        browserContextId: contextB,
      });
    }
    const readReady = async (page, persona) => {
      try {
        return unwrap(
          await page.call('ready', undefined, PAGE_READY_TIMEOUT_MS),
          `${persona} boot`,
        );
      } catch (error) {
        if (error?.code !== 'O14_BROWSER_CDP_COMMAND_TIMEOUT') throw error;
        throw diagnosticError(
          'O14_BROWSER_PAGE_NOT_READY',
          `${persona} page ready() did not resolve within ${PAGE_READY_TIMEOUT_MS}ms`,
          {
            message: String(error?.diagnostic?.details?.message ?? error?.message ?? error),
            persona,
            timeoutMs: PAGE_READY_TIMEOUT_MS,
          },
        );
      }
    };
    const readyA = await readReady(iteration.pageA, 'persona A');
    const readyB = iteration.pageB === null ? null : await readReady(iteration.pageB, 'persona B');
    if (
      readyA.status !== 'anonymous'
      || (readyB !== null && readyB.status !== 'anonymous')
    ) {
      throw diagnosticError(
        'O14_BROWSER_ANONYMOUS_BOOT_CONTROL_FAILED',
        'fresh browser contexts did not boot with anonymous custody',
        { readyA, readyB },
      );
    }
    const credentialNonce = randomBytes(12).toString('hex');
    const credentialsA = {
      email: `o14-browser-a-${credentialNonce}@example.test`,
      password: `A-${randomBytes(24).toString('base64url')}!9z`,
    };
    const credentialsB = {
      email: `o14-browser-b-${credentialNonce}@example.test`,
      password: `B-${randomBytes(24).toString('base64url')}!9z`,
    };
    const principalA = unwrap(
      await iteration.pageA.call('signUp', credentialsA),
      'persona A signup',
    );
    const principalB = iteration.pageB === null
      ? null
      : unwrap(await iteration.pageB.call('signUp', credentialsB), 'persona B signup');
    const envA = await iteration.pageA.call('envFacts');
    const envB = iteration.pageB === null ? null : await iteration.pageB.call('envFacts');
    const topology = {
      mechanism: 'raw CDP Target.createBrowserContext',
      browserContextCount: iteration.contextIds.length,
      browserContextIds: [...iteration.contextIds],
      pageTargetIds: [iteration.pageA.targetId, iteration.pageB?.targetId].filter(Boolean),
      sameOrigin: envB === null ? true : envA.origin === envB.origin,
      tabReuse: false,
      description: shape === 'b'
        ? 'one incognito browser context containing the writer/subscriber page'
        : 'two separately created incognito browser contexts, one page per context',
    };
    return {
      ...iteration,
      contexts: { envA, envB, principalA, principalB, topology },
      identity,
    };
  } catch (error) {
    const startupError = classifiedError(
      error,
      'O14_BROWSER_ITERATION_START_FAILED',
      `shape (${shape}) run ${run} could not start its browser iteration`,
    );
    try {
      await cleanupIteration(iteration);
    } catch (cleanupError) {
      throw diagnosticError(
        'O14_BROWSER_ITERATION_START_AND_CLEANUP_FAILED',
        'O14 browser iteration startup and cleanup failed',
        {
          startup: reportedDiagnostic(startupError),
          cleanup: reportedDiagnostic(cleanupError),
        },
      );
    }
    throw startupError;
  }
}

function platformVersion() {
  return process.platform === 'darwin'
    ? execFileSync('sw_vers', [], { encoding: 'utf8' }).trim().replaceAll('\t', ' ')
    : execFileSync('uname', ['-a'], { encoding: 'utf8' }).trim();
}

function readMainIdentity(headSha) {
  const ref = 'refs/remotes/origin/main';
  const resolved = spawnSync('git', ['show-ref', '--verify', '--hash', ref], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (resolved.error) {
    fail('O14_BROWSER_MAIN_IDENTITY_FAILED', 'could not resolve local origin/main', {
      message: String(resolved.error.message ?? resolved.error),
    });
  }
  if (resolved.status === 1) {
    return {
      originMainSha: null,
      headEqualsOriginMain: false,
      headIsAncestorOfOriginMain: null,
    };
  }
  if (resolved.status !== 0) {
    fail('O14_BROWSER_MAIN_IDENTITY_FAILED', 'could not resolve local origin/main', {
      message: String(resolved.stderr || `git show-ref exited ${resolved.status}`),
    });
  }
  const originMainSha = resolved.stdout.trim();
  const ancestry = spawnSync('git', ['merge-base', '--is-ancestor', headSha, originMainSha], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (ancestry.error || ![0, 1].includes(ancestry.status)) {
    fail('O14_BROWSER_MAIN_IDENTITY_FAILED', 'could not compare HEAD with local origin/main', {
      message: String(
        ancestry.error?.message
          ?? ancestry.stderr
          ?? `git merge-base --is-ancestor exited ${ancestry.status}`,
      ),
    });
  }
  return {
    originMainSha,
    headEqualsOriginMain: headSha === originMainSha,
    headIsAncestorOfOriginMain: ancestry.status === 0,
  };
}

function currentMainReason(mainIdentity) {
  if (mainIdentity.originMainSha === null) return 'origin/main unresolved';
  return mainIdentity.headIsAncestorOfOriginMain ? 'HEAD behind' : 'HEAD ahead';
}

function finalizeVerdicts(report, options, checkout) {
  const serverIdentityComplete = report.serverBinaries.length === options.shapes.length * options.runs;
  const exactCleanRuntime = serverIdentityComplete && report.serverBinaries.every((binary) => (
    binary.gitCommit === checkout.gitCommit && binary.gitDirty === false
  ));
  const reportedPlatform = process.platform === 'linux' && process.arch === 'x64';
  const commonEligible = !options.developmentSmoke
    && options.runs >= 10
    && checkout.gitDirty === false
    && exactCleanRuntime
    && reportedPlatform
    && report.mainIdentity.headEqualsOriginMain;
  const allRequestedShapesPassed = options.shapes.every((shape) => (
    report.perShape[shape].attempted === options.runs
    && report.perShape[shape].passed === options.runs
  ));
  report.evidenceEligibility = {
    negativeEvidenceEligible: commonEligible && allRequestedShapesPassed,
    requiredConsecutiveRuns: 10,
    runThresholdMet: options.runs >= 10,
    checkoutClean: checkout.gitDirty === false,
    exactCleanRuntime,
    reportedPlatform,
    headEqualsOriginMain: report.mainIdentity.headEqualsOriginMain,
    realBrowserArm: true,
    developmentSmoke: options.developmentSmoke,
  };
  for (const shape of options.shapes) {
    const summary = report.perShape[shape];
    const allAttempted = summary.attempted === options.runs;
    const allPassed = summary.passed === options.runs;
    let verdict = 'inconclusive';
    let reason;
    if (!report.mainIdentity.headEqualsOriginMain) {
      reason = `checkout is not current main (${currentMainReason(report.mainIdentity)})`;
    } else if (summary.confirmed > 0) {
      verdict = 'confirmed';
      reason = `${summary.confirmed}/${summary.attempted} run(s) reproduced the reported mechanism with controls intact`;
    } else if (allAttempted && allPassed && commonEligible) {
      verdict = 'not reproducible';
      reason = `${summary.passed}/${options.runs} consecutive fresh-server passes on Linux x86_64 in real Chrome contexts with an exact clean runtime`;
    } else if (!allAttempted || summary.inconclusive > 0) {
      reason = `${summary.attempted}/${options.runs} runs attempted; ${summary.inconclusive} had inconclusive controls or infrastructure`;
    } else {
      const limitations = [];
      if (options.runs < 10) limitations.push(`only ${options.runs}/10 required consecutive runs`);
      if (options.developmentSmoke) limitations.push('development-smoke mode');
      if (checkout.gitDirty) limitations.push('dirty checkout');
      if (!exactCleanRuntime) limitations.push('runtime not exact-clean for checkout');
      if (!reportedPlatform) limitations.push(`${process.platform} ${process.arch}, not Linux x86_64`);
      reason = `${summary.passed}/${options.runs} passed, but negative-evidence bar not met: ${limitations.join('; ')}`;
    }
    summary.verdict = verdict;
    summary.reason = reason;
    summary.negativeEvidenceEligible = verdict === 'not reproducible';
    console.log(`  verdict shape (${shape}): ${verdict} — ${reason}`);
  }
}

const options = parseArgs(process.argv.slice(2));
const runtimeBinary = resolve(options.serverBinary);
if (!existsSync(runtimeBinary)) {
  fail('O14_BROWSER_SERVER_BINARY_NOT_FOUND', `server binary is missing: ${runtimeBinary}`);
}
const browserExecutable = resolveChromeExecutable({
  explicitPath: options.browser,
  fail,
  missingCode: 'O14_BROWSER_CHROME_UNAVAILABLE',
  missingMessage:
    'no Chrome-family browser found; set CHROME_PATH to the standards-real browser executable',
});
const checkout = {
  gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
  gitDirty: execFileSync('git', ['status', '--short'], { cwd: ROOT, encoding: 'utf8' }).trim() !== '',
};
const mainIdentity = readMainIdentity(checkout.gitCommit);
const scratch = mkdtempSync(join(tmpdir(), 'snapback-o14-browser-live-'));
const cleanups = [() => rmSync(scratch, { recursive: true, force: true })];
const suite = createSuite('LLP 0317.000 O14 standards-real browser invalidation', {
  expectedChecks: options.shapes.length * options.runs,
});
const report = {
  schemaVersion: 'snapback.o14-real-browser-invalidation.v1',
  startedAt: new Date().toISOString(),
  finishedAt: null,
  requestedShapes: options.shapes,
  requestedRuns: options.runs,
  deadlineMs: options.deadlineMs,
  developmentSmoke: options.developmentSmoke,
  checkout,
  mainIdentity,
  runtimeBinary,
  browser: {
    name: 'Chrome-family',
    executable: browserExecutable,
    product: null,
    version: null,
    userAgent: null,
    protocolVersion: null,
    automation: 'raw CDP over Node WebSocket',
    launchMode: 'headless=new',
    sandbox: chromeSandboxMode(),
  },
  platform: {
    os: process.platform,
    arch: process.arch,
    version: platformVersion(),
    node: process.version,
  },
  contextTopology: {
    a: 'two Target.createBrowserContext contexts; distinct principals and explicit distinct storagePartitions; writer A, subscriber B',
    b: 'one Target.createBrowserContext context; one page owns the already-open subscription and settled write',
    c: 'two Target.createBrowserContext contexts; nested/list/point trios in both; A is the same-client positive discriminator and B is cross-context',
  },
  perShape: Object.fromEntries(options.shapes.map((shape) => [shape, {
    requested: options.runs,
    attempted: 0,
    passed: 0,
    confirmed: 0,
    inconclusive: 0,
    verdict: 'inconclusive',
    reason: 'run did not complete',
    iterations: [],
  }])),
  serverBinaries: [],
  evidenceEligibility: null,
  fixture: {
    source: 'shared with demos/_kit/tests/live-query-invalidation-e2e.mjs',
    schemaFunctionsModule: 'demos/_kit/tests/live-query-invalidation-fixture.mjs',
  },
  scopeLimitations: [
    ...(chromeSandboxDisabled()
      ? ['Chromium sandbox disabled via SNAPBACK_BROWSER_NO_SANDBOX=1 because the host restricts unprivileged user namespaces; custody, protocol and witness evidence are unaffected']
      : []),
    'Chrome only; Safari and Firefox are separate evidence arms.',
    'Source-checkout @expo/snapback-client bundle, not the published 0.1.29 package bytes.',
    `Local origin/main resolved at run time to ${mainIdentity.originMainSha ?? 'null'}; no network fetch was performed.`,
    `HEAD equals local origin/main at run time: ${mainIdentity.headEqualsOriginMain}.`,
    `HEAD is an ancestor of local origin/main at run time: ${mainIdentity.headIsAncestorOfOriginMain ?? 'null'}.`,
  ],
};

await runAcceptance(suite, async () => {
  const prepared = await prepareBackend(scratch);
  const bundle = await bundleBrowserPage({
    entryPoint: PAGE_MODULE_PATH,
    root: ROOT,
    alias: { 'snapback-o14-generated-app': prepared.generatedApp },
  });
  const profilePath = mkdtempSync(join(PROFILE_TEMP_ROOT, 'snapback-o14-browser-profile-'));
  cleanups.push(() => rmSync(profilePath, { recursive: true, force: true }));
  let chrome;
  try {
    chrome = await launchRawCdpChrome({
      executable: browserExecutable,
      profilePath,
      fail,
      appBundleRequiredCode: 'O14_BROWSER_APP_BUNDLE_REQUIRED',
    });
  } catch (error) {
    if (error?.code) throw error;
    throw diagnosticError(
      'O14_BROWSER_CHROME_LAUNCH_FAILED',
      `Chrome could not start for the standards-real browser arm: ${error?.message ?? error}`,
      { executable: browserExecutable },
    );
  }
  cleanups.push(() => chrome.stop());
  let cdp;
  try {
    cdp = await connectRawCdp(chrome.ws, {
      pageGlobal: PAGE_GLOBAL,
      fail,
      socketClosedCode: 'O14_BROWSER_CDP_SOCKET_CLOSED',
      socketErrorCode: 'O14_BROWSER_CDP_SOCKET_ERROR',
      commandFailureCode: 'O14_BROWSER_CDP_COMMAND_FAILED',
      commandTimeoutCode: 'O14_BROWSER_CDP_COMMAND_TIMEOUT',
      contextCreateFailureCode: 'O14_BROWSER_CONTEXT_CREATE_FAILED',
      contextDisposeFailureCode: 'O14_BROWSER_CONTEXT_DISPOSE_FAILED',
      pageNotReadyCode: 'O14_BROWSER_PAGE_NOT_READY',
      pageNotReadyMessage: 'browser page did not expose the O14 proof API',
    });
  } catch (error) {
    if (error?.code) throw error;
    throw diagnosticError(
      'O14_BROWSER_CDP_CONNECT_FAILED',
      `Chrome started but its raw-CDP session could not attach: ${error?.message ?? error}`,
      { executable: browserExecutable },
    );
  }
  cleanups.push(() => cdp.close());
  const browserVersion = await cdp.browserVersion();
  report.browser.product = browserVersion.product ?? chrome.version?.Browser ?? null;
  report.browser.version = report.browser.product?.split('/').slice(1).join('/') || null;
  report.browser.userAgent = browserVersion.userAgent ?? null;
  report.browser.protocolVersion = browserVersion.protocolVersion ?? null;

  for (let run = 1; run <= options.runs; run += 1) {
    for (const shape of options.shapes) {
      const summary = report.perShape[shape];
      let iteration = null;
      let classification = 'inconclusive';
      let diagnostic = null;
      let details = null;
      summary.attempted += 1;
      await suite.check(`shape (${shape}) run ${run}/${options.runs}`, async () => {
        let failure = null;
        try {
          iteration = await startIteration({
            cdp,
            prepared,
            runtimeBinary,
            shape,
            run,
            bundle,
            options,
          });
          report.serverBinaries.push(iteration.identity.binary);
          try {
            details = await shapeFunctions[shape]({
              contexts: iteration.contexts,
              pageA: iteration.pageA,
              pageB: iteration.pageB,
              run,
              deadlineMs: options.deadlineMs,
            });
            classification = 'passed';
          } catch (error) {
            failure = classifiedError(
              error,
              'O14_BROWSER_ITERATION_FAILED',
              `shape (${shape}) run ${run} failed during its browser proof`,
            );
          }
        } catch (error) {
          failure = classifiedError(
            error,
            'O14_BROWSER_ITERATION_START_FAILED',
            `shape (${shape}) run ${run} could not start its browser iteration`,
          );
        } finally {
          if (iteration !== null) {
            try {
              await cleanupIteration(iteration);
            } catch (cleanupError) {
              const cleanupFailure = classifiedError(
                cleanupError,
                'O14_BROWSER_ITERATION_CLEANUP_FAILED',
                `shape (${shape}) run ${run} could not clean up its browser iteration`,
              );
              failure = failure === null
                ? cleanupFailure
                : diagnosticError(
                    'O14_BROWSER_ITERATION_FAILURE_WITH_CLEANUP',
                    `shape (${shape}) run ${run} failed and cleanup also failed`,
                    {
                      failure: reportedDiagnostic(failure),
                      cleanup: reportedDiagnostic(cleanupFailure),
                    },
                  );
            }
          }
        }
        if (failure !== null) {
          diagnostic = reportedDiagnostic(failure);
          classification = diagnostic.classification === 'confirmed'
            ? 'confirmed'
            : 'inconclusive';
          throw failure;
        }
        return details;
      });
      if (classification === 'passed') summary.passed += 1;
      else if (classification === 'confirmed') summary.confirmed += 1;
      else summary.inconclusive += 1;
      summary.iterations.push({
        run,
        classification,
        binary: iteration?.identity?.binary ?? null,
        contextTopology: iteration?.contexts?.topology ?? null,
        diagnostic,
        details,
      });
    }
  }
  finalizeVerdicts(report, options, checkout);
  report.finishedAt = new Date().toISOString();
}, {
  cleanups,
  reportExtra: report,
  reportFile: options.reportFile === null ? null : resolve(options.reportFile),
});
