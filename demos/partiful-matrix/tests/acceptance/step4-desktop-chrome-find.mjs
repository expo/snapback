#!/usr/bin/env node

import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { arch, cpus, platform, release, tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchChromeCdp } from '../../../_kit/chrome-process.mjs';
import { createSuite, runAcceptance } from '../../../_kit/harness.mjs';
import { freePort } from '../../../_kit/provenance.mjs';
import { stopChild } from '../../../_kit/server-process.mjs';

// @ref LLP 0063#workstream-3--contract-as-a-complete-product-surface-language —
// browser find is proven against visible production Contract output in the
// named desktop browser; it is not inferred from DOM text or another engine.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const demoRoot = resolve(here, '..', '..');
const surfaceRoot = join(demoRoot, 'surfaces', 'contract');
const chromeBin = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const serverBin = join(repoRoot, 'target', 'debug', 'snapback');
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const option = (name) => { const at = process.argv.indexOf(`--${name}`); return at < 0 ? null : process.argv[at + 1]; };
const receiptFile = option('receipt') ?? join(demoRoot, 'acceptance', 'results', 'step4-web-citizenship-desktop-chrome-find.json');
const suite = createSuite('Partitime / desktop Chrome find-on-page', { expectedChecks: 1 });
const cleanups = [];

const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const identity = (path) => ({
  path: relative(repoRoot, path),
  sha256: digest(path),
  bytes: readFileSync(path).length,
});
const command = (program, args, options = {}) => {
  try { return execFileSync(program, args, { encoding: 'utf8', ...options }).trim(); }
  catch { return null; }
};

const prerequisites = [
  chromeBin,
  serverBin,
  join(surfaceRoot, 'node_modules', '.bin', 'vite'),
];
const missing = prerequisites.filter((path) => !existsSync(path));
const revision = command('git', ['rev-parse', 'HEAD'], { cwd: repoRoot });
const dirty = command('git', ['status', '--porcelain=v1'], { cwd: repoRoot }) !== '';
const testInventory = [
  join(repoRoot, 'demos', '_kit', 'harness.mjs'),
  join(repoRoot, 'demos', '_kit', 'chrome-process.mjs'),
  join(repoRoot, 'demos', '_kit', 'server-process.mjs'),
  fileURLToPath(import.meta.url),
].map(identity);
const reportIdentity = {
  schemaVersion: 'partitime.desktop-chrome-find.v1',
  claimId: 'STEP4.WEB_CITIZENSHIP.DESKTOP_CHROME.FIND',
  recordedAt: new Date().toISOString(),
  repository: { revision, dirty },
  claimEligible: !dirty && missing.length === 0,
  cells: ['contract:snapback'],
  environment: {
    node: process.version,
    bun: command('bun', ['--version']),
    os: `${platform()}-${release()}-${arch()}`,
    chrome: chromeBin,
    chromeVersion: command(chromeBin, ['--version']),
    cpu: cpus()[0]?.model ?? null,
  },
  artifacts: [
    join(surfaceRoot, 'main.ts'),
    join(surfaceRoot, 'provider.ts'),
    join(surfaceRoot, 'feed.contract'),
    join(surfaceRoot, 'event.contract'),
  ].filter(existsSync).map(identity),
  testInventory,
  missingPrerequisites: missing.map((path) => relative(repoRoot, path)),
};

await runAcceptance(suite, async () => {
  if (missing.length > 0) throw new Error(`required desktop Chrome find prerequisites are missing: ${missing.join(', ')}`);
  const snapbackUrl = await startSnapback();
  const gatewayUrl = await startGateway(snapbackUrl);
  const vite = await startVite(snapbackUrl, gatewayUrl);
  cleanups.push(() => vite.stop());
  const chrome = await launchChromeCdp({ chromeBin, userDataPrefix: 'partitime-chrome-find-' });
  cleanups.push(() => chrome.stop());
  const cdp = await connectCdp(chrome.ws);
  cleanups.push(() => cdp.close());
  const page = await cdp.newPage();
  cleanups.push(() => page.close());

  await page.navigate(`${vite.url}/?user=eve`);
  await page.eval(`(async()=>{const d=Date.now()+30000;while(!window.partifulMatrixReady){if(Date.now()>d)throw new Error('boot timeout');await new Promise(r=>setTimeout(r,50));}return await window.partifulMatrixReady;})()`);
  const ready = await page.pollText('feed-ready', 'Sunset Supper Club', 15_000);
  if (!ready?.includes('Sunset Supper Club')) throw new Error(`canonical feed did not become visible: ${ready}`);

  await suite.check('contract × snapback exposes visible content to browser find-on-page', async () => {
    const found = await page.eval(`(()=>{
      getSelection()?.removeAllRanges();
      const matched = window.find('Sunset Supper Club', false, false, true, false, false, false);
      const selection = getSelection()?.toString() ?? '';
      const anchor = getSelection()?.anchorNode?.parentElement?.closest('[data-testid]')?.getAttribute('data-testid') ?? null;
      return { matched, selection, anchor };
    })()`);
    if (!found.matched || !found.selection.includes('Sunset Supper Club')) {
      throw new Error(`browser find did not select visible event text: ${JSON.stringify(found)}`);
    }
    await page.click('open-event_sunset');
    const event = await page.pollText('event-page', 'Sunset Supper Club', 15_000);
    if (!event?.includes('Sunset Supper Club')) throw new Error(`route was not usable after browser find: ${event}`);
    return { query: 'Sunset Supper Club', ...found, usableAfterFind: true };
  });
}, { cleanups, reportFile: receiptFile, reportExtra: reportIdentity });

async function waitUrl(url, child, label, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${label} exited with ${child.exitCode}`);
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch { /* keep waiting within the bounded deadline */ }
    await sleep(100);
  }
  throw new Error(`${label} did not become ready: ${url}`);
}

async function startSnapback() {
  const readyDir = mkdtempSync(join(tmpdir(), 'partitime-chrome-find-api-'));
  const readyFile = join(readyDir, 'ready.json');
  const child = spawn(serverBin, ['--port', '0', '--memory', '--ready-file', readyFile], {
    cwd: repoRoot, detached: true, stdio: ['ignore', 'ignore', 'pipe'],
  });
  cleanups.push(
    () => rmSync(readyDir, { recursive: true, force: true }),
    () => stopChild(child),
  );
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (existsSync(readyFile)) {
      const url = `http://127.0.0.1:${JSON.parse(readFileSync(readyFile, 'utf8')).port}`;
      await waitUrl(`${url}/health`, child, 'Snapback');
      return url;
    }
    if (child.exitCode !== null) throw new Error('Snapback exited before readiness');
    await sleep(100);
  }
  throw new Error('Snapback readiness file timed out');
}

async function startGateway(snapbackUrl) {
  const port = await freePort();
  const child = spawn('bun', ['run', 'server.ts'], {
    cwd: join(demoRoot, 'backends', 'gateway'),
    detached: true,
    env: {
      ...process.env,
      PARTIFUL_MATRIX_GATEWAY_PORT: String(port),
      PARTIFUL_MATRIX_SNAPBACK_ORIGIN: snapbackUrl,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  cleanups.push(() => stopChild(child));
  const url = `http://127.0.0.1:${port}`;
  await waitUrl(`${url}/health`, child, 'Partitime gateway');
  const preflight = await fetch(`${url}/preflight`, { signal: AbortSignal.timeout(30_000) });
  if (!preflight.ok) throw new Error(`Partitime gateway preflight returned HTTP ${preflight.status}`);
  const result = await preflight.json();
  if (result.backends?.snapback?.ok !== true) throw new Error(`Snapback gateway preflight failed: ${JSON.stringify(result.backends?.snapback)}`);
  return url;
}

async function startVite(snapbackUrl, gatewayUrl) {
  const port = await freePort();
  const vite = join(surfaceRoot, 'node_modules', '.bin', 'vite');
  let log = '';
  const child = spawn('bun', [
    '--bun', vite, '--config', join(surfaceRoot, 'vite.config.ts'),
    '--mode', 'snapback', '--host', '127.0.0.1', '--port', String(port), '--strictPort',
  ], {
    cwd: surfaceRoot,
    detached: true,
    env: {
      ...process.env,
      SNAPBACK_PARTIFUL_MATRIX_API: snapbackUrl,
      PARTIFUL_MATRIX_GATEWAY: gatewayUrl,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { log += chunk; });
  child.stderr.on('data', (chunk) => { log += chunk; });
  const url = `http://127.0.0.1:${port}`;
  try { await waitUrl(url, child, 'Contract citizenship Vite'); }
  catch (error) {
    await stopChild(child);
    throw new Error(`${error.message}: ${log.slice(-4000)}`);
  }
  return { url, stop: () => stopChild(child) };
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;
  const settle = (id) => {
    const value = pending.get(id);
    if (value) clearTimeout(value.timer);
    pending.delete(id);
    return value;
  };
  socket.addEventListener('message', async (event) => {
    const message = JSON.parse(typeof event.data === 'string' ? event.data : await event.data.text());
    if (!message.id || !pending.has(message.id)) return;
    const request = settle(message.id);
    message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result ?? {});
  });
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', () => reject(new Error('CDP failed')), { once: true });
  });
  const send = (method, params = {}, sessionId = null) => new Promise((resolveSend, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { settle(id); reject(new Error(`CDP timeout: ${method}`)); }, 30_000);
    pending.set(id, { resolve: resolveSend, reject, timer });
    socket.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
  });
  return {
    close: () => socket.close(),
    newPage: async () => {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      await send('Page.enable', {}, sessionId);
      await send('Runtime.enable', {}, sessionId);
      const evalRaw = async (expression) => {
        const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId);
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
        return result.result?.value;
      };
      const selector = (id) => `[data-testid="${id}"]`;
      return {
        navigate: (pageUrl) => send('Page.navigate', { url: pageUrl }, sessionId),
        close: () => send('Target.closeTarget', { targetId }),
        eval: evalRaw,
        click: (id) => evalRaw(`(()=>{const el=document.querySelector('${selector(id)}');if(!el)throw new Error('missing ${id}');el.click();return true})()`),
        pollText: (id, pattern, timeout) => evalRaw(`(async()=>{const d=Date.now()+${timeout};let v=null;while(Date.now()<d){v=document.querySelector('${selector(id)}')?.textContent?.trim()??null;if(v&&new RegExp(${JSON.stringify(pattern)},'i').test(v))return v;await new Promise(r=>setTimeout(r,100));}return v})()`),
      };
    },
  };
}
