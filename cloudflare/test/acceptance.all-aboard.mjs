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
import {
  cloudflareClientOptions,
} from '../client-options.mjs';
import { snapbackBaseUrlForTarget } from '../../demos/_kit/target-origin.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const schemaManifest = readJson('demos/all-aboard/snapback/generated/schema.manifest.json');
const functionsManifest = readJson('demos/all-aboard/snapback/generated/functions.manifest.json');
const seed = readJson('demos/all-aboard/snapback/seed.json');
const manifestSchema = readJson('schemas/capability.manifest.schema.json');
const deploymentIdentity = readJson('cloudflare/generated/deployment-identity.all-aboard.json');
const baseTargetManifest = readJson(
  'cloudflare/generated/capability.manifest.cloudflare-do-sqlite-v8.json',
);
const allAboardTargetManifest = readJson(
  'cloudflare/generated/capability.manifest.cloudflare-do-sqlite-v8.all-aboard.json',
);

for (const key of [
  'targetProfileId',
  'supportedArtifactVersions',
  'supportedAuthModes',
  'supportedArtifactAuthPairs',
  'hostedAuth',
]) {
  assert.deepEqual(
    allAboardTargetManifest[key],
    baseTargetManifest[key],
    `All Aboard must not override the base target's ${key} authority fact`,
  );
}
assert.equal(
  Object.hasOwn(allAboardTargetManifest, 'authProtocols'),
  false,
  'All Aboard must not add auth protocols absent from its base target',
);

assert.throws(
  () => cloudflareClientOptions({ authClientProtocol: 1 }),
  /does not support authClientProtocol/,
  'the target-owned client factory must reject attempts to re-enable auth negotiation',
);
assert.throws(
  () => cloudflareClientOptions({ bearerToken: 'must-not-be-accepted' }),
  /does not support session credential custody/,
  'the target-owned client factory must reject misleading session credentials',
);
let bearerReads = 0;
const accessorOptions = cloudflareClientOptions({
  get bearerToken() {
    bearerReads += 1;
    return bearerReads === 1 ? null : 'must-not-bypass-the-guard';
  },
});
assert.equal(bearerReads, 1, 'client option accessors are snapshotted exactly once');
assert.equal(accessorOptions.bearerToken, null, 'a later accessor value cannot bypass validation');
assert.equal(
  snapbackBaseUrlForTarget({
    configuredOrigin: 'same-origin',
    serverOrigin: 'https://snapback.example.test/',
    surface: 'native',
    targetProfile: 'cloudflare-do-sqlite-v8',
  }),
  'https://snapback.example.test',
  'native same-origin startup uses the deployed gateway root without a /snapback prefix',
);
assert.equal(
  snapbackBaseUrlForTarget({
    configuredOrigin: 'same-origin',
    serverOrigin: 'https://snapback.example.test/',
    surface: 'web',
    targetProfile: 'cloudflare-do-sqlite-v8',
  }),
  '',
  'Cloudflare web same-origin paths address the gateway root',
);
assert.equal(
  snapbackBaseUrlForTarget({
    configuredOrigin: 'same-origin',
    serverOrigin: 'http://local.example.test/',
    surface: 'web',
    targetProfile: 'local-dev-sqlite-ibex',
  }),
  '/snapback',
  'local web same-origin paths retain the Vite /snapback proxy prefix',
);
assert.equal(
  snapbackBaseUrlForTarget({
    configuredOrigin: 'same-origin',
    serverOrigin: 'http://local.example.test/',
    surface: 'native',
    targetProfile: 'local-dev-sqlite-ibex',
  }),
  'http://local.example.test/snapback',
  'local native same-origin paths retain the host /snapback proxy prefix',
);
assert.equal(
  snapbackBaseUrlForTarget({
    configuredOrigin: 'http://127.0.0.1:4420',
    serverOrigin: undefined,
    surface: 'web',
    targetProfile: 'local-dev-sqlite-ibex',
  }),
  'http://127.0.0.1:4420',
  'an explicit local API origin remains direct',
);
assert.throws(
  () => snapbackBaseUrlForTarget({
    configuredOrigin: 'same-origin',
    serverOrigin: undefined,
    surface: 'native',
    targetProfile: 'cloudflare-do-sqlite-v8',
  }),
  /same-origin native startup requires an Exact server origin/,
  'native same-origin startup fails closed when the host supplies no origin',
);
assert.throws(
  () => snapbackBaseUrlForTarget({
    configuredOrigin: 'same-origin',
    serverOrigin: 'https://snapback.example.test',
    surface: 'web',
    targetProfile: 'future-unknown-target',
  }),
  /unsupported Snapback target profile/,
  'unknown target profiles cannot inherit local or hosted origin semantics',
);

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, rel), 'utf8'));
}

const EXPECTED_CHECKS = 20;
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
  const nativeFetch = globalThis.fetch;
  const requestedPaths = [];
  globalThis.fetch = (input, init) => {
    const target = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    requestedPaths.push(new URL(target, base).pathname);
    return nativeFetch.call(globalThis, input, init);
  };
  const client = new SnapbackClient(
    base,
    cloudflareClientOptions({ adminToken: ADMIN_TOKEN }),
  );
  try {
    // --- capability reporting -------------------------------------------
    const manifest = await client.inspect();
    check(
      'capability manifest is schema-shaped and declares the pre-auth target exactly',
      validateManifestShape(manifest) === null &&
        manifest.supportedArtifactVersions?.length === 1 &&
        manifest.supportedArtifactVersions[0] === 'snapback.v0' &&
        manifest.supportedAuthModes?.length === 1 &&
        manifest.supportedAuthModes[0] === 'dev' &&
        manifest.supportedArtifactAuthPairs?.length === 1 &&
        manifest.supportedArtifactAuthPairs[0]?.schemaVersion === 'snapback.v0' &&
        manifest.supportedArtifactAuthPairs[0]?.authMode === 'dev' &&
        manifest.supportedCapabilities?.join(',') === 'bounded_response_stream_v1,cron,live_subscriptions' &&
        !Object.hasOwn(manifest, 'authProtocols') &&
        manifest.hostedAuth?.externalTls === 'unavailable' &&
        manifest.hostedAuth?.effectiveSource === 'unavailable' &&
        manifest.hostedAuth?.authenticationThrottle === 'unavailable' &&
        manifest.hostedAuth?.sessionInvalidation === 'unavailable' &&
        manifest.hostedAuth?.clientCredentialPosture === 'unavailable',
    );
    check(
      'manifest declares the earned live-data facts with named partial limits (Phase 4 honesty)',
      manifest.outboundActions === true &&
        manifest.cron === true &&
        manifest.capabilityGaps.includes('generalized_outbound_actions') &&
        manifest.capabilityGaps.includes('egress_destination_allowlist') &&
        manifest.capabilityGaps.includes('calendar_cron_triggers') &&
        manifest.capabilityGaps.includes('http_outbox_poll_fallback')
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
    check(
      'Cloudflare target client never probes the unsupported auth handshake',
      !requestedPaths.includes('/auth/session'),
    );
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

    // This testing-only query declares trainStatus but its shared feedState
    // handler reads feedRefreshState. claimFeedPoll changes only
    // feedRefreshState, pinning the conservative fallback required when a
    // declaration is incomplete and no durable captured-read witness exists.
    const underdeclaredHandle = await client.liveQuery('underdeclaredFeedState', {
      connectionId,
      transport: 'stream',
      fallbackToPoll: false,
    });
    const underdeclaredBeforeVersion = underdeclaredHandle.version;
    const pollClaim = await client.mutate('claimFeedPoll', {
      args: { trigger: 'underdeclared-fanout-acceptance', minIntervalMs: 0 },
    });
    const underdeclaredDeadline = Date.now() + 5000;
    while (underdeclaredHandle.version <= underdeclaredBeforeVersion && Date.now() < underdeclaredDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    check(
      'a live query that reads an undeclared table wakes on a commit touching only that table',
      pollClaim.result.allowed === true &&
        pollClaim.changed_count === 1 &&
        underdeclaredHandle.version >= pollClaim.version &&
        underdeclaredHandle.rows[0]?.lastUpstreamPollAt === pollClaim.result.lastUpstreamPollAt
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
    check(
      'proof /health serves the source-derived All Aboard deployment hashes',
      health.ok === true &&
        health.schemaHash === deploymentIdentity.schemaHash &&
        health.bundleHash === deploymentIdentity.bundleHash &&
        health.clientArtifactIdentity.schemaHash === schemaManifest.schemaHash
    );
    const proofQuery = await proof.query('tripsQuery', {});
    check('proof-protocol /query still works alongside the kit routes', proofQuery.ok === true && proofQuery.rows.length === 6);

    handle.dispose();
    feedHandle.dispose();
    underdeclaredHandle.dispose();
    client.liveStreamManager(connectionId).close();

    // --- reset/seed --------------------------------------------------------
    const reset = await proof.reset();
    check('admin reset re-seeds the deterministic ground state', reset.reset === true && reset.seeded === true);
    const afterReset = await client.query('stationsQuery', {});
    check('post-reset store serves the seeded corridor again', afterReset.rows.length === 21);
    const feedAfterReset = await client.query('feedState', {});
    check('post-reset feed state returns to the seed label', feedAfterReset.rows[0].lastSource === 'seed');

    if (checks !== EXPECTED_CHECKS) {
      throw new Error(`expected ${EXPECTED_CHECKS} checks, ran ${checks}`);
    }
    console.log(`\nall-aboard cloudflare acceptance: ${checks}/${EXPECTED_CHECKS} checks passed`);
  } finally {
    globalThis.fetch = nativeFetch;
    await proof.dispose();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
