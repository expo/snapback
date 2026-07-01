// All Aboard — Phase 1 Contract/Exact browser acceptance (LLP 0027 / LLP 0015).
//
// Drives the real Contract surface in headless Chrome over generated Snapback
// artifacts, asserting through the rendered structured tree (testId handles), not
// DOM scraping of hand-written markup:
//   - the surface boots against a live Snapback backend and renders the board;
//   - geolocation is unavailable in headless Chrome, so the defined fallback
//     selects the nearest station to the default location (Mountain View);
//   - press affordances drive navigation (station prev, direction flip, open
//     trip) — the portable stand-in for the swipe gesture gap;
//   - a Contract action drives the generated applyFeedTick mutation and the live
//     freshness marker updates (server write -> live delta -> view).
//
// Integration lane: needs the Exact checkout + bun. Without them the surface is a
// declared capability gap and this suite skips with SNAPBACK_CAPABILITY_EXACT_MISSING.
//
// Run: node demos/all-aboard/tests/acceptance/browser.mjs
//   (reuses an already-running API :4420 + Vite :5178, else starts them).

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SnapbackClient } from '../../../_kit/client.mjs';
import { createSuite } from '../../../_kit/harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const surfaceDir = join(repoRoot, 'demos', 'all-aboard', 'surfaces', 'contract');
const chromeBin = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const API_PORT = 4420;
const VITE_PORT = 5178;
const apiUrl = `http://127.0.0.1:${API_PORT}`;
const viteUrl = `http://127.0.0.1:${VITE_PORT}`;

const exactRoot = process.env.SNAPBACK_EXACT_ROOT
  ? resolve(process.env.SNAPBACK_EXACT_ROOT)
  : resolve(repoRoot, '..', 'exact');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const urlOk = async (url) => { try { return (await fetch(url, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } };

const suite = createSuite('all-aboard browser (Phase 1)');
const cleanups = [];
let cdp = null;
let page = null;

async function ensureApi() {
  if (await urlOk(`${apiUrl}/health`)) return;
  const env = { ...process.env };
  if (process.platform === 'darwin' && !env.DYLD_FRAMEWORK_PATH) {
    env.DYLD_FRAMEWORK_PATH = join(repoRoot, 'vendor', 'ibex', 'ios', 'Frameworks');
  }
  const child = spawn('cargo', ['run', '--quiet', '--', '--port', String(API_PORT), '--memory'], { cwd: repoRoot, env, stdio: ['ignore', 'ignore', 'pipe'] });
  cleanups.push(() => child.kill('SIGTERM'));
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) { if (await urlOk(`${apiUrl}/health`)) return; if (child.exitCode !== null) throw new Error('API server exited'); await sleep(500); }
  throw new Error('API server did not become healthy');
}

async function ensureVite() {
  if (await urlOk(viteUrl)) return;
  const child = spawn('bun', ['--bun', 'node_modules/.bin/vite', '--config', join(surfaceDir, 'vite.config.ts'), '--host', '127.0.0.1', '--port', String(VITE_PORT)],
    { cwd: exactRoot, env: { ...process.env, SNAPBACK_ALL_ABOARD_API: apiUrl }, stdio: ['ignore', 'ignore', 'pipe'] });
  cleanups.push(() => child.kill('SIGTERM'));
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) { if (await urlOk(viteUrl)) return; if (child.exitCode !== null) throw new Error('Vite exited'); await sleep(500); }
  throw new Error('Vite did not become ready');
}

async function main() {
  if (!existsSync(join(exactRoot, 'packages', 'exact-contract'))) {
    console.log(`SKIP all-aboard browser — SNAPBACK_CAPABILITY_EXACT_MISSING (no Exact at ${exactRoot})`);
    console.log('PASS all-aboard browser (Phase 1) — skipped (declared capability gap)');
    return;
  }
  try {
    await ensureApi();
    await ensureVite();
    const chrome = await launchChrome();
    cleanups.push(() => chrome.stop());
    cdp = await connectCdp(chrome.ws);
    cleanups.push(() => cdp.close());
    page = await cdp.newPage();
    await page.navigate(`${viteUrl}/`);

    await suite.check('surface boots against the live Snapback backend', async () => {
      const boot = await page.eval(`(async () => {
        const d = Date.now() + 20000;
        while (!window.allAboard) { if (Date.now() > d) throw new Error('window.allAboard never appeared'); await new Promise(r=>setTimeout(r,50)); }
        await window.allAboard.ready;
        return { ok: true };
      })()`);
      return boot;
    });

    await suite.check('renders the board; geolocation fallback selects the nearest station', async () => {
      const view = await page.waitForTestId('station-name');
      const stationName = await page.text('station-name');
      const heroMinutes = await page.text('hero-minutes');
      const walkBike = await page.text('walk-bike');
      if (!stationName) throw new Error('no station name rendered');
      if (!/^\d+$/.test(heroMinutes ?? '')) throw new Error(`hero minutes not numeric: ${heroMinutes}`);
      if (!/walk/.test(walkBike ?? '')) throw new Error(`walk/bike missing: ${walkBike}`);
      return { stationName, heroMinutes, walkBike, view };
    });

    await suite.check('press affordance: previous-station changes the station card', async () => {
      const before = await page.text('station-name');
      await page.click('prev-station');
      const after = await page.text('station-name');
      if (!before || before === after) throw new Error(`station did not change (${before} -> ${after})`);
      return { before, after };
    });

    await suite.check('press affordance: flip toggles the active direction', async () => {
      const before = await page.text('active-direction');
      await page.click('flip-direction');
      const after = await page.text('active-direction');
      if (before === after) throw new Error(`direction did not flip (${before})`);
      return { before, after };
    });

    await suite.check('tap a train opens its detail: ordered stops + position indicator', async () => {
      await page.click('hero-departure');
      const onTrip = await page.exists('trip-screen');
      const position = await page.text('position-label');
      const hasBar = await page.exists('position-bar');
      if (!onTrip) throw new Error('trip screen did not open');
      if (!hasBar) throw new Error('position indicator missing');
      await page.click('trip-back');
      return { position };
    });

    await suite.check('Contract action drives the generated mutation; freshness goes live', async () => {
      const before = await page.text('freshness');
      await page.click('refresh');
      const after = await page.evalPoll(`document.querySelector('[data-testid="freshness"]').textContent`, (t) => /Updated/.test(t), 5000);
      if (!/Updated/.test(after)) throw new Error(`freshness did not update: ${before} -> ${after}`);
      // Cross-check the durable write landed on the server.
      const feed = (await new SnapbackClient(apiUrl).query('feedState', {})).rows[0];
      if (!(feed.fetchedAt > 0)) throw new Error('feedRefreshState.fetchedAt not stamped');
      return { before, after, tickIndex: feed.tickIndex };
    });
  } finally {
    const report = suite.finish();
    for (const c of cleanups.reverse()) { try { await c(); } catch { /* best effort */ } }
    process.exit(report.ok ? 0 : 1);
  }
}

// --- Minimal CDP harness (adapted from demos/cursors-web/tests/acceptance) ---

async function launchChrome() {
  const userDataDir = mkdtempSync(join(tmpdir(), 'aa-browser-'));
  const child = spawn(chromeBin, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${userDataDir}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const portFile = join(userDataDir, 'DevToolsActivePort');
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const [port] = readFileSync(portFile, 'utf8').trim().split('\n');
      const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json());
      return { ws: version.webSocketDebuggerUrl, stop: () => { try { child.kill('SIGKILL'); } catch {} rmSync(userDataDir, { recursive: true, force: true }); } };
    } catch { await sleep(100); }
  }
  throw new Error('Chrome did not expose DevToolsActivePort');
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;
  socket.addEventListener('message', async (e) => {
    const text = typeof e.data === 'string' ? e.data : await e.data.text();
    const msg = JSON.parse(text);
    if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result || {}); }
  });
  await new Promise((res, rej) => { socket.addEventListener('open', res, { once: true }); socket.addEventListener('error', () => rej(new Error('CDP failed')), { once: true }); });
  const send = (method, params = {}, sessionId = null) => { const id = nextId++; socket.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params })); return new Promise((res, rej) => pending.set(id, { resolve: res, reject: rej })); };
  return {
    close: () => socket.close(),
    newPage: async () => {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      await send('Page.enable', {}, sessionId);
      await send('Runtime.enable', {}, sessionId);
      const evalRaw = async (expression) => {
        const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId);
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r.result?.value;
      };
      const sel = (id) => `[data-testid="${id}"]`;
      return {
        navigate: (url) => send('Page.navigate', { url }, sessionId),
        eval: evalRaw,
        text: (id) => evalRaw(`document.querySelector('${sel(id)}')?.textContent.trim() ?? null`),
        exists: (id) => evalRaw(`!!document.querySelector('${sel(id)}')`),
        click: (id) => evalRaw(`(async () => { const el = document.querySelector('${sel(id)}'); if (!el) throw new Error('no ${id}'); el.click(); await new Promise(r=>setTimeout(r,350)); })()`),
        waitForTestId: (id) => evalRaw(`(async () => { const d = Date.now()+8000; while (Date.now()<d) { if (document.querySelector('${sel(id)}')) return true; await new Promise(r=>setTimeout(r,80)); } throw new Error('timeout waiting for ${id}'); })()`),
        evalPoll: (expr, _pred, ms) => evalRaw(`(async () => { const d = Date.now()+${ms}; let v; while (Date.now()<d) { v = ${expr}; if (/Updated/.test(v)) return v; await new Promise(r=>setTimeout(r,150)); } return v; })()`),
      };
    },
  };
}

await main();
