#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

import {
  launchChromeCdp,
  NO_PRIMARY_FAILURE,
  throwRunAndCleanupFailures,
} from '../../../_kit/chrome-process.mjs';
import { freePort } from '../../../_kit/provenance.mjs';
import { stopChild } from '../../../_kit/server-process.mjs';
import {
  aggregateMetricValues,
  canonicalizeJson,
  cycleMetricValues,
  deriveTargets,
  metricVerdicts,
  thresholdIdentityPayload,
  thresholdSetId,
} from './performance-v2-math.mjs';

// @ref LLP 0063#amendment-a1-2026-07-24--prospective-partitime-v2-correctness-baseline-reset
// — the only governed Partitime v2 collector. P0a correctness mode never
// enables HeapProfiler or reads Runtime.getHeapUsage.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const demoRoot = resolve(repoRoot, 'demos/partiful-matrix');
const acceptanceRoot = resolve(demoRoot, 'acceptance');
function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
const protocolPath = resolve(acceptanceRoot, 'comparison-protocol.v2.json');
const protocolSchemaPath = resolve(acceptanceRoot, 'comparison-protocol.v2.schema.json');
const receiptSchemaPath = resolve(acceptanceRoot, 'performance-v2-receipt.schema.json');
const protocol = readJson(protocolPath);
const protocolBytes = readFileSync(protocolPath);
const protocolSchemaBytes = readFileSync(protocolSchemaPath);
const receiptSchemaBytes = readFileSync(receiptSchemaPath);
const chromeBin = protocol.environment.browser.executable;
const serverBin = resolve(repoRoot, 'target/debug/snapback');
const apiMethods = Object.freeze([
  'reset',
  'awaitStable',
  'snapshotCounters',
  'applyCanonicalUpdate',
]);
const cleanups = [];

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? null : process.argv[index + 1] ?? null;
}

const emitP0aPath = option('emit-p0a');
const collectPhase = option('collect');
const deriveThresholdsRequested = process.argv.includes('--derive-thresholds');
const aggregateRequested = process.argv.includes('--aggregate');
const selectedArm = option('arm');
const outputOverride = option('output');
const exactCheckout = option('exact-checkout') ?? process.env.EXACT_CHECKOUT ?? null;
const checkOnly = process.argv.includes('--check')
  || (!emitP0aPath && !collectPhase && !deriveThresholdsRequested && !aggregateRequested);
const allowedPhases = new Set(['P0c-comparator', 'P0c-holdout']);
const allowedArms = new Set(['react:snapback', 'contract:snapback']);

if (collectPhase && !allowedPhases.has(collectPhase)) {
  throw new Error(`PARTITIME_V2_PHASE_INVALID: unknown --collect ${collectPhase}`);
}
if ((collectPhase || emitP0aPath || deriveThresholdsRequested || aggregateRequested)
    && !exactCheckout) {
  throw new Error('PARTITIME_V2_EXACT_CHECKOUT_REQUIRED: pass --exact-checkout');
}
assert.ok(
  [Boolean(emitP0aPath), Boolean(collectPhase), deriveThresholdsRequested, aggregateRequested]
    .filter(Boolean).length <= 1,
  'PARTITIME_V2_MODE_CONFLICT: choose one collector mode',
);
if (collectPhase && !allowedArms.has(selectedArm)) {
  throw new Error(`PARTITIME_V2_ARM_INVALID: unknown --arm ${selectedArm}`);
}
if (collectPhase === 'P0c-comparator' && selectedArm !== 'react:snapback') {
  throw new Error('PARTITIME_V2_PHASE_ARM: P0c comparator requires react:snapback');
}
if (collectPhase === 'P0c-holdout' && selectedArm !== 'contract:snapback') {
  throw new Error('PARTITIME_V2_PHASE_ARM: P0c holdout requires contract:snapback');
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sleep = (milliseconds) => new Promise((resolveSleep) => {
  setTimeout(resolveSleep, milliseconds);
});
const run = (command, args, { cwd = repoRoot, encoding = 'utf8' } = {}) => {
  const result = spawnSync(command, args, {
    cwd,
    encoding,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(
      `PARTITIME_V2_COMMAND_FAILED: ${command} ${args.join(' ')}\n`
      + `${String(result.stderr).trim()}`,
    );
  }
  return String(result.stdout).trim();
};
const git = (cwd, args) => run('git', args, { cwd });

function validateSchemas() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validateProtocol = ajv.compile(JSON.parse(protocolSchemaBytes));
  assert.ok(
    validateProtocol(protocol),
    ajv.errorsText(validateProtocol.errors, { separator: '\n' }),
  );
  return ajv.compile(JSON.parse(receiptSchemaBytes));
}

const validateReceipt = validateSchemas();

function collectorManifest() {
  return protocol.artifacts.collectorPaths.map((path) => {
    const absolute = resolve(repoRoot, path);
    assert.ok(existsSync(absolute), `PARTITIME_V2_COLLECTOR_PATH_MISSING: ${path}`);
    return { path, sha256: sha256(readFileSync(absolute)) };
  });
}

function manifestDigest(manifest) {
  return sha256(Buffer.from(canonicalizeJson(manifest), 'utf8'));
}

function packageLockIdentity() {
  const paths = [
    'bun.lock',
    'demos/partiful-matrix/surfaces/react/bun.lock',
    'demos/partiful-matrix/surfaces/contract/bun.lock',
  ];
  return manifestDigest(paths.map((path) => ({
    path,
    sha256: sha256(readFileSync(resolve(repoRoot, path))),
  })));
}

function sourceIdentity() {
  const exactRoot = resolve(exactCheckout);
  return {
    snapbackRevision: git(repoRoot, ['rev-parse', 'HEAD']),
    exactRevision: git(exactRoot, ['rev-parse', 'HEAD']),
    snapbackDirty: git(repoRoot, ['status', '--porcelain']).length > 0,
    exactDirty: git(exactRoot, ['status', '--porcelain']).length > 0,
    packageLockSha256: packageLockIdentity(),
  };
}

function verifyAuthorityAndFixtures() {
  let authorityBindingsVerified = 0;
  for (const binding of protocol.authority.amendments) {
    const checkout = binding.repository === 'ccheever/exact'
      ? resolve(exactCheckout)
      : repoRoot;
    const shown = spawnSync('git', [
      'show',
      `${binding.revision}:${binding.path}`,
    ], {
      cwd: checkout,
      encoding: null,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.equal(
      shown.status,
      0,
      `PARTITIME_V2_AUTHORITY_READ: ${shown.stderr.toString('utf8').trim()}`,
    );
    assert.equal(
      sha256(shown.stdout),
      binding.sha256,
      `PARTITIME_V2_AUTHORITY_DIGEST: ${binding.repository}:${binding.path}`,
    );
    authorityBindingsVerified += 1;
  }
  const snapbackBinding = protocol.authority.amendments.find(
    ({ repository }) => repository === 'ccheever/snapback',
  );
  assert.ok(snapbackBinding, 'PARTITIME_V2_SNAPBACK_AUTHORITY_MISSING');
  let fixtureTreesVerified = 0;
  for (const fixture of protocol.workload.fixtureTrees) {
    assert.equal(
      git(repoRoot, ['rev-parse', `${snapbackBinding.revision}:${fixture.path}`]),
      fixture.gitTree,
      `PARTITIME_V2_FIXTURE_TREE: ${fixture.path}`,
    );
    fixtureTreesVerified += 1;
  }
  return { authorityBindingsVerified, fixtureTreesVerified };
}

function environmentIdentity(externalNetworkRequests = 0) {
  const swVers = Object.fromEntries(
    run('sw_vers', []).split('\n').map((line) => {
      const [key, value] = line.split(/:\s+/);
      return [key, value];
    }),
  );
  const chromeVersion = run(chromeBin, ['--version']).replace(/^Google Chrome\s+/, '').trim();
  const power = run('pmset', ['-g', 'batt']);
  const powerSettings = run('pmset', ['-g']);
  const powerMode = Number(powerSettings.match(/^\s*powermode\s+(\d+)/m)?.[1] ?? -1);
  return {
    osProduct: swVers.ProductName,
    osVersion: swVers.ProductVersion,
    osBuild: swVers.BuildVersion,
    cpu: run('sysctl', ['-n', 'machdep.cpu.brand_string']),
    memoryBytes: Number(run('sysctl', ['-n', 'hw.memsize'])),
    browserName: 'Google Chrome',
    browserVersion: chromeVersion,
    bunVersion: run('bun', ['--version']),
    acPower: power.includes("Now drawing from 'AC Power'"),
    lowPowerMode: powerMode !== 0,
    externalNetworkRequests,
  };
}

function assertPinnedEnvironment(environment) {
  const expected = protocol.environment;
  const comparisons = [
    ['osProduct', environment.osProduct, expected.osProduct],
    ['osVersion', environment.osVersion, expected.osVersion],
    ['osBuild', environment.osBuild, expected.osBuild],
    ['cpu', environment.cpu, expected.cpu],
    ['memoryBytes', environment.memoryBytes, expected.memoryBytes],
    ['browserName', environment.browserName, expected.browser.name],
    ['browserVersion', environment.browserVersion, expected.browser.version],
    ['bunVersion', environment.bunVersion, expected.bunVersion],
    ['acPower', environment.acPower, true],
    ['lowPowerMode', environment.lowPowerMode, false],
  ];
  for (const [field, actual, pinned] of comparisons) {
    assert.equal(actual, pinned, `PARTITIME_V2_ENVIRONMENT_MISMATCH: ${field}`);
  }
}

function protocolIdentity() {
  return {
    id: protocol.protocolId,
    sha256: sha256(protocolBytes),
    schemaSha256: sha256(protocolSchemaBytes),
    receiptSchemaSha256: sha256(receiptSchemaBytes),
    workloadVersion: protocol.workloadVersion,
    thresholdFormulaSetId: protocol.thresholdFormulaSetId,
    collectorId: protocol.identities.collectorId,
  };
}

function dependencies(manifest) {
  return [
    {
      kind: 'protocol-constant',
      path: protocol.artifacts.protocolPath,
      sha256: sha256(protocolBytes),
    },
    {
      kind: 'protocol-constant',
      path: protocol.artifacts.schemaPath,
      sha256: sha256(protocolSchemaBytes),
    },
    {
      kind: 'protocol-constant',
      path: protocol.artifacts.receiptSchemaPath,
      sha256: sha256(receiptSchemaBytes),
    },
    ...protocol.authority.amendments.map(({ path, sha256: digest }) => ({
      kind: 'authority-amendment',
      path,
      sha256: digest,
    })),
    ...manifest.map(({ path, sha256: digest }) => ({
      kind: 'collector',
      path,
      sha256: digest,
    })),
    ...protocol.workload.fixtureTrees.map(({ path, gitTree }) => ({
      kind: 'fixture',
      path,
      sha256: sha256(Buffer.from(gitTree, 'utf8')),
    })),
  ];
}

function assertCleanSource(source) {
  assert.equal(
    source.snapbackDirty,
    false,
    'PARTITIME_V2_DIRTY_SOURCE: Snapback worktree must be clean before a receipt',
  );
  assert.equal(
    source.exactDirty,
    false,
    'PARTITIME_V2_DIRTY_SOURCE: Exact worktree must be clean before a receipt',
  );
}

function writeReceipt(path, receipt) {
  assert.ok(
    validateReceipt(receipt),
    `PARTITIME_V2_RECEIPT_INVALID:\n${new Ajv2020().errorsText(validateReceipt.errors)}`,
  );
  const absolute = resolve(repoRoot, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(receipt, null, 2)}\n`);
  return { path: relative(repoRoot, absolute), sha256: sha256(readFileSync(absolute)) };
}

function buildSurface(arm, apiUrl, outputRoot, input = 'performance-v2.html') {
  const authoring = arm.split(':')[0];
  const surface = resolve(demoRoot, 'surfaces', authoring);
  const config = authoring === 'react' ? './vite.config.mts' : './vite.config.ts';
  const program = [
    'import { build, mergeConfig } from "vite";',
    `import configFactory from ${JSON.stringify(config)};`,
    'import { resolve } from "node:path";',
    'const base = await configFactory({ mode: "snapback", command: "build" });',
    'await build(mergeConfig(base, {',
    '  configFile: false,',
    '  base: "/",',
    '  build: {',
    '    outDir: process.env.PARTITIME_V2_OUT_DIR,',
    '    emptyOutDir: true,',
    '    rollupOptions: { input: resolve(process.env.PARTITIME_V2_INPUT) },',
    '  },',
    '}));',
  ].join('\n');
  const result = spawnSync('bun', ['-e', program], {
    cwd: surface,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      SNAPBACK_PARTIFUL_MATRIX_API: apiUrl,
      PARTITIME_DISABLE_POLL_FALLBACK: '1',
      PARTITIME_V2_OUT_DIR: outputRoot,
      PARTITIME_V2_INPUT: input,
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(
      `PARTITIME_V2_BUILD_FAILED: ${authoring}\n`
      + `${result.stdout}\n${result.stderr}`,
    );
  }
}

function filesRecursively(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? filesRecursively(path) : [path];
  });
}

function verifyOrdinaryBuildExcludesBenchmark(arm, scratchRoot) {
  const output = join(scratchRoot, `ordinary-${arm.split(':')[0]}`);
  buildSurface(arm, 'http://127.0.0.1:1', output, 'index.html');
  for (const file of filesRecursively(output)) {
    if (!statSync(file).isFile()) continue;
    assert.equal(
      readFileSync(file).includes(Buffer.from('__partitimePerformanceV2')),
      false,
      `PARTITIME_V2_PRODUCTION_LEAK: ${relative(output, file)}`,
    );
  }
}

async function startSnapback() {
  assert.ok(existsSync(serverBin), `PARTITIME_V2_SERVER_MISSING: ${serverBin}`);
  const readyDir = mkdtempSync(join(tmpdir(), 'partitime-v2-api-'));
  const readyFile = join(readyDir, 'ready.json');
  const child = spawn(serverBin, ['--port', '0', '--memory', '--ready-file', readyFile], {
    cwd: repoRoot,
    detached: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  cleanups.push(() => rmSync(readyDir, { recursive: true, force: true }));
  cleanups.push(() => stopChild(child));
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-16_000); });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (existsSync(readyFile)) {
      const { port } = readJson(readyFile);
      const baseUrl = `http://127.0.0.1:${port}`;
      await waitForUrl(`${baseUrl}/health`, child, 'Snapback');
      return baseUrl;
    }
    if (child.exitCode !== null) {
      throw new Error(`PARTITIME_V2_SERVER_EXIT: ${child.exitCode}\n${stderr}`);
    }
    await sleep(50);
  }
  throw new Error(`PARTITIME_V2_SERVER_TIMEOUT:\n${stderr}`);
}

async function waitForUrl(url, child, label, timeoutMilliseconds = 30_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch { /* retry */ }
    if (child?.exitCode !== null) {
      throw new Error(`PARTITIME_V2_PROCESS_EXIT: ${label} exited ${child.exitCode}`);
    }
    await sleep(50);
  }
  throw new Error(`PARTITIME_V2_URL_TIMEOUT: ${url}`);
}

function contentType(path) {
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
  }[extname(path)] ?? 'application/octet-stream';
}

async function startStaticServer(root) {
  const port = await freePort();
  const normalizedRoot = resolve(root);
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const requested = pathname === '/' ? '/performance-v2.html' : pathname;
    const absolute = resolve(normalizedRoot, `.${requested}`);
    if (absolute !== normalizedRoot && !absolute.startsWith(`${normalizedRoot}${sep}`)) {
      response.writeHead(403).end();
      return;
    }
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'content-type': contentType(absolute),
      'cache-control': 'no-store',
    });
    response.end(readFileSync(absolute));
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(port, '127.0.0.1', resolveListen);
  });
  cleanups.push(() => new Promise((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  }));
  return `http://127.0.0.1:${port}`;
}

async function connectCdp(url, allowedOrigins) {
  const socket = new WebSocket(url);
  const pending = new Map();
  const sessions = new Map();
  let nextId = 1;
  const settle = (id) => {
    const request = pending.get(id);
    if (request) clearTimeout(request.timer);
    pending.delete(id);
    return request;
  };
  socket.addEventListener('message', async (event) => {
    const message = JSON.parse(
      typeof event.data === 'string' ? event.data : await event.data.text(),
    );
    if (message.id && pending.has(message.id)) {
      const request = settle(message.id);
      if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`));
      else request.resolve(message.result ?? {});
      return;
    }
    const state = sessions.get(message.sessionId);
    if (!state) return;
    if (message.method === 'Runtime.exceptionThrown') {
      state.pageErrors.push(
        message.params?.exceptionDetails?.exception?.description
        ?? message.params?.exceptionDetails?.text
        ?? 'unknown page exception',
      );
    }
    if (message.method === 'Network.requestWillBeSent') {
      const requestUrl = message.params?.request?.url ?? '';
      let allowed = requestUrl.startsWith('data:')
        || requestUrl.startsWith('blob:')
        || requestUrl === 'about:blank';
      try {
        allowed ||= allowedOrigins.has(new URL(requestUrl).origin);
      } catch { /* malformed URLs are external */ }
      if (!allowed) state.externalRequests.push(requestUrl);
    }
  });
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', () => rejectOpen(new Error('PARTITIME_V2_CDP_CONNECT')), {
      once: true,
    });
  });
  const send = (method, params = {}, sessionId = null) => new Promise((resolveSend, rejectSend) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      settle(id);
      rejectSend(new Error(`PARTITIME_V2_CDP_TIMEOUT: ${method}`));
    }, 30_000);
    pending.set(id, { resolve: resolveSend, reject: rejectSend, timer, method });
    socket.send(JSON.stringify(sessionId
      ? { id, method, params, sessionId }
      : { id, method, params }));
  });
  const evaluate = async (sessionId, expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    }, sessionId);
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description
        ?? result.exceptionDetails.text
        ?? 'PARTITIME_V2_PAGE_EVALUATION',
      );
    }
    return result.result?.value;
  };
  return {
    async newContextPage() {
      const { browserContextId } = await send('Target.createBrowserContext', {
        disposeOnDetach: true,
      });
      const { targetId } = await send('Target.createTarget', {
        url: 'about:blank',
        browserContextId,
      });
      const { sessionId } = await send('Target.attachToTarget', {
        targetId,
        flatten: true,
      });
      const state = { pageErrors: [], externalRequests: [] };
      sessions.set(sessionId, state);
      await send('Page.enable', {}, sessionId);
      await send('Runtime.enable', {}, sessionId);
      await send('Network.enable', {}, sessionId);
      return {
        state,
        navigate: (target) => send('Page.navigate', { url: target }, sessionId),
        evaluate: (expression) => evaluate(sessionId, expression),
        async heapUsedSize() {
          await send('HeapProfiler.enable', {}, sessionId);
          await send('HeapProfiler.collectGarbage', {}, sessionId);
          const result = await send('Runtime.getHeapUsage', {}, sessionId);
          assert.ok(
            Number.isInteger(result.usedSize) && result.usedSize >= 0,
            'PARTITIME_V2_HEAP_INVALID',
          );
          return result.usedSize;
        },
        async close() {
          sessions.delete(sessionId);
          await send('Target.closeTarget', { targetId });
          await send('Target.disposeBrowserContext', { browserContextId });
        },
      };
    },
    async close() {
      if (socket.readyState === WebSocket.CLOSED) return;
      await new Promise((resolveClose) => {
        const timeout = setTimeout(resolveClose, 2_000);
        socket.addEventListener('close', () => {
          clearTimeout(timeout);
          resolveClose();
        }, { once: true });
        socket.close();
      });
    },
  };
}

async function waitForBenchmarkApi(page) {
  const inventory = await page.evaluate(`(async () => {
    const deadline = performance.now() + 30000;
    while (!window.__partitimePerformanceV2) {
      if (performance.now() >= deadline) throw new Error('PARTITIME_V2_API_TIMEOUT');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return Object.keys(window.__partitimePerformanceV2).sort();
  })()`);
  assert.deepEqual(inventory, [...apiMethods].sort(), 'PARTITIME_V2_API_INVENTORY');
}

const graceStatusExpression = `(() => {
  const node = document.querySelector('[data-testid^="performance-v2-subscriber-"]');
  const explicit = node?.getAttribute('data-grace-status');
  if (explicit === 'going' || explicit === 'maybe') return explicit;
  const text = node?.textContent ?? '';
  if (text.includes(':user_grace:going')) return 'going';
  if (text.includes(':user_grace:maybe')) return 'maybe';
  return null;
})()`;

async function correctnessWitness(page) {
  await page.evaluate('window.__partitimePerformanceV2.reset(8)');
  const stable = await page.evaluate('window.__partitimePerformanceV2.awaitStable()');
  assert.equal(stable.activeSubscriptions, 8, 'PARTITIME_V2_SUBSCRIPTION_COUNT');
  const beforeGraceStatus = await page.evaluate(graceStatusExpression);
  assert.ok(['going', 'maybe'].includes(beforeGraceStatus), 'PARTITIME_V2_GRACE_BEFORE');
  await page.evaluate('window.__partitimePerformanceV2.applyCanonicalUpdate()');
  await page.evaluate('window.__partitimePerformanceV2.awaitStable()');
  const afterGraceStatus = await page.evaluate(graceStatusExpression);
  const counters = await page.evaluate('window.__partitimePerformanceV2.snapshotCounters()');
  assert.ok(['going', 'maybe'].includes(afterGraceStatus), 'PARTITIME_V2_GRACE_AFTER');
  assert.notEqual(afterGraceStatus, beforeGraceStatus, 'PARTITIME_V2_GRACE_UNCHANGED');
  assert.equal(counters.activeSubscriptions, 8, 'PARTITIME_V2_SUBSCRIPTION_COUNT');
  assert.ok(counters.deliveryCallbacks >= 1, 'PARTITIME_V2_DELIVERY_MISSING');
  assert.ok(counters.domPatchRecords >= 1, 'PARTITIME_V2_PATCH_MISSING');
  return {
    arm: 'contract:snapback',
    activeSubscriptions: counters.activeSubscriptions,
    apiMethods: [...apiMethods],
    beforeGraceStatus,
    afterGraceStatus,
    authoritativeDeliveries: counters.deliveryCallbacks,
    domPatchRecords: counters.domPatchRecords,
    heapReadAttempted: false,
  };
}

async function measureCycle(page, schedule) {
  const observations = [];
  for (const activeSubscriptions of schedule) {
    await page.evaluate(
      `window.__partitimePerformanceV2.reset(${JSON.stringify(activeSubscriptions)})`,
    );
    const stable = await page.evaluate('window.__partitimePerformanceV2.awaitStable()');
    assert.equal(stable.activeSubscriptions, activeSubscriptions);
    const usedSizeBytes = await page.heapUsedSize();
    const observation = { activeSubscriptions, usedSizeBytes };
    if (activeSubscriptions === protocol.workload.canonicalActiveSubscriptions) {
      await page.evaluate('window.__partitimePerformanceV2.applyCanonicalUpdate()');
      await page.evaluate('window.__partitimePerformanceV2.awaitStable()');
      const counters = await page.evaluate(
        'window.__partitimePerformanceV2.snapshotCounters()',
      );
      observation.deliveryCallbacks = counters.deliveryCallbacks;
      observation.domPatchRecords = counters.domPatchRecords;
    }
    observations.push(observation);
  }
  return { observations, ...cycleMetricValues(observations) };
}

async function preparedBrowser(arm) {
  const apiUrl = await startSnapback();
  const scratchRoot = mkdtempSync(join(tmpdir(), 'partitime-v2-build-'));
  cleanups.push(() => rmSync(scratchRoot, { recursive: true, force: true }));
  const buildRoot = join(scratchRoot, arm.split(':')[0]);
  buildSurface(arm, apiUrl, buildRoot);
  const staticUrl = await startStaticServer(buildRoot);
  const chrome = await launchChromeCdp({
    chromeBin,
    userDataPrefix: `partitime-v2-${arm.split(':')[0]}-`,
    extraArgs: ['--window-size=1280,900'],
  });
  cleanups.push(() => chrome.stop());
  const cdp = await connectCdp(
    chrome.ws,
    new Set([new URL(apiUrl).origin, new URL(staticUrl).origin]),
  );
  cleanups.push(() => cdp.close());
  return { apiUrl, staticUrl, cdp, chrome };
}

async function emitP0a() {
  const manifest = collectorManifest();
  const source = sourceIdentity();
  const environment = environmentIdentity();
  const protocolFrozenAtRevision = git(repoRoot, [
    'log',
    '-1',
    '--format=%H',
    '--',
    relative(repoRoot, protocolPath),
  ]);
  let authorityBindingsVerified = 0;
  let fixtureTreesVerified = 0;
  let witness = null;
  let failure = null;
  try {
    assertCleanSource(source);
    assertPinnedEnvironment(environment);
    ({
      authorityBindingsVerified,
      fixtureTreesVerified,
    } = verifyAuthorityAndFixtures());
    const { staticUrl, cdp } = await preparedBrowser('contract:snapback');
    const page = await cdp.newContextPage();
    try {
      await page.navigate(`${staticUrl}/performance-v2.html`);
      await waitForBenchmarkApi(page);
      witness = await correctnessWitness(page);
      assert.deepEqual(page.state.pageErrors, [], 'PARTITIME_V2_PAGE_ERRORS');
      assert.deepEqual(page.state.externalRequests, [], 'PARTITIME_V2_EXTERNAL_NETWORK');
    } finally {
      await page.close();
    }
  } catch (error) {
    failure = error;
  }
  const receipt = {
    schemaVersion: 'partitime.performance-v2-receipt.v1',
    kind: 'p0a-preregistration',
    protocol: protocolIdentity(),
    source,
    environment,
    valid: failure === null,
    invalidReasons: failure === null ? [] : [{
      code: 'PARTITIME_V2_P0A_INVALID',
      message: failure instanceof Error ? failure.message : String(failure),
    }],
    dependencies: dependencies(manifest),
    p0a: {
      protocolFrozenAtRevision,
      protocolFrozenBeforeCollector: protocolFrozenAtRevision !== source.snapbackRevision,
      governedSamplesCollected: false,
      authorityBindingsVerified,
      fixtureTreesVerified,
      collectorSha256: manifestDigest(manifest),
      collectorManifest: manifest,
      ...(witness ? { correctnessWitness: witness } : {}),
      p0aComplete: failure === null,
      remaining: failure === null ? [] : ['valid clean-environment correctness witness'],
    },
  };
  if (failure !== null) {
    const requested = resolve(repoRoot, emitP0aPath);
    const invalidDirectory = resolve(dirname(requested), 'performance-v2/invalid');
    const priorAttempts = existsSync(invalidDirectory)
      ? readdirSync(invalidDirectory).filter((name) => /^p0a-attempt-\d+\.json$/.test(name)).length
      : 0;
    assert.ok(priorAttempts < 3, 'PARTITIME_V2_INSTRUMENT_RED: three invalid P0a attempts');
    const invalidPath = relative(
      repoRoot,
      resolve(invalidDirectory, `p0a-attempt-${priorAttempts + 1}.json`),
    );
    const output = writeReceipt(invalidPath, receipt);
    console.error(JSON.stringify({
      ok: false,
      mode: 'p0a',
      output,
      invalidReasons: receipt.invalidReasons,
    }, null, 2));
    throw failure;
  }
  const output = writeReceipt(emitP0aPath, receipt);
  console.log(JSON.stringify({ ok: true, mode: 'p0a', output, witness }, null, 2));
}

function defaultCycleDirectory() {
  return collectPhase === 'P0c-comparator'
    ? protocol.artifacts.comparatorRawDirectory
    : protocol.artifacts.holdoutRawDirectory;
}

function assertCommittedPath(path, code) {
  const relativePath = relative(repoRoot, path);
  assert.equal(
    git(repoRoot, ['status', '--porcelain', '--', relativePath]),
    '',
    `${code}: ${relativePath}`,
  );
}

function loadAcceptedCycles(directoryPath, { arm, phase }) {
  assert.ok(existsSync(directoryPath), `PARTITIME_V2_CYCLE_DIRECTORY_MISSING: ${directoryPath}`);
  const receipts = readdirSync(directoryPath)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const path = join(directoryPath, name);
      const receipt = readJson(path);
      assert.ok(
        validateReceipt(receipt),
        `PARTITIME_V2_RETAINED_RECEIPT_INVALID: ${name}\n`
        + new Ajv2020().errorsText(validateReceipt.errors),
      );
      assert.equal(receipt.kind, 'cycle', `PARTITIME_V2_CYCLE_KIND: ${name}`);
      assert.equal(receipt.protocol.sha256, sha256(protocolBytes), `PARTITIME_V2_PROTOCOL_DRIFT: ${name}`);
      assert.equal(receipt.cycle.arm, arm, `PARTITIME_V2_CYCLE_ARM: ${name}`);
      assert.equal(receipt.cycle.phase, phase, `PARTITIME_V2_CYCLE_PHASE: ${name}`);
      return {
        path: relative(repoRoot, path),
        sha256: sha256(readFileSync(path)),
        receipt,
      };
    });
  const accepted = receipts.filter(({ receipt }) => receipt.valid);
  const warmups = accepted.filter(({ receipt }) => receipt.cycle.warmup);
  const samples = accepted.filter(({ receipt }) => !receipt.cycle.warmup);
  assert.equal(warmups.length, 2, 'PARTITIME_V2_WARMUP_COUNT');
  assert.equal(samples.length, 7, 'PARTITIME_V2_SAMPLE_COUNT');
  for (const [index, item] of warmups.sort(
    (left, right) => left.receipt.cycle.cycleIndex - right.receipt.cycle.cycleIndex,
  ).entries()) {
    assert.equal(item.receipt.cycle.cycleIndex, index, 'PARTITIME_V2_WARMUP_INDEX');
    assert.deepEqual(
      item.receipt.cycle.schedule,
      protocol.workload.warmupSchedules[index],
      'PARTITIME_V2_WARMUP_SCHEDULE',
    );
  }
  for (const [index, item] of samples.sort(
    (left, right) => left.receipt.cycle.cycleIndex - right.receipt.cycle.cycleIndex,
  ).entries()) {
    assert.equal(item.receipt.cycle.cycleIndex, index, 'PARTITIME_V2_SAMPLE_INDEX');
    assert.deepEqual(
      item.receipt.cycle.schedule,
      protocol.workload.sampleSchedules[index],
      'PARTITIME_V2_SAMPLE_SCHEDULE',
    );
  }
  return { receipts, warmups, samples };
}

function comparatorDependencies(samples) {
  return samples.map(({ path, sha256: digest }) => ({
    kind: 'react-comparator',
    path,
    sha256: digest,
    arm: 'react:snapback',
  }));
}

function holdoutDependencies(samples) {
  return samples.map(({ path, sha256: digest }) => ({
    kind: 'contract-holdout',
    path,
    sha256: digest,
    arm: 'contract:snapback',
  }));
}

function assertPhaseEntry(source) {
  assertCleanSource(source);
  const p0aPath = resolve(repoRoot, protocol.artifacts.preregistrationReceiptPath);
  assert.ok(existsSync(p0aPath), 'PARTITIME_V2_P0A_RECEIPT_MISSING');
  const p0a = readJson(p0aPath);
  assert.equal(p0a.valid, true, 'PARTITIME_V2_P0A_RECEIPT_RED');
  assert.equal(p0a.p0a?.p0aComplete, true, 'PARTITIME_V2_P0A_INCOMPLETE');
  if (collectPhase === 'P0c-comparator') {
    assert.equal(
      existsSync(resolve(repoRoot, protocol.artifacts.holdoutRawDirectory)),
      false,
      'PARTITIME_V2_HOLDOUT_ALREADY_OPENED',
    );
    return;
  }
  const thresholdPath = resolve(repoRoot, protocol.artifacts.thresholdReceiptPath);
  assert.ok(existsSync(thresholdPath), 'PARTITIME_V2_THRESHOLD_RECEIPT_MISSING');
  assert.equal(
    git(repoRoot, ['status', '--porcelain', '--', relative(repoRoot, thresholdPath)]),
    '',
    'PARTITIME_V2_THRESHOLD_RECEIPT_UNCOMMITTED',
  );
}

async function collectCycles() {
  const manifest = collectorManifest();
  const source = sourceIdentity();
  assertPhaseEntry(source);
  const environment = environmentIdentity();
  assertPinnedEnvironment(environment);
  const { staticUrl, cdp } = await preparedBrowser(selectedArm);
  const schedules = [
    ...protocol.workload.warmupSchedules.map((schedule, cycleIndex) => ({
      schedule,
      warmup: true,
      cycleIndex,
    })),
    ...protocol.workload.sampleSchedules.map((schedule, cycleIndex) => ({
      schedule,
      warmup: false,
      cycleIndex,
    })),
  ];
  const outputDirectory = resolve(repoRoot, outputOverride ?? defaultCycleDirectory());
  assert.equal(
    existsSync(outputDirectory),
    false,
    `PARTITIME_V2_OUTPUT_EXISTS: ${relative(repoRoot, outputDirectory)}`,
  );
  mkdirSync(outputDirectory, { recursive: true });
  const retained = [];
  let invalidAttempts = 0;
  for (const descriptor of schedules) {
    const label = descriptor.warmup ? 'warmup' : 'sample';
    let accepted = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const page = await cdp.newContextPage();
      let receipt;
      try {
        await page.navigate(`${staticUrl}/performance-v2.html`);
        await waitForBenchmarkApi(page);
        const measured = await measureCycle(page, descriptor.schedule);
        assert.deepEqual(page.state.pageErrors, [], 'PARTITIME_V2_PAGE_ERRORS');
        assert.deepEqual(page.state.externalRequests, [], 'PARTITIME_V2_EXTERNAL_NETWORK');
        const cycleEnvironment = environmentIdentity();
        assertPinnedEnvironment(cycleEnvironment);
        receipt = {
          schemaVersion: 'partitime.performance-v2-receipt.v1',
          kind: 'cycle',
          protocol: protocolIdentity(),
          source,
          environment: cycleEnvironment,
          valid: true,
          invalidReasons: [],
          dependencies: dependencies(manifest),
          cycle: {
            phase: collectPhase,
            arm: selectedArm,
            attempt,
            warmup: descriptor.warmup,
            cycleIndex: descriptor.cycleIndex,
            schedule: descriptor.schedule,
            observations: measured.observations,
            regression: measured.regression,
            metrics: measured.metrics,
          },
        };
      } catch (error) {
        invalidAttempts += 1;
        receipt = {
          schemaVersion: 'partitime.performance-v2-receipt.v1',
          kind: 'cycle',
          protocol: protocolIdentity(),
          source,
          environment: environmentIdentity(page.state.externalRequests.length),
          valid: false,
          invalidReasons: [{
            code: 'PARTITIME_V2_CYCLE_INVALID',
            message: error instanceof Error ? error.message : String(error),
          }],
          dependencies: dependencies(manifest),
          cycle: {
            phase: collectPhase,
            arm: selectedArm,
            attempt,
            warmup: descriptor.warmup,
            cycleIndex: descriptor.cycleIndex,
            schedule: descriptor.schedule,
            observations: [],
          },
        };
      } finally {
        await page.close();
      }
      writeReceipt(
        relative(repoRoot, join(
          outputDirectory,
          `${label}-${String(descriptor.cycleIndex + 1).padStart(2, '0')}`
          + `-attempt-${attempt}.json`,
        )),
        receipt,
      );
      if (receipt.valid) {
        accepted = receipt;
        retained.push(receipt);
        break;
      }
      if (invalidAttempts >= 3) {
        throw new Error(
          `PARTITIME_V2_INSTRUMENT_RED: three invalid ${collectPhase}/${selectedArm} attempts`,
        );
      }
    }
    if (accepted === null) {
      throw new Error(
        `PARTITIME_V2_INVALID_CYCLE: ${label} ${descriptor.cycleIndex + 1}; `
        + 'three complete attempts did not produce a valid receipt',
      );
    }
  }
  const samples = retained.filter(({ cycle }) => !cycle.warmup);
  const aggregate = aggregateMetricValues(samples);
  console.log(JSON.stringify({
    ok: true,
    mode: 'cycles',
    phase: collectPhase,
    arm: selectedArm,
    outputDirectory: relative(repoRoot, outputDirectory),
    warmups: retained.length - samples.length,
    samples: samples.length,
    aggregate,
  }, null, 2));
}

async function deriveThresholdReceipt() {
  const manifest = collectorManifest();
  const source = sourceIdentity();
  assertCleanSource(source);
  const environment = environmentIdentity();
  assertPinnedEnvironment(environment);
  const comparatorDirectory = resolve(repoRoot, protocol.artifacts.comparatorRawDirectory);
  assertCommittedPath(comparatorDirectory, 'PARTITIME_V2_COMPARATOR_UNCOMMITTED');
  assert.equal(
    existsSync(resolve(repoRoot, protocol.artifacts.holdoutRawDirectory)),
    false,
    'PARTITIME_V2_HOLDOUT_ALREADY_OPENED',
  );
  const comparator = loadAcceptedCycles(comparatorDirectory, {
    arm: 'react:snapback',
    phase: 'P0c-comparator',
  });
  for (const { receipt } of comparator.receipts) {
    assert.equal(
      receipt.dependencies.some(({ kind }) => (
        kind === 'contract-holdout' || kind === 'threshold-set'
      )),
      false,
      'PARTITIME_V2_JUDGED_ANCESTOR',
    );
  }
  const comparatorMetrics = aggregateMetricValues(
    comparator.samples.map(({ receipt }) => receipt),
  );
  const targets = deriveTargets(
    comparatorMetrics,
    protocol.targetDerivation.marginNumerator,
    protocol.targetDerivation.marginDenominator,
  );
  const comparatorReceiptDependencies = comparatorDependencies(comparator.samples);
  const identityPayload = thresholdIdentityPayload({
    protocolId: protocol.protocolId,
    workloadVersion: protocol.workloadVersion,
    thresholdFormulaSetId: protocol.thresholdFormulaSetId,
    comparatorReceiptDependencies,
    comparatorMetrics,
    targets,
  });
  const identity = thresholdSetId(identityPayload);
  const receipt = {
    schemaVersion: 'partitime.performance-v2-receipt.v1',
    kind: 'thresholds',
    protocol: protocolIdentity(),
    source,
    environment,
    valid: true,
    invalidReasons: [],
    dependencies: [
      ...dependencies(manifest),
      ...comparatorReceiptDependencies,
    ],
    thresholds: {
      phase: 'P0c',
      comparatorArm: 'react:snapback',
      sampleCount: 7,
      aggregation: 'nearest-rank-p95',
      comparatorMetrics,
      targets,
      thresholdSetId: identity,
      judgedArmDependencyCount: 0,
      committedBeforeHoldout: true,
    },
  };
  const output = writeReceipt(
    outputOverride ?? protocol.artifacts.thresholdReceiptPath,
    receipt,
  );
  console.log(JSON.stringify({
    ok: true,
    mode: 'thresholds',
    output,
    thresholdSetId: identity,
    comparatorMetrics,
    targets,
  }, null, 2));
}

async function aggregateHoldout() {
  const manifest = collectorManifest();
  const source = sourceIdentity();
  assertCleanSource(source);
  const environment = environmentIdentity();
  assertPinnedEnvironment(environment);
  const comparatorDirectory = resolve(repoRoot, protocol.artifacts.comparatorRawDirectory);
  const holdoutDirectory = resolve(repoRoot, protocol.artifacts.holdoutRawDirectory);
  const thresholdPath = resolve(repoRoot, protocol.artifacts.thresholdReceiptPath);
  for (const [path, code] of [
    [comparatorDirectory, 'PARTITIME_V2_COMPARATOR_UNCOMMITTED'],
    [holdoutDirectory, 'PARTITIME_V2_HOLDOUT_UNCOMMITTED'],
    [thresholdPath, 'PARTITIME_V2_THRESHOLD_UNCOMMITTED'],
  ]) {
    assertCommittedPath(path, code);
  }
  const thresholdReceipt = readJson(thresholdPath);
  assert.ok(validateReceipt(thresholdReceipt), 'PARTITIME_V2_THRESHOLD_RECEIPT_INVALID');
  assert.equal(thresholdReceipt.valid, true, 'PARTITIME_V2_THRESHOLD_RECEIPT_RED');
  const comparator = loadAcceptedCycles(comparatorDirectory, {
    arm: 'react:snapback',
    phase: 'P0c-comparator',
  });
  const holdout = loadAcceptedCycles(holdoutDirectory, {
    arm: 'contract:snapback',
    phase: 'P0c-holdout',
  });
  const actual = aggregateMetricValues(holdout.samples.map(({ receipt }) => receipt));
  const verdicts = metricVerdicts(actual, thresholdReceipt.thresholds.targets);
  const receipt = {
    schemaVersion: 'partitime.performance-v2-receipt.v1',
    kind: 'aggregate',
    protocol: protocolIdentity(),
    source,
    environment,
    valid: true,
    invalidReasons: [],
    dependencies: [
      ...dependencies(manifest),
      {
        kind: 'threshold-set',
        path: relative(repoRoot, thresholdPath),
        sha256: sha256(readFileSync(thresholdPath)),
      },
      ...comparatorDependencies(comparator.samples),
      ...holdoutDependencies(holdout.samples),
    ],
    aggregate: {
      phase: 'P0c',
      thresholdSetId: thresholdReceipt.thresholds.thresholdSetId,
      comparatorSampleCount: 7,
      holdoutSampleCount: 7,
      verdicts,
      pass: verdicts.every(({ pass }) => pass),
    },
  };
  const output = writeReceipt(outputOverride ?? protocol.artifacts.aggregatePath, receipt);
  console.log(JSON.stringify({
    ok: true,
    mode: 'aggregate',
    output,
    actual,
    verdicts,
    pass: receipt.aggregate.pass,
  }, null, 2));
}

async function check() {
  const manifest = collectorManifest();
  const scratchRoot = mkdtempSync(join(tmpdir(), 'partitime-v2-check-'));
  try {
    for (const arm of allowedArms) {
      const buildRoot = join(scratchRoot, `benchmark-${arm.split(':')[0]}`);
      buildSurface(arm, 'http://127.0.0.1:9', buildRoot);
      assert.ok(
        existsSync(join(buildRoot, 'performance-v2.html')),
        `PARTITIME_V2_BUILD_ENTRY_MISSING: ${arm}`,
      );
      verifyOrdinaryBuildExcludesBenchmark(arm, scratchRoot);
    }
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
  }
  console.log(JSON.stringify({
    ok: true,
    mode: 'check',
    protocol: protocolIdentity(),
    collector: {
      sha256: manifestDigest(manifest),
      files: manifest,
    },
    ordinaryProductionExcludesBenchmarkApi: true,
    governedSamplesCollected: false,
  }, null, 2));
}

async function cleanup() {
  const errors = [];
  while (cleanups.length > 0) {
    try {
      await cleanups.pop()();
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

let primaryError = NO_PRIMARY_FAILURE;
try {
  if (checkOnly) await check();
  else if (emitP0aPath) await emitP0a();
  else if (deriveThresholdsRequested) await deriveThresholdReceipt();
  else if (aggregateRequested) await aggregateHoldout();
  else await collectCycles();
} catch (error) {
  primaryError = error;
}
const cleanupErrors = await cleanup();
throwRunAndCleanupFailures({
  label: 'Partitime performance v2 collector',
  primaryError,
  cleanupErrors,
});
