// Real-Cloudflare acceptance + measurement runner for the LLP 0040 proof.
//
// This is the suite that produces the RFC's DECISIVE evidence, which Miniflare
// cannot (§Measurements evidence split): real eviction of the coordinator
// object, hibernation billing counters over the two idle windows, cold-start
// latency, and placement. Point it at a deployed gateway:
//
//   SNAPBACK_PROOF_URL=https://snapback-notes-proof.<subdomain>.workers.dev \
//     node targets/cloudflare/test/acceptance.remote.mjs
//
// It reuses the same assertions as the Miniflare suite for the behavioral
// checklist, then adds the deploy-only measurements. Billing counters are read
// from the Cloudflare GraphQL analytics API (billing-windows.mjs) when
// CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are set; otherwise it records
// the raw idle-window timing and flags the billing read as skipped so the
// report never implies billing evidence it does not have. Analytics
// attribution lags ingestion by minutes, so the in-run counters may read low —
// re-run billing-windows.mjs over the reported idle window afterwards for the
// settled numbers.
//
// Eviction legs: POST /_snapback/api/object/evict forces an in-place discard of coordinator
// in-memory state (the guaranteed leg), and the runner also compares the
// /health objectBoot marker across the idle window — when Cloudflare
// genuinely evicted the hibernating object the marker changes and the run
// records a REAL platform eviction + rehydration in
// `platformEvictionObserved` (a report field, not a pass/fail check: platform
// eviction timing is not deterministic inside a bounded window).
//
// First real-Cloudflare run: 2026-07-08 (ENG-23640) — the expired-token era
// ended with ENG-23632; results live in LLP 0040 §As-built and diary 0012.

import { readBillingWindow, summarizeBillingWindow } from './billing-windows.mjs';

const base = process.env.SNAPBACK_PROOF_URL;
if (!base) {
  console.error('set SNAPBACK_PROOF_URL to the deployed gateway origin');
  process.exit(2);
}

const results = [];
const EXPECTED_CHECKS = 11;
function check(name, condition, detail) {
  results.push({ name, ok: !!condition, detail: condition ? undefined : detail });
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${condition ? '' : ` — ${detail ?? ''}`}`);
}

const adminToken = process.env.SNAPBACK_ADMIN_TOKEN || '';

async function post(path, body) {
  const headers = { 'content-type': 'application/json' };
  // Admin operations and non-public app-data calls share the operator token
  // on this hosted-auth-unavailable proof target.
  if (
    path === '/_snapback/api/app/reset'
    || path === '/_snapback/api/object/evict'
    || /^\/(?:query|mutation|action)(?:\/|$)/u.test(path)
  ) {
    if (!adminToken) {
      console.error('set SNAPBACK_ADMIN_TOKEN to drive non-public app data and admin endpoints on a real deploy');
      process.exit(2);
    }
    headers['x-snapback-admin-token'] = adminToken;
  }
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {}),
  });
  return response.json();
}

async function get(path) {
  const response = await fetch(`${base}${path}`);
  return response.json();
}

function openSocket(path) {
  return new Promise((resolve, reject) => {
    const url = base.replace(/^http/, 'ws') + path;
    const ws = new WebSocket(url);
    const queue = [];
    const waiters = [];
    function deliver(message) {
      const index = waiters.findIndex((waiter) => waiter.type === message.type);
      if (index < 0) {
        queue.push(message);
        return;
      }
      const [waiter] = waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    }
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      deliver(message);
    });
    ws.addEventListener('open', () =>
      resolve({
        send: (value) => ws.send(JSON.stringify(value)),
        waitFor: (type, timeoutMs = 8000) => {
          const index = queue.findIndex((message) => message.type === type);
          if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
          return new Promise((resolveFrame, rejectFrame) => {
            const waiter = {
              type,
              resolve: resolveFrame,
              timer: setTimeout(() => {
                const waiterIndex = waiters.indexOf(waiter);
                if (waiterIndex >= 0) waiters.splice(waiterIndex, 1);
                rejectFrame(new Error(`timeout waiting for ${type}`));
              }, timeoutMs),
            };
            waiters.push(waiter);
          });
        },
        close: () => ws.close(),
      })
    );
    ws.addEventListener('error', reject);
  });
}

async function main() {
  await post('/_snapback/api/app/reset');
  const manifest = await get('/inspect');
  check('capability manifest served', manifest.targetProfileId === 'cloudflare-do-sqlite-v8', JSON.stringify(manifest.targetProfileId));
  check('capability manifest does not claim deployed auth impersonation',
    manifest.authImpersonation === false, JSON.stringify(manifest.authImpersonation));
  check('capability manifest reports coordinator-serialized mutation isolation',
    manifest.mutationIsolationMode === 'coordinator-serialized-invocations', JSON.stringify(manifest.mutationIsolationMode));

  // Cold start: first request after a quiet window (best-effort — a truly cold
  // object requires the idle window below to have elapsed first).
  const coldStart = performance.now();
  const health = await get('/health');
  const coldStartMs = Math.round(performance.now() - coldStart);
  check('cold-start first request returns', true, `${coldStartMs}ms`);
  const bootBeforeIdle = health.objectBoot ?? null;

  const mutation = await post('/mutation', { name: 'addNote', args: { boardId: 'b1', text: 'real deploy' } });
  check('V8 mutation commits on real Cloudflare', mutation.ok && mutation.version >= 1, JSON.stringify(mutation));

  const socket = await openSocket('/live/stream');
  socket.send({ type: 'subscribe', name: 'listNotes', args: { boardId: 'b1' } });
  const snapshot = await socket.waitFor('snapshot');
  check('authoritative snapshot before delta', snapshot.rows.length === 1, JSON.stringify(snapshot));
  await post('/mutation', { name: 'addNote', args: { boardId: 'b1', text: 'live' } });
  const delta = await socket.waitFor('live_replace');
  check('live delta delivered from commit', delta.rows.some((r) => r.text === 'live'), JSON.stringify(delta));

  const denial = await post('/query', { name: 'probeAmbient', args: {} });
  const reachable = denial.ok ? denial.rows.filter((r) => r.reachable).map((r) => r.name) : ['<failed>'];
  check('deployed handler denies ambient + host reach-through', reachable.length === 0, JSON.stringify(reachable));

  // Eviction leg (LLP 0040 §Acceptance): discard the coordinator's in-memory
  // state on the real deployment while the subscriber stays connected, then
  // prove a committed mutation still reaches it — subscription rehydration
  // from persisted rows, tested rather than assumed.
  await post('/_snapback/api/object/evict');
  await post('/mutation', { name: 'addNote', args: { boardId: 'b1', text: 'after evict' } });
  const afterEvict = await socket.waitFor('live_replace');
  check('post-eviction commit reaches the still-connected subscriber',
    afterEvict.rows.some((r) => r.text === 'after evict'), JSON.stringify(afterEvict));

  // Idle window with a connected hibernating subscriber: hold the socket open
  // and quiet for the window, then confirm a commit still wakes it. Billing
  // counters over this window are the decisive scale-to-zero evidence and must
  // be read from the analytics API (below) to count.
  const idleMs = Number(process.env.SNAPBACK_IDLE_WINDOW_MS || 60000);
  console.log(`  … holding a connected-idle window for ${idleMs}ms (hibernation)`);
  const idleStartISO = new Date().toISOString();
  await new Promise((r) => setTimeout(r, idleMs));
  const idleEndISO = new Date().toISOString();
  // /health first: it records whether the platform genuinely evicted the
  // hibernating object during the window (objectBoot changed) BEFORE the wake
  // mutation re-instantiates anything.
  const healthAfterIdle = await get('/health');
  const bootAfterIdle = healthAfterIdle.objectBoot ?? null;
  const platformEvictionObserved =
    bootBeforeIdle != null && bootAfterIdle != null && bootBeforeIdle !== bootAfterIdle;
  console.log(`  … objectBoot ${bootBeforeIdle} -> ${bootAfterIdle} (${platformEvictionObserved ? 'REAL platform eviction during the idle window' : 'no platform eviction within this window'})`);
  await post('/mutation', { name: 'addNote', args: { boardId: 'b1', text: 'after idle' } });
  const afterIdle = await socket.waitFor('live_replace');
  check('a commit wakes the hibernated subscriber after the idle window',
    afterIdle.rows.some((r) => r.text === 'after idle'), JSON.stringify(afterIdle));
  socket.close();

  // Billing counters over the connected-idle window, read from the analytics
  // API. Attribution can lag a few minutes behind the window itself, so the
  // report carries the window bounds for a settled re-read via
  // billing-windows.mjs.
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const gatewayScript = new URL(base).hostname.split('.')[0];
  const scripts = [gatewayScript, gatewayScript.replace(/-proof$/, '-handler')];
  let idleBilling = null;
  if (accountId && apiToken) {
    const read = await readBillingWindow({
      accountId,
      apiToken,
      scripts,
      startISO: idleStartISO,
      endISO: idleEndISO,
    });
    idleBilling = { window: read.window, summary: summarizeBillingWindow(read) };
    check('billing/usage counters read for the idle windows (analytics API)',
      read.errors.length === 0, JSON.stringify(read.errors));
  } else {
    check('billing/usage counters read for the idle windows (analytics API)', false,
      'SKIPPED: set CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID to read GB-s/requests over the idle windows');
  }

  const passed = results.filter((r) => r.ok).length;
  const shortfall = results.length === 0
    ? 'zero checks ran'
    : results.length !== EXPECTED_CHECKS
      ? `ran ${results.length}/${EXPECTED_CHECKS} expected checks`
      : null;
  const report = {
    title: 'LLP 0040 Cloudflare narrow proof — REAL Cloudflare acceptance',
    surface: 'real-cloudflare',
    origin: base,
    passed,
    total: results.length,
    expectedChecks: EXPECTED_CHECKS,
    ok: passed === results.length && shortfall === null,
    coldStartMs,
    connectedIdleWindow: { start: idleStartISO, end: idleEndISO, idleMs },
    objectBoot: { beforeIdle: bootBeforeIdle, afterIdle: bootAfterIdle },
    platformEvictionObserved,
    billingCountersRead: !!idleBilling,
    idleBilling,
    results,
  };
  if (shortfall) report.shortfall = shortfall;
  console.log('\n--- machine-readable report ---');
  console.log(JSON.stringify(report));
  process.exit(report.ok ? 0 : 1);
}

main().catch((error) => {
  console.error('remote acceptance crashed:', error);
  process.exit(2);
});
