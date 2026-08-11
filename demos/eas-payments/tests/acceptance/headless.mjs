// EAS Payments — headless acceptance suite (the required surface).
//
// Proves the engine end to end: schema -> mutation -> action(+real outbound
// fetch to a fake store) -> live query, plus the cron expiry sweep that flips
// a grant off once its subscription window closes.
//
// @ref LLP 0010#first-acceptance-app — headless is the required surface; every
//   claim below is an authoritative read after a real commit.
// @ref LLP 0028#scheduler-state-and-run-ledger — the scheduler starts inert and
//   the suite drives every tick, so no wall-clock cadence is in the loop.
// @ref LLP 0036#declared-configuration-in-the-manifest — the store credential
//   is set through the admin config surface, never through app arguments.
//
// Run: node demos/eas-payments/tests/acceptance/headless.mjs
// (the suite sets SNAPBACK_OUTBOUND_ACTIONS on its own server child)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { SnapbackClient } from '../../../_kit/client.mjs';
import { importGeneratedModule, readGeneratedJson } from '../../../_kit/generated-artifacts.mjs';
import { startServer } from '../../../_kit/server-process.mjs';
import { assert, assertEqual, assertThrows, createSuite, runAcceptance } from '../../../_kit/harness.mjs';
import { startFakeStore } from './fake-store.mjs';
import { startFakeDeveloper } from './fake-developer.mjs';
import { AdminClient } from '../../../../packages/snapback-admin-client/index.mjs';

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

// The store SKUs, indexed by store and then by the package they belong to
// (slice 12). A transaction names one of these strings, never a package id.
//
// Read the Google column: its SKU strings are the package ids. That is
// realistic — Google product ids routinely match what a developer calls the
// thing — and it is why the catalog keys SKUs on (store, productId) rather than
// on productId alone, and why `store` rides every transaction and every
// mapping edge. Apple and Stripe strings are distinguishable, so checks that
// need to PROVE a SKU is not a package id use those.
const SKU = {
  apple: {
    pro_monthly: 'com.example.app.pro.monthly',
    pro_annual: 'com.example.app.pro.annual',
    plus_monthly: 'com.example.app.plus.monthly',
    coins_100: 'com.example.app.coins.100',
  },
  google: {
    pro_monthly: 'pro_monthly',
    pro_annual: 'pro_annual',
    plus_monthly: 'plus_monthly',
    coins_100: 'coins_100',
  },
  stripe: {
    pro_monthly: 'price_pro_monthly',
    pro_annual: 'price_pro_annual',
    plus_monthly: 'price_plus_monthly',
    coins_100: 'price_coins_100',
  },
};

// Separate buyers so user scoping, expiry, credential failure, and
// store-reported-expired never share an entitlement row — no check should
// depend on where it sits in the file.
const ADA = 'user_ada';
const GRACE = 'user_grace';
const DANA = 'user_dana';
const EVE = 'user_eve';
const FRANK = 'user_frank';
const HANK = 'user_hank';
const IVY = 'user_ivy';
const JO = 'user_jo';
const KIT = 'user_kit';
const LEO = 'user_leo';
const MIA = 'user_mia';
const NIA = 'user_nia';
const OMAR = 'user_omar';
// Slice 6. Grace is the fully-entitled buyer (holds pro AND plus), so a
// consumable purchase by her is the sharpest form of "this granted nothing":
// her entitlement set is non-empty before and identical after. Pat is a fresh
// buyer whose subscription proves the feed still ticks.
const PAT = 'user_pat';
// Slice 7 — one buyer per lifecycle path, because these checks assert on a
// subscription MOVING and a shared user would let one transition's outcome
// stand in for another's.
const QUINN = 'user_quinn'; // grace holds access, then lapses
const RUE = 'user_rue'; // grace recovers to active
const SAM = 'user_sam'; // retry_hold, then recovers
const TARA = 'user_tara'; // paused, then resumes
const UMA = 'user_uma'; // pending, then clears
const VIC = 'user_vic'; // pending, then canceled
const WES = 'user_wes'; // two transactions: active alongside grace
const ZOE = 'user_zoe'; // the control: buys once, must never move
// Slice 11 — catalog management. ZED holds a throwaway entitlement so its
// deletion has a derived grant to clean up; DASH is the dashboard's identity.
const ZED = 'user_zed';
const DASH = 'dashboard';
// Slice 12 — the store SKU as the atom.
const NOVA = 'user_nova'; // holds the apple AND google SKUs of one entitlement
// Slice 13 — purchase events, directory, fulfillment.
const RAVI = 'user_ravi'; // a granting purchase: both event types
const SASHA = 'user_sasha'; // consumable ONLY: invisible to the old feed-derived directory
const ORSON = 'user_orson'; // buys a SKU no edge maps: a good record, no grant
const PIA = 'user_pia'; // buys each of one package's three SKUs in turn
// Slice 8 — acknowledgement. These buy on GOOGLE, the only adapter that carries a
// server-side ack obligation, so every earlier check's apple/stripe purchases
// stay outside this machinery entirely.
const ANIL = 'user_anil'; // ack lands, then the deadline passes harmlessly
const BEA = 'user_bea'; // consumable: consume, then re-buy
const CHEN = 'user_chen'; // ack suppressed, so the deadline auto-refunds
const DEV = 'user_dev'; // double acknowledgement
const ELIF = 'user_elif'; // apple: no server ack is owed
// Slice 9 — the after-sale money lifecycle. A sale is not final.
const FARID = 'user_farid'; // refund granted, then reversed
const GITA = 'user_gita'; // consumption request answered from developer data
const HUGO = 'user_hugo'; // consumption request with no data: the deadline default
const IRIS = 'user_iris'; // dispute opened, then won
const JUNO = 'user_juno'; // dispute opened, then lost
const KAI = 'user_kai'; // the control: buys once, must never move

const STORE_KEY = 'fake-store-key-slice-2';
const WRONG_STORE_KEY = 'not-the-store-key';
const WEBHOOK_SECRET = 'developer-shared-secret-slice-5';

const suite = createSuite('eas-payments / headless', { expectedChecks: 84 });
const cleanups = [];
let server = null;
let db = null;
let store = null;
let developer = null;
let admin = null;
// Set by the cron-expiry check; read by the feed check that inspects that tick.
let sweepCursor = 0;

// Every outbound call routes to the fake store's OS-assigned port.
const validate = (args, userId) => db.action(api.validateReceipt, {
  args: { storeBaseUrl: store.baseUrl, ...args },
  userId,
});
// The notification path. Note what is NOT here: no status, no expiry, no
// entitlement. The trigger says only which transaction moved.
const notify = ({ userId, store: storeName, storeTxnId }, callerId) => db.action(api.applyStoreState, {
  args: { userId, store: storeName, storeTxnId, storeBaseUrl: store.baseUrl },
  userId: callerId ?? userId,
});

const setConfig = async (entry, value) => {
  const res = await fetch(`${server.baseUrl}/_snapback/api/config/set`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-snapback-admin-token': server.adminToken,
    },
    body: JSON.stringify({ entry, value }),
  });
  if (!res.ok) throw new Error(`config set failed: HTTP ${res.status} ${await res.text()}`);
  return res.json();
};
const setStoreKey = (value) => setConfig('storeValidation', value);

// The jobs worker is inert in this suite; every claim goes through the drain
// seam so the retry ladder is observed rather than waited on.
//
// The injected clock is both the due-ness test AND the base the runtime uses
// to schedule a failed attempt's next try, so re-injecting the same instant
// leaves a retry permanently in the future. Extra `maxWaves` does not help
// either: every wave in one call shares that call's nowMs. A retry ladder
// therefore needs successive drains at successive virtual moments.
let virtualNowMs = Date.now();
const drain = async (rounds = 1) => {
  const receipts = [];
  for (let round = 0; round < rounds; round += 1) {
    // Two virtual minutes per round clears the whole backoff ladder
    // (base 1 s, capped at 60 s, jitter ceiling 1 s).
    virtualNowMs = Math.max(virtualNowMs, Date.now()) + 120_000;
    receipts.push(await admin.drainJobs({ nowMs: virtualNowMs, maxWaves: 1 }));
  }
  return receipts;
};

// Slice 11. Catalog writes are `auth: 'authenticated'` — the strongest
// requirement the closed vocabulary offers — so they need SOME identity, and
// there is no secret tier to name a management one. `DASH` is a stand-in for the
// project secret key a real deployment would authenticate with, and the fact
// that any authenticated identity would do is precisely the gap.
const catalogWrite = async (ref, args) => {
  const res = await db.mutate(ref, { args, userId: DASH });
  return res.result ?? res;
};

const activeEntitlementIds = async (userId) => {
  const { rows } = await db.query(api.getEntitlements, { userId });
  return rows.map((row) => row.entitlementId).sort();
};
const grantFor = async (userId, entitlementId) => {
  const { rows } = await db.query(api.getEntitlements, { userId });
  return rows.find((row) => row.entitlementId === entitlementId) ?? null;
};
// The developer's poll. Cursor semantics are keyset: resume from the last seq
// you were handed, never from a separately sampled head.
const pollChanges = async (sinceSeq) => {
  const { rows } = await db.query(api.pollChanges, { args: { sinceSeq } });
  return rows;
};
const changeCursor = async () => {
  const rows = await pollChanges(0);
  return rows.length === 0 ? 0 : rows[rows.length - 1].seq;
};
// The purchase audit (slice 6). Auth-scoped, so this is that user's own rows.
const purchases = async (userId) => {
  const { rows } = await db.query(api.listPurchases, { userId });
  return rows;
};

// Slice 7. The sweep is driven through its mutation rather than db.cronTick()
// for a mechanical reason: `expireGrants` is an everyMs 60_000 job, so it is due
// exactly once per minute of wall clock, and the cron checks above already
// consumed this run's due tick. These checks need several sweeps in a row.
//
// That is a fair test of what they are about — the sweep's STATE logic lives in
// applyGrantExpiry, and the cron wiring (tick -> action -> mutation) is already
// proven separately by the two cron checks.
const runSweep = async () => {
  const res = await db.mutate(api.applyGrantExpiry, {});
  return res.result ?? res;
};

// Slice 8. One purchase's row out of the audit, so a check can read its ackState
// without caring where it sits among the user's other purchases.
const purchaseOf = async (userId, storeTxnId) => {
  const rows = await purchases(userId);
  return rows.find((row) => row.storeTxnId === storeTxnId) ?? null;
};
// Outbound acknowledgement calls the store has actually received. This is the
// definitive evidence for "no server ack was sent" — stronger than inspecting
// the job queue, because it observes the effect rather than the intent.
const ackCalls = (storeTxnId) => store.requests.filter((r) => r.method === 'POST'
  && (r.path === `/acknowledge/${storeTxnId}` || r.path === `/consume/${storeTxnId}`));

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
  store = await startFakeStore({ apiKey: STORE_KEY });
  cleanups.push(() => store.close());
  developer = await startFakeDeveloper({ secret: WEBHOOK_SECRET });
  cleanups.push(() => developer.close());

  server = await startServer({
    port: 0,
    db: ':memory:',
    cwd: repoRoot,
    cronDisabled: true,
    // Generation opting in does not grant the process network authority; the
    // runtime is the security boundary and needs its own opt-in.
    // SNAPBACK_JOBS_DISABLED is cron's sibling switch: separate subsystem,
    // separate inert-worker flag, so the suite owns every job claim too.
    env: { SNAPBACK_OUTBOUND_ACTIONS: '1', SNAPBACK_JOBS_DISABLED: '1' },
    provenance: {
      appId: 'eas-payments',
      artifactsPath: join(backendDir, 'generated', 'artifacts.json'),
    },
  });
  cleanups.push(() => server.stop());
  db = new SnapbackClient(server.baseUrl, server.clientOptions);
  admin = new AdminClient(`${server.baseUrl}/_snapback/api`, { token: server.adminToken });

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
      'listPackages',
      'listProducts',
      'listEntitlements',
      'listProductEntitlements',
      'createPackage',
      'deletePackage',
      'createProduct',
      'deleteProduct',
      'addProductEntitlement',
      'recordPurchase',
      'validateReceipt',
      'reconcileTransaction',
      'applyStoreState',
      'applyGrantExpiry',
      'expireGrantsSweep',
      'acknowledgePurchase',
      'markAcknowledged',
      'handleConsumptionRequest',
      'setConsumptionData',
    ]) {
      assert(names.includes(required), `missing function ${required} in ${names}`);
    }
    assertEqual(api.getEntitlements.kind, 'LiveQuery', 'getEntitlements is a live query');
    assertEqual(api.recordPurchase.kind, 'Mutation', 'recordPurchase is a mutation');
    assertEqual(api.validateReceipt.kind, 'Action', 'validateReceipt is an action');
    assertEqual(api.applyStoreState.kind, 'Action', 'applyStoreState is an action');
    // The notification trigger carries no state: only who and which txn.
    assertEqual(
      Object.keys(api.applyStoreState.argumentSchema.properties).sort(),
      ['store', 'storeBaseUrl', 'storeTxnId', 'userId'],
      'applyStoreState takes a trigger, not a payload',
    );
    return { functions: names };
  });

  // Config entries are declared in the function manifest, so the deployment
  // value can only be set once that manifest is loaded.
  await setStoreKey(STORE_KEY);
  await setConfig('developerWebhookSecret', WEBHOOK_SECRET);
  // Slice 8. The ack job's payload cannot carry a URL — its arguments are minted
  // inside a mutation that has no idea what port the fixture bound — so the
  // store origin arrives as config, which is what a real adapter's per-store
  // constant would be.
  await setConfig('storeBaseUrl', store.baseUrl);

  await suite.check('deterministic reset + declarative seed installs the catalog', async () => {
    await db.reset();
    await db.seed(seed);
    // Three levels now (slice 12): packages group the store SKUs that are
    // actually purchasable, and entitlements are what a SKU grants.
    const packages = await db.query(api.listPackages, {});
    assertEqual(
      packages.rows.map((r) => r.packageId),
      ['coins_100', 'plus_monthly', 'pro_annual', 'pro_monthly'],
      'seeded packages',
    );
    const proMonthly = packages.rows.find((r) => r.packageId === 'pro_monthly');
    assertEqual(proMonthly.kind, 'subscription', 'package kind');
    // `kind` lives on the package, not the SKU: a consumable is a consumable on
    // every store or on none.
    const coins = packages.rows.find((r) => r.packageId === 'coins_100');
    assertEqual(coins.kind, 'consumable', 'consumable package kind');

    const products = await db.query(api.listProducts, {});
    assertEqual(products.rows.length, 12, 'four packages x three stores of SKUs');
    // The SKU carries the store identity the package deliberately does not.
    const appleProMonthly = products.rows.find(
      (r) => r.store === 'apple' && r.productId === SKU.apple.pro_monthly,
    );
    assertEqual(appleProMonthly.packageId, 'pro_monthly', 'the SKU names its package');
    // Structured store facts land on the SKU row — the thing the old
    // appleId/googleId/stripePriceId columns had nowhere to put.
    const googleProMonthly = products.rows.find(
      (r) => r.store === 'google' && r.productId === SKU.google.pro_monthly,
    );
    assertEqual(googleProMonthly.basePlanId, 'monthly-autorenewing', 'google base plan id');
    assert(!appleProMonthly.basePlanId, 'apple has no base plan concept, so the field is absent');
    return { packages: packages.rows.length, products: products.rows.length };
  });

  // The management side of the catalog: the graph a developer dashboard needs
  // and an app deliberately never sees.
  await suite.check('listEntitlements projects the entitlement definitions', async () => {
    const { rows } = await db.query(api.listEntitlements, {});
    assertEqual(
      rows.map((r) => r.entitlementId),
      ['plus', 'pro'],
      'seeded entitlements, ordered by id',
    );
    const pro = rows.find((r) => r.entitlementId === 'pro');
    assertEqual(pro.title, 'Pro features', 'entitlement title');
    // Projected, not documents: the payload is exactly the declared contract,
    // so a column added to the table later cannot leak into a management read.
    assertEqual(Object.keys(pro).sort(), ['entitlementId', 'title'], 'projected shape');
    return { entitlements: rows.length };
  });

  await suite.check('listProductEntitlements exposes the SKU-level graph', async () => {
    const { rows } = await db.query(api.listProductEntitlements, {});
    const byEntitlement = {};
    for (const row of rows) {
      (byEntitlement[row.entitlementId] ??= []).push(`${row.store} ${row.productId}`);
    }
    // The edges moved down a level in slice 12: they name SKUs, not packages.
    // `pro` is granted by two packages x three stores = six SKUs, which is what
    // makes decision 23's cross-platform union fall out of an ordinary set
    // union rather than needing a "same package" rule.
    assertEqual(byEntitlement.pro.slice().sort(), [
      'apple com.example.app.pro.annual',
      'apple com.example.app.pro.monthly',
      'google pro_annual',
      'google pro_monthly',
      'stripe price_pro_annual',
      'stripe price_pro_monthly',
    ], 'pro is granted by six SKUs across two packages');
    assertEqual(byEntitlement.plus.slice().sort(), [
      'apple com.example.app.plus.monthly',
      'google plus_monthly',
      'stripe price_plus_monthly',
    ], 'plus is granted by one package across three stores');
    // The consumable's absence from this table is what makes it a consumable —
    // now expressed one level down, at each of its three SKUs.
    const coinSkus = [SKU.apple.coins_100, SKU.google.coins_100, SKU.stripe.coins_100];
    assertEqual(
      rows.filter((r) => coinSkus.includes(r.productId)),
      [],
      'no coins_100 SKU grants anything',
    );
    assertEqual(
      Object.keys(rows[0]).sort(),
      ['entitlementId', 'productId', 'store'],
      'projected shape carries the compound SKU identity',
    );
    return { mappings: rows.length };
  });

  await suite.check('no purchase means no entitlement', async () => {
    assertEqual(await activeEntitlementIds(ADA), [], 'ada starts with no entitlements');
  });

  await suite.check('validateReceipt: action -> mutation -> transaction + grant', async () => {
    const before = store.requests.length;
    const res = await validate({
      productId: SKU.apple.pro_monthly,
      store: 'apple',
      receipt: 'receipt_ada_1',
      environment: 'sandbox',
    }, ADA);
    assert(res.ok, `validateReceipt failed: ${JSON.stringify(res.diagnostic)}`);
    assertEqual(res.result.storeTxnId, 'apple:receipt_ada_1', 'store transaction id');
    assertEqual(res.result.status, 'active', 'store reported an active transaction');
    assertEqual(res.result.deduped, false, 'first delivery is not a dedupe');
    assertEqual(res.result.expiresAt, store.now + store.thirtyDaysMs, 'store-reported expiry');
    // The action really left the process: the store saw an authorized call.
    const calls = store.requests.slice(before);
    assertEqual(calls.length, 1, 'exactly one outbound call');
    assertEqual(calls[0].path, '/validate', 'called the validate route');
    assertEqual(calls[0].authorized, true, 'carried the granted credential');
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
        productId: SKU.apple.pro_monthly,
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
    const replay = await validate({
      productId: SKU.apple.pro_monthly,
      store: 'apple',
      receipt: 'receipt_ada_1',
      environment: 'sandbox',
    }, ADA);
    assert(replay.ok, `replay failed: ${JSON.stringify(replay.diagnostic)}`);
    assertEqual(replay.result.deduped, true, 'replayed receipt deduped');
    assertEqual(await activeEntitlementIds(ADA), ['pro'], 'still exactly one entitlement');
  });

  await suite.check('the store, not the caller, decides the environment', async () => {
    // The caller asks the sandbox endpoint; the store answers `production`.
    // What lands in the transaction must be the store's answer.
    store.setState('apple:receipt_env_authority', {
      productId: SKU.apple.pro_monthly,
      status: 'active',
      environment: 'production',
    });
    const res = await validate({
      productId: SKU.apple.pro_monthly,
      store: 'apple',
      receipt: 'receipt_env_authority',
      environment: 'sandbox',
    }, DANA);
    assert(res.ok, `validateReceipt failed: ${JSON.stringify(res.diagnostic)}`);
    assertEqual(res.result.environment, 'production', 'store environment overrides the request');
    return res.result;
  });

  await suite.check('a store-reported expired receipt grants nothing', async () => {
    store.setState('apple:receipt_born_expired', {
      productId: SKU.apple.pro_monthly,
      status: 'expired',
      environment: 'sandbox',
      expiresAt: store.now - 1_000,
    });
    const res = await validate({
      productId: SKU.apple.pro_monthly,
      store: 'apple',
      receipt: 'receipt_born_expired',
      environment: 'sandbox',
    }, EVE);
    assert(res.ok, `validateReceipt failed: ${JSON.stringify(res.diagnostic)}`);
    assertEqual(res.result.status, 'expired', 'store reported expired');
    // The transaction is recorded, but an expired store answer is not a grant.
    assertEqual(await activeEntitlementIds(EVE), [], 'no entitlement from an expired receipt');
  });

  await suite.check('a bad store credential fails the action and writes nothing', async () => {
    const before = await activeEntitlementIds(DANA);
    await setStoreKey(WRONG_STORE_KEY);
    try {
      // An action reports a handler failure as a structured envelope rather
      // than throwing at the client, so assert on the envelope.
      const res = await validate({
        productId: SKU.apple.pro_monthly,
        store: 'apple',
        receipt: 'receipt_bad_key',
        environment: 'sandbox',
      }, DANA);
      assertEqual(res.ok, false, 'a 401 from the store must fail the action');
      // The store saw the call and refused it.
      const last = store.requests[store.requests.length - 1];
      assertEqual(last.path, '/validate', 'the refused call reached the store');
      assertEqual(last.authorized, false, 'store rejected the credential');
      assertEqual(await activeEntitlementIds(DANA), before, 'a refused validation grants nothing');
      // Neither the wrong key nor the real one may appear in the envelope.
      const envelope = JSON.stringify(res.diagnostic ?? {});
      assert(!envelope.includes(WRONG_STORE_KEY), 'diagnostic must not carry credential bytes');
      assert(!envelope.includes(STORE_KEY), 'diagnostic must not carry credential bytes');
      return { code: res.diagnostic?.code ?? null };
    } finally {
      await setStoreKey(STORE_KEY);
    }
  });

  await suite.check('the restored credential works again', async () => {
    const res = await validate({
      productId: SKU.apple.pro_monthly,
      store: 'apple',
      receipt: 'receipt_after_restore',
      environment: 'sandbox',
    }, DANA);
    assert(res.ok, `validateReceipt failed after restore: ${JSON.stringify(res.diagnostic)}`);
    assertEqual(res.result.status, 'active', 'store answered normally again');
  });

  await suite.check('a live subscriber sees a purchase land in realtime', async () => {
    const live = await db.liveQuery(api.getEntitlements, { connectionId: 'grace_app', userId: GRACE });
    assertEqual(live.rows.length, 0, 'grace starts empty');
    await validate({
      productId: SKU.google.pro_monthly,
      store: 'google',
      receipt: 'receipt_grace_1',
      environment: 'sandbox',
    }, GRACE);
    const rows = await live.poll();
    assertEqual(rows.map((r) => r.entitlementId), ['pro'], 'grace received the grant over the live lane');
    return { rows: rows.length };
  });

  await suite.check('recordPurchase rejects an unknown environment', async () => {
    const before = await activeEntitlementIds(DANA);
    await assertThrows(
      () => db.mutate(api.recordPurchase, {
        args: {
          productId: SKU.apple.pro_monthly,
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

  // --- Slice 3: the notification path ------------------------------------------

  await suite.check('applyStoreState re-fetches instead of trusting its trigger', async () => {
    // Frank buys pro_monthly the ordinary way.
    await validate({
      productId: SKU.apple.pro_monthly,
      store: 'apple',
      receipt: 'receipt_frank_1',
      environment: 'sandbox',
    }, FRANK);
    assertEqual(await activeEntitlementIds(FRANK), ['pro'], 'frank holds pro');

    const before = store.requests.length;
    const res = await notify({ userId: FRANK, store: 'apple', storeTxnId: 'apple:receipt_frank_1' });
    assert(res.ok, `applyStoreState failed: ${JSON.stringify(res.diagnostic)}`);

    // The action learned the status by asking, not from its arguments.
    const calls = store.requests.slice(before);
    assertEqual(calls.length, 1, 'exactly one outbound lookup');
    assertEqual(calls[0].method, 'GET', 'read the transaction back');
    assertEqual(calls[0].path, '/transactions/apple:receipt_frank_1', 'looked up the named transaction');
    assertEqual(res.result.status, 'active', 'store still reports active');
    assertEqual(res.result.changed, false, 'nothing moved, so nothing changed');
    return { calls: calls.length };
  });

  await suite.check('a store flip to expired revokes through the notification, not the cron', async () => {
    // The store changes its mind out of band. Nothing tells Snapback what the
    // new state is — the notification only names the transaction.
    store.setState('apple:receipt_frank_1', {
      status: 'expired',
      expiresAt: store.now - 1_000,
    });
    const res = await notify({ userId: FRANK, store: 'apple', storeTxnId: 'apple:receipt_frank_1' });
    assert(res.ok, `applyStoreState failed: ${JSON.stringify(res.diagnostic)}`);
    assertEqual(res.result.status, 'expired', 'store now reports expired');
    assertEqual(res.result.changed, true, 'the grant moved');
    assertEqual(await activeEntitlementIds(FRANK), [], 'pro revoked without a scheduler tick');

    // Prove the cron had nothing to do with it.
    const job = await cronJob('expireGrants');
    assertEqual(job.lastRunAtMs, null, 'no scheduler run has happened yet');
    return { status: res.result.status };
  });

  await suite.check('applyStoreState twice over the same state is a no-op', async () => {
    const first = await notify({ userId: FRANK, store: 'apple', storeTxnId: 'apple:receipt_frank_1' });
    assert(first.ok, 'repeat applyStoreState failed');
    assertEqual(first.result.changed, false, 'second reconcile changes nothing');
    const second = await notify({ userId: FRANK, store: 'apple', storeTxnId: 'apple:receipt_frank_1' });
    assert(second.ok, 'third applyStoreState failed');
    assertEqual(second.result.changed, false, 'third reconcile changes nothing');
    assertEqual(await activeEntitlementIds(FRANK), [], 'still revoked');
  });

  await suite.check('a second product for the same entitlement keeps it alive', async () => {
    // Hank holds pro through BOTH pro_monthly and pro_annual. Losing one must
    // not lose the entitlement — that is the whole point of deriving grants
    // from transactions rather than assigning them per purchase.
    await validate({
      productId: SKU.apple.pro_monthly,
      store: 'apple',
      receipt: 'receipt_hank_monthly',
      environment: 'sandbox',
    }, HANK);
    await validate({
      productId: SKU.apple.pro_annual,
      store: 'apple',
      receipt: 'receipt_hank_annual',
      environment: 'sandbox',
    }, HANK);
    assertEqual(await activeEntitlementIds(HANK), ['pro'], 'one entitlement from two products');

    store.setState('apple:receipt_hank_monthly', {
      status: 'expired',
      expiresAt: store.now - 1_000,
    });
    const res = await notify({ userId: HANK, store: 'apple', storeTxnId: 'apple:receipt_hank_monthly' });
    assert(res.ok, `applyStoreState failed: ${JSON.stringify(res.diagnostic)}`);
    assertEqual(res.result.changed, false, 'the annual subscription still justifies pro');
    assertEqual(await activeEntitlementIds(HANK), ['pro'], 'pro survives losing one of its products');

    // Now take the other one away.
    store.setState('apple:receipt_hank_annual', {
      status: 'expired',
      expiresAt: store.now - 1_000,
    });
    const second = await notify({ userId: HANK, store: 'apple', storeTxnId: 'apple:receipt_hank_annual' });
    assert(second.ok, 'second applyStoreState failed');
    assertEqual(second.result.changed, true, 'losing the last justification moves the grant');
    assertEqual(await activeEntitlementIds(HANK), [], 'pro gone once nothing justifies it');
  });

  await suite.check("a reconcile leaves another user's unrelated entitlement alone", async () => {
    // Grace holds plus. Frank's and Hank's reconciles above must not have
    // touched it, and neither must the next one.
    await validate({
      productId: SKU.stripe.plus_monthly,
      store: 'stripe',
      receipt: 'receipt_grace_plus',
      environment: 'sandbox',
    }, GRACE);
    const graceBefore = await activeEntitlementIds(GRACE);
    assertEqual(graceBefore, ['plus', 'pro'], 'grace holds plus alongside pro');
    const graceGrantBefore = await grantFor(GRACE, 'plus');

    await validate({
      productId: SKU.apple.pro_monthly,
      store: 'apple',
      receipt: 'receipt_frank_2',
      environment: 'sandbox',
    }, FRANK);
    store.setState('apple:receipt_frank_2', {
      status: 'revoked',
      expiresAt: store.now - 1_000,
    });
    const res = await notify({ userId: FRANK, store: 'apple', storeTxnId: 'apple:receipt_frank_2' });
    assert(res.ok, `applyStoreState failed: ${JSON.stringify(res.diagnostic)}`);
    assertEqual(await activeEntitlementIds(FRANK), [], 'refund revoked frank');

    const graceGrantAfter = await grantFor(GRACE, 'plus');
    assertEqual(await activeEntitlementIds(GRACE), graceBefore, "grace's entitlements untouched");
    assertEqual(graceGrantAfter._version, graceGrantBefore._version, "grace's plus grant was not rewritten");
    return { graceVersion: graceGrantAfter._version };
  });

  await suite.check('a notification cannot claim another user\'s transaction', async () => {
    // Dana legitimately holds pro from her own purchase; the point is that
    // naming Frank's transaction changes nothing for her either way.
    const before = await activeEntitlementIds(DANA);
    const res = await notify({ userId: DANA, store: 'apple', storeTxnId: 'apple:receipt_frank_1' });
    assertEqual(res.ok, false, 'a mismatched userId must be refused');
    assertEqual(await activeEntitlementIds(DANA), before, 'the claimant gains nothing');
    assertEqual(await activeEntitlementIds(FRANK), [], 'the owner is unaffected too');
    return { code: res.diagnostic?.code ?? null };
  });

  // --- Slice 4: the outbound change feed ---------------------------------------

  await suite.check('a granting purchase appends a purchase event then its entitlement event', async () => {
    const cursor = await changeCursor();
    await validate({
      productId: SKU.stripe.plus_monthly,
      store: 'stripe',
      receipt: 'receipt_jo_plus',
      environment: 'sandbox',
    }, JO);
    const page = await pollChanges(cursor);
    // Two types, one sequence, causal order (slice 13): the purchase is what
    // happened, the entitlement change is what it caused.
    assertEqual(page.map((row) => row.type), ['purchase', 'entitlement'], 'both events, in causal order');
    assert(page.every((row) => row.userId === JO), 'both name the user');
    assert(page[0].seq > cursor, 'seq advanced past the cursor');
    assertEqual(page[1].seq, page[0].seq + 1, 'consecutive positions in ONE shared sequence');

    // Polling again from the last seq we were handed returns nothing.
    assertEqual(await pollChanges(page[1].seq), [], 'the cursor drains the feed');
    return { seqs: page.map((row) => row.seq) };
  });

  await suite.check('pollChanges carries a type and no entitlement state', async () => {
    // The whole point of decision 20: the developer learns WHO changed and
    // WHICH read to perform, then re-reads our authoritative answer. Anything
    // more here would be state they could act on stale.
    const rows = await pollChanges(0);
    assert(rows.length > 0, 'feed is non-empty, so this check is not vacuous');
    for (const row of rows) {
      assertEqual(Object.keys(row).sort(), ['seq', 'type', 'userId'], 'change row shape');
      assert(row.type === 'entitlement' || row.type === 'purchase', `unknown type ${row.type}`);
    }
    // And the read path they are pushed toward still works.
    assertEqual(await activeEntitlementIds(JO), ['plus'], 'developer re-reads authoritative state');
    return { rows: rows.length };
  });

  await suite.check('a no-op reconcile appends nothing to the feed', async () => {
    const cursor = await changeCursor();
    // Jo's transaction has not changed at the store, so this reconciles to the
    // same answer.
    const first = await notify({ userId: JO, store: 'stripe', storeTxnId: 'stripe:receipt_jo_plus' });
    assert(first.ok, `applyStoreState failed: ${JSON.stringify(first.diagnostic)}`);
    assertEqual(first.result.changed, false, 'nothing moved');
    assertEqual(await pollChanges(cursor), [], 'a no-op reconcile is silent');

    // A real move does append, so the silence above is not just a dead feed.
    store.setState('stripe:receipt_jo_plus', {
      status: 'revoked',
      expiresAt: store.now - 1_000,
    });
    const second = await notify({ userId: JO, store: 'stripe', storeTxnId: 'stripe:receipt_jo_plus' });
    assertEqual(second.result.changed, true, 'the refund moved the grant');
    const page = await pollChanges(cursor);
    assertEqual(page.length, 1, 'exactly one change for the real move');
    assertEqual(page[0].userId, JO, 'named the right user');
  });

  // --- Slice 5: real outbound delivery -----------------------------------------

  await suite.check('no registered endpoint means no delivery is scheduled', async () => {
    // Everything so far ran with no webhook registered, so the feed has been
    // filling without ever scheduling a ping.
    //
    // Scoped to notifyDeveloper rather than asserting the whole queue is empty.
    // The claim is about DELIVERY, and slice 8 legitimately puts acknowledgement
    // jobs on the same queue — an unrelated obligation that has nothing to do
    // with whether a developer endpoint is registered.
    const jobs = await admin.listJobs();
    const queued = jobs.jobs ?? jobs.rows ?? [];
    assertEqual(
      queued.filter((job) => job.action === 'notifyDeveloper'),
      [],
      'no delivery enqueued before registration',
    );
    assertEqual(developer.received.length, 0, 'developer heard nothing');
  });

  await suite.check('a change enqueues a delivery transactionally with the feed row', async () => {
    await db.mutate(api.registerWebhookEndpoint, { args: { url: developer.url }, userId: JO });
    const cursor = await changeCursor();

    const commit = await db.mutate(api.recordPurchase, {
      args: {
        productId: SKU.stripe.plus_monthly,
        store: 'stripe',
        storeTxnId: 'stripe:receipt_mia_plus',
        status: 'active',
        environment: 'sandbox',
        expiresAt: Date.now() + 86_400_000,
      },
      userId: MIA,
    });
    assertEqual(commit.result.grants, 1, 'the purchase moved a grant');

    // The mutation receipt carries the enqueues: the feed rows and the jobs
    // landed in the same commit, so a rollback could not have left one behind.
    // TWO of each since slice 13 — one doorbell per feed position, which is the
    // invariant `idempotencyKey: 'change:' + seq` has always encoded.
    const enqueues = commit.enqueues ?? commit.receipt?.enqueues ?? [];
    assertEqual(enqueues.length, 2, `expected two enqueues on the receipt, got ${JSON.stringify(commit)}`);
    assert(enqueues.every((e) => e.action === 'notifyDeveloper'), 'the enqueued action');

    const page = await pollChanges(cursor);
    assertEqual(page.map((row) => row.type), ['purchase', 'entitlement'], 'two feed rows');
    assert(page.every((row) => row.userId === MIA), 'for the right user');
    // Still not delivered — the worker is inert until the suite drains.
    assertEqual(developer.received.length, 0, 'nothing sent before the drain');
    return { jobId: enqueues[0].jobId, seq: page[0].seq };
  });

  await suite.check('draining delivers a ping carrying only userId and seq', async () => {
    const before = await changeCursor();
    await drain();
    // One doorbell per feed position, so Mia's purchase produced two.
    assertEqual(developer.received.length, 2, 'one delivery per feed position');
    for (const ping of developer.received) {
      assertEqual(ping.authorized, true, 'presented the shared secret');
      assertEqual(ping.outcome, 200, 'endpoint accepted it');
      // The ping body deliberately did NOT gain the type: it is a doorbell, and
      // the developer polls from their own cursor to learn what happened. Adding
      // the type here would be the first piece of state on the wire.
      assertEqual(Object.keys(ping.body).sort(), ['seq', 'userId'], 'ping body shape');
      assertEqual(ping.body.userId, MIA, 'named the user whose access moved');
    }
    assertEqual(
      developer.received.map((p) => p.body.seq).sort((a, b) => a - b),
      [before - 1, before],
      'named the two feed positions',
    );

    const deliveries = await db.query(api.listDeliveries, {});
    const last = deliveries.rows[deliveries.rows.length - 1];
    assertEqual(last.outcome, 'delivered', 'ledger records success');
    assertEqual(last.attempt, 1, 'first attempt');
    assertEqual(last.status, 200, 'ledger records the status');
    // Delivering must not itself be a change.
    assertEqual(await pollChanges(before), [], 'the ping did not append to the feed');
    return { pings: developer.received.length };
  });

  await suite.check('a failing endpoint is retried until it succeeds', async () => {
    developer.reset();
    developer.failNext(2);
    // A CONSUMABLE purchase, deliberately: it emits exactly one feed event (the
    // purchase), so exactly one delivery job exists and its retry ladder is
    // deterministic. A granting purchase would enqueue two jobs and interleave
    // two ladders through one global failNext budget. It also proves the
    // slice-13 purchase event rides the same outbox as an entitlement change.
    await db.mutate(api.recordPurchase, {
      args: {
        productId: SKU.stripe.coins_100,
        store: 'stripe',
        storeTxnId: 'stripe:receipt_nia_coins',
        status: 'active',
        environment: 'sandbox',
      },
      userId: NIA,
    });

    // Three successive virtual moments: fail, fail, succeed.
    await drain(4);

    const attempts = developer.received;
    assert(attempts.length >= 3, `expected retries, saw ${attempts.length} attempts`);
    assertEqual(attempts[0].outcome, 503, 'first attempt refused');
    assertEqual(attempts[attempts.length - 1].outcome, 200, 'final attempt accepted');
    // Every attempt carried the same payload — a retry is not a new event.
    for (const attempt of attempts) {
      assertEqual(Object.keys(attempt.body).sort(), ['seq', 'userId'], 'retry body shape');
      assertEqual(attempt.body.userId, NIA, 'same user throughout');
    }

    const ledger = (await db.query(api.listDeliveries, {})).rows
      .filter((row) => row.userId === NIA);
    assertEqual(ledger.map((row) => row.outcome), ['failed', 'failed', 'delivered'], 'the retry ladder is recorded');
    assertEqual(ledger.map((row) => row.attempt), [1, 2, 3], 'attempts are numbered');
    return { attempts: attempts.length };
  });

  await suite.check('a permanently failing endpoint stops after maxAttempts', async () => {
    developer.reset();
    developer.failAlways(true);
    try {
      await db.mutate(api.recordPurchase, {
        args: {
          productId: SKU.stripe.pro_monthly,
          store: 'stripe',
          storeTxnId: 'stripe:receipt_omar_pro',
          status: 'active',
          environment: 'sandbox',
          expiresAt: Date.now() + 86_400_000,
        },
        userId: OMAR,
      });
      await drain(10);

      // Omar's granting purchase emits two events and therefore two delivery
      // jobs, each with its OWN ladder. Scoping to one feed position is what
      // keeps this a statement about maxAttempts rather than about how many
      // events a purchase happens to produce.
      const feed = (await pollChanges(0)).filter((row) => row.userId === OMAR);
      assertEqual(feed.map((row) => row.type), ['purchase', 'entitlement'],
        'both events are still pollable after delivery gave up');
      const entitlementSeq = feed[1].seq;
      const ledger = (await db.query(api.listDeliveries, {})).rows
        .filter((row) => row.userId === OMAR && row.seq === entitlementSeq);
      assertEqual(ledger.length, 5, 'stopped at the declared maxAttempts of 5');
      assert(ledger.every((row) => row.outcome === 'failed'), 'every attempt failed');
      assertEqual(ledger.map((row) => row.attempt), [1, 2, 3, 4, 5], 'attempts are numbered');

      // The change itself survived the failed delivery: the feed is the
      // authoritative mechanism and the ping is only a hint.
      assertEqual(await activeEntitlementIds(OMAR), ['pro'], 'and the entitlement is real');
      return { attempts: ledger.length };
    } finally {
      developer.failAlways(false);
    }
  });

  await suite.check('a no-op reconcile schedules no delivery', async () => {
    developer.reset();
    // Mia's transaction was committed directly, so teach the store the same
    // state; reconciling against it must then be a no-op.
    store.setState('stripe:receipt_mia_plus', {
      productId: SKU.stripe.plus_monthly,
      status: 'active',
      environment: 'sandbox',
      expiresAt: (await grantFor(MIA, 'plus')).activeUntil,
    });
    const cursor = await changeCursor();
    const res = await notify({ userId: MIA, store: 'stripe', storeTxnId: 'stripe:receipt_mia_plus' });
    assert(res.ok, `applyStoreState failed: ${JSON.stringify(res.diagnostic)}`);
    assertEqual(res.result.changed, false, 'nothing moved');
    await drain(2);
    assertEqual(developer.received.length, 0, 'silence on the wire, not just in the feed');
    assertEqual(await pollChanges(cursor), [], 'and nothing in the feed either');
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
    // Three users whose windows already closed, so one sweep has something
    // unambiguous to find and the next check can assert on what it emitted.
    // (Reusing a user who holds a second, still-valid transaction for the same
    // entitlement would correctly NOT expire — grants derive from every
    // transaction, not the latest one.)
    //
    // An everyMs job is due exactly once per interval, so the suite gets one
    // meaningful forced tick per minute of wall clock: this is that tick, and
    // the feed check below reads its output rather than forcing another.
    for (const [userId, receipt] of [
      [IVY, 'receipt_ivy_expired'],
      [KIT, 'receipt_kit_expired'],
      [LEO, 'receipt_leo_expired'],
    ]) {
      await db.mutate(api.recordPurchase, {
        args: {
          productId: SKU.stripe.pro_monthly,
          store: 'stripe',
          storeTxnId: `stripe:${receipt}`,
          status: 'active',
          environment: 'sandbox',
          expiresAt: Date.now() - 1_000,
        },
        userId,
      });
    }
    assertEqual(await activeEntitlementIds(IVY), ['pro'], 'ivy holds pro before the sweep');
    sweepCursor = await changeCursor();

    await db.cronTick();

    assertEqual(await activeEntitlementIds(IVY), [], 'the expired grant is gone from the read model');
    assertEqual(await activeEntitlementIds(ADA), ['pro'], 'an unexpired grant survives the same sweep');
    // The run ledger must record a real run, so a tick that silently did
    // nothing cannot pass this check on the strength of the reads above.
    const job = await cronJob('expireGrants');
    assertEqual(job.lastOutcome, 'Succeeded', 'the scheduler recorded a successful run');
    assert(job.lastRunAtMs > 0, 'the run ledger stamped the run');
    return { lastOutcome: job.lastOutcome, lastRunAtMs: job.lastRunAtMs };
  });

  await suite.check('the expiry sweep participates in the feed, one seq per user', async () => {
    // Reads the tick the previous check drove. All three users expired in one
    // commit; sharing a commit must not mean sharing a cursor position, or a
    // poller resuming mid-sweep would lose the later users forever.
    const page = await pollChanges(sweepCursor);
    assertEqual(page.map((r) => r.userId).sort(), [IVY, KIT, LEO], 'every swept user appears');
    assertEqual(new Set(page.map((r) => r.seq)).size, page.length, 'distinct seqs within one sweep');
    assertEqual(await activeEntitlementIds(KIT), [], 'kit expired');
    assertEqual(await activeEntitlementIds(LEO), [], 'leo expired');
    return { seqs: page.map((r) => r.seq) };
  });

  await suite.check('the feed is monotonic and dense across every writer', async () => {
    // purchase path, notification path, and sweep all mint from one counter.
    const rows = await pollChanges(0);
    const seqs = rows.map((r) => r.seq);
    assert(seqs.length > 0, 'feed is non-empty, so this check is not vacuous');
    assertEqual(seqs, [...seqs].sort((a, b) => a - b), 'ascending');
    assertEqual(new Set(seqs).size, seqs.length, 'no duplicate seq');
    assertEqual(seqs[0], 1, 'the feed starts at 1');
    assertEqual(seqs[seqs.length - 1], seqs.length, 'dense: every seq accounted for');
    return { changes: seqs.length };
  });

  // --- Slice 6: consumables -----------------------------------------------------
  //
  // Everything above sells subscriptions, where a purchase moves an entitlement.
  // A consumable is the opposite case: `coins_100` has no productEntitlements
  // row, so deriveGrant finds nothing to justify and the purchase writes a
  // transaction and stops there. The silence that follows — no grant, no feed
  // row, no ping — is the property, not an omission.
  //
  // Fixture artifact: the fake store stamps every new receipt with
  // `expiresAt = now + 30d`, so these consumable transactions carry an expiry a
  // real coin pack would not have. It is inert here — nothing derives a grant
  // from them, so nothing can expire.

  await suite.check('a consumable purchase records a transaction and grants nothing', async () => {
    // Grace already holds pro AND plus, so "granted nothing" is a claim about
    // an unchanged non-empty set, not about a user who never had anything.
    const before = await activeEntitlementIds(GRACE);
    assertEqual(before, ['plus', 'pro'], 'grace is fully entitled before buying coins');
    const purchasesBefore = await purchases(GRACE);

    const res = await validate({
      productId: SKU.apple.coins_100,
      store: 'apple',
      receipt: 'receipt_grace_coins_1',
      environment: 'sandbox',
    }, GRACE);
    assert(res.ok, `validateReceipt failed: ${JSON.stringify(res.diagnostic)}`);
    assertEqual(res.result.status, 'active', 'the store sold the coins');
    assertEqual(res.result.deduped, false, 'a first consumable buy is not a dedupe');

    // The transaction is real...
    const after = await purchases(GRACE);
    assertEqual(after.length, purchasesBefore.length + 1, 'exactly one new transaction');
    const coins = after.filter((row) => row.productId === SKU.apple.coins_100);
    assertEqual(coins.length, 1, 'the coin purchase is in the audit');
    assertEqual(coins[0].storeTxnId, 'apple:receipt_grace_coins_1', 'recorded under the store id');
    // ...and it granted nothing.
    assertEqual(await activeEntitlementIds(GRACE), before, 'entitlements are untouched');
    return { purchases: after.length };
  });

  await suite.check('a consumable purchase emits a purchase event and no entitlement event', async () => {
    // No entitlement moved, so there is nothing for a developer to re-read.
    // A feed row here would be a false wake-up on every coin pack sold.
    const cursor = await changeCursor();
    const res = await validate({
      productId: SKU.apple.coins_100,
      store: 'apple',
      receipt: 'receipt_grace_coins_2',
      environment: 'sandbox',
    }, GRACE);
    assert(res.ok, `validateReceipt failed: ${JSON.stringify(res.diagnostic)}`);
    // Slice 13 changed exactly one thing here: a consumable is no longer SILENT.
    // It emits one 'purchase' event and still no 'entitlement' event, because
    // nothing about the user's access moved. Before this, a paying customer
    // could produce no outbound signal at all and a developer polling the feed
    // could not distinguish the purchase from nothing happening.
    const page = await pollChanges(cursor);
    assertEqual(page.map((row) => row.type), ['purchase'], 'exactly one purchase event');
    assertEqual(page[0].userId, GRACE, 'naming the buyer');
    assertEqual(res.result.deduped, false, 'and it really was a new purchase, not a no-op');
  });

  await suite.check('consumables are repeatable: two buys are two transactions', async () => {
    // Re-purchase is normal for a consumable, so the dedupe that protects a
    // re-delivered subscription must not collapse two genuine coin packs into
    // one. Distinct receipts mean distinct storeTxnIds, which is the whole
    // mechanism — dedupe is keyed on the store's identity, not the product.
    const before = (await purchases(GRACE)).filter((row) => row.productId === SKU.apple.coins_100);
    assertEqual(before.length, 2, 'two coin packs bought so far');

    const third = await validate({
      productId: SKU.apple.coins_100,
      store: 'apple',
      receipt: 'receipt_grace_coins_3',
      environment: 'sandbox',
    }, GRACE);
    assert(third.ok, `validateReceipt failed: ${JSON.stringify(third.diagnostic)}`);
    assertEqual(third.result.deduped, false, 'a distinct receipt is a distinct purchase');

    const after = (await purchases(GRACE)).filter((row) => row.productId === SKU.apple.coins_100);
    assertEqual(after.length, 3, 'three coin packs recorded');
    assertEqual(new Set(after.map((row) => row.storeTxnId)).size, 3, 'three distinct store ids');

    // Dedupe still protects a RE-DELIVERED consumable: same receipt, no new row.
    const replay = await validate({
      productId: SKU.apple.coins_100,
      store: 'apple',
      receipt: 'receipt_grace_coins_3',
      environment: 'sandbox',
    }, GRACE);
    assertEqual(replay.result.deduped, true, 'the same receipt twice is still one purchase');
    assertEqual(
      (await purchases(GRACE)).filter((row) => row.productId === SKU.apple.coins_100).length,
      3,
      'a replay adds no fourth row',
    );
    return { coinPacks: after.length };
  });

  await suite.check('listPurchases is a user-scoped audit of store facts only', async () => {
    const rows = await purchases(GRACE);
    assert(rows.length > 0, 'grace has purchases, so this check is not vacuous');
    // The projection is the contract: store facts, nothing derived. An
    // entitlement field here would be a second answer to a question
    // getEntitlements already owns.
    for (const row of rows) {
      assertEqual(
        Object.keys(row).sort(),
        [
          // Slice 8 added the two acknowledgement facts. Still store facts, so
          // the audit's "nothing derived" contract holds.
          'ackState', 'createdAt', 'environment', 'fulfillmentState', 'productId',
          'refundState', 'serverAckRequired', 'status', 'store', 'storeTxnId',
        ],
        'purchase row shape',
      );
      assert(row.createdAt > 0, 'the server stamped the row');
    }
    // Both halves of her history are here: subscriptions and consumables. The
    // audit names STORE SKUs (slice 12) — what the store actually told us was
    // bought — never the package those SKUs are grouped under.
    const products = new Set(rows.map((row) => row.productId));
    assert(products.has(SKU.apple.coins_100), 'the consumable buys are in the audit');
    assert(products.has(SKU.stripe.plus_monthly), 'so are the subscriptions');

    // Grace also holds the GOOGLE pro_monthly SKU, whose string is literally
    // `pro_monthly` — the same string as the package it belongs to. That is
    // realistic, and it is why `store` has to ride every row: productId alone
    // cannot say whether this is Google's SKU or somebody's package id, and
    // (store, productId) is the only thing that can.
    const googlePro = rows.filter((row) => row.productId === SKU.google.pro_monthly);
    assertEqual(googlePro.length, 1, 'the google SKU is in the audit');
    assertEqual(googlePro[0].store, 'google', 'and `store` is what disambiguates it');

    // Scoped to the caller: Ada's purchases are not in Grace's audit.
    const adaRows = await purchases(ADA);
    assert(adaRows.length > 0, 'ada has purchases of her own');
    const graceTxnIds = new Set(rows.map((row) => row.storeTxnId));
    for (const row of adaRows) {
      assert(!graceTxnIds.has(row.storeTxnId), `ada's ${row.storeTxnId} leaked into grace's audit`);
    }
    return { rows: rows.length, adaRows: adaRows.length };
  });

  await suite.check('a subscription still ticks the feed after the consumable path', async () => {
    // The guard on the two checks above: they prove silence, and silence is
    // only meaningful if the feed still speaks when an entitlement really moves.
    const cursor = await changeCursor();
    const res = await validate({
      productId: SKU.apple.pro_monthly,
      store: 'apple',
      receipt: 'receipt_pat_pro',
      environment: 'sandbox',
    }, PAT);
    assert(res.ok, `validateReceipt failed: ${JSON.stringify(res.diagnostic)}`);
    const page = await pollChanges(cursor);
    // Two events now: the purchase, then the entitlement it moved. The point of
    // this check is unchanged — the consumable path did not break the
    // subscription path's signalling.
    assertEqual(page.map((row) => row.type), ['purchase', 'entitlement'],
      'the subscription emits both events');
    assertEqual(page[0].userId, PAT, 'named the buyer');
    assertEqual(await activeEntitlementIds(PAT), ['pro'], 'and pat really holds pro');
    return { seq: page[0].seq };
  });

  // --- Slice 7: the normalized lifecycle ----------------------------------------
  //
  // Everything above treats a transaction as active or not. A real subscription
  // has more states than that, and the interesting ones are the middle: the
  // store is still trying to bill, or the user paused, or payment has not
  // cleared. Each of those is "no access" for a different reason, and only one
  // of them may ever be expired by a clock.
  //
  // The transitions come from scripted store states rather than one-off
  // setState calls, because every claim here is about MOVEMENT between states.
  // The suite cannot advance the real clock, so "time passed" is expressed by
  // moving a deadline into the past and letting the sweep notice.

  // The control buyer. Bought before the lifecycle churn starts; asserted
  // untouched after it ends. Registered here so isolation is a claim about a
  // grant that existed throughout, not one created afterwards.
  await validate({
    productId: SKU.stripe.plus_monthly,
    store: 'stripe',
    receipt: 'receipt_zoe_plus',
    environment: 'sandbox',
  }, ZOE);
  const zoeGrantBefore = await grantFor(ZOE, 'plus');

  await suite.check('grace keeps access ON past expiry, and the sweep leaves it', async () => {
    // The headline property. expiresAt is in the PAST — the paid window really
    // did close — and access is still on because graceUntil is in the future.
    // A model that keyed access off expiresAt alone would have dropped this
    // user the moment billing failed, which is the outage this slice prevents.
    store.script('apple:receipt_quinn_pro', 'active->grace->lapse', {
      productId: SKU.apple.pro_monthly,
      environment: 'sandbox',
    });
    const bought = await validate({
      productId: SKU.apple.pro_monthly,
      store: 'apple',
      receipt: 'receipt_quinn_pro',
      environment: 'sandbox',
    }, QUINN);
    assert(bought.ok, `validateReceipt failed: ${JSON.stringify(bought.diagnostic)}`);
    assertEqual(await activeEntitlementIds(QUINN), ['pro'], 'quinn starts fully active');
    assertEqual((await grantFor(QUINN, 'pro')).state, 'active', 'and the grant says so');

    // Billing fails: the store moves the transaction into grace.
    store.advance('apple:receipt_quinn_pro');
    const res = await notify({ userId: QUINN, store: 'apple', storeTxnId: 'apple:receipt_quinn_pro' });
    assert(res.ok, `applyStoreState failed: ${JSON.stringify(res.diagnostic)}`);
    assertEqual(res.result.status, 'grace', 'the store reports grace');

    const grant = await grantFor(QUINN, 'pro');
    assert(grant, 'the grant is still in the read model');
    assertEqual(grant.active, true, 'access is still ON during grace');
    assertEqual(grant.state, 'grace', 'and the read model names WHY it is on');
    // The horizon switched clocks: it is now graceUntil, not expiresAt.
    assertEqual(grant.activeUntil, store.now + store.sixtyDaysMs, 'the horizon is graceUntil');

    // The sweep must not touch a grace window that has not closed.
    await runSweep();
    assertEqual(await activeEntitlementIds(QUINN), ['pro'], 'the sweep left the open grace window alone');
    assertEqual((await grantFor(QUINN, 'pro')).state, 'grace', 'still in grace after a sweep');
    return { activeUntil: grant.activeUntil };
  });

  await suite.check('a lapsed grace window expires on the sweep, with a feed tick', async () => {
    // The other half: grace is a deadline, not an amnesty. Once graceUntil is
    // behind us the sweep is what notices — the store never sent a second
    // notification, which is exactly why the sweep has to exist.
    store.advance('apple:receipt_quinn_pro');
    const res = await notify({ userId: QUINN, store: 'apple', storeTxnId: 'apple:receipt_quinn_pro' });
    assert(res.ok, `applyStoreState failed: ${JSON.stringify(res.diagnostic)}`);
    assertEqual(res.result.status, 'grace', 'still grace at the store — only the deadline moved');
    // Access is still on at this instant: nothing has swept yet.
    assertEqual(await activeEntitlementIds(QUINN), ['pro'], 'access survives until a sweep runs');

    // Take the cursor AFTER the reconcile, so the tick asserted below is the
    // sweep's own and not the horizon change the reconcile already reported.
    const cursor = await changeCursor();
    const swept = await runSweep();
    assert(swept.expired >= 1, `the sweep expired something (${swept.expired})`);

    assertEqual(await activeEntitlementIds(QUINN), [], 'access is OFF once grace lapses');
    const page = await pollChanges(cursor);
    assertEqual(page.map((r) => r.userId), [QUINN], 'the sweep ticked the doorbell for quinn');
    return { expired: swept.expired, seq: page[0].seq };
  });

  await suite.check('grace recovering to active keeps access ON and ticks the state change', async () => {
    store.script('apple:receipt_rue_pro', 'active->grace->active', {
      productId: SKU.apple.pro_monthly,
      environment: 'sandbox',
    });
    await validate({
      productId: SKU.apple.pro_monthly,
      store: 'apple',
      receipt: 'receipt_rue_pro',
      environment: 'sandbox',
    }, RUE);
    store.advance('apple:receipt_rue_pro');
    await notify({ userId: RUE, store: 'apple', storeTxnId: 'apple:receipt_rue_pro' });
    assertEqual((await grantFor(RUE, 'pro')).state, 'grace', 'rue is in grace');

    // The card is replaced and billing succeeds.
    const cursor = await changeCursor();
    store.advance('apple:receipt_rue_pro');
    const res = await notify({ userId: RUE, store: 'apple', storeTxnId: 'apple:receipt_rue_pro' });
    assertEqual(res.result.changed, true, 'the recovery moved the grant');

    const grant = await grantFor(RUE, 'pro');
    assertEqual(grant.active, true, 'access never dropped across the recovery');
    assertEqual(grant.state, 'active', 'and it is fully active again');
    const page = await pollChanges(cursor);
    assertEqual(page.map((r) => r.userId), [RUE], 'the recovery is on the feed');
    return { state: grant.state, seq: page[0].seq };
  });

  await suite.check('retry_hold is access-OFF but the grant is retained, not expired', async () => {
    // The trap this state exists to avoid: retry_hold carries an expiresAt in
    // the PAST (the paid window closed) while the subscription is very much
    // alive. A date-only sweep would tear it down mid-recovery.
    store.script('apple:receipt_sam_pro', 'active->retry_hold->active', {
      productId: SKU.apple.pro_monthly,
      environment: 'sandbox',
    });
    await validate({
      productId: SKU.apple.pro_monthly,
      store: 'apple',
      receipt: 'receipt_sam_pro',
      environment: 'sandbox',
    }, SAM);
    // The row identity is the retention proof: if the sweep deleted the grant,
    // recovery would insert a NEW row with a different _id.
    const grantId = (await grantFor(SAM, 'pro'))._id;

    store.advance('apple:receipt_sam_pro');
    const held = await notify({ userId: SAM, store: 'apple', storeTxnId: 'apple:receipt_sam_pro' });
    assertEqual(held.result.status, 'retry_hold', 'the store is retrying payment');
    assertEqual(await activeEntitlementIds(SAM), [], 'access is OFF while payment retries');

    // Two sweeps, to be sure this is not an off-by-one survival.
    await runSweep();
    await runSweep();

    store.advance('apple:receipt_sam_pro');
    const recovered = await notify({ userId: SAM, store: 'apple', storeTxnId: 'apple:receipt_sam_pro' });
    assertEqual(recovered.result.status, 'active', 'payment finally cleared');
    const grant = await grantFor(SAM, 'pro');
    assertEqual(grant.active, true, 'access is back');
    assertEqual(grant.state, 'active', 'as a fully active grant');
    assertEqual(grant._id, grantId, 'the SAME grant row was reused — the sweep never deleted it');
    return { grantId: grant._id };
  });

  await suite.check('paused is access-OFF, survives the sweep, and resumes', async () => {
    // resumesAt is a future timestamp that is NOT a deadline. A sweep that
    // expired "anything with a horizon" would destroy every paused
    // subscription; a sweep that read resumesAt as an expiry would do it
    // backwards. Neither may happen.
    store.script('stripe:receipt_tara_plus', 'active->paused->active', {
      productId: SKU.stripe.plus_monthly,
      environment: 'sandbox',
    });
    await validate({
      productId: SKU.stripe.plus_monthly,
      store: 'stripe',
      receipt: 'receipt_tara_plus',
      environment: 'sandbox',
    }, TARA);
    const grantId = (await grantFor(TARA, 'plus'))._id;

    store.advance('stripe:receipt_tara_plus');
    const paused = await notify({ userId: TARA, store: 'stripe', storeTxnId: 'stripe:receipt_tara_plus' });
    assertEqual(paused.result.status, 'paused', 'the user paused the subscription');
    assertEqual(await activeEntitlementIds(TARA), [], 'a paused subscription grants nothing');
    // The store still knows when it comes back.
    assertEqual(
      store.getState('stripe:receipt_tara_plus').resumesAt,
      store.now + store.sixtyDaysMs,
      'the pause carries a future resume, not an expiry',
    );

    await runSweep();
    await runSweep();

    store.advance('stripe:receipt_tara_plus');
    await notify({ userId: TARA, store: 'stripe', storeTxnId: 'stripe:receipt_tara_plus' });
    const grant = await grantFor(TARA, 'plus');
    assertEqual(grant.active, true, 'resuming restores access');
    assertEqual(grant.state, 'active', 'fully active again');
    assertEqual(grant._id, grantId, 'the same grant row survived the pause and both sweeps');
    return { grantId: grant._id };
  });

  await suite.check('pending grants nothing and says nothing, then resolves either way', async () => {
    // Reuses slice 6's consumable empty-path shape: a transaction that maps to
    // no access derives no grant, so no ENTITLEMENT event is appended. Since
    // slice 13 the purchase itself is still announced — a pending purchase is a
    // recorded purchase — which is exactly the distinction the two event types
    // exist to draw.
    const cursor = await changeCursor();
    store.script('apple:receipt_uma_pro', 'pending->active', {
      productId: SKU.apple.pro_monthly,
      environment: 'sandbox',
    });
    const pending = await validate({
      productId: SKU.apple.pro_monthly,
      store: 'apple',
      receipt: 'receipt_uma_pro',
      environment: 'sandbox',
    }, UMA);
    assert(pending.ok, `validateReceipt failed: ${JSON.stringify(pending.diagnostic)}`);
    assertEqual(pending.result.status, 'pending', 'payment has not cleared');
    // A pending purchase has no window at all — not a zero-length one.
    assertEqual(pending.result.expiresAt ?? null, null, 'pending carries no expiry');
    assertEqual(await activeEntitlementIds(UMA), [], 'pending grants nothing');
    assertEqual(
      (await pollChanges(cursor)).map((row) => row.type),
      ['purchase'],
      'the purchase is announced; no entitlement event, because access did not move',
    );
    // The transaction itself IS recorded — silence is about access, not about
    // forgetting the purchase happened.
    assertEqual(
      (await purchases(UMA)).map((row) => row.status),
      ['pending'],
      'the pending transaction is in the audit',
    );

    // It clears: one grant, one tick.
    store.advance('apple:receipt_uma_pro');
    await notify({ userId: UMA, store: 'apple', storeTxnId: 'apple:receipt_uma_pro' });
    assertEqual(await activeEntitlementIds(UMA), ['pro'], 'clearing grants access');
    assertEqual((await grantFor(UMA, 'pro')).state, 'active', 'as an active grant');
    // From before the pending purchase: its own 'purchase' event, then the
    // 'entitlement' event the CLEARING produced. Exactly one entitlement tick,
    // and it belongs to the clearing — the pending purchase never moved access.
    const umaFeed = await pollChanges(cursor);
    assert(umaFeed.every((r) => r.userId === UMA), 'every event names uma');
    assertEqual(umaFeed.map((r) => r.type), ['purchase', 'entitlement'],
      'exactly one entitlement tick, for the clearing — not for the pending');

    // The other resolution: canceled before it ever cleared.
    const vicCursor = await changeCursor();
    store.script('apple:receipt_vic_pro', 'pending->canceled', {
      productId: SKU.apple.pro_monthly,
      environment: 'sandbox',
    });
    await validate({
      productId: SKU.apple.pro_monthly,
      store: 'apple',
      receipt: 'receipt_vic_pro',
      environment: 'sandbox',
    }, VIC);
    store.advance('apple:receipt_vic_pro');
    const canceled = await notify({ userId: VIC, store: 'apple', storeTxnId: 'apple:receipt_vic_pro' });
    // 'canceled' normalizes to 'revoked': a payment that never cleared did not
    // have a window close on it.
    assertEqual(canceled.result.status, 'revoked', 'a canceled pending purchase is revoked');
    assertEqual(await activeEntitlementIds(VIC), [], 'no grant was ever created');
    // The purchase is announced once, when it is recorded. Nothing after it
    // ticks: the pending->canceled path never moved access, so across the whole
    // path there is not one entitlement event.
    const vicFeed = await pollChanges(vicCursor);
    assertEqual(vicFeed.map((r) => r.type), ['purchase'],
      'the purchase is announced; the whole pending->canceled path moves no access');
    assertEqual(vicFeed[0].userId, VIC, 'naming the buyer');
    return { uma: 'active', vic: 'revoked' };
  });

  await suite.check('active outranks grace, and losing the active txn ticks on state alone', async () => {
    // Two products back `pro`. The grace one carries the LATER horizon on
    // purpose, so when the active one dies the access horizon does not move at
    // all — only `state` does. That isolates the reason `state` had to join the
    // change key: with a key of (active, activeUntil) this transition would be
    // completely silent, and "your payment is failing" is the most actionable
    // thing the feed carries.
    await validate({
      productId: SKU.apple.pro_monthly,
      store: 'apple',
      receipt: 'receipt_wes_monthly',
      environment: 'sandbox',
    }, WES);
    store.script('apple:receipt_wes_annual', 'active->grace->active', {
      productId: SKU.apple.pro_annual,
      environment: 'sandbox',
    });
    await validate({
      productId: SKU.apple.pro_annual,
      store: 'apple',
      receipt: 'receipt_wes_annual',
      environment: 'sandbox',
    }, WES);
    // Move only the annual product into grace.
    store.advance('apple:receipt_wes_annual');
    await notify({ userId: WES, store: 'apple', storeTxnId: 'apple:receipt_wes_annual' });

    const both = await grantFor(WES, 'pro');
    assertEqual(both.active, true, 'access is on');
    assertEqual(both.state, 'active', 'active outranks grace — no dunning for a paid-up user');
    const horizon = store.now + store.sixtyDaysMs;
    assertEqual(both.activeUntil, horizon, "the grace product's later horizon wins");

    // Now the monthly expires at the store, leaving only the grace product.
    const cursor = await changeCursor();
    store.setState('apple:receipt_wes_monthly', {
      status: 'expired',
      expiresAt: store.now - 1_000,
    });
    const res = await notify({ userId: WES, store: 'apple', storeTxnId: 'apple:receipt_wes_monthly' });
    assertEqual(res.result.changed, true, 'the grant moved');

    const graceOnly = await grantFor(WES, 'pro');
    assertEqual(graceOnly.active, true, 'access STAYS ON — the grace product still justifies it');
    assertEqual(graceOnly.state, 'grace', 'but the reason is now grace');
    assertEqual(graceOnly.activeUntil, horizon, 'and the horizon did not move at all');
    const page = await pollChanges(cursor);
    assertEqual(page.map((r) => r.userId), [WES], 'the state-only change still ticked the doorbell');
    return { state: graceOnly.state, activeUntil: graceOnly.activeUntil };
  });

  await suite.check('re-running applyStoreState over the same lifecycle state is a no-op', async () => {
    // Idempotency has to hold in the middle states too, not just for 'active'.
    // Sam recovered to active, Tara resumed to active, and Wes's annual product
    // is sitting in grace — so this covers both access-granting states.
    const cursor = await changeCursor();
    for (const [userId, storeName, storeTxnId] of [
      [SAM, 'apple', 'apple:receipt_sam_pro'],
      [TARA, 'stripe', 'stripe:receipt_tara_plus'],
      [WES, 'apple', 'apple:receipt_wes_annual'],
    ]) {
      const first = await notify({ userId, store: storeName, storeTxnId });
      assert(first.ok, `applyStoreState failed for ${userId}: ${JSON.stringify(first.diagnostic)}`);
      assertEqual(first.result.changed, false, `${userId}: re-reconcile moved nothing`);
      const second = await notify({ userId, store: storeName, storeTxnId });
      assertEqual(second.result.changed, false, `${userId}: still nothing on a third read`);
    }
    assertEqual(await pollChanges(cursor), [], 'six redundant reconciles appended zero feed rows');
    return { reconciles: 6 };
  });

  await suite.check('a swept grace window is re-granted by a redundant reconcile, then re-swept', async () => {
    // This documents a REAL limitation rather than hiding it, and the shape of
    // it is worth understanding before trusting the sweep.
    //
    // Derivation is deliberately time-agnostic: `deriveGrant` reads states and
    // horizons but never compares them to the clock, and the sweep is the single
    // horizon enforcer. That split is what makes the sweep meaningful — a
    // purchase can be written with a past horizon and still grant access until
    // something sweeps (see `ivy holds pro before the sweep`).
    //
    // The price: Quinn's transaction is still 'grace' at the store with a
    // graceUntil that has passed — a self-contradictory document a real store
    // would have moved to 'expired'. Re-reconciling it re-derives access the
    // sweep just retired, so the grant comes back until the next sweep.
    //
    // Bounded, not silent: the next sweep re-expires it, so the window is one
    // cron interval (60s declared). Asserting both halves here means a future
    // change that makes derivation time-aware will fail this check loudly
    // instead of quietly changing what the demo claims.
    assertEqual(await activeEntitlementIds(QUINN), [], 'quinn starts this check expired');

    const res = await notify({ userId: QUINN, store: 'apple', storeTxnId: 'apple:receipt_quinn_pro' });
    assert(res.ok, `applyStoreState failed: ${JSON.stringify(res.diagnostic)}`);
    assertEqual(res.result.status, 'grace', 'the store still reports the contradictory grace');
    assertEqual(
      await activeEntitlementIds(QUINN),
      ['pro'],
      'the redundant reconcile re-granted access (the documented wrinkle)',
    );
    assertEqual((await grantFor(QUINN, 'pro')).state, 'grace', 'as a grace grant again');

    // Self-healing: the very next sweep retires it again.
    const swept = await runSweep();
    assert(swept.expired >= 1, `the next sweep re-expired it (${swept.expired})`);
    assertEqual(await activeEntitlementIds(QUINN), [], 'access is off again after one sweep');
    return { reGranted: true, expired: swept.expired };
  });

  await suite.check('the whole lifecycle left the control buyer untouched', async () => {
    // Isolation across every transition above: Zoe bought before the churn and
    // never appears in any of it. Version equality is the strong form — not
    // merely "still active", but "never rewritten at all".
    const after = await grantFor(ZOE, 'plus');
    assert(after, 'zoe still holds her grant');
    assertEqual(await activeEntitlementIds(ZOE), ['plus'], "zoe's access is unchanged");
    assertEqual(after.state, 'active', 'and still active');
    assertEqual(after._version, zoeGrantBefore._version, "zoe's grant was never rewritten");
    assertEqual(after._id, zoeGrantBefore._id, 'and it is the same row');
    // The other long-lived holders are still intact too, so this is a claim
    // about the sweep and the reconciles at large, not just about one row.
    assertEqual(await activeEntitlementIds(ADA), ['pro'], 'ada survived every sweep');
    assertEqual(await activeEntitlementIds(GRACE), ['plus', 'pro'], 'grace is still fully entitled');
    return { version: after._version };
  });

  // --- Slice 8: acknowledgement as a store obligation ---------------------------
  //
  // Acknowledgement is not bookkeeping. Google auto-refunds the user and revokes
  // the purchase if it is not acknowledged within three days, and a consumable
  // must be CONSUMED before it can be bought again. So the ack is a correctness
  // requirement with a refund attached, and it gets the same reliability
  // machinery as the decision-20 webhook: enqueued inside the purchase's own
  // commit, with an idempotency key and a finite retry ladder.
  //
  // Only Google carries the obligation. Apple's ack is the client calling
  // StoreKit `finish`, and Stripe has no such concept — which is why every check
  // above, all apple/stripe, sits entirely outside this machinery.

  await suite.check('the ack lands before the deadline, so the deadline is harmless', async () => {
    const bought = await validate({
      productId: SKU.google.pro_monthly,
      store: 'google',
      receipt: 'receipt_anil_pro',
      environment: 'sandbox',
    }, ANIL);
    assert(bought.ok, `validateReceipt failed: ${JSON.stringify(bought.diagnostic)}`);
    assertEqual(await activeEntitlementIds(ANIL), ['pro'], 'anil holds pro');

    // Owed, and not yet met: the obligation is visible in our own audit.
    const before = await purchaseOf(ANIL, 'google:receipt_anil_pro');
    assertEqual(before.serverAckRequired, true, 'google purchases owe a server ack');
    assertEqual(before.ackState, 'pending', 'and it has not been sent yet');
    assertEqual(ackCalls('google:receipt_anil_pro').length, 0, 'nothing sent before the drain');

    // The job was enqueued in the purchase's commit; draining runs it.
    await drain();
    assertEqual(ackCalls('google:receipt_anil_pro').length, 1, 'exactly one acknowledgement call');
    assertEqual(
      store.getState('google:receipt_anil_pro').ackState,
      'acknowledged',
      'the STORE records the acknowledgement',
    );
    const after = await purchaseOf(ANIL, 'google:receipt_anil_pro');
    assertEqual(after.ackState, 'acknowledged', 'and so do we');

    // Now the three-day deadline passes. An acknowledged purchase is untouched.
    const revoked = store.elapseAckDeadline();
    assert(
      !revoked.includes('google:receipt_anil_pro'),
      `an acknowledged purchase must not be auto-refunded (revoked: ${JSON.stringify(revoked)})`,
    );
    // Proven by re-fetching rather than by trusting our own row.
    const res = await notify({ userId: ANIL, store: 'google', storeTxnId: 'google:receipt_anil_pro' });
    assert(res.ok, `applyStoreState failed: ${JSON.stringify(res.diagnostic)}`);
    assertEqual(res.result.status, 'active', 'the store still reports active past the deadline');
    assertEqual(await activeEntitlementIds(ANIL), ['pro'], 'the grant SURVIVES the deadline');
    return { ackState: after.ackState, deadlineMs: store.ackDeadlineMs };
  });

  await suite.check('a consumable is CONSUMED, which is what lets it be re-bought', async () => {
    // The operation is chosen from our catalog's `kind`, not from the store: an
    // unconsumed consumable cannot be purchased again, so picking plain
    // acknowledge here would silently cap the user at one coin pack forever.
    const first = await validate({
      productId: SKU.google.coins_100,
      store: 'google',
      receipt: 'receipt_bea_coins_1',
      environment: 'sandbox',
    }, BEA);
    assert(first.ok, `validateReceipt failed: ${JSON.stringify(first.diagnostic)}`);
    await drain();

    assertEqual(
      store.requests.filter((r) => r.path === '/consume/google:receipt_bea_coins_1').length,
      1,
      'the consume route was used, not acknowledge',
    );
    assertEqual(
      ackCalls('google:receipt_bea_coins_1').length,
      1,
      'and exactly one acknowledgement call was made',
    );
    assertEqual(
      store.getState('google:receipt_bea_coins_1').ackState,
      'consumed',
      'the store marks it consumed',
    );
    assertEqual(
      (await purchaseOf(BEA, 'google:receipt_bea_coins_1')).ackState,
      'consumed',
      'consumables land on consumed, not acknowledged',
    );
    // A consumable still grants no entitlement (slice 6 holds).
    assertEqual(await activeEntitlementIds(BEA), [], 'a consumable grants nothing');

    // Re-buy: a distinct receipt is a distinct storeTxnId, so this is a real
    // second purchase and not a dedupe no-op.
    const second = await validate({
      productId: SKU.google.coins_100,
      store: 'google',
      receipt: 'receipt_bea_coins_2',
      environment: 'sandbox',
    }, BEA);
    assert(second.ok, `validateReceipt failed: ${JSON.stringify(second.diagnostic)}`);
    assertEqual(second.result.deduped, false, 'the re-buy is a new transaction');
    await drain();

    const coins = (await purchases(BEA)).filter((row) => row.productId === SKU.google.coins_100);
    assertEqual(coins.length, 2, 'two coin packs recorded');
    assertEqual(new Set(coins.map((row) => row.storeTxnId)).size, 2, 'two distinct store ids');
    assertEqual(
      coins.map((row) => row.ackState),
      ['consumed', 'consumed'],
      'both were consumed, so a third purchase would also be possible',
    );
    return { coinPacks: coins.length };
  });

  await suite.check('a missed ack is auto-refunded by the store, and we reconcile it OFF', async () => {
    // The consequence the whole slice exists to avoid, made observable.
    const bought = await validate({
      productId: SKU.google.pro_monthly,
      store: 'google',
      receipt: 'receipt_chen_pro',
      environment: 'sandbox',
    }, CHEN);
    assert(bought.ok, `validateReceipt failed: ${JSON.stringify(bought.diagnostic)}`);
    assertEqual(await activeEntitlementIds(CHEN), ['pro'], 'chen holds pro to begin with');

    // The store refuses every acknowledgement attempt.
    store.suppressAck('google:receipt_chen_pro');
    // Drain past the finite ladder. The job dies; the obligation stays unmet.
    await drain(6);
    assert(
      ackCalls('google:receipt_chen_pro').length >= 2,
      `the engine really did try (${ackCalls('google:receipt_chen_pro').length} attempts)`,
    );
    assertEqual(
      store.getState('google:receipt_chen_pro').ackState,
      'pending',
      'the store never recorded an acknowledgement',
    );
    // The critical negative: a refused ack must NOT be recorded as sent. Marking
    // it optimistically is what would leave us believing we were safe while the
    // refund landed.
    assertEqual(
      (await purchaseOf(CHEN, 'google:receipt_chen_pro')).ackState,
      'pending',
      'and neither did we',
    );

    // Three days pass at the store.
    const revoked = store.elapseAckDeadline();
    assert(
      revoked.includes('google:receipt_chen_pro'),
      `the store auto-refunds the unacknowledged purchase (revoked: ${JSON.stringify(revoked)})`,
    );
    assertEqual(store.getState('google:receipt_chen_pro').autoRefunded, true, 'refunded, not merely expired');
    // Access is still on until we hear about it — the store never pushed.
    assertEqual(await activeEntitlementIds(CHEN), ['pro'], 'we do not know yet');

    // The re-fetch is how we find out, exactly as in slice 3.
    const res = await notify({ userId: CHEN, store: 'google', storeTxnId: 'google:receipt_chen_pro' });
    assert(res.ok, `applyStoreState failed: ${JSON.stringify(res.diagnostic)}`);
    assertEqual(res.result.status, 'revoked', 'the store reports the revoke');
    assertEqual(await activeEntitlementIds(CHEN), [], 'the grant is flipped OFF');
    return { revoked: revoked.length, attempts: ackCalls('google:receipt_chen_pro').length };
  });

  await suite.check('acknowledging twice is a no-op', async () => {
    // At-least-once delivery means a duplicate job is normal, not exceptional.
    // Acknowledgement is a fact about the past, so re-asserting it must change
    // nothing — and the guard lives in the mutation, the only place that can see
    // current state at commit time.
    await validate({
      productId: SKU.google.pro_annual,
      store: 'google',
      receipt: 'receipt_dev_annual',
      environment: 'sandbox',
    }, DEV);

    const firstRun = await db.action(api.acknowledgePurchase, {
      args: { storeTxnId: 'google:receipt_dev_annual', operation: 'acknowledge' },
      userId: DEV,
    });
    assert(firstRun.ok, `acknowledgePurchase failed: ${JSON.stringify(firstRun.diagnostic)}`);
    assertEqual(firstRun.result.changed, true, 'the first acknowledgement moved the row');
    assertEqual(
      (await purchaseOf(DEV, 'google:receipt_dev_annual')).ackState,
      'acknowledged',
      'recorded',
    );
    const versionAfterFirst = (await grantFor(DEV, 'pro'))._version;

    const secondRun = await db.action(api.acknowledgePurchase, {
      args: { storeTxnId: 'google:receipt_dev_annual', operation: 'acknowledge' },
      userId: DEV,
    });
    assert(secondRun.ok, `acknowledgePurchase failed: ${JSON.stringify(secondRun.diagnostic)}`);
    assertEqual(secondRun.result.changed, false, 'the second acknowledgement changed nothing');
    assertEqual(
      (await purchaseOf(DEV, 'google:receipt_dev_annual')).ackState,
      'acknowledged',
      'still acknowledged, not double-counted',
    );
    assertEqual((await grantFor(DEV, 'pro'))._version, versionAfterFirst, 'the grant was not rewritten');

    // The queued job for the same purchase is also still safe to run.
    await drain();
    assertEqual(
      (await purchaseOf(DEV, 'google:receipt_dev_annual')).ackState,
      'acknowledged',
      'and the queued job is a no-op too',
    );
    return { changedTwice: false };
  });

  await suite.check('an Apple purchase owes no server ack and none is sent', async () => {
    // Apple's acknowledgement is the client calling StoreKit `finish`. There is
    // no server endpoint to call, so a server that "acknowledged" would be
    // inventing a protocol. The adapter rule is what keeps us out of it.
    const bought = await validate({
      productId: SKU.apple.pro_monthly,
      store: 'apple',
      receipt: 'receipt_elif_pro',
      environment: 'sandbox',
    }, ELIF);
    assert(bought.ok, `validateReceipt failed: ${JSON.stringify(bought.diagnostic)}`);

    const row = await purchaseOf(ELIF, 'apple:receipt_elif_pro');
    assertEqual(row.serverAckRequired, false, 'no server ack is owed for apple');
    // Still 'pending', and that is correct: pending means "not acknowledged by
    // us", which for Apple is the permanent and expected state. The separate
    // boolean is what keeps it from reading as overdue.
    assertEqual(row.ackState, 'pending', 'ackState stays pending, which is not a debt here');

    const before = store.requests.length;
    await drain();
    assertEqual(ackCalls('apple:receipt_elif_pro').length, 0, 'no acknowledgement call was made');
    assertEqual(
      store.requests.slice(before).filter((r) => r.path.startsWith('/acknowledge/')
        || r.path.startsWith('/consume/')).length,
      0,
      'the drain sent no acknowledgement of any kind',
    );

    // And the deadline cannot touch it: only Google auto-refunds for a missing
    // server ack, so an unacknowledged Apple purchase is not at risk.
    const revoked = store.elapseAckDeadline();
    assert(
      !revoked.includes('apple:receipt_elif_pro'),
      `apple is exempt from the ack deadline (revoked: ${JSON.stringify(revoked)})`,
    );
    assertEqual(await activeEntitlementIds(ELIF), ['pro'], 'the grant is unaffected throughout');
    return { serverAckRequired: false, ackCalls: 0 };
  });

  // --- Slice 9: the after-sale money lifecycle ----------------------------------
  //
  // A sale is not final. Money can move back — voluntarily (the user asks and the
  // store agrees), involuntarily (a bank disputes the charge), and then move
  // forward again when either is reversed.
  //
  // Two things make this tractable. First, `refundState` is a SECOND axis:
  // `status` answers "does this grant access" and refundState answers "what is
  // happening to the money". A granted refund and an opened dispute both land on
  // status 'revoked', and only refundState says which. Access derives from status
  // alone, so nothing on the money axis can accidentally change what a user may
  // do. Second, every transition arrives the same way it has since slice 3: the
  // store changes its mind, and we find out by re-fetching. There is no new
  // mechanism here at all, which is the point.
  //
  // We never adjudicate. Every seam below is the STORE deciding.

  // The control buyer, registered before the churn so isolation is a claim about
  // a grant that existed throughout.
  await validate({
    productId: SKU.stripe.plus_monthly,
    store: 'stripe',
    receipt: 'receipt_kai_plus',
    environment: 'sandbox',
  }, KAI);
  const kaiGrantBefore = await grantFor(KAI, 'plus');

  // Apple's window is 12 hours; this is the compressed stand-in. Large enough
  // that the drain seam's injected clock (which advances two virtual minutes per
  // round) cannot push a response past the deadline and make an on-time answer
  // look late.
  const CONSUMPTION_WINDOW_MS = 3_600_000;
  const CONSUMPTION_ALARM_MS = 1_000;
  const openConsumption = (storeTxnId) => db.mutate(api.openConsumptionRequest, {
    args: {
      storeTxnId,
      windowMs: CONSUMPTION_WINDOW_MS,
      alarmDelayMs: CONSUMPTION_ALARM_MS,
    },
  });
  const consumptionRow = async (storeTxnId) => {
    const { rows } = await db.query(api.listConsumptionRequests, {});
    return rows.find((row) => row.storeTxnId === storeTxnId) ?? null;
  };

  await suite.check('a granted refund revokes access and records it on the money axis', async () => {
    // The regression half of slice 7's 'revoked': this already worked, and it
    // must keep working now that a second axis rides alongside it.
    await validate({
      productId: SKU.apple.pro_monthly,
      store: 'apple',
      receipt: 'receipt_farid_pro',
      environment: 'sandbox',
    }, FARID);
    assertEqual(await activeEntitlementIds(FARID), ['pro'], 'farid holds pro');
    assertEqual(
      (await purchaseOf(FARID, 'apple:receipt_farid_pro')).refundState,
      'none',
      'a fresh purchase has nothing happening to its money',
    );

    const cursor = await changeCursor();
    store.grantRefund('apple:receipt_farid_pro');
    const res = await notify({ userId: FARID, store: 'apple', storeTxnId: 'apple:receipt_farid_pro' });
    assert(res.ok, `applyStoreState failed: ${JSON.stringify(res.diagnostic)}`);
    assertEqual(res.result.status, 'revoked', 'the store revoked the purchase');
    assertEqual(res.result.refundState, 'granted', 'and says the refund was granted');

    assertEqual(await activeEntitlementIds(FARID), [], 'access is OFF');
    assertEqual(
      (await purchaseOf(FARID, 'apple:receipt_farid_pro')).refundState,
      'granted',
      'the money axis is recorded',
    );
    assertEqual(
      (await pollChanges(cursor)).map((r) => r.userId),
      [FARID],
      'the developer is told access moved',
    );
    return { refundState: res.result.refundState };
  });

  await suite.check('a reversal restores the access the refund removed, and ticks the feed', async () => {
    // The direction slices 1-8 never had. A reversal is not a new purchase — the
    // same transaction becomes good again, so the SAME grant row must come back
    // rather than a second one appearing beside it.
    assertEqual(await activeEntitlementIds(FARID), [], 'farid starts revoked');
    const revokedGrant = await db.query(api.getEntitlements, { userId: FARID });
    assertEqual(revokedGrant.rows.length, 0, 'and holds nothing');

    const cursor = await changeCursor();
    store.reverseRefund('apple:receipt_farid_pro');
    const res = await notify({ userId: FARID, store: 'apple', storeTxnId: 'apple:receipt_farid_pro' });
    assert(res.ok, `applyStoreState failed: ${JSON.stringify(res.diagnostic)}`);
    assertEqual(res.result.status, 'active', 'the purchase is good again');
    assertEqual(res.result.refundState, 'reversed', 'and the money came back');

    assertEqual(await activeEntitlementIds(FARID), ['pro'], 'access is RESTORED');
    const grant = await grantFor(FARID, 'pro');
    assertEqual(grant.state, 'active', 'as a fully active grant');
    assert(grant.activeUntil > store.now, 'with a live window again');
    assertEqual(
      (await purchaseOf(FARID, 'apple:receipt_farid_pro')).refundState,
      'reversed',
      'the money axis records the reversal',
    );
    assertEqual(
      (await pollChanges(cursor)).map((r) => r.userId),
      [FARID],
      'exactly one tick for the restoration',
    );
    return { refundState: res.result.refundState, state: grant.state };
  });

  await suite.check('a consumption request is answered from developer data, before the deadline', async () => {
    // The store asks US, and we have a window to answer. This is an outbound
    // obligation, not a state change: nothing about the transaction moves because
    // Apple is thinking about a refund.
    await validate({
      productId: SKU.apple.pro_monthly,
      store: 'apple',
      receipt: 'receipt_gita_pro',
      environment: 'sandbox',
    }, GITA);
    const opened = await openConsumption('apple:receipt_gita_pro');
    const request = opened.result ?? opened;
    assertEqual(request.deduped, false, 'a first request is not a duplicate');

    const row = await consumptionRow('apple:receipt_gita_pro');
    assert(row, 'the request is durable, not a timer in a job');
    assert(row.deadlineAt > row.requestedAt, 'and carries a real window');
    assertEqual(row.respondedAt ?? null, null, 'nothing answered yet');

    // We hold no wallet, so the developer supplies the facts.
    await db.mutate(api.setConsumptionData, {
      args: {
        storeTxnId: 'apple:receipt_gita_pro',
        consumptionStatus: 'partially_consumed',
        deliveryStatus: 'delivered',
        refundPreference: 'no_preference',
      },
    });
    await drain();

    const sent = store.consumptionFor('apple:receipt_gita_pro');
    assertEqual(sent.length, 1, 'exactly one consumption response was POSTed');
    assertEqual(sent[0].consumptionStatus, 'partially_consumed', "the developer's facts were sent");
    assertEqual(sent[0].deliveryStatus, 'delivered', 'including delivery');
    assertEqual(sent[0].refundPreference, 'no_preference', 'and we express no preference');

    const answered = await consumptionRow('apple:receipt_gita_pro');
    assertEqual(answered.outcome, 'reported', 'recorded as a real report, not a default');
    assert(answered.respondedAt > 0, 'respondedAt is stamped');
    assert(
      answered.respondedAt < answered.deadlineAt,
      `answered before the deadline (${answered.respondedAt} < ${answered.deadlineAt})`,
    );
    // Being asked changes nothing about access.
    assertEqual(await activeEntitlementIds(GITA), ['pro'], 'the request did not touch access');
    return { outcome: answered.outcome, marginMs: answered.deadlineAt - answered.respondedAt };
  });

  await suite.check('with no developer data the deadline alarm sends the documented default', async () => {
    // The failure this exists to prevent is silence. Missing the deadline means
    // Apple decides with no input from us; answering with an explicit abstention
    // means Apple decides with our non-answer on the record, on time. The second
    // is strictly better, and the alarm is what guarantees it.
    await validate({
      productId: SKU.apple.pro_monthly,
      store: 'apple',
      receipt: 'receipt_hugo_pro',
      environment: 'sandbox',
    }, HUGO);
    await openConsumption('apple:receipt_hugo_pro');
    // Deliberately no setConsumptionData: the developer never answers.

    await drain();

    const sent = store.consumptionFor('apple:receipt_hugo_pro');
    assertEqual(sent.length, 1, 'the deadline alarm still answered exactly once');
    assertEqual(sent[0].consumptionStatus, 'unknown', 'the documented default: we do not know');
    assertEqual(sent[0].deliveryStatus, 'unknown', 'nor whether it was delivered');
    assertEqual(sent[0].refundPreference, 'no_preference', 'and we do not adjudicate');

    const answered = await consumptionRow('apple:receipt_hugo_pro');
    assertEqual(answered.outcome, 'default', 'recorded as a default, distinguishable from a report');
    assert(
      answered.respondedAt < answered.deadlineAt,
      `the deadline was MET (${answered.respondedAt} < ${answered.deadlineAt})`,
    );
    assertEqual(await activeEntitlementIds(HUGO), ['pro'], 'access is untouched throughout');
    return { outcome: answered.outcome, marginMs: answered.deadlineAt - answered.respondedAt };
  });

  await suite.check('an opened dispute revokes access and signals the feed', async () => {
    // Involuntary: the user did not ask us and the store did not decide. A bank
    // pulled the money, so access ends immediately and the outcome comes later.
    await validate({
      productId: SKU.stripe.pro_monthly,
      store: 'stripe',
      receipt: 'receipt_iris_pro',
      environment: 'sandbox',
    }, IRIS);
    assertEqual(await activeEntitlementIds(IRIS), ['pro'], 'iris holds pro');

    const cursor = await changeCursor();
    store.openDispute('stripe:receipt_iris_pro');
    const res = await notify({ userId: IRIS, store: 'stripe', storeTxnId: 'stripe:receipt_iris_pro' });
    assert(res.ok, `applyStoreState failed: ${JSON.stringify(res.diagnostic)}`);
    assertEqual(res.result.status, 'revoked', 'a dispute revokes on open');
    assertEqual(res.result.refundState, 'disputed', 'and the money axis says why');

    assertEqual(await activeEntitlementIds(IRIS), [], 'access is OFF while the dispute is open');
    assertEqual(
      (await pollChanges(cursor)).map((r) => r.userId),
      [IRIS],
      'the developer gets the signal',
    );
    // The distinction the second axis buys: same status as a refund, different story.
    assertEqual(
      (await purchaseOf(IRIS, 'stripe:receipt_iris_pro')).refundState,
      'disputed',
      'not "granted" — nobody granted anything',
    );
    return { refundState: res.result.refundState };
  });

  await suite.check('a dispute won restores access', async () => {
    const cursor = await changeCursor();
    store.closeDispute('stripe:receipt_iris_pro', 'won');
    const res = await notify({ userId: IRIS, store: 'stripe', storeTxnId: 'stripe:receipt_iris_pro' });
    assert(res.ok, `applyStoreState failed: ${JSON.stringify(res.diagnostic)}`);
    assertEqual(res.result.refundState, 'dispute_won', 'the charge stands');
    assertEqual(await activeEntitlementIds(IRIS), ['pro'], 'so access comes back');
    assertEqual((await grantFor(IRIS, 'pro')).state, 'active', 'as an active grant');
    assertEqual(
      (await pollChanges(cursor)).map((r) => r.userId),
      [IRIS],
      'one tick for the restoration',
    );
    return { refundState: res.result.refundState };
  });

  await suite.check('a dispute lost leaves access off and moves only the money axis', async () => {
    // The sharpest case for two axes. `status` is 'revoked' before and after —
    // it does not move at all — so refundState is the ONLY thing that changes.
    // With one axis this transition would be invisible.
    await validate({
      productId: SKU.stripe.pro_monthly,
      store: 'stripe',
      receipt: 'receipt_juno_pro',
      environment: 'sandbox',
    }, JUNO);
    store.openDispute('stripe:receipt_juno_pro');
    await notify({ userId: JUNO, store: 'stripe', storeTxnId: 'stripe:receipt_juno_pro' });
    assertEqual(await activeEntitlementIds(JUNO), [], 'access off while disputed');

    const cursor = await changeCursor();
    store.closeDispute('stripe:receipt_juno_pro', 'lost');
    const res = await notify({ userId: JUNO, store: 'stripe', storeTxnId: 'stripe:receipt_juno_pro' });
    assert(res.ok, `applyStoreState failed: ${JSON.stringify(res.diagnostic)}`);
    assertEqual(res.result.status, 'revoked', 'still revoked, exactly as before');
    assertEqual(res.result.refundState, 'dispute_lost', 'and now recorded as lost');
    assertEqual(res.result.changed, false, 'no entitlement moved, because none could');
    assertEqual(await activeEntitlementIds(JUNO), [], 'access stays OFF');
    assertEqual(
      (await purchaseOf(JUNO, 'stripe:receipt_juno_pro')).refundState,
      'dispute_lost',
      'the transaction stopped claiming the dispute is open',
    );
    // No feed row: nothing the developer needs to re-read. Access did not move.
    assertEqual(await pollChanges(cursor), [], 'a money-only change is silent on the feed');
    return { refundState: res.result.refundState };
  });

  await suite.check('duplicate after-sale triggers are no-ops', async () => {
    // Every one of these arrives as an at-least-once notification, so a
    // re-delivered refund, reversal, dispute, or consumption request must change
    // nothing and append nothing.
    const cursor = await changeCursor();
    for (const [userId, storeName, storeTxnId] of [
      [FARID, 'apple', 'apple:receipt_farid_pro'],
      [IRIS, 'stripe', 'stripe:receipt_iris_pro'],
      [JUNO, 'stripe', 'stripe:receipt_juno_pro'],
    ]) {
      const again = await notify({ userId, store: storeName, storeTxnId });
      assert(again.ok, `applyStoreState failed for ${userId}: ${JSON.stringify(again.diagnostic)}`);
      assertEqual(again.result.changed, false, `${userId}: re-delivery moved nothing`);
    }
    assertEqual(await pollChanges(cursor), [], 'three redundant re-deliveries appended nothing');

    // A re-delivered consumption request is one obligation, not two: the original
    // deadline stands and no second response is sent.
    const before = await consumptionRow('apple:receipt_gita_pro');
    const reopened = await openConsumption('apple:receipt_gita_pro');
    assertEqual((reopened.result ?? reopened).deduped, true, 'the same request, not a new one');
    assertEqual(
      (reopened.result ?? reopened).deadlineAt,
      before.deadlineAt,
      'the original deadline is kept, not extended',
    );
    await drain(2);
    assertEqual(
      store.consumptionFor('apple:receipt_gita_pro').length,
      1,
      'still exactly one POST after a duplicate request and two drains',
    );
    const after = await consumptionRow('apple:receipt_gita_pro');
    assertEqual(after.respondedAt, before.respondedAt, 'respondedAt was not moved later');
    assertEqual(after.outcome, 'reported', 'and the outcome was not downgraded to a default');
    return { reconciles: 3 };
  });

  await suite.check('the after-sale lifecycle left the control buyer untouched', async () => {
    // Isolation across refunds, reversals, disputes, and two consumption windows.
    const after = await grantFor(KAI, 'plus');
    assert(after, 'kai still holds his grant');
    assertEqual(await activeEntitlementIds(KAI), ['plus'], "kai's access is unchanged");
    assertEqual(after._version, kaiGrantBefore._version, "kai's grant was never rewritten");
    assertEqual(after._id, kaiGrantBefore._id, 'and it is the same row');
    assertEqual(
      (await purchaseOf(KAI, 'stripe:receipt_kai_plus')).refundState,
      'none',
      "nothing happened to kai's money either",
    );
    // No consumption request was ever opened against him.
    assertEqual(await consumptionRow('stripe:receipt_kai_plus'), null, 'and nobody asked about him');
    assertEqual(store.consumptionFor('stripe:receipt_kai_plus').length, 0, 'so nothing was sent');
    return { version: after._version };
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

  // --- purchase events, directory, fulfillment (slice 13) ----------------------

  await suite.check('a subscription purchase emits both a purchase event and its entitlement event', async () => {
    const cursor = await changeCursor();
    const res = await validate({
      productId: SKU.apple.pro_monthly,
      store: 'apple',
      receipt: 'receipt_ravi_pro',
      environment: 'sandbox',
    }, RAVI);
    assert(res.ok, `validateReceipt failed: ${JSON.stringify(res.diagnostic)}`);
    const page = await pollChanges(cursor);
    assertEqual(page.map((row) => row.type), ['purchase', 'entitlement'], 'both types');
    assert(page.every((row) => row.userId === RAVI), 'both name the buyer');
    // One shared sequence: the two events are consecutive positions, not two
    // independent counters a developer would need two cursors to walk.
    assertEqual(page[1].seq, page[0].seq + 1, 'consecutive in one sequence');
    assertEqual(await activeEntitlementIds(RAVI), ['pro'], 'and the access is real');
    return { seqs: page.map((r) => r.seq) };
  });

  await suite.check('the customer directory is derived from transactions, so a consumable-only buyer appears', async () => {
    // SASHA buys ONLY a consumable. Under the old feed-derived directory this
    // customer was invisible: a consumable grants nothing, so it never ticked
    // the entitlement feed, and someone who had paid us did not exist.
    const res = await validate({
      productId: SKU.apple.coins_100,
      store: 'apple',
      receipt: 'receipt_sasha_coins',
      environment: 'sandbox',
    }, SASHA);
    assert(res.ok, `validateReceipt failed: ${JSON.stringify(res.diagnostic)}`);
    assertEqual(await activeEntitlementIds(SASHA), [], 'they hold no entitlement at all');

    const directory = (await db.query(api.listCustomers, {})).rows;
    const entry = directory.find((row) => row.userId === SASHA);
    assert(entry, `consumable-only buyer missing from the directory: ${JSON.stringify(directory.map((r) => r.userId))}`);
    assertEqual(entry.transactions, 1, 'and their purchase is counted');
    assert(entry.firstPurchaseAt > 0 && entry.lastPurchaseAt >= entry.firstPurchaseAt, 'with server-stamped times');
    // The directory is the transaction set, so every buyer so far is in it.
    for (const userId of [ADA, GRACE, RAVI]) {
      assert(directory.some((row) => row.userId === userId), `${userId} missing from the directory`);
    }
    assertEqual(
      Object.keys(entry).sort(),
      ['firstPurchaseAt', 'lastPurchaseAt', 'transactions', 'userId'],
      'projected shape carries no entitlement state',
    );
    return { customers: directory.length };
  });

  await suite.check('acknowledgeConsumption records fulfillment WITHOUT touching ackState', async () => {
    const storeTxnId = 'apple:receipt_sasha_coins';
    const before = await purchaseOf(SASHA, storeTxnId);
    assertEqual(before.fulfillmentState, 'unfulfilled', 'a fresh purchase is unfulfilled');
    assertEqual(before.ackState, 'pending', 'and unacknowledged to the store');

    const out = await db.mutate(api.acknowledgeConsumption, {
      args: {
        storeTxnId: storeTxnId,
        consumptionStatus: 'fully_consumed',
        deliveryStatus: 'delivered',
        refundPreference: 'decline',
      },
      userId: SASHA,
    });
    assertEqual(out.result.changed, true, 'the fulfillment state moved');
    assertEqual(out.result.fulfillmentState, 'fulfilled', 'and it moved to fulfilled');
    assertEqual(out.result.requestUpdated, false, 'no consumption request is open yet');

    const after = await purchaseOf(SASHA, storeTxnId);
    assertEqual(after.fulfillmentState, 'fulfilled', 'recorded on the transaction');
    // The two axes are independent, and this is the assertion that proves it:
    // the developer fulfilled, and our obligation to the STORE is untouched.
    // Apple owes no server-side ack at all, so it must stay exactly as it was.
    assertEqual(after.ackState, 'pending', 'ackState is a DIFFERENT axis and did not move');
    assertEqual(after.serverAckRequired, false, 'and no store ack was ever owed here');

    // Idempotent, like ackState: re-reporting a delivery is not news.
    const again = await db.mutate(api.acknowledgeConsumption, {
      args: { storeTxnId: storeTxnId },
      userId: SASHA,
    });
    assertEqual(again.result.changed, false, 're-acknowledging changes nothing');
    return { fulfillmentState: after.fulfillmentState, ackState: after.ackState };
  });

  await suite.check('fulfillment data reaches the consumption-request path, before any request exists', async () => {
    // The point of holding the developer's answer on the TRANSACTION: they
    // fulfil at purchase time, and Apple asks weeks later if at all. Slice 9's
    // setConsumptionData refuses without an open request, so without this the
    // answer would be lost and every request would resolve to the deadline
    // default even though the developer knew all along.
    const storeTxnId = 'apple:receipt_sasha_coins';
    const opened = await db.mutate(api.openConsumptionRequest, {
      args: { storeTxnId: storeTxnId, windowMs: 3_600_000, alarmDelayMs: 0 },
      userId: SASHA,
    });
    assertEqual(opened.result.deduped, false, 'a fresh request');

    const plan = await db.mutate(api.settleConsumptionRequest, {
      args: { storeTxnId: storeTxnId, phase: 'resolve' },
      userId: SASHA,
    });
    assertEqual(plan.result.respond, true, 'we have something to say');
    assertEqual(plan.result.reason, 'fulfillment-data', 'sourced from the recorded fulfillment');
    assertEqual(plan.result.outcome, 'reported', 'reported, NOT the deadline default');
    assertEqual(plan.result.consumptionStatus, 'fully_consumed', 'the developer’s own facts');
    assertEqual(plan.result.deliveryStatus, 'delivered', 'including delivery');
    assertEqual(plan.result.refundPreference, 'decline', 'and their stated preference');

    // Answering an already-open request writes through to it as well, which is
    // the setConsumptionData path reached without the developer noticing a
    // request exists.
    const wrote = await db.mutate(api.acknowledgeConsumption, {
      args: { storeTxnId: storeTxnId, consumptionStatus: 'partially_consumed' },
      userId: SASHA,
    });
    assertEqual(wrote.result.requestUpdated, true, 'the open request was updated in the same commit');
    const ledger = (await db.query(api.listConsumptionRequests, {})).rows
      .find((row) => row.storeTxnId === storeTxnId);
    assertEqual(ledger.consumptionStatus, 'partially_consumed', 'the request carries the refined fact');
    return { reason: plan.result.reason };
  });

  await suite.check('the delivery ledger exposes per-attempt rows, which is what /admin/deliveries serves', async () => {
    // The engine has had this query since slice 5; slice 13 put a devserver
    // route in front of it so the dashboard can render real delivery state
    // instead of a placeholder. Pinning the row shape here is what stops that
    // route from quietly changing under the dashboard.
    const rows = (await db.query(api.listDeliveries, {})).rows;
    assert(rows.length > 0, 'deliveries were attempted earlier in this suite');
    for (const row of rows) {
      // A declarative defineQuery returns whole documents, so the server-owned
      // system fields ride along; the contract asserted here is the application
      // shape the dashboard reads.
      assertEqual(
        Object.keys(row).filter((k) => !k.startsWith('_')).sort(),
        ['attempt', 'attemptedAt', 'endpoint', 'outcome', 'seq', 'status', 'userId'],
        'delivery row shape',
      );
      assert(row.outcome === 'delivered' || row.outcome === 'failed', `unknown outcome ${row.outcome}`);
      assert(row.attempt >= 1, 'attempts are 1-based');
    }
    // One row per ATTEMPT, not per change: the ladder is visible after the fact.
    const failed = rows.filter((row) => row.outcome === 'failed');
    assert(failed.length > 0, 'the ledger retains failed attempts, not just the successful one');
    // Ordered by seq, which is the join key the dashboard uses to attach a
    // delivery to its feed row.
    const seqs = rows.map((row) => row.seq);
    assertEqual(seqs.slice().sort((a, b) => a - b), seqs, 'ordered by seq');
    return { rows: rows.length, failed: failed.length };
  });

  // --- the store SKU is the atom (slice 12) -----------------------------------

  await suite.check('a transaction records the STORE SKU, with its store', async () => {
    const res = await validate({
      productId: SKU.stripe.pro_monthly,
      store: 'stripe',
      receipt: 'receipt_pia_stripe_pro',
      environment: 'sandbox',
    }, PIA);
    assert(res.ok, `validateReceipt failed: ${JSON.stringify(res.diagnostic)}`);
    const row = await purchaseOf(PIA, 'stripe:receipt_pia_stripe_pro');
    // The Stripe SKU string is `price_pro_monthly` — it cannot be confused with
    // the `pro_monthly` package, which is the point of asserting on this store.
    assertEqual(row.productId, SKU.stripe.pro_monthly, 'the transaction names the SKU');
    assertEqual(row.store, 'stripe', 'and the store that issued it');
    assert(row.productId !== 'pro_monthly', 'never the package id');
    assertEqual(await activeEntitlementIds(PIA), ['pro'], 'the SKU granted its entitlement');
    return { productId: row.productId, store: row.store };
  });

  await suite.check('every SKU of a package grants the same entitlement', async () => {
    // Pia already holds the Stripe SKU. Buying the Apple and Google SKUs of the
    // same package adds two more transactions naming two more strings — and the
    // entitlement set does not grow, because all three map to `pro`.
    for (const store of ['apple', 'google']) {
      const res = await validate({
        productId: SKU[store].pro_monthly,
        store: store,
        receipt: `receipt_pia_${store}_pro`,
        environment: 'sandbox',
      }, PIA);
      assert(res.ok, `${store} purchase failed: ${JSON.stringify(res.diagnostic)}`);
    }
    const rows = await purchases(PIA);
    assertEqual(
      rows.map((r) => `${r.store} ${r.productId}`).sort(),
      [
        `apple ${SKU.apple.pro_monthly}`,
        `google ${SKU.google.pro_monthly}`,
        `stripe ${SKU.stripe.pro_monthly}`,
      ],
      'three distinct SKUs, three transactions',
    );
    // One entitlement, not three: the union is over entitlements, and the
    // package never enters the derivation.
    assertEqual(await activeEntitlementIds(PIA), ['pro'], 'still exactly one entitlement');
    const grants = (await db.query(api.getEntitlements, { userId: PIA })).rows;
    assertEqual(grants.length, 1, 'one grant row, not one per SKU');
    return { transactions: rows.length, grants: grants.length };
  });

  await suite.check('cross-platform union: apple and google SKUs of one entitlement make ONE grant', async () => {
    // Decision 23, and in slice 12 it needs no code of its own. Nova buys the
    // Apple SKU of pro_monthly and the Google SKU of pro_ANNUAL — different
    // packages, different stores, same entitlement.
    const apple = await validate({
      productId: SKU.apple.pro_monthly,
      store: 'apple',
      receipt: 'receipt_nova_apple',
      environment: 'sandbox',
    }, NOVA);
    assert(apple.ok, `apple purchase failed: ${JSON.stringify(apple.diagnostic)}`);
    assertEqual(await activeEntitlementIds(NOVA), ['pro'], 'apple SKU grants pro');
    const afterApple = await grantFor(NOVA, 'pro');

    const google = await validate({
      productId: SKU.google.pro_annual,
      store: 'google',
      receipt: 'receipt_nova_google',
      environment: 'sandbox',
    }, NOVA);
    assert(google.ok, `google purchase failed: ${JSON.stringify(google.diagnostic)}`);

    const grants = (await db.query(api.getEntitlements, { userId: NOVA })).rows;
    assertEqual(grants.length, 1, 'two purchases across two stores, ONE grant');
    assertEqual(grants[0].entitlementId, 'pro', 'unioned onto pro');
    // The horizon is the max across both, so the second purchase can only
    // extend access, never shorten it.
    assert(
      grants[0].activeUntil >= afterApple.activeUntil,
      'the union takes the later horizon',
    );
    return { grants: grants.length, activeUntil: grants[0].activeUntil };
  });

  await suite.check('an unmapped SKU records a transaction and grants nothing', async () => {
    // The consumable case, stated at SKU level: coins_100's SKUs carry no edge.
    // The purchase is still a first-class record — this is the "good record, no
    // grant" outcome, not a rejection.
    const res = await validate({
      productId: SKU.stripe.coins_100,
      store: 'stripe',
      receipt: 'receipt_orson_coins',
      environment: 'sandbox',
    }, ORSON);
    assert(res.ok, `coins purchase failed: ${JSON.stringify(res.diagnostic)}`);
    const row = await purchaseOf(ORSON, 'stripe:receipt_orson_coins');
    assert(row, 'the transaction landed');
    assertEqual(row.productId, SKU.stripe.coins_100, 'naming the SKU');
    assertEqual(row.status, 'active', 'and it is an active store fact');
    assertEqual(await activeEntitlementIds(ORSON), [], 'but nothing was granted');
    return { storeTxnId: row.storeTxnId };
  });

  await suite.check('deriveGrant resolves through the SKU, not through the package', async () => {
    // Unmap ONE store's SKU from `pro` and leave its two siblings mapped. If the
    // package were on the derive path, this would be invisible; because the SKU
    // is, a buyer of the unmapped SKU gets nothing while the siblings still
    // grant.
    await catalogWrite(api.removeProductEntitlement, {
      productId: SKU.stripe.plus_monthly,
      store: 'stripe',
      entitlementId: 'plus',
    });
    const unmapped = await validate({
      productId: SKU.stripe.plus_monthly,
      store: 'stripe',
      receipt: 'receipt_orson_plus_stripe',
      environment: 'sandbox',
    }, ORSON);
    assert(unmapped.ok, `purchase failed: ${JSON.stringify(unmapped.diagnostic)}`);
    assertEqual(
      await activeEntitlementIds(ORSON),
      [],
      'the unmapped stripe SKU grants nothing, though its package still sells plus',
    );

    // The apple sibling of the SAME package still grants, which is only
    // possible if the edge is read at SKU granularity.
    const mapped = await validate({
      productId: SKU.apple.plus_monthly,
      store: 'apple',
      receipt: 'receipt_orson_plus_apple',
      environment: 'sandbox',
    }, ORSON);
    assert(mapped.ok, `purchase failed: ${JSON.stringify(mapped.diagnostic)}`);
    assertEqual(await activeEntitlementIds(ORSON), ['plus'], 'the mapped sibling grants');

    // Put the seed back so nothing after this inherits a half-unmapped package.
    await catalogWrite(api.addProductEntitlement, {
      productId: SKU.stripe.plus_monthly,
      store: 'stripe',
      entitlementId: 'plus',
    });
    return { entitlements: await activeEntitlementIds(ORSON) };
  });

  // --- catalog management (slice 11, reshaped for the SKU model) ---------------
  //
  // Deliberately last in the suite: these mutate the catalog every earlier
  // check reads, so running them here keeps the lifecycle checks working
  // against the seeded fixture they were written for.

  await suite.check('createPackage + createProduct + addProductEntitlement round-trip', async () => {
    await catalogWrite(api.createPackage, {
      packageId: 'zz_bundle',
      kind: 'subscription',
      title: 'Test bundle',
    });
    await catalogWrite(api.createEntitlement, { entitlementId: 'zz_archive', title: 'Archive access' });
    const sku = await catalogWrite(api.createProduct, {
      productId: 'com.example.app.zz.bundle',
      store: 'apple',
      packageId: 'zz_bundle',
      // Apple has no base-plan concept, so it stays absent rather than empty.
      basePlanId: '',
    });
    assertEqual(sku.store, 'apple', 'created SKU echoes its store');
    await catalogWrite(api.addProductEntitlement, {
      productId: 'com.example.app.zz.bundle',
      store: 'apple',
      entitlementId: 'zz_archive',
    });

    const packages = (await db.query(api.listPackages, {})).rows;
    assertEqual(
      packages.find((p) => p.packageId === 'zz_bundle').kind,
      'subscription',
      'package kind',
    );
    const products = (await db.query(api.listProducts, {})).rows;
    const row = products.find((p) => p.productId === 'com.example.app.zz.bundle');
    assertEqual(row.packageId, 'zz_bundle', 'the SKU names its package');
    assert(!row.basePlanId, "an empty structured field is absent, not ''");
    const edges = (await db.query(api.listProductEntitlements, {})).rows;
    assertEqual(
      edges.filter((m) => m.entitlementId === 'zz_archive')
        .map((m) => `${m.store} ${m.productId}`),
      ['apple com.example.app.zz.bundle'],
      'the SKU-level edge is readable through the graph query',
    );
    return { packages: packages.length, products: products.length };
  });

  await suite.check('one SKU string under two stores is legal; a duplicate within one store is not', async () => {
    // This is the whole argument for keying SKUs on (store, productId). The
    // string `zz_shared` is a legal Google product id AND a legal Stripe price
    // lookup key at the same time, and a catalog that refused the second would
    // be refusing a real deployment.
    await catalogWrite(api.createProduct, {
      productId: 'zz_shared',
      store: 'google',
      packageId: 'zz_bundle',
    });
    const stripe = await catalogWrite(api.createProduct, {
      productId: 'zz_shared',
      store: 'stripe',
      packageId: 'zz_bundle',
    });
    assertEqual(stripe.store, 'stripe', 'the same string under a second store is accepted');
    const products = (await db.query(api.listProducts, {})).rows;
    assertEqual(
      products.filter((p) => p.productId === 'zz_shared').map((p) => p.store).sort(),
      ['google', 'stripe'],
      'two SKU rows, one string, two stores',
    );

    // Within one store it is the same SKU, and the compound unique index is
    // what says so — not a handler scan.
    const dup = await assertThrows(
      () => catalogWrite(api.createProduct, {
        productId: 'zz_shared',
        store: 'google',
        packageId: 'zz_bundle',
      }),
      'SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION',
      'a duplicate (store, productId) is refused',
    );
    // The other unique keys, for completeness.
    await assertThrows(
      () => catalogWrite(api.createPackage, { packageId: 'zz_bundle', kind: 'consumable' }),
      'SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION',
      'a duplicate packageId is refused',
    );
    await assertThrows(
      () => catalogWrite(api.createEntitlement, { entitlementId: 'zz_archive' }),
      'SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION',
      'a duplicate entitlementId is refused',
    );
    // The edge's key is now three columns, because the SKU half is compound.
    await assertThrows(
      () => catalogWrite(api.addProductEntitlement, {
        productId: 'com.example.app.zz.bundle',
        store: 'apple',
        entitlementId: 'zz_archive',
      }),
      'SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION',
      'a duplicate mapping edge is refused',
    );
    return { code: dup.diagnostic.code };
  });

  await suite.check('updateProduct replaces structured fields; updatePackage merges required ones', async () => {
    const changed = await catalogWrite(api.updateProduct, {
      productId: 'zz_shared',
      store: 'google',
      basePlanId: 'monthly-autorenewing',
      offerId: 'intro-7-day',
    });
    assertEqual(changed.changed, true, 'the edit moved the row');
    let row = (await db.query(api.listProducts, {})).rows
      .find((p) => p.store === 'google' && p.productId === 'zz_shared');
    assertEqual(row.basePlanId, 'monthly-autorenewing', 'base plan set');
    assertEqual(row.offerId, 'intro-7-day', 'offer set');

    // Optional columns REPLACE: omitting offerId clears it, which is how
    // "that promotional offer ended" is expressible at all.
    const cleared = await catalogWrite(api.updateProduct, {
      productId: 'zz_shared',
      store: 'google',
      basePlanId: 'monthly-autorenewing',
    });
    assertEqual(cleared.changed, true, 'clearing an offer is a change');
    row = (await db.query(api.listProducts, {})).rows
      .find((p) => p.store === 'google' && p.productId === 'zz_shared');
    assert(!row.offerId, 'an omitted structured field is cleared');
    // Required columns MERGE: packageId survived an update that omitted it.
    assertEqual(row.packageId, 'zz_bundle', 'omitted required column unchanged');

    // Idempotent re-submit: a dashboard that polls on `changed` must not be
    // told the row moved when it did not.
    const again = await catalogWrite(api.updateProduct, {
      productId: 'zz_shared',
      store: 'google',
      basePlanId: 'monthly-autorenewing',
    });
    assertEqual(again.changed, false, 'an unchanged form reports no change');

    const pkg = await catalogWrite(api.updatePackage, { packageId: 'zz_bundle', title: 'Renamed bundle' });
    assertEqual(pkg.changed, true, 'package title renamed');
    const packages = (await db.query(api.listPackages, {})).rows;
    const bundle = packages.find((p) => p.packageId === 'zz_bundle');
    assertEqual(bundle.title, 'Renamed bundle', 'title moved');
    assertEqual(bundle.kind, 'subscription', 'omitted kind unchanged');
    return { offerId: row.offerId ?? null };
  });

  await suite.check('catalog writes refuse unknown kinds, stores, ids, and dangling edges', async () => {
    await assertThrows(
      () => catalogWrite(api.createPackage, { packageId: 'zz_bad_kind', kind: 'subscriptions' }),
      'SNAPBACK_HANDLER_FAILED',
      'a typo in the closed kind vocabulary is refused',
    );
    // The store vocabulary is closed too: a SKU on an unknown store is a row no
    // notification could ever match.
    await assertThrows(
      () => catalogWrite(api.createProduct, {
        productId: 'zz_bad_store',
        store: 'amazon',
        packageId: 'zz_bundle',
      }),
      'SNAPBACK_HANDLER_FAILED',
      'an unknown store is refused',
    );
    // A SKU must belong to a package, or it would have no `kind` and the
    // acknowledgement path would silently pick 'acknowledge'.
    await assertThrows(
      () => catalogWrite(api.createProduct, {
        productId: 'zz_orphan',
        store: 'apple',
        packageId: 'zz_nonexistent',
      }),
      'SNAPBACK_HANDLER_FAILED',
      'a SKU under a missing package is refused',
    );
    await assertThrows(
      () => catalogWrite(api.updateProduct, { productId: 'zz_missing', store: 'apple' }),
      'SNAPBACK_HANDLER_FAILED',
      'updating a SKU that does not exist is refused',
    );
    // An edge may not name an endpoint that does not exist. The dashboard still
    // RENDERS orphan edges, because a seeded or migrated corpus can carry one —
    // but this surface will not mint them.
    await assertThrows(
      () => catalogWrite(api.addProductEntitlement, {
        productId: 'com.example.app.zz.bundle',
        store: 'apple',
        entitlementId: 'zz_nonexistent',
      }),
      'SNAPBACK_HANDLER_FAILED',
      'an edge to a missing entitlement is refused',
    );
    await assertThrows(
      () => catalogWrite(api.addProductEntitlement, {
        productId: 'zz_nonexistent',
        store: 'apple',
        entitlementId: 'zz_archive',
      }),
      'SNAPBACK_HANDLER_FAILED',
      'an edge from a missing SKU is refused',
    );
    const products = (await db.query(api.listProducts, {})).rows;
    assertEqual(products.filter((p) => p.productId === 'zz_orphan'), [], 'nothing was written');
    // Removing an edge that is not there is a no-op, not an error.
    const absent = await catalogWrite(api.removeProductEntitlement, {
      productId: 'com.example.app.zz.bundle',
      store: 'apple',
      entitlementId: 'zz_nonexistent',
    });
    assertEqual(absent.removed, false, 'removing a missing edge is a silent no-op');
    return { products: products.length };
  });

  await suite.check('deleteEntitlement removes its edges AND the derived grants that named it', async () => {
    // Give the throwaway entitlement a real holder first, so the grant cleanup
    // has something to clean. This is the case that matters: a perpetual grant
    // for a deleted entitlement is unreachable by every derivation path, so
    // nothing would ever turn it off.
    const bought = await validate({
      productId: 'com.example.app.zz.bundle',
      store: 'apple',
      receipt: 'receipt_zed_bundle',
      environment: 'sandbox',
    }, ZED);
    assert(bought.ok, `zz_bundle purchase failed: ${JSON.stringify(bought.diagnostic)}`);
    assertEqual(await activeEntitlementIds(ZED), ['zz_archive'], 'the SKU edge granted on purchase');

    const removed = await catalogWrite(api.deleteEntitlement, { entitlementId: 'zz_archive' });
    assertEqual(removed.deleted, true, 'entitlement deleted');
    assertEqual(removed.edgesRemoved, 1, 'its mapping edge went with it');
    assertEqual(removed.grantsRemoved, 1, 'and so did the derived grant');

    assertEqual(await activeEntitlementIds(ZED), [], 'the holder no longer holds it');
    const edges = (await db.query(api.listProductEntitlements, {})).rows;
    assertEqual(edges.filter((m) => m.entitlementId === 'zz_archive'), [], 'no orphan edge left behind');
    // The purchase itself survives: the catalog says what is for sale, the
    // transaction says what WAS sold, and deleting the first does not un-sell.
    const audit = await purchases(ZED);
    assertEqual(audit.map((p) => p.productId), ['com.example.app.zz.bundle'], 'untouched history');
    return removed;
  });

  await suite.check('deletePackage cascades to its SKUs and their edges', async () => {
    // Re-map one SKU so the cascade has an edge to clean, then delete the
    // package from under all three.
    await catalogWrite(api.createEntitlement, { entitlementId: 'zz_temp', title: 'Temp' });
    await catalogWrite(api.addProductEntitlement, {
      productId: 'zz_shared',
      store: 'google',
      entitlementId: 'zz_temp',
    });
    const skusBefore = (await db.query(api.listProducts, {})).rows
      .filter((p) => p.packageId === 'zz_bundle');
    assertEqual(skusBefore.length, 3, 'the bundle has three SKUs: apple, google, stripe');

    const removed = await catalogWrite(api.deletePackage, { packageId: 'zz_bundle' });
    assertEqual(removed.deleted, true, 'package deleted');
    assertEqual(removed.productsRemoved, 3, 'all three SKUs went with it');
    assertEqual(removed.edgesRemoved, 1, 'and the surviving edge, in the same commit');

    const packages = (await db.query(api.listPackages, {})).rows;
    assertEqual(packages.filter((p) => p.packageId === 'zz_bundle'), [], 'gone from the catalog');
    const products = (await db.query(api.listProducts, {})).rows;
    assertEqual(products.filter((p) => p.packageId === 'zz_bundle'), [], 'no SKU names it');
    const edges = (await db.query(api.listProductEntitlements, {})).rows;
    assertEqual(edges.filter((m) => m.entitlementId === 'zz_temp'), [], 'no edge survived its SKU');
    // The seeded catalog is exactly as the earlier checks left it.
    assertEqual(
      packages.map((p) => p.packageId),
      ['coins_100', 'plus_monthly', 'pro_annual', 'pro_monthly'],
      'the seeded catalog is intact',
    );
    assertEqual(products.length, 12, 'and so are its twelve SKUs');
    await assertThrows(
      () => catalogWrite(api.deletePackage, { packageId: 'zz_bundle' }),
      'SNAPBACK_HANDLER_FAILED',
      'deleting it twice is refused',
    );
    return { packages: packages.length, products: products.length };
  });

  await suite.check('deleteProduct removes one SKU and its edges, leaving its siblings', async () => {
    // Deleting a single SKU is the narrower operation: the package and its other
    // store listings survive, which is what withdrawing one platform looks like.
    const before = (await db.query(api.listProductEntitlements, {})).rows.length;
    const removed = await catalogWrite(api.deleteProduct, {
      productId: SKU.stripe.plus_monthly,
      store: 'stripe',
    });
    assertEqual(removed.deleted, true, 'SKU deleted');
    assertEqual(removed.edgesRemoved, 1, 'its edge went with it');

    const products = (await db.query(api.listProducts, {})).rows;
    assertEqual(
      products.filter((p) => p.packageId === 'plus_monthly').map((p) => p.store).sort(),
      ['apple', 'google'],
      'the sibling SKUs survive the deletion of one store listing',
    );
    const edges = (await db.query(api.listProductEntitlements, {})).rows;
    assertEqual(edges.length, before - 1, 'exactly one edge removed');
    assertEqual(
      edges.filter((m) => m.store === 'stripe' && m.productId === SKU.stripe.plus_monthly),
      [],
      'no edge names the deleted SKU',
    );
    // The package itself is untouched — deleting a listing is not withdrawing
    // the product.
    const packages = (await db.query(api.listPackages, {})).rows;
    assert(packages.some((p) => p.packageId === 'plus_monthly'), 'the package survives');
    await assertThrows(
      () => catalogWrite(api.deleteProduct, { productId: SKU.stripe.plus_monthly, store: 'stripe' }),
      'SNAPBACK_HANDLER_FAILED',
      'deleting it twice is refused',
    );
    return { products: products.length, edges: edges.length };
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
