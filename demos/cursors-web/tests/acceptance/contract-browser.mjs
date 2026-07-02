// Cursor presence — Contract-surface browser acceptance (ENG-22479; the
// completing proof for Exact LLP 0284 §5 item 4).
//
// Two real browser windows on one Snapback room: client B's cursor appears in
// client A's `ephemeral` BINDING through generated bindings alone (and vice
// versa) — no imperative overlay, no poll pump. Plus the forced-map proof:
// forceEphemeralState shows a synthetic cursor LOCALLY only (the other window
// and the server never see it), and disposing the force restores live state.
//
// Integration lane: needs the Exact checkout + bun + Chrome; skips with the
// standard structured diagnostic without them.
//
// Run: node demos/cursors-web/tests/acceptance/contract-browser.mjs

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSuite } from '../../../_kit/harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const surfaceDir = join(repoRoot, 'demos', 'cursors-web', 'surfaces', 'contract');
const chromeBin = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const API_PORT = Number(process.env.CURSORS_CONTRACT_API_PORT ?? 4425);
const VITE_PORT = Number(process.env.CURSORS_CONTRACT_VITE_PORT ?? 5184);
const apiUrl = `http://127.0.0.1:${API_PORT}`;
const viteUrl = `http://127.0.0.1:${VITE_PORT}`;

const exactRoot = process.env.SNAPBACK_EXACT_ROOT
  ? resolve(process.env.SNAPBACK_EXACT_ROOT)
  : resolve(repoRoot, '..', 'exact');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const urlOk = async (url) => { try { return (await fetch(url, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } };

const suite = createSuite('cursors-web contract browser (ENG-22479)');
const cleanups = [];
let cdp = null;

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
    { cwd: exactRoot, env: { ...process.env, SNAPBACK_CURSORS_API: apiUrl }, stdio: ['ignore', 'pipe', 'pipe'] });
  let viteLog = '';
  child.stdout.on('data', (d) => { viteLog += d; });
  child.stderr.on('data', (d) => { viteLog += d; });
  cleanups.push(() => child.kill('SIGTERM'));
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) { if (await urlOk(viteUrl)) return; if (child.exitCode !== null) throw new Error(`Vite exited:\n${viteLog}`); await sleep(500); }
  throw new Error(`Vite did not become ready:\n${viteLog}`);
}

async function main() {
  if (!existsSync(join(exactRoot, 'packages', 'exact-contract'))) {
    console.log(`SKIP cursors-web contract browser — SNAPBACK_CAPABILITY_EXACT_MISSING (no Exact at ${exactRoot})`);
    console.log('PASS cursors-web contract browser (ENG-22479) — skipped (declared capability gap)');
    return;
  }
  try {
    await ensureApi();
    await ensureVite();
    const chrome = await launchChrome();
    cleanups.push(() => chrome.stop());
    cdp = await connectCdp(chrome.ws);
    cleanups.push(() => cdp.close());

    const pageA = await cdp.newPage();
    const pageB = await cdp.newPage();
    await pageA.navigate(`${viteUrl}/?name=alice&color=%235e6ad2`);
    await pageB.navigate(`${viteUrl}/?name=bob&color=%232fbf71`);

    const waitBoot = (page) => page.eval(`(async () => {
      const d = Date.now() + 20000;
      while (!window.cursorsWeb) { if (Date.now() > d) throw new Error('surface never booted'); await new Promise(r=>setTimeout(r,50)); }
      await window.cursorsWebReady;
      return { connection: window.cursorsWeb.connection, name: window.cursorsWeb.identity.name };
    })()`);

    let a = null;
    let b = null;
    await suite.check('both windows boot the Contract surface over generated bindings', async () => {
      a = await waitBoot(pageA);
      b = await waitBoot(pageB);
      if (!a.connection || !b.connection) throw new Error('missing connection ids');
      if (a.connection === b.connection) throw new Error('windows must have distinct connections');
      return { a, b };
    });

    const moveCursor = (page, x, y) => page.eval(`(async () => {
      document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: ${x}, clientY: ${y}, pointerType: 'mouse' }));
      await new Promise(r => setTimeout(r, 120));
      document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: ${x}, clientY: ${y}, pointerType: 'mouse' }));
    })()`);

    await suite.check("client B's cursor reaches client A's ephemeral BINDING (and vice versa)", async () => {
      await moveCursor(pageA, 210, 260);
      await moveCursor(pageB, 340, 180);
      // Each window renders each c in cursors.entries — keyed by connection.
      const badgeOnA = await pageA.pollText(`cursor-name-${b.connection}`, 'bob', 8000);
      if (badgeOnA !== 'bob') throw new Error(`B's cursor missing on A: ${badgeOnA}`);
      const badgeOnB = await pageB.pollText(`cursor-name-${a.connection}`, 'alice', 8000);
      if (badgeOnB !== 'alice') throw new Error(`A's cursor missing on B: ${badgeOnB}`);
      // Self-presence appears and is styled distinctly (weight 800 + white).
      const selfOnA = await pageA.eval(`(() => {
        const el = document.querySelector('[data-testid="cursor-name-${a.connection}"]');
        if (!el) return null;
        const style = getComputedStyle(el);
        return { text: el.textContent.trim(), weight: style.fontWeight };
      })()`);
      if (!selfOnA || selfOnA.text !== 'alice') throw new Error(`self cursor missing on A: ${JSON.stringify(selfOnA)}`);
      if (String(selfOnA.weight) !== '800') throw new Error(`self cursor not styled distinctly: ${JSON.stringify(selfOnA)}`);
      const count = await pageA.text('cursor-count');
      if (!/^2 /.test(count ?? '')) throw new Error(`expected 2 cursors on A, got: ${count}`);
      return { badgeOnA, badgeOnB, selfOnA, count };
    });

    await suite.check('forceEphemeralState is LOCAL-ONLY and dispose restores live state', async () => {
      const forced = await pageA.eval('window.cursorsWeb.forceGhost()');
      if (!forced) throw new Error('forceEphemeralState unavailable on the provider');
      const ghostOnA = await pageA.pollText('cursor-name-ghost', 'Ghost', 5000);
      if (!/Ghost/.test(ghostOnA ?? '')) throw new Error(`forced ghost not rendered locally: ${ghostOnA}`);
      const countForced = await pageA.text('cursor-count');
      if (!/^1 /.test(countForced ?? '')) throw new Error(`forced map must replace live entries locally, got: ${countForced}`);

      // LOCAL-ONLY: the other window never sees the ghost, and keeps its live map.
      await moveCursor(pageB, 360, 200);
      await sleep(600);
      const ghostOnB = await pageB.exists('cursor-ghost');
      if (ghostOnB) throw new Error('forced ghost leaked to the other window (must be local-only)');
      const bStillLive = await pageB.text(`cursor-name-${a.connection}`);
      if (bStillLive !== 'alice') throw new Error(`B lost live entries during A's force: ${bStillLive}`);

      // Dispose restores the live map on A (ghost gone, real cursors back).
      await pageA.eval('window.cursorsWeb.disposeGhost()');
      const restored = await pageA.pollText(`cursor-name-${b.connection}`, 'bob', 5000);
      if (restored !== 'bob') throw new Error(`live map not restored after dispose: ${restored}`);
      const ghostGone = await pageA.exists('cursor-ghost');
      if (ghostGone) throw new Error('ghost lingered after dispose');
      return { ghostOnA, restored };
    });

    await suite.check('presence stays live after the force cycle (fresh moves propagate)', async () => {
      await moveCursor(pageB, 420, 300);
      const badge = await pageA.eval(`(async () => {
        const d = Date.now() + 8000;
        for (;;) {
          const el = document.querySelector('[data-testid="cursor-${b.connection}"]');
          if (el && parseInt(el.style.left, 10) >= 400) return el.style.left;
          if (Date.now() > d) return el ? el.style.left : null;
          await new Promise(r=>setTimeout(r,100));
        }
      })()`);
      if (!badge || parseInt(badge, 10) < 400) throw new Error(`B's fresh move did not propagate: ${badge}`);
      return { left: badge };
    });
  } catch (error) {
    console.error('contract-browser harness crashed:', error);
    process.exitCode = 2;
  } finally {
    const report = suite.finish();
    for (const c of cleanups.reverse()) { try { await c(); } catch { /* best effort */ } }
    process.exit(process.exitCode === 2 ? 2 : report.ok && report.total > 0 ? 0 : 1);
  }
}

// --- Minimal CDP harness (shared shape with all-aboard/tests/acceptance) ---

async function launchChrome() {
  const userDataDir = mkdtempSync(join(tmpdir(), 'cursors-contract-'));
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
        pollText: (id, pattern, ms) => evalRaw(`(async () => { const d = Date.now()+${ms}; let v; while (Date.now()<d) { v = document.querySelector('${sel(id)}')?.textContent.trim() ?? null; if (v !== null && new RegExp(${JSON.stringify(pattern)}).test(v)) return v; await new Promise(r=>setTimeout(r,120)); } return v; })()`),
      };
    },
  };
}

await main();
