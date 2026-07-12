#!/usr/bin/env node

// @ref LLP 0052#acceptance-gates — final All Aboard update-economy acceptance.
//
// The Phase 0 four-arm evidence remains committed under measurements/. This
// runner exercises only the migrated production surface: terminal temporal
// text may update, but an idle home window must perform zero app-dataflow
// computed recomputes. There is no production experiment selector.

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
const exactPinPath = join(repoRoot, 'demos', 'all-aboard', 'exact-source.json');
const exactPin = JSON.parse(readFileSync(exactPinPath, 'utf8'));
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

const outputArg = process.argv.indexOf('--output');
const outputPath = resolve(
  outputArg >= 0 && process.argv[outputArg + 1]
    ? process.argv[outputArg + 1]
    : join(
        repoRoot,
        'demos',
        'all-aboard',
        'measurements',
        'update-economy.final.web.json',
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

try {
  git(exactRoot, ['merge-base', '--is-ancestor', exactPin.commit, 'HEAD']);
} catch {
  throw new Error(
    `Exact source must contain pinned revision ${exactPin.commit} from ${exactPin.repository}`,
  );
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

function summarizeReactive(snapshot) {
  return Object.fromEntries([
    'wave',
    'effectRuns',
    'skippedEffects',
    'computedRecomputes',
    'cascadePasses',
  ].map((field) => [field, Number(snapshot?.[field] ?? 0)]));
}

function assertCauseAccounting(report, label) {
  const commits = report?.commits ?? [];
  const totalElements = Number(report?.totals?.hostElements?.attempts ?? 0);
  const totalText = Number(report?.totals?.hostText?.attempts ?? 0);
  const committedElements = commits.reduce(
    (sum, commit) => sum + Number(commit.hostElements?.attempts ?? 0),
    0,
  );
  const committedText = commits.reduce(
    (sum, commit) => sum + Number(commit.hostText?.attempts ?? 0),
    0,
  );
  if (
    (totalElements + totalText > 0 && commits.length === 0) ||
    committedElements !== totalElements ||
    committedText !== totalText
  ) {
    throw new Error(
      `${label} commit totals are incomplete: ` +
      JSON.stringify({ totalElements, totalText, committedElements, committedText, commits: commits.length }),
    );
  }
  for (const commit of commits) {
    const retainedElements = (commit.causes ?? [])
      .reduce((sum, cause) => sum + Number(cause.hostElementAttempts ?? 0), 0);
    const retainedText = (commit.causes ?? [])
      .reduce((sum, cause) => sum + Number(cause.hostTextAttempts ?? 0), 0);
    const attribution = commit.causeAttribution ?? {};
    const omittedElements = Number(attribution.omittedHostElementAttempts ?? 0);
    const omittedText = Number(attribution.omittedHostTextAttempts ?? 0);
    const omitted = omittedElements + omittedText;
    if (
      Number(attribution.retained ?? -1) !== (commit.causes ?? []).length ||
      retainedElements + omittedElements !== Number(commit.hostElements?.attempts ?? 0) ||
      retainedText + omittedText !== Number(commit.hostText?.attempts ?? 0) ||
      Boolean(attribution.truncated) !== (omitted > 0)
    ) {
      throw new Error(`${label} cause attribution is incomplete: ${JSON.stringify(commit)}`);
    }
  }
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

function durationSummary(samples) {
  const values = [...samples].sort((a, b) => a - b);
  const at = (p) => values[Math.min(values.length - 1, Math.floor((values.length - 1) * p))] ?? null;
  return {
    count: values.length,
    p50Ms: at(0.5),
    p95Ms: at(0.95),
    maxMs: values.at(-1) ?? null,
  };
}

async function measureFinalSurface(page, viteUrl) {
  await page.navigate(`${viteUrl}/?appearance=light`);
  await page.evaluate(`(async () => {
    const deadline = Date.now() + 90000;
    while (!globalThis.allAboard) {
      if (Date.now() > deadline) throw new Error('allAboard did not appear');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await globalThis.allAboard.ready;
    // The Phase-0 reporter is intentionally absent from Exact's eager native
    // startup graph. This source-pinned Vite run loads its explicit lazy
    // subpath only after the representative app has mounted. Keep the
    // reporter absent first so D5 has a real dev-control measurement.
    globalThis.__aaUpdateEconomyProbe = await import('/update-economy-probe.ts');
    if (globalThis.__exactUpdateEconomy) throw new Error('update-economy reporter loaded eagerly');
  })()`);
  await sleep(settleMs);

  const hostReaderMatrix = await page.evaluate(`(() => {
    const probe = globalThis.__aaUpdateEconomyProbe;
    const text = (testId) => document.querySelector('[data-testid="' + testId + '"]')?.textContent ?? null;
    const style = (testId, property) => {
      const node = document.querySelector('[data-testid="' + testId + '"]');
      return node ? getComputedStyle(node)[property] : null;
    };
    const read = () => {
      const derives = probe.sampleAllAboardDerives();
      return {
        station: text('station-name'),
        walkBike: text('walk-bike'),
        backendNote: text('delays-loading'),
        mainBackground: style('all-aboard-main', 'backgroundColor'),
        directionColor: style('active-direction', 'color'),
        serviceTint: style('hero-service-pill', 'backgroundColor'),
        delayColor: style('hero-delay', 'color'),
        headerHeight: style('station-header', 'height'),
        footerHeight: style('sticky-footer', 'height'),
        locationIcon: document.querySelector('[data-testid="location-indicator"]')?.innerHTML ?? null,
        derives: Object.fromEntries([
          'station',
          'matches',
          'locHint',
          'locColor',
          'walkBike',
          'dirLabel',
          'feedSource',
          'bootNote',
        ].map((name) => [name, derives[name]])),
      };
    };
    probe.beginScriptedContractClock(Date.now());
    try {
      probe.publishAcceptanceHostSnapshot({ backendStatus: 'connecting' });
      const baseline = read();
      probe.publishAcceptanceHostSnapshot({ colorScheme: 'dark', backendStatus: 'connecting' });
      const scheme = read();
      probe.publishAcceptanceHostSnapshot({
        colorScheme: 'dark',
        safeAreaInsets: { top: 12, right: 0, bottom: 8, left: 0 },
        backendStatus: 'connecting',
      });
      const insets = read();
      probe.publishAcceptanceHostSnapshot({
        colorScheme: 'dark',
        safeAreaInsets: { top: 12, right: 0, bottom: 8, left: 0 },
        geolocation: {
          status: 'available',
          coords: { latitude: 37.776, longitude: -122.394 },
          source: 'acceptance',
        },
        backendStatus: 'connecting',
      });
      const location = read();
      probe.publishAcceptanceHostSnapshot({
        colorScheme: 'dark',
        safeAreaInsets: { top: 12, right: 0, bottom: 8, left: 0 },
        geolocation: {
          status: 'available',
          coords: { latitude: 37.776, longitude: -122.394 },
          source: 'acceptance',
        },
        backendStatus: 'connected',
      });
      const backend = read();
      return { baseline, scheme, insets, location, backend };
    } finally {
      probe.publishAcceptanceHostSnapshot();
      probe.endScriptedContractClock();
    }
  })()`);
  const deriveChanged = (left, right, name) =>
    JSON.stringify(left.derives?.[name]) !== JSON.stringify(right.derives?.[name]);
  if (
    hostReaderMatrix.scheme.mainBackground === hostReaderMatrix.baseline.mainBackground ||
    hostReaderMatrix.scheme.directionColor === hostReaderMatrix.baseline.directionColor ||
    hostReaderMatrix.scheme.serviceTint === hostReaderMatrix.baseline.serviceTint ||
    hostReaderMatrix.scheme.delayColor === hostReaderMatrix.baseline.delayColor ||
    !deriveChanged(hostReaderMatrix.baseline, hostReaderMatrix.scheme, 'locColor') ||
    !deriveChanged(hostReaderMatrix.baseline, hostReaderMatrix.scheme, 'feedSource') ||
    hostReaderMatrix.insets.headerHeight === hostReaderMatrix.scheme.headerHeight ||
    hostReaderMatrix.insets.footerHeight === hostReaderMatrix.scheme.footerHeight ||
    hostReaderMatrix.location.station === hostReaderMatrix.insets.station ||
    hostReaderMatrix.location.locationIcon === hostReaderMatrix.insets.locationIcon ||
    !deriveChanged(hostReaderMatrix.insets, hostReaderMatrix.location, 'station') ||
    !deriveChanged(hostReaderMatrix.insets, hostReaderMatrix.location, 'matches') ||
    !deriveChanged(hostReaderMatrix.insets, hostReaderMatrix.location, 'locHint') ||
    !deriveChanged(hostReaderMatrix.insets, hostReaderMatrix.location, 'locColor') ||
    !deriveChanged(hostReaderMatrix.insets, hostReaderMatrix.location, 'walkBike') ||
    !deriveChanged(hostReaderMatrix.location, hostReaderMatrix.backend, 'bootNote')
  ) {
    throw new Error(`D1 frozen-clock reader matrix failed: ${JSON.stringify(hostReaderMatrix)}`);
  }
  await sleep(100);

  const reporterDisabledControl = await page.evaluate(`(() => {
    const setScheme = globalThis.__aaSetColorScheme;
    if (typeof setScheme !== 'function') throw new Error('color-scheme control is unavailable');
    const durationsMs = [];
    setScheme('light');
    for (let index = 0; index < 31; index += 1) {
      const startedAt = performance.now();
      setScheme('dark');
      const durationMs = performance.now() - startedAt;
      if (index > 0) durationsMs.push(durationMs);
      setScheme('light');
    }
    return { durationsMs, workload: 'All Aboard light-to-dark host-state commit' };
  })()`);

  await page.evaluate(`(async () => {
    await globalThis.__aaUpdateEconomyProbe.installUpdateEconomyReporter();
    const deadline = Date.now() + 30_000;
    while (!globalThis.__exactUpdateEconomy) {
      if (Date.now() > deadline) throw new Error('__exactUpdateEconomy did not appear');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  })()`);

  const reporterEnabledControl = await page.evaluate(`(() => {
    const probe = globalThis.__aaUpdateEconomyProbe;
    const setScheme = globalThis.__aaSetColorScheme;
    if (typeof setScheme !== 'function') throw new Error('color-scheme control is unavailable');
    const durationsMs = [];
    let representativeReport = null;
    setScheme('light');
    for (let index = 0; index < 31; index += 1) {
      probe.resetUpdateEconomyRenderer();
      const startedAt = performance.now();
      setScheme('dark');
      const durationMs = performance.now() - startedAt;
      const report = probe.sampleUpdateEconomy().renderer;
      if (index > 0) durationsMs.push(durationMs);
      representativeReport = report;
      setScheme('light');
    }
    probe.resetUpdateEconomyRenderer();
    return {
      durationsMs,
      workload: 'All Aboard light-to-dark host-state commit',
      representativeReport,
    };
  })()`);

  await page.evaluate(`(() => {
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
  })()`);

  // D1: first normalize every declared host seam, then measure repeated fresh
  // records carrying the same values. The publications themselves happen,
  // but canonical equality must produce no reactive wave or renderer commit.
  await page.evaluate('globalThis.__aaUpdateEconomyProbe.publishAcceptanceHostSnapshot()');
  await sleep(100);
  const hostBefore = await page.evaluate(`(() => {
    const probe = globalThis.__aaUpdateEconomyProbe;
    probe.resetUpdateEconomyRenderer();
    return { sample: probe.sampleUpdateEconomy(), host: probe.sampleHostBindingDebug() };
  })()`);
  await page.evaluate(`(() => {
    for (let index = 0; index < 8; index += 1) {
      globalThis.__aaUpdateEconomyProbe.publishAcceptanceHostSnapshot();
    }
  })()`);
  await sleep(100);
  const hostAfter = await page.evaluate(`(() => {
    const probe = globalThis.__aaUpdateEconomyProbe;
    return {
      sample: probe.sampleUpdateEconomy(${Number(hostBefore.sample.reactive.wave)}),
      host: probe.sampleHostBindingDebug(),
    };
  })()`);
  const hostReactiveDelta = subtractReactive(hostAfter.sample.reactive, hostBefore.sample.reactive);
  const hostPublicationDelta =
    Number(hostAfter.host?.publications ?? 0) - Number(hostBefore.host?.publications ?? 0);
  const hostAppliedDelta =
    Number(hostAfter.host?.appliedTransactions ?? 0) - Number(hostBefore.host?.appliedTransactions ?? 0);
  if (
    hostReactiveDelta.wave !== 0 ||
    hostReactiveDelta.computedRecomputes !== 0 ||
    hostReactiveDelta.effectRuns !== 0 ||
    Number(hostAfter.sample.renderer?.totals?.commits ?? 0) !== 0 ||
    hostPublicationDelta !== 8 ||
    hostAppliedDelta !== 8
  ) {
    throw new Error(
      `value-equal host publications were dropped or caused work: ` +
      JSON.stringify({ hostReactiveDelta, hostPublicationDelta, hostAppliedDelta, renderer: hostAfter.sample.renderer }),
    );
  }
  for (const field of [
    'physicalSchemeSubscriptions',
    'physicalInsetsSubscriptions',
    'physicalGeolocationSubscriptions',
  ]) {
    if (Number(hostAfter.host?.[field]) !== 1) {
      throw new Error(`D1 expected one shared ${field}, got ${hostAfter.host?.[field]}`);
    }
  }

  // D3: the app's lazy acceptance edge calls the actual renderer text update
  // with the existing value. The boundary must count and skip that attempt,
  // issuing no protocol operation.
  const equality = await page.evaluate(`(() => {
    const probe = globalThis.__aaUpdateEconomyProbe;
    probe.resetUpdateEconomyRenderer();
    probe.exerciseRawTextEqualityProbe();
    return probe.sampleUpdateEconomy();
  })()`);
  const equalText = equality.renderer?.totals?.hostText;
  if (
    Number(equalText?.attempts) !== 1 ||
    Number(equalText?.equal) !== 1 ||
    Number(equalText?.skipped) !== 1 ||
    Number(equality.renderer?.totals?.protocolOps) !== 0
  ) {
    throw new Error(`D3 equal raw text was not skipped: ${JSON.stringify(equality.renderer)}`);
  }
  const equalityCommits = equality.renderer?.commits ?? [];
  if (
    equalityCommits.length !== 1 ||
    equalityCommits[0]?.reactive !== null ||
    (equalityCommits[0]?.causes ?? []).length !== 0 ||
    Number(equality.renderer?.totals?.reactive?.waves ?? 0) !== 0 ||
    equalityCommits[0]?.causeAttribution?.truncated === true
  ) {
    throw new Error(`D5 raw host probe attribution was not isolated: ${JSON.stringify(equality.renderer)}`);
  }

  // D2: move the real mounted temporal queue to the next authored deadline
  // for a visible production countdown. This uses Exact's public scripted
  // clock and the app's existing terminal binding; it is deterministic and
  // does not wait for a wall-clock minute or tolerate a retry window.
  const temporal = await page.evaluate(`(() => {
    const probe = globalThis.__aaUpdateEconomyProbe;
    const readCandidates = () => [...document.querySelectorAll('[data-testid*="-countdown-"]')]
      .map((container) => {
        const testId = container.getAttribute('data-testid') ?? '';
        const match = /^(hero(?:-prev|-next)?)-countdown-(\\d+(?:\\.\\d+)?)$/.exec(testId);
        if (!match) return null;
        const textNode = document.querySelector('[data-testid="' + match[1] + '-minutes"]');
        const text = textNode?.textContent ?? null;
        return text === null ? null : {
          prefix: match[1],
          targetMs: Number(match[2]),
          text,
          value: Number(text.trim()),
          deadlineMs: Number(match[2]) - (Number(text.trim()) - 1) * 60_000,
        };
      })
      .filter((candidate) => candidate && Number.isFinite(candidate.deadlineMs) && candidate.value > 0);
    let clock = probe.beginScriptedContractClock(Date.now());
    const skippedEarlierDeadlines = [];
    try {
      for (let index = 0; index < 64; index += 1) {
        if (clock.earliestDeadline === null) throw new Error('mounted temporal queue has no deadline');
        const deadlineMs = Number(clock.earliestDeadline);
        if (!Number.isFinite(deadlineMs)) throw new Error('mounted temporal queue has no deadline');
        const candidate = readCandidates().find((item) => item.deadlineMs === deadlineMs);
        if (candidate) {
          probe.resetUpdateEconomyRenderer();
          const before = probe.sampleUpdateEconomy();
          const clockBefore = clock;
          const clockAfter = probe.advanceScriptedContractClock(deadlineMs);
          const after = probe.sampleUpdateEconomy(before.reactive.wave);
          return {
            candidate,
            deadlineMs,
            skippedEarlierDeadlines,
            before,
            after,
            afterText: document.querySelector('[data-testid="' + candidate.prefix + '-minutes"]')?.textContent ?? null,
            clock: { before: clockBefore, after: clockAfter },
          };
        }
        skippedEarlierDeadlines.push(deadlineMs);
        clock = probe.advanceScriptedContractClock(deadlineMs);
      }
      throw new Error('no visible production countdown became the earliest deadline');
    } finally {
      probe.endScriptedContractClock();
      probe.resetUpdateEconomyRenderer();
    }
  })()`);
  const temporalBefore = temporal.before;
  const temporalAfter = temporal.after;
  const temporalText = temporal.afterText;
  const temporalReactiveDelta = subtractReactive(
    temporalAfter.reactive,
    temporalBefore.reactive,
  );
  if (temporalText === temporal.candidate.text) {
    throw new Error(`scripted terminal deadline did not change text: ${JSON.stringify(temporal)}`);
  }
  if (temporalReactiveDelta.computedRecomputes !== 0) {
    const recomputedNodes = (temporalAfter.reactive?.nodes ?? [])
      .filter((node) => Number(node.recomputes ?? 0) > 0);
    throw new Error(
      `terminal deadline recomputed app dataflow: ` +
      JSON.stringify({ temporalReactiveDelta, recomputedNodes, candidate: temporal.candidate }),
    );
  }
  if (Number(temporalAfter.renderer?.totals?.hostText?.changed ?? 0) < 1) {
    throw new Error(`terminal deadline emitted no changed text: ${JSON.stringify(temporalAfter.renderer)}`);
  }
  const temporalCommits = temporalAfter.renderer?.commits ?? [];
  assertCauseAccounting(temporalAfter.renderer, 'D5 terminal deadline');
  const joinedTemporalCommits = temporalCommits.filter((commit) => commit.reactive !== null);
  if (
    joinedTemporalCommits.length === 0 ||
    joinedTemporalCommits.some((commit) => Number(commit.reactive?.computedRecomputes ?? -1) !== 0) ||
    Number(temporalAfter.renderer?.totals?.reactive?.waves ?? 0) < 1 ||
    Number(temporalAfter.renderer?.totals?.reactive?.effectRuns ?? 0) < 1 ||
    Number(temporalAfter.renderer?.totals?.reactive?.computedRecomputes ?? -1) !== 0
  ) {
    throw new Error(`D5 terminal commit/reactive join failed: ${JSON.stringify(temporalAfter.renderer)}`);
  }
  const controlDuration = durationSummary(reporterDisabledControl.durationsMs);
  const reporterDuration = durationSummary(reporterEnabledControl.durationsMs);
  assertCauseAccounting(
    reporterEnabledControl.representativeReport,
    'D5 representative scheme commit',
  );
  const representativeAttempts =
    Number(reporterEnabledControl.representativeReport?.totals?.hostElements?.attempts ?? 0) +
    Number(reporterEnabledControl.representativeReport?.totals?.hostText?.attempts ?? 0);
  const profilerAllowanceMs = Math.max(1, Number(controlDuration.p95Ms) * 0.1);
  const profilerOverheadMs = Number(reporterDuration.p95Ms) - Number(controlDuration.p95Ms);
  if (
    controlDuration.count !== 30 ||
    reporterDuration.count !== 30 ||
    representativeAttempts < 100 ||
    !Number.isFinite(controlDuration.p95Ms) ||
    !Number.isFinite(reporterDuration.p95Ms) ||
    profilerOverheadMs > profilerAllowanceMs
  ) {
    throw new Error(
      `D5 profiler p95 overhead ${profilerOverheadMs.toFixed(3)}ms exceeds ${profilerAllowanceMs.toFixed(3)}ms: ` +
      JSON.stringify({ controlDuration, reporterDuration, representativeAttempts }),
    );
  }

  // The scripted D2 proof intentionally drives the mounted queue into the
  // future and revalidates it back to ambient time. Remount before the idle
  // gate so async work caused by that test-only wall jump cannot masquerade
  // as product idle churn. The reporter remains lazy on the fresh realm.
  await page.navigate(`${viteUrl}/?appearance=light`);
  await page.evaluate(`(async () => {
    const deadline = Date.now() + 90000;
    while (!globalThis.allAboard) {
      if (Date.now() > deadline) throw new Error('remounted allAboard did not appear');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await globalThis.allAboard.ready;
    globalThis.__aaUpdateEconomyProbe = await import('/update-economy-probe.ts');
    await globalThis.__aaUpdateEconomyProbe.installUpdateEconomyReporter();
  })()`);
  await sleep(settleMs);
  await page.evaluate(`(() => {
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
  })()`);

  // A clean post-remount idle window stays completely asleep; this preserves
  // the original broad-cascade regression gate alongside D1-D3.
  const idleBefore = await page.evaluate(`(() => {
    const probe = globalThis.__aaUpdateEconomyProbe;
    probe.resetUpdateEconomyRenderer();
    return probe.sampleUpdateEconomy();
  })()`);
  await sleep(ticks * 1_000 + 250);
  const idleAfter = await page.evaluate(`(() => {
    globalThis.__aaFrameSampling = false;
    return {
      sample: globalThis.__aaUpdateEconomyProbe.sampleUpdateEconomy(${Number(idleBefore.reactive.wave)}),
      frames: globalThis.__aaFrameIntervals,
    };
  })()`);
  const idleReactiveDelta = subtractReactive(idleAfter.sample.reactive, idleBefore.reactive);
  if (idleAfter.sample.renderer?.enabled !== true) {
    throw new Error(`post-remount idle reporter is unavailable: ${JSON.stringify(idleAfter.sample.renderer)}`);
  }
  if (idleReactiveDelta.computedRecomputes !== 0) {
    const recomputedNodes = (idleAfter.sample.reactive?.nodes ?? [])
      .filter((node) => Number(node.recomputes ?? 0) > 0)
      .map((node) => ({ ...node }));
    throw new Error(
      `post-deadline idle window recomputed ${idleReactiveDelta.computedRecomputes} app computeds: ` +
      JSON.stringify(recomputedNodes),
    );
  }
  const idleEqualHostElements = Number(idleAfter.sample.renderer?.totals?.hostElements?.equal ?? 0);
  const idleEqualHostText = Number(idleAfter.sample.renderer?.totals?.hostText?.equal ?? 0);
  if (idleEqualHostElements !== 0 || idleEqualHostText !== 0) {
    throw new Error(
      `post-deadline idle emitted value-equal host attempts: ` +
      JSON.stringify({ idleEqualHostElements, idleEqualHostText }),
    );
  }

  const frames = frameSummary(idleAfter.frames);
  const minimumFrameSamples = ticks * 30;
  if (
    frames.count < minimumFrameSamples ||
    !Number.isFinite(frames.p95Ms) ||
    Number(frames.p95Ms) > 11
  ) {
    throw new Error(`D5 frame p95 ${frames.p95Ms}ms exceeds 11ms: ${JSON.stringify(frames)}`);
  }

  return {
    variant: 'final',
    gates: {
      d1EqualHostTransactions: {
        count: 8,
        publicationDelta: hostPublicationDelta,
        appliedTransactionDelta: hostAppliedDelta,
        reactive: {
          before: summarizeReactive(hostBefore.sample.reactive),
          after: summarizeReactive(hostAfter.sample.reactive),
          delta: hostReactiveDelta,
        },
        hostDebug: { before: hostBefore.host, after: hostAfter.host },
        renderer: hostAfter.sample.renderer,
      },
      d1FrozenClockReaderMatrix: hostReaderMatrix,
      d2TerminalDeadline: {
        mode: 'scripted-production-countdown',
        candidate: temporal.candidate,
        deadlineMs: temporal.deadlineMs,
        skippedEarlierDeadlines: temporal.skippedEarlierDeadlines,
        clock: temporal.clock,
        beforeText: temporal.candidate.text,
        afterText: temporalText,
        reactive: {
          before: summarizeReactive(temporalBefore.reactive),
          after: summarizeReactive(temporalAfter.reactive),
          delta: temporalReactiveDelta,
        },
        renderer: temporalAfter.renderer,
      },
      d3EqualRawText: {
        reactive: summarizeReactive(equality.reactive),
        renderer: equality.renderer,
      },
      d5ProfilerOverhead: {
        workload: reporterEnabledControl.workload,
        trials: reporterDuration.count,
        representativeHostAttempts: representativeAttempts,
        control: controlDuration,
        reporter: reporterDuration,
        controlSamplesMs: reporterDisabledControl.durationsMs,
        reporterSamplesMs: reporterEnabledControl.durationsMs,
        representativeRenderer: reporterEnabledControl.representativeReport,
        overheadP95Ms: profilerOverheadMs,
        allowanceMs: profilerAllowanceMs,
      },
      idle: {
        window: { ticks, durationMs: ticks * 1_000 + 250 },
        reactive: {
          before: summarizeReactive(idleBefore.reactive),
          after: summarizeReactive(idleAfter.sample.reactive),
          delta: idleReactiveDelta,
        },
        renderer: idleAfter.sample.renderer,
      },
    },
    frames: {
      summary: frames,
      minimumSamples: minimumFrameSamples,
      samplesMs: idleAfter.frames,
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

  console.log(`Measuring migrated final surface (${ticks}s idle window)…`);
  const result = await measureFinalSurface(page, viteUrl);

  const report = {
    schemaVersion: 4,
    issue: 'ENG-24188',
    recordedAt: new Date().toISOString(),
    method: {
      host: 'web',
      browser: chrome.version.Browser,
      protocolVersion: chrome.version['Protocol-Version'],
      platform: `${process.platform}-${process.arch}`,
      headless: true,
      route: '/?appearance=light',
      viewport,
      ticks,
      settleMs,
      assertion: 'D1 equal host records produce zero waves; D2 scripted production deadline changes text with zero app recomputes; D3 equal raw text is skipped; D5 joins renderer commits to reactive waves with complete attribution; post-deadline idle recomputes stay zero',
    },
    revisions: {
      snapback: git(repoRoot, ['rev-parse', 'HEAD']),
      snapbackDirty: git(repoRoot, ['status', '--short']),
      exact: git(exactRoot, ['rev-parse', 'HEAD']),
      exactDirty: git(exactRoot, ['status', '--short']),
    },
    result,
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
