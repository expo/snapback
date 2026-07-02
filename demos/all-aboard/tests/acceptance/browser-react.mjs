// All Aboard — React control-arm browser acceptance (ENG-22435 red-team;
// re-baselined to the redesigned product by ENG-22450).
//
// Mirrors browser.mjs (the Contract/Exact Phase 1 suite) check-for-check against
// the React surface in demos/all-aboard/surfaces/react: same twelve assertions,
// same testId handles, same backend lifecycle — boot, board, presses, trip
// detail, mutation + freshness, live push, cron delta with no pump, second
// window D4, and the three gesture checks. Differences from the Contract suite
// are exactly the differences between the arms:
//   - the surface is stock React + Vite resolved from the surface's own
//     node_modules (no sibling Exact checkout), so the "capability gap" skip is
//     replaced by a one-time `bun install`;
//   - the Refresh press drives applyFeedTick through a direct client.mutate
//     call rather than a generated Contract mutation binding;
//   - live push is two hand-wired kit liveQuery handles (transport 'stream')
//     rather than createSnapbackContractSurface's generated bindings;
//   - gestures dispatch against `#root` (React) rather than `#exact-root`.
//
// Ports are env-overridable (ALL_ABOARD_API_PORT / ALL_ABOARD_REACT_VITE_PORT)
// so the suite can run isolated from other checkouts' demo servers squatting
// the defaults (the Diary 0008 2026-07-01 :4420 gotcha).
//
// Run: node demos/all-aboard/tests/acceptance/browser-react.mjs
//   (reuses an already-running API + Vite on the chosen ports, else starts them).

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SnapbackClient } from '../../../_kit/client.mjs';
import { createSuite } from '../../../_kit/harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const surfaceDir = join(repoRoot, 'demos', 'all-aboard', 'surfaces', 'react');
const chromeBin = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const API_PORT = Number(process.env.ALL_ABOARD_API_PORT ?? 4420);
const VITE_PORT = Number(process.env.ALL_ABOARD_REACT_VITE_PORT ?? 5179);
const apiUrl = `http://127.0.0.1:${API_PORT}`;
const viteUrl = `http://127.0.0.1:${VITE_PORT}`;

// A run that performs fewer checks than the suite declares is a harness
// failure, not a pass — a pre-check throw must never exit "PASS — 0/0"
// (ENG-22486).
const EXPECTED_CHECKS = 14;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const urlOk = async (url) => { try { return (await fetch(url, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } };

const suite = createSuite('all-aboard browser-react (red-team control arm)');
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
  if (!existsSync(join(surfaceDir, 'node_modules', '.bin', 'vite'))) {
    const install = spawnSync('bun', ['install'], { cwd: surfaceDir, stdio: ['ignore', 'inherit', 'inherit'] });
    if (install.status !== 0) throw new Error('bun install failed for the React surface');
  }
  const child = spawn('bun', ['--bun', 'node_modules/.bin/vite', '--host', '127.0.0.1', '--port', String(VITE_PORT), '--strictPort'],
    { cwd: surfaceDir, env: { ...process.env, SNAPBACK_ALL_ABOARD_API: apiUrl }, stdio: ['ignore', 'ignore', 'pipe'] });
  cleanups.push(() => child.kill('SIGTERM'));
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) { if (await urlOk(viteUrl)) return; if (child.exitCode !== null) throw new Error('Vite exited'); await sleep(500); }
  throw new Error('Vite did not become ready');
}

async function main() {
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

    await suite.check('Refresh press drives the applyFeedTick mutation; freshness goes live', async () => {
      const before = await page.text('freshness');
      await page.click('refresh');
      const after = await page.evalPoll(`document.querySelector('[data-testid="freshness"]').textContent`, (t) => /Updated/.test(t), 5000);
      if (!/Updated/.test(after)) throw new Error(`freshness did not update: ${before} -> ${after}`);
      // Cross-check the durable write landed on the server.
      const feed = (await new SnapbackClient(apiUrl).query('feedState', {})).rows[0];
      if (!(feed.fetchedAt > 0)) throw new Error('feedRefreshState.fetchedAt not stamped');
      return { before, after, tickIndex: feed.tickIndex };
    });

    // --- The paved path, React arm (LLP 0034 D1): server push through two
    // hand-wired kit liveQuery stream handles, no poll pump, D4 boot.

    await suite.check('paved path: both live queries bind with push; connections report live', async () => {
      const facts = await page.eval(`(async () => {
        const d = Date.now() + 8000;
        for (;;) {
          const aa = window.allAboard;
          const conns = aa && aa.connections ? aa.connections() : null;
          if (aa && aa.livePush === true && conns
              && conns.liveTrainStatus === 'live' && conns.feedState === 'live') {
            return { livePush: aa.livePush, connections: conns, provisioned: aa.provisioned };
          }
          if (Date.now() > d) throw new Error('live connections never settled: ' + JSON.stringify({ livePush: aa?.livePush, conns }));
          await new Promise(r => setTimeout(r, 100));
        }
      })()`);
      // First window on a fresh backend performs the full provisioning.
      if (!Array.isArray(facts.provisioned)) throw new Error('provisioning facts missing');
      return facts;
    });

    await suite.check('cron-authored delta reaches the browser through the handles (no pump)', async () => {
      // Trigger the demo's own cron job server-side (the admin manual-run
      // route): refreshFeed -> applyFeedTick -> live fan-out. The browser
      // performs no interaction and owns no poll timer for these queries —
      // the freshness marker must go "just now" purely from the push.
      const client = new SnapbackClient(apiUrl);
      const tickBefore = (await client.query('feedState', {})).rows[0]?.tickIndex ?? -1;
      const run = await fetch(`${apiUrl}/_snapback/api/cron/warmPoll/run`, { method: 'POST' });
      if (!run.ok) throw new Error(`cron manual run failed: HTTP ${run.status}`);
      const record = await run.json();
      const fresh = await page.pollText('freshness', 'Updated just now', 6000);
      if (fresh !== 'Updated just now') throw new Error(`cron delta did not reach the browser: freshness=${fresh}`);
      const tickAfter = (await client.query('feedState', {})).rows[0]?.tickIndex ?? -1;
      if (!(tickAfter > tickBefore)) throw new Error(`cron run did not advance the feed (${tickBefore} -> ${tickAfter})`);
      const conns = await page.eval('window.allAboard.connections()');
      if (conns.liveTrainStatus !== 'live') throw new Error(`connection degraded during push: ${JSON.stringify(conns)}`);
      return { cronOutcome: record.outcome, tickBefore, tickAfter, connections: conns };
    });

    await suite.check('second window boot does not clear the first (D4 inspect-first)', async () => {
      const page2 = await cdp.newPage();
      await page2.navigate(`${viteUrl}/`);
      const second = await page2.eval(`(async () => {
        const d = Date.now() + 20000;
        while (!window.allAboard) { if (Date.now() > d) throw new Error('second window never booted'); await new Promise(r=>setTimeout(r,50)); }
        await window.allAboard.ready;
        const s = Date.now() + 8000;
        for (;;) {
          const conns = window.allAboard.connections ? window.allAboard.connections() : null;
          if (conns && conns.liveTrainStatus === 'live') return { provisioned: window.allAboard.provisioned, connections: conns };
          if (Date.now() > s) throw new Error('second window connections never settled: ' + JSON.stringify(conns));
          await new Promise(r => setTimeout(r, 100));
        }
      })()`);
      // Inspect-first: the backend is already provisioned and seeded, so the
      // second window's boot performs NO provisioning writes (the LLP 0275 C4
      // footgun — a second window calling loadSchema/reset — is gone).
      if (second.provisioned.length !== 0) {
        throw new Error(`second window re-provisioned: ${JSON.stringify(second.provisioned)}`);
      }
      // The first window's session survived: still rendered, still live, and
      // still receiving server-authored deltas after the second boot.
      const stationName = await page.text('station-name');
      if (!stationName) throw new Error('first window lost its board after the second boot');
      const run = await fetch(`${apiUrl}/_snapback/api/cron/warmPoll/run`, { method: 'POST' });
      if (!run.ok) throw new Error(`cron manual run failed: HTTP ${run.status}`);
      const fresh = await page.pollText('freshness', 'Updated just now', 6000);
      if (fresh !== 'Updated just now') throw new Error(`first window stopped receiving push after second boot: ${fresh}`);
      const conns = await page.eval('window.allAboard.connections()');
      if (conns.liveTrainStatus !== 'live') throw new Error(`first window degraded: ${JSON.stringify(conns)}`);
      return { second, firstStillLive: conns };
    });

    // Gesture layer (the same recognizer glue as the Contract arm, installed
    // over #root — these drive the same press affordances by pointer).

    await suite.check('gesture: swipe left moves to the adjacent station', async () => {
      const before = await page.text('station-name');
      await page.swipe('h', -170);
      const after = await page.text('station-name');
      if (!before || before === after) throw new Error(`station did not change (${before} -> ${after})`);
      return { before, after };
    });

    await suite.check('gesture: swipe up selects the next upcoming train', async () => {
      const before = await page.text('hero-meta');
      await page.swipe('v', -90);
      const after = await page.text('hero-meta');
      if (!before || before === after) throw new Error(`hero train did not change (${before} -> ${after})`);
      return { before, after };
    });

    await suite.check('gesture: bare tap on neutral ground flips the direction', async () => {
      const before = await page.text('active-direction');
      await page.tapNeutral();
      const after = await page.text('active-direction');
      if (before === after) throw new Error(`direction did not flip (${before})`);
      return { before, after };
    });

    // E3 (ENG-22450): service-filter chips on the home board.

    await suite.check('service filter chips filter the board, hero included; All restores', async () => {
      const services = () => page.eval(`(() => {
        const rest = [...document.querySelectorAll('[data-testid^="departure-"]')].map((el) => {
          const t = el.textContent;
          return t.includes('Baby Bullet') ? 'Baby Bullet' : t.includes('Limited') ? 'Limited' : t.includes('Local') ? 'Local' : '?';
        });
        return { hero: document.querySelector('[data-testid="hero-service"]')?.textContent.trim() ?? null, rest };
      })()`);
      await page.click('service-filter-Limited');
      const limited = await services();
      if (limited.hero !== 'Limited') throw new Error(`hero not filtered to Limited: ${limited.hero}`);
      if (!limited.rest.every((s) => s === 'Limited')) throw new Error(`rest rows not all Limited: ${limited.rest}`);
      await page.click('service-filter-Bullet');
      const bullet = await services();
      if (bullet.hero !== 'Baby Bullet') throw new Error(`hero not filtered to Baby Bullet: ${bullet.hero}`);
      await page.click('service-filter-All');
      const all = await services();
      if (!all.hero) throw new Error('board empty after All');
      return { limited, bullet, allHero: all.hero };
    });

    // E4 (ENG-22450): the app-wide ETA mode toggle on the station card.

    await suite.check('ETA mode toggles walk/bike estimates app-wide', async () => {
      const walk = await page.text('walk-bike');
      if (!/min walk/.test(walk ?? '')) throw new Error(`expected walk mode summary: ${walk}`);
      await page.click('eta-mode');
      const bike = await page.text('walk-bike');
      if (!/min bike/.test(bike ?? '') || /walk/.test(bike ?? '')) throw new Error(`expected bike mode summary: ${bike}`);
      // App-wide: the stations sheet rows carry the mode's minutes.
      await page.click('change-station');
      const pickerRow = await page.eval(`document.querySelector('[data-testid="stations-screen"] button[data-testid^="station-"]')?.textContent.trim() ?? null`);
      if (!/min ·/.test(pickerRow ?? '')) throw new Error(`picker rows missing mode ETA: ${pickerRow}`);
      await page.click('stations-back');
      await page.click('eta-mode');
      const back = await page.text('walk-bike');
      if (!/min walk/.test(back ?? '')) throw new Error(`walk mode did not restore: ${back}`);
      return { walk, bike, pickerRow };
    });
  } catch (error) {
    // Surface the pre-check failure instead of letting the finally-exit
    // swallow it (ENG-22486).
    console.error(`SETUP FAILURE before checks completed: ${error?.stack ?? error}`);
  } finally {
    const report = suite.finish();
    for (const c of cleanups.reverse()) { try { await c(); } catch { /* best effort */ } }
    if (report.total !== EXPECTED_CHECKS) {
      console.error(`FAIL ${report.title} — ran ${report.total}/${EXPECTED_CHECKS} expected checks (vacuous pass guard, ENG-22486)`);
      process.exit(1);
    }
    process.exit(report.ok ? 0 : 1);
  }
}

// --- Minimal CDP harness (same as browser.mjs, adapted from demos/cursors-web) ---

async function launchChrome() {
  const userDataDir = mkdtempSync(join(tmpdir(), 'aa-browser-react-'));
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
        // Synthetic pointer gestures against the glue layer (src/gestures.ts).
        swipe: (axis, delta) => evalRaw(`(async () => {
          const root = document.getElementById('root');
          const cx = 195, cy = 480, steps = 8;
          const opts = (x, y, extra) => ({ bubbles: true, cancelable: true, pointerId: 7, isPrimary: true, button: 0, buttons: 1, clientX: x, clientY: y, pointerType: 'touch', ...extra });
          const at = (i) => { const d = ${delta} * (i / steps); return '${axis}' === 'h' ? [cx + d, cy] : [cx, cy + d]; };
          root.dispatchEvent(new PointerEvent('pointerdown', opts(cx, cy)));
          for (let i = 1; i <= steps; i++) { const [x, y] = at(i); root.dispatchEvent(new PointerEvent('pointermove', opts(x, y))); await new Promise(r => setTimeout(r, 16)); }
          const [x, y] = at(steps);
          root.dispatchEvent(new PointerEvent('pointerup', opts(x, y, { buttons: 0 })));
          await new Promise(r => setTimeout(r, 650));
        })()`),
        tapNeutral: () => evalRaw(`(async () => {
          const w = window.innerWidth, h = window.innerHeight;
          const candidates = [[w / 2, h * 0.38], [w / 2, h * 0.32], [w / 2, h * 0.45], [w * 0.3, h * 0.38]];
          let x = w / 2, y = h * 0.38, el = null;
          for (const [cx, cy] of candidates) {
            const probe = document.elementFromPoint(cx, cy);
            if (probe && !probe.closest('button, a, input, textarea, select')) { x = cx; y = cy; el = probe; break; }
          }
          el = el ?? document.getElementById('root');
          const opts = { bubbles: true, cancelable: true, pointerId: 9, isPrimary: true, button: 0, clientX: x, clientY: y, pointerType: 'touch' };
          el.dispatchEvent(new PointerEvent('pointerdown', opts));
          el.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0 }));
          await new Promise(r => setTimeout(r, 400));
        })()`),
        waitForTestId: (id) => evalRaw(`(async () => { const d = Date.now()+8000; while (Date.now()<d) { if (document.querySelector('${sel(id)}')) return true; await new Promise(r=>setTimeout(r,80)); } throw new Error('timeout waiting for ${id}'); })()`),
        evalPoll: (expr, _pred, ms) => evalRaw(`(async () => { const d = Date.now()+${ms}; let v; while (Date.now()<d) { v = ${expr}; if (/Updated/.test(v)) return v; await new Promise(r=>setTimeout(r,150)); } return v; })()`),
        // Poll a testId's text until it matches the pattern (or time out,
        // returning the last value for the caller's error message).
        pollText: (id, pattern, ms) => evalRaw(`(async () => { const d = Date.now()+${ms}; let v; while (Date.now()<d) { v = document.querySelector('${sel(id)}')?.textContent.trim() ?? null; if (v !== null && new RegExp(${JSON.stringify(pattern)}).test(v)) return v; await new Promise(r=>setTimeout(r,120)); } return v; })()`),
      };
    },
  };
}

await main();
