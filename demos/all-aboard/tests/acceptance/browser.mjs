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
//   (reuses an already-running API :4420 only with a caller-supplied admin
//   token and verified provenance; Vite :5178 also requires verified
//   provenance; otherwise starts fresh processes — ENG-22753).

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  launchChromeCdp,
  retryChromeResourceExhaustion,
} from '../../../_kit/chrome-process.mjs';
import { SnapbackClient } from '../../../_kit/client.mjs';
import { createSuite, runAcceptance } from '../../../_kit/harness.mjs';
import {
  freePort,
  verifyViteProvenance,
} from '../../../_kit/provenance.mjs';
import { startServer } from '../../../_kit/server-process.mjs';
import { assertFirstBoardPaintBudget } from './startup-timing.mjs';

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
// reused only when its provenance matches this checkout and the caller
// supplied its admin token; otherwise the suite starts a fresh server on an
// OS-assigned port.
const API_PORT = Number(process.env.ALL_ABOARD_API_PORT ?? 4420);
const VITE_PORT = Number(process.env.ALL_ABOARD_VITE_PORT ?? 5178);
// Bundle provenance cannot prove that a reused process accepts a newly minted
// admin capability. Default runs therefore force a fresh isolated child; API
// reuse is an explicit opt-in made by supplying the existing server's token.
const REUSED_API_ADMIN_TOKEN = process.env.SNAPBACK_ADMIN_TOKEN || null;
let apiAdminToken = REUSED_API_ADMIN_TOKEN;
let apiUrl = `http://127.0.0.1:${API_PORT}`;
let viteUrl = `http://127.0.0.1:${VITE_PORT}`;

// ENG-22480: the surface consumes Exact from the npm registry (alias deps in
// surfaces/contract/package.json, pinned by its bun.lock), so the capability
// probe is the surface's own installed packages — not a sibling checkout.
const surfaceExactPackage = join(surfaceDir, 'node_modules', '@exact', 'contract', 'package.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const urlOk = async (url) => { try { return (await fetch(url, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } };
const unprivilegedChildEnv = (extra = {}) => {
  const env = { ...process.env, ...extra };
  delete env.SNAPBACK_ADMIN_TOKEN;
  return env;
};

// A run that performs fewer checks than the suite declares is a harness
// failure, not a pass — a pre-check throw must never exit "PASS — 0/0". The
// guard lives in the shared harness (createSuite expectedChecks +
// runAcceptance, ENG-22486). The declared-gap skip in main() returns before
// runAcceptance, so it never reaches the guard.
const EXPECTED_CHECKS = 34;

// ENG-24386 follow-up: the budget begins when the HTML response completes, so
// static dependency fetch/evaluation cannot hide before the entry body records
// scriptStartMs. Two cold isolated runs measured 888ms and 1450ms end to end
// (the latter included 1356ms before the entry body); the 2200ms dev-server bar
// retains ~50% host-load headroom over the observed maximum while still
// bounding that previously invisible work. Production remains materially faster.
// Overridable for deliberately slower CI hosts.
const PAINT_BUDGET_MS = Number(process.env.ALL_ABOARD_PAINT_BUDGET_MS ?? 2200);

const suite = createSuite('all-aboard browser (Phase 1)', { expectedChecks: EXPECTED_CHECKS });
const cleanups = [];
let cdp = null;
let page = null;

async function ensureApi() {
  // @ref LLP 0010#required-tool-surfaces — use the shared ready-file and
  // process-tree lifecycle so failed startup retains a bounded output tail.
  const server = await startServer({
    port: REUSED_API_ADMIN_TOKEN ? API_PORT : 0,
    db: ':memory:',
    cwd: repoRoot,
    env: REUSED_API_ADMIN_TOKEN
      ? { SNAPBACK_ADMIN_TOKEN: REUSED_API_ADMIN_TOKEN }
      : {},
    provenance: { appId: 'all-aboard', artifactsPath: artifactsJsonPath },
    startupTimeoutMs: 90_000,
  });
  apiUrl = server.baseUrl;
  apiAdminToken = server.adminToken;
  if (!apiAdminToken) throw new Error('Snapback API did not return an admin token');
  cleanups.push(() => server.stop());
}

async function ensureVite() {
  let port = VITE_PORT;
  if (await urlOk(viteUrl)) {
    // Same rule as the API server (ENG-22753): a Vite answering on the port is
    // reused only when its source-provenance probe proves it serves THIS
    // checkout's surface tree against THIS run's API origin.
    const verdict = await verifyViteProvenance(viteUrl, {
      app: 'all-aboard',
      surface: 'contract',
      root: surfaceDir,
      apiOrigin: apiUrl,
      targetProfile: 'local-dev-sqlite-ibex',
    });
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
    {
      cwd: surfaceDir,
      env: unprivilegedChildEnv({
        SNAPBACK_ALL_ABOARD_API: apiUrl,
        SNAPBACK_ALL_ABOARD_TARGET_PROFILE: 'local-dev-sqlite-ibex',
      }),
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  cleanups.push(() => child.kill('SIGTERM'));
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) { if (await urlOk(viteUrl)) return; if (child.exitCode !== null) throw new Error('Vite exited'); await sleep(500); }
  throw new Error('Vite did not become ready');
}

async function launchIsolatedPage(userDataPrefix) {
  const chrome = await launchChromeCdp({
    chromeBin,
    userDataPrefix,
    env: unprivilegedChildEnv(),
    extraArgs: process.platform === 'linux' ? ['--disable-dev-shm-usage'] : [],
  });
  let connection = null;
  let isolatedPage = null;
  try {
    connection = await connectCdp(chrome.ws);
    isolatedPage = await connection.newPage();
    await isolatedPage.activate();
  } catch (error) {
    connection?.close();
    await chrome.stop();
    throw error;
  }
  return {
    page: isolatedPage,
    close: async () => {
      await isolatedPage.close().catch(() => { /* target may already be gone */ });
      connection.close();
      await chrome.stop();
    },
  };
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
    // @ref LLP 0008#decision-dk-9--client-local-store-mandate-2026-07-02 —
    // the Node control plane is one client-store context. Keep one lifecycle
    // so its default per-origin RQS store legitimately retains writer custody;
    // throwaway clients would leave the first query client holding the lock.
    const controlClient = new SnapbackClient(apiUrl);
    cleanups.push(() => controlClient.close());
    await ensureVite();
    await suite.check('dev shell leaves native discovery to content negotiation', async () => {
      const html = await (await fetch(`${viteUrl}/`)).text();
      return {
        ok: !html.includes('rel="exact:platform-manifest"') && !html.includes("rel='exact:platform-manifest'"),
        detail: 'static platform-manifest discovery must only be injected by production builds',
      };
    });
    const chrome = await launchChromeCdp({
      chromeBin,
      userDataPrefix: 'aa-browser-',
      env: unprivilegedChildEnv(),
    });
    cleanups.push(() => chrome.stop());
    cdp = await connectCdp(chrome.ws);
    cleanups.push(() => cdp.close());
    page = await cdp.newPage();
    await page.activate();
    // Pin the scheme: the app follows the OS appearance, and this host may
    // be in dark mode when the suite runs. The color assertions are written
    // against the light palette; the dark-mode check flips explicitly via
    // window.__aaSetColorScheme.
    await page.navigate(`${viteUrl}/?appearance=light`);

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
          if (t && t.usefulBoardCommittedMs !== null && t.firstBoardPaintMs !== null && t.backendConnectedMs !== null) return t;
          if (Date.now() > d) return t ?? null;
          await new Promise(r => setTimeout(r, 50));
        }
      })()`);
      if (typeof timing?.usefulBoardCommittedMs !== 'number') throw new Error(`usefulBoardCommittedMs not recorded: ${JSON.stringify(timing)}`);
      if (typeof timing?.firstBoardPaintMs !== 'number') throw new Error(`firstBoardPaintMs not recorded: ${JSON.stringify(timing)}`);
      if (typeof timing?.backendConnectedMs !== 'number') throw new Error(`backendConnectedMs not recorded: ${JSON.stringify(timing)}`);
      if (timing.firstBoardPaintMs > timing.backendConnectedMs) {
        throw new Error(`board paint waited for the backend: ${JSON.stringify(timing)}`);
      }
      if (timing.firstBoardPaintMs < timing.usefulBoardCommittedMs) {
        throw new Error(`paint timestamp preceded the useful-board commit: ${JSON.stringify(timing)}`);
      }
      const { responseToBoardMs, codeToBoardMs } = assertFirstBoardPaintBudget(timing, PAINT_BUDGET_MS);
      const bootChromeVisible = await page.eval(
        `(() => { const el = document.getElementById('boot-status'); return el ? getComputedStyle(el).display !== 'none' : false; })()`,
      );
      if (bootChromeVisible) throw new Error('boot-status chrome is visible on the happy path');
      return {
        ...timing,
        responseToBoardMs: Math.round(responseToBoardMs),
        codeToBoardMs: Math.round(codeToBoardMs),
      };
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
    // location — via the permission change listener and the footer
    // location-indicator press (the gesture-driven retry) — instead of
    // dead-ending on a silent auto-denied prompt. The hint-text line under
    // the board is gone: the footer icon's color is the location signal
    // (blue on a device fix, gray on any fallback). Position pinned to San
    // Francisco 4th & King, far from the Mountain View default, so
    // nearest-station selection is unambiguous. Runs before any station
    // navigation sets stationId.
    await suite.check('granting location adopts the real position; footer icon retries and turns blue', async () => {
      const hasHintText = await page.eval(`!!document.querySelector('[data-testid="location-hint"]')`);
      if (hasHintText) throw new Error('location hint text should be gone from the board');
      await page.setGeolocation(37.77639, -122.39472);
      await page.click('location-indicator');
      const granted = await page.pollText('station-name', '^San Francisco$', 12000);
      if (granted !== 'San Francisco') throw new Error(`nearest station not selected: ${granted}`);
      const iconColor = await page.evalPoll(
        `document.querySelector('[data-testid="location-indicator"] svg')?.getAttribute('stroke') ?? ''`,
        (c) => /0A84FF/i.test(c),
        9000,
      );
      if (!/0A84FF/i.test(iconColor ?? '')) throw new Error(`footer icon did not turn blue on a device fix: ${iconColor}`);
      // The press asks for a fresh fix (maximumAge 0), not the cached one:
      // move the pinned position and tap again — the board must follow. This
      // also restores the Mountain View start downstream checks assume.
      await page.setGeolocation(37.3894, -122.0819);
      await page.click('location-indicator');
      const restored = await page.pollText('station-name', '^Mountain View$', 12000);
      if (restored !== 'Mountain View') throw new Error(`indicator press did not re-read the position: ${restored}`);
      return { granted, iconColor, restored };
    });

    await suite.check('press affordance: previous-station changes the station card', async () => {
      const before = await page.text('station-name');
      await page.click('prev-station');
      const after = await page.text('station-name');
      if (!before || before === after) throw new Error(`station did not change (${before} -> ${after})`);
      return { before, after };
    });

    await suite.check('direction switch lives in the sticky footer, with Switch-to copy and the opposite countdown', async () => {
      // ENG-23795: the direction pill is gone; the switch is the footer's
      // center control, "Switch to" de-emphasized over the destination. The
      // board's opposite-direction teaser row is gone too — the footer switch
      // carries that train's countdown instead.
      const inFooter = await page.eval(
        `!!document.querySelector('[data-testid="sticky-footer"] [data-testid="flip-direction"]')`,
      );
      if (!inFooter) throw new Error('flip-direction is not inside the sticky footer');
      const copy = await page.eval(`document.querySelector('[data-testid="flip-direction"]').textContent`);
      if (!/Switch to/.test(copy ?? '')) throw new Error(`Switch-to copy missing: ${copy}`);
      const teaser = await page.eval(`!!document.querySelector('[data-testid="opposite-line"]')`);
      if (teaser) throw new Error('opposite-direction teaser row should be gone from the board');
      // The countdown renders whenever the opposite direction still has a
      // train (the demo corridor always does); when present it must be a
      // well-formed minutes figure.
      const switchTime = await page.eval(`document.querySelector('[data-testid="switch-direction-time"]')?.textContent ?? ''`);
      if (!/^\d+ min$/.test(switchTime)) throw new Error(`switch countdown missing or malformed: ${switchTime}`);
      // The switch target is gray, not Caltrain red — red read as "this IS
      // the current direction".
      const switchColor = await page.eval(`getComputedStyle(document.querySelector('[data-testid="switch-direction-name"]')).color`);
      if (switchColor !== 'rgb(87, 96, 108)') throw new Error(`switch target not de-emphasized gray: ${switchColor}`);
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
      // The detail screen answers the app's primary question too: minutes
      // until this train reaches the boarding station.
      const countdown = await page.text('trip-countdown');
      if (!/^\d+$/.test(countdown ?? '')) throw new Error(`trip boarding countdown not numeric: ${countdown}`);
      await page.click('trip-back');
      return { position, back, service, caption, countdown };
    });

    await suite.check('Refresh press drives refreshFeed action; freshness goes live', async () => {
      const before = await page.text('freshness');
      await page.click('refresh');
      const after = await page.evalPoll(`document.querySelector('[data-testid="freshness"]').textContent`, (t) => /Updated/.test(t), 5000);
      if (!/Updated/.test(after)) throw new Error(`freshness did not update: ${before} -> ${after}`);
      // Cross-check the durable write landed on the server.
      const feed = (await controlClient.query('feedState', {})).rows[0];
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
      const feed = (await controlClient.query('feedState', {})).rows[0];
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
      const feed = (await controlClient.query('feedState', {})).rows[0];
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
      // The Refresh press a few checks back consumed the ENG-23642 one-poll-
      // per-180s upstream budget; a budget-denied cron run would honestly skip
      // (no commit, no delta). Clear it so this check exercises the push lane.
      await controlClient.mutate('resetFeed', {});
      const feedBefore = (await controlClient.query('feedState', {})).rows[0] ?? {};
      const tickBefore = feedBefore.tickIndex ?? -1;
      const tickCount = feedBefore.tickCount ?? 0;
      const run = await fetch(`${apiUrl}/_snapback/api/cron/warmPoll/run`, {
        method: 'POST',
        headers: { 'x-snapback-admin-token': apiAdminToken },
      });
      if (!run.ok) throw new Error(`cron manual run failed: HTTP ${run.status}`);
      const record = await run.json();
      const fresh = await page.pollText('freshness', 'Updated a few seconds ago', 6000);
      if (fresh !== 'Updated a few seconds ago') throw new Error(`cron delta did not reach the browser: freshness=${fresh}`);
      const tickAfter = (await controlClient.query('feedState', {})).rows[0]?.tickIndex ?? -1;
      // Recorded feed ticks are cyclic: 5 -> 0 is a valid advance.
      if (tickCount > 1 && tickAfter === tickBefore) throw new Error(`cron run did not advance the feed (${tickBefore} -> ${tickAfter})`);
      const conns = await page.eval('window.allAboard.connections()');
      if (conns.liveTrainStatus !== 'live') throw new Error(`connection degraded during push: ${JSON.stringify(conns)}`);
      return { cronOutcome: record.outcome, tickBefore, tickAfter, connections: conns };
    });

    await suite.check('second window boot does not clear the first (D4 inspect-first)', async () => {
      // Chrome 151 on GitHub's Linux image exhausts per-process loader
      // resources when two raw Exact dev-module graphs are resident at once.
      // Keep the product invariant honest — two simultaneous app windows on
      // the same backend, with the first still live — by giving the second
      // real window its own browser process and resource pool.
      return retryChromeResourceExhaustion(async () => {
        const isolated = await launchIsolatedPage('aa-browser-second-');
        const page2 = isolated.page;
        try {
        // Contract commits are frame-driven. Chrome throttles background tabs,
        // so make the window under test foreground before asking it to boot.
        await page2.activate();
        await page2.navigate(`${viteUrl}/?appearance=light`);
        let second;
        try {
          second = await page2.eval(`(async () => {
            const d = Date.now() + 20000;
            while (!window.allAboard) {
              if (Date.now() > d) throw new Error('second window never booted');
              await new Promise(r=>setTimeout(r,50));
            }
            await window.allAboard.ready;
            const s = Date.now() + 8000;
            for (;;) {
              const conns = window.allAboard.connections ? window.allAboard.connections() : null;
              if (conns && conns.liveTrainStatus === 'live') return { provisioned: window.allAboard.provisioned, connections: conns };
              if (Date.now() > s) throw new Error('second window connections never settled: ' + JSON.stringify(conns));
              await new Promise(r => setTimeout(r, 100));
            }
          })()`);
        } catch (error) {
          const diagnostics = await page2.diagnostics().catch((diagnosticsError) => ({
            diagnosticsError: diagnosticsError.message,
          }));
          throw new Error(`${error.message}; diagnostics=${JSON.stringify(diagnostics)}`, { cause: error });
        }
        // Inspect-first: the backend is already provisioned and seeded, so the
        // second window's boot performs NO provisioning writes (the LLP 0275 C4
        // footgun — a second window calling loadSchema/reset — is gone).
        if (second.provisioned.length !== 0) {
          throw new Error(`second window re-provisioned: ${JSON.stringify(second.provisioned)}`);
        }
        // The first window's session survived: still rendered, still live, and
        // still receiving server-authored deltas after the second boot.
        await page.activate();
        const stationName = await page.text('station-name');
        if (!stationName) throw new Error('first window lost its board after the second boot');
        const run = await fetch(`${apiUrl}/_snapback/api/cron/warmPoll/run`, {
          method: 'POST',
          headers: { 'x-snapback-admin-token': apiAdminToken },
        });
        if (!run.ok) throw new Error(`cron manual run failed: HTTP ${run.status}`);
        const fresh = await page.pollText('freshness', 'Updated a few seconds ago', 6000);
        if (fresh !== 'Updated a few seconds ago') throw new Error(`first window stopped receiving push after second boot: ${fresh}`);
        const conns = await page.eval('window.allAboard.connections()');
        if (conns.liveTrainStatus !== 'live') throw new Error(`first window degraded: ${JSON.stringify(conns)}`);
        return { second, firstStillLive: conns };
        } finally {
          await isolated.close();
          await page.activate();
        }
      });
    });

    // Exact LLP 0336 P1: the shared Contract recognizer owns both contiguous
    // pagers. These synthetic pointer/wheel sequences are retained from the
    // old glue suite as migration acceptance, not replaced with click tests.

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

    await suite.check('pager arena preserves browser-owned edges and scopes touch-action to interior cells', async () => {
      const policy = await page.eval(`(() => {
        const header = document.querySelector('[data-testid="station-header"]');
        const board = document.querySelector('[data-testid="board-content"]');
        const pager = document.querySelector('[data-testid="hero-pager"]');
        pager.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 77, isPrimary: true, button: 0, buttons: 1, bubbles: true, clientX: 120, clientY: 480 }));
        pager.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 77, isPrimary: true, button: 0, bubbles: true, clientX: 120, clientY: 480 }));
        return {
          header: getComputedStyle(header).touchAction,
          board: getComputedStyle(board).touchAction,
          stationCell: getComputedStyle(document.querySelector('[data-testid="station-pager"] [data-exact-pager-cell="current"]')).touchAction,
          heroCell: getComputedStyle(document.querySelector('[data-testid="hero-pager"] [data-exact-pager-cell="current"]')).touchAction,
          edgeGuards: Array.from(document.querySelectorAll('[data-exact-motion-edge-guard]')).map((guard) => getComputedStyle(guard).touchAction),
        };
      })()`);
      if (
        policy.header !== 'auto' ||
        policy.board !== 'auto' ||
        policy.stationCell !== 'pan-y' ||
        policy.heroCell !== 'pan-y' ||
        policy.edgeGuards.some((value) => value !== 'auto')
      ) {
        throw new Error(`framework pager policy missing: ${JSON.stringify(policy)}`);
      }
      return policy;
    });

    await suite.check('gesture: swipe left on the header pages to the adjacent station', async () => {
      // ENG-23719 gesture zones: station navigation lives on the red header
      // (y within the 106px sticky band), not the scrolling board below it.
      const before = await page.text('station-name');
      await page.swipe('h', -170, { cy: 53, targetId: 'station-header' });
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
      await page.swipe('h', -170, { cy: 480, targetId: 'board-content' });
      const afterText = await page.evalPoll(
        `document.querySelector('[data-testid="hero-meta"]')?.textContent ?? ''`,
        (value) => num(value) !== before,
        3000,
      );
      const after = num(afterText);
      if (!before || before === after) throw new Error(`hero train did not change (${before} -> ${after})`);
      return { before, after };
    });

    await suite.check('train selection: rows select on tap; sooner trains stay visible in compact form', async () => {
      // ENG-23795: the circular arrows are gone. The row after the hero
      // carries train-next, the compact row before it train-prev; pressing a
      // row pages the strip to that train, and paged-past trains remain as
      // compact rows instead of disappearing.
      const num = (s) => (s ?? '').match(/#\d+/)?.[0] ?? null;
      // Continue from the page selected by the preceding swipe. This proves
      // the visible following row and pager compose without resetting the
      // binding generation between the two interactions.
      const first = num(await page.text('hero-meta'));
      const nextRows = await page.eval(`(() => {
        const rows = Array.from(document.querySelectorAll('[data-testid="train-next"]'));
        const visible = rows.filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');
        const event = new MouseEvent('click', { bubbles: true, cancelable: true });
        const dispatched = visible.at(-1)?.dispatchEvent(event) ?? false;
        return { total: rows.length, visible: visible.length, dispatched, defaultPrevented: event.defaultPrevented };
      })()`);
      const pagedText = await page.evalPoll(
        `document.querySelector('[data-testid="hero-meta"]')?.textContent ?? ''`,
        (value) => num(value) !== first,
        3000,
      );
      const paged = num(pagedText);
      if (!paged || paged === first) {
        throw new Error(`train-next row did not page (${first} -> ${paged}); rows=${JSON.stringify(nextRows)}`);
      }
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

    await suite.check('hero stop chips: boarding stop, ellipsis, then the end of the line', async () => {
      // The chips answer "when does it leave here / when does it arrive at
      // the end", not "what are the next few stops" — boarding chip, a gap
      // marker when intermediate stops are elided, and the run's last two
      // stops. The terminal chip must match the active direction's corridor
      // terminal (every demo-schedule run serves the full pattern).
      await page.eval(`(async () => { document.querySelector('[data-testid="train-first"]')?.click(); await new Promise(r=>setTimeout(r,300)); })()`);
      const ids = await page.eval(
        `Array.from(document.querySelectorAll('[data-testid="hero-departure"] [data-testid^="hero-stop-"]')).map((el) => el.getAttribute('data-testid'))`,
      );
      if (!Array.isArray(ids) || ids.length < 2) throw new Error(`too few stop chips: ${JSON.stringify(ids)}`);
      if (ids.length > 4) throw new Error(`chips not truncated to the end of the line: ${JSON.stringify(ids)}`);
      const hasGap = ids.includes('hero-stop-gap');
      if (hasGap && ids[1] !== 'hero-stop-gap') throw new Error(`gap marker out of place: ${JSON.stringify(ids)}`);
      const direction = await page.text('active-direction');
      const terminal = /North/.test(direction ?? '') ? 'hero-stop-san-francisco' : 'hero-stop-san-jose';
      if (ids[ids.length - 1] !== terminal) throw new Error(`last chip is not the ${direction} terminal: ${JSON.stringify(ids)}`);
      const lastChip = await page.eval(`document.querySelector('[data-testid="${terminal}"]').textContent`);
      if (!/\d+:\d{2}[ap] /.test(lastChip ?? '')) throw new Error(`terminal chip missing its arrival time: ${lastChip}`);
      return { ids, direction, lastChip };
    });

    await suite.check('trackpad wheel swipe anywhere on the board pages between trains', async () => {
      // Two-finger trackpad swipes arrive as wheel events, not pointers; a
      // horizontal wheel gesture over any part of the white board area must
      // page the selected train exactly once per swipe (accumulate + lockout).
      const num = (s) => (s ?? '').match(/#\d+/)?.[0] ?? null;
      const first = num(await page.text('hero-meta'));
      const wheel = (dx) => page.eval(`(() => {
        const el = document.querySelector('[data-testid="board-content"]');
        el.dispatchEvent(new WheelEvent('wheel', { deltaX: ${dx}, deltaY: 3, bubbles: true, cancelable: true }));
        return true;
      })()`);
      await wheel(120);
      const paged = await page.evalPoll(
        `document.querySelector('[data-testid="hero-meta"]').textContent`,
        (t) => num(t) !== first,
        3000,
      );
      if (num(paged) === first) throw new Error(`wheel swipe did not page (${first} -> ${num(paged)})`);
      await sleep(500); // clear the one-page-per-swipe lockout
      await wheel(-120);
      const back = await page.evalPoll(
        `document.querySelector('[data-testid="hero-meta"]').textContent`,
        (t) => num(t) === first,
        3000,
      );
      if (num(back) !== first) throw new Error(`reverse wheel swipe did not page back (${num(back)} != ${first})`);
      return { first, paged: num(paged), back: num(back) };
    });

    await suite.check('declared pager arrows and mnemonic keys share visible command witnesses', async () => {
      const num = (s) => (s ?? '').match(/#\d+/)?.[0] ?? null;
      await page.eval(`(async () => { document.querySelector('[data-testid="train-first"]')?.click(); await new Promise(r=>setTimeout(r,300)); })()`);
      const firstTrain = num(await page.text('hero-meta'));
      await page.eval(`document.querySelector('[data-testid="hero-pager"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })); true`);
      const nextTrainText = await page.evalPoll(
        `document.querySelector('[data-testid="hero-meta"]')?.textContent ?? ''`,
        (value) => num(value) !== firstTrain,
        3000,
      );
      const beforeDirection = await page.text('active-direction');
      await page.eval(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', bubbles: true, cancelable: true })); true`);
      const afterDirection = await page.evalPoll(
        `document.querySelector('[data-testid="active-direction"]')?.textContent ?? ''`,
        (value) => value !== beforeDirection,
        3000,
      );
      await page.eval(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true, cancelable: true })); true`);
      const settings = await page.evalPoll(`!!document.querySelector('[data-testid="settings-screen"]')`, Boolean, 3000);
      if (!settings) throw new Error('g mnemonic did not open settings');
      await page.eval(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); true`);
      const home = await page.evalPoll(`!!document.querySelector('[data-testid="station-screen"]')`, Boolean, 3000);
      if (!home) throw new Error('deferred sheet Escape did not return home');
      return { firstTrain, nextTrain: num(nextTrainText), beforeDirection, afterDirection };
    });

    await suite.check('rest-of-day rows render below the hero, fading past three trains out', async () => {
      // The board shows every remaining departure for the day; rows more
      // than three past the selected train carry a gradually decreasing
      // opacity (floored, never invisible) so the tail stays scannable.
      await page.eval(`(async () => { document.querySelector('[data-testid="train-first"]')?.click(); await new Promise(r=>setTimeout(r,300)); })()`);
      const rows = await page.eval(`Array.from(document.querySelectorAll('[data-testid="train-next"], [data-testid^="train-at-"]'))
        .map((el) => ({ id: el.getAttribute('data-testid'), opacity: parseFloat(getComputedStyle(el).opacity) }))`);
      if (!Array.isArray(rows) || rows.length < 1) throw new Error('no rest-of-day rows rendered');
      for (const row of rows.slice(0, 3)) {
        if (row.opacity !== 1) throw new Error(`row within 3 of the hero must not fade: ${JSON.stringify(row)}`);
      }
      for (let i = 1; i < rows.length; i++) {
        if (rows[i].opacity > rows[i - 1].opacity + 0.001) throw new Error(`fade is not monotonic at ${JSON.stringify(rows[i])}`);
      }
      if (rows.length >= 5) {
        const tail = rows[rows.length - 1];
        if (!(tail.opacity < 1) || !(tail.opacity >= 0.38)) throw new Error(`tail row not faded within the floor: ${JSON.stringify(tail)}`);
      }
      return { count: rows.length, firstOpacity: rows[0]?.opacity, lastOpacity: rows[rows.length - 1]?.opacity };
    });

    await suite.check('footer Clipper button opens the device-appropriate Clipper link', async () => {
      await page.eval(`window.__aaOpened = []; window.open = (u) => { window.__aaOpened.push(u); return null; };`);
      const opened = await page.eval(`(async () => {
        document.querySelector('[data-testid="clipper"]').click();
        await new Promise((r) => setTimeout(r, 200));
        return window.__aaOpened;
      })()`);
      if (!Array.isArray(opened) || opened.length !== 1) throw new Error(`expected one clipper open: ${JSON.stringify(opened)}`);
      // Headless Chrome is a desktop UA: the website, not an app store.
      if (!/clippercard\.com/.test(opened[0])) throw new Error(`not the Clipper site: ${opened[0]}`);
      return { opened };
    });

    await suite.check('dark mode: the reactive scheme binding restyles the board', async () => {
      // Exact owns the physical scheme subscription; ?appearance= and
      // window.__aaSetColorScheme are deterministic host-publication controls
      // because page JS cannot synthesize a real media-query flip.
      const bgOf = () => page.eval(`getComputedStyle(document.querySelector('[data-testid="all-aboard-main"]')).backgroundColor`);
      const lightBg = await bgOf();
      if (lightBg !== 'rgb(255, 255, 255)') throw new Error(`expected a white light-mode board: ${lightBg}`);
      await page.eval(`window.__aaSetColorScheme('dark'); true`);
      const darkBg = await page.evalPoll(
        `getComputedStyle(document.querySelector('[data-testid="all-aboard-main"]')).backgroundColor`,
        (c) => c === 'rgb(20, 23, 28)',
        9000,
      );
      if (darkBg !== 'rgb(20, 23, 28)') throw new Error(`board did not go dark: ${darkBg}`);
      const darkInk = await page.eval(`getComputedStyle(document.querySelector('[data-testid="active-direction"]')).color`);
      if (darkInk !== 'rgb(242, 244, 247)') throw new Error(`title text not lifted for dark: ${darkInk}`);
      const bodyScheme = await page.eval(`document.body.dataset.aaScheme`);
      if (bodyScheme !== 'dark') throw new Error(`body backdrop not switched: ${bodyScheme}`);
      await page.eval(`window.__aaSetColorScheme('light'); true`);
      const restored = await page.evalPoll(
        `getComputedStyle(document.querySelector('[data-testid="all-aboard-main"]')).backgroundColor`,
        (c) => c === 'rgb(255, 255, 255)',
        9000,
      );
      if (restored !== 'rgb(255, 255, 255)') throw new Error(`board did not restore to light: ${restored}`);
      return { lightBg, darkBg, darkInk };
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

    await suite.check('router presentation owns Escape dismissal (no app gesture glue)', async () => {
      await page.click('open-settings');
      const before = await page.exists('settings-screen');
      if (!before) throw new Error('settings presentation did not open');
      await page.eval(`(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        await new Promise((resolve) => setTimeout(resolve, 250));
      })()`);
      const home = await page.exists('station-header');
      if (!home) throw new Error('router-owned Escape did not dismiss the presentation');
      const pathname = await page.eval(`window.location.pathname`);
      if (pathname !== '/') throw new Error(`Escape left the router at ${pathname}`);
      return { before, home, pathname };
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

    await suite.check('preferences survive router remounts when browser storage is denied', async () => {
      await page.eval(`(() => {
        window.__aaStorageMethods = {
          getItem: Storage.prototype.getItem,
          setItem: Storage.prototype.setItem,
        };
        Storage.prototype.getItem = function () { throw new DOMException('denied', 'SecurityError'); };
        Storage.prototype.setItem = function () { throw new DOMException('denied', 'SecurityError'); };
      })()`);
      try {
        await page.click('open-settings');
        await page.click('maps-app');
        await page.click('maps-app');
        const chosenMaps = await page.text('maps-app');
        if (chosenMaps !== 'Google Maps') throw new Error(`expected Google Maps under denied storage: ${chosenMaps}`);
        await page.click('eta-mode');
        const chosenEta = await page.text('eta-mode');
        if (chosenEta !== '🚴 Bike') throw new Error(`expected Bike under denied storage: ${chosenEta}`);
        await page.click('settings-back');

        const label = await page.eval(
          `document.querySelector('[data-testid^="station-directions-"]')?.getAttribute('aria-label') ?? ''`,
        );
        if (!/preferred app Google Maps/.test(label)) {
          throw new Error(`Contract affordance lost the maps choice: ${label}`);
        }
        await page.eval(`window.__aaOpened = [];`);
        await page.eval(`document.querySelector('[data-testid^="station-directions-"]')?.click()`);
        const opened = await page.eval('window.__aaOpened');
        if (!Array.isArray(opened) || !/google\.com\/maps/.test(opened[0] ?? '')) {
          throw new Error(`directions ignored Contract maps state: ${JSON.stringify(opened)}`);
        }

        await page.click('open-settings');
        const remountedMaps = await page.text('maps-app');
        const remountedEta = await page.text('eta-mode');
        if (remountedMaps !== chosenMaps || remountedEta !== chosenEta) {
          throw new Error(
            `preference remount drifted: ${JSON.stringify({ chosenMaps, chosenEta, remountedMaps, remountedEta })}`,
          );
        }

        // Restore the baseline while the denied-storage path is still active.
        await page.click('maps-app');
        await page.click('eta-mode');
        await page.click('eta-mode');
        await page.click('settings-back');
        return { chosenMaps, chosenEta, remountedMaps, remountedEta, opened };
      } finally {
        await page.eval(`(() => {
          const methods = window.__aaStorageMethods;
          if (methods) {
            Storage.prototype.getItem = methods.getItem;
            Storage.prototype.setItem = methods.setItem;
          }
          delete window.__aaStorageMethods;
          window.localStorage.setItem('all-aboard.mapsApp', 'default');
          window.localStorage.setItem('all-aboard.etaMode', 'auto');
        })()`);
      }
    });

    // E4 (ENG-22450): the app-wide ETA mode toggle — in Settings since the
    // ENG-23719 redesign; the header summary and the stations sheet follow it.

    await suite.check('ETA mode (in Settings) toggles walk/bike estimates app-wide', async () => {
      const walk = await page.text('walk-bike');
      if (!/min walk/.test(walk ?? '')) throw new Error(`expected walk mode summary: ${walk}`);
      await page.click('open-settings');
      await page.click('eta-mode');
      const firstToggle = await page.eval(`({
        label: document.querySelector('[data-testid="eta-mode"]')?.textContent.trim() ?? null,
        stored: window.localStorage.getItem('all-aboard.etaMode'),
        search: new URL(window.location.href).searchParams.get('eta'),
      })`);
      if (firstToggle.label !== '🚴 Bike' || firstToggle.stored !== 'bike' || firstToggle.search !== 'bike') {
        throw new Error(`one ETA press diverged across UI, storage, and route: ${JSON.stringify(firstToggle)}`);
      }
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
      await page.click('open-settings');
      await page.click('eta-mode');
      const autoLabel = await page.text('eta-mode');
      if (autoLabel !== 'Auto') throw new Error(`eta mode did not cycle back to Auto: ${autoLabel}`);
      await page.click('settings-back');
      const auto = await page.text('walk-bike');
      if (!/min walk/.test(auto ?? '')) throw new Error(`auto mode summary did not resolve to walk: ${auto}`);
      return { walk, firstToggle, bike, back, auto, autoLabel, pickerRow };
    });

    // ENG-23727: with the API origin unreachable, the open must still show
    // the best available board (deterministic schedule) under an honest
    // status note — never a blocking startup screen. This is the structural
    // guard against the boot-ceremony regression: if paint gated on
    // health/ensure/subscribe again, this page would render nothing but
    // loading chrome.
    await suite.check('backend unreachable: the open still shows a schedule board, honestly labeled', async () => {
      // Use a foreground-only isolated browser for this independent cold open.
      // It avoids both hidden-tab scheduling and stale diagnostics/resources
      // accumulated by the long interactive primary session.
      return retryChromeResourceExhaustion(async () => {
        const isolated = await launchIsolatedPage('aa-browser-offline-');
        const offlinePage = isolated.page;
        try {
        await offlinePage.blockUrls(`${apiUrl}/*`);
        await offlinePage.navigate(`${viteUrl}/?appearance=light`);
        try {
          await offlinePage.waitForTestId('station-name');
        } catch (error) {
          const diagnostics = await offlinePage.diagnostics().catch((diagnosticsError) => ({
            diagnosticsError: diagnosticsError.message,
          }));
          throw new Error(`${error.message}; diagnostics=${JSON.stringify(diagnostics)}`, { cause: error });
        }
        const stationName = await offlinePage.text('station-name');
        const heroMinutes = await offlinePage.text('hero-minutes');
        const badge = await offlinePage.text('data-source');
        const note = await offlinePage.pollText('delays-loading', 'Connecting for live updates|Offline — showing scheduled departures', 8000);
        if (!stationName) throw new Error('no station rendered with the backend unreachable');
        if (!/^\d+$/.test(heroMinutes ?? '')) throw new Error(`no schedule departure rendered: ${heroMinutes}`);
        if (!/SCHEDULE/.test(badge ?? '')) throw new Error(`schedule data not honestly labeled: ${badge}`);
        if (!/Connecting for live updates|Offline/.test(note ?? '')) throw new Error(`honest status note missing: ${note}`);
        const timing = await offlinePage.eval('window.allAboard?.startupTiming ?? null');
        if (timing?.backendConnectedMs !== null) throw new Error(`backend unexpectedly attached: ${JSON.stringify(timing)}`);
        const bootChrome = await offlinePage.eval(
          `(() => { const el = document.getElementById('boot-status'); return el ? { visible: getComputedStyle(el).display !== 'none', text: el.textContent } : { visible: false, text: null }; })()`,
        );
        if (bootChrome.visible) throw new Error(`blocking boot chrome shown instead of the board: ${bootChrome.text}`);
        return { stationName, heroMinutes, badge, note };
        } finally {
          await isolated.close();
        }
      });
    });
  }, { cleanups });
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  const sessionEvents = new Map();
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
    if (msg.sessionId && sessionEvents.has(msg.sessionId)) {
      sessionEvents.get(msg.sessionId)(msg.method, msg.params ?? {});
    }
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
      const { targetId } = await send('Target.createTarget', {
        url: 'about:blank',
        background: false,
      });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      const requestUrls = new Map();
      const captured = {
        runtimeExceptions: [],
        consoleErrors: [],
        logEntries: [],
        networkFailures: [],
        moduleResponses: [],
      };
      sessionEvents.set(sessionId, (method, params) => {
        if (method === 'Runtime.exceptionThrown') {
          captured.runtimeExceptions.push({
            text: params.exceptionDetails?.text,
            description: params.exceptionDetails?.exception?.description,
            url: params.exceptionDetails?.url,
            lineNumber: params.exceptionDetails?.lineNumber,
            columnNumber: params.exceptionDetails?.columnNumber,
          });
        } else if (method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(params.type)) {
          captured.consoleErrors.push({
            type: params.type,
            values: (params.args ?? []).map((arg) => arg.value ?? arg.description ?? arg.type),
          });
        } else if (method === 'Log.entryAdded') {
          captured.logEntries.push(params.entry ?? {});
        } else if (method === 'Network.requestWillBeSent') {
          requestUrls.set(params.requestId, params.request?.url);
        } else if (method === 'Network.responseReceived') {
          const response = params.response ?? {};
          if (params.type === 'Script' || response.url?.includes('/main.ts') || response.url?.includes('/@vite/client')) {
            captured.moduleResponses.push({
              url: response.url,
              status: response.status,
              statusText: response.statusText,
              mimeType: response.mimeType,
              protocol: response.protocol,
              fromDiskCache: response.fromDiskCache,
              fromServiceWorker: response.fromServiceWorker,
            });
          }
        } else if (method === 'Network.loadingFailed') {
          captured.networkFailures.push({
            url: requestUrls.get(params.requestId),
            errorText: params.errorText,
            canceled: params.canceled,
            blockedReason: params.blockedReason,
            type: params.type,
          });
          requestUrls.delete(params.requestId);
        } else if (method === 'Network.loadingFinished') {
          requestUrls.delete(params.requestId);
        }
        for (const values of Object.values(captured)) {
          if (values.length > 20) values.splice(0, values.length - 20);
        }
      });
      await send('Page.enable', {}, sessionId);
      await send('Runtime.enable', {}, sessionId);
      await send('Log.enable', {}, sessionId);
      await send('Network.enable', {}, sessionId);
      const evalRaw = async (expression) => {
        const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId);
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r.result?.value;
      };
      const sel = (id) => `[data-testid="${id}"]`;
      const activate = async () => {
        await send('Target.activateTarget', { targetId });
        await send('Page.bringToFront', {}, sessionId);
      };
      const navigate = async (url) => {
        await activate();
        const result = await send('Page.navigate', { url }, sessionId);
        if (result.errorText) throw new Error(`navigation failed: ${result.errorText}`);

        // Page.navigate acknowledges the request before the new document has
        // committed. An immediate long-running Runtime.evaluate can otherwise
        // bind to the old about:blank context and wait there forever on slower
        // Linux hosts. Poll with short evaluations until the target URL owns
        // the execution context; the surface-specific boot checks run after
        // this commit boundary.
        const expectedHref = new URL(url).href;
        const deadline = Date.now() + 15_000;
        let observed = null;
        let lastError = null;
        while (Date.now() < deadline) {
          try {
            observed = await evalRaw('({ href: location.href, readyState: document.readyState })');
            if (observed?.href === expectedHref && observed.readyState !== 'loading') return observed;
          } catch (error) {
            // A context-destroyed response is expected while the navigation
            // swaps documents. The next short evaluation targets the new one.
            lastError = error;
          }
          await sleep(50);
        }
        throw new Error(
          `navigation did not commit ${expectedHref}; observed=${JSON.stringify(observed)}` +
          (lastError ? `; lastError=${lastError.message}` : ''),
        );
      };
      const diagnostics = async () => ({
        // CI retains only the first 500 characters of each failing acceptance
        // line. Put the decisive first browser failure ahead of page/resource
        // context so the bounded log remains an attribution receipt.
        failureSummary: {
          runtimeException: captured.runtimeExceptions.at(0) ?? null,
          consoleError: captured.consoleErrors.at(0) ?? null,
          logEntry: captured.logEntries.find((entry) => entry.level === 'error')
            ?? captured.logEntries.at(0)
            ?? null,
          networkFailure: captured.networkFailures.at(-1) ?? null,
          moduleResponses: captured.moduleResponses.filter((response) =>
            response.url?.includes('/main.ts') || response.url?.includes('/@vite/client')),
        },
        page: await evalRaw(`({
          href: location.href,
          readyState: document.readyState,
          visibilityState: document.visibilityState,
          hasFocus: document.hasFocus(),
          exactRootChildren: document.getElementById('exact-root')?.childElementCount ?? null,
          bootStatus: document.getElementById('boot-status')?.textContent ?? null,
          scripts: [...document.scripts].map((script) => script.src || script.textContent?.slice(0, 80) || ''),
          moduleResources: performance.getEntriesByType('resource')
            .filter((entry) => entry.name.includes('/main.ts') || entry.name.includes('/@vite/client'))
            .map((entry) => ({ name: entry.name, duration: entry.duration, transferSize: entry.transferSize })),
        })`),
        captured,
      });
      return {
        navigate,
        activate,
        diagnostics,
        close: async () => {
          sessionEvents.delete(sessionId);
          return send('Target.closeTarget', { targetId });
        },
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
        // Synthetic pointer gestures against Exact's shared pager recognizer.
        // Gesture meaning is region-scoped (ENG-23719), so callers pass the
        // start point: cy≈53 hits the sticky header, cy≈480 the board.
        swipe: (axis, delta, at = {}) => evalRaw(`(async () => {
          const root = document.getElementById('exact-root');
          const cx = ${at.cx ?? 195}, cy = ${at.cy ?? 480}, steps = 8;
          // Dispatch from the element under the start point (bubbles to the
          // root listener): the glue scopes gesture meaning by the pointerdown
          // target's region (header vs board), so target=root would misfile it.
          const origin = ${at.targetId ? `document.querySelector('[data-testid="${at.targetId}"]') ?? ` : ''}document.elementFromPoint(cx, cy) ?? root;
          const opts = (x, y, extra) => ({ bubbles: true, cancelable: true, pointerId: 7, isPrimary: true, button: 0, buttons: 1, clientX: x, clientY: y, pointerType: 'touch', ...extra });
          const pointAt = (i) => { const d = ${delta} * (i / steps); return '${axis}' === 'h' ? [cx + d, cy] : [cx, cy + d]; };
          origin.dispatchEvent(new PointerEvent('pointerdown', opts(cx, cy)));
          for (let i = 1; i <= steps; i++) { const [x, y] = pointAt(i); origin.dispatchEvent(new PointerEvent('pointermove', opts(x, y))); await new Promise(r => setTimeout(r, 16)); }
          const [x, y] = pointAt(steps);
          origin.dispatchEvent(new PointerEvent('pointerup', opts(x, y, { buttons: 0 })));
          await new Promise(r => setTimeout(r, 650));
        })()`),
        waitForTestId: (id) => evalRaw(`(async () => { const d = Date.now()+8000; while (Date.now()<d) { if (document.querySelector('${sel(id)}')) return true; await new Promise(r=>setTimeout(r,80)); } throw new Error('timeout waiting for ${id}'); })()`),
        evalPoll: async (expr, predicate, ms) => {
          const deadline = Date.now() + ms;
          let value;
          while (Date.now() < deadline) {
            value = await evalRaw(expr);
            if (predicate(value)) return value;
            await sleep(150);
          }
          return value;
        },
        // Poll a testId's text until it matches the pattern (or time out,
        // returning the last value for the caller's error message).
        pollText: (id, pattern, ms) => evalRaw(`(async () => { const d = Date.now()+${ms}; let v; while (Date.now()<d) { v = document.querySelector('${sel(id)}')?.textContent.trim() ?? null; if (v !== null && new RegExp(${JSON.stringify(pattern)}).test(v)) return v; await new Promise(r=>setTimeout(r,120)); } return v; })()`),
      };
    },
  };
}

await main();
