// All Aboard — the LLP 0032 P5 proof: a cron-authored (server-initiated)
// change reaches a mounted Contract surface with ZERO per-demo glue.
//
// The surface here is built from exactly three things: the generated
// artifacts, the @snapback/contract adapter (multi-query live mode — the
// adapter owns the live subscriptions, DK-10), and the kit client. No
// store.mjs, no poll pump, no demo-local bridge. The adapter's own
// subscription to liveTrainStatus arms the demand-activated warmPoll cron
// job (whileLive); a forced scheduler tick runs the refresh action, and the
// committed rows stream into the Contract boundary over the live socket.
//
// Needs the Exact runtime (run with bun); skips with the standard structured
// diagnostic when no Exact checkout resolves.
//
// Run: TZ=America/Los_Angeles bun demos/all-aboard/tests/acceptance/contract-live.mjs

process.env.TZ = 'America/Los_Angeles';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { startServer } from '../../../_kit/server-process.mjs';
import { resolveExact } from '../../../_kit/exact-resolver.mjs';
import { assert, assertEqual, createSuite, runAcceptance } from '../../../_kit/harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const backendDir = join(here, '..', '..', 'snapback');
const gen = (f) => JSON.parse(readFileSync(join(backendDir, 'generated', f), 'utf8'));
const seed = JSON.parse(readFileSync(join(backendDir, 'seed.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { SnapbackClient } = await import(join(repoRoot, 'demos/_kit/client.mjs'));
const { createSnapbackContractSurface } = await import(join(repoRoot, 'packages/snapback-contract/index.mjs'));
const { importExactContractRuntime } = await import(join(repoRoot, 'packages/snapback-contract/exact-package.mjs'));

const exact = resolveExact({ repoRoot });
if (exact.sourceKind === 'missing') {
  console.log(JSON.stringify({
    title: 'all-aboard contract-live (LLP 0032 P5)',
    skipped: true,
    reason: 'SNAPBACK_CAPABILITY_EXACT_MISSING',
    diagnostics: exact.diagnostics,
  }, null, 2));
  console.log('\nSKIP (valid, expected_missing): all-aboard contract-live');
  process.exit(0);
}

const runtime = await importExactContractRuntime({ exactRoot: exact.path });
const suite = createSuite('all-aboard contract-live (LLP 0032 P5)');
let server = null;
let db = null;
let surface = null;

const waitFor = async (predicate, label, timeoutMs = 8_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${label}`);
};

await runAcceptance(suite, async () => {
  server = await startServer({ port: 4424, db: ':memory:', cwd: repoRoot });
  db = new SnapbackClient(server.baseUrl);
  const forceTick = () => fetch(`${server.baseUrl}/_snapback/api/cron/tick`, { method: 'POST' }).then((r) => r.json());

  await db.loadSchema(gen('schema.manifest.json'));
  await db.loadFunctions(gen('functions.manifest.json'));
  await db.reset();
  await db.seed(seed);

  await suite.check('the packaged adapter binds the live queries with server push (no demo glue)', async () => {
    surface = await createSnapbackContractSurface({
      runtime,
      client: db,
      manifest: gen('contract-data.manifest.json'),
      artifactIndex: gen('artifacts.json'),
      schemaManifest: gen('schema.manifest.json'),
      functionManifest: gen('functions.manifest.json'),
      liveQueries: ['liveTrainStatus', 'feedState'],
    });
    assert(surface.livePush === true, 'live push owned by the adapter');
    await waitFor(() => surface.connection('liveTrainStatus') === 'live', "liveTrainStatus 'live'");
    await waitFor(() => surface.connection('feedState') === 'live', "feedState 'live'");
    return { connections: surface.connections() };
  });

  await suite.check('a cron-authored change reaches the Contract boundary over the push lane', async () => {
    let feedCells = [];
    let statusCells = [];
    const subFeed = surface.provider.subscribe('feedState', {}, (cell) => {
      if (cell.status === 'ready' || cell.status === 'refreshing') feedCells.push(cell.value);
    });
    const subStatus = surface.provider.subscribe('liveTrainStatus', {}, (cell) => {
      if (cell.status === 'ready' || cell.status === 'refreshing') statusCells.push(cell.value);
    });
    try {
      // The adapter's own liveTrainStatus subscription is the demand that
      // arms the whileLive warmPoll job; the forced tick fires it once.
      await forceTick();
      await waitFor(
        () => feedCells.some((rows) => rows.some((row) => row.tickIndex >= 1 && row.lastRunTrigger === 'cron')),
        'the cron-committed feedState row streamed into the Contract boundary',
      );
      await waitFor(
        () => statusCells.length >= 1 && statusCells.at(-1).length > 0,
        'liveTrainStatus rows present in the boundary',
      );
      const feedRow = feedCells.at(-1).find((row) => row.lastRunTrigger === 'cron');
      // Post G5/G12 (LLP 0029), an unconfigured cron tick advances the
      // recorded feed via the honest fallback label; a configured one hits
      // 511 SIRI. Any of the three proves the cron->push lane; what matters
      // above is that the committed row STREAMED into the boundary.
      const validSources = ['recorded', 'recorded-fallback', '511-siri-stop-monitoring'];
      assert(validSources.includes(feedRow.lastSource),
        `cron feed source is honest (got ${JSON.stringify(feedRow.lastSource)})`);
      return { tickIndex: feedRow.tickIndex, statusRows: statusCells.at(-1).length };
    } finally {
      subFeed.dispose();
      subStatus.dispose();
    }
  });
}, {
  cleanups: [
    () => surface?.dispose?.(),
    () => server?.stop(),
  ],
});
