#!/usr/bin/env node

// @ref LLP 0063#2026-07-23-two-part-subscription-memory-construct — the
// ordinary product entry measures fixed warm footprint; a separate no-DOM
// entry measures the fitted marginal cost of logical subscribers.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { arch, cpus, platform, release, tmpdir, totalmem } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchChromeCdp } from '../../../_kit/chrome-process.mjs';
import { writeMachineReport } from '../../../_kit/harness.mjs';
import { freePort } from '../../../_kit/provenance.mjs';
import {
  validateMemoryConstructAmendment,
  validateMemoryConstructRegistration,
} from './step4-memory-authority.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const demoRoot = resolve(here, '../..');
const repoRoot = resolve(demoRoot, '../..');
const amendmentPath = join(
  demoRoot,
  'acceptance/memory-construct-amendment.2026-07-23.json',
);
const protocolPath = join(demoRoot, 'acceptance/comparison-protocol.v1.json');
const amendment = JSON.parse(readFileSync(amendmentPath, 'utf8'));
const protocol = JSON.parse(readFileSync(protocolPath, 'utf8'));
const serverBin = join(repoRoot, 'target/debug/snapback');
const exactRoot = resolve(process.env.EXACT_ROOT ?? join(repoRoot, '..', 'exact'));
const chromeBin = process.env.CHROME_BIN
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const option = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? null : process.argv[index + 1];
};
const flag = (name) => process.argv.includes(`--${name}`);
const quick = flag('quick');
const validateOnly = flag('validate-only');
const cohort = option('cohort') ?? 'calibration';
const selectedArm = option('arm');
const selectedBackend = option('backend');
const calibrationRevision = option('calibration-revision');
const output = option('out') ?? join(
  demoRoot,
  'acceptance/results',
  `step4-memory-v2-${cohort}.json`,
);
const seed = Number(option('seed') ?? (quick ? 381 : Number.NaN));
const arms = selectedArm ? [selectedArm] : ['react', 'contract'];
const backends = selectedBackend
  ? [selectedBackend]
  : ['snapback', 'supabase', 'convex', 'sqlite'];
const cells = arms.flatMap((arm) => backends.map((backend) => ({ arm, backend })));
const counts = amendment.construct.marginal.counts;
const warmupsPerCount = quick ? 0 : amendment.sampling.warmupsPerCount;
const samplesPerCount = quick
  ? 1
  : amendment.sampling[`${cohort}SamplesPerCount`];
const totalWarmups = warmupsPerCount;
const totalSamples = samplesPerCount;
const cleanups = [];
const cleanupErrors = [];

validateMemoryConstructAmendment(amendment);
validateMemoryConstructRegistration(protocol, amendment);
const isMain = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  assert(['calibration', 'holdout'].includes(cohort), 'invalid memory cohort');
  assert(arms.every((arm) => ['react', 'contract'].includes(arm)), 'invalid memory arm');
  assert(
    backends.every((backend) => ['snapback', 'supabase', 'convex', 'sqlite'].includes(backend)),
    'invalid memory backend',
  );
  if (validateOnly) {
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 'partitime.step4-memory-v2-validator.v1',
      ok: true,
      amendmentId: amendment.amendmentId,
      status: amendment.status,
    })}\n`);
  } else {
    assert(Number.isSafeInteger(seed) && seed >= 0, '--seed must be a non-negative integer');
    if (!quick) {
      assert.equal(
        amendment.status,
        'ratified',
        'memory amendment must be ratified before calibration or holdout',
      );
      assert.equal(cells.length, 8, 'claim-eligible memory sampling requires all eight cells');
    }
    if (cohort === 'holdout' && !quick) {
      assert.match(
        calibrationRevision ?? '',
        /^[a-f0-9]{40}$/,
        'memory holdout requires --calibration-revision <committed sha>',
      );
    }
    await run();
  }
}

async function run() {
  assert(existsSync(serverBin), `missing Snapback server: ${serverBin}`);
  assert(existsSync(chromeBin), `missing Chrome: ${chromeBin}`);
  const cellReceipts = {};
  let backendHealth = null;
  let primaryError = null;
  try {
    const snapbackUrl = await startSnapback();
    const gateway = await startGateway(snapbackUrl);
    backendHealth = gateway.preflight;
    const random = seededRandom(seed);
    for (const cell of cells) {
      process.stderr.write(`[partitime-memory-v2] ${cellId(cell)} start\n`);
      assert.equal(
        gateway.preflight.backends?.[cell.backend]?.ok,
        true,
        `backend preflight failed for ${cell.backend}`,
      );
      const memoryOutput = buildCell(cell, snapbackUrl, gateway.url);
      let productPreview;
      let memoryPreview;
      let chrome;
      try {
        productPreview = await startPreview({
          cell,
          outDir: join(demoRoot, 'surfaces', cell.arm, 'dist', cell.backend),
          path: cell.arm === 'contract' ? '/partitime/' : '/',
        });
        memoryPreview = await startPreview({
          cell,
          outDir: memoryOutput,
          path: '/memory.html',
        });
        chrome = await launchChromeCdp({
          chromeBin,
          userDataPrefix: `partitime-memory-v2-${cell.arm}-${cell.backend}-`,
          stopOptions: { leaderCloseTimeoutMs: 10_000 },
        });
        await primeProductCache(chrome.ws, productPreview.url);
        await primeMemoryCache(chrome.ws, memoryPreview.url);
        cellReceipts[cellId(cell)] = await measureCell({
          cdpUrl: chrome.ws,
          cell,
          productUrl: productPreview.url,
          memoryUrl: memoryPreview.url,
          random,
        });
      } finally {
        for (const cleanup of [
          () => chrome?.stop(),
          () => memoryPreview?.stop(),
          () => productPreview?.stop(),
          () => rmSync(memoryOutput, { recursive: true, force: true }),
        ]) {
          try {
            await cleanup();
          } catch (error) {
            cleanupErrors.push(`${cellId(cell)}: ${errorMessage(error)}`);
          }
        }
      }
      process.stderr.write(`[partitime-memory-v2] ${cellId(cell)} complete\n`);
    }
  } catch (error) {
    primaryError = error;
  } finally {
    for (const cleanup of cleanups.reverse()) {
      try {
        await cleanup();
      } catch (error) {
        cleanupErrors.push(errorMessage(error));
      }
    }
  }
  if (primaryError) throw primaryError;
  assert.deepEqual(cleanupErrors, [], `memory-v2 cleanup failed: ${cleanupErrors.join('; ')}`);

  const claimEligible = !quick
    && cells.length === 8
    && Object.keys(cellReceipts).length === 8
    && Object.values(cellReceipts).every((cell) =>
      cell.marginal.observations.every(({ cleanupPass }) => cleanupPass));
  const thresholds = cohort === 'calibration' && claimEligible
    ? deriveMemoryCalibrationThresholds(cellReceipts)
    : null;
  const holdoutValidation = cohort === 'holdout' && claimEligible
    ? validateMemoryHoldout({
      repoRoot,
      calibrationRevision,
      calibrationPath: amendment.artifacts.calibration,
      amendmentIdentity: fileIdentity(amendmentPath),
      cells: cellReceipts,
    })
    : null;
  const thresholdSetId = cohort === 'calibration' && thresholds
    ? `partitime-ws8-memory-thresholds-v2-sha256-${sha256(JSON.stringify(thresholds)).slice(0, 16)}`
    : holdoutValidation?.calibration?.thresholdSetId ?? null;
  const report = {
    schemaVersion: 'partitime.step4-memory-v2.v1',
    claimId: amendment.replacement.claimId,
    cohort,
    claimEligible,
    quick,
    recordedAt: new Date().toISOString(),
    methodId: amendment.replacement.methodId,
    workloadVersion: amendment.replacement.workloadVersion,
    thresholdFormulaSetId: amendment.replacement.thresholdFormulaSetId,
    thresholdSetId,
    amendment: fileIdentity(amendmentPath),
    sampling: {
      seed,
      counts,
      warmupsPerCount,
      samplesPerCount,
      totalWarmups,
      totalSamples,
      outlierPolicy: amendment.sampling.outlierPolicy,
    },
    repository: {
      snapbackRevision: gitRevision(repoRoot),
      exactRevision: gitRevision(exactRoot),
      calibrationRevision: cohort === 'holdout' ? calibrationRevision : null,
    },
    environment: hostIdentity(),
    backendHealth,
    cleanupErrors,
    cells: cellReceipts,
    thresholds,
    holdoutValidation,
  };
  report.ok = claimEligible && (
    cohort === 'calibration'
      ? Object.keys(thresholds ?? {}).length === 4
      : holdoutValidation?.ok === true
  );
  writeMachineReport(output, report);
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

async function measureCell({ cdpUrl, cell, productUrl, memoryUrl, random }) {
  const total = [];
  for (let index = 0; index < totalWarmups + totalSamples; index += 1) {
    const value = await measureProductTotal(cdpUrl, productUrl);
    if (index >= totalWarmups) total.push(value);
  }

  const observations = [];
  const runOrders = [];
  for (let round = 0; round < warmupsPerCount + samplesPerCount; round += 1) {
    const measured = round >= warmupsPerCount;
    const order = shuffled(counts, random);
    runOrders.push({
      kind: measured ? 'sample' : 'warmup',
      round: measured ? round - warmupsPerCount + 1 : round + 1,
      counts: order,
    });
    for (const count of order) {
      const value = await measureMarginalObservation(cdpUrl, memoryUrl, count);
      if (measured) {
        observations.push({
          round: round - warmupsPerCount + 1,
          ...value,
        });
      }
    }
  }
  const fit = fitMarginalHeap(observations);
  return {
    cell: cellId(cell),
    total: {
      samples: total,
      p95: percentile(total, 0.95),
    },
    marginal: {
      runOrders,
      observations,
      fit,
      cleanupOk: observations.every(({ cleanupPass }) => cleanupPass),
    },
  };
}

async function primeProductCache(cdpUrl, url) {
  const cdp = await connectCdp(cdpUrl);
  try {
    const page = await cdp.newPage();
    try {
      await page.setCacheDisabled(false);
      await page.navigate(url);
      await page.waitForProductReady();
      await page.disposeProduct();
    } finally {
      await page.close();
    }
  } finally {
    cdp.close();
  }
}

async function primeMemoryCache(cdpUrl, url) {
  const cdp = await connectCdp(cdpUrl);
  try {
    const page = await cdp.newPage();
    try {
      await page.setCacheDisabled(false);
      await page.navigate(url);
      await page.waitForMemoryHarness();
      await page.startMemory(1);
      await page.disposeMemory();
    } finally {
      await page.close();
    }
  } finally {
    cdp.close();
  }
}

async function measureProductTotal(cdpUrl, url) {
  const cdp = await connectCdp(cdpUrl);
  try {
    const page = await cdp.newPage();
    try {
      await page.setCacheDisabled(false);
      const measured = new URL(url);
      measured.searchParams.set('memory_v2', nonce());
      await page.navigate(measured.href);
      await page.waitForProductReady();
      await page.twoFrames();
      await page.collectGarbage();
      const heap = await page.heapUsage();
      await page.disposeProduct();
      return heap.usedSize;
    } finally {
      await page.close();
    }
  } finally {
    cdp.close();
  }
}

async function measureMarginalObservation(cdpUrl, url, count) {
  const cdp = await connectCdp(cdpUrl);
  try {
    const page = await cdp.newPage();
    try {
      await page.setCacheDisabled(false);
      const measured = new URL(url);
      measured.searchParams.set('count', String(count));
      measured.searchParams.set('memory_v2', nonce());
      await page.navigate(measured.href);
      await page.waitForMemoryHarness();
      await page.startMemory(1);
      await page.disposeMemorySubscribers();
      await page.twoFrames();
      await page.collectGarbage();
      const baseline = (await page.heapUsage()).usedSize;
      const ready = await page.startMemory(count);
      assert.deepEqual(ready, { count, ready: count });
      await page.twoFrames();
      await page.collectGarbage();
      const usedSize = (await page.heapUsage()).usedSize;
      const cleanupSnapshot = await page.disposeMemorySubscribers();
      assert.deepEqual(cleanupSnapshot, { active: 0, ready: 0 });
      await page.twoFrames();
      await sleep(50);
      await page.collectGarbage();
      await sleep(50);
      await page.collectGarbage();
      const recoveredSize = (await page.heapUsage()).usedSize;
      await page.disposeMemory();
      const recoveryDelta = recoveredSize - baseline;
      return {
        count,
        baselineBytes: baseline,
        usedSizeBytes: usedSize,
        recoveredSizeBytes: recoveredSize,
        recoveryDeltaBytes: recoveryDelta,
        recoveredHeapRole: 'diagnostic-high-water-cache-evidence-only',
        cleanupSnapshot,
        cleanupPass: true,
      };
    } finally {
      await page.close();
    }
  } finally {
    cdp.close();
  }
}

export function fitMarginalHeap(observations) {
  assert(
    Array.isArray(observations) && observations.length >= 3,
    'marginal fit requires at least three observations',
  );
  const points = observations.map(({ count, usedSizeBytes }) => ({
    x: Number(count),
    y: Number(usedSizeBytes),
  }));
  assert(points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)));
  const n = points.length;
  const meanX = points.reduce((sum, { x }) => sum + x, 0) / n;
  const meanY = points.reduce((sum, { y }) => sum + y, 0) / n;
  const sxx = points.reduce((sum, { x }) => sum + ((x - meanX) ** 2), 0);
  assert(sxx > 0, 'marginal fit requires more than one subscriber count');
  const slope = points.reduce(
    (sum, { x, y }) => sum + ((x - meanX) * (y - meanY)),
    0,
  ) / sxx;
  const intercept = meanY - (slope * meanX);
  const residualSumSquares = points.reduce(
    (sum, { x, y }) => sum + ((y - (intercept + (slope * x))) ** 2),
    0,
  );
  const degreesOfFreedom = n - 2;
  assert(degreesOfFreedom > 0);
  const standardError = Math.sqrt(
    (residualSumSquares / degreesOfFreedom) / sxx,
  );
  const critical = oneSidedT95(degreesOfFreedom);
  return {
    estimator: 'ordinary-least-squares-with-intercept',
    observationCount: n,
    degreesOfFreedom,
    interceptBytes: intercept,
    slopeBytesPerLogicalSubscription: slope,
    slopeStandardErrorBytes: standardError,
    oneSidedT95: critical,
    upper95BytesPerLogicalSubscription: slope + (critical * standardError),
    residualSumSquares,
  };
}

export function deriveMemoryCalibrationThresholds(cellReceipts) {
  const thresholds = {};
  for (const backend of ['snapback', 'supabase', 'convex', 'sqlite']) {
    const react = cellReceipts[`react:${backend}`];
    assert(react, `missing React memory calibration for ${backend}`);
    thresholds[`contract:${backend}`] = {
      sourceCell: `react:${backend}`,
      warmHeapTotalBytesP95: Math.floor(react.total.p95 * 1.10),
      marginalHeapBytesPerLogicalSubscriptionUpper95: Math.floor(Math.max(
        react.marginal.fit.upper95BytesPerLogicalSubscription * 1.10,
        4096,
      )),
    };
  }
  return thresholds;
}

export function validateMemoryHoldout({
  repoRoot: root,
  calibrationRevision: revision,
  calibrationPath,
  amendmentIdentity,
  cells: cellReceipts,
  readCommitted = (commit, path) => {
    const child = spawnSync('git', ['show', `${commit}:${path}`], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(child.status, 0, `cannot read committed memory calibration ${commit}:${path}`);
    return child.stdout;
  },
}) {
  const bytes = readCommitted(revision, calibrationPath);
  const calibration = JSON.parse(bytes);
  assert.equal(calibration.schemaVersion, 'partitime.step4-memory-v2.v1');
  assert.equal(calibration.cohort, 'calibration');
  assert.equal(calibration.claimEligible, true);
  assert.equal(calibration.quick, false);
  assert.deepEqual(calibration.amendment, amendmentIdentity);
  assert.equal(calibration.methodId, 'partitime-ws8-memory-v2');
  assert.equal(calibration.workloadVersion, 'partitime.web-memory-fit.v2');
  assert.match(
    calibration.thresholdSetId,
    /^partitime-ws8-memory-thresholds-v2-sha256-[a-f0-9]{16}$/,
  );
  assert.deepEqual(calibration.sampling.counts, [1, 8, 32, 64]);
  assert.equal(calibration.sampling.samplesPerCount, 7);
  const rows = [];
  for (const [cell, threshold] of Object.entries(calibration.thresholds)) {
    const actual = cellReceipts[cell];
    for (const metricName of [
      'warmHeapTotalBytesP95',
      'marginalHeapBytesPerLogicalSubscriptionUpper95',
    ]) {
      const actualValue = metricName === 'warmHeapTotalBytesP95'
        ? actual?.total?.p95
        : actual?.marginal?.fit?.upper95BytesPerLogicalSubscription;
      const limit = threshold[metricName];
      rows.push({
        cell,
        metricName,
        actual: Number.isFinite(actualValue) ? actualValue : null,
        threshold: limit,
        pass: Number.isFinite(actualValue) && actualValue <= limit,
      });
    }
  }
  return {
    calibration: {
      revision,
      path: calibrationPath,
      sha256: sha256(bytes),
      thresholdSetId: calibration.thresholdSetId,
    },
    rows,
    ok: rows.length === 8 && rows.every(({ pass }) => pass),
  };
}

function oneSidedT95(degreesOfFreedom) {
  const values = new Map([
    [1, 6.313752],
    [2, 2.919986],
    [3, 2.353363],
    [4, 2.131847],
    [5, 2.015048],
    [6, 1.94318],
    [7, 1.894579],
    [8, 1.859548],
    [9, 1.833113],
    [10, 1.812461],
    [14, 1.76131],
    [18, 1.734064],
    [22, 1.717144],
    [26, 1.705618],
    [30, 1.697261],
  ]);
  if (values.has(degreesOfFreedom)) return values.get(degreesOfFreedom);
  if (degreesOfFreedom > 30) return 1.644854;
  const lower = [...values.keys()].filter((value) => value < degreesOfFreedom).at(-1);
  const upper = [...values.keys()].find((value) => value > degreesOfFreedom);
  assert(lower && upper, `unsupported t degrees of freedom: ${degreesOfFreedom}`);
  const fraction = (degreesOfFreedom - lower) / (upper - lower);
  return values.get(lower) + (fraction * (values.get(upper) - values.get(lower)));
}

function buildCell(cell, snapbackUrl, gatewayUrl) {
  const surface = join(demoRoot, 'surfaces', cell.arm);
  const commonEnv = {
    ...process.env,
    SNAPBACK_PARTIFUL_MATRIX_API: snapbackUrl,
    PARTIFUL_MATRIX_GATEWAY: gatewayUrl,
    PARTITIME_DISABLE_POLL_FALLBACK: '1',
  };
  const product = spawnSync('bun', ['run', `build:${cell.backend}`], {
    cwd: surface,
    encoding: 'utf8',
    env: commonEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(
    product.status,
    0,
    `${cellId(cell)} product build failed: ${(product.stderr ?? '').slice(-4000)}`,
  );
  const memoryOutput = mkdtempSync(join(
    tmpdir(),
    `partitime-memory-v2-${cell.arm}-${cell.backend}-`,
  ));
  const vite = join(surface, 'node_modules/.bin/vite');
  const args = cell.arm === 'contract'
    ? [
        '--bun',
        vite,
        'build',
        '--config',
        join(surface, 'vite.config.ts'),
        '--mode',
        cell.backend,
        '--outDir',
        memoryOutput,
      ]
    : [
        vite,
        'build',
        '--config',
        join(surface, 'vite.config.mts'),
        '--mode',
        cell.backend,
        '--outDir',
        memoryOutput,
      ];
  const memory = spawnSync('bun', args, {
    cwd: surface,
    encoding: 'utf8',
    env: { ...commonEnv, PARTITIME_MEMORY_ENTRY: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (memory.status !== 0) rmSync(memoryOutput, { recursive: true, force: true });
  assert.equal(
    memory.status,
    0,
    `${cellId(cell)} memory build failed: ${(memory.stderr ?? '').slice(-4000)}`,
  );
  return memoryOutput;
}

async function startSnapback() {
  const readyDir = mkdtempSync(join(tmpdir(), 'partitime-memory-v2-api-'));
  const readyFile = join(readyDir, 'ready.json');
  const child = spawn(serverBin, ['--port', '0', '--memory', '--ready-file', readyFile], {
    cwd: repoRoot,
    detached: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let log = '';
  child.stderr.on('data', (chunk) => { log += chunk; });
  cleanups.push(
    () => rmSync(readyDir, { recursive: true, force: true }),
    () => stopChild(child, 'Snapback'),
  );
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (existsSync(readyFile)) {
      const { port } = JSON.parse(readFileSync(readyFile, 'utf8'));
      const url = `http://127.0.0.1:${port}`;
      await waitUrl(`${url}/health`, child, 'Snapback');
      return url;
    }
    assert.equal(child.exitCode, null, `Snapback exited before readiness: ${log.slice(-2000)}`);
    await sleep(100);
  }
  throw new Error('Snapback readiness timed out');
}

async function startGateway(snapbackUrl) {
  const port = await freePort();
  const child = spawn('bun', ['run', 'server.ts'], {
    cwd: join(demoRoot, 'backends/gateway'),
    detached: true,
    env: {
      ...process.env,
      PARTIFUL_MATRIX_GATEWAY_PORT: String(port),
      PARTIFUL_MATRIX_SNAPBACK_ORIGIN: snapbackUrl,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (chunk) => { log += chunk; });
  child.stderr.on('data', (chunk) => { log += chunk; });
  cleanups.push(() => stopChild(child, 'matrix gateway'));
  const url = `http://127.0.0.1:${port}`;
  await waitUrl(`${url}/health`, child, 'matrix gateway');
  const response = await fetch(`${url}/preflight`, {
    signal: AbortSignal.timeout(30_000),
  });
  assert(response.ok, `matrix gateway preflight HTTP ${response.status}: ${log.slice(-2000)}`);
  return { url, preflight: await response.json() };
}

async function startPreview({ cell, outDir, path }) {
  const surface = join(demoRoot, 'surfaces', cell.arm);
  const vite = join(surface, 'node_modules/.bin/vite');
  const configDir = mkdtempSync(join(tmpdir(), 'partitime-memory-preview-'));
  const config = join(configDir, 'vite.config.mjs');
  writeFileSync(config, `export default ${JSON.stringify({
    root: surface,
    base: path.startsWith('/partitime/') ? '/partitime/' : '/',
    preview: { host: '127.0.0.1' },
  })};\n`);
  const port = await freePort();
  const child = spawn('bun', [
    '--bun',
    vite,
    'preview',
    '--config',
    config,
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--strictPort',
    '--outDir',
    outDir,
  ], {
    cwd: surface,
    detached: true,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (chunk) => { log += chunk; });
  child.stderr.on('data', (chunk) => { log += chunk; });
  const url = new URL(path, `http://127.0.0.1:${port}`).href;
  try {
    await waitUrl(url, child, `${cellId(cell)} preview`);
  } catch (error) {
    try {
      await stopChild(child, `${cellId(cell)} preview`);
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
    throw new Error(`${errorMessage(error)}: ${log.slice(-3000)}`);
  }
  return {
    url,
    stop: async () => {
      try {
        await stopChild(child, `${cellId(cell)} preview`);
      } finally {
        rmSync(configDir, { recursive: true, force: true });
      }
    },
  };
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', () => reject(new Error('CDP connection failed')), {
      once: true,
    });
  });
  socket.addEventListener('message', async (event) => {
    const message = JSON.parse(
      typeof event.data === 'string' ? event.data : await event.data.text(),
    );
    if (!message.id || !pending.has(message.id)) return;
    const request = pending.get(message.id);
    clearTimeout(request.timer);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result ?? {});
  });
  const send = (method, params = {}, sessionId = null, timeoutMs = 60_000) =>
    new Promise((resolveSend, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeoutMs);
      pending.set(id, { resolve: resolveSend, reject, timer });
      socket.send(JSON.stringify(
        sessionId ? { id, method, params, sessionId } : { id, method, params },
      ));
    });
  return {
    close: () => socket.close(),
    newPage: async () => {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', {
        targetId,
        flatten: true,
      });
      await send('Page.enable', {}, sessionId);
      await send('Runtime.enable', {}, sessionId);
      await send('Network.enable', {}, sessionId);
      await send('Page.addScriptToEvaluateOnNewDocument', {
        source: productObserverSource(),
      }, sessionId);
      const evaluate = async (expression, timeoutMs = 60_000) => {
        const result = await send('Runtime.evaluate', {
          expression,
          awaitPromise: true,
          returnByValue: true,
        }, sessionId, timeoutMs);
        if (result.exceptionDetails) {
          throw new Error(
            result.exceptionDetails.exception?.description
              ?? result.exceptionDetails.text,
          );
        }
        return result.result?.value;
      };
      return {
        navigate: async (pageUrl) => {
          await send('Page.navigate', { url: pageUrl }, sessionId);
          const deadline = Date.now() + 30_000;
          while (Date.now() < deadline) {
            try {
              if (await evaluate(`document.readyState !== 'loading'`)) return;
            } catch {
              // Execution context is replaced during navigation.
            }
            await sleep(25);
          }
          throw new Error(`navigation timed out: ${pageUrl}`);
        },
        close: async () => {
          try {
            const result = await send('Target.closeTarget', { targetId }, null, 5_000);
            assert.notEqual(result.success, false, `Chrome refused to close target ${targetId}`);
          } catch {
            const { targetInfos = [] } = await send('Target.getTargets', {}, null, 5_000);
            assert(!targetInfos.some((target) => target.targetId === targetId));
          }
        },
        setCacheDisabled: (cacheDisabled) =>
          send('Network.setCacheDisabled', { cacheDisabled }, sessionId),
        collectGarbage: () => send('HeapProfiler.collectGarbage', {}, sessionId),
        heapUsage: () => send('Runtime.getHeapUsage', {}, sessionId),
        twoFrames: () => evaluate(
          'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))',
        ),
        waitForProductReady: () => evaluate(`(async()=>{
          const deadline=Date.now()+30000;
          while(Date.now()<deadline){
            const value=globalThis.__partitimeMemoryProduct?.snapshot();
            if(value?.liveAt!=null)return value;
            await new Promise(resolve=>setTimeout(resolve,25));
          }
          throw new Error('product feed did not reach live data');
        })()`),
        disposeProduct: () => evaluate(`(async()=>{
          const ready=await globalThis.partifulMatrixReady;
          await ready?.dispose?.();
          return true;
        })()`),
        waitForMemoryHarness: () => evaluate(`(async()=>{
          const deadline=Date.now()+30000;
          while(Date.now()<deadline){
            if(globalThis.partitimeMemoryHarnessReady){
              const value=await globalThis.partitimeMemoryHarnessReady;
              if(value)return {arm:value.arm,backend:value.backend};
            }
            await new Promise(resolve=>setTimeout(resolve,25));
          }
          throw new Error('memory harness did not become ready');
        })()`),
        startMemory: (count) => evaluate(
          `(async()=>globalThis.partitimeMemoryHarness.start(${JSON.stringify(count)}))()`,
        ),
        disposeMemorySubscribers: () => evaluate(`(async()=>{
          await globalThis.partitimeMemoryHarness.disposeSubscribers();
          return globalThis.partitimeMemoryHarness.snapshot();
        })()`),
        disposeMemory: () => evaluate(`(async()=>{
          await globalThis.partitimeMemoryHarness.dispose();
          delete globalThis.partitimeMemoryHarnessReady;
          return true;
        })()`),
      };
    },
  };
}

function productObserverSource() {
  return `(()=>{
    const state={authoritativeAt:null,liveAt:null,bootReadyAt:null};
    const scan=()=>{
      const now=performance.now();
      const ready=document.querySelector('[data-testid="event-card-event_sunset"]');
      if(state.authoritativeAt==null&&ready&&ready.textContent?.trim())state.authoritativeAt=now;
      const connection=document.querySelector('[data-testid="connection"]')?.textContent?.toLowerCase()??'';
      if(state.liveAt==null&&state.authoritativeAt!=null&&state.bootReadyAt!=null&&(/live|polling/.test(connection)))state.liveAt=Math.max(now,state.bootReadyAt);
    };
    let matrixReady;
    Object.defineProperty(globalThis,'partifulMatrixReady',{
      configurable:true,
      get:()=>matrixReady,
      set:(value)=>{
        matrixReady=value;
        Promise.resolve(value).then(()=>{state.bootReadyAt=performance.now();scan();},()=>{});
      },
    });
    const observer=new MutationObserver(()=>scan());
    const start=()=>{observer.observe(document,{subtree:true,childList:true,attributes:true,characterData:true});scan();};
    document.readyState==='loading'?addEventListener('DOMContentLoaded',start,{once:true}):start();
    globalThis.__partitimeMemoryProduct={snapshot:()=>({...state})};
  })();`;
}

function seededRandom(seedValue) {
  let state = (seedValue >>> 0) || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function shuffled(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const selected = Math.floor(random() * (index + 1));
    [result[index], result[selected]] = [result[selected], result[index]];
  }
  return result;
}

function percentile(values, fraction) {
  assert(values.length > 0);
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * fraction) - 1];
}

async function waitUrl(url, child, label) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // Retry until the owned process exits or the deadline closes.
    }
    if (child.exitCode !== null) throw new Error(`${label} exited with ${child.exitCode}`);
    await sleep(100);
  }
  throw new Error(`${label} readiness timed out: ${url}`);
}

async function stopChild(child, label) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise((resolveClose) => child.once('close', resolveClose));
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  if (await Promise.race([closed.then(() => true), sleep(5_000).then(() => false)])) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
  assert(
    await Promise.race([closed.then(() => true), sleep(5_000).then(() => false)]),
    `${label} did not stop`,
  );
}

function hostIdentity() {
  const chrome = spawnSync(chromeBin, ['--version'], { encoding: 'utf8' });
  return {
    node: process.version,
    os: `${platform()}-${release()}-${arch()}`,
    chrome: chrome.stdout?.trim() ?? null,
    cpu: cpus()[0]?.model ?? null,
    logicalCpus: cpus().length,
    totalMemoryBytes: totalmem(),
  };
}

function gitRevision(root) {
  const child = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(child.status, 0, `git revision failed under ${root}`);
  return child.stdout.trim();
}

function fileIdentity(path) {
  return { path: relative(repoRoot, path), sha256: sha256(readFileSync(path)) };
}

function nonce() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cellId({ arm, backend }) {
  return `${arm}:${backend}`;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
