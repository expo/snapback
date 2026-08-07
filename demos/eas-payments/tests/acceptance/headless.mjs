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

const STORE_KEY = 'fake-store-key-slice-2';
const WRONG_STORE_KEY = 'not-the-store-key';
const WEBHOOK_SECRET = 'developer-shared-secret-slice-5';

const suite = createSuite('eas-payments / headless', { expectedChecks: 36 });
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
      'listProducts',
      'recordPurchase',
      'validateReceipt',
      'reconcileTransaction',
      'applyStoreState',
      'applyGrantExpiry',
      'expireGrantsSweep',
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

  await suite.check('deterministic reset + declarative seed installs the catalog', async () => {
    await db.reset();
    await db.seed(seed);
    const products = await db.query(api.listProducts, {});
    assertEqual(
      products.rows.map((r) => r.productId),
      ['plus_monthly', 'pro_annual', 'pro_monthly'],
      'seeded products',
    );
    const proMonthly = products.rows.find((r) => r.productId === 'pro_monthly');
    assertEqual(proMonthly.kind, 'subscription', 'product kind');
    assertEqual(proMonthly.appleId, 'com.example.app.pro.monthly', 'per-platform apple id');
    return { products: products.rows.length };
  });

  await suite.check('no purchase means no entitlement', async () => {
    assertEqual(await activeEntitlementIds(ADA), [], 'ada starts with no entitlements');
  });

  await suite.check('validateReceipt: action -> mutation -> transaction + grant', async () => {
    const before = store.requests.length;
    const res = await validate({
      productId: 'pro_monthly',
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
    const replay = await validate({
      productId: 'pro_monthly',
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
      productId: 'pro_monthly',
      status: 'active',
      environment: 'production',
    });
    const res = await validate({
      productId: 'pro_monthly',
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
      productId: 'pro_monthly',
      status: 'expired',
      environment: 'sandbox',
      expiresAt: store.now - 1_000,
    });
    const res = await validate({
      productId: 'pro_monthly',
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
        productId: 'pro_monthly',
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
      productId: 'pro_monthly',
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
      productId: 'pro_monthly',
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

  // --- Slice 3: the notification path ------------------------------------------

  await suite.check('applyStoreState re-fetches instead of trusting its trigger', async () => {
    // Frank buys pro_monthly the ordinary way.
    await validate({
      productId: 'pro_monthly',
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
      productId: 'pro_monthly',
      store: 'apple',
      receipt: 'receipt_hank_monthly',
      environment: 'sandbox',
    }, HANK);
    await validate({
      productId: 'pro_annual',
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
      productId: 'plus_monthly',
      store: 'stripe',
      receipt: 'receipt_grace_plus',
      environment: 'sandbox',
    }, GRACE);
    const graceBefore = await activeEntitlementIds(GRACE);
    assertEqual(graceBefore, ['plus', 'pro'], 'grace holds plus alongside pro');
    const graceGrantBefore = await grantFor(GRACE, 'plus');

    await validate({
      productId: 'pro_monthly',
      store: 'apple',
      receipt: 'receipt_frank_2',
      environment: 'sandbox',
    }, FRANK);
    store.setState('apple:receipt_frank_2', {
      status: 'refunded',
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

  await suite.check('a grant appends exactly one change the developer can poll', async () => {
    const cursor = await changeCursor();
    await validate({
      productId: 'plus_monthly',
      store: 'stripe',
      receipt: 'receipt_jo_plus',
      environment: 'sandbox',
    }, JO);
    const page = await pollChanges(cursor);
    assertEqual(page.length, 1, 'exactly one change since the cursor');
    assertEqual(page[0].userId, JO, 'the change names the user whose access moved');
    assert(page[0].seq > cursor, 'seq advanced past the cursor');

    // Polling again from the seq we were handed returns nothing.
    assertEqual(await pollChanges(page[0].seq), [], 'the cursor drains the feed');
    return { seq: page[0].seq };
  });

  await suite.check('pollChanges carries no entitlement state', async () => {
    // The whole point of decision 20: the developer learns WHO changed, then
    // re-reads our authoritative answer. Anything more here would be state
    // they could act on stale.
    const rows = await pollChanges(0);
    assert(rows.length > 0, 'feed is non-empty, so this check is not vacuous');
    for (const row of rows) {
      assertEqual(Object.keys(row).sort(), ['seq', 'userId'], 'change row shape');
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
      status: 'refunded',
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
    const jobs = await admin.listJobs();
    assertEqual(jobs.jobs ?? jobs.rows ?? [], [], 'nothing enqueued before registration');
    assertEqual(developer.received.length, 0, 'developer heard nothing');
  });

  await suite.check('a change enqueues a delivery transactionally with the feed row', async () => {
    await db.mutate(api.registerWebhookEndpoint, { args: { url: developer.url }, userId: JO });
    const cursor = await changeCursor();

    const commit = await db.mutate(api.recordPurchase, {
      args: {
        productId: 'plus_monthly',
        store: 'stripe',
        storeTxnId: 'stripe:receipt_mia_plus',
        status: 'active',
        environment: 'sandbox',
        expiresAt: Date.now() + 86_400_000,
      },
      userId: MIA,
    });
    assertEqual(commit.result.grants, 1, 'the purchase moved a grant');

    // The mutation receipt carries the enqueue: the feed row and the job
    // landed in the same commit, so a rollback could not have left one behind.
    const enqueues = commit.enqueues ?? commit.receipt?.enqueues ?? [];
    assertEqual(enqueues.length, 1, `expected one enqueue on the receipt, got ${JSON.stringify(commit)}`);
    assertEqual(enqueues[0].action, 'notifyDeveloper', 'the enqueued action');

    const page = await pollChanges(cursor);
    assertEqual(page.length, 1, 'one feed row');
    assertEqual(page[0].userId, MIA, 'for the right user');
    // Still not delivered — the worker is inert until the suite drains.
    assertEqual(developer.received.length, 0, 'nothing sent before the drain');
    return { jobId: enqueues[0].jobId, seq: page[0].seq };
  });

  await suite.check('draining delivers a ping carrying only userId and seq', async () => {
    const before = await changeCursor();
    await drain();
    assertEqual(developer.received.length, 1, 'exactly one delivery');
    const ping = developer.received[0];
    assertEqual(ping.authorized, true, 'presented the shared secret');
    assertEqual(ping.outcome, 200, 'endpoint accepted it');
    assertEqual(Object.keys(ping.body).sort(), ['seq', 'userId'], 'ping body shape');
    assertEqual(ping.body.userId, MIA, 'named the user whose access moved');
    assertEqual(ping.body.seq, before, 'named the feed position');

    const deliveries = await db.query(api.listDeliveries, {});
    const last = deliveries.rows[deliveries.rows.length - 1];
    assertEqual(last.outcome, 'delivered', 'ledger records success');
    assertEqual(last.attempt, 1, 'first attempt');
    assertEqual(last.status, 200, 'ledger records the status');
    // Delivering must not itself be a change.
    assertEqual(await pollChanges(before), [], 'the ping did not append to the feed');
    return { body: ping.body };
  });

  await suite.check('a failing endpoint is retried until it succeeds', async () => {
    developer.reset();
    developer.failNext(2);
    await db.mutate(api.recordPurchase, {
      args: {
        productId: 'pro_monthly',
        store: 'stripe',
        storeTxnId: 'stripe:receipt_nia_pro',
        status: 'active',
        environment: 'sandbox',
        expiresAt: Date.now() + 86_400_000,
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
          productId: 'pro_monthly',
          store: 'stripe',
          storeTxnId: 'stripe:receipt_omar_pro',
          status: 'active',
          environment: 'sandbox',
          expiresAt: Date.now() + 86_400_000,
        },
        userId: OMAR,
      });
      await drain(10);

      const ledger = (await db.query(api.listDeliveries, {})).rows
        .filter((row) => row.userId === OMAR);
      assertEqual(ledger.length, 5, 'stopped at the declared maxAttempts of 5');
      assert(ledger.every((row) => row.outcome === 'failed'), 'every attempt failed');

      // The change itself survived the failed delivery: the feed is the
      // authoritative mechanism and the ping is only a hint.
      const feed = (await pollChanges(0)).filter((row) => row.userId === OMAR);
      assertEqual(feed.length, 1, 'the change is still pollable after delivery gave up');
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
      productId: 'plus_monthly',
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
          productId: 'pro_monthly',
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
