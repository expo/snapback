// LLP 0040 §Measurements — the REAL-Cloudflare percentile benchmark runner
// (ENG-23713). Where measure.mjs records Miniflare-local regression numbers,
// this runner produces the deploy-only latency distributions the accepted
// proof requires: remote mutation / initial-snapshot / live-update /
// reconnect-resubscribe percentiles, the maximum-practical-subscribers ladder
// for the supported query shape, and the storage/overload contention probes —
// every number next to its benchmark fixture, timed at the client
// (§Measurements: same-turn synchronous deltas inside the object are not
// valid measurements; client-side timing is).
//
//   SNAPBACK_PROOF_URL=https://snapback-notes-proof.<subdomain>.workers.dev \
//     node targets/cloudflare/test/measure.remote.mjs > report.json
//
// Fixture posture: the runner writes to fresh per-run boards
// (`bench-<runId>` etc.) and leaves the deployed fixture's other boards
// untouched. Hosted auth is unavailable on this proof target, so non-public
// mutations require SNAPBACK_ADMIN_TOKEN. The runner also /reset-cleans the
// database first and records that fact in the report.
//
// Results land in the Research LLP that reports them (LLP 0050); the
// machine-readable artifact is checked in under targets/cloudflare/generated/.

const base = process.env.SNAPBACK_PROOF_URL;
if (!base) {
  console.error('set SNAPBACK_PROOF_URL to the deployed gateway origin');
  process.exit(2);
}

const adminToken = process.env.SNAPBACK_ADMIN_TOKEN || '';
if (!adminToken) {
  console.error('set SNAPBACK_ADMIN_TOKEN to benchmark non-public app-data calls on the real deploy');
  process.exit(2);
}
const runId = process.env.SNAPBACK_BENCH_RUN_ID || Math.random().toString(36).slice(2, 8);
const clientLocation = process.env.SNAPBACK_BENCH_CLIENT_LOCATION || 'unstated';

const N_HEALTH = num('SNAPBACK_BENCH_N_HEALTH', 30);
const N_MUTATION = num('SNAPBACK_BENCH_N_MUTATION', 100);
const N_SNAPSHOT = num('SNAPBACK_BENCH_N_SNAPSHOT', 50);
const N_LIVE = num('SNAPBACK_BENCH_N_LIVE', 50);
const N_RECONNECT = num('SNAPBACK_BENCH_N_RECONNECT', 30);
const FANOUT_RUNGS = (process.env.SNAPBACK_BENCH_FANOUT_RUNGS || '1,10,25,50,100,200,400')
  .split(',')
  .map((v) => Number(v))
  .filter((v) => Number.isFinite(v) && v > 0);
const BURST = num('SNAPBACK_BENCH_BURST', 32);
const DELIVERY_TIMEOUT_MS = num('SNAPBACK_BENCH_DELIVERY_TIMEOUT_MS', 30000);
// Max-practical criterion, stated up front so the number is reproducible:
// the largest rung with zero connect/subscribe/delivery failures AND
// per-socket delivery p95 under this bound.
const PRACTICAL_P95_MS = num('SNAPBACK_BENCH_PRACTICAL_P95_MS', 2000);

function num(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (rank - lower);
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((t, v) => t + v, 0);
  return {
    n: sorted.length,
    meanMs: round(sorted.length ? sum / sorted.length : null),
    p50Ms: round(percentile(sorted, 50)),
    p90Ms: round(percentile(sorted, 90)),
    p95Ms: round(percentile(sorted, 95)),
    p99Ms: round(percentile(sorted, 99)),
    minMs: round(sorted[0] ?? null),
    maxMs: round(sorted[sorted.length - 1] ?? null),
  };
}

function round(value) {
  return value == null ? null : Math.round(value * 100) / 100;
}

let observedColo = null;
async function post(path, body) {
  const headers = { 'content-type': 'application/json' };
  if (
    path === '/_snapback/api/app/reset'
    || path === '/_snapback/api/object/evict'
    || /^\/(?:query|mutation|action)(?:\/|$)/u.test(path)
  ) {
    headers['x-snapback-admin-token'] = adminToken;
  }
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {}),
  });
  captureColo(response);
  return response.json();
}

async function get(path) {
  const response = await fetch(`${base}${path}`);
  captureColo(response);
  return response.json();
}

function captureColo(response) {
  const ray = response.headers.get('cf-ray');
  if (ray && ray.includes('-')) observedColo = ray.split('-').pop();
}

// Same waiter shape as acceptance.remote.mjs, plus connect timing.
function openSocket(path) {
  const url = base.replace(/^http/, 'ws') + path;
  const startedAt = performance.now();
  return new Promise((resolve, reject) => {
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
    ws.addEventListener('message', (event) => deliver(JSON.parse(event.data)));
    ws.addEventListener('open', () =>
      resolve({
        connectMs: performance.now() - startedAt,
        send: (value) => ws.send(JSON.stringify(value)),
        waitFor: (type, timeoutMs = 10000) => {
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
    ws.addEventListener('error', (event) => reject(event.error ?? new Error('websocket error')));
  });
}

async function mapConcurrent(count, limit, worker) {
  const results = new Array(count);
  let next = 0;
  async function lane() {
    while (next < count) {
      const index = next++;
      results[index] = await worker(index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, count) }, lane));
  return results;
}

async function main() {
  const measurements = [];
  const startedAtISO = new Date().toISOString();

  const reset = await post('/_snapback/api/app/reset');
  const resetApplied = reset.ok === true;

  const health = await get('/health');
  if (health.ok !== true) {
    console.error('deployment unhealthy:', JSON.stringify(health));
    process.exit(2);
  }

  // -- HTTP round-trip baseline (network floor for every number below) ------
  const healthSamples = [];
  for (let i = 0; i < N_HEALTH; i++) {
    const start = performance.now();
    await get('/health');
    healthSamples.push(performance.now() - start);
  }
  measurements.push({
    metric: 'http_health_roundtrip',
    fixture: { path: 'GET /health', note: 'network + gateway floor; no coordinator storage touch' },
    ...stats(healthSamples),
  });

  // -- mutation latency ------------------------------------------------------
  const benchBoard = `bench-${runId}`;
  const mutationSamples = [];
  const mutationVersions = [];
  for (let i = 0; i < N_MUTATION; i++) {
    const start = performance.now();
    const result = await post('/mutation', { name: 'addNote', args: { boardId: benchBoard, text: `note ${i}` } });
    mutationSamples.push(performance.now() - start);
    if (!result.ok) throw new Error(`mutation ${i} failed: ${JSON.stringify(result)}`);
    mutationVersions.push(result.version);
  }
  measurements.push({
    metric: 'mutation_latency',
    fixture: {
      handler: 'addNote (V8, one insert)',
      boardId: benchBoard,
      writeRatePerCall: 1,
      rowsWritten: 1,
      sequential: true,
    },
    ...stats(mutationSamples),
  });

  // -- initial snapshot latency (fixed, stated snapshot size) ---------------
  const snapshotRows = (await post('/query', { name: 'listNotes', args: { boardId: benchBoard } })).rows.length;
  const snapshotSamples = [];
  for (let i = 0; i < N_SNAPSHOT; i++) {
    const socket = await openSocket('/live/stream');
    const start = performance.now();
    socket.send({ type: 'subscribe', name: 'listNotes', args: { boardId: benchBoard } });
    await socket.waitFor('snapshot');
    snapshotSamples.push(performance.now() - start);
    socket.close();
  }
  measurements.push({
    metric: 'initial_snapshot_latency',
    fixture: {
      query: `listNotes eq boardId='${benchBoard}'`,
      snapshotRows,
      note: 'subscribe-to-snapshot on an already-open socket; excludes ws connect',
    },
    ...stats(snapshotSamples),
  });

  // -- reconnect + resubscribe (fresh socket each time; split timings) ------
  const reconnectConnect = [];
  const reconnectSnapshot = [];
  const reconnectTotal = [];
  for (let i = 0; i < N_RECONNECT; i++) {
    const start = performance.now();
    const socket = await openSocket('/live/stream');
    reconnectConnect.push(socket.connectMs);
    const subscribeStart = performance.now();
    socket.send({ type: 'subscribe', name: 'listNotes', args: { boardId: benchBoard } });
    await socket.waitFor('snapshot');
    reconnectSnapshot.push(performance.now() - subscribeStart);
    reconnectTotal.push(performance.now() - start);
    socket.close();
  }
  measurements.push({
    metric: 'reconnect_resubscribe_latency',
    fixture: {
      query: `listNotes eq boardId='${benchBoard}'`,
      snapshotRows,
      note: 'full client reconnect: new WebSocket + subscribe + authoritative resnapshot (the structured-resnapshot path)',
    },
    total: stats(reconnectTotal),
    wsConnect: stats(reconnectConnect),
    subscribeToSnapshot: stats(reconnectSnapshot),
  });

  // -- live update latency (commit -> subscriber delta) ---------------------
  const liveBoard = `live-${runId}`;
  for (let i = 0; i < 20; i++) {
    await post('/mutation', { name: 'addNote', args: { boardId: liveBoard, text: `seed ${i}` } });
  }
  const liveSocket = await openSocket('/live/stream');
  liveSocket.send({ type: 'subscribe', name: 'listNotes', args: { boardId: liveBoard } });
  await liveSocket.waitFor('snapshot');
  const liveSamples = [];
  for (let i = 0; i < N_LIVE; i++) {
    const start = performance.now();
    await post('/mutation', { name: 'addNote', args: { boardId: liveBoard, text: `live ${i}` } });
    await liveSocket.waitFor('live_replace');
    liveSamples.push(performance.now() - start);
  }
  liveSocket.close();
  measurements.push({
    metric: 'live_update_latency',
    fixture: {
      query: `listNotes eq boardId='${liveBoard}'`,
      deltaShape: 'live_replace (full re-query of the supported subset)',
      connectionCount: 1,
      rowsAtStart: 20,
      rowsAtEnd: 20 + N_LIVE,
      note: 'includes the mutation HTTP round-trip; payload grows 20->70 rows across the run (live_replace re-sends the subset)',
    },
    ...stats(liveSamples),
    firstHalf: stats(liveSamples.slice(0, Math.floor(N_LIVE / 2))),
    secondHalf: stats(liveSamples.slice(Math.floor(N_LIVE / 2))),
  });

  // -- max practical subscribers ladder --------------------------------------
  const fanBoard = `fan-${runId}`;
  await post('/mutation', { name: 'addNote', args: { boardId: fanBoard, text: 'fan seed' } });
  const ladder = [];
  let maxPractical = 0;
  for (const target of FANOUT_RUNGS) {
    const rung = {
      subscribers: target,
      connectFailures: 0,
      deliveryFailures: 0,
    };
    let sockets = [];
    try {
      const opened = await mapConcurrent(target, 25, async () => {
        try {
          const socket = await openSocket('/live/stream');
          socket.send({ type: 'subscribe', name: 'listNotes', args: { boardId: fanBoard } });
          await socket.waitFor('snapshot', 20000);
          return socket;
        } catch (error) {
          rung.connectFailures += 1;
          return null;
        }
      });
      sockets = opened.filter(Boolean);
      rung.connected = sockets.length;
      rung.connectMs = stats(sockets.map((socket) => socket.connectMs));

      const deliveries = [];
      let sentAt = 0;
      const waitAll = Promise.all(
        sockets.map((socket) =>
          socket
            .waitFor('live_replace', DELIVERY_TIMEOUT_MS)
            .then(() => deliveries.push(performance.now() - sentAt))
            .catch(() => {
              rung.deliveryFailures += 1;
            })
        )
      );
      sentAt = performance.now();
      const result = await post('/mutation', { name: 'addNote', args: { boardId: fanBoard, text: `broadcast ${target}` } });
      rung.mutationMs = round(performance.now() - sentAt);
      rung.mutationOk = result.ok === true;
      await waitAll;
      rung.perSocketDeliveryMs = stats(deliveries);
      rung.allDeliveredMs = deliveries.length === sockets.length ? round(Math.max(0, ...deliveries)) : null;
      const practical =
        rung.mutationOk &&
        rung.connectFailures === 0 &&
        rung.deliveryFailures === 0 &&
        rung.perSocketDeliveryMs.p95Ms != null &&
        rung.perSocketDeliveryMs.p95Ms <= PRACTICAL_P95_MS;
      rung.practical = practical;
      if (practical) maxPractical = target;
    } finally {
      for (const socket of sockets) socket.close();
    }
    ladder.push(rung);
    // settle between rungs so closes drain before the next connect storm
    await new Promise((r) => setTimeout(r, 1500));
    if (rung.connectFailures > 0 || rung.deliveryFailures > 0) break;
  }
  measurements.push({
    metric: 'max_practical_subscribers',
    fixture: {
      query: `listNotes eq boardId='${fanBoard}'`,
      snapshotRowsAtLadderStart: 1,
      criterion: `largest rung with zero connect/delivery failures and per-socket delivery p95 <= ${PRACTICAL_P95_MS}ms`,
      clientConcurrencyLimit: 25,
      deliveryTimeoutMs: DELIVERY_TIMEOUT_MS,
      note: 'single client process; evidence for the supported single-table query subset only, never a general Cloudflare fan-out claim',
    },
    maxPracticalSubscribers: maxPractical,
    ladder,
  });

  // -- contention/overload probes --------------------------------------------
  const overload = [];

  // (a) oversized value: authorId is NOT length-clamped by the handler (text
  // is sliced to 280), so a >2MB string probes the DO SQLite value cap.
  for (const size of [1_000_000, 2_500_000]) {
    const start = performance.now();
    let outcome;
    try {
      outcome = await post('/mutation', {
        name: 'addNote',
        args: { boardId: `cap-${runId}`, text: 'cap probe', authorId: 'x'.repeat(size) },
      });
    } catch (error) {
      outcome = { transport: String(error?.message ?? error) };
    }
    overload.push({
      probe: 'oversized_value',
      fixture: { field: 'authorId', bytes: size, cap: 'Durable Object SQLite 2MB per-value limit' },
      latencyMs: round(performance.now() - start),
      outcome,
    });
  }

  // (b) concurrent mutation burst: the coordinator serializes invocations
  // (mutationIsolationMode=coordinator-serialized-invocations); the burst
  // measures queueing under contention and checks the committed versions
  // stayed unique and gap-free across the burst span.
  const burstBoard = `burst-${runId}`;
  const burstStart = performance.now();
  const burstResults = await mapConcurrent(BURST, BURST, async (i) => {
    const start = performance.now();
    const result = await post('/mutation', { name: 'addNote', args: { boardId: burstBoard, text: `burst ${i}` } });
    return { ms: performance.now() - start, ok: result.ok === true, version: result.version, code: result.code };
  });
  const burstVersions = burstResults.filter((r) => r.ok).map((r) => r.version).sort((a, b) => a - b);
  const burstUnique = new Set(burstVersions).size === burstVersions.length;
  const burstGapFree =
    burstVersions.length > 0 &&
    burstVersions[burstVersions.length - 1] - burstVersions[0] === burstVersions.length - 1;
  overload.push({
    probe: 'concurrent_mutation_burst',
    fixture: {
      concurrentMutations: BURST,
      handler: 'addNote (V8, one insert)',
      isolationMode: 'coordinator-serialized-invocations',
    },
    wallClockMs: round(performance.now() - burstStart),
    failures: burstResults.filter((r) => !r.ok).map((r) => r.code ?? 'unknown'),
    latency: stats(burstResults.map((r) => r.ms)),
    versionsUnique: burstUnique,
    versionsGapFreeWithinBurst: burstGapFree,
    versionSpan: burstVersions.length ? [burstVersions[0], burstVersions[burstVersions.length - 1]] : null,
  });

  measurements.push({ metric: 'contention_overload_probes', probes: overload });

  const report = {
    artifactKind: 'cloudflareProofMeasurements',
    surface: 'real-cloudflare',
    origin: base,
    runId,
    startedAtISO,
    finishedAtISO: new Date().toISOString(),
    client: { location: clientLocation, runtime: `node ${process.version}` },
    edgeColo: observedColo,
    resetApplied,
    comparability:
      'network-inclusive, region-dependent; NOT comparable to LLP 0035 (in-process) nor to measure.mjs (Miniflare-local)',
    method:
      'client-side performance.now() timing per LLP 0040 §Measurements; percentiles over stated-n samples; fixtures inline with every number',
    measurements,
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error('remote measurement harness crashed:', error);
  process.exit(2);
});
