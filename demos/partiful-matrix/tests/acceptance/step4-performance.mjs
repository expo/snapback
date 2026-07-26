#!/usr/bin/env node

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
import { pathToFileURL } from 'node:url';

import { launchChromeCdp } from '../../../_kit/chrome-process.mjs';
import { freePort } from '../../../_kit/provenance.mjs';
import { writeMachineReport } from '../../../_kit/harness.mjs';
import {
  closeTargetReliably,
  freshBrowserCommand,
} from './cdp-target-cleanup.mjs';

// @ref LLP 0063#workstream-8--performance-and-packaging-budgets — one
// external instrument measures all twelve production web cells without
// injecting benchmark code into the candidate bundles. Calibration and
// holdout are separate invocations; holdout reads a committed calibration.

const here = dirname(new URL(import.meta.url).pathname);
const repoRoot = resolve(here, '../../../..');
const demoRoot = resolve(here, '../..');
const amendmentPath = join(demoRoot, 'acceptance', 'performance-amendment.2026-07-21.json');
const previousInvalidationPath = join(demoRoot, 'acceptance', 'performance-invalidation-amendment.2026-07-22.json');
const invalidationPath = join(demoRoot, 'acceptance', 'performance-invalidation-amendment.2026-07-23.json');
const protocolPath = join(demoRoot, 'acceptance', 'comparison-protocol.v1.json');
const amendment = JSON.parse(readFileSync(amendmentPath, 'utf8'));
const previousInvalidation = JSON.parse(readFileSync(previousInvalidationPath, 'utf8'));
const invalidation = JSON.parse(readFileSync(invalidationPath, 'utf8'));
const protocol = JSON.parse(readFileSync(protocolPath, 'utf8'));
const serverBin = join(repoRoot, 'target', 'debug', 'snapback');
const exactRoot = resolve(process.env.EXACT_ROOT ?? join(repoRoot, '..', 'exact'));
const chromeBin = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const option = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? null : process.argv[at + 1];
};
const flag = (name) => process.argv.includes(`--${name}`);
const cohort = option('cohort') ?? 'calibration';
assert(['calibration', 'holdout'].includes(cohort), '--cohort must be calibration or holdout');
const quick = flag('quick');
const warmups = quick ? 0 : amendment.sampling.warmups;
const samples = quick ? 1 : amendment.sampling[`${cohort}Samples`];
const idleWindowMs = quick ? 200 : amendment.web.idle.windowMs;
const selectedArm = option('arm');
const selectedBackend = option('backend');
const arms = selectedArm ? [selectedArm] : ['react', 'contract', 'vanilla'];
const backends = selectedBackend ? [selectedBackend] : ['snapback', 'supabase', 'convex', 'sqlite'];
const cells = arms.flatMap((arm) => backends.map((backend) => ({ arm, backend })));
const runWeb = !flag('build-only');
const runBuild = !flag('web-only');
const calibrationRevision = option('calibration-revision');
const output = option('out') ?? join(
  demoRoot,
  'acceptance',
  'results',
  `step4-performance-${cohort}.json`,
);

if (cohort === 'holdout' && !quick) {
  assert.match(calibrationRevision ?? '', /^[a-f0-9]{40}$/, 'holdout requires --calibration-revision <committed sha>');
}
assert.equal(amendment.appliesToProtocolId, protocol.protocolId);
assert.equal(amendment.appliesToWorkloadVersion, protocol.workloadVersion);
assert.equal(invalidation.appliesToProtocolId, protocol.protocolId);
assert.equal(invalidation.appliesToWorkloadVersion, protocol.workloadVersion);
assert.equal(invalidation.invalidates.methodId, previousInvalidation.replacement.methodId);
assert.equal(invalidation.invalidates.thresholdSetId, previousInvalidation.replacement.thresholdSetId);
assert(Number.isFinite(invalidation.replacement.idleCpuResolutionFloorMsPerSecond));
assert(invalidation.replacement.idleCpuResolutionFloorMsPerSecond >= 0);
assert.equal(
  invalidation.requiredRatificationStatement,
  'I ratify partitime-ws8-web-instrument-v3-2026-07-23.',
  'performance v3 ratification statement drifted',
);
if (!quick) {
  assert.equal(amendment.status, 'ratified', 'performance amendment must be ratified before claim-eligible sampling');
  assert.equal(invalidation.status, 'ratified', 'performance invalidation amendment must be ratified before v3 claim-eligible sampling');
  assert.equal(
    invalidation.ratificationStatement,
    invalidation.requiredRatificationStatement,
    'performance v3 sampling requires the exact owner ratification statement',
  );
}
assert(existsSync(serverBin), `missing Snapback server: ${serverBin}`);
assert(existsSync(chromeBin), `missing Chrome: ${chromeBin}`);

const cleanups = [];
const cleanupErrors = [];
const cellReceipts = {};
const buildReceipts = {};
let backendHealth = null;

try {
  const snapbackUrl = await startSnapback();
  const gateway = await startGateway(snapbackUrl);
  backendHealth = gateway.preflight;
  for (const backend of new Set(cells.map((cell) => cell.backend))) {
    const health = gateway.preflight.backends?.[backend];
    assert(
      health?.ok === true,
      `backend preflight failed for ${backend}: ${JSON.stringify(health)}`,
    );
  }
  if (runWeb) {
    for (const cell of cells) {
      process.stderr.write(`[partitime-performance] web ${cellId(cell)} start\n`);
      buildMeasurementCell(cell, snapbackUrl, gateway.url);
      let chrome;
      let preview;
      let runError = null;
      const cellCleanupErrors = [];
      try {
        chrome = await launchChromeCdp({
          chromeBin,
          userDataPrefix: `partitime-perf-${cell.arm}-${cell.backend}-`,
          // @ref LLP 0015#acceptance-rules — claim receipts still require
          // process-group ESRCH plus leader close. Chrome can publish its
          // process exit before inherited diagnostic pipes close, so this
          // long matrix gives the second attestation a wider bounded window.
          stopOptions: { leaderCloseTimeoutMs: 10_000 },
        });
        preview = await startPreview(cell, snapbackUrl, gateway.url);
        cellReceipts[cellId(cell)] = await measureWebCell(chrome.ws, cell, preview.url);
      } catch (error) {
        runError = error;
      } finally {
        for (const cleanup of [
          () => preview?.stop(),
          () => chrome?.stop(),
        ]) {
          try { await cleanup(); } catch (error) {
            const message = `${cellId(cell)}: ${error instanceof Error ? error.message : String(error)}`;
            cellCleanupErrors.push(message);
            cleanupErrors.push(message);
          }
        }
      }
      if (runError) throw runError;
      assert.deepEqual(cellCleanupErrors, [], `${cellId(cell)} browser cleanup failed`);
      process.stderr.write(`[partitime-performance] web ${cellId(cell)} complete\n`);
    }
  }
  if (runBuild) {
    for (const cell of cells) {
      process.stderr.write(`[partitime-performance] build ${cellId(cell)} start\n`);
      buildReceipts[cellId(cell)] = await measureBuildCell(cell);
      process.stderr.write(`[partitime-performance] build ${cellId(cell)} complete\n`);
    }
  }
} finally {
  for (const cleanup of cleanups.reverse()) {
    try { await cleanup(); } catch (error) {
      cleanupErrors.push(error instanceof Error ? error.message : String(error));
    }
  }
}
assert.deepEqual(cleanupErrors, [], `performance collector cleanup failed: ${cleanupErrors.join('; ')}`);

const report = {
  schemaVersion: 'partitime.step4-performance.v1',
  claimId: 'STEP4.BUDGETS.PROSPECTIVE_PERFORMANCE',
  cohort,
  claimEligible: !quick && cells.length === 12 && runWeb && runBuild,
  quick,
  recordedAt: new Date().toISOString(),
  workloadVersion: protocol.workloadVersion,
  methodId: invalidation.replacement.methodId,
  thresholdSetId: invalidation.replacement.thresholdSetId,
  amendment: fileIdentity(amendmentPath),
  invalidation: fileIdentity(invalidationPath),
  sampling: { warmups, samples, idleWindowMs },
  repository: {
    snapbackRevision: gitRevision(repoRoot),
    exactRevision: maybeGitRevision(exactRoot),
    calibrationRevision: cohort === 'holdout' ? calibrationRevision : null,
  },
  environment: hostIdentity(),
  backendHealth,
  cleanupErrors,
  cells: cellReceipts,
  buildCells: buildReceipts,
  thresholds: cohort === 'calibration' ? deriveCalibrationThresholds(cellReceipts, buildReceipts) : null,
  holdoutValidation: cohort === 'holdout' && !quick
    ? validateHoldout(calibrationRevision, cellReceipts, buildReceipts)
    : null,
};
report.ok = report.claimEligible && (
  cohort === 'calibration'
    ? Object.keys(report.thresholds ?? {}).length > 0
    : report.holdoutValidation?.ok === true
);
writeMachineReport(relative(repoRoot, output), report);
console.log(JSON.stringify(report));

async function measureWebCell(cdpUrl, cell, previewUrl) {
  const cold = [];
  const warm = [];
  for (let index = 0; index < warmups + samples; index += 1) {
    const measured = index >= warmups;
    const turn = measured ? `sample-${index - warmups + 1}` : `warmup-${index + 1}`;
    const coldSample = await measureNavigation(cdpUrl, cell, previewUrl, { warm: false, turn });
    if (measured) cold.push(coldSample);
    const warmSample = await measureNavigation(cdpUrl, cell, previewUrl, { warm: true, turn });
    if (measured) warm.push(warmSample);
  }
  return {
    cell: cellId(cell),
    transport: cell.backend === 'snapback' ? 'push' : 'poll',
    samples: { cold, warm },
    aggregate: {
      coldStartupMs: aggregate(cold.map((sample) => sample.startupMs)),
      warmStartupMs: aggregate(warm.map((sample) => sample.startupMs)),
      firstAuthoritativeDataMs: aggregate(cold.map((sample) => sample.firstAuthoritativeDataMs)),
      firstLiveDataMs: aggregate(cold.map((sample) => sample.firstLiveDataMs)),
      idleCpuTaskMsPerSecond: aggregate(warm.map((sample) => sample.idle.cpuTaskMsPerSecond)),
      idleNetworkBytesPerSecond: aggregate(warm.map((sample) => sample.idle.networkBytesPerSecond)),
      memoryPerActiveSubscriptionBytes: aggregate(warm.map((sample) => sample.memoryPerActiveSubscriptionBytes)),
      updateFanoutCount: aggregate(warm.map((sample) => sample.update.fanout)),
      domOrHostPatchCount: aggregate(warm.map((sample) => sample.update.patches)),
    },
  };
}

async function measureNavigation(cdpUrl, cell, previewUrl, { warm, turn }) {
  // A fresh browser-level socket per navigation prevents stale flattened
  // target sessions from accumulating across the 216-navigation full matrix.
  // Socket setup occurs before every in-page performance clock begins.
  const cdp = await connectCdp(cdpUrl);
  let page;
  let cachePrimePage;
  try {
    if (warm) {
      // @ref LLP 0063#workstream-8--performance-and-packaging-budgets — warm
      // means a primed HTTP cache, not a second application document retained
      // in this measurement target's back/forward cache. Prime and close a
      // sibling target so heap and idle instruments still cover one page and
      // the declared one active logical subscription.
      cachePrimePage = await cdp.newPage();
      await cachePrimePage.setCacheDisabled(false);
      await cachePrimePage.navigate(previewUrl);
      await cachePrimePage.waitForLiveData();
      await cachePrimePage.close();
      cachePrimePage = null;
    }
    page = await cdp.newPage();
    await page.setCacheDisabled(!warm);
    if (!warm) await page.clearBrowserCache();
    await page.resetNetworkBytes();
    const measuredUrl = new URL(previewUrl);
    measuredUrl.searchParams.set('perf', `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    await page.navigate(measuredUrl.href);
    const milestones = await page.waitForLiveData();
    assert(Number.isFinite(milestones.firstUiAt), `${cellId(cell)} did not expose first UI: ${JSON.stringify(milestones)}`);
    assert(Number.isFinite(milestones.authoritativeAt), `${cellId(cell)} did not expose authoritative data: ${JSON.stringify(milestones)}`);
    assert(Number.isFinite(milestones.liveAt), `${cellId(cell)} did not expose live/current data: ${JSON.stringify(milestones)}`);
    await page.collectGarbage();
    const heap = await page.heapUsage();
    const beforeMetrics = await page.performanceMetrics();
    await page.resetNetworkBytes();
    await sleep(idleWindowMs);
    const afterMetrics = await page.performanceMetrics();
    const idleNetworkBytes = await page.networkBytes();
    const taskSeconds = metric(afterMetrics, 'TaskDuration') - metric(beforeMetrics, 'TaskDuration');
    await page.beginUpdate();
    await page.click('open-event_swim');
    let update;
    try {
      update = await page.waitForEventPage();
    } catch (error) {
      const diagnostic = await page.diagnostic();
      throw new Error(`${cellId(cell)} ${turn} ${warm ? 'warm' : 'cold'} update failed: ${error instanceof Error ? error.message : String(error)}; ${JSON.stringify(diagnostic)}`);
    }
    return {
      startupMs: milestones.firstUiAt,
      firstAuthoritativeDataMs: milestones.authoritativeAt,
      firstLiveDataMs: milestones.liveAt,
      idle: {
        windowMs: idleWindowMs,
        cpuTaskMsPerSecond: (taskSeconds * 1_000) / (idleWindowMs / 1_000),
        networkBytes: idleNetworkBytes,
        networkBytesPerSecond: idleNetworkBytes / (idleWindowMs / 1_000),
      },
      activeLogicalSubscriptions: amendment.web.memory.logicalSubscriptions,
      heapUsedBytes: heap.usedSize,
      memoryPerActiveSubscriptionBytes: heap.usedSize / amendment.web.memory.logicalSubscriptions,
      update,
    };
  } finally {
    try {
      if (page) await page.close();
    } finally {
      try {
        if (cachePrimePage) await cachePrimePage.close();
      } finally {
        cdp.close();
      }
    }
  }
}

async function measureBuildCell(cell) {
  const production = [];
  for (let index = 0; index < warmups + samples; index += 1) {
    const value = measureProductionBuild(cell);
    if (index >= warmups) production.push(value);
  }
  const incremental = await measureIncrementalBuilds(cell);
  return {
    cell: cellId(cell),
    samples: { production, incremental },
    aggregate: {
      productionBuildMs: aggregate(production.map(({ durationMs }) => durationMs)),
      incrementalBuildMs: aggregate(incremental.map(({ durationMs }) => durationMs)),
    },
  };
}

function buildMeasurementCell(cell, snapbackUrl, gatewayUrl) {
  const surface = join(demoRoot, 'surfaces', cell.arm);
  const child = spawnSync('bun', ['run', `build:${cell.backend}`], {
    cwd: surface,
    encoding: 'utf8',
    env: {
      ...process.env,
      SNAPBACK_PARTIFUL_MATRIX_API: snapbackUrl,
      PARTIFUL_MATRIX_GATEWAY: gatewayUrl,
      PARTITIME_DISABLE_POLL_FALLBACK: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(child.status, 0, `${cellId(cell)} measurement build failed: ${(child.stderr ?? '').slice(-4000)}`);
}

function measureProductionBuild(cell) {
  const surface = join(demoRoot, 'surfaces', cell.arm);
  const vite = join(surface, 'node_modules', '.bin', 'vite');
  const out = mkdtempSync(join(tmpdir(), `partitime-build-${cell.arm}-${cell.backend}-`));
  const started = process.hrtime.bigint();
  const child = spawnSync(cell.arm === 'contract' ? 'bun' : vite, cell.arm === 'contract'
    ? ['--bun', vite, 'build', '--config', join(surface, 'vite.config.ts'), '--mode', cell.backend, '--outDir', out]
    : ['build', '--mode', cell.backend, '--outDir', out], {
    cwd: surface,
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  rmSync(out, { recursive: true, force: true });
  assert.equal(child.status, 0, `${cellId(cell)} production build failed: ${(child.stderr ?? '').slice(-4000)}`);
  return {
    durationMs,
    stdoutSha256: sha256(child.stdout ?? ''),
    stderrSha256: sha256(child.stderr ?? ''),
  };
}

async function measureIncrementalBuilds(cell) {
  const surface = join(demoRoot, 'surfaces', cell.arm);
  const probeDir = mkdtempSync(cell.arm === 'contract'
    ? join(surface, `.partitime-watch-${cell.backend}-`)
    : join(tmpdir(), `partitime-watch-${cell.arm}-${cell.backend}-`));
  const probe = join(probeDir, 'probe.txt');
  writeFileSync(probe, '0\n');
  if (cell.arm === 'contract') {
    try {
      const worker = join(here, 'step4-incremental-build-worker.mjs');
      const outDir = join(probeDir, 'dist');
      const child = spawnSync('bun', [
        worker,
        '--surface', surface,
        '--config', configPath(cell.arm),
        '--backend', cell.backend,
        '--out-dir', outDir,
        '--probe', probe,
        '--warmups', String(warmups),
        '--samples', String(samples),
      ], { cwd: surface, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      assert.equal(child.status, 0, `${cellId(cell)} incremental build worker failed: ${(child.stderr ?? '').slice(-4000)}`);
      const events = JSON.parse((child.stdout ?? '').trim());
      assert.equal(events.length, samples, `${cellId(cell)} incremental worker returned ${events.length} samples`);
      return events;
    } finally {
      rmSync(probeDir, { recursive: true, force: true });
    }
  }
  const viteEntry = join(surface, 'node_modules', 'vite', 'dist', 'node', 'index.js');
  const { build } = await import(pathToFileURL(viteEntry).href);
  let rebuildSequence = 0;
  const plugin = {
    name: 'partitime-incremental-build-probe',
    buildStart() { this.addWatchFile(probe); },
  };
  const watcher = await build({
    root: surface,
    configFile: configPath(cell.arm),
    mode: cell.backend,
    plugins: [plugin],
    build: { outDir: join(probeDir, 'dist'), write: false, watch: {} },
  });
  const events = [];
  let waiting = null;
  let bundleStartedAt = null;
  watcher.on('event', (event) => {
    if (event.code === 'BUNDLE_START') bundleStartedAt = process.hrtime.bigint();
    if (event.code === 'ERROR') waiting?.reject(event.error);
    if (event.code === 'BUNDLE_END') {
      event.result?.close?.();
      if (waiting) {
        const resolveWaiting = waiting.resolve;
        waiting = null;
        const measuredDuration = Number.isFinite(event.duration)
          ? event.duration
          : Number(process.hrtime.bigint() - bundleStartedAt) / 1_000_000;
        resolveWaiting({ durationMs: measuredDuration });
      }
    }
  });
  const nextBuild = () => new Promise((resolveBuild, reject) => {
    waiting = { resolve: resolveBuild, reject };
  });
  try {
    await nextBuild();
    for (let index = 0; index < warmups + samples; index += 1) {
      const completion = nextBuild();
      rebuildSequence += 1;
      writeFileSync(probe, `${rebuildSequence}\n`);
      const value = await completion;
      if (index >= warmups) events.push(value);
    }
  } finally {
    await watcher.close();
    rmSync(probeDir, { recursive: true, force: true });
  }
  return events;
}

function deriveCalibrationThresholds(webCells, builds) {
  const thresholds = {};
  for (const backend of backends) {
    const react = webCells[`react:${backend}`]?.aggregate;
    if (!react) continue;
    const transport = backend === 'snapback' ? 'push' : 'poll';
    const contractBuild = builds[`react:${backend}`]?.aggregate;
    thresholds[`contract:${backend}`] = {
      coldStartupMs: floorMargin(react.coldStartupMs.p95, 1.10),
      warmStartupMs: floorMargin(react.warmStartupMs.p95, 1.10),
      firstAuthoritativeDataMs: floorMargin(react.firstAuthoritativeDataMs.p95, 1.10),
      firstLiveDataMs: floorMargin(react.firstLiveDataMs.p95, 1.10),
      idleCpuTaskMsPerSecond: Math.min(
        Math.max(
          react.idleCpuTaskMsPerSecond.p95 * 1.05,
          invalidation.replacement.idleCpuResolutionFloorMsPerSecond,
        ),
        amendment.web.idle.absoluteCeilings.cpuTaskMsPerSecond,
      ),
      idleNetworkBytesPerSecond: Math.min(
        react.idleNetworkBytesPerSecond.p95 * 1.05,
        amendment.web.idle.absoluteCeilings.networkBytesPerSecond[transport],
      ),
      memoryPerActiveSubscriptionBytes: floorMargin(react.memoryPerActiveSubscriptionBytes.p95, 1.10),
      updateFanoutCount: floorMargin(react.updateFanoutCount.p95, 1.10),
      domOrHostPatchCount: floorMargin(react.domOrHostPatchCount.p95, 1.10),
      ...(contractBuild ? {
        productionBuildMs: floorMargin(contractBuild.productionBuildMs.p95, 1.10),
        incrementalBuildMs: floorMargin(contractBuild.incrementalBuildMs.p95, 1.10),
      } : {}),
    };
  }
  return thresholds;
}

function validateHoldout(revision, webCells, builds) {
  const calibrationPath = amendment.holdoutValidation.calibrationArtifact;
  const shown = spawnSync('git', ['show', `${revision}:${calibrationPath}`], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(shown.status, 0, `cannot read committed calibration ${revision}:${calibrationPath}`);
  const calibration = JSON.parse(shown.stdout);
  assert.equal(calibration.cohort, 'calibration');
  assert.equal(calibration.claimEligible, true);
  assert.deepEqual(calibration.amendment, fileIdentity(amendmentPath));
  assert.deepEqual(calibration.invalidation, fileIdentity(invalidationPath));
  assert.equal(calibration.methodId, invalidation.replacement.methodId);
  assert.equal(calibration.thresholdSetId, invalidation.replacement.thresholdSetId);
  const rows = [];
  for (const [cell, threshold] of Object.entries(calibration.thresholds)) {
    const actual = { ...webCells[cell]?.aggregate, ...builds[cell]?.aggregate };
    for (const [metricName, limit] of Object.entries(threshold)) {
      const p95 = actual[metricName]?.p95;
      rows.push({ cell, metricName, actualP95: p95 ?? null, threshold: limit, pass: Number.isFinite(p95) && p95 <= limit });
    }
  }
  return {
    calibration: { revision, path: calibrationPath, sha256: sha256(shown.stdout) },
    rows,
    ok: rows.length > 0 && rows.every(({ pass }) => pass),
  };
}

async function startSnapback() {
  const readyDir = mkdtempSync(join(tmpdir(), 'partitime-perf-api-'));
  const readyFile = join(readyDir, 'ready.json');
  const child = spawn(serverBin, ['--port', '0', '--memory', '--ready-file', readyFile], {
    cwd: repoRoot, detached: true, stdio: ['ignore', 'ignore', 'pipe'],
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
    cwd: join(demoRoot, 'backends', 'gateway'),
    detached: true,
    env: { ...process.env, PARTIFUL_MATRIX_GATEWAY_PORT: String(port), PARTIFUL_MATRIX_SNAPBACK_ORIGIN: snapbackUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (chunk) => { log += chunk; });
  child.stderr.on('data', (chunk) => { log += chunk; });
  cleanups.push(() => stopChild(child, 'matrix gateway'));
  const url = `http://127.0.0.1:${port}`;
  await waitUrl(`${url}/health`, child, 'matrix gateway');
  const response = await fetch(`${url}/preflight`, { signal: AbortSignal.timeout(30_000) });
  assert(response.ok, `matrix gateway preflight HTTP ${response.status}`);
  return { url, preflight: await response.json() };
}

async function startPreview(cell, snapbackUrl, gatewayUrl) {
  const port = await freePort();
  const surface = join(demoRoot, 'surfaces', cell.arm);
  const vite = join(surface, 'node_modules', '.bin', 'vite');
  const previewConfigDir = mkdtempSync(join(tmpdir(), `partitime-preview-${cell.arm}-${cell.backend}-`));
  const config = join(previewConfigDir, 'vite.config.mjs');
  const base = cell.arm === 'contract' ? '/partitime/' : '/';
  writeFileSync(config, `export default ${JSON.stringify({ root: surface, base, preview: { host: '127.0.0.1' } })};\n`);
  const child = spawn('bun', [
    '--bun', vite, 'preview', '--config', config, '--mode', cell.backend,
    '--host', '127.0.0.1', '--port', String(port), '--strictPort',
    '--outDir', join(surface, 'dist', cell.backend),
  ], {
    cwd: surface,
    detached: true,
    env: {
      ...process.env,
      SNAPBACK_PARTIFUL_MATRIX_API: snapbackUrl,
      PARTIFUL_MATRIX_GATEWAY: gatewayUrl,
      PARTITIME_DISABLE_POLL_FALLBACK: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (chunk) => { log += chunk; });
  child.stderr.on('data', (chunk) => { log += chunk; });
  const url = `http://127.0.0.1:${port}`;
  const previewUrl = cell.arm === 'contract' ? `${url}/partitime/` : url;
  try {
    await waitUrl(previewUrl, child, `${cellId(cell)} preview`);
    if (cell.arm === 'contract') {
      const html = await (await fetch(previewUrl, { signal: AbortSignal.timeout(5_000) })).text();
      const moduleSource = html.match(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/)?.[1];
      assert(moduleSource, `${cellId(cell)} preview did not name its client module`);
      await waitUrl(new URL(moduleSource, previewUrl).href, child, `${cellId(cell)} preview client module`);
    }
  } catch (error) {
    const cleanupFailures = [];
    try { await stopChild(child, `${cellId(cell)} preview`); } catch (cleanupError) {
      cleanupFailures.push(cleanupError instanceof Error ? cleanupError.message : String(cleanupError));
    }
    try { rmSync(previewConfigDir, { recursive: true, force: true }); } catch (cleanupError) {
      cleanupFailures.push(cleanupError instanceof Error ? cleanupError.message : String(cleanupError));
    }
    throw new Error(`${error.message}: ${log.slice(-3000)}${cleanupFailures.length ? `; cleanup: ${cleanupFailures.join('; ')}` : ''}`);
  }
  return {
    url: previewUrl,
    stop: async () => {
      try { await stopChild(child, `${cellId(cell)} preview`); }
      finally { rmSync(previewConfigDir, { recursive: true, force: true }); }
    },
  };
}

function configPath(arm) {
  return join(demoRoot, 'surfaces', arm, arm === 'contract' ? 'vite.config.ts' : arm === 'react' ? 'vite.config.mts' : 'vite.config.mjs');
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  const listeners = new Map();
  let nextId = 1;
  const key = (sessionId, method) => `${sessionId ?? ''}:${method}`;
  socket.addEventListener('message', async (event) => {
    const message = JSON.parse(typeof event.data === 'string' ? event.data : await event.data.text());
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id);
      clearTimeout(request.timer);
      pending.delete(message.id);
      message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result ?? {});
      return;
    }
    for (const listener of listeners.get(key(message.sessionId, message.method)) ?? []) listener(message.params ?? {});
  });
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', () => reject(new Error('CDP connection failed')), { once: true });
  });
  const send = (method, params = {}, sessionId = null, timeoutMs = 60_000) => new Promise((resolveSend, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, timeoutMs);
    pending.set(id, { resolve: resolveSend, reject, timer });
    socket.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
  });
  const on = (sessionId, method, listener) => {
    const eventKey = key(sessionId, method);
    const values = listeners.get(eventKey) ?? [];
    values.push(listener);
    listeners.set(eventKey, values);
  };
  return {
    close: () => socket.close(),
    newPage: async () => {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      let networkBytes = 0;
      const runtimeExceptions = [];
      const browserDiagnostics = [];
      on(sessionId, 'Network.loadingFinished', ({ encodedDataLength = 0 }) => { networkBytes += encodedDataLength; });
      on(sessionId, 'Network.webSocketFrameReceived', ({ response }) => { networkBytes += response?.payloadData?.length ?? 0; });
      on(sessionId, 'Network.webSocketFrameSent', ({ response }) => { networkBytes += response?.payloadData?.length ?? 0; });
      on(sessionId, 'Network.loadingFailed', ({ errorText, blockedReason }) => {
        browserDiagnostics.push(`network failed: ${errorText}${blockedReason ? ` (${blockedReason})` : ''}`);
      });
      on(sessionId, 'Network.responseReceived', ({ response }) => {
        if (response?.status >= 400) browserDiagnostics.push(`HTTP ${response.status}: ${response.url}`);
      });
      on(sessionId, 'Runtime.exceptionThrown', ({ exceptionDetails }) => {
        runtimeExceptions.push(exceptionDetails?.exception?.description ?? exceptionDetails?.text ?? 'unknown runtime exception');
      });
      on(sessionId, 'Runtime.consoleAPICalled', ({ type, args }) => {
        if (type === 'error' || type === 'warning') {
          browserDiagnostics.push(`${type}: ${args?.map((arg) => arg.value ?? arg.description ?? '').join(' ')}`);
        }
      });
      await send('Page.enable', {}, sessionId);
      await send('Runtime.enable', {}, sessionId);
      await send('Network.enable', {}, sessionId);
      await send('Performance.enable', {}, sessionId);
      await send('Page.addScriptToEvaluateOnNewDocument', { source: observerSource() }, sessionId);
      const evaluate = async (expression) => {
        const result = await send('Runtime.evaluate', {
          expression, awaitPromise: true, returnByValue: true, userGesture: true,
        }, sessionId);
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
        return result.result?.value;
      };
      return {
        navigate: async (pageUrl) => {
          await send('Page.navigate', { url: pageUrl }, sessionId);
          const deadline = Date.now() + 30_000;
          while (Date.now() < deadline) {
            try {
              // Product milestones below are the ratified readiness signal.
              // Do not let an unrelated late load-event resource prevent the
              // observer from evaluating an already-interactive document.
              if (await evaluate(`document.readyState !== 'loading'`)) return;
            } catch { /* execution context was replaced during navigation */ }
            await sleep(25);
          }
          throw new Error(`navigation timed out: ${pageUrl}`);
        },
        close: async () => {
          await closeTargetReliably({
            targetId,
            closeTarget: () =>
              send('Target.closeTarget', { targetId }, null, 15_000),
            listTargetsFresh: async () => {
              const { targetInfos = [] } = await freshBrowserCommand(
                url,
                'Target.getTargets',
              );
              return targetInfos;
            },
            closeTargetFresh: () =>
              freshBrowserCommand(url, 'Target.closeTarget', { targetId }),
          });
        },
        setCacheDisabled: (cacheDisabled) => send('Network.setCacheDisabled', { cacheDisabled }, sessionId),
        clearBrowserCache: () => send('Network.clearBrowserCache', {}, sessionId),
        resetNetworkBytes: async () => { networkBytes = 0; },
        networkBytes: async () => networkBytes,
        waitForLiveData: async () => {
          const result = await evaluate(`(async()=>{
            const deadline=Date.now()+30000;
            while(Date.now()<deadline){
              const value=globalThis.__partitimePerf?.snapshot?.();
              if(value?.liveAt!=null)return value;
              await new Promise(r=>setTimeout(r,25));
            }
            const ready=await Promise.resolve(globalThis.partifulMatrixReady).catch(()=>null);
            return{
              timeout:true,
              milestones:globalThis.__partitimePerf?.snapshot?.()??null,
              title:document.title,
              bodyText:document.body?.innerText?.slice(0,1000)??null,
              readyType:typeof globalThis.partifulMatrixReady,
              hydration:ready?.hydration??null,
              transportEvidence:ready?.transportEvidence?.()??null,
            };
          })()`);
          return result?.timeout ? { ...result, runtimeExceptions: [...runtimeExceptions], browserDiagnostics: [...browserDiagnostics] } : result;
        },
        collectGarbage: () => send('HeapProfiler.collectGarbage', {}, sessionId),
        heapUsage: () => send('Runtime.getHeapUsage', {}, sessionId),
        performanceMetrics: async () => (await send('Performance.getMetrics', {}, sessionId)).metrics,
        beginUpdate: () => evaluate('globalThis.__partitimePerf.beginUpdate()'),
        click: async (testId) => {
          const point = await evaluate(`(async()=>{const target=document.querySelector(${JSON.stringify(`[data-testid="${testId}"]`)});if(!target)throw new Error('missing ${testId}');target.scrollIntoView({block:'center',inline:'center'});await new Promise(requestAnimationFrame);const rect=target.getBoundingClientRect();return{x:rect.left+rect.width/2,y:rect.top+rect.height/2}})()`);
          await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y }, sessionId);
          await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 }, sessionId);
          await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 }, sessionId);
        },
        waitForEventPage: () => evaluate(`(async()=>{const deadline=Date.now()+15000;while(Date.now()<deadline){if(document.querySelector('[data-testid="event-page"]'))return globalThis.__partitimePerf.endUpdate();await new Promise(r=>setTimeout(r,25));}throw new Error('event update timed out')})()`),
        diagnostic: async () => ({
          ...await evaluate(`({
            href: location.href,
            readyState: document.readyState,
            eventPage: Boolean(document.querySelector('[data-testid="event-page"]')),
            loadingText: document.querySelector('.event-page')?.textContent?.slice(0, 500) ?? null,
            openControlPresent: Boolean(document.querySelector('[data-testid="open-event_swim"]')),
            bootState: document.querySelector('#boot-status')?.getAttribute('data-state') ?? null,
            matrixReadyType: typeof globalThis.partifulMatrixReady,
            bodyText: document.body?.innerText?.slice(0, 1000) ?? null,
          })`),
          runtimeExceptions: [...runtimeExceptions],
          browserDiagnostics: [...browserDiagnostics],
        }),
      };
    },
  };
}

function observerSource() {
  return `(()=>{
    const state={firstUiAt:null,authoritativeAt:null,liveAt:null,bootReadyAt:null,recording:false,targets:new Set(),patches:0};
    const scan=()=>{
      const now=performance.now();
      if(state.firstUiAt==null&&document.querySelector('[data-testid="product-shell"],#root>.app-shell'))state.firstUiAt=now;
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
        Promise.resolve(value).then(()=>{if(state.bootReadyAt==null)state.bootReadyAt=performance.now();scan();},()=>{});
      },
    });
    const observer=new MutationObserver((records)=>{
      if(state.recording)for(const record of records){state.targets.add(record.target);state.patches+=record.type==='childList'?record.addedNodes.length+record.removedNodes.length:1;}
      scan();
    });
    // Observe parser mutations immediately. Waiting for DOMContentLoaded makes
    // a prerendered product shell look as slow as the module graph that follows
    // it and therefore does not measure first UI.
    observer.observe(document,{subtree:true,childList:true,attributes:true,characterData:true});
    scan();
    globalThis.__partitimePerf={
      snapshot:()=>({firstUiAt:state.firstUiAt,authoritativeAt:state.authoritativeAt,liveAt:state.liveAt,bootReadyAt:state.bootReadyAt}),
      beginUpdate:()=>{state.recording=true;state.targets.clear();state.patches=0;return true;},
      endUpdate:()=>{state.recording=false;return{fanout:state.targets.size,patches:state.patches};},
    };
  })();`;
}

async function waitUrl(url, child, label) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1_000) })).ok) return; } catch { /* retry */ }
    if (child.exitCode !== null) throw new Error(`${label} exited with ${child.exitCode}`);
    await sleep(100);
  }
  throw new Error(`${label} readiness timed out: ${url}`);
}

async function stopChild(child, label) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise((resolveClose) => child.once('close', resolveClose));
  try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  if (await Promise.race([closed.then(() => true), sleep(5_000).then(() => false)])) return;
  try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  assert(await Promise.race([closed.then(() => true), sleep(5_000).then(() => false)]), `${label} did not stop`);
}

function aggregate(values) {
  assert(values.length === samples, `expected ${samples} samples, received ${values.length}`);
  const ordered = [...values].sort((left, right) => left - right);
  return {
    samples: values,
    median: percentile(ordered, 0.5),
    p95: percentile(ordered, 0.95),
  };
}

function percentile(ordered, fraction) {
  return ordered[Math.ceil(ordered.length * fraction) - 1];
}

function metric(metrics, name) {
  const value = metrics.find((entry) => entry.name === name)?.value;
  assert(Number.isFinite(value), `missing Chrome performance metric ${name}`);
  return value;
}

function floorMargin(value, margin) {
  return Math.floor(value * margin);
}

function cellId({ arm, backend }) { return `${arm}:${backend}`; }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function gitRevision(root) {
  const child = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  assert.equal(child.status, 0, `git revision failed under ${root}`);
  return child.stdout.trim();
}
function maybeGitRevision(root) {
  const child = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  if (child.status === 0) return child.stdout.trim();
  assert(quick, `git revision failed under ${root}; set EXACT_ROOT to the Exact checkout under test`);
  return null;
}
function fileIdentity(path) {
  return { path: relative(repoRoot, path), sha256: sha256(readFileSync(path)) };
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
