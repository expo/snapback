// LLP 0049 Phase 4: real-Cloudflare acceptance for the deployed All Aboard
// profile. Run against the deployed gateway origin:
//
//   SNAPBACK_PROOF_URL=https://snapback-all-aboard-proof.<sub>.workers.dev \
//   SNAPBACK_ADMIN_TOKEN=<token> \
//     node targets/cloudflare/test/acceptance.remote.all-aboard.mjs
//
// This drives the REAL deployment with the real kit client: cold start,
// same-origin static assets, seed, query, mutation, live update over a real
// hibernation WebSocket, live 511 refresh through the deploy-time secret
// path, directions key usage, demand-armed warm polling through the hardened
// alarm runner (a full 60s scheduled cycle), eviction surrogate, and
// key-redaction of every surfaced diagnostic. Expect ~3 minutes of runtime —
// most of it waiting out one real warm-poll cadence.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { SnapbackClient } from '../../../demos/_kit/client.mjs';
import { cloudflareClientOptions } from '../client-options.mjs';
import { classifyRouteEstimateOutcome } from './route-outage-witness.mjs';

const BASE = (process.env.SNAPBACK_PROOF_URL || '').replace(/\/$/, '');
const ADMIN_TOKEN = process.env.SNAPBACK_ADMIN_TOKEN || '';
if (!BASE || !ADMIN_TOKEN) {
  console.error('SNAPBACK_PROOF_URL and SNAPBACK_ADMIN_TOKEN are required');
  process.exit(2);
}
const seedBytes = fs.readFileSync(new URL('../../../demos/all-aboard/snapback/seed.json', import.meta.url));
const seed = JSON.parse(seedBytes.toString('utf8'));
const schemaManifest = JSON.parse(
  fs.readFileSync(new URL('../../../demos/all-aboard/snapback/generated/schema.manifest.json', import.meta.url), 'utf8')
);
const functionsManifest = JSON.parse(
  fs.readFileSync(new URL('../../../demos/all-aboard/snapback/generated/functions.manifest.json', import.meta.url), 'utf8')
);

const EXPECTED_CHECKS = 22;
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
  const client = new SnapbackClient(BASE, cloudflareClientOptions({ adminToken: ADMIN_TOKEN }));

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

  // --- native static discovery (ENG-23643) --------------------------------
  // Walk the exact chain the macOS Exact host walks when opening the deployed
  // URL: root HTML -> exact:platform-manifest link -> manifest -> mac
  // envelope -> startup source. A regression anywhere in this chain is the
  // white-screen failure mode.
  const manifestHref = (pageText.match(/<link[^>]*rel="exact:platform-manifest"[^>]*href="([^"]+)"/) || [])[1];
  check(
    'the served HTML carries the exact:platform-manifest discovery link',
    typeof manifestHref === 'string' && manifestHref.length > 0,
    manifestHref
  );
  const manifestResponse = await fetch(new URL(manifestHref, `${BASE}/`));
  const manifestType = manifestResponse.headers.get('content-type') || '';
  const platformManifest = manifestType.includes('json') ? await manifestResponse.json() : null;
  const macTarget = platformManifest?.targets?.find((target) => target.id === 'mac-appkit-hermes');
  const iosTarget = platformManifest?.targets?.find((target) => target.id === 'ios-uikit-hermes');
  check(
    'the platform manifest serves as JSON and declares macOS and iOS targets',
    manifestResponse.status === 200 &&
      platformManifest?.kind === 'exact-static-platform-manifest' &&
      Boolean(macTarget) &&
      Boolean(iosTarget),
    platformManifest?.buildId
  );

  async function loadNativeTarget(target) {
    const envelopeURL = new URL(target.envelopeUrl, manifestResponse.url);
    const envelopeResponse = await fetch(envelopeURL);
    const envelope = (envelopeResponse.headers.get('content-type') || '').includes('json')
      ? await envelopeResponse.json()
      : null;
    const startupResponse = envelope?.startup?.source?.url
      ? await fetch(new URL(envelope.startup.source.url, envelopeURL))
      : null;
    const startupType = startupResponse?.headers.get('content-type') || '';
    const startupBytes = startupResponse ? (await startupResponse.text()).length : 0;
    return { envelope, startupResponse, startupType, startupBytes };
  }

  const macNative = await loadNativeTarget(macTarget);
  const iosNative = await loadNativeTarget(iosTarget);
  const nativeOk = (native) =>
    native.envelope?.kind === 'exact-static-native-envelope' &&
    native.startupResponse !== null &&
    native.startupResponse.status === 200 &&
    /javascript/.test(native.startupType) &&
    native.startupBytes > 100_000;
  check(
    'the macOS and iOS native envelopes and startup sources load with native content types',
    nativeOk(macNative) && nativeOk(iosNative),
    `mac ${macNative.envelope?.startup?.source?.bytes} bytes, ios ${iosNative.envelope?.startup?.source?.bytes} bytes`
  );
  // Dev-server-only agent endpoints must fail as explicit JSON, never fall
  // back to the SPA index.html — the Exact Log Console previews the body, so
  // HTML here is the "Unexpected response (200): <!doctype html>" regression.
  const agentLogs = await fetch(`${BASE}/__exact/agent/logs`);
  const agentLogsType = agentLogs.headers.get('content-type') || '';
  check(
    'missing /__exact/ paths answer JSON 404, not the SPA HTML fallback',
    agentLogs.status === 404 && agentLogsType.includes('application/json'),
    `status ${agentLogs.status}, ${agentLogsType}`
  );

  // --- provisioning + config ---------------------------------------------
  const ensured = await client.ensureApp({ schema: schemaManifest, functions: functionsManifest, seed });
  check(
    'ensureApp seeds the fresh deployment (or attests the seeded state)',
    ensured.seed === 'seeded' || ensured.seed === 'skipped-nonempty',
    ensured.seed
  );
  const config = await (await fetch(`${BASE}/_snapback/api/config/status`, {
    headers: { 'x-snapback-admin-token': ADMIN_TOKEN },
  })).json();
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
  // The deployment is shared: real surfaces (an open browser tab, a native
  // host) may hold live demand of their own the whole run. Record it before
  // this suite subscribes, so the disarm check at the end asserts only what
  // the suite controls — that ITS demand is released (ENG-23643).
  const cronStatus = async () => (await (await fetch(`${BASE}/_snapback/api/cron/status`, {
    headers: { 'x-snapback-admin-token': ADMIN_TOKEN },
  })).json()).jobs[0];
  const baselineDemand = (await cronStatus()).activation.demand;
  const connectionId = `remote-${Date.now()}`;
  const live = await client.liveQuery('liveTrainStatus', { connectionId, transport: 'stream' });
  const feedLive = await client.liveQuery('feedState', { connectionId, transport: 'stream' });
  check('live subscribe over the deployed WebSocket returns the snapshot', live.rows.length === 6);
  const beforeMutation = live.version;
  await client.mutate('applyFeedTick', { args: { trigger: 'remote-acceptance', source: 'recorded' } });
  const mutationPush = Date.now() + 8000;
  while (live.version <= beforeMutation && Date.now() < mutationPush) await sleep(100);
  check('a mutation pushes a live update over the real socket', live.version > beforeMutation);

  // --- warm polling: armed by demand, one real scheduled cycle -------------
  // This section runs EARLY, while the suite's socket is young: at the 180s
  // cadence (ENG-23642) the committing scheduled run can be a full cycle
  // away, and a socket that has sat quiet for many minutes can go stale and
  // starve the push assertion (observed in the first Phase 4+budget runs).
  // resetFeed clears the upstream-poll budget so the NEXT alarm fire commits
  // instead of honestly skipping updated-recently; real 511 delays are often
  // unchanged between refreshes, so the guaranteed push is the
  // feedRefreshState freshness marker on the feedState subscription.
  await client.mutate('resetFeed', {});
  const feedBeforePoll = feedLive.version;
  const armed = await cronStatus();
  check(
    'an active live subscription arms the durable alarm (180s cadence, ENG-23642)',
    armed.activation.state === 'armed' && armed.everyMs === 180000 && armed.nextRun !== null
  );
  // The ledger's lastRun persists across suite runs (the eviction check below
  // depends on exactly that), so "a scheduled run exists" is not evidence —
  // require a run the baseline had not seen (ENG-23643). One cadence cycle
  // plus slack: the budget was just cleared, so the next fire commits.
  const baselineRunId = armed.lastRun?.runId ?? null;
  const pollDeadline = Date.now() + 240_000;
  let scheduledRun = null;
  for (;;) {
    const status = await cronStatus();
    if (status.lastRun && status.lastRun.trigger === 'scheduled' && status.lastRun.runId !== baselineRunId) {
      scheduledRun = status.lastRun;
    }
    if (scheduledRun !== null && feedLive.version > feedBeforePoll) break;
    if (Date.now() > pollDeadline) break;
    await sleep(2000);
  }
  check(
    'the scheduled warm poll ran through the hardened runner and recorded the ledger',
    scheduledRun !== null && scheduledRun.outcome === 'ok' && scheduledRun.durationMs > 0,
    scheduledRun ? `run ${scheduledRun.runId.slice(0, 8)}, ${scheduledRun.durationMs}ms` : 'no scheduled run within 240s'
  );
  check(
    'the warm poll pushed a live update to the subscriber',
    feedLive.version > feedBeforePoll && feedLive.rows[0].lastRunTrigger === 'cron'
  );

  // --- live 511 refresh through the secret path ---------------------------
  // ENG-23642: manual refresh rides the same 180s upstream-poll budget as the
  // warm poll. Against a lived-in deployment whose alarm polled recently, the
  // honest outcome is a denied claim ("updated recently") on top of a fresh
  // live snapshot — accept either a fresh commit or a budget-guarded reuse of
  // one, never a fallback.
  // This section is the decisive evidence that the real key + real 511 fetch
  // work, so clear the ENG-23642 upstream-poll budget first (a previous suite
  // run or the just-armed alarm may hold it — resetFeed zeroes
  // lastUpstreamPollAt without touching the seeded corridor). The budget
  // itself gets its own explicit check right after the committed refresh.
  await client.mutate('resetFeed', {});
  const refresh = await client.action('refreshFeed', { args: { trigger: 'manual' } });
  let feedState = await client.query('feedState', {});
  let feedRow = feedState.rows[0];
  const refreshCommitted = refresh.ok === true && refresh.result && refresh.result.source === '511-siri-stop-monitoring';
  const refreshDenied = refresh.ok === true && refresh.result && refresh.result.skipped === 'updated-recently';
  if (!refreshCommitted && refreshDenied && (feedRow.lastSource ?? '') !== '511-siri-stop-monitoring') {
    // The budget holder may be the alarm poll that armed seconds ago (the
    // suite's own live subscription arms it): the claim stamps
    // lastUpstreamPollAt transactionally BEFORE its 511 fetch commits, so a
    // denied manual refresh can land in that in-flight window. Give the
    // holder a moment to commit before judging.
    const commitDeadline = Date.now() + 20_000;
    while ((feedRow?.lastSource ?? '') !== '511-siri-stop-monitoring' && Date.now() < commitDeadline) {
      await sleep(1000);
      feedState = await client.query('feedState', {});
      feedRow = feedState.rows[0];
    }
  }
  const refreshBudgeted =
    refreshDenied &&
    feedRow.lastSource === '511-siri-stop-monitoring' &&
    Date.now() - feedRow.fetchedAt <= Number(feedRow.staleAfterMs || 390_000);
  const liveWorked = (refreshCommitted || refreshBudgeted) && feedRow.lastSource === '511-siri-stop-monitoring';
  check(
    'live 511 refresh commits through applyLiveFeedSnapshot with the real key (or budget-guards a fresh live snapshot)',
    liveWorked,
    refreshCommitted
      ? refresh.result.note
      : refreshBudgeted
        ? `budget-guarded: retry in ${refresh.result.retryInMs}ms against a fresh snapshot`
        : `fell back: ${feedRow.lastError}`
  );
  const liveDepartures = await client.query('liveDepartures', {});
  // Outside Caltrain service hours (nights, early weekend mornings) the real
  // upstream legitimately reports ZERO monitored visits, so an honest live
  // commit writes zero departure rows — that is the timetable, not a failure
  // of the live path the previous check just proved. Soft-pass that window,
  // and only that window. The zero-service determination is deliberately
  // narrow and fails closed: the refresh must have gone through the live path
  // (liveWorked pins lastSource to '511-siri-stop-monitoring', so fallbacks
  // and fetch failures never reach it), the board must hold zero rows, and
  // either the committed refresh's own mechanical note reports 0 visits
  // ("mapped 0 departures from 0 511 visits" — refresh.result carries no
  // structured count today, and the deployed app predates any such field, so
  // parse the note and treat a non-matching note as NOT zero-service) or, for
  // a budget-guarded reuse of another poll's commit (which has no note), the
  // committed row carries no mapping error — the handler records an explicit
  // lastError exactly when visits > 0 mapped to zero departures. Whenever
  // visits > 0, the future-departure assertion below stays fully enforced.
  const noteVisits = refreshCommitted
    ? Number((String(refresh.result.note || '').match(/^mapped \d+ departures from (\d+) 511 visits$/) || [])[1])
    : NaN;
  const zeroServiceWindow =
    liveWorked &&
    liveDepartures.rows.length === 0 &&
    (refreshCommitted ? noteVisits === 0 : refreshBudgeted && (feedRow.lastError ?? '') === '');
  check(
    'live 511 refresh writes real future departure rows',
    liveWorked &&
      (zeroServiceWindow ||
        (liveDepartures.rows.length > 0 && liveDepartures.rows.some((row) => row.predictedDepartureMs > Date.now()))),
    zeroServiceWindow
      ? 'skipped-no-service: 0 monitored 511 visits (outside service hours), live path proven by the refresh commit check'
      : `${liveDepartures.rows.length} liveDepartures rows`
  );
  check(
    'surfaced diagnostics stay key-redacted',
    !leaksKey(JSON.stringify([refresh, feedState.rows[0], liveDepartures.rows, config]))
  );
  // ENG-23642: a second refresh straight after the committed one must be
  // answered from the committed snapshot ("updated recently"), not another
  // upstream 511 poll — the transactional budget covers manual Refresh too.
  const secondRefresh = await client.action('refreshFeed', { args: { trigger: 'manual' } });
  const feedAfterSecond = await client.query('feedState', {});
  check(
    'a second refresh inside the 180s budget answers updated-recently without touching upstream',
    secondRefresh.ok === true &&
      secondRefresh.result &&
      secondRefresh.result.skipped === 'updated-recently' &&
      Number(secondRefresh.result.retryInMs) > 0 &&
      feedAfterSecond.rows[0].lastSource === '511-siri-stop-monitoring' &&
      feedAfterSecond.rows[0].fetchedAt === feedRow.fetchedAt,
    secondRefresh.result && secondRefresh.result.retryInMs ? `retry in ${secondRefresh.result.retryInMs}ms` : JSON.stringify(secondRefresh.result)
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
    if (route.ok === true && route.result?.source === 'openrouteservice') break;
  }
  // An action-timeout envelope is ok:false with a diagnostic and NO result
  // (observed live during an ORS outage, 2026-07-25): the detail must not
  // dereference result unconditionally or the suite crashes with a TypeError
  // instead of failing this check cleanly.
  //
  // Author decision (2026-08-01, finding 2 of the outage-fragility ticket):
  // when the worker's own egress PROVES OpenRouteService itself is down —
  // the fallback carrying an upstream 5xx from the ORS host, with the
  // directions key already config-attested as set by the earlier suite-fatal
  // check — record the outage and skip instead of hard-failing the suite.
  // Our-side failures (4xx from ORS) and ambiguous results (timeouts,
  // transport errors, non-ORS 5xx) still hard-fail: a fallback result proves
  // nothing about the directions key, so there is no soft-pass here — the
  // skip is a recorded outage, never evidence.
  const routeOutcome = classifyRouteEstimateOutcome(route, {
    directionsKeyAttested: dirDecl.state === 'set',
  });
  if (routeOutcome.verdict === 'skip-provider-outage') {
    checks += 1;
    evidence.push({
      label: 'directions key usage returns a live route estimate',
      detail: routeOutcome.witness,
      skipped: 'provider-outage',
    });
    console.log(`ok ${checks} - directions key usage returns a live route estimate # SKIP ${routeOutcome.witness}`);
  } else {
    check(
      'directions key usage returns a live route estimate',
      routeOutcome.verdict === 'pass',
      routeOutcome.witness
    );
  }

  // --- eviction surrogate + rehydration ------------------------------------
  const evict = await fetch(`${BASE}/_snapback/api/object/evict`, { method: 'POST', headers: { 'x-snapback-admin-token': ADMIN_TOKEN } });
  const postEvict = await cronStatus();
  check(
    'the eviction surrogate preserves activation, armed alarm, and ledger',
    evict.status === 200 && postEvict.activation.state === 'armed' && postEvict.lastRun !== null
  );

  // --- last-unsubscribe: the suite's demand is released ---------------------
  // The deployment is shared, and real surfaces (a browser tab, a native
  // host) can attach at ANY point during this multi-minute run — the pre-run
  // baseline alone cannot distinguish "the suite leaked demand" from "a
  // visitor arrived mid-run" (ENG-23740). So assert only what the suite
  // controls: read demand immediately before dispose and require it to
  // DROP once the suite's connection closes. Only when demand actually
  // drains to zero do we additionally require the idle deployment to arm
  // zero warm-poll wakeups (inactive + no scheduled run); demand that
  // survives belongs to a live external subscriber and legitimately keeps
  // the alarm armed.
  const preDisposeDemand = (await cronStatus()).activation.demand;
  live.dispose();
  feedLive.dispose();
  client.liveStreamManager(connectionId).close();
  const disarmDeadline = Date.now() + 15_000;
  const suiteDemandReleased = (status) =>
    status.activation.demand === 0
      ? status.activation.state === 'inactive:no-demand' && status.nextRun === null
      : status.activation.demand < preDisposeDemand;
  let disarmed = null;
  for (;;) {
    disarmed = await cronStatus();
    if (suiteDemandReleased(disarmed)) break;
    if (Date.now() > disarmDeadline) break;
    await sleep(500);
  }
  check(
    'losing the suite subscriber releases its warm-poll demand (zero armed wakeups once idle)',
    suiteDemandReleased(disarmed),
    disarmed.activation.demand > 0
      ? `demand drained ${preDisposeDemand} -> ${disarmed.activation.demand} ` +
        `(pre-suite baseline ${baselineDemand}); surviving external demand keeps the alarm armed`
      : 'disarmed (zero demand, no scheduled wakeup)'
  );

  if (checks !== EXPECTED_CHECKS) {
    throw new Error(`expected ${EXPECTED_CHECKS} checks, ran ${checks}`);
  }
  console.log(`\nremote all-aboard acceptance against ${BASE}: ${checks}/${EXPECTED_CHECKS} checks passed`);
  console.log(JSON.stringify({ base: BASE, coldStartMs: coldMs, evidence }, null, 2));
  const dataIdentity = `sha256:${createHash('sha256').update(JSON.stringify({
    appId: schemaManifest.appId,
    configGeneration: config.generation,
    liveVersion: live.version,
    feedVersion: feedLive.version,
    scheduledRunId: scheduledRun?.runId ?? null,
  })).digest('hex')}`;
  // The final single line is the bounded machine contract consumed by
  // defineCloudflareVerifyProfile. Human TAP-like output above is not proof.
  // @ref LLP 0146#d2-snapback-verify--the-done-oracle — bind remote
  // acceptance to the admitted artifact and observed target/data identity.
  console.log(JSON.stringify({
    schemaVersion: 'snapback.cloudflare-acceptance.v1',
    status: evidence.some(({ skipped }) => skipped) ? 'passed-with-nonclaims' : 'passed',
    expectedCheckCount: EXPECTED_CHECKS,
    executedCheckCount: checks,
    checks: evidence.map(({ label, detail, skipped }) => ({
      label,
      detail,
      status: skipped ? 'skipped' : 'passed',
    })),
    target: {
      origin: BASE,
      platformBuildId: platformManifest.buildId,
      configGeneration: config.generation,
    },
    artifact: {
      appId: schemaManifest.appId,
      schemaHash: schemaManifest.schemaHash,
      bundleHash: functionsManifest.bundleHash,
    },
    dataIdentity,
    seedIdentity: `sha256:${createHash('sha256').update(seedBytes).digest('hex')}`,
    diagnostic: null,
  }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
