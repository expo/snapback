#!/usr/bin/env node

// LLP 0052 / ENG-24189 — Phase 0 update-economy reproduction.
//
// This is deliberately a measurement runner rather than a pass/fail perf
// test. It captures the 2x2 userland-mitigation matrix over one pinned commit
// stream and writes the raw evidence used to set the RFC's numeric gates.

import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { freePort } from '../../../_kit/provenance.mjs';
import { startServer } from '../../../_kit/server-process.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const surfaceDir = join(repoRoot, 'demos', 'all-aboard', 'surfaces', 'contract');
const exactRoot = process.env.EXACT_ALL_ABOARD_SOURCE_ROOT
  ? resolve(process.env.EXACT_ALL_ABOARD_SOURCE_ROOT)
  : null;
const chromeBin = process.env.CHROME_BIN
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ticks = Number(process.env.ALL_ABOARD_UPDATE_ECONOMY_TICKS ?? 20);
const settleMs = Number(process.env.ALL_ABOARD_UPDATE_ECONOMY_SETTLE_MS ?? 2_000);
const serverBin = resolve(
  process.env.SNAPBACK_UPDATE_ECONOMY_SERVER_BIN
    ?? join(repoRoot, 'target', 'debug', 'snapback'),
);
const viewport = { width: 390, height: 844, deviceScaleFactor: 2, mobile: false };
const variants = ['pre', 'clock-only', 'palette-only', 'current'];

const outputArg = process.argv.indexOf('--output');
const outputPath = resolve(
  outputArg >= 0 && process.argv[outputArg + 1]
    ? process.argv[outputArg + 1]
    : join(
        repoRoot,
        'demos',
        'all-aboard',
        'measurements',
        'update-economy.web.raw.json',
      ),
);

if (!exactRoot || !existsSync(join(exactRoot, 'packages', 'exact-contract'))) {
  throw new Error(
    'EXACT_ALL_ABOARD_SOURCE_ROOT must point at the candidate Exact checkout',
  );
}
if (!Number.isInteger(ticks) || ticks < 1) {
  throw new Error(`ALL_ABOARD_UPDATE_ECONOMY_TICKS must be a positive integer, got ${ticks}`);
}

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const cleanups = [];

function git(path, args) {
  const result = spawnSync('git', ['-C', path, ...args], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  }
  return result.stdout.trim();
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolveStop) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(termTimeout);
      clearTimeout(killTimeout);
      resolveStop();
    };
    const killTimeout = setTimeout(finish, 5_000);
    const termTimeout = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    }, 3_000);
    child.once('exit', finish);
    // Recheck after installing the listener: an exit between the function's
    // first check and listener registration must not strand teardown.
    if (child.exitCode !== null) {
      finish();
      return;
    }
    child.kill('SIGTERM');
  });
}

async function waitForUrl(url, child, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(800) });
      if (response.ok) return;
    } catch {
      // Still starting.
    }
    if (child?.exitCode !== null) {
      throw new Error(`${label} exited before becoming ready (code ${child.exitCode})`);
    }
    await sleep(200);
  }
  throw new Error(`${label} did not become ready at ${url}`);
}

async function startMeasurementServer(port) {
  if (!existsSync(serverBin)) {
    return startServer({
      port,
      cwd: repoRoot,
      db: ':memory:',
      env: {
        SNAPBACK_ADMIN_TOKEN:
          process.env.SNAPBACK_ADMIN_TOKEN || `sbat_update_economy_${process.pid}`,
      },
    });
  }
  const adminToken =
    process.env.SNAPBACK_ADMIN_TOKEN || `sbat_update_economy_${process.pid}`;
  process.env.SNAPBACK_ADMIN_TOKEN = adminToken;
  let log = '';
  const child = spawn(serverBin, ['--port', String(port), '--memory'], {
    cwd: repoRoot,
    env: { ...process.env, SNAPBACK_ADMIN_TOKEN: adminToken },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { log += chunk; });
  child.stderr.on('data', (chunk) => { log += chunk; });
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForUrl(`${baseUrl}/health`, child, 'Snapback server', 30_000);
  } catch (error) {
    await stopChild(child);
    throw new Error(`${error.message}\n${log}`);
  }
  return {
    baseUrl,
    adminToken,
    reused: false,
    stop: () => stopChild(child),
  };
}

async function launchChrome() {
  const userDataDir = mkdtempSync(join(tmpdir(), 'aa-update-economy-'));
  const child = spawn(
    chromeBin,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      `--window-size=${viewport.width},${viewport.height}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let spawnError = null;
  child.on('error', (error) => { spawnError = error; });
  const portFile = join(userDataDir, 'DevToolsActivePort');
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (spawnError) {
      throw new Error(`Chrome failed to launch (${chromeBin}): ${spawnError.message}`);
    }
    try {
      const [port] = readFileSync(portFile, 'utf8').trim().split('\n');
      const version = await fetch(`http://127.0.0.1:${port}/json/version`)
        .then((response) => response.json());
      return {
        ws: version.webSocketDebuggerUrl,
        version,
        stop: async () => {
          await stopChild(child);
          rmSync(userDataDir, { recursive: true, force: true });
        },
      };
    } catch {
      await sleep(100);
    }
  }
  throw new Error('Chrome did not expose DevToolsActivePort');
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;
  // A source-pinned first navigation can spend tens of seconds compiling the
  // large native-capable Contract bundle. This command waits for app `ready`;
  // keep its transport ceiling above the app's own boot deadline.
  const commandTimeoutMs = 120_000;
  const settle = (id) => {
    const item = pending.get(id);
    if (item) clearTimeout(item.timer);
    pending.delete(id);
    return item;
  };
  const rejectAll = (reason) => {
    for (const id of [...pending.keys()]) settle(id)?.reject(new Error(reason));
  };
  socket.addEventListener('message', async (event) => {
    const text = typeof event.data === 'string' ? event.data : await event.data.text();
    const message = JSON.parse(text);
    if (!message.id || !pending.has(message.id)) return;
    const item = settle(message.id);
    if (message.error) {
      item.reject(new Error(`${item.method}: ${message.error.message}`));
    }
    else item.resolve(message.result || {});
  });
  socket.addEventListener('close', () => rejectAll('CDP socket closed'));
  socket.addEventListener('error', () => rejectAll('CDP socket errored'));
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener(
      'error',
      () => rejectOpen(new Error('CDP connection failed')),
      { once: true },
    );
  });
  const send = (method, params = {}, sessionId = null) => {
    const id = nextId++;
    socket.send(JSON.stringify(sessionId
      ? { id, method, params, sessionId }
      : { id, method, params }));
    return new Promise((resolveSend, rejectSend) => {
      const timer = setTimeout(() => {
        settle(id);
        rejectSend(new Error(`CDP command timed out: ${method}`));
      }, commandTimeoutMs);
      pending.set(id, { resolve: resolveSend, reject: rejectSend, timer, method });
    });
  };
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', viewport, sessionId);
  const evaluate = async (expression) => {
    const response = await send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true, userGesture: true },
      sessionId,
    );
    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.exception?.description
        || response.exceptionDetails.text,
      );
    }
    return response.result?.value;
  };
  return {
    close: async () => {
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
    navigate: (target) => send('Page.navigate', { url: target }, sessionId),
    evaluate,
  };
}

function subtractReactive(after, before) {
  const fields = [
    'wave',
    'effectRuns',
    'skippedEffects',
    'computedRecomputes',
    'cascadePasses',
  ];
  return Object.fromEntries(fields.map((field) => [
    field,
    Number(after?.[field] ?? 0) - Number(before?.[field] ?? 0),
  ]));
}

function frameSummary(samples) {
  const values = [...samples].sort((a, b) => a - b);
  const percentile = (p) => values.length === 0
    ? null
    : values[Math.min(values.length - 1, Math.floor((values.length - 1) * p))];
  return {
    count: values.length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: values.length === 0 ? null : values[values.length - 1],
    over16_7Ms: values.filter((value) => value > 16.7).length,
    over33_4Ms: values.filter((value) => value > 33.4).length,
  };
}

async function measureVariant(page, viteUrl, variant) {
  await page.navigate(`${viteUrl}/?appearance=light&updateEconomy=${variant}`);
  await page.evaluate(`(async () => {
    const deadline = Date.now() + 90000;
    while (!globalThis.allAboard) {
      if (Date.now() > deadline) throw new Error('allAboard did not appear');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await globalThis.allAboard.ready;
    // The Phase-0 reporter is intentionally absent from Exact's eager native
    // startup graph. This source-pinned Vite run loads its explicit lazy
    // subpath only after the representative app has mounted.
    const probe = await import('/update-economy-probe.ts');
    await probe.installUpdateEconomyReporter();
    while (!globalThis.__exactUpdateEconomy) {
      if (Date.now() > deadline) throw new Error('__exactUpdateEconomy did not appear');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  })()`);
  await sleep(settleMs);
  const before = await page.evaluate(`(() => {
    const diagnostics = globalThis.allAboard.updateEconomy;
    diagnostics.configureRenderer({
      rawTextEqualitySkip: false,
      domDescriptionEqualitySkip: false,
    });
    diagnostics.resetRenderer();
    const sample = diagnostics.sample();
    globalThis.__aaFrameIntervals = [];
    globalThis.__aaFrameSampling = true;
    let previous = null;
    const frame = (at) => {
      if (!globalThis.__aaFrameSampling) return;
      if (previous !== null) globalThis.__aaFrameIntervals.push(at - previous);
      previous = at;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    return sample;
  })()`);
  await sleep(ticks * 1_000 + 250);
  const after = await page.evaluate(`(() => {
    globalThis.__aaFrameSampling = false;
    return {
      sample: globalThis.allAboard.updateEconomy.sample(${Number(before.reactive.wave)}),
      frames: globalThis.__aaFrameIntervals,
      experiment: {
        variant: globalThis.allAboard.updateEconomy.variant,
        clockQuantized: globalThis.allAboard.updateEconomy.clockQuantized,
        paletteSingleton: globalThis.allAboard.updateEconomy.paletteSingleton,
      },
    };
  })()`);
  if (after.experiment.variant !== variant) {
    throw new Error(`requested ${variant}, mounted ${after.experiment.variant}`);
  }
  return {
    variant,
    experiment: after.experiment,
    window: { ticks, durationMs: ticks * 1_000 + 250 },
    reactive: {
      before: before.reactive,
      after: after.sample.reactive,
      delta: subtractReactive(after.sample.reactive, before.reactive),
    },
    renderer: after.sample.renderer,
    frames: {
      summary: frameSummary(after.frames),
      samplesMs: after.frames,
    },
  };
}

async function main() {
  const apiPort = await freePort();
  const vitePort = await freePort();
  const api = await startMeasurementServer(apiPort);
  cleanups.push(() => api.stop());

  let viteLog = '';
  const vite = spawn(
    'bun',
    [
      '--bun',
      'node_modules/.bin/vite',
      '--config',
      'vite.config.ts',
      '--host',
      '127.0.0.1',
      '--port',
      String(vitePort),
      '--strictPort',
    ],
    {
      cwd: surfaceDir,
      env: {
        ...process.env,
        EXACT_ALL_ABOARD_SOURCE_ROOT: exactRoot,
        SNAPBACK_ALL_ABOARD_API: api.baseUrl,
        NODE_ENV: 'development',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  vite.stdout.on('data', (chunk) => { viteLog += chunk; });
  vite.stderr.on('data', (chunk) => { viteLog += chunk; });
  cleanups.push(() => stopChild(vite));
  const viteUrl = `http://127.0.0.1:${vitePort}`;
  try {
    await waitForUrl(viteUrl, vite, 'Vite');
  } catch (error) {
    throw new Error(`${error.message}\n${viteLog}`);
  }

  const chrome = await launchChrome();
  cleanups.push(() => chrome.stop());
  const page = await connectCdp(chrome.ws);
  cleanups.push(() => page.close());

  const results = [];
  for (const variant of variants) {
    console.log(`Measuring ${variant} (${ticks} ticks)…`);
    results.push(await measureVariant(page, viteUrl, variant));
  }

  const report = {
    schemaVersion: 1,
    issue: 'ENG-24189',
    recordedAt: new Date().toISOString(),
    method: {
      host: 'web',
      browser: chrome.version.Browser,
      protocolVersion: chrome.version['Protocol-Version'],
      platform: `${process.platform}-${process.arch}`,
      headless: true,
      route: '/?appearance=light&updateEconomy=<variant>',
      viewport,
      ticks,
      settleMs,
      rendererEqualityFlags: {
        rawTextEqualitySkip: false,
        domDescriptionEqualitySkip: false,
      },
    },
    revisions: {
      snapback: git(repoRoot, ['rev-parse', 'HEAD']),
      snapbackDirty: git(repoRoot, ['status', '--short']),
      exact: git(exactRoot, ['rev-parse', 'HEAD']),
      exactDirty: git(exactRoot, ['status', '--short']),
    },
    results,
  };

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Wrote ${outputPath}`);
}

async function cleanup() {
  while (cleanups.length > 0) {
    try {
      await cleanups.pop()();
    } catch {
      // Continue cleaning the processes this run owns.
    }
  }
}

try {
  await main();
} finally {
  await cleanup();
}

// Node's built-in WebSocket can retain an already-closed DevTools handle on
// successful runs. Every owned child has been awaited above; terminate the
// measurement CLI explicitly so a valid report cannot hang CI indefinitely.
process.exit(0);
