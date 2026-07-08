// LLP 0049 Phase 4: real-Cloudflare acceptance for the deployed All Aboard
// profile. Run against the deployed gateway origin:
//
//   SNAPBACK_PROOF_URL=https://snapback-all-aboard-proof.<sub>.workers.dev \
//   SNAPBACK_ADMIN_TOKEN=<token> \
//     node cloudflare/test/acceptance.remote.all-aboard.mjs
//
// This drives the REAL deployment with the real kit client: cold start,
// same-origin static assets, seed, query, mutation, live update over a real
// hibernation WebSocket, live 511 refresh through the deploy-time secret
// path, directions key usage, demand-armed warm polling through the hardened
// alarm runner (a full 60s scheduled cycle), eviction surrogate, and
// key-redaction of every surfaced diagnostic. Expect ~3 minutes of runtime —
// most of it waiting out one real warm-poll cadence.
import fs from 'node:fs';
import { SnapbackClient } from '../../demos/_kit/client.mjs';

const BASE = (process.env.SNAPBACK_PROOF_URL || '').replace(/\/$/, '');
const ADMIN_TOKEN = process.env.SNAPBACK_ADMIN_TOKEN || '';
if (!BASE || !ADMIN_TOKEN) {
  console.error('SNAPBACK_PROOF_URL and SNAPBACK_ADMIN_TOKEN are required');
  process.exit(2);
}
const seed = JSON.parse(fs.readFileSync(new URL('../../demos/all-aboard/snapback/seed.json', import.meta.url), 'utf8'));

const EXPECTED_CHECKS = 16;
let checks = 0;
const evidence = [];
function check(label, condition, detail) {
  checks += 1;
  if (!condition) {
    throw new Error(`REMOTE ACCEPTANCE FAILED [${label}]${detail ? ` — ${detail}` : ''}`);
  }
  evidence.push({ label, detail: detail ?? null });
  console.log(`ok ${checks} - ${label}${detail ? ` (${detail})` : ''}`);
}
// A surfaced diagnostic must never carry a plausible key: api_key= must only
// ever be followed by the redaction marker.
function leaksKey(text) {
  return /api_key=(?!\[redacted\])[^&\s"']{8,}/.test(String(text));
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const client = new SnapbackClient(BASE, { adminToken: ADMIN_TOKEN });

  // --- cold start + static assets ----------------------------------------
  const t0 = Date.now();
  const health = await client.health();
  const coldMs = Date.now() - t0;
  check('cold-start health from the deployed gateway', health.ok === true, `${coldMs}ms`);
  const page = await fetch(`${BASE}/`);
  const pageText = await page.text();
  check(
    'the gateway serves the Contract web bundle same-origin',
    page.status === 200 && /text\/html/.test(page.headers.get('content-type') || '') && /All Aboard/.test(pageText)
  );
  const assetPath = (pageText.match(/\/assets\/[A-Za-z0-9._-]+\.js/) || [])[0];
  const asset = assetPath ? await fetch(`${BASE}${assetPath}`) : null;
  check('the built asset graph loads from the same origin', asset !== null && asset.status === 200);

  // --- provisioning + config ---------------------------------------------
  const ensured = await client.ensureApp({ seed });
  check(
    'ensureApp seeds the fresh deployment (or attests the seeded state)',
    ensured.seed === 'seeded' || ensured.seed === 'skipped-nonempty',
    ensured.seed
  );
  const config = await (await fetch(`${BASE}/config/status`)).json();
  const feedDecl = config.declarations.find((entry) => entry.name === 'caltrainFeed');
  const dirDecl = config.declarations.find((entry) => entry.name === 'directions');
  check(
    'deploy-time secrets are configured and attested (generation >= 1, both entries set)',
    config.generation >= 1 && feedDecl.state === 'set' && feedDecl.poolMembers >= 1 && dirDecl.state === 'set',
    `generation ${config.generation}, pool ${feedDecl.poolMembers}`
  );

  // --- query + live + mutation over the real socket -----------------------
  const stations = await client.query('stationsQuery', {});
  check('queries serve the seeded corridor', stations.rows.length === 21);
  const connectionId = `remote-${Date.now()}`;
  const live = await client.liveQuery('liveTrainStatus', { connectionId, transport: 'stream' });
  const feedLive = await client.liveQuery('feedState', { connectionId, transport: 'stream' });
  check('live subscribe over the deployed WebSocket returns the snapshot', live.rows.length === 6);
  const beforeMutation = live.version;
  await client.mutate('applyFeedTick', { args: { trigger: 'remote-acceptance', source: 'recorded' } });
  const mutationPush = Date.now() + 8000;
  while (live.version <= beforeMutation && Date.now() < mutationPush) await sleep(100);
  check('a mutation pushes a live update over the real socket', live.version > beforeMutation);

  // --- live 511 refresh through the secret path ---------------------------
  const refresh = await client.action('refreshFeed', { args: { trigger: 'manual' } });
  const feedState = await client.query('feedState', {});
  const liveWorked = refresh.ok === true && refresh.result && refresh.result.source === '511-siri-stop-monitoring';
  check(
    'live 511 refresh commits through applyLiveFeedSnapshot with the real key',
    liveWorked && feedState.rows[0].lastSource === '511-siri-stop-monitoring',
    liveWorked ? refresh.result.note : `fell back: ${feedState.rows[0].lastError}`
  );
  check(
    'surfaced diagnostics stay key-redacted',
    !leaksKey(JSON.stringify([refresh, feedState.rows[0], config]))
  );

  // --- directions key usage ------------------------------------------------
  // OpenRouteService's first request from a fresh Cloudflare colo can exceed
  // the 15s per-attempt budget (observed in the Phase 4 runs), so one retry
  // is allowed; the evidence needed is A successful live estimate through
  // the header placement slot, not first-attempt latency.
  let route = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    route = await client.action('routeEstimate', {
      args: { fromLat: 37.7764, fromLng: -122.3947, toLat: 37.4443, toLng: -122.1637, mode: 'walk' },
    });
    if (route.ok === true && route.result.source === 'openrouteservice') break;
  }
  check(
    'directions key usage returns a live route estimate',
    route.ok === true && route.result.source === 'openrouteservice' && route.result.minutes > 0,
    `${route.result.source}, ${route.result.minutes}min`
  );

  // --- warm polling: armed by demand, one real scheduled cycle -------------
  const cronStatus = async () => (await (await fetch(`${BASE}/cron/status`)).json()).jobs[0];
  const armed = await cronStatus();
  check(
    'an active live subscription arms the durable alarm (60s cadence)',
    armed.activation.state === 'armed' && armed.everyMs === 60000 && armed.nextRun !== null
  );
  // Real 511 delays are often unchanged between refreshes, making the
  // trainStatus patches commit no-ops — the always-changing row is the
  // feedRefreshState freshness marker (fetchedAt), so the guaranteed push
  // arrives on the feedState subscription.
  const feedBeforePoll = feedLive.version;
  const pollDeadline = Date.now() + 150_000;
  let scheduledRun = null;
  for (;;) {
    const status = await cronStatus();
    if (status.lastRun && status.lastRun.trigger === 'scheduled') {
      scheduledRun = status.lastRun;
      break;
    }
    if (Date.now() > pollDeadline) break;
    await sleep(2000);
  }
  check(
    'the scheduled warm poll ran through the hardened runner and recorded the ledger',
    scheduledRun !== null && scheduledRun.outcome === 'ok' && scheduledRun.durationMs > 0,
    scheduledRun ? `run ${scheduledRun.runId.slice(0, 8)}, ${scheduledRun.durationMs}ms` : 'no scheduled run within 150s'
  );
  const pollPush = Date.now() + 10_000;
  while (feedLive.version <= feedBeforePoll && Date.now() < pollPush) await sleep(200);
  check(
    'the warm poll pushed a live update to the subscriber',
    feedLive.version > feedBeforePoll && feedLive.rows[0].lastRunTrigger === 'cron'
  );

  // --- eviction surrogate + rehydration ------------------------------------
  const evict = await fetch(`${BASE}/evict`, { method: 'POST', headers: { 'x-snapback-admin-token': ADMIN_TOKEN } });
  const postEvict = await cronStatus();
  check(
    'the eviction surrogate preserves activation, armed alarm, and ledger',
    evict.status === 200 && postEvict.activation.state === 'armed' && postEvict.lastRun !== null
  );

  // --- last-unsubscribe: idle means zero armed wakeups ----------------------
  live.dispose();
  feedLive.dispose();
  client.liveStreamManager(connectionId).close();
  const disarmDeadline = Date.now() + 15_000;
  let disarmed = null;
  for (;;) {
    disarmed = await cronStatus();
    if (disarmed.activation.state === 'inactive:no-demand') break;
    if (Date.now() > disarmDeadline) break;
    await sleep(500);
  }
  check(
    'losing the last subscriber cancels the alarm — the idle deployment arms zero warm-poll wakeups',
    disarmed.activation.state === 'inactive:no-demand' && disarmed.nextRun === null
  );

  if (checks !== EXPECTED_CHECKS) {
    throw new Error(`expected ${EXPECTED_CHECKS} checks, ran ${checks}`);
  }
  console.log(`\nremote all-aboard acceptance against ${BASE}: ${checks}/${EXPECTED_CHECKS} checks passed`);
  console.log(JSON.stringify({ base: BASE, coldStartMs: coldMs, evidence }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
