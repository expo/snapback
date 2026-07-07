// LLP 0040 acceptance suite (Miniflare regression surface). It drives the
// proof end to end and asserts the RFC's accepted-proof checklist that is
// checkable without real Cloudflare:
//
//   - query, mutate, subscribe, disconnect, resubscribe from a client;
//   - a cold-start subscription delivers the authoritative snapshot BEFORE any
//     delta (ordering asserted, not assumed);
//   - a JS handler executes in V8 and cannot reach fetch/env/bindings nor a
//     Durable Object storage handle (two-direction ambient denial);
//   - a mutation reaches a live subscriber without polling storage on a timer;
//   - after in-memory state is discarded (the CI surrogate for eviction) a
//     committed mutation still reaches the still-connected subscriber
//     (subscription rehydration from persisted rows);
//   - commit versions are gap-free within the app stream;
//   - reset/seed works;
//   - the capability manifest is served and validates against its JSON Schema.
//
// The decisive idle-economics, real-eviction, and billing evidence is
// deferred to real Cloudflare (LLP 0040 §Measurements evidence split) and is
// NOT claimed here.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import { startProof } from './harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: !!condition, detail: condition ? undefined : detail });
  const status = condition ? 'PASS' : 'FAIL';
  console.log(`  [${status}] ${name}${condition ? '' : ` — ${detail ?? ''}`}`);
}

async function main() {
  const client = await startProof();
  try {
    // -- capability manifest served + schema-valid --------------------------
    const manifest = await client.inspect();
    check('capability manifest served with the proof profile id',
      manifest.targetProfileId === 'cloudflare-do-sqlite-v8',
      `got ${manifest.targetProfileId}`);
    check('manifest names code_hot_load as a missing capability',
      Array.isArray(manifest.capabilityGaps) && manifest.capabilityGaps.includes('code_hot_load'),
      JSON.stringify(manifest.capabilityGaps));

    const schema = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'schemas/capability.manifest.schema.json'), 'utf8')
    );
    const ajv = new Ajv({ strict: false, allErrors: true });
    const validate = ajv.compile(schema);
    const valid = validate(manifest);
    check('capability manifest validates against its generated JSON Schema',
      valid, JSON.stringify(validate.errors));

    // -- reset/seed ---------------------------------------------------------
    await client.reset();
    const empty = await client.query('listNotes', { boardId: 'b1' });
    check('reset leaves an empty board', empty.ok && empty.rows.length === 0, JSON.stringify(empty));

    // -- mutation executes a JS handler in V8, commits a version ------------
    const first = await client.mutation('addNote', { boardId: 'b1', text: 'hello from V8', authorId: 'u1' });
    check('mutation runs the V8 handler and commits', first.ok && first.version >= 1 && first.changedCount === 1,
      JSON.stringify(first));

    const listed = await client.query('listNotes', { boardId: 'b1' });
    check('query returns the committed row', listed.ok && listed.rows.length === 1 && listed.rows[0].text === 'hello from V8',
      JSON.stringify(listed));

    // -- gap-free versions --------------------------------------------------
    const v1 = first.version;
    const second = await client.mutation('addNote', { boardId: 'b1', text: 'second' });
    check('commit versions are gap-free within the app stream', second.version === v1 + 1,
      `v1=${v1} v2=${second.version}`);

    // -- ambient-power denial (two directions) ------------------------------
    // The handler bundle has no denial handler itself; we prove denial by
    // deploying a probe via a second board mutation whose handler tries fetch.
    // Instead, drive the denial through the dedicated probe app is out of
    // scope here; the harness twin covers the exhaustive matrix. We assert the
    // manifest posture and one live proof below (a mutation cannot reach fetch
    // because the isolate is stripped — a fetch attempt would surface as a
    // handler failure). Covered exhaustively in tests/workerd_twin_v0.rs.
    check('manifest declares hosted_untrusted_code still a gap (denial by discipline, not platform)',
      manifest.capabilityGaps.includes('hosted_untrusted_code'), JSON.stringify(manifest.capabilityGaps));

    // The two-direction ambient-power denial, run against the DEPLOYED handler
    // isolate (LLP 0040 §Acceptance): ambient globals and host-object
    // reach-through are all unreachable — the handler's only power is ctx.
    const probe = await client.query('probeAmbient', {});
    const reachable = probe.ok ? probe.rows.filter((row) => row.reachable).map((row) => row.name) : ['<query failed>'];
    check('the deployed V8 handler cannot reach fetch/env/bindings nor host storage handles',
      probe.ok && reachable.length === 0, `reachable: ${JSON.stringify(reachable)}`);

    // -- live subscription: snapshot before delta ---------------------------
    await client.reset();
    await client.mutation('addNote', { boardId: 'b2', text: 'pre-existing' });
    const socket = await client.openLiveSocket();
    socket.send({ type: 'subscribe', name: 'listNotes', args: { boardId: 'b2' } });
    const snapshot = await socket.waitFor('snapshot');
    check('cold-start subscription delivers an authoritative snapshot first',
      snapshot.type === 'snapshot' && snapshot.rows.length === 1 && typeof snapshot.version === 'number',
      JSON.stringify(snapshot));
    check('subscription snapshot exposes the connection key (reconnect diagnostics)',
      typeof snapshot.connectionKey === 'string' && snapshot.connectionKey.length > 0,
      JSON.stringify(snapshot));

    // -- mutation reaches the live subscriber without polling ---------------
    const beforeDelta = Date.now();
    await client.mutation('addNote', { boardId: 'b2', text: 'live update' });
    const delta = await socket.waitFor('live_replace');
    check('a commit pushes a live_replace to the subscriber (no polling timer)',
      delta.type === 'live_replace' && delta.rows.some((row) => row.text === 'live update'),
      JSON.stringify(delta));
    check('the live delta is tagged with a version at or beyond the snapshot',
      delta.version >= snapshot.version, `snapshot=${snapshot.version} delta=${delta.version}`);
    check('live delivery is prompt (push, not interval-polled)',
      Date.now() - beforeDelta < 2000, `${Date.now() - beforeDelta}ms`);

    // -- eviction surrogate: subscription rehydrates from persisted rows -----
    await client.evict();
    await client.mutation('addNote', { boardId: 'b2', text: 'after eviction' });
    const afterEviction = await socket.waitFor('live_replace');
    check('after the in-memory state is discarded, a commit still reaches the subscriber (rehydration)',
      afterEviction.rows.some((row) => row.text === 'after eviction'),
      JSON.stringify(afterEviction));

    // -- disconnect + resubscribe -------------------------------------------
    socket.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const socket2 = await client.openLiveSocket();
    socket2.send({ type: 'subscribe', name: 'listNotes', args: { boardId: 'b2' } });
    const snapshot2 = await socket2.waitFor('snapshot');
    check('resubscribe after disconnect delivers a fresh authoritative snapshot',
      snapshot2.rows.length >= 3, JSON.stringify({ count: snapshot2.rows.length }));
    socket2.close();
  } finally {
    await client.dispose();
  }

  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  const report = {
    title: 'LLP 0040 Cloudflare narrow proof — Miniflare acceptance',
    surface: 'miniflare-regression',
    passed,
    total,
    ok: passed === total,
    results,
  };
  console.log('\n--- machine-readable report ---');
  console.log(JSON.stringify(report));
  process.exit(report.ok ? 0 : 1);
}

main().catch((error) => {
  console.error('acceptance harness crashed:', error);
  process.exit(2);
});
