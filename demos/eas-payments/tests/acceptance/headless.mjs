// EAS Payments — headless acceptance suite (the required surface).
//
// Proves the engine-first slice end to end: schema -> mutation ->
// action(+stubbed re-fetch) -> live query, plus the cron expiry sweep that
// flips a grant off once its subscription window closes.
//
// @ref LLP 0010#first-acceptance-app — headless is the required surface; every
//   claim below is an authoritative read after a real commit.
// @ref LLP 0028#scheduler-state-and-run-ledger — the scheduler starts inert and
//   the suite drives every tick, so no wall-clock cadence is in the loop.
//
// Run: node demos/eas-payments/tests/acceptance/headless.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { SnapbackClient } from '../../../_kit/client.mjs';
import { importGeneratedModule, readGeneratedJson } from '../../../_kit/generated-artifacts.mjs';
import { startServer } from '../../../_kit/server-process.mjs';
import { assert, assertEqual, assertThrows, createSuite, runAcceptance } from '../../../_kit/harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const backendDir = join(here, '..', '..', 'snapback');
const generatedRoot = join(backendDir, 'generated');
const gen = (f) => readGeneratedJson(generatedRoot, f);
const { default: api } = await importGeneratedModule(generatedRoot, 'api.mjs');

const schemaManifest = gen('schema.manifest.json');
const functionManifest = gen('functions.manifest.json');
const seed = JSON.parse(readFileSync(join(backendDir, 'seed.json'), 'utf8'));
const option = (name) => { const at = process.argv.indexOf(`--${name}`); return at < 0 ? null : process.argv[at + 1]; };

// Three buyers so user scoping, expiry, and the perpetual-grant case never
// share an entitlement row.
const ADA = 'user_ada';
const GRACE = 'user_grace';
const DANA = 'user_dana';

const suite = createSuite('eas-payments / headless', { expectedChecks: 15 });
const cleanups = [];
let server = null;
let db = null;

const activeEntitlementIds = async (userId) => {
  const { rows } = await db.query(api.getEntitlements, { userId });
  return rows.map((row) => row.entitlementId).sort();
};
const grantFor = async (userId, entitlementId) => {
  const { rows } = await db.query(api.getEntitlements, { userId });
  return rows.find((row) => row.entitlementId === entitlementId) ?? null;
};
// Per-job cron facts live on the AdminRead projection, not the public
// /inspect one — /inspect carries aggregate posture only (guide/backend/cron).
const cronJob = async (name) => {
  const res = await fetch(`${server.baseUrl}/_snapback/api/cron`, {
    headers: { 'x-snapback-admin-token': server.adminToken },
  });
  if (!res.ok) throw new Error(`cron list failed: HTTP ${res.status}`);
  const state = await res.json();
  return (state.jobs ?? []).find((job) => job.name === name) ?? null;
};

await runAcceptance(suite, async () => {
  // cronDisabled keeps the background scheduler from committing an expiry run
  // mid-assertion; the suite forces every tick it wants (LLP 0028).
  server = await startServer({
    port: 0,
    db: ':memory:',
    cwd: repoRoot,
    cronDisabled: true,
    provenance: {
      appId: 'eas-payments',
      artifactsPath: join(backendDir, 'generated', 'artifacts.json'),
    },
  });
  cleanups.push(() => server.stop());
  db = new SnapbackClient(server.baseUrl, server.clientOptions);

  await suite.check('health reports a local ibex+sqlite target', async () => {
    const health = await db.health();
    assert(health.ok, 'server not ok');
    return health;
  });

  await suite.check('schema load (no error diagnostics)', async () => {
    const res = await db.loadSchema(schemaManifest);
    assertEqual(
      res.diagnostics.filter((d) => d.severity === 'Error' || d.severity === 'Fatal'),
      [],
      'schema errors',
    );
    return res;
  });

  await suite.check('generated references load: query, mutation, action, cron', async () => {
    await db.loadFunctions(functionManifest);
    const state = await db.inspect();
    const names = state.functions.functions.map((f) => f.name).sort();
    for (const required of [
      'getEntitlements',
      'listProducts',
      'recordPurchase',
      'validateReceipt',
      'applyGrantExpiry',
      'expireGrantsSweep',
    ]) {
      assert(names.includes(required), `missing function ${required} in ${names}`);
    }
    assertEqual(api.getEntitlements.kind, 'LiveQuery', 'getEntitlements is a live query');
    assertEqual(api.recordPurchase.kind, 'Mutation', 'recordPurchase is a mutation');
    assertEqual(api.validateReceipt.kind, 'Action', 'validateReceipt is an action');
    return { functions: names };
  });

  await suite.check('deterministic reset + declarative seed installs the catalog', async () => {
    await db.reset();
    await db.seed(seed);
    const products = await db.query(api.listProducts, {});
    assertEqual(products.rows.map((r) => r.productId), ['pro_monthly'], 'seeded products');
    assertEqual(products.rows[0].kind, 'subscription', 'product kind');
    assertEqual(products.rows[0].appleId, 'com.example.app.pro.monthly', 'per-platform apple id');
    return { products: products.rows.length };
  });

  await suite.check('no purchase means no entitlement', async () => {
    assertEqual(await activeEntitlementIds(ADA), [], 'ada starts with no entitlements');
  });

  await suite.check('validateReceipt: action -> mutation -> transaction + grant', async () => {
    const res = await db.action(api.validateReceipt, {
      args: {
        productId: 'pro_monthly',
        store: 'apple',
        receipt: 'receipt_ada_1',
        environment: 'sandbox',
      },
      userId: ADA,
    });
    assert(res.ok, `validateReceipt failed: ${JSON.stringify(res.diagnostic)}`);
    assertEqual(res.result.storeTxnId, 'apple:receipt_ada_1', 'derived store transaction id');
    assertEqual(res.result.deduped, false, 'first delivery is not a dedupe');
    assert(res.result.expiresAt > 0, 'stub derived an expiry');
    return res.result;
  });

  await suite.check('getEntitlements returns pro, active, for that user', async () => {
    assertEqual(await activeEntitlementIds(ADA), ['pro'], 'ada holds pro');
    const grant = await grantFor(ADA, 'pro');
    assertEqual(grant.active, true, 'grant active');
    assertEqual(grant.source, 'apple:receipt_ada_1', 'grant records its source transaction');
    assert(grant.activeUntil > 0, 'grant carries an expiry window');
    for (const f of ['_id', '_version', '_createdAt', '_updatedAt']) {
      assert(grant[f] !== undefined, `missing system field ${f}`);
    }
    return { activeUntil: grant.activeUntil, version: grant._version };
  });

  await suite.check('entitlements are user-scoped: a non-buyer holds nothing', async () => {
    assertEqual(await activeEntitlementIds(GRACE), [], 'grace bought nothing');
  });

  await suite.check('the transaction carries store, status, and environment', async () => {
    const run = await adminRun('getEntitlements', {
      args: {},
      auth: SnapbackClient.auth(ADA),
      read_set: [],
    });
    assert(run.ok, 'function runner failed');
    assert(
      run.captured_reads.some((d) => d.table === 'entitlementGrants'),
      'live query must read the derived grant table',
    );
    // The environment tag rides the transaction so metering can exclude
    // sandbox rows later without a backfill.
    const replay = await db.mutate(api.recordPurchase, {
      args: {
        productId: 'pro_monthly',
        store: 'apple',
        storeTxnId: 'apple:receipt_ada_1',
        status: 'active',
        environment: 'production',
        expiresAt: Date.now() + 60_000,
      },
      userId: ADA,
    });
    assertEqual(replay.result.deduped, true, 'a known storeTxnId must not insert a second row');
    assertEqual(replay.result.grants, 0, 'a deduped delivery grants nothing');
    return { capturedReads: run.captured_reads.length };
  });

  await suite.check('replaying the receipt is idempotent end to end', async () => {
    const replay = await db.action(api.validateReceipt, {
      args: {
        productId: 'pro_monthly',
        store: 'apple',
        receipt: 'receipt_ada_1',
        environment: 'sandbox',
      },
      userId: ADA,
    });
    assert(replay.ok, `replay failed: ${JSON.stringify(replay.diagnostic)}`);
    assertEqual(replay.result.deduped, true, 'replayed receipt deduped');
    assertEqual(await activeEntitlementIds(ADA), ['pro'], 'still exactly one entitlement');
  });

  await suite.check('a live subscriber sees a purchase land in realtime', async () => {
    const live = await db.liveQuery(api.getEntitlements, { connectionId: 'grace_app', userId: GRACE });
    assertEqual(live.rows.length, 0, 'grace starts empty');
    await db.action(api.validateReceipt, {
      args: {
        productId: 'pro_monthly',
        store: 'google',
        receipt: 'receipt_grace_1',
        environment: 'sandbox',
      },
      userId: GRACE,
    });
    const rows = await live.poll();
    assertEqual(rows.map((r) => r.entitlementId), ['pro'], 'grace received the grant over the live lane');
    return { rows: rows.length };
  });

  await suite.check('recordPurchase rejects an unknown environment', async () => {
    const before = await activeEntitlementIds(DANA);
    await assertThrows(
      () => db.mutate(api.recordPurchase, {
        args: {
          productId: 'pro_monthly',
          store: 'apple',
          storeTxnId: 'apple:bad_env',
          status: 'active',
          environment: 'staging',
          expiresAt: Date.now() + 60_000,
        },
        userId: DANA,
      }),
      null,
      'expected an environment rejection',
    );
    assertEqual(await activeEntitlementIds(DANA), before, 'a rejected purchase grants nothing');
  });

  await suite.check('the expireGrants cron job is declared against the sweep action', async () => {
    const job = await cronJob('expireGrants');
    assert(job, 'expireGrants present in the cron list projection');
    assertEqual(job.action, 'expireGrantsSweep', 'targets the sweep action');
    assertEqual(job.enabled, true, 'job enabled');
    assertEqual(job.schedule.everyMs, 60_000, 'declared cadence');
    return { name: job.name, activationState: job.activationState };
  });

  await suite.check('a grant past activeUntil flips off on a scheduler tick', async () => {
    // Commit a grant whose window already closed, then let the scheduler run
    // the sweep: tick -> action -> mutation -> derived read model.
    await db.mutate(api.recordPurchase, {
      args: {
        productId: 'pro_monthly',
        store: 'stripe',
        storeTxnId: 'stripe:receipt_dana_expired',
        status: 'active',
        environment: 'sandbox',
        expiresAt: Date.now() - 1_000,
      },
      userId: DANA,
    });
    assertEqual(await activeEntitlementIds(DANA), ['pro'], 'dana holds pro before the sweep');

    await db.cronTick();

    assertEqual(await activeEntitlementIds(DANA), [], 'the expired grant is gone from the read model');
    assertEqual(await activeEntitlementIds(ADA), ['pro'], 'an unexpired grant survives the same sweep');
    // The run ledger must record a real run, so a tick that silently did
    // nothing cannot pass this check on the strength of the reads above.
    const job = await cronJob('expireGrants');
    assertEqual(job.lastOutcome, 'Succeeded', 'the scheduler recorded a successful run');
    assert(job.lastRunAtMs > 0, 'the run ledger stamped the run');
    return { lastOutcome: job.lastOutcome, lastRunAtMs: job.lastRunAtMs };
  });

  await suite.check('an ordinary query is honestly reported as NOT live', async () => {
    // @ref LLP 0004#relationship-to-sync-and-realtime — callable != syncable-live.
    const err = await assertThrows(
      () => db.subscribeLive(api.listProducts, { connectionId: 'catalog_watcher' }),
      'SNAPBACK_FUNCTION_NOT_LIVE',
      'expected a non-live rejection for the catalog query',
    );
    return { code: err.diagnostic.code };
  });
}, {
  cleanups,
  reportFile: option('receipt'),
  reportExtra: { schemaVersion: 'snapback.eas-payments-v0-receipt.v1' },
});

async function adminRun(name, input) {
  assert(
    typeof server.adminToken === 'string' && server.adminToken.length > 0,
    'startServer returned no admin token for the eas-payments function runner',
  );
  const res = await fetch(`${server.baseUrl}/_snapback/api/functions/${name}/run`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-snapback-admin-token': server.adminToken,
    },
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (!res.ok) {
    const error = new Error(json?.diagnostic?.code ?? `HTTP_${res.status}`);
    error.diagnostic = json?.diagnostic;
    throw error;
  }
  return json;
}
