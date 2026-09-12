import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const app = resolve(process.env.SNAPBACK3_TARGET_APP ?? 'candidate-app');
const output = resolve(process.env.SNAPBACK3_TARGET_OUTPUT ?? `results/attempt-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`);
const node = process.env.SNAPBACK3_NODE ?? process.execPath;
const port = Number(process.env.SNAPBACK3_PORT ?? 54924);
const repetitions = Number(process.env.SNAPBACK3_REPETITIONS ?? 1);
const profile = process.env.SNAPBACK3_PROFILE === '1';
const networkShape = process.env.SNAPBACK3_NETWORK_SHAPE === '50ms-10mbit-5mbit'
  ? { offline: false, latency: 50, downloadThroughput: 1_250_000,
      uploadThroughput: 625_000, connectionType: 'wifi' }
  : null;
if (process.env.SNAPBACK3_NETWORK_SHAPE && !networkShape) {
  throw new Error(`Unknown SNAPBACK3_NETWORK_SHAPE ${process.env.SNAPBACK3_NETWORK_SHAPE}.`);
}
if (![54924, 54925].includes(port)) throw new Error(`Refusing unauthorized port ${port}.`);
await stat(app);
await mkdir(output, { recursive: false });

const sleep = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms));
const hash = value => createHash('sha256').update(value).digest('hex');
const fileHash = async path => hash(await readFile(path));
const json = value => JSON.stringify(value, null, 2) + '\n';
const processStartTick = async pid => {
  const value = await readFile(`/proc/${pid}/stat`, 'utf8');
  const end = value.lastIndexOf(') ');
  if (end < 0) throw new Error(`Cannot parse /proc/${pid}/stat.`);
  const fields = value.slice(end + 2).trim().split(' ');
  if (!/^\d+$/.test(fields[19] ?? '')) throw new Error(`Cannot read start tick for PID ${pid}.`);
  return fields[19];
};
const ownedAlive = async owner => {
  try { return (await processStartTick(owner.pid)) === owner.startTick; } catch { return false; }
};
const chromiumOwner = async profileDir => {
  const matches = [];
  for (const entry of await readdir('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const command = (await readFile(`/proc/${entry}/cmdline`)).toString().replaceAll('\0', ' ');
      if (command.includes(`--user-data-dir=${profileDir}`)) matches.push(Number(entry));
    } catch {}
  }
  if (matches.length !== 1) throw new Error(`Expected one Chromium owner for ${profileDir}; found ${matches.join(',') || 'none'}.`);
  const pid = matches[0];
  return { pid, startTick: await processStartTick(pid) };
};
const executableOwner = async executable => {
  const matches = [];
  for (const entry of await readdir('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const command = (await readFile(`/proc/${entry}/cmdline`)).toString().replaceAll('\0', ' ');
      if (command.includes(executable)) matches.push(Number(entry));
    } catch {}
  }
  if (matches.length !== 1) throw new Error(`Expected one packaged worker ${executable}; found ${matches.join(',') || 'none'}.`);
  const pid = matches[0];
  return { pid, startTick: await processStartTick(pid), path: executable };
};
const waitFor = async (condition, timeoutMs, label) => {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try { if (await condition()) return; } catch (error) { last = error; }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}${last ? `: ${last}` : ''}`);
};

const packageJson = JSON.parse(await readFile(resolve(app, 'node_modules/snapback3/package.json'), 'utf8'));
const packagedWorker = resolve(app, 'node_modules/snapback3/dist/native',
  `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'snapback3-worker.exe' : 'snapback3-worker');
await stat(packagedWorker);
const serviceWorkerSource = await readFile(resolve(app, 'dist/sw.js'), 'utf8');
const expectedShellCacheName = JSON.parse(serviceWorkerSource.match(/const CACHE = ("[^"]+")/)?.[1] ?? 'null');
if (!expectedShellCacheName) throw new Error('The built shell has no readable content-bound cache name.');
const metadata = {
  createdAt: new Date().toISOString(), app, output, port, repetitions, profile, networkShape,
  node, nodeVersion: process.version,
  packageVersion: packageJson.version,
  packageJsonSha256: await fileHash(resolve(app, 'node_modules/snapback3/package.json')),
  packagedWorker: { path: packagedWorker, sha256: await fileHash(packagedWorker), ambientOverrideRemoved: true },
  controllerSha256: await fileHash(fileURLToPath(import.meta.url)),
  expectedShellCacheName,
  appHashes: {
    acquire: await fileHash(resolve(app, 'src/acquire.ts')),
    retainedSerialWalker: await fileHash(resolve(app, 'src/retained-serial-walker.ts')),
    chat: await fileHash(resolve(app, 'src/chat.tsx')),
    client: await fileHash(resolve(app, 'src/client.tsx')),
    screens: await fileHash(resolve(app, 'src/screens.tsx')),
    schema: await fileHash(resolve(app, 'snapback/schema.q')),
    distIndex: await fileHash(resolve(app, 'dist/index.html')),
    distServiceWorker: await fileHash(resolve(app, 'dist/sw.js')),
  },
};
await writeFile(resolve(output, 'metadata.json'), json(metadata));

const log = await import('node:fs').then(fs => fs.createWriteStream(resolve(output, 'owner.log'), { flags: 'wx' }));
const ownerEnv = { ...process.env, NODE_ENV: 'production' };
delete ownerEnv.SNAPBACK3_WORKER;
const ownerProcess = spawn(node, [resolve(app, 'node_modules/snapback3', packageJson.bin.snapback3), 'dev', '.', '--port', String(port)], {
  cwd: app, env: ownerEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
});
ownerProcess.stdout.pipe(log); ownerProcess.stderr.pipe(log);
const owner = { pid: ownerProcess.pid, startTick: await processStartTick(ownerProcess.pid), port };
await writeFile(resolve(output, 'owner-custody.json'), json(owner));

let chromiumPid;
let chromiumStartTick;
let runtimeWorker;
const results = [];
let stoppedForTarget = false;
try {
  await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/api/manifest`)).ok, 60_000, 'owner manifest');
  runtimeWorker = await executableOwner(packagedWorker);
  await writeFile(resolve(output, 'worker-custody.json'), json(runtimeWorker));
  const { chromium } = await import(resolve(app, 'node_modules/playwright/index.mjs'));
  for (let repetition = 1; repetition <= repetitions; repetition++) {
    const runDir = resolve(output, `run-${String(repetition).padStart(2, '0')}`);
    const profileDir = resolve(runDir, 'browser-profile');
    await mkdir(runDir);
    const result = { repetition, startedAt: new Date().toISOString(), success: false };
    const checkpoint = () => writeFile(resolve(runDir, 'result.partial.json'), json(result));
    try {
      const context = await chromium.launchPersistentContext(profileDir, {
        headless: true, serviceWorkers: 'allow', args: ['--no-sandbox'],
      });
      ({ pid: chromiumPid, startTick: chromiumStartTick } = await chromiumOwner(profileDir));
      await writeFile(resolve(runDir, 'chromium-custody.json'), json({ pid: chromiumPid, startTick: chromiumStartTick }));
      const page = context.pages()[0] ?? await context.newPage();
      await page.addInitScript(() => {
        const state = { pageTimeOrigin: performance.timeOrigin, observerInstalledAt: performance.now() };
        window.__acquisitionDomMilestones = state;
        const pending = new Set();
        const visible = node => {
          if (!node) return false;
          const box = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        };
        const observe = (key, selector) => {
          if (state[key] || pending.has(key)) return;
          const node = document.querySelector(selector);
          if (!visible(node)) return;
          pending.add(key);
          requestAnimationFrame(() => {
            pending.delete(key);
            const painted = document.querySelector(selector);
            if (!visible(painted)) return;
            state[key] = { afterPaintAt: performance.now(), selector,
              visibleCount: [...document.querySelectorAll(selector)].filter(visible).length };
          });
        };
        const check = () => {
          observe('firstUsefulInbox', '[data-testid="sm-chats-item"]');
          observe('firstUsefulHistory', '[data-testid^="message-"]');
          if (state.firstUsefulInbox && state.firstUsefulHistory) observer.disconnect();
        };
        const observer = new MutationObserver(check);
        observer.observe(document, { childList: true, subtree: true });
        requestAnimationFrame(check);
      });
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      if (networkShape) await cdp.send('Network.emulateNetworkConditions', networkShape);
      await cdp.send('Performance.enable');
      if (profile) await cdp.send('Profiler.enable').then(() => cdp.send('Profiler.start'));
      const network = { requests: 0, responseHeaderBytes: 0, encodedDataBytes: 0, byPath: {}, acquireResponses: [] };
      const requestPaths = new Map();
      const encodedByRequest = new Map();
      const responseTimes = new Map();
      const acquireRequestIds = [];
      cdp.on('Network.requestWillBeSent', event => {
        network.requests++;
        const path = new URL(event.request.url).pathname;
        requestPaths.set(event.requestId, path);
        network.byPath[path] ??= { requests: 0, responseHeaderBytes: 0, encodedDataBytes: 0 };
        network.byPath[path].requests++;
        if (path === '/api/acquire') {
          let requestBody;
          try { requestBody = JSON.parse(event.request.postData ?? '{}'); } catch { requestBody = null; }
          acquireRequestIds.push({ requestId: event.requestId, requestBody, requestTimestamp: event.timestamp });
        }
      });
      cdp.on('Network.responseReceived', event => {
        const path = new URL(event.response.url).pathname;
        network.responseHeaderBytes += event.response.encodedDataLength ?? 0;
        if (network.byPath[path]) network.byPath[path].responseHeaderBytes += event.response.encodedDataLength ?? 0;
        responseTimes.set(event.requestId, { responseTimestamp: event.timestamp });
      });
      cdp.on('Network.loadingFinished', event => {
        network.encodedDataBytes += event.encodedDataLength ?? 0;
        encodedByRequest.set(event.requestId, event.encodedDataLength ?? 0);
        responseTimes.set(event.requestId, { ...responseTimes.get(event.requestId), finishedTimestamp: event.timestamp });
        const path = requestPaths.get(event.requestId);
        if (path && network.byPath[path]) network.byPath[path].encodedDataBytes += event.encodedDataLength ?? 0;
      });

      const outerStart = performance.now();
      await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => Boolean(window.acquisitionTarget), undefined, { timeout: 30_000 });
      const inner = await page.evaluate(() => window.acquisitionTarget.runIntegratedAcquisition('u0500'));
      Object.assign(result, { inner });
      await checkpoint();
      await page.getByText('Busy Group 0001', { exact: true }).click();
      await page.getByTestId('history-status').waitFor({ state: 'visible' });
      await page.getByTestId('history-search').fill('busy');
      await page.waitForFunction(() => document.querySelectorAll('[data-testid^="message-"]').length > 0);
      await page.waitForFunction(() => Boolean(window.__acquisitionDomMilestones?.firstUsefulInbox
        && window.__acquisitionDomMilestones?.firstUsefulHistory));
      const domMilestones = await page.evaluate(() => window.__acquisitionDomMilestones);
      const outerStartEpochMs = performance.timeOrigin + outerStart;
      for (const value of [domMilestones.firstUsefulInbox, domMilestones.firstUsefulHistory]) {
        value.fromOuterStartMs = domMilestones.pageTimeOrigin + value.afterPaintAt - outerStartEpochMs;
      }
      const ui = await page.evaluate(() => ({
        historyStatus: document.querySelector('[data-testid="history-status"]')?.textContent,
        search: document.querySelector('[data-testid="history-search"]')?.getAttribute('value')
          ?? document.querySelector('[data-testid="history-search"]')?.value,
        renderedMessages: document.querySelectorAll('[data-testid^="message-"]').length,
      }));
      const primaryElapsedMs = performance.now() - outerStart;
      Object.assign(result, { primaryElapsedMs, ui, domMilestones });
      await checkpoint();
      const cpuProfile = profile ? (await cdp.send('Profiler.stop')).profile : undefined;
      if (cpuProfile) await writeFile(resolve(runDir, 'cpu-profile.json'), json(cpuProfile));
      const heapBeforeAudit = await cdp.send('Runtime.getHeapUsage');
      const performanceBeforeAudit = await cdp.send('Performance.getMetrics');
      const storageTimings = await page.evaluate(() => window.storageTimings ?? []);
      const searchExpected = await page.evaluate(() => window.acquisitionTarget.deriveSearchControl());
      await page.getByTestId('history-search').fill(searchExpected.term);
      await page.waitForFunction(count => document.querySelectorAll('[data-testid^="message-"]').length === count,
        searchExpected.expectedIds.length);
      const narrowIds = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="message-"]')]
        .map(node => node.getAttribute('data-testid').slice('message-'.length)).sort());
      if (JSON.stringify(narrowIds) !== JSON.stringify(searchExpected.expectedIds)) {
        throw new Error(`Narrow search IDs differ: ${JSON.stringify({ searchExpected, narrowIds })}`);
      }
      await page.getByTestId('history-search').fill(searchExpected.negative);
      await page.waitForFunction(() => document.querySelectorAll('[data-testid^="message-"]').length === 0);
      await page.getByTestId('history-search').fill('busy');
      await page.waitForFunction(count => document.querySelectorAll('[data-testid^="message-"]').length === count,
        searchExpected.pageRows);
      const searchControl = { ...searchExpected, narrowIds, negativeRendered: 0, restoredRendered: searchExpected.pageRows };
      Object.assign(result, { searchControl, network, heapBeforeAudit,
        performanceBeforeAudit: performanceBeforeAudit.metrics, storageTimings });
      await checkpoint();
      for (const request of acquireRequestIds) {
        const received = await cdp.send('Network.getResponseBody', { requestId: request.requestId });
        const decoded = received.base64Encoded ? Buffer.from(received.body, 'base64') : Buffer.from(received.body);
        let responseBody;
        try { responseBody = JSON.parse(decoded.toString('utf8')); } catch { responseBody = null; }
        const timing = responseTimes.get(request.requestId) ?? {};
        const chains = request.requestBody?.chains ?? [];
        const phases = [...new Set(chains.map(chain => String(chain.key).startsWith('validation:') ? 'validation' : 'traverse'))];
        network.acquireResponses.push({
          phase: phases.length === 1 ? phases[0] : phases.length ? 'mixed' : 'unknown',
          wallMs: timing.finishedTimestamp && request.requestTimestamp
            ? (timing.finishedTimestamp - request.requestTimestamp) * 1000 : null,
          headersMs: timing.responseTimestamp && request.requestTimestamp
            ? (timing.responseTimestamp - request.requestTimestamp) * 1000 : null,
          encodedDataBytes: encodedByRequest.get(request.requestId) ?? null,
          decodedBodyBytes: decoded.byteLength,
          requestChains: chains.length,
          responsePages: responseBody?.pages?.length ?? null,
          responseContinuations: responseBody?.continuations?.length ?? null,
          more: responseBody?.more ?? null,
          seq: responseBody?.seq ?? null,
        });
      }
      await checkpoint();
      const audit = await page.evaluate(() => window.acquisitionTarget.runOfflineAudit());
      Object.assign(result, { audit });
      await checkpoint();
      await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
      await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), undefined, { timeout: 5000 });
      const shellCacheName = await page.evaluate(() => new Promise((resolvePromise, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timed out reading the active acquisition shell version.')), 5000);
        const listener = event => {
          if (event.data?.type !== 'snapback3-acquisition-shell-version') return;
          clearTimeout(timeout); navigator.serviceWorker.removeEventListener('message', listener); resolvePromise(event.data.cacheName);
        };
        navigator.serviceWorker.addEventListener('message', listener);
        if (!navigator.serviceWorker.controller) { clearTimeout(timeout); reject(new Error('The acquisition shell has no controlling worker.')); return; }
        navigator.serviceWorker.controller.postMessage({ type: 'snapback3-acquisition-shell-version' });
      }));
      if (shellCacheName !== expectedShellCacheName) throw new Error(`Unexpected acquisition shell ${shellCacheName}.`);
      await context.close();
      chromiumPid = undefined; chromiumStartTick = undefined;

      const reopenStart = performance.now();
      const reopened = await chromium.launchPersistentContext(profileDir, {
        headless: true, serviceWorkers: 'allow', args: ['--no-sandbox'],
      });
      ({ pid: chromiumPid, startTick: chromiumStartTick } = await chromiumOwner(profileDir));
      await writeFile(resolve(runDir, 'reopened-chromium-custody.json'),
        json({ pid: chromiumPid, startTick: chromiumStartTick }));
      const reopenedPage = reopened.pages()[0] ?? await reopened.newPage();
      await reopened.setOffline(true);
      const navigation = await reopenedPage.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded' });
      if (navigation?.status() !== 200 || navigation.fromServiceWorker() !== true) {
        throw new Error(`Strict offline shell navigation failed: status=${navigation?.status()} serviceWorker=${navigation?.fromServiceWorker()}.`);
      }
      await reopenedPage.waitForFunction(() => Boolean(window.acquisitionTarget), undefined, { timeout: 30_000 });
      const reopenedShellCacheName = await reopenedPage.evaluate(() => new Promise((resolvePromise, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timed out reading the reopened acquisition shell version.')), 5000);
        const listener = event => {
          if (event.data?.type !== 'snapback3-acquisition-shell-version') return;
          clearTimeout(timeout); navigator.serviceWorker.removeEventListener('message', listener); resolvePromise(event.data.cacheName);
        };
        navigator.serviceWorker.addEventListener('message', listener);
        if (!navigator.serviceWorker.controller) { clearTimeout(timeout); reject(new Error('The reopened acquisition shell has no controlling worker.')); return; }
        navigator.serviceWorker.controller.postMessage({ type: 'snapback3-acquisition-shell-version' });
      }));
      if (reopenedShellCacheName !== expectedShellCacheName) throw new Error(`Unexpected reopened acquisition shell ${reopenedShellCacheName}.`);
      const reopen = await reopenedPage.evaluate(() => window.acquisitionTarget.runOfflineReopenControl());
      const reopenAudit = await reopenedPage.evaluate(() => window.acquisitionTarget.runOfflineAudit());
      const reopenElapsedMs = performance.now() - reopenStart;
      await reopened.close();
      chromiumPid = undefined; chromiumStartTick = undefined;

      Object.assign(result, {
        success: true,
        reopen: { elapsedMs: reopenElapsedMs, mainResponseFromServiceWorker: navigation.fromServiceWorker(),
          status: navigation?.status() ?? null, shellCacheName: reopenedShellCacheName, value: reopen, audit: reopenAudit },
      });
      await checkpoint();
      if (primaryElapsedMs > 3000 && !profile) stoppedForTarget = true;
    } catch (error) {
      result.error = { name: error?.name, message: error?.message, stack: error?.stack };
    }
    result.finishedAt = new Date().toISOString();
    await writeFile(resolve(runDir, 'result.json'), json(result));
    results.push(result);
    await writeFile(resolve(output, 'summary.partial.json'), json({ metadata, stoppedForTarget, results }));
    if (!result.success || stoppedForTarget) break;
  }
} finally {
  if (chromiumPid && await ownedAlive({ pid: chromiumPid, startTick: chromiumStartTick })) {
    try { process.kill(chromiumPid, 'SIGTERM'); } catch {}
  }
  if (await ownedAlive(owner)) {
    try { process.kill(-owner.pid, 'SIGTERM'); } catch {}
    await waitFor(async () => !(await ownedAlive(owner)), 10_000, 'owned server exit').catch(() => {});
    if (await ownedAlive(owner)) try { process.kill(-owner.pid, 'SIGKILL'); } catch {}
  }
  if (runtimeWorker && await ownedAlive(runtimeWorker)) {
    try { process.kill(runtimeWorker.pid, 'SIGTERM'); } catch {}
    await waitFor(async () => !(await ownedAlive(runtimeWorker)), 10_000, 'owned worker exit').catch(() => {});
    if (await ownedAlive(runtimeWorker)) try { process.kill(runtimeWorker.pid, 'SIGKILL'); } catch {}
  }
  owner.cleaned = !(await ownedAlive(owner));
  owner.cleanedAt = new Date().toISOString();
  await writeFile(resolve(output, 'cleanup-receipt.json'), json(owner));
  if (runtimeWorker) {
    runtimeWorker.cleaned = !(await ownedAlive(runtimeWorker));
    runtimeWorker.cleanedAt = new Date().toISOString();
    await writeFile(resolve(output, 'worker-cleanup-receipt.json'), json(runtimeWorker));
  }
  log.end();
}
await writeFile(resolve(output, 'summary.json'), json({ metadata, stoppedForTarget, results }));
process.exitCode = results.every(result => result.success) ? 0 : 1;
