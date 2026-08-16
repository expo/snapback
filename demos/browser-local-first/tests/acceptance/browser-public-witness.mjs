#!/usr/bin/env node

// Browser-carrier PUBLIC-query resolution witness.
//
// @ref LLP 0043#milestone-1-retained-reads — persisted rows render first
//   only as labeled retained state; an offline presentation never becomes current.
// @ref LLP 0043#milestone-2-queued-mutation-replay — a non-empty outbox forces
//   full resync before monotonic-sequence replay and durable settlement.
// @ref LLP 0053#negative-deltas-are-obligations-positive-deltas-are-best-effort —
//   auth-scoped function classification is mode-independent, but the sessions
//   server alone delivers authorization scope; neither phase logs in or leases.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { SnapbackClient } from '@expo/snapback-client';
import { RQS_STORE_DATABASE_NAME } from '@expo/snapback-client/rqs-store';
import { snapbackDev } from '@expo/snapback-vite';
import { chromium } from 'playwright-core';
import { createServer as createViteServer } from 'vite';

import { launchChromeCdp } from '../../../_kit/chrome-process.mjs';
import { importGeneratedModule, readGeneratedJson } from '../../../_kit/generated-artifacts.mjs';
import { freePort } from '../../../_kit/provenance.mjs';
import { startServer } from '../../../_kit/server-process.mjs';
import { resolveGeneratedArtifact } from '../../../../packages/snapback-codegen/review-surface.mjs';
import { canonicalTodoJson, canonicalizeTodos } from '../../shared/canonicalize.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const demoRoot = resolve(here, '..', '..');
const repoRoot = resolve(demoRoot, '..', '..');
const backendRoot = join(demoRoot, 'snapback');
const generatedRoot = join(backendRoot, 'generated');
const surfaceRoot = join(demoRoot, 'surfaces', 'web');
const runtimeRoot = join(demoRoot, '.runtime');
const artifactIndexPath = join(generatedRoot, 'artifacts.json');
const LIST_ID = 'witness';
const EXPECTED_CHECKS = 8;
const RENDER_PHASE_CEILING = 50;
const PROFILE_PREFIX = 'snapback-lane-a1-profile-';
const DEV_PROTECTED_RETENTION_CODE = 'SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE';
const SESSIONS_PROTECTED_RETENTION_CODE = 'SNAPBACK_RETENTION_NOT_RETAINABLE';

const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const artifactIndex = readJson(artifactIndexPath);
const demoMetadata = readJson(join(demoRoot, 'demo.snapback.json'));
const schemaManifest = readGeneratedJson(generatedRoot, 'schema.manifest.json');
const functionsManifest = readGeneratedJson(generatedRoot, 'functions.manifest.json');
const seed = readJson(join(backendRoot, 'seed.json'));
const { default: api } = await importGeneratedModule(generatedRoot, 'api.mjs');

const options = {
  browser: process.env.SNAPBACK_BROWSER_EXECUTABLE ?? null,
  headed: false,
  receipt: join(runtimeRoot, 'browser-public-witness.latest.json'),
};
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === '--browser') options.browser = process.argv[++index];
  else if (argument === '--receipt') options.receipt = resolve(process.argv[++index]);
  else if (argument === '--headed') options.headed = true;
  else throw new Error(`unknown argument: ${argument}`);
}

const browserCandidates = process.platform === 'darwin'
  ? [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ]
  : process.platform === 'linux'
    ? [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
      ]
    : [];
const selectedBrowserExecutable = options.browser
  ?? browserCandidates.find((candidate) => existsSync(candidate))
  ?? null;
const browserExecutable = selectedBrowserExecutable === null
  ? null
  : resolve(selectedBrowserExecutable);
const runtimeBinary = process.env.SNAPBACK_RUNTIME_BINARY
  ? resolve(process.env.SNAPBACK_RUNTIME_BINARY)
  : null;

async function sourceIdentity() {
  const authoredPaths = [
    'demos/browser-local-first/demo.snapback.json',
    'demos/browser-local-first/bun.lock',
    'demos/browser-local-first/package.json',
    'demos/browser-local-first/shared/canonicalize.mjs',
    'demos/browser-local-first/snapback/schema.mjs',
    'demos/browser-local-first/snapback/functions.mjs',
    'demos/browser-local-first/snapback-sessions/schema.mjs',
    'demos/browser-local-first/snapback-sessions/functions.mjs',
    'demos/browser-local-first/snapback-sessions/generated/artifacts.json',
    'demos/browser-local-first/snapback/seed.json',
    'demos/browser-local-first/snapback/generated/artifacts.json',
    'demos/browser-local-first/surfaces/web/index.html',
    'demos/browser-local-first/surfaces/web/main.jsx',
    'demos/browser-local-first/tests/acceptance/browser-public-witness.mjs',
    'demos/_kit/chrome-process.mjs',
    'demos/_kit/define.mjs',
    'demos/_kit/generated-artifacts.mjs',
    'demos/_kit/provenance.mjs',
    'demos/_kit/server-process.mjs',
    'packages/snapback-codegen/index.mjs',
    'packages/snapback-codegen/review-surface.mjs',
    'packages/snapback-client/index.mjs',
    'packages/snapback-client/outbox-shared.mjs',
    'packages/snapback-client/react-binding.mjs',
    'packages/snapback-client/rqs-store-default.mjs',
    'packages/snapback-client/rqs-store.mjs',
    'packages/snapback-react/index.mjs',
    'packages/snapback-vite/index.mjs',
    'packages/snapback-vite/proxy.mjs',
    'llp/0043-offline-replay-retention.rfc.md',
    'llp/0053-authorization-invalidation.rfc.md',
    'llp/0107-react-presence-and-optimistic-lifecycle.spec.md',
    'llp/0114-first-class-react-and-query-groups.spec.md',
    'llp/0218-outbox-settlement-contract.rfc.md',
  ];
  const files = [];
  for (const path of authoredPaths) {
    files.push({ path, sha256: sha256(await readFile(join(repoRoot, path))) });
  }
  for (const artifact of artifactIndex.files) {
    const actualPath = resolveGeneratedArtifact(generatedRoot, artifact.path);
    const digest = sha256(await readFile(actualPath));
    assert.equal(digest, artifact.sha256, `generated artifact digest moved: ${artifact.path}`);
    files.push({
      path: `demos/browser-local-first/snapback/generated/${artifact.path}`,
      sha256: digest,
    });
  }
  return {
    gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim(),
    gitDirty: execFileSync('git', ['status', '--short'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim().length > 0,
    files,
  };
}

async function mintDistinctPorts() {
  const first = await freePort();
  let second = await freePort();
  while (second === first) second = await freePort();
  return { serverPort: first, vitePort: second };
}

let serverPort;
let vitePort;
({ serverPort, vitePort } = await mintDistinctPorts());
const backendUrl = `http://127.0.0.1:${serverPort}`;
const pageOrigin = `http://127.0.0.1:${vitePort}`;
const source = await sourceIdentity();
const artifactIndexSha256 = sha256(await readFile(artifactIndexPath));
await mkdir(runtimeRoot, { recursive: true });
const dbDir = await mkdtemp(join(runtimeRoot, 'db-'));
const devDbPath = join(dbDir, 'browser-local-first-dev.sqlite');
const sessionsDbPath = join(dbDir, 'browser-local-first-sessions.sqlite');
const startupArtifactsPath = join(dbDir, 'sessions-startup-artifacts.json');
// The sessions carrier ships the sessions-mode backend variant: the auth
// mode is a schema declaration, so the dev manifests would boot a dev-mode
// server and no subscription would ever be auth-scoped.
const sessionsGeneratedRoot = join(demoRoot, 'snapback-sessions', 'generated');
const sessionsSchemaManifest = readGeneratedJson(sessionsGeneratedRoot, 'schema.manifest.json');
const sessionsFunctionsManifest = readGeneratedJson(sessionsGeneratedRoot, 'functions.manifest.json');
const startupArtifactsBytes = Buffer.from(
  `${JSON.stringify({
    formatVersion: 1,
    schema: sessionsSchemaManifest,
    functions: sessionsFunctionsManifest,
  })}\n`,
);
await writeFile(startupArtifactsPath, startupArtifactsBytes, { mode: 0o600 });
assert.equal(statSync(startupArtifactsPath).mode & 0o777, 0o600,
  'sessions startup-artifacts carrier was not created with mode 0o600');
const startupArtifactsSha256 = sha256(startupArtifactsBytes);
// Literal /tmp is deliberate: the macOS /var/folders spelling makes Chrome's
// IndexedDB backing store fail on this host. The caller owns this profile.
const profilePath = await mkdtemp(`/tmp/${PROFILE_PREFIX}`);
const receipt = {
  schemaVersion: 'snapback.browser-local-first-public-witness-receipt.v1',
  startedAt: new Date().toISOString(),
  finishedAt: null,
  ok: false,
  expectedChecks: EXPECTED_CHECKS,
  checks: [],
  source,
  artifactGeneration: {
    artifactsJsonSha256: artifactIndexSha256,
    appId: artifactIndex.appId,
    bundleHash: artifactIndex.bundleHash,
    inputsHash: artifactIndex.inputsHash,
    schemaHash: artifactIndex.schemaHash,
    generatedAt: artifactIndex.generatedAt,
    manifestVersion: artifactIndex.manifestVersion,
    cacheKey: artifactIndex.cache?.key ?? null,
    fileCount: artifactIndex.files.length,
  },
  browser: {
    executable: browserExecutable,
    executableSha256: null,
    version: null,
    automation: 'playwright-core-connect-over-cdp',
  },
  carrier: {
    implementation: 'indexeddb',
    databaseName: RQS_STORE_DATABASE_NAME,
    origin: pageOrigin,
    profilePath,
    profileId: sha256(profilePath),
    profileReusedAfterSigkill: false,
    storageFacts: null,
  },
  target: {
    scope: 'public-query-product-witness',
    targetProfile: demoMetadata.targetProfile,
    serverPort,
    vitePort,
    backendUrl,
    pageOrigin,
    relayPath: '/__snapback',
    databaseFile: devDbPath,
    serverBinary: runtimeBinary ? resolve(runtimeBinary) : null,
    runtimeReadinessReceipt: null,
    phases: [{
      mode: 'dev-custody',
      serverPort,
      backendUrl,
      dbPath: devDbPath,
      startup: 'ensureApp',
      expectedLaunches: 2,
    }],
  },
  cleanup: {
    browsers: [],
    browsersGone: false,
    profileRemoved: false,
    viteClosed: false,
    serverStopped: false,
    dbDirRemoved: false,
    residuals: [],
  },
  nonclaims: [
    'No authenticated/authorized retention-and-replay conjunction is claimed.',
    'No AuthorizedLease custody is exercised or claimed.',
    'No data-continuity claim crosses the dev-custody and sessions server phases.',
    'No Parity claim follows; queued HostPlans are replayed by authority, not executed locally.',
    'No phase-advancement claim follows from this receipt.',
  ],
};

const check = async (id, run) => {
  const startedAt = Date.now();
  try {
    const details = await run();
    receipt.checks.push({
      id,
      outcome: 'PASS',
      durationMs: Date.now() - startedAt,
      details: details ?? null,
    });
    process.stdout.write(`  PASS ${id}\n`);
    return details;
  } catch (error) {
    const errorText = String(error?.stack ?? error);
    receipt.checks.push({
      id,
      outcome: 'FAIL',
      durationMs: Date.now() - startedAt,
      details: { error: errorText },
      error: errorText,
    });
    process.stdout.write(`  FAIL ${id}: ${error?.message ?? error}\n`);
    throw error;
  }
};

const serverStarts = [];
let serverLaunchCount = 0;
let serverStopCount = 0;
let viteLaunchCount = 0;
let viteCloseCount = 0;
let browserLaunchCount = 0;
let server = null;
let vite = null;
let firstBrowser = null;
let secondBrowser = null;
let page = null;
let failure = null;
let queuedOperations = null;
let initialState = null;
let preKillState = null;
let preKillStorage = null;
let relaunchedState = null;
let relaunchedStorage = null;
let settledState = null;
let settledStorage = null;
let reconstructedState = null;
let preSessionsStorage = null;
let sessionsState = null;
let sessionsStorage = null;
let finalRowJson = null;
let initialDom = null;
let relaunchedDom = null;
let settledDom = null;
let reconstructedDom = null;
let sessionsDom = null;
const renderObservations = [];

function recordServerStart(handle, mode) {
  serverLaunchCount += 1;
  serverStarts.push({
    mode,
    pid: handle.pid,
    baseUrl: handle.baseUrl,
    launch: handle.launch,
    identity: handle.identity,
    runtimeRecovery: handle.runtimeRecovery,
  });
  receipt.target.serverBinary = handle.runtimeRecovery?.selectedBinary
    ?? handle.launch?.command
    ?? receipt.target.serverBinary;
  receipt.target.runtimeReadinessReceipt = handle.runtimeRecovery?.qualification?.receiptPath
    ?? handle.runtimeRecovery?.readinessReceipt
    ?? receipt.target.runtimeReadinessReceipt;
  assert.equal(
    typeof receipt.target.runtimeReadinessReceipt === 'string'
      && receipt.target.runtimeReadinessReceipt.length > 0,
    true,
    'qualified server launch did not report its runtime-readiness receipt',
  );
}

async function bootDevServer() {
  const handle = await startServer({
    port: serverPort,
    bindPortExactly: true,
    db: devDbPath,
    cwd: repoRoot,
    provenance: { appId: artifactIndex.appId, artifactsPath: artifactIndexPath },
    serverBinary: runtimeBinary,
  });
  server = handle;
  recordServerStart(handle, 'dev-custody');
  try {
    assert.equal(handle.baseUrl, backendUrl, 'Snapback restart drifted from its fixed port');
    const provisioner = new SnapbackClient(handle.baseUrl, {
      ...handle.clientOptions,
      rqsStore: null,
    });
    try {
      await provisioner.ensureApp({ schema: schemaManifest, functions: functionsManifest, seed });
    } finally {
      await provisioner.closeAuth();
    }
  } catch (error) {
    try {
      await handle.stop();
      server = null;
      serverStopCount += 1;
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Snapback provisioning and cleanup both failed',
        { cause: error },
      );
    }
    throw error;
  }
  return handle;
}

async function bootSessionsServer() {
  let requestedSessionsPort = await freePort();
  while (requestedSessionsPort === serverPort || requestedSessionsPort === vitePort) {
    requestedSessionsPort = await freePort();
  }
  const handle = await startServer({
    port: requestedSessionsPort,
    bindPortExactly: true,
    db: sessionsDbPath,
    cwd: repoRoot,
    startupArtifacts: startupArtifactsPath,
    serverBinary: runtimeBinary,
  });
  server = handle;
  recordServerStart(handle, 'sessions');
  const sessionsServerPort = Number(new URL(handle.baseUrl).port);
  assert.equal(Number.isSafeInteger(sessionsServerPort) && sessionsServerPort > 0, true,
    'sessions server did not report a concrete port');
  assert.equal(sessionsServerPort, requestedSessionsPort,
    'sessions server drifted from its dynamically minted port');
  assert.notEqual(sessionsServerPort, serverPort,
    'sessions server reused the dev-custody port instead of minting a fresh port');
  assert.notEqual(sessionsServerPort, vitePort,
    'sessions server collided with the fixed Vite origin port');
  receipt.target.phases.push({
    mode: 'sessions',
    serverPort: sessionsServerPort,
    backendUrl: handle.baseUrl,
    dbPath: sessionsDbPath,
    startupArtifactsPath,
    startupArtifactsSha256,
    startupArtifactsMode: '0600',
    dataContinuityClaim: false,
    expectedLaunches: 1,
  });
  return handle;
}

async function stopServer() {
  if (server === null) return;
  const stopping = server;
  await stopping.stop();
  server = null;
  serverStopCount += 1;
}

async function startVite(relayBackendUrl = backendUrl) {
  const handle = await createViteServer({
    root: surfaceRoot,
    configFile: false,
    logLevel: 'silent',
    plugins: [snapbackDev({
      server: { mode: 'external', url: relayBackendUrl },
      projectRoot: demoRoot,
      generatedRoots: ['snapback/generated', 'snapback-sessions/generated'],
    })],
    server: { host: '127.0.0.1', port: vitePort, strictPort: true },
  });
  vite = handle;
  viteLaunchCount += 1;
  try {
    await handle.listen();
    const resolvedPort = handle.httpServer?.address()?.port;
    assert.equal(resolvedPort, vitePort, 'Vite restart drifted from the IndexedDB origin port');
  } catch (error) {
    try {
      await handle.close();
      vite = null;
      viteCloseCount += 1;
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Vite startup and cleanup both failed',
        { cause: error },
      );
    }
    throw error;
  }
  return handle;
}

async function stopVite() {
  if (vite === null) return;
  const stopping = vite;
  await stopping.close();
  vite = null;
  viteCloseCount += 1;
}

async function launchBrowser(stopSignal) {
  // Chrome leaves this locator after SIGKILL; remove only process-owned
  // discovery state, never IndexedDB/profile contents.
  await rm(join(profilePath, 'DevToolsActivePort'), { force: true });
  const lifecycle = await launchChromeCdp({
    chromeBin: browserExecutable,
    userDataDir: profilePath,
    headless: !options.headed,
    stopSignal,
    startupTimeoutMs: 20_000,
    pollMs: 50,
    extraArgs: [
      '--remote-allow-origins=*',
      '--disable-background-networking',
      '--disable-component-update',
    ],
  });
  try {
    assert.equal(lifecycle.profilePath, profilePath,
      'Chrome lifecycle changed the caller-owned profile spelling');
    const browser = await chromium.connectOverCDP(lifecycle.ws);
    const context = browser.contexts()[0];
    if (!context) throw new Error('CDP browser did not expose its persistent context');
    browserLaunchCount += 1;
    return { browser, context, lifecycle, stopSignal };
  } catch (error) {
    await lifecycle.stop();
    throw lifecycle.diagnoseRuntimeError(error);
  }
}

async function stopBrowser(launch) {
  if (launch === null) return null;
  await launch.lifecycle.stop();
  const fact = {
    pid: launch.lifecycle.pid,
    requestedSignal: launch.stopSignal,
    groupGone: true,
  };
  receipt.cleanup.browsers.push(fact);
  return fact;
}

async function openPage(context) {
  const opened = await context.newPage();
  await opened.goto(pageOrigin, { waitUntil: 'domcontentloaded' });
  await opened.waitForFunction(() => typeof globalThis.snapbackBrowserLocalFirst?.state === 'function', null, {
    timeout: 20_000,
  });
  return opened;
}

async function diagnosticPageState(targetPage) {
  try {
    return await targetPage.evaluate(async () => {
      const api = globalThis.snapbackBrowserLocalFirst;
      return {
        href: location.href,
        body: document.body.innerText.slice(0, 2_000),
        state: typeof api?.state === 'function' ? await api.state() : null,
      };
    });
  } catch (error) {
    return { href: targetPage.url(), evaluateError: String(error?.message ?? error) };
  }
}

async function readDomSurface(targetPage) {
  return targetPage.evaluate(() => {
    const surface = document.querySelector('#todo-surface');
    const refusal = document.querySelector('#protected-retention');
    const outbox = document.querySelector('#outbox');
    const stability = document.querySelector('#render-stability');
    return {
      query: {
        freshness: surface?.dataset.freshness ?? null,
        answerClass: surface?.dataset.answerClass ?? null,
        connection: surface?.dataset.connection ?? null,
        version: Number(surface?.dataset.version ?? 0),
        pendingIntentsAtSeed: Number(surface?.dataset.pendingIntentsAtSeed ?? 0),
        hookRetention: {
          retainable: surface?.dataset.retainable ?? null,
          code: surface?.dataset.retentionCode ?? null,
        },
        handleRetention: {
          retainable: surface?.dataset.handleRetainable ?? null,
          code: surface?.dataset.handleRetentionCode ?? null,
        },
      },
      rows: [...document.querySelectorAll('#todo-rows [data-todo-id]')].map((row) => ({
        id: row.dataset.todoId,
        done: row.dataset.done,
        note: row.dataset.note,
      })),
      rowJson: document.querySelector('#canonical-rows')?.textContent ?? null,
      protectedRetention: {
        hook: {
          retainable: refusal?.dataset.retainable ?? null,
          code: refusal?.dataset.retentionCode ?? null,
        },
        handle: {
          retainable: refusal?.dataset.handleRetainable ?? null,
          code: refusal?.dataset.handleRetentionCode ?? null,
        },
      },
      outbox: {
        supported: outbox?.dataset.supported ?? null,
        pending: Number(outbox?.dataset.pending ?? -1),
      },
      counters: stability === null ? null : { ...stability.dataset },
    };
  });
}

// Polling is bounded and interrogates the product's event-backed snapshot;
// the delay is not used as evidence. Timeouts retain location + DOM + state.
async function waitForState(targetPage, predicate, label, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await targetPage.evaluate(() => globalThis.snapbackBrowserLocalFirst.state());
    if (predicate(latest)) return latest;
    await targetPage.waitForTimeout(75);
  }
  throw new Error(`${label} timed out: ${JSON.stringify(await diagnosticPageState(targetPage))}`);
}

async function markRenderPhase(name) {
  const current = await page.evaluate((phase) => globalThis.snapbackBrowserLocalFirst.markPhase(phase), name);
  const previous = [...renderObservations].reverse().find(({ documentId }) => (
    documentId === current.documentId
  ));
  const baseline = previous ?? {
    appRenders: 0,
    rowRenders: 0,
    rowEffects: 0,
    queryEffects: 0,
  };
  const deltas = Object.fromEntries([
    'appRenders',
    'rowRenders',
    'rowEffects',
    'queryEffects',
  ].map((field) => [field, current[field] - baseline[field]]));
  const observation = { ...current, deltas };
  renderObservations.push(observation);
  assertRenderObservation(observation);
  return observation;
}

function assertRenderObservation(observation) {
  // Fifty commits/effects per named phase leaves broad reconnect/StrictMode
  // margin while making the historical silent render-starvation loop fail hard.
  for (const [field, value] of Object.entries(observation.deltas)) {
    assert.ok(value >= 0 && value <= RENDER_PHASE_CEILING,
      `${observation.name} ${field}=${value} exceeds ${RENDER_PHASE_CEILING}`);
  }
}

const mutationSummary = (operation) => ({
  status: operation.status,
  clientMutationId: operation.clientMutationId,
  sequence: operation.sequence,
  presentation: operation.presentation,
});

try {
  if (!browserExecutable || !existsSync(browserExecutable)) {
    throw new Error(
      'SNAPBACK_BROWSER_PUBLIC_WITNESS_CHROME_MISSING: set SNAPBACK_BROWSER_EXECUTABLE or pass --browser',
    );
  }
  if (!runtimeBinary || !existsSync(runtimeBinary)) {
    throw new Error('SNAPBACK_BROWSER_PUBLIC_WITNESS_RUNTIME_MISSING: set SNAPBACK_RUNTIME_BINARY');
  }
  receipt.browser.executableSha256 = sha256(await readFile(browserExecutable));
  receipt.browser.version = execFileSync(browserExecutable, ['--version'], {
    encoding: 'utf8',
  }).trim();
  server = await bootDevServer();
  vite = await startVite();
  firstBrowser = await launchBrowser('SIGKILL');
  page = await openPage(firstBrowser.context);

  await check('1.retained-current-labeling', async () => {
    initialState = await waitForState(page, (state) => (
      state.query.freshness === 'current'
      && state.query.answerClass === 'authoritative'
      && state.query.version > 0
      && state.rows.length === 2
      && state.storageWriter === true
      && state.protectedQuery.retention?.code === DEV_PROTECTED_RETENTION_CODE
      && state.protectedQuery.hookRetention?.code === DEV_PROTECTED_RETENTION_CODE
    ), 'initial authoritative React render');
    assert.equal(new URL(initialState.href).origin, pageOrigin,
      'initial page did not use the fixed IndexedDB origin');
    assert.equal(initialState.query.connection === 'live' || initialState.query.connection === 'polling', true);
    assert.ok(initialState.rows.every((row) => Object.hasOwn(row, 'note')),
      'canonical rows did not normalize optional note exactly once');
    assert.equal(initialState.rows.find(({ _id }) => _id === 'todo_without_note')?.note, null);
    initialDom = await readDomSurface(page);
    assert.equal(initialDom.query.freshness, 'current');
    assert.equal(initialDom.query.answerClass, 'authoritative');
    assert.equal(initialDom.query.version, initialState.query.version);
    assert.equal(initialDom.rowJson, initialState.rowJson);
    assert.equal(initialDom.rows.length, 2);
    assert.equal(initialDom.rows.find(({ id }) => id === 'todo_without_note')?.note, 'null');
    assert.deepEqual(initialDom.protectedRetention, {
      hook: { retainable: 'false', code: DEV_PROTECTED_RETENTION_CODE },
      handle: { retainable: 'false', code: DEV_PROTECTED_RETENTION_CODE },
    });
    await markRenderPhase('initial-current');
    preKillStorage = await page.evaluate(() => globalThis.snapbackBrowserLocalFirst.flushRetention());
    assert.equal(preKillStorage.retainedEntryPresent, true, 'retained positive control was not persisted');
    assert.equal(preKillStorage.protectedEntryPresent, false, 'auth-scoped query entered IndexedDB');
    receipt.carrier.storageFacts = await page.evaluate(() => (
      globalThis.snapbackBrowserLocalFirst.storageFacts()
    ));
    assert.equal(receipt.carrier.storageFacts.store?.implementation, 'indexeddb');
    assert.equal(receipt.carrier.storageFacts.store?.durable, true);
    assert.equal(receipt.carrier.storageFacts.writer, true);

    // @ref LLP 0218#41-the-dispatch-union-headless-contract — React resolves
    // accepted offline intent as queued; durable settlement remains LLP 0043's.
    // Closing both origins makes browser fetch
    // reject; a live Vite relay returning HTTP 502 would not qualify.
    await stopVite();
    await stopServer();
    queuedOperations = await page.evaluate(() => globalThis.snapbackBrowserLocalFirst.queueScenario());
    assert.equal(queuedOperations.length, 4);
    for (const operation of queuedOperations) {
      assert.equal(operation.status, 'queued');
      assert.equal('queued' in operation, false);
      assert.equal(operation.presentation, 'withheld');
      assert.equal(typeof operation.clientMutationId, 'string');
      assert.ok(operation.clientMutationId.length > 0);
    }
    assert.deepEqual(
      queuedOperations.map(({ sequence }) => sequence),
      [...queuedOperations].map(({ sequence }) => sequence).sort((a, b) => a - b),
      'queued sequences are not monotonic',
    );
    assert.equal(new Set(queuedOperations.map(({ sequence }) => sequence)).size, 4);
    preKillState = await waitForState(page, (state) => state.outbox.pending === 4,
      'four durable offline intents');
    await markRenderPhase('offline-prekill');

    const killed = await stopBrowser(firstBrowser);
    firstBrowser = null;
    assert.equal(killed.groupGone, true);
    vite = await startVite();
    secondBrowser = await launchBrowser('SIGTERM');
    receipt.carrier.profileReusedAfterSigkill = true;
    // The relaunched shell loads its modules (in production: the service
    // worker/precache layer), but every API dispatch to the unreachable
    // authority must reject at the transport with no Response. A live relay
    // answering SNAPBACK_DEV_PROXY_UNREACHABLE is an ANSWER (diagnostic +
    // status), which LLP 0043's provenance classification rightly refuses to
    // treat as offline. Aborting the route makes the page's own fetch
    // dispatch reject while the authority process is genuinely stopped; the
    // route is removed only after the real server is back.
    await secondBrowser.context.route('**/__snapback/**', (route) => route.abort('connectionrefused'));
    receipt.target.offlineMechanism = {
      queueWindow: 'vite-and-server-stopped-fetch-dispatch-rejects',
      relaunchWindow: 'server-stopped-plus-page-route-abort-of-relay-path',
    };
    page = await openPage(secondBrowser.context);
    relaunchedState = await waitForState(page, (state) => (
      state.query.freshness === 'retained'
      && state.query.answerClass === 'labeled-retained'
      && state.query.connection === 'stale'
      && state.rows.length === initialState.rows.length
      && state.outbox.pending === 4
      && state.storageWriter === true
    ), 'retained-first same-profile relaunch while authority is unreachable');
    assert.equal(new URL(relaunchedState.href).origin, pageOrigin,
      'relaunch drifted from the fixed IndexedDB origin');
    const todoEvents = relaunchedState.timeline.filter((event) => (
      event.kind === 'query-update' && event.name === 'todosByList'
    ));
    assert.equal(todoEvents[0]?.handle?.freshness ?? todoEvents[0]?.detailFreshness, 'retained',
      'first relaunched query delivery was not retained');
    assert.equal(todoEvents.some((event) => event.handle?.freshness === 'current'), false,
      'offline retained state was ever presented as current');
    assert.equal(relaunchedState.rowJson, initialState.rowJson,
      'retained frame was not the pre-intent authoritative snapshot');
    relaunchedDom = await readDomSurface(page);
    assert.equal(relaunchedDom.query.freshness, 'retained');
    assert.equal(relaunchedDom.query.answerClass, 'labeled-retained');
    assert.equal(relaunchedDom.query.connection, 'stale');
    assert.equal(relaunchedDom.query.pendingIntentsAtSeed, 4);
    assert.equal(relaunchedDom.rowJson, initialState.rowJson);
    assert.equal(relaunchedDom.outbox.pending, 4);
    await markRenderPhase('relaunch-retained');
    return {
      initial: initialState.query,
      relaunched: relaunchedState.query,
      dom: { initial: initialDom, relaunched: relaunchedDom },
      firstRelaunchDelivery: todoEvents[0],
      profilePath,
    };
  });

  await check('2.queued-mutations-full-resync-before-replay', async () => {
    assert.equal(relaunchedState.query.pendingIntentsAtSeed, 4);
    assert.equal(relaunchedState.query.resumeHeld, false,
      'D3 outbox rule did not withhold the resume token');
    assert.equal(relaunchedState.outbox.records.length, 4);
    assert.deepEqual(
      relaunchedState.outbox.records.map(({ sequence }) => sequence),
      queuedOperations.map(({ sequence }) => sequence),
    );
    relaunchedStorage = await page.evaluate(() => globalThis.snapbackBrowserLocalFirst.inspectIndexedDb());
    assert.equal(relaunchedStorage.retainedEntryPresent, true);
    assert.equal(relaunchedStorage.protectedEntryPresent, false);
    const marker = await page.evaluate(() => (
      globalThis.snapbackBrowserLocalFirst.markPhase('before-authority-restart')
    ));

    server = await bootDevServer();
    // Authority is really back: restore normal transport so reconnect,
    // resync, and replay flow through the relay again.
    await secondBrowser.context.unroute('**/__snapback/**');
    // This is a controller wake-up, not a manual replay. The provider-owned
    // P2 drain must establish its fresh barrier and settle the queued union.
    await page.evaluate(() => globalThis.dispatchEvent(new Event('online')));
    // No forced drain here: the product's own resync-first scheduling is the
    // contract under test (drainNow/drainDebug stay available as diagnostic
    // seams but must never run inside the witness path).
    settledState = await waitForState(page, (state) => (
      state.query.freshness === 'current'
      && state.query.answerClass === 'authoritative'
      && state.outbox.pending === 0
      && state.outbox.records.filter(({ status }) => status === 'settled').length === 4
      && state.rows.filter(({ title }) => title === 'C queued browser row').length === 1
      && state.rows.find(({ _id }) => _id === 'todo_anchor')?.done === true
      && state.protectedQuery.retention?.code === DEV_PROTECTED_RETENTION_CODE
      && state.protectedQuery.hookRetention?.code === DEV_PROTECTED_RETENTION_CODE
    ), 'full resync followed by complete outbox settlement');
    const afterMarker = settledState.timeline.filter(({ ordinal }) => ordinal > marker.timelineOrdinal);
    const current = afterMarker.find((event) => (
      event.kind === 'query-update'
      && event.name === 'todosByList'
      && event.handle?.freshness === 'current'
      && event.handle?.answerClass === 'authoritative'
    ));
    const firstReplay = afterMarker.find((event) => (
      event.kind === 'outbox-diagnostic'
      && event.code === 'SNAPBACK_OFFLINE_MUTATION_REPLAYED'
    ));
    const firstReplayTransition = afterMarker.find((event) => (
      event.kind === 'outbox-transition' && event.replaying === true
    ));
    const firstSettlementTransition = afterMarker.find((event) => (
      event.kind === 'outbox-transition' && event.pending < 4
    ));
    assert.ok(current, 'no fresh authoritative snapshot event preceded replay');
    assert.ok(firstReplay, 'no replay diagnostic was recorded');
    assert.ok(firstReplayTransition, 'no mechanical replay-start transition was recorded');
    assert.ok(firstSettlementTransition, 'no mechanical outbox settlement transition was recorded');
    assert.ok(current.ordinal < firstReplay.ordinal,
      'first replay diagnostic preceded the full-resync current snapshot');
    assert.ok(current.ordinal < firstReplayTransition.ordinal,
      'outbox replay began before the full-resync current snapshot');
    assert.ok(current.ordinal < firstSettlementTransition.ordinal,
      'outbox settlement began before the full-resync current snapshot');
    await markRenderPhase('post-replay');
    return {
      queued: queuedOperations.map(mutationSummary),
      pendingIntentsAtSeed: relaunchedState.query.pendingIntentsAtSeed,
      resumeHeld: relaunchedState.query.resumeHeld,
      currentOrdinal: current.ordinal,
      firstReplayOrdinal: firstReplay.ordinal,
      firstReplayTransitionOrdinal: firstReplayTransition.ordinal,
      firstSettlementTransitionOrdinal: firstSettlementTransition.ordinal,
    };
  });

  await check('3.ordered-exactly-once-settlement', async () => {
    const records = settledState.outbox.records;
    assert.deepEqual(records.map(({ sequence }) => sequence),
      [...records].map(({ sequence }) => sequence).sort((a, b) => a - b));
    const replayIds = settledState.timeline
      .filter((event) => event.kind === 'outbox-diagnostic'
        && event.code === 'SNAPBACK_OFFLINE_MUTATION_REPLAYED')
      .map(({ clientMutationId }) => clientMutationId);
    assert.deepEqual(replayIds, queuedOperations.map(({ clientMutationId }) => clientMutationId),
      'replay diagnostics did not follow durable sequence order');
    const settlementVersions = records.map(({ settlement }) => settlement?.version);
    assert.equal(settlementVersions.every(Number.isSafeInteger), true,
      'one or more durable settlements omitted their authority version');
    assert.equal(settlementVersions.every((version, index) => (
      index === 0 || version > settlementVersions[index - 1]
    )), true, 'settlement versions did not advance in durable sequence order');
    assert.equal(settledState.rows.filter(({ title }) => title === 'C queued browser row').length, 1,
      'queued create produced a ghost duplicate');
    assert.equal(settledState.rows.find(({ _id }) => _id === 'todo_anchor')?.done, true,
      'true -> false -> true did not settle in sequence order');
    assert.deepEqual(records.map(({ function: operation }) => operation), [
      'addTodo',
      'toggleTodo',
      'toggleTodo',
      'toggleTodo',
    ], 'settled operations moved from the queued sequence');
    assert.ok(records.every(({ settlement }) => settlement?.changed_count === 1),
      'an interdependent mutation did not change exactly one row in sequence');
    const added = records[0]?.settlement?.result;
    assert.equal(settledState.rows.some(({ _id }) => _id === added), true,
      'the queued insert settlement is not represented by exactly one final row');

    const middle = queuedOperations[2];
    const original = records.find(({ clientMutationId }) => (
      clientMutationId === middle.clientMutationId
    ))?.settlement;
    assert.ok(original, 'middle toggle settlement was not durably recoverable');
    const before = settledState.rowJson;
    const duplicate = await page.evaluate(({ clientMutationId }) => (
      globalThis.snapbackBrowserLocalFirst.redeliverSettled(clientMutationId)
    ), { clientMutationId: middle.clientMutationId });
    assert.deepEqual(duplicate.result, original.result,
      'duplicate did not republish the stored settlement result');
    assert.equal(duplicate.changed_count, original.changed_count,
      'duplicate changed-count differs from the original settlement');
    assert.equal(duplicate.receipt?.settlementLane, original.receipt?.settlementLane,
      'duplicate receipt lane differs from the original settlement receipt');
    const duplicateProbe = new SnapbackClient(server.baseUrl, {
      ...server.clientOptions,
      rqsStore: null,
    });
    const duplicateProbeHandle = await duplicateProbe.liveQuery(api.todosByList, {
      connectionId: 'browser-local-first-duplicate-probe',
      args: { listId: LIST_ID },
    });
    try {
      assert.equal(canonicalTodoJson(canonicalizeTodos(duplicateProbeHandle.rows)), before,
        'fresh authority snapshot changed after duplicate delivery');
      assert.equal(duplicateProbeHandle.rows.find(({ _id }) => _id === 'todo_anchor')?.done, true,
        'duplicate delivery re-executed the middle false toggle');
    } finally {
      duplicateProbeHandle.dispose();
      await duplicateProbeHandle.settled?.();
      await duplicateProbe.closeAuth();
    }
    const afterDuplicate = await waitForState(page, (state) => (
      state.query.freshness === 'current'
      && state.outbox.pending === 0
      && state.rowJson === before
    ), 'duplicate redelivery stabilization');
    assert.equal(afterDuplicate.rowJson, before,
      'duplicate delivery re-executed and changed authoritative rows');
    assert.equal(afterDuplicate.rows.find(({ _id }) => _id === 'todo_anchor')?.done, true);
    settledState = afterDuplicate;
    finalRowJson = afterDuplicate.rowJson;
    await markRenderPhase('duplicate-redelivery');
    return {
      sequence: records.map(({ sequence, function: operation }) => ({ sequence, operation })),
      settlementVersions,
      replayIds,
      duplicate: {
        clientMutationId: middle.clientMutationId,
        result: duplicate.result,
        changedCount: duplicate.changed_count,
        settlementLane: duplicate.receipt?.settlementLane,
      },
    };
  });

  await check('4.independent-observer-convergence', async () => {
    const observer = new SnapbackClient(server.baseUrl, {
      ...server.clientOptions,
      rqsStore: null,
    });
    const handle = await observer.liveQuery(api.todosByList, {
      connectionId: 'browser-local-first-independent-observer',
      args: { listId: LIST_ID },
    });
    try {
      const rows = canonicalizeTodos(handle.rows);
      const rowJson = canonicalTodoJson(rows);
      assert.equal(rowJson, finalRowJson, 'independent observer row digest differs');
      assert.equal(handle.version, settledState.query.version,
        'independent observer and browser versions differ');
      assert.equal(rows.find(({ _id }) => _id === 'todo_without_note')?.note, null,
        'independent query surface did not expose unset optional as null');
      await markRenderPhase('independent-observer');
      return {
        connectionId: 'browser-local-first-independent-observer',
        rowsSha256: sha256(rowJson),
        version: handle.version,
        rqsStore: observer.rqsStoreInfo,
      };
    } finally {
      handle.dispose();
      await handle.settled?.();
      await observer.closeAuth();
    }
  });

  await check('control.protected-retention-dev-custody', async () => {
    settledStorage = await page.evaluate(() => globalThis.snapbackBrowserLocalFirst.inspectIndexedDb());
    settledDom = await readDomSurface(page);
    assert.equal(initialState.protectedQuery.retention?.retainable, false);
    assert.equal(initialState.protectedQuery.retention?.code, DEV_PROTECTED_RETENTION_CODE);
    assert.equal(initialState.protectedQuery.hookRetention?.retainable, false);
    assert.equal(initialState.protectedQuery.hookRetention?.code, DEV_PROTECTED_RETENTION_CODE);
    assert.equal(settledState.protectedQuery.retention?.retainable, false);
    assert.equal(settledState.protectedQuery.retention?.code, DEV_PROTECTED_RETENTION_CODE);
    assert.equal(settledState.protectedQuery.hookRetention?.retainable, false);
    assert.equal(settledState.protectedQuery.hookRetention?.code, DEV_PROTECTED_RETENTION_CODE);
    for (const [phase, dom] of [
      ['initial', initialDom],
      ['settled', settledDom],
    ]) {
      assert.deepEqual(dom.protectedRetention, {
        hook: { retainable: 'false', code: DEV_PROTECTED_RETENTION_CODE },
        handle: { retainable: 'false', code: DEV_PROTECTED_RETENTION_CODE },
      }, `${phase}: DOM did not report the dev-custody retention fact`);
    }
    for (const [phase, storage] of [
      ['before-sigkill', preKillStorage],
      ['after-relaunch', relaunchedStorage],
      ['after-settlement', settledStorage],
    ]) {
      assert.equal(storage.retainedEntryPresent, true, `${phase}: retained positive control absent`);
      assert.equal(storage.protectedEntryPresent, false, `${phase}: protected entry persisted`);
      assert.equal(Array.isArray(storage.stores.entries), true,
        `${phase}: IndexedDB entries store is absent`);
      assert.equal(storage.stores.entries.includes(storage.retainedKey), true,
        `${phase}: raw IndexedDB keys omit the retained positive control`);
      assert.equal(storage.stores.entries.includes(storage.protectedKey), false,
        `${phase}: raw IndexedDB keys contain the protected query`);
    }
    return {
      mode: 'dev-custody',
      retention: settledState.protectedQuery.retention,
      dom: { beforeSigkill: initialDom, afterRelaunchAndSettlement: settledDom },
      phases: {
        beforeSigkill: preKillStorage,
        afterRelaunch: relaunchedStorage,
        afterSettlement: settledStorage,
      },
    };
  });

  await check('6.full-page-spa-reconstruction', async () => {
    const browserPid = secondBrowser.lifecycle.pid;
    const preReloadEntry = await page.evaluate(() => globalThis.snapbackBrowserLocalFirst.inspectIndexedDb());
    process.stdout.write(`  pre-reload entry: ${JSON.stringify({
      version: preReloadEntry.retainedEntry?.version,
      rowCount: preReloadEntry.retainedEntry?.rows?.length,
      rowVersions: preReloadEntry.retainedEntry?.rows?.map((row) => row._version),
    })}\n`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof globalThis.snapbackBrowserLocalFirst?.state === 'function', null, {
      timeout: 20_000,
    });
    reconstructedState = await waitForState(page, (state) => (
      state.query.freshness === 'current'
      && state.query.answerClass === 'authoritative'
      && state.protectedQuery.retention?.code === DEV_PROTECTED_RETENTION_CODE
      && state.protectedQuery.hookRetention?.code === DEV_PROTECTED_RETENTION_CODE
      && state.outbox.pending === 0
      && state.rowJson === finalRowJson
    ), 'full-page React reconstruction');
    assert.equal(new URL(reconstructedState.href).origin, pageOrigin,
      'SPA reconstruction drifted from the fixed IndexedDB origin');
    assert.equal(secondBrowser.lifecycle.pid, browserPid, 'SPA reload replaced the browser process');
    preSessionsStorage = await page.evaluate(() => globalThis.snapbackBrowserLocalFirst.inspectIndexedDb());
    reconstructedDom = await readDomSurface(page);
    assert.equal(preSessionsStorage.retainedEntryPresent, true);
    assert.equal(preSessionsStorage.protectedEntryPresent, false);
    assert.equal(reconstructedDom.query.freshness, 'current');
    assert.equal(reconstructedDom.query.answerClass, 'authoritative');
    assert.equal(reconstructedDom.rowJson, finalRowJson);
    assert.deepEqual(reconstructedDom.protectedRetention, {
      hook: { retainable: 'false', code: DEV_PROTECTED_RETENTION_CODE },
      handle: { retainable: 'false', code: DEV_PROTECTED_RETENTION_CODE },
    });
    await markRenderPhase('spa-reconstruction');
    return {
      browserPid,
      query: reconstructedState.query,
      retention: reconstructedState.protectedQuery.retention,
      dom: reconstructedDom,
      rowsSha256: sha256(reconstructedState.rowJson),
    };
  });

  await check('5.protected-opaque-retention-refusal-sessions', async () => {
    const browserPid = secondBrowser.lifecycle.pid;
    assert.equal(preSessionsStorage.protectedEntryPresent, false,
      'protected entry existed before the sessions-mode phase');
    assert.equal(preSessionsStorage.retainedEntryPresent, true,
      'retained positive control was absent before the sessions-mode phase');

    await stopVite();
    await stopServer();
    server = await bootSessionsServer();
    vite = await startVite(server.baseUrl);
    await page.goto(`${pageOrigin}/?serverMode=sessions`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof globalThis.snapbackBrowserLocalFirst?.state === 'function', null, {
      timeout: 20_000,
    });
    sessionsState = await waitForState(page, (state) => (
      state.serverMode === 'sessions'
      && state.query.freshness === 'current'
      && state.query.answerClass === 'authoritative'
      && state.query.connection === 'live'
      && state.query.retention?.retainable === true
      && state.query.hookRetention?.retainable === true
      && state.protectedQuery.connection === 'live'
      && state.protectedQuery.retention?.retainable === false
      && state.protectedQuery.retention?.code === SESSIONS_PROTECTED_RETENTION_CODE
      && state.protectedQuery.hookRetention?.retainable === false
      && state.protectedQuery.hookRetention?.code === SESSIONS_PROTECTED_RETENTION_CODE
      && state.storageWriter === true
    ), 'anonymous sessions-mode protected-retention refusal');
    assert.equal(new URL(sessionsState.href).origin, pageOrigin,
      'sessions phase changed the IndexedDB origin');
    assert.equal(secondBrowser.lifecycle.pid, browserPid,
      'sessions phase replaced the browser process');
    assert.equal(sessionsState.query.retention?.code, null,
      'authority-independent positive control carried a refusal code in sessions mode');
    assert.equal(sessionsState.query.hookRetention?.code, null,
      'authority-independent hook positive control carried a refusal code in sessions mode');
    assert.equal(sessionsState.query.resumeHeld, true,
      'sessions server did not mint resume custody for the authority-independent query');

    sessionsDom = await readDomSurface(page);
    assert.deepEqual(sessionsDom.protectedRetention, {
      hook: { retainable: 'false', code: SESSIONS_PROTECTED_RETENTION_CODE },
      handle: { retainable: 'false', code: SESSIONS_PROTECTED_RETENTION_CODE },
    });
    assert.deepEqual(sessionsDom.query.hookRetention, { retainable: 'true', code: 'none' });
    assert.deepEqual(sessionsDom.query.handleRetention, { retainable: 'true', code: 'none' });
    assert.equal(sessionsDom.query.connection, 'live');

    sessionsStorage = await page.evaluate(() => globalThis.snapbackBrowserLocalFirst.flushRetention());
    for (const [phase, storage] of [
      ['before-sessions', preSessionsStorage],
      ['after-sessions', sessionsStorage],
    ]) {
      assert.equal(storage.retainedEntryPresent, true, `${phase}: retained positive control absent`);
      assert.equal(storage.protectedEntryPresent, false, `${phase}: protected entry persisted`);
      assert.equal(Array.isArray(storage.stores.entries), true,
        `${phase}: IndexedDB entries store is absent`);
      assert.equal(storage.stores.entries.includes(storage.retainedKey), true,
        `${phase}: raw IndexedDB keys omit the retained positive control`);
      assert.equal(storage.stores.entries.includes(storage.protectedKey), false,
        `${phase}: raw IndexedDB keys contain the protected query`);
    }
    const relayHealthResponse = await fetch(`${pageOrigin}/__snapback/health`);
    assert.equal(relayHealthResponse.status, 200,
      'sessions authority stopped answering before the phase completed');
    assert.equal((await relayHealthResponse.json()).ok, true,
      'sessions authority health was not ok before the phase completed');
    const finalSessionsState = await page.evaluate(() => globalThis.snapbackBrowserLocalFirst.state());
    assert.equal(finalSessionsState.query.connection, 'live');
    assert.equal(finalSessionsState.protectedQuery.connection, 'live');
    await markRenderPhase('sessions-retention-refusal');
    return {
      mode: 'sessions',
      browserPid,
      server: receipt.target.phases.at(-1),
      protectedRetention: sessionsState.protectedQuery.retention,
      authorityIndependentRetention: sessionsState.query.retention,
      dom: sessionsDom,
      storage: {
        before: preSessionsStorage,
        after: sessionsStorage,
      },
    };
  });

  await check('7.render-stability', async () => {
    for (const observation of renderObservations) assertRenderObservation(observation);
    assert.ok(renderObservations.length >= 6, 'render stability was not sampled at phase boundaries');
    const finalByDocument = new Map();
    for (const observation of renderObservations) {
      finalByDocument.set(observation.documentId, observation);
    }
    assert.equal(finalByDocument.size, 4,
      'expected one render-counter realm per initial page, process relaunch, SPA reload, and sessions reload');
    for (const observation of finalByDocument.values()) {
      assert.ok(observation.appRenders > 0, `${observation.name}: app never rendered`);
      assert.ok(observation.rowRenders > 0, `${observation.name}: row consumer never rendered`);
      assert.ok(observation.rowEffects > 0, `${observation.name}: stable row effect never fired`);
      assert.ok(observation.queryEffects > 0, `${observation.name}: query effect never fired`);
    }
    return {
      ceilingPerPhase: RENDER_PHASE_CEILING,
      documentRealms: finalByDocument.size,
      phases: renderObservations,
    };
  });
} catch (error) {
  failure = error;
} finally {
  if (firstBrowser !== null) {
    try {
      await stopBrowser(firstBrowser);
    } catch (error) {
      failure ??= error;
    }
    firstBrowser = null;
  }
  if (secondBrowser !== null) {
    try {
      await stopBrowser(secondBrowser);
    } catch (error) {
      failure ??= error;
    }
    secondBrowser = null;
  }
  try {
    await stopVite();
    receipt.cleanup.viteClosed = vite === null && viteCloseCount === viteLaunchCount;
  } catch (error) {
    failure ??= error;
  }
  try {
    await stopServer();
    receipt.cleanup.serverStopped = server === null && serverStopCount === serverLaunchCount;
  } catch (error) {
    failure ??= error;
  }
  try {
    await rm(profilePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    receipt.cleanup.profileRemoved = !existsSync(profilePath);
  } catch (error) {
    failure ??= error;
  }
  try {
    await rm(dbDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    receipt.cleanup.dbDirRemoved = !existsSync(dbDir);
  } catch (error) {
    failure ??= error;
  }
  try {
    const ownedProfileRemains = (await readdir('/tmp')).includes(basename(profilePath));
    if (ownedProfileRemains) receipt.cleanup.residuals.push(profilePath);
    if (existsSync(dbDir)) receipt.cleanup.residuals.push(dbDir);
  } catch (error) {
    failure ??= error;
  }
  receipt.cleanup.browsersGone = receipt.cleanup.browsers.length === browserLaunchCount
    && receipt.cleanup.browsers.every(({ groupGone }) => groupGone === true);
  if (!receipt.cleanup.browsersGone) {
    failure ??= new Error('both owned Chrome process groups were not attested gone');
  }
  if (receipt.cleanup.residuals.length > 0) {
    failure ??= new Error(`runtime residuals remain: ${receipt.cleanup.residuals.join(', ')}`);
  }
}

receipt.serverStarts = serverStarts;
receipt.lifecycle = {
  browserLaunches: browserLaunchCount,
  browserStops: receipt.cleanup.browsers.length,
  serverLaunches: serverLaunchCount,
  serverStops: serverStopCount,
  viteLaunches: viteLaunchCount,
  viteCloses: viteCloseCount,
};
const serverModeLaunches = Object.groupBy(serverStarts, ({ mode }) => mode);
if (
  failure === null
  && (
    browserLaunchCount !== 2
    || serverLaunchCount !== 3
    || viteLaunchCount !== 3
    || serverStopCount !== 3
    || viteCloseCount !== 3
    || (serverModeLaunches['dev-custody']?.length ?? 0) !== 2
    || (serverModeLaunches.sessions?.length ?? 0) !== 1
    || receipt.target.phases.length !== 2
    || receipt.carrier.profileReusedAfterSigkill !== true
  )
) {
  failure = new Error(
    'successful witness did not complete the exact two-browser/three-server/three-Vite lifecycle',
  );
}
receipt.finishedAt = new Date().toISOString();
receipt.ok = failure === null
  && receipt.checks.length === receipt.expectedChecks
  && receipt.checks.every(({ outcome }) => outcome === 'PASS')
  && browserLaunchCount === 2
  && serverLaunchCount === 3
  && viteLaunchCount === 3
  && serverStopCount === 3
  && viteCloseCount === 3
  && (serverModeLaunches['dev-custody']?.length ?? 0) === 2
  && (serverModeLaunches.sessions?.length ?? 0) === 1
  && receipt.target.phases.length === 2
  && receipt.carrier.profileReusedAfterSigkill === true
  && receipt.cleanup.browsersGone
  && receipt.cleanup.profileRemoved
  && receipt.cleanup.viteClosed
  && receipt.cleanup.serverStopped
  && receipt.cleanup.dbDirRemoved
  && receipt.cleanup.residuals.length === 0;
if (failure !== null) receipt.error = String(failure?.stack ?? failure);
await mkdir(dirname(options.receipt), { recursive: true });
await writeFile(options.receipt, `${JSON.stringify(receipt, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  ok: receipt.ok,
  passed: receipt.checks.filter(({ outcome }) => outcome === 'PASS').length,
  expectedChecks: receipt.expectedChecks,
  receipt: options.receipt,
  cleanup: receipt.cleanup,
})}\n`);
if (!receipt.ok) process.exitCode = 1;
