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
//   - the refresh button drives the refreshFeed action and the live
//     freshness marker updates (server write -> live delta -> view).
//
// Integration lane: needs bun + the surface's own node_modules (`bun install`
// in demos/all-aboard/surfaces/contract — Exact comes from the npm registry
// via alias deps, ENG-22480; no sibling checkout). Without the install the
// surface is a declared capability gap and this suite skips with
// SNAPBACK_CAPABILITY_EXACT_MISSING. The cold-clone lane (ENG-22480) sets
// SNAPBACK_REQUIRE_EXACT=1, under which missing Exact packages are a hard
// failure instead of a skip-as-pass.
//
// Run: node demos/all-aboard/tests/acceptance/browser.mjs
//   (reuses an already-running API :4420 + Vite :5178 only after verifying
//   their provenance, else starts fresh ones — ENG-22753).

import { spawn } from 'node:child_process';
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
const surfaceDir = join(repoRoot, 'demos', 'all-aboard', 'surfaces', 'contract');
const artifactsJsonPath = join(repoRoot, 'demos', 'all-aboard', 'snapback', 'generated', 'artifacts.json');
const chromeBin = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// Env-overridable so the suite can run pinned away from other checkouts' demo
// servers squatting the defaults. On the chosen ports, reuse is *verified*,
// never assumed (ENG-22753; the Diary 0008 2026-07-01 :4420 gotcha:
// reuse-if-healthy trusted whatever answered /health on the port, even a
// different engine serving a different working tree): a running server is
// reused only when its provenance matches this checkout, otherwise the suite
// falls back — loudly — to a fresh server on a fresh OS-assigned port.
const API_PORT = Number(process.env.ALL_ABOARD_API_PORT ?? 4420);
const VITE_PORT = Number(process.env.ALL_ABOARD_VITE_PORT ?? 5178);
const API_ADMIN_TOKEN = process.env.SNAPBACK_ADMIN_TOKEN || `sbat_browser_${Date.now().toString(36)}`;
process.env.SNAPBACK_ADMIN_TOKEN = API_ADMIN_TOKEN;
let apiUrl = `http://127.0.0.1:${API_PORT}`;
let viteUrl = `http://127.0.0.1:${VITE_PORT}`;

// ENG-22480: the surface consumes Exact from the npm registry (alias deps in
// surfaces/contract/package.json, pinned by its bun.lock), so the capability
// probe is the surface's own installed packages — not a sibling checkout.
const surfaceExactPackage = join(surfaceDir, 'node_modules', '@exact', 'contract', 'package.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const urlOk = async (url) => { try { return (await fetch(url, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } };

// A run that performs fewer checks than the suite declares is a harness
// failure, not a pass — a pre-check throw must never exit "PASS — 0/0". The
// guard lives in the shared harness (createSuite expectedChecks +
// runAcceptance, ENG-22486). The declared-gap skip in main() returns before
// runAcceptance, so it never reaches the guard.
const EXPECTED_CHECKS = 24;

// ENG-23727 warm-start bar: first useful board paint within this budget of
// the surface script starting to execute (module fetch latency is Vite's,
// not the app's; the property under test is that paint never waits on the
// backend). Overridable for slow CI hosts.
const PAINT_BUDGET_MS = Number(process.env.ALL_ABOARD_PAINT_BUDGET_MS ?? 100);

const suite = createSuite('all-aboard browser (Phase 1)', { expectedChecks: EXPECTED_CHECKS });
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
    const verdict = await verifyViteProvenance(viteUrl, { app: 'all-aboard', surface: 'contract', root: surfaceDir, apiOrigin: apiUrl });
    if (verdict.ok) {
      console.log(`REUSED Vite at :${port} (root ${verdict.info.root}, api ${verdict.info.apiOrigin})`);
      return;
    }
    port = await freePort();
    console.error(
      `PROVENANCE MISMATCH: a server answers on Vite :${VITE_PORT} but ${verdict.reason}. ` +
      `NOT reusing it — starting a fresh isolated Vite on :${port} (pin with ALL_ABOARD_VITE_PORT).`,
    );
    viteUrl = `http://127.0.0.1:${port}`;
  }
  const child = spawn('bun', ['--bun', 'node_modules/.bin/vite', '--config', 'vite.config.ts', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: surfaceDir, env: { ...process.env, SNAPBACK_ALL_ABOARD_API: apiUrl }, stdio: ['ignore', 'ignore', 'pipe'] });
  cleanups.push(() => child.kill('SIGTERM'));
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) { if (await urlOk(viteUrl)) return; if (child.exitCode !== null) throw new Error('Vite exited'); await sleep(500); }
  throw new Error('Vite did not become ready');
}

async function main() {
  if (!existsSync(surfaceExactPackage)) {
    // ENG-22480: the cold-clone lane exists to prove the surface is buildable
    // and verifiable from clean clones alone, so there "no Exact" is a
    // failure, never a declared-gap pass. The remedy is one command — Exact
    // is registry deps now, not an external checkout.
    if (process.env.SNAPBACK_REQUIRE_EXACT === '1') {
      console.error(`FAIL all-aboard browser — SNAPBACK_CAPABILITY_EXACT_MISSING (no @exact/contract at ${surfaceExactPackage}; run \`bun install\` in ${surfaceDir}) but SNAPBACK_REQUIRE_EXACT=1`);
      process.exit(1);
    }
    console.log(`SKIP all-aboard browser — SNAPBACK_CAPABILITY_EXACT_MISSING (no @exact/contract at ${surfaceExactPackage}; run \`bun install\` in ${surfaceDir})`);
    console.log('PASS all-aboard browser (Phase 1) — skipped (declared capability gap)');
    return;
  }
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

    await suite.check('startup: board paints before the backend attaches; no boot ceremony (ENG-23727)', async () => {
      const timing = await page.eval(`(async () => {
        const d = Date.now() + 5000;
        for (;;) {
          const t = window.allAboard?.startupTiming;
          if (t && t.firstBoardPaintMs !== null && t.backendConnectedMs !== null) return t;
          if (Date.now() > d) return t ?? null;
          await new Promise(r => setTimeout(r, 50));
        }
      })()`);
      if (typeof timing?.firstBoardPaintMs !== 'number') throw new Error(`firstBoardPaintMs not recorded: ${JSON.stringify(timing)}`);
      if (typeof timing?.backendConnectedMs !== 'number') throw new Error(`backendConnectedMs not recorded: ${JSON.stringify(timing)}`);
      if (timing.firstBoardPaintMs > timing.backendConnectedMs) {
        throw new Error(`board paint waited for the backend: ${JSON.stringify(timing)}`);
      }
      const codeToBoardMs = timing.firstBoardPaintMs - timing.scriptStartMs;
      if (!(codeToBoardMs < PAINT_BUDGET_MS)) {
        throw new Error(`first useful paint ${Math.round(codeToBoardMs)}ms after script start (budget ${PAINT_BUDGET_MS}ms): ${JSON.stringify(timing)}`);
      }
      const bootChromeVisible = await page.eval(
        `(() => { const el = document.getElementById('boot-status'); return el ? getComputedStyle(el).display !== 'none' : false; })()`,
      );
      if (bootChromeVisible) throw new Error('boot-status chrome is visible on the happy path');
      return { ...timing, codeToBoardMs: Math.round(codeToBoardMs) };
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

    await suite.check('direction switch lives in the sticky footer, with Switch-to copy', async () => {
      // ENG-23795: the direction pill is gone; the switch is the footer's
      // center control, "Switch to" de-emphasized over the destination.
      const inFooter = await page.eval(
        `!!document.querySelector('[data-testid="sticky-footer"] [data-testid="flip-direction"]')`,
      );
      if (!inFooter) throw new Error('flip-direction is not inside the sticky footer');
      const copy = await page.eval(`document.querySelector('[data-testid="flip-direction"]').textContent`);
      if (!/Switch to/.test(copy ?? '')) throw new Error(`Switch-to copy missing: ${copy}`);
      const footer = await page.eval(`(() => {
        const r = document.querySelector('[data-testid="sticky-footer"]').getBoundingClientRect();
        return { bottomGap: Math.abs(window.innerHeight - r.bottom), hasDot: !!document.querySelector('[data-testid="data-source-dot"]') };
      })()`);
      if (footer.bottomGap > 4) throw new Error(`footer is not pinned to the bottom: ${JSON.stringify(footer)}`);
      if (!footer.hasDot) throw new Error('status dot missing from the footer');
      const before = await page.text('active-direction');
      await page.click('flip-direction');
      const after = await page.text('active-direction');
      if (before === after) throw new Error(`direction did not flip (${before})`);
      return { before, after, copy };
    });

    await suite.check('tap the selected train opens its detail: back chevron, inline service badge, labeled progress', async () => {
      await page.click('hero-departure');
      const onTrip = await page.exists('trip-screen');
      const position = await page.text('position-label');
      const hasBar = await page.exists('position-bar');
      if (!onTrip) throw new Error('trip screen did not open');
      if (!hasBar) throw new Error('position indicator missing');
      // ENG-23795: plain ‹ back (no "Board"), the service badge beside the
      // train name (not the header corner), the progress bar labeled.
      const back = await page.text('trip-back');
      if (back !== '‹') throw new Error(`trip back is not a plain chevron: ${back}`);
      const service = await page.text('trip-service');
      if (!service) throw new Error('service badge missing beside the train name');
      const caption = await page.text('position-caption');
      if (caption !== 'TRIP PROGRESS') throw new Error(`progress bar not labeled: ${caption}`);
      await page.click('trip-back');
      return { position, back, service, caption };
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

    await suite.check('status dot is gray + DEMO DATA label while the feed is recorded, not live 511', async () => {
      // No 511 key in this suite, so the refresh commits recorded-fallback;
      // the LIVE text is a status dot now (ENG-23795) — green only when live
      // — and the non-live label stays beside it so demo data never poses as
      // live data (ENG-23642).
      const badge = await page.text('data-source');
      if (!/DEMO DATA/.test(badge ?? '')) throw new Error(`expected the demo-data label: ${badge}`);
      const dot = await page.eval(
        `getComputedStyle(document.querySelector('[data-testid="data-source-dot"]')).backgroundColor`,
      );
      if (!/156, 163, 175/.test(dot ?? '')) throw new Error(`expected the gray non-live dot: ${dot}`);
      const feed = (await new SnapbackClient(apiUrl).query('feedState', {})).rows[0];
      if (feed.lastSource === '511-siri-stop-monitoring') throw new Error('recorded suite unexpectedly marked live');
      return { badge, dot, lastSource: feed.lastSource };
    });

    // --- The paved path (LLP 0034 §6 ownership row 3; Exact 0284 §5.3 item 3):
    // server push through generated bindings, no hand-written pump, D4 boot.

    await suite.check('paved path: all live queries bind with push; connections report live', async () => {
      const facts = await page.eval(`(async () => {
        const d = Date.now() + 8000;
        for (;;) {
          const aa = window.allAboard;
          const conns = aa && aa.connections ? aa.connections() : null;
          if (aa && aa.livePush === true && conns
              && conns.liveTrainStatus === 'live' && conns.liveDepartures === 'live' && conns.feedState === 'live') {
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

    await suite.check('cron-authored delta reaches the browser through the bindings (no pump)', async () => {
      // Trigger the demo's own cron job server-side (the admin manual-run
      // route): refreshFeed -> applyFeedTick -> live fan-out. The browser
      // performs no interaction and owns no poll timer for these queries —
      // the freshness marker must show the stable sub-minute copy purely from the push.
      const client = new SnapbackClient(apiUrl);
      // The Refresh press a few checks back consumed the ENG-23642 one-poll-
      // per-180s upstream budget; a budget-denied cron run would honestly skip
      // (no commit, no delta). Clear it so this check exercises the push lane.
      await client.mutate('resetFeed', {});
      const feedBefore = (await client.query('feedState', {})).rows[0] ?? {};
      const tickBefore = feedBefore.tickIndex ?? -1;
      const tickCount = feedBefore.tickCount ?? 0;
      const run = await fetch(`${apiUrl}/_snapback/api/cron/warmPoll/run`, {
        method: 'POST',
        headers: { 'x-snapback-admin-token': API_ADMIN_TOKEN },
      });
      if (!run.ok) throw new Error(`cron manual run failed: HTTP ${run.status}`);
      const record = await run.json();
      const fresh = await page.pollText('freshness', 'Updated a few seconds ago', 6000);
      if (fresh !== 'Updated a few seconds ago') throw new Error(`cron delta did not reach the browser: freshness=${fresh}`);
      const tickAfter = (await client.query('feedState', {})).rows[0]?.tickIndex ?? -1;
      // Recorded feed ticks are cyclic: 5 -> 0 is a valid advance.
      if (tickCount > 1 && tickAfter === tickBefore) throw new Error(`cron run did not advance the feed (${tickBefore} -> ${tickAfter})`);
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
      const run = await fetch(`${apiUrl}/_snapback/api/cron/warmPoll/run`, {
        method: 'POST',
        headers: { 'x-snapback-admin-token': API_ADMIN_TOKEN },
      });
      if (!run.ok) throw new Error(`cron manual run failed: HTTP ${run.status}`);
      const fresh = await page.pollText('freshness', 'Updated a few seconds ago', 6000);
      if (fresh !== 'Updated a few seconds ago') throw new Error(`first window stopped receiving push after second boot: ${fresh}`);
      const conns = await page.eval('window.allAboard.connections()');
      if (conns.liveTrainStatus !== 'live') throw new Error(`first window degraded: ${JSON.stringify(conns)}`);
      return { second, firstStillLive: conns };
    });

    // Gesture layer (LLP 0027 interaction model via web surface glue; LLP 0029
    // G1 remains open — these drive the same press affordances by pointer).
    // ENG-23795: paging is contiguous — both surfaces declare 3-cell strips
    // whose neighbor cards are physically adjacent during the gesture.

    await suite.check('paging strips declare physically adjacent cards at ±100% (no blank neighbors)', async () => {
      const rects = await page.eval(`(() => {
        const r = (id) => { const el = document.querySelector('[data-testid="' + id + '"]'); return el ? el.getBoundingClientRect() : null; };
        const header = r('station-header'), headerNext = r('header-cell-next');
        const hero = r('hero-pager'), heroNext = r('hero-cell-next');
        return {
          headerNextGap: header && headerNext ? Math.abs(headerNext.x - (header.x + header.width)) : null,
          heroNextGap: hero && heroNext ? Math.abs(heroNext.x - (hero.x + hero.width)) : null,
        };
      })()`);
      if (rects.headerNextGap === null || rects.headerNextGap > 4) {
        throw new Error(`adjacent station card not at +100%: ${JSON.stringify(rects)}`);
      }
      if (rects.heroNextGap === null || rects.heroNextGap > 4) {
        throw new Error(`adjacent train card not at +100%: ${JSON.stringify(rects)}`);
      }
      return rects;
    });

    await suite.check('gesture: swipe left on the header pages to the adjacent station', async () => {
      // ENG-23719 gesture zones: station navigation lives on the red header
      // (y within the 106px sticky band), not the scrolling board below it.
      const before = await page.text('station-name');
      await page.swipe('h', -170, { cy: 53 });
      const after = await page.text('station-name');
      if (!before || before === after) throw new Error(`station did not change (${before} -> ${after})`);
      return { before, after };
    });

    await suite.check('gesture: swipe left on the board pages to the next (later) train', async () => {
      // Later trains sit to the right (ENG-23719): swiping left pulls the
      // physically adjacent card in. Compare train numbers, not the whole
      // meta line — a live delay delta can move the predicted time mid-check.
      const num = (s) => (s ?? '').match(/#\d+/)?.[0] ?? null;
      const before = num(await page.text('hero-meta'));
      await page.swipe('h', -170, { cy: 480 });
      const after = num(await page.text('hero-meta'));
      if (!before || before === after) throw new Error(`hero train did not change (${before} -> ${after})`);
      return { before, after };
    });

    await suite.check('train selection: rows select on tap; sooner trains stay visible in compact form', async () => {
      // ENG-23795: the circular arrows are gone. The row after the hero
      // carries train-next, the compact row before it train-prev; pressing a
      // row pages the strip to that train, and paged-past trains remain as
      // compact rows instead of disappearing.
      const num = (s) => (s ?? '').match(/#\d+/)?.[0] ?? null;
      // Reset to the next train if an earlier check left the board paged.
      await page.eval(`(async () => { document.querySelector('[data-testid="train-first"]')?.click(); await new Promise(r=>setTimeout(r,350)); })()`);
      const first = num(await page.text('hero-meta'));
      await page.click('train-next');
      const paged = num(await page.text('hero-meta'));
      if (!paged || paged === first) throw new Error(`train-next row did not page (${first} -> ${paged})`);
      const compact = await page.exists('earlier-trains');
      if (!compact) throw new Error('sooner trains vanished after paging forward');
      const compactNum = num(await page.eval(`document.querySelector('[data-testid="train-prev"]')?.textContent ?? ''`));
      if (compactNum !== first) throw new Error(`compact earlier row is not the paged-past train: ${compactNum} != ${first}`);
      await page.click('train-prev');
      const back = num(await page.text('hero-meta'));
      if (back !== first) throw new Error(`train-prev row did not page back (${back} != ${first})`);
      const arrows = await page.eval(`!!document.querySelector('[data-testid="service-filter"]')`);
      if (arrows) throw new Error('service filter chips unexpectedly present');
      return { first, paged, back };
    });

    await suite.check('footer gear opens the settings sheet', async () => {
      await page.click('open-settings');
      const onSettings = await page.exists('settings-screen');
      if (!onSettings) throw new Error('settings screen did not open');
      const hasEta = await page.exists('eta-mode');
      if (!hasEta) throw new Error('settings screen missing the ETA mode control');
      await page.click('settings-back');
      const home = await page.exists('station-header');
      if (!home) throw new Error('Done did not return to the board');
      return { onSettings, hasEta };
    });

    // Directions and station access (ENG-23795). Opening a maps app is web
    // glue over the declared affordances (directions.ts) — window.open is
    // stubbed so the URL is observable instead of spawning tabs.

    await suite.check('directions: tap on the distance line opens the preferred maps app', async () => {
      await page.eval(`window.__aaOpened = []; window.open = (u) => { window.__aaOpened.push(u); return null; };`);
      const opened = await page.eval(`(async () => {
        const el = document.querySelector('[data-testid^="station-directions-"]');
        if (!el) throw new Error('no directions affordance');
        el.click();
        await new Promise((r) => setTimeout(r, 300));
        return window.__aaOpened;
      })()`);
      if (!Array.isArray(opened) || opened.length !== 1) throw new Error(`expected one maps open: ${JSON.stringify(opened)}`);
      if (!/maps\.apple\.com|google\.com\/maps/.test(opened[0])) throw new Error(`not a maps URL: ${opened[0]}`);
      if (!/dirflg=|travelmode=/.test(opened[0])) throw new Error(`not a directions URL: ${opened[0]}`);
      const sheetOpen = await page.exists('directions-sheet');
      if (sheetOpen) throw new Error('tap must open maps directly, not the sheet');
      return { opened };
    });

    await suite.check('directions: long-press opens the bottom sheet (maps apps + copy address)', async () => {
      await page.eval(`(async () => {
        const el = document.querySelector('[data-testid^="station-directions-"]');
        const r = el.getBoundingClientRect();
        const opts = { bubbles: true, cancelable: true, pointerId: 9, isPrimary: true, button: 0, buttons: 1, clientX: r.x + 5, clientY: r.y + 5, pointerType: 'touch' };
        el.dispatchEvent(new PointerEvent('pointerdown', opts));
        await new Promise((r2) => setTimeout(r2, 650));
        el.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0 }));
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        await new Promise((r2) => setTimeout(r2, 350));
      })()`);
      const sheet = await page.exists('directions-sheet');
      if (!sheet) throw new Error('long-press did not open the directions sheet');
      const address = await page.text('station-address');
      if (!/Caltrain Station, .*CA/.test(address ?? '')) throw new Error(`address missing: ${address}`);
      const hasCopy = await page.exists('directions-copy');
      if (!hasCopy) throw new Error('copy-address action missing');
      await page.eval(`window.__aaOpened = [];`);
      await page.click('directions-google');
      const opened = await page.eval('window.__aaOpened');
      if (!Array.isArray(opened) || !/google\.com\/maps/.test(opened[0] ?? '')) {
        throw new Error(`google row did not open google maps: ${JSON.stringify(opened)}`);
      }
      const closed = !(await page.exists('directions-sheet'));
      if (!closed) throw new Error('sheet did not close after the action');
      return { address, opened };
    });

    await suite.check('stations list carries the end-of-line hint ("… <terminal> <time>")', async () => {
      await page.click('change-station');
      const hint = await page.eval(`document.querySelector('[data-testid^="terminal-hint-"]')?.textContent.trim() ?? null`);
      if (!hint || !/… .+ \d{1,2}:\d\d[ap]/.test(hint)) throw new Error(`terminal hint missing or malformed: ${hint}`);
      await page.click('stations-back');
      return { hint };
    });

    await suite.check('settings: default maps app cycles and persists', async () => {
      await page.click('open-settings');
      const first = await page.text('maps-app');
      await page.click('maps-app');
      const second = await page.text('maps-app');
      if (first === second) throw new Error(`maps app did not cycle: ${first}`);
      const stored = await page.eval(`window.localStorage.getItem('all-aboard.mapsApp')`);
      if (!stored) throw new Error('maps-app preference not persisted');
      // Cycle back to the platform default so later checks see the default.
      await page.click('maps-app');
      await page.click('maps-app');
      const restored = await page.text('maps-app');
      if (restored !== first) throw new Error(`maps app did not cycle back: ${restored}`);
      await page.click('settings-back');
      return { first, second, stored };
    });

    // E4 (ENG-22450): the app-wide ETA mode toggle — in Settings since the
    // ENG-23719 redesign; the header summary and the stations sheet follow it.

    await suite.check('ETA mode (in Settings) toggles walk/bike estimates app-wide', async () => {
      const walk = await page.text('walk-bike');
      if (!/min walk/.test(walk ?? '')) throw new Error(`expected walk mode summary: ${walk}`);
      await page.click('open-settings');
      await page.click('eta-mode');
      await page.click('settings-back');
      const bike = await page.text('walk-bike');
      if (!/min bike/.test(bike ?? '') || /walk/.test(bike ?? '')) throw new Error(`expected bike mode summary: ${bike}`);
      // App-wide: the stations sheet rows carry the mode's minutes.
      await page.click('change-station');
      const pickerRow = await page.eval(`document.querySelector('[data-testid="stations-screen"] button[data-testid^="station-"]')?.textContent.trim() ?? null`);
      if (!/min ·/.test(pickerRow ?? '')) throw new Error(`picker rows missing mode ETA: ${pickerRow}`);
      await page.click('stations-back');
      await page.click('open-settings');
      await page.click('eta-mode');
      await page.click('settings-back');
      const back = await page.text('walk-bike');
      if (!/min walk/.test(back ?? '')) throw new Error(`walk mode did not restore: ${back}`);
      return { walk, bike, pickerRow };
    });

    // ENG-23727: with the API origin unreachable, the open must still show
    // the best available board (deterministic schedule) under an honest
    // status note — never a blocking startup screen. This is the structural
    // guard against the boot-ceremony regression: if paint gated on
    // health/ensure/subscribe again, this page would render nothing but
    // loading chrome.
    await suite.check('backend unreachable: the open still shows a schedule board, honestly labeled', async () => {
      const page3 = await cdp.newPage();
      try {
        await page3.blockUrls(`${apiUrl}/*`);
        await page3.navigate(`${viteUrl}/`);
        await page3.waitForTestId('station-name');
        const stationName = await page3.text('station-name');
        const heroMinutes = await page3.text('hero-minutes');
        const badge = await page3.text('data-source');
        const note = await page3.pollText('delays-loading', 'Connecting for live updates|Offline — showing scheduled departures', 8000);
        if (!stationName) throw new Error('no station rendered with the backend unreachable');
        if (!/^\d+$/.test(heroMinutes ?? '')) throw new Error(`no schedule departure rendered: ${heroMinutes}`);
        if (!/SCHEDULE/.test(badge ?? '')) throw new Error(`schedule data not honestly labeled: ${badge}`);
        if (!/Connecting for live updates|Offline/.test(note ?? '')) throw new Error(`honest status note missing: ${note}`);
        const timing = await page3.eval('window.allAboard?.startupTiming ?? null');
        if (timing?.backendConnectedMs !== null) throw new Error(`backend unexpectedly attached: ${JSON.stringify(timing)}`);
        const bootChromeVisible = await page3.eval(
          `(() => { const el = document.getElementById('boot-status'); return el ? getComputedStyle(el).display !== 'none' : false; })()`,
        );
        if (bootChromeVisible) throw new Error('blocking boot chrome shown instead of the board');
        return { stationName, heroMinutes, badge, note };
      } finally {
        await page3.close().catch(() => {});
      }
    });
  }, { cleanups });
}

// --- Minimal CDP harness (adapted from demos/cursors-web/tests/acceptance) ---

async function launchChrome() {
  const userDataDir = mkdtempSync(join(tmpdir(), 'aa-browser-'));
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
  // A dropped DevTools WebSocket used to hang the suite forever: a command sent
  // on a dead socket gets no response, and there was no timeout, close/error
  // handler, or error propagation here, so every pending send() stayed
  // unresolved and the run wedged instead of failing (ENG-22804). Fail loudly
  // instead — settle() clears a command's per-response timeout, and rejectAll()
  // drains every in-flight command when the socket drops.
  const COMMAND_TIMEOUT_MS = 30_000;
  const settle = (id) => { const p = pending.get(id); if (p) clearTimeout(p.timer); pending.delete(id); return p; };
  const rejectAll = (reason) => { for (const id of [...pending.keys()]) settle(id)?.reject(new Error(reason)); };
  socket.addEventListener('message', async (e) => {
    const text = typeof e.data === 'string' ? e.data : await e.data.text();
    const msg = JSON.parse(text);
    if (msg.id && pending.has(msg.id)) { const p = settle(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result || {}); }
    // Fetch interception (ENG-23727 backend-unreachable check): a session that
    // enabled Fetch with a URL pattern gets every matching request refused —
    // the paused event only arrives for sessions that opted in.
    if (msg.method === 'Fetch.requestPaused' && msg.sessionId) {
      void send('Fetch.failRequest', { requestId: msg.params.requestId, errorReason: 'ConnectionRefused' }, msg.sessionId)
        .catch(() => { /* the target may already be gone */ });
    }
  });
  socket.addEventListener('close', () => rejectAll('CDP DevTools WebSocket closed while commands were in flight (socket dropped mid-run)'));
  socket.addEventListener('error', () => rejectAll('CDP DevTools WebSocket errored while commands were in flight (socket dropped mid-run)'));
  await new Promise((res, rej) => { socket.addEventListener('open', res, { once: true }); socket.addEventListener('error', () => rej(new Error('CDP failed')), { once: true }); });
  const send = (method, params = {}, sessionId = null) => {
    const id = nextId++;
    socket.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    return new Promise((res, rej) => {
      const timer = setTimeout(() => { settle(id); rej(new Error(`CDP command timed out after ${COMMAND_TIMEOUT_MS}ms with no response: ${method} (id ${id}) — DevTools socket may be wedged`)); }, COMMAND_TIMEOUT_MS);
      pending.set(id, { resolve: res, reject: rej, timer });
    });
  };
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
        close: () => send('Target.closeTarget', { targetId }),
        // Refuse every request matching the pattern (ENG-23727): navigation
        // and module loads on other origins proceed normally, so the surface
        // loads while its API origin is unreachable.
        blockUrls: (urlPattern) => send('Fetch.enable', { patterns: [{ urlPattern }] }, sessionId),
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
        // Synthetic pointer gestures against the glue layer (gestures.ts).
        // Gesture meaning is region-scoped (ENG-23719), so callers pass the
        // start point: cy≈53 hits the sticky header, cy≈480 the board.
        swipe: (axis, delta, at = {}) => evalRaw(`(async () => {
          const root = document.getElementById('exact-root');
          const cx = ${at.cx ?? 195}, cy = ${at.cy ?? 480}, steps = 8;
          // Dispatch from the element under the start point (bubbles to the
          // root listener): the glue scopes gesture meaning by the pointerdown
          // target's region (header vs board), so target=root would misfile it.
          const origin = document.elementFromPoint(cx, cy) ?? root;
          const opts = (x, y, extra) => ({ bubbles: true, cancelable: true, pointerId: 7, isPrimary: true, button: 0, buttons: 1, clientX: x, clientY: y, pointerType: 'touch', ...extra });
          const pointAt = (i) => { const d = ${delta} * (i / steps); return '${axis}' === 'h' ? [cx + d, cy] : [cx, cy + d]; };
          origin.dispatchEvent(new PointerEvent('pointerdown', opts(cx, cy)));
          for (let i = 1; i <= steps; i++) { const [x, y] = pointAt(i); origin.dispatchEvent(new PointerEvent('pointermove', opts(x, y))); await new Promise(r => setTimeout(r, 16)); }
          const [x, y] = pointAt(steps);
          origin.dispatchEvent(new PointerEvent('pointerup', opts(x, y, { buttons: 0 })));
          await new Promise(r => setTimeout(r, 650));
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
