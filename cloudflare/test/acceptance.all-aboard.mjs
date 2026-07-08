// LLP 0049 Phase 0 Miniflare acceptance: All Aboard (recorded-data) on the
// Cloudflare proof, driven end to end by the REAL kit client
// (demos/_kit/client.mjs) over a real loopback port — HTTP routes, connection
// grants, snapshot-with-subscribe, and the hibernation-accepted WebSocket all
// exercised through the same code path the generated Contract surface uses.
//
// Exit evidence (LLP 0049 Phase 0): query, mutation, initial live snapshot,
// live push from a local mutation, reset/seed, and capability reporting —
// with the capability manifest still declaring secrets, actions, egress, and
// cron unavailable for this phase, and recorded data labeled as such.
//
// Run: node cloudflare/test/acceptance.all-aboard.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startProof, ADMIN_TOKEN } from './harness.mjs';
import { SnapbackClient } from '../../demos/_kit/client.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const schemaManifest = readJson('demos/all-aboard/snapback/generated/schema.manifest.json');
const functionsManifest = readJson('demos/all-aboard/snapback/generated/functions.manifest.json');
const seed = readJson('demos/all-aboard/snapback/seed.json');
const manifestSchema = readJson('schemas/capability.manifest.schema.json');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, rel), 'utf8'));
}

const EXPECTED_CHECKS = 18;
let checks = 0;
function check(label, condition) {
  checks += 1;
  if (!condition) {
    throw new Error(`ACCEPTANCE FAILED [${label}]`);
  }
  console.log(`ok ${checks} - ${label}`);
}

// Minimal structural validation against the generated JSON Schema (the notes
// suite uses the same approach): required keys present with the right types.
function validateManifestShape(manifest) {
  for (const key of manifestSchema.required || []) {
    if (!(key in manifest)) return `missing required key ${key}`;
  }
  if (!Array.isArray(manifest.capabilityGaps)) return 'capabilityGaps is not an array';
  if (!Array.isArray(manifest.resourceLimits)) return 'resourceLimits is not an array';
  return null;
}

async function main() {
  const proof = await startProof({ app: 'all-aboard', port: 0 });
  const base = await proof.url();
  const client = new SnapbackClient(base, { adminToken: ADMIN_TOKEN });
  try {
    // --- capability reporting -------------------------------------------
    const manifest = await client.inspect();
    check('capability manifest served and schema-shaped', validateManifestShape(manifest) === null);
    check(
      'manifest still declares actions/egress/cron/secrets unavailable (Phase 0 honesty)',
      manifest.outboundActions === false &&
        manifest.cron === false &&
        manifest.capabilityGaps.includes('outbound_actions') &&
        manifest.capabilityGaps.includes('cron') &&
        manifest.capabilityGaps.includes('config_secrets_backend')
    );

    // --- ensure/seed ------------------------------------------------------
    const ensured = await client.ensureApp({ schema: schemaManifest, functions: functionsManifest, seed });
    check(
      'ensureApp matches compiled-in artifacts and seeds the empty store',
      ensured.schema === 'matched' && ensured.functions === 'matched' && ensured.seed === 'seeded'
    );
    const ensuredAgain = await client.ensureApp({ schema: schemaManifest, functions: functionsManifest, seed });
    check('second ensureApp is idempotent (skipped-nonempty)', ensuredAgain.seed === 'skipped-nonempty');

    // --- queries ----------------------------------------------------------
    const stations = await client.query('stationsQuery', {});
    check('stationsQuery returns the seeded corridor in order', stations.rows.length === 21 && stations.rows[0].stationId === 'san-francisco');
    const stopTimes = await client.query('stopTimesByStation', { args: { stationId: 'palo-alto' } });
    check(
      'stopTimesByStation filters by argument',
      stopTimes.rows.length > 0 && stopTimes.rows.every((row) => row.stationId === 'palo-alto')
    );

    // --- live subscribe: authoritative initial snapshot -------------------
    const connectionId = 'acceptance-conn';
    const updates = [];
    const handle = await client.liveQuery('liveTrainStatus', {
      connectionId,
      transport: 'stream',
      onUpdate: (rows, meta) => updates.push({ rows, meta }),
    });
    check(
      'live subscribe returns the seeded snapshot (6 patterns, on-time)',
      handle.rows.length === 6 && handle.rows.every((row) => row.status === 'on-time')
    );

    const feedHandle = await client.liveQuery('feedState', { connectionId, transport: 'stream' });
    check(
      'recorded data is labeled (feedRefreshState.lastSource is seed/recorded, never the live stamp)',
      feedHandle.rows.length === 1 && ['seed', 'recorded', 'recorded-fallback'].includes(feedHandle.rows[0].lastSource)
    );

    // --- mutation + live push from a local commit -------------------------
    const beforeVersion = handle.version;
    const tick = await client.mutate('applyFeedTick', { args: { trigger: 'acceptance', source: 'recorded' } });
    check('mutation commits and advances the version', tick.version > 0 && tick.changed_count > 0);
    check('mutation result carries the recorded tick', Number.isInteger(tick.result.tickIndex));

    const pushDeadline = Date.now() + 5000;
    while (handle.version <= beforeVersion && Date.now() < pushDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    check(
      'live push reaches the kit subscriber over the hibernation socket',
      handle.version > beforeVersion && handle.rows.length === 6
    );
    // The two subscriptions push independently; wait for the feedState frame.
    const feedDeadline = Date.now() + 5000;
    while (feedHandle.rows[0]?.lastRunTrigger !== 'acceptance' && Date.now() < feedDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    check(
      'feedState live push labels the recorded advance',
      feedHandle.rows[0].lastSource === 'recorded' && feedHandle.rows[0].lastRunTrigger === 'acceptance'
    );

    // --- ambient denial (the V8 posture holds for this bundle too) --------
    const probe = await client.query('probeAmbient', {});
    check(
      'handler isolate ambient powers remain denied for the All Aboard bundle',
      Array.isArray(probe.rows) && probe.rows.every((entry) => entry.reachable === false)
    );

    // --- proof-protocol routes still serve this bundle --------------------
    const health = await proof.health();
    check('proof /health serves the All Aboard hashes', health.ok === true && health.schemaHash === schemaManifest.schemaHash);
    const proofQuery = await proof.query('tripsQuery', {});
    check('proof-protocol /query still works alongside the kit routes', proofQuery.ok === true && proofQuery.rows.length === 6);

    // --- reset/seed --------------------------------------------------------
    const reset = await proof.reset();
    check('admin reset re-seeds the deterministic ground state', reset.reset === true && reset.seeded === true);
    const afterReset = await client.query('stationsQuery', {});
    check('post-reset store serves the seeded corridor again', afterReset.rows.length === 21);
    const feedAfterReset = await client.query('feedState', {});
    check('post-reset feed state returns to the seed label', feedAfterReset.rows[0].lastSource === 'seed');

    handle.dispose();
    feedHandle.dispose();
    client.liveStreamManager(connectionId).close();

    if (checks !== EXPECTED_CHECKS) {
      throw new Error(`expected ${EXPECTED_CHECKS} checks, ran ${checks}`);
    }
    console.log(`\nall-aboard cloudflare acceptance: ${checks}/${EXPECTED_CHECKS} checks passed`);
  } finally {
    await proof.dispose();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
