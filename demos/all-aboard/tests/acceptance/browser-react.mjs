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
// so the suite can run pinned away from other checkouts' demo servers squatting
// the defaults. On the chosen ports, reuse is *verified*, never assumed
// (ENG-22753; the Diary 0008 2026-07-01 :4420 gotcha): a running server is
// reused only when its provenance matches this checkout, otherwise the suite
// falls back — loudly — to a fresh server on a fresh OS-assigned port.
//
// Run: node demos/all-aboard/tests/acceptance/browser-react.mjs
//   (reuses an already-running API + Vite on the chosen ports only after
//   verifying their provenance, else starts fresh ones).

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SnapbackClient } from '../../../_kit/client.mjs';
import { createSuite, runAcceptance } from '../../../_kit/harness.mjs';
import {
  freePort,
  readCommittedBundleHash,
  verifyApiProvenance,
  verifyViteProvenance,
} from '../../../_kit/provenance.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const surfaceDir = join(repoRoot, 'demos', 'all-aboard', 'surfaces', 'react');
const artifactsJsonPath = join(repoRoot, 'demos', 'all-aboard', 'snapback', 'generated', 'artifacts.json');
const chromeBin = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const API_PORT = Number(process.env.ALL_ABOARD_API_PORT ?? 4420);
const VITE_PORT = Number(process.env.ALL_ABOARD_REACT_VITE_PORT ?? 5179);
let apiUrl = `http://127.0.0.1:${API_PORT}`;
let viteUrl = `http://127.0.0.1:${VITE_PORT}`;

// A run that performs fewer checks than the suite declares is a harness
// failure, not a pass — a pre-check throw must never exit "PASS — 0/0". The
// guard lives in the shared harness (createSuite expectedChecks +
// runAcceptance, ENG-22486).
const EXPECTED_CHECKS = 16;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const urlOk = async (url) => { try { return (await fetch(url, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } };

const suite = createSuite('all-aboard browser-react (red-team control arm)', { expectedChecks: EXPECTED_CHECKS });
const cleanups = [];
let cdp = null;
let page = null;

async function ensureApi() {
  let port = API_PORT;
  if (await urlOk(`${apiUrl}/health`)) {
    // Something healthy answers on the port — reuse it ONLY if it is verifiably
    // running this checkout's committed app (ENG-22753). "Healthy" alone was
    // the Diary 0008 bug: a weeks-old server from another checkout squatting
    // :4420 contaminated runs with code that wasn't in the reused surface.
    const committed = readCommittedBundleHash(artifactsJsonPath);
    const verdict = await verifyApiProvenance(apiUrl, { appId: 'all-aboard', bundleHash: committed });
    if (verdict.ok) {
      console.log(`REUSED API server at :${port} (bundleHash ${verdict.bundleHash})`);
      return;
    }
    port = await freePort();
    console.error(
      `PROVENANCE MISMATCH: a server answers /health on :${API_PORT} but ${verdict.reason}. ` +
      `NOT reusing it — starting a fresh isolated API server on :${port} (pin with ALL_ABOARD_API_PORT).`,
    );
    apiUrl = `http://127.0.0.1:${port}`;
  }
  const env = { ...process.env };
  if (process.platform === 'darwin' && !env.DYLD_FRAMEWORK_PATH) {
    env.DYLD_FRAMEWORK_PATH = join(repoRoot, 'vendor', 'ibex', 'ios', 'Frameworks');
  }
  const child = spawn('cargo', ['run', '--quiet', '--', '--port', String(port), '--memory'], { cwd: repoRoot, env, stdio: ['ignore', 'ignore', 'pipe'] });
  cleanups.push(() => child.kill('SIGTERM'));
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) { if (await urlOk(`${apiUrl}/health`)) return; if (child.exitCode !== null) throw new Error('API server exited'); await sleep(500); }
  throw new Error('API server did not become healthy');
}

async function ensureVite() {
  let port = VITE_PORT;
  if (await urlOk(viteUrl)) {
    // Same rule as the API server (ENG-22753): a Vite answering on the port is
    // reused only when its source-provenance probe proves it serves THIS
    // checkout's surface tree against THIS run's API origin.
    const verdict = await verifyViteProvenance(viteUrl, { app: 'all-aboard', surface: 'react', root: surfaceDir, apiOrigin: apiUrl });
    if (verdict.ok) {
      console.log(`REUSED Vite at :${port} (root ${verdict.info.root}, api ${verdict.info.apiOrigin})`);
      return;
    }
    port = await freePort();
    console.error(
      `PROVENANCE MISMATCH: a server answers on Vite :${VITE_PORT} but ${verdict.reason}. ` +
      `NOT reusing it — starting a fresh isolated Vite on :${port} (pin with ALL_ABOARD_REACT_VITE_PORT).`,
    );
    viteUrl = `http://127.0.0.1:${port}`;
  }
  if (!existsSync(join(surfaceDir, 'node_modules', '.bin', 'vite'))) {
    const install = spawnSync('bun', ['install'], { cwd: surfaceDir, stdio: ['ignore', 'inherit', 'inherit'] });
    if (install.status !== 0) throw new Error('bun install failed for the React surface');
  }
  const child = spawn('bun', ['--bun', 'node_modules/.bin/vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: surfaceDir, env: { ...process.env, SNAPBACK_ALL_ABOARD_API: apiUrl }, stdio: ['ignore', 'ignore', 'pipe'] });
  cleanups.push(() => child.kill('SIGTERM'));
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) { if (await urlOk(viteUrl)) return; if (child.exitCode !== null) throw new Error('Vite exited'); await sleep(500); }
  throw new Error('Vite did not become ready');
}

async function main() {
  await runAcceptance(suite, async () => {
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

    // ENG-22795: granting geolocation must move the board onto the real
    // location — via the permission change listener and the location-hint
    // press (the gesture-driven retry) — instead of dead-ending on a silent
    // auto-denied prompt. Position pinned to San Francisco 4th & King, far
    // from the Mountain View default, so nearest-station selection is
    // unambiguous. Runs before any station navigation sets stationId.
    await suite.check('granting location adopts the real position; hint press retries the prompt', async () => {
      await page.setGeolocation(37.77639, -122.39472);
      await page.click('location-hint');
      const hint = await page.pollText('location-hint', 'Using your location', 8000);
      if (!/Using your location/.test(hint ?? '')) throw new Error(`hint did not adopt device location: ${hint}`);
      const granted = await page.pollText('station-name', '^San Francisco$', 8000);
      if (granted !== 'San Francisco') throw new Error(`nearest station not selected: ${granted}`);
      // The press asks for a fresh fix (maximumAge 0), not the cached one:
      // move the pinned position and tap again — the board must follow. This
      // also restores the Mountain View start downstream checks assume.
      await page.setGeolocation(37.3894, -122.0819);
      await page.click('location-hint');
      const restored = await page.pollText('station-name', '^Mountain View$', 8000);
      if (restored !== 'Mountain View') throw new Error(`hint press did not re-read the position: ${restored}`);
      return { hint, granted, restored };
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

    await suite.check('Refresh press drives refreshFeed action; freshness goes live', async () => {
      const before = await page.text('freshness');
      await page.click('refresh');
      const after = await page.evalPoll(`document.querySelector('[data-testid="freshness"]').textContent`, (t) => /Updated/.test(t), 5000);
      if (!/Updated/.test(after)) throw new Error(`freshness did not update: ${before} -> ${after}`);
      // Cross-check the durable write landed on the server.
      const feed = (await new SnapbackClient(apiUrl).query('feedState', {})).rows[0];
      if (!(feed.fetchedAt > 0)) throw new Error('feedRefreshState.fetchedAt not stamped');
      return { before, after, tickIndex: feed.tickIndex };
    });

    await suite.check('feed-problem line says why the board is not on live 511 data', async () => {
      // No caltrainFeed key is configured in this suite, so the refresh above
      // fell back to the recorded feed; the board must say why — with the
      // actionable setup hint — instead of leaving the reason buried in
      // feedRefreshState.lastError (ENG-22751).
      const problem = await page.evalPoll(
        `(document.querySelector('[data-testid="feed-problem"]') || {}).textContent || ''`,
        (t) => /live 511 fetch unavailable/.test(t),
        5000,
      );
      if (!/add caltrainFeed at \/_snapback\/admin\/setup/.test(problem)) throw new Error(`expected the actionable setup hint: ${problem}`);
      const feed = (await new SnapbackClient(apiUrl).query('feedState', {})).rows[0];
      if (feed.lastSource !== 'recorded-fallback') throw new Error(`expected recorded-fallback, got ${feed.lastSource}`);
      return { problem, lastSource: feed.lastSource };
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
      // route): refreshFeed -> snapshot/fallback mutation -> live fan-out. The browser
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
  }, { cleanups });
}

// --- Minimal CDP harness (same as browser.mjs, adapted from demos/cursors-web) ---

async function launchChrome() {
  const userDataDir = mkdtempSync(join(tmpdir(), 'aa-browser-react-'));
  const child = spawn(chromeBin, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${userDataDir}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  // Without this handler a bad CHROME_BIN crashes the whole process as an
  // unhandled 'error' event, skipping teardown (ENG-22486).
  let spawnError = null;
  child.on('error', (error) => { spawnError = error; });
  const portFile = join(userDataDir, 'DevToolsActivePort');
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (spawnError) throw new Error(`Chrome failed to launch (${chromeBin}): ${spawnError.message}`);
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
        // ENG-22795: pin the emulated position BEFORE granting, so the
        // surface's permission-change listener never reads the host's real
        // location in the gap between the two calls.
        setGeolocation: async (latitude, longitude) => {
          await send('Emulation.setGeolocationOverride', { latitude, longitude, accuracy: 5 }, sessionId);
          await send('Browser.grantPermissions', { permissions: ['geolocation'] });
        },
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
