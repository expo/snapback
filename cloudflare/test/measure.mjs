// LLP 0040 §Measurements — the local (Miniflare) measurement harness. It
// records mutation, snapshot, and live-update latency next to the benchmark
// fixture that produced each number (query predicate, snapshot size, delta
// payload, write rate, connection count), and emits machine-readable JSON like
// the local harness.
//
// METHOD NOTE (carried from the RFC): these numbers are NOT comparable to
// LLP 0035's in-process figures, and — critically — they are Miniflare, not
// real Cloudflare. They are network-inclusive within a local process but carry
// NO cold-start, placement, hibernation, eviction, or billing signal.
// Miniflare cannot evict the object or expose a billing surface, so the
// decisive idle-economics and wake/rehydrate numbers remain deploy-only
// (§Measurements evidence split). This harness exists to catch regressions and
// to shape the report, not to make a Cloudflare performance claim.
import { startProof } from './harness.mjs';

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
  return {
    n: sorted.length,
    p50Ms: round(percentile(sorted, 50)),
    p95Ms: round(percentile(sorted, 95)),
    maxMs: round(sorted[sorted.length - 1]),
  };
}

function round(value) {
  return value == null ? null : Math.round(value * 100) / 100;
}

async function main() {
  const client = await startProof();
  const measurements = [];
  try {
    await client.reset();

    // -- mutation latency ---------------------------------------------------
    const mutationSamples = [];
    for (let i = 0; i < 50; i++) {
      const start = performance.now();
      await client.mutation('addNote', { boardId: 'bench', text: `note ${i}` });
      mutationSamples.push(performance.now() - start);
    }
    measurements.push({
      metric: 'mutation_latency',
      fixture: { handler: 'addNote (V8)', writeRatePerCall: 1, rowsWritten: 1 },
      ...stats(mutationSamples),
    });

    // -- initial snapshot latency (over a known snapshot size) --------------
    const snapshotSamples = [];
    for (let i = 0; i < 30; i++) {
      const socket = await client.openLiveSocket();
      const start = performance.now();
      socket.send({ type: 'subscribe', name: 'listNotes', args: { boardId: 'bench' } });
      await socket.waitFor('snapshot');
      snapshotSamples.push(performance.now() - start);
      socket.close();
    }
    const snapshotRows = (await client.query('listNotes', { boardId: 'bench' })).rows.length;
    measurements.push({
      metric: 'initial_snapshot_latency',
      fixture: { query: "listNotes eq boardId='bench'", snapshotRows },
      ...stats(snapshotSamples),
    });

    // -- live update latency (commit -> subscriber sees the delta) ----------
    const liveSamples = [];
    const socket = await client.openLiveSocket();
    socket.send({ type: 'subscribe', name: 'listNotes', args: { boardId: 'bench' } });
    await socket.waitFor('snapshot');
    for (let i = 0; i < 30; i++) {
      const start = performance.now();
      await client.mutation('addNote', { boardId: 'bench', text: `live ${i}` });
      await socket.waitFor('live_replace');
      liveSamples.push(performance.now() - start);
    }
    socket.close();
    measurements.push({
      metric: 'live_update_latency',
      fixture: {
        query: "listNotes eq boardId='bench'",
        deltaShape: 'live_replace (full re-query of the supported subset)',
        connectionCount: 1,
      },
      ...stats(liveSamples),
    });

    // -- fan-out at N connections (labeled for the supported query subset) --
    for (const connectionCount of [1, 10, 50]) {
      const sockets = [];
      for (let i = 0; i < connectionCount; i++) {
        const s = await client.openLiveSocket();
        s.send({ type: 'subscribe', name: 'listNotes', args: { boardId: 'fanout' } });
        await s.waitFor('snapshot');
        sockets.push(s);
      }
      const start = performance.now();
      await client.mutation('addNote', { boardId: 'fanout', text: 'broadcast' });
      await Promise.all(sockets.map((s) => s.waitFor('live_replace')));
      const elapsed = performance.now() - start;
      for (const s of sockets) s.close();
      measurements.push({
        metric: 'fanout_all_subscribers_latency',
        fixture: {
          query: "listNotes eq boardId='fanout'",
          connectionCount,
          note: 'evidence for the supported single-table query subset only, not a general Cloudflare fan-out claim',
        },
        allDeliveredMs: round(elapsed),
      });
    }
  } finally {
    await client.dispose();
  }

  const report = {
    artifactKind: 'cloudflareProofMeasurements',
    surface: 'miniflare-local',
    comparability: 'NOT comparable to LLP 0035 (in-process) nor to real Cloudflare (no cold start / placement / hibernation / billing)',
    deployOnlyEvidenceStillMissing: [
      'cold_start_and_first_request_latency',
      'idle_no_connections_billable_usage',
      'idle_connected_hibernating_billable_usage',
      'post_eviction_wake_and_rehydrate',
      'maximum_practical_subscribers',
      'do_storage_and_cpu_limit_contention',
    ],
    measurements,
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error('measurement harness crashed:', error);
  process.exit(1);
});
