// EAS Payments — engine-first slice functions.
//
// The whole point of this slice is the shape of the write path:
//
//   store notification  ->  action (re-fetch authoritative state)
//                       ->  mutation (one atomic commit)
//                       ->  entitlementGrants (derived read model)
//                       ->  live query the app gates on
//
// The action never writes, and it never trusts its own payload as the source
// of truth. The re-fetch is a real outbound ctx.fetch against a fake local
// store fixture — fake in the sense that it is not Apple/Google/Stripe, not in
// the sense that the call is simulated.
//
// @ref LLP 0027#external-data-and-action-egress — egress stays out of the
//   transactional path: the action resolves state, then a mutation commits it.
// @ref LLP 0108#source-authoring — every JS handler here is the paved inline
//   `handler:` form, self-contained with its args, result contract, and
//   declared reads/writes.

import {
  asc,
  defineAction,
  defineConfig,
  defineCron,
  defineJsLiveQuery,
  defineJsMutation,
  defineJsQuery,
  defineQuery,
  results,
  v,
} from '../../_kit/define.mjs';

// --- Config -------------------------------------------------------------------

// @ref LLP 0036#declared-configuration-in-the-manifest — the grant the store
// call reads through ctx.secrets. Only functions naming it in `uses` receive a
// redacting handle; queries and mutations get no config surface at all.
export const appConfig = defineConfig({
  storeValidation: {
    description: 'Store receipt-validation credential (Apple/Google/Stripe)',
    purpose: 'Re-fetches the authoritative transaction state after a notification',
    required: true,
    pool: false,
    howToGet:
      'Prototype: the fake local store accepts any bearer value, and the '
      + 'acceptance sets one. The real adapters take an Apple App Store Server '
      + 'API key, a Google service account, or a Stripe secret key.',
  },
  developerWebhookSecret: {
    description: 'Shared secret presented to the developer webhook endpoint',
    purpose: 'Lets the receiving developer authenticate that a ping came from us',
    required: true,
    pool: false,
    howToGet:
      'Generated when a developer registers a webhook endpoint, and shown to '
      + 'them once. This authenticates the SENDER; it is not a body signature '
      + '— see the signing gap in the demo README.',
  },
});

// --- Read path ----------------------------------------------------------------

// The client read path. Entitlements, not products: the app asks "may this
// user do the thing", and the answer is derived state it never computes
// itself.
//
// The handler filters `active` in JavaScript rather than in the builder on
// purpose. The captured read set stays "this user's grants", so a grant
// flipping active -> false still refreshes the subscription; a captured
// `active = true` predicate would make an expiring grant's disappearance
// depend on pre-image matching. The partition is one user's grants, so the
// collect is bounded.
export const getEntitlements = defineJsLiveQuery({
  args: {},
  reads: ['entitlementGrants'],
  authScopeField: 'userId',
  result: results.documents('entitlementGrants'),
  handler: async (ctx) => {
    const grants = await ctx.db
      .query('entitlementGrants')
      .withIndex('by_user')
      .eq('userId', ctx.auth.userId)
      .order('_createdAt', 'asc')
      .collect();
    return grants.filter((grant) => grant.active === true);
  },
});

// Merchandising read. Declarative because the plan vocabulary says it all.
export const listProducts = defineQuery({
  table: 'products',
  args: {},
  order: [asc('productId')],
  index: 'by_product',
});

// The purchase audit (slice 6). A consumable grants no entitlement, so
// `getEntitlements` can never show that one was bought — the transaction row is
// the only record, and this is the read that exposes it.
//
// Deliberately an audit and not a wallet: we hand back what the store told us
// happened, and the developer credits coins on their side. Holding a balance
// would make us the authority on a number no store could reconcile us against.
//
// Projected rather than `results.documents`, so the shape is a contract: this
// read returns store facts, never anything derived from them.
export const listPurchases = defineJsQuery({
  args: {},
  reads: ['transactions'],
  authScopeField: 'userId',
  result: results.records(v.object({
    productId: v.string(),
    store: v.string(),
    storeTxnId: v.string(),
    status: v.string(),
    environment: v.string(),
    createdAt: v.integer(),
  })),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query('transactions')
      .withIndex('by_user')
      .eq('userId', ctx.auth.userId)
      .order('_createdAt', 'asc')
      .collect();
    return rows.map((row) => ({
      productId: row.productId,
      store: row.store,
      storeTxnId: row.storeTxnId,
      status: row.status,
      environment: row.environment,
      // The server owns the timestamp; the handler never mints one.
      createdAt: row._createdAt,
    }));
  },
});

// --- Derivation ---------------------------------------------------------------

// "Entitlements are derived from transactions" is only true if there is one
// derivation. These are same-file function declarations, so codegen resolves
// and splices them into every handler that calls them — the purchase path and
// the notification path cannot drift into two different answers.
//
// @ref LLP 0108#same-file-helper-sharing--2026-07-31-normative — statically
//   reachable same-file declarations are spliced with the calling handler;
//   imports and outer consts still are not captured. That last clause is why
//   the lifecycle vocabulary below is spelled as function declarations rather
//   than the array-of-strings constant it obviously wants to be.

// The canonical transaction lifecycle. Seven states, one place.
function isKnownTxnState(status) {
  return status === 'active'
    || status === 'grace'
    || status === 'retry_hold'
    || status === 'paused'
    || status === 'pending'
    || status === 'expired'
    || status === 'revoked';
}

// The access boundary, and the only predicate allowed to decide it. Exactly two
// of the seven states grant access; the other five are all "no access" for
// materially different reasons, and conflating any of them with `expired` is
// the bug this whole model exists to prevent:
//
//   retry_hold — payment is failing, the store is still retrying. Access off,
//                but the subscription is alive and must NOT be time-expired.
//   paused     — the user deliberately paused (Google Play). Comes back at
//                `resumesAt`. Also must not be time-expired.
//   pending    — payment started and has not cleared (SCA, slow ACH, Ask to
//                Buy). Never granted access, so it has nothing to lose.
//   expired    — the window closed and nobody is retrying.
//   revoked    — refunded or revoked by the store.
//
// The three middle states change only when the store tells us so, through an
// applyStoreState re-fetch. Nothing on a clock may move them.
function grantsAccess(status) {
  return status === 'active' || status === 'grace';
}

// Which column bounds a given state's access. `null` means "no horizon", which
// for an access-granting state means perpetual (a non-consumable).
function accessHorizonOf(txn) {
  const raw = txn.status === 'grace' ? txn.graceUntil : txn.expiresAt;
  return raw === undefined || raw === null ? null : raw;
}

// Optional integer milliseconds off a store response. Absent is legitimate — a
// pending purchase has no expiry yet, a paused one has no active window — so
// this distinguishes "absent" from "present but malformed" rather than
// defaulting a missing horizon to zero and silently expiring something.
function readOptionalMs(value, label) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || Math.floor(value) !== value) {
    throw new Error(label + ' must be an integer when present');
  }
  return value;
}

// What the user's transactions currently justify for one entitlement. Pure
// read: several products can grant the same entitlement (pro_monthly and
// pro_annual both grant `pro`), so losing one does not necessarily lose it.
//
// Reasons over per-transaction *state*, not over `expiresAt` alone. A grace
// transaction whose `expiresAt` is long past still grants access until its
// `graceUntil`, and a retry_hold transaction whose `expiresAt` is in the future
// grants none — so the date can never be read without the state that scopes it.
async function deriveGrant(ctx, userId, entitlementId) {
  const mappings = await ctx.db
    .query('productEntitlements')
    .withIndex('by_entitlement')
    .eq('entitlementId', entitlementId)
    .collect();
  const productIds = mappings.map((mapping) => mapping.productId);
  const transactions = await ctx.db
    .query('transactions')
    .withIndex('by_user')
    .eq('userId', userId)
    .collect();

  let anyActive = false;
  let anyGrace = false;
  let perpetual = false;
  let maxUntil = -1;
  let source = '';
  for (const txn of transactions) {
    if (productIds.indexOf(txn.productId) < 0) continue;
    // The five non-granting states contribute nothing at all — not a shorter
    // window, not a weaker grant. A pending purchase in particular derives to
    // exactly the same answer as no purchase, which is what makes it silent.
    if (!grantsAccess(txn.status)) continue;
    if (txn.status === 'active') anyActive = true;
    else anyGrace = true;
    const until = accessHorizonOf(txn);
    if (until === null) {
      // A non-consumable outranks any dated window.
      if (!perpetual) {
        perpetual = true;
        source = txn.storeTxnId;
      }
    } else if (until > maxUntil) {
      maxUntil = until;
      if (!perpetual) source = txn.storeTxnId;
    }
  }
  // The horizon is the MAX across every granting transaction regardless of
  // which state produced it, so one product's grace window can hold an
  // entitlement up while another product's active window is what usually does.
  const activeUntil = perpetual || maxUntil < 0 ? null : maxUntil;
  // Active outranks grace: if any transaction is fully paid up, the user is not
  // "in grace" merely because a second, lapsing product also backs the
  // entitlement. Reporting grace there would invite a dunning message to
  // someone whose payments are fine.
  const state = anyActive ? 'active' : (anyGrace ? 'grace' : null);
  return {
    active: anyActive || anyGrace,
    activeUntil: activeUntil,
    state: state,
    source: source,
  };
}

// Write the derived answer, and report whether it actually moved. The boolean
// is load-bearing: a reconcile that changes nothing must stay silent, which is
// what makes repeated notifications safe.
async function applyDerivedGrant(ctx, userId, entitlementId) {
  const derived = await deriveGrant(ctx, userId, entitlementId);
  const existing = await ctx.db
    .query('entitlementGrants')
    .withIndex('by_user')
    .eq('userId', userId)
    .eq('entitlementId', entitlementId)
    .collect();

  if (existing.length === 0) {
    // Nothing justified and nothing recorded: do not create an inactive row
    // just to say "no".
    if (!derived.active) return false;
    await ctx.db.insert('entitlementGrants', {
      userId: userId,
      entitlementId: entitlementId,
      active: true,
      activeUntil: derived.activeUntil,
      state: derived.state,
      source: derived.source,
    });
    return true;
  }

  const current = existing[0];
  const currentUntil = current.activeUntil === undefined ? null : current.activeUntil;
  const currentState = current.state === undefined ? null : current.state;
  // Going inactive keeps the last transaction that justified the grant, so the
  // row still says why it was ever on.
  const nextSource = derived.source === '' ? current.source : derived.source;

  // What counts as a change is (active, activeUntil, state) — the answer the app
  // gates on, plus how it is being granted. `state` joined this key because an
  // active -> grace transition can move NEITHER of the other two: when a second
  // product's grace window is the later horizon, the user keeps access with the
  // same `activeUntil` and only the reason changes. That is precisely the
  // transition a developer wants to hear about (payment is failing), so a key
  // of (active, activeUntil) alone would drop the most actionable signal the
  // feed carries.
  //
  // `source` is still deliberately NOT in the key: it is provenance, and when
  // one of two products backing an entitlement lapses, the surviving one
  // becomes the justification without the user's access moving at all.
  const accessMoved = current.active !== derived.active
    || currentUntil !== derived.activeUntil
    || currentState !== derived.state;
  const sourceMoved = current.source !== nextSource;
  if (!accessMoved && !sourceMoved) return false;
  await ctx.db.patch('entitlementGrants', current._id, {
    active: derived.active,
    activeUntil: derived.activeUntil,
    // Cleared, not left stale: the invariant is that `state` is non-null exactly
    // when `active` is true, so an inactive row never names a lifecycle state.
    state: derived.state,
    source: nextSource,
  });
  return accessMoved;
}

// The highest seq the change feed has issued, or 0. Callers add to it
// themselves rather than calling this once per row: a mutation's writes are
// buffered, so re-reading the max mid-handler is not guaranteed to observe
// rows this same handler just inserted.
//
// PROTOTYPE CONCURRENCY GAP: two mutations committing concurrently can read
// the same max and mint the same seq, which would let a poller miss one of
// them. A real deployment needs an atomic allocator — that is the unpublished
// scoped-sequences surface (guide/backend/sequences.md), not something to
// hand-roll further than this.
async function readMaxChangeSeq(ctx) {
  const last = await ctx.db
    .query('entitlementChanges')
    .withIndex('by_seq')
    .order('seq', 'desc')
    .take(1)
    .collect();
  return last.length === 0 ? 0 : last[0].seq;
}

// Append one feed row and, if a developer has registered an endpoint, schedule
// the outbound ping for it.
//
// The enqueue is transactional with the append: they land in the same commit,
// so a rolled-back reconcile provably schedules no delivery. The job carries a
// URL snapshot rather than re-reading at send time — actions have no ctx.db,
// and pinning the URL also keeps the job's idempotency identity stable.
//
// The feed is the authoritative mechanism and the ping is only a hint, which
// is why `mayEnqueue` can be false: one sweep may move more users than the
// paved queue's 16-enqueues-per-mutation limit allows, and dropping a hint is
// harmless when the poller still sees every seq.
async function appendChange(ctx, userId, seq, now, mayEnqueue) {
  await ctx.db.insert('entitlementChanges', {
    userId: userId,
    seq: seq,
    changedAt: now,
  });
  if (!mayEnqueue) return false;
  const endpoints = await ctx.db
    .query('webhookEndpoints')
    .withIndex('by_active')
    .eq('active', true)
    .take(1)
    .collect();
  if (endpoints.length === 0) return false;
  await ctx.jobs.enqueue(
    'notifyDeveloper',
    { userId: userId, seq: seq, url: endpoints[0].url },
    // One delivery per feed position, however many times this mutation is
    // retried; maxAttempts is the retry ladder for a failing endpoint.
    { idempotencyKey: 'change:' + seq, maxAttempts: 5 },
  );
  return true;
}

// Recompute every entitlement a product can affect. Returns how many moved.
async function applyProductEntitlements(ctx, userId, productId) {
  const mappings = await ctx.db
    .query('productEntitlements')
    .withIndex('by_product')
    .eq('productId', productId)
    .collect();
  let changed = 0;
  for (const mapping of mappings) {
    const moved = await applyDerivedGrant(ctx, userId, mapping.entitlementId);
    if (moved) changed += 1;
  }
  return changed;
}

// --- Write path ---------------------------------------------------------------

// The one place a *new* purchase is written. Idempotent on the store's own
// transaction id, so a re-delivered notification is a no-op rather than a
// second grant. `grants` counts entitlement grants that actually moved.
export const recordPurchase = defineJsMutation({
  args: {
    productId: v.string(),
    store: v.string(),
    storeTxnId: v.string(),
    status: v.string(),
    environment: v.string(),
    expiresAt: v.optional(v.integer()),
    graceUntil: v.optional(v.integer()),
    resumesAt: v.optional(v.integer()),
  },
  reads: ['transactions', 'productEntitlements', 'entitlementGrants', 'entitlementChanges', 'webhookEndpoints'],
  writes: ['transactions', 'entitlementGrants', 'entitlementChanges'],
  result: results.value(v.object({
    transactionId: v.string(),
    deduped: v.boolean(),
    grants: v.integer(),
  })),
  handler: async (ctx, args) => {
    const userId = ctx.auth.userId;
    if (!userId) throw new Error('recordPurchase requires an authenticated user');
    const storeTxnId = String(args.storeTxnId ?? '').trim();
    if (!storeTxnId) throw new Error('storeTxnId is required');
    if (args.environment !== 'sandbox' && args.environment !== 'production') {
      throw new Error('environment must be sandbox or production');
    }
    // The vocabulary is enforced at the write boundary, not just where a store
    // response is parsed: this mutation is callable directly, and a typo'd
    // status would otherwise land a row that `grantsAccess` silently reads as
    // "no access" forever.
    if (!isKnownTxnState(args.status)) {
      throw new Error('unknown transaction state: ' + args.status);
    }
    const graceUntil = readOptionalMs(args.graceUntil, 'graceUntil');
    const resumesAt = readOptionalMs(args.resumesAt, 'resumesAt');
    // A grace transaction with no graceUntil has no access horizon, which
    // `deriveGrant` would read as perpetual — grace that never ends. Refuse it
    // at the boundary rather than granting someone free access forever.
    if (args.status === 'grace' && graceUntil === null) {
      throw new Error('a grace transaction requires graceUntil');
    }

    // Dedupe on the store's identity, not ours. This is what makes the
    // notification-triggered path safe to replay.
    const seen = await ctx.db
      .query('transactions')
      .withIndex('by_storeTxn')
      .eq('storeTxnId', storeTxnId)
      .collect();
    if (seen.length > 0) {
      return { transactionId: seen[0]._id, deduped: true, grants: 0 };
    }

    const expiresAt = readOptionalMs(args.expiresAt, 'expiresAt');
    const transactionId = await ctx.db.insert('transactions', {
      userId: userId,
      productId: args.productId,
      store: args.store,
      storeTxnId: storeTxnId,
      status: args.status,
      environment: args.environment,
      expiresAt: expiresAt,
      graceUntil: graceUntil,
      resumesAt: resumesAt,
    });

    // Derive, never assign: the new transaction is now one input among the
    // user's transactions, and the grant is recomputed from all of them.
    const granted = await applyProductEntitlements(ctx, userId, args.productId);
    if (granted > 0) {
      await appendChange(ctx, userId, (await readMaxChangeSeq(ctx)) + 1, ctx.runtime.now(), true);
    }
    return { transactionId: transactionId, deduped: false, grants: granted };
  },
});

// The notification/receipt trigger. The payload says "something happened";
// the action decides what is true and hands typed values to the mutation.
// `environment` is routing input, not committed state: Apple really does have
// separate sandbox and production verification endpoints, so the caller says
// which one to ask. What comes back is what gets stored — if the store answers
// `production` for a receipt the caller called `sandbox`, the store wins.
//
// @ref LLP 0036#runtime-exposure-d5-d8 — the credential reaches the
//   request as a redacting handle materialized only into the header.
export const validateReceipt = defineAction({
  args: {
    productId: v.string(),
    store: v.string(),
    receipt: v.string(),
    environment: v.string(),
    // Testing seam: the fake store binds an OS-assigned port. Real adapters
    // will carry a per-store constant instead of accepting a caller URL.
    storeBaseUrl: v.optional(v.string()),
  },
  uses: ['storeValidation'],
  writes: ['transactions', 'entitlementGrants', 'entitlementChanges'],
  // expiresAt is optional now: a `pending` purchase has not bought a window
  // yet, and a `paused` one has no active window to report. Forcing an integer
  // here would have meant inventing one.
  result: results.value(v.object({
    storeTxnId: v.string(),
    status: v.string(),
    environment: v.string(),
    expiresAt: v.optional(v.integer()),
    graceUntil: v.optional(v.integer()),
    resumesAt: v.optional(v.integer()),
    deduped: v.boolean(),
  })),
  handler: async (ctx, args) => {
    const receipt = String(args.receipt ?? '').trim();
    if (!receipt) throw new Error('receipt is required');
    if (args.environment !== 'sandbox' && args.environment !== 'production') {
      throw new Error('environment must be sandbox or production');
    }
    const baseUrl = String(args.storeBaseUrl ?? '').trim();
    if (!baseUrl) throw new Error('storeBaseUrl is required until real store adapters land');

    const response = await ctx.fetch({
      url: baseUrl + '/validate',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // @ref LLP 0036#runtime-exposure-d5-d8 — asBearer() is the
        // narrow materialization; the handle itself redacts everywhere else.
        authorization: ctx.secrets.get('storeValidation').asBearer(),
      },
      body: JSON.stringify({
        store: args.store,
        productId: args.productId,
        receipt: receipt,
        environment: args.environment,
      }),
    });
    if (!response.ok) {
      throw new Error('store validation refused: ' + response.status);
    }

    // Treat the response as data, never as authority. Every field is checked
    // before it reaches the mutation.
    const state = JSON.parse(response.bodyText);
    const storeTxnId = String(state.storeTxnId ?? '').trim();
    const status = String(state.status ?? '');
    const environment = String(state.environment ?? '');
    if (!storeTxnId) throw new Error('store returned no storeTxnId');
    if (!isKnownTxnState(status)) {
      throw new Error('store returned an unknown status: ' + status);
    }
    if (environment !== 'sandbox' && environment !== 'production') {
      throw new Error('store returned an unknown environment: ' + environment);
    }
    const expiresAt = readOptionalMs(state.expiresAt, 'expiresAt');
    const graceUntil = readOptionalMs(state.graceUntil, 'graceUntil');
    const resumesAt = readOptionalMs(state.resumesAt, 'resumesAt');
    // An access-granting state must come with the horizon that bounds it. This
    // is the one shape of malformed store response that would grant unbounded
    // access rather than merely failing, so it is refused explicitly.
    if (status === 'grace' && graceUntil === null) {
      throw new Error('store reported grace with no graceUntil');
    }

    // An optional arg means ABSENT or integer — not nullable. Passing an
    // explicit null is a served-contract violation, so a horizon this state does
    // not have is omitted rather than nulled. Same rule on the way out.
    const payload = {
      productId: args.productId,
      store: args.store,
      storeTxnId: storeTxnId,
      status: status,
      environment: environment,
    };
    if (expiresAt !== null) payload.expiresAt = expiresAt;
    if (graceUntil !== null) payload.graceUntil = graceUntil;
    if (resumesAt !== null) payload.resumesAt = resumesAt;
    const commit = await ctx.runMutation('recordPurchase', payload);

    const out = {
      storeTxnId: storeTxnId,
      status: status,
      environment: environment,
      deduped: commit.deduped === true,
    };
    if (expiresAt !== null) out.expiresAt = expiresAt;
    if (graceUntil !== null) out.graceUntil = graceUntil;
    if (resumesAt !== null) out.resumesAt = resumesAt;
    return out;
  },
});

// --- Notification path ---------------------------------------------------------

// Commit one store-authoritative transaction state and recompute what it
// affects. The caller is an action that just fetched this state; the mutation
// itself trusts only its typed arguments and the database.
//
// PROTOTYPE AUTHORITY GAP: userId is an argument rather than ctx.auth.userId,
// because a store notification arrives with no user session attached. In dev
// auth that makes this mutation callable for any user id. A real deployment
// must fence it to system authority; the authoring surface has no
// system-only requirement today (public | optional-user | authenticated).
export const reconcileTransaction = defineJsMutation({
  args: {
    userId: v.string(),
    productId: v.string(),
    store: v.string(),
    storeTxnId: v.string(),
    status: v.string(),
    environment: v.string(),
    expiresAt: v.optional(v.integer()),
    graceUntil: v.optional(v.integer()),
    resumesAt: v.optional(v.integer()),
  },
  reads: ['transactions', 'productEntitlements', 'entitlementGrants', 'entitlementChanges', 'webhookEndpoints'],
  writes: ['transactions', 'entitlementGrants', 'entitlementChanges'],
  result: results.value(v.object({
    changed: v.boolean(),
    entitlementsChanged: v.integer(),
    transactionChanged: v.boolean(),
  })),
  handler: async (ctx, args) => {
    const storeTxnId = String(args.storeTxnId ?? '').trim();
    if (!storeTxnId) throw new Error('storeTxnId is required');
    if (args.environment !== 'sandbox' && args.environment !== 'production') {
      throw new Error('environment must be sandbox or production');
    }
    if (!isKnownTxnState(args.status)) {
      throw new Error('unknown transaction state: ' + args.status);
    }
    const nextUntil = readOptionalMs(args.expiresAt, 'expiresAt');
    const nextGrace = readOptionalMs(args.graceUntil, 'graceUntil');
    const nextResumes = readOptionalMs(args.resumesAt, 'resumesAt');
    if (args.status === 'grace' && nextGrace === null) {
      throw new Error('a grace transaction requires graceUntil');
    }

    const seen = await ctx.db
      .query('transactions')
      .withIndex('by_storeTxn')
      .eq('storeTxnId', storeTxnId)
      .collect();

    let userId = args.userId;
    let productId = args.productId;
    let transactionChanged = false;
    if (seen.length === 0) {
      // A notification may be the first time we hear about a transaction.
      await ctx.db.insert('transactions', {
        userId: userId,
        productId: productId,
        store: args.store,
        storeTxnId: storeTxnId,
        status: args.status,
        environment: args.environment,
        expiresAt: nextUntil,
        graceUntil: nextGrace,
        resumesAt: nextResumes,
      });
      transactionChanged = true;
    } else {
      const row = seen[0];
      // The stored row owns the identity, not the notification. A payload
      // claiming someone else's transaction is a hard error, not a rewrite.
      if (row.userId !== userId) {
        throw new Error('storeTxnId belongs to a different user');
      }
      userId = row.userId;
      productId = row.productId;
      const rowUntil = row.expiresAt === undefined ? null : row.expiresAt;
      const rowGrace = row.graceUntil === undefined ? null : row.graceUntil;
      const rowResumes = row.resumesAt === undefined ? null : row.resumesAt;
      // All three horizons join the comparison, not just expiresAt. A
      // subscription moving active -> grace often keeps the same expiresAt and
      // only gains a graceUntil; treating that as "unchanged" would leave the
      // stored row claiming the user is still fully paid up.
      if (row.status !== args.status
        || rowUntil !== nextUntil
        || rowGrace !== nextGrace
        || rowResumes !== nextResumes) {
        await ctx.db.patch('transactions', row._id, {
          status: args.status,
          expiresAt: nextUntil,
          graceUntil: nextGrace,
          resumesAt: nextResumes,
        });
        transactionChanged = true;
      }
    }

    const entitlementsChanged = await applyProductEntitlements(ctx, userId, productId);
    // Only an actual move in the active set reaches the feed. A redundant
    // notification updates nothing and says nothing.
    if (entitlementsChanged > 0) {
      await appendChange(ctx, userId, (await readMaxChangeSeq(ctx)) + 1, ctx.runtime.now(), true);
    }
    return {
      changed: entitlementsChanged > 0,
      entitlementsChanged: entitlementsChanged,
      transactionChanged: transactionChanged,
    };
  },
});

// Decision 19, directly: the notification is a thin trigger. Its arguments say
// only "something happened to this transaction" — no status, no expiry, no
// entitlement. The action asks the store what is true now, and reconciles.
//
// This is what makes a replayed, delayed, reordered, or forged-payload
// notification harmless: none of them can assert state.
export const applyStoreState = defineAction({
  args: {
    userId: v.string(),
    store: v.string(),
    storeTxnId: v.string(),
    // Testing seam, as on validateReceipt.
    storeBaseUrl: v.optional(v.string()),
  },
  uses: ['storeValidation'],
  writes: ['transactions', 'entitlementGrants', 'entitlementChanges'],
  result: results.value(v.object({
    storeTxnId: v.string(),
    status: v.string(),
    changed: v.boolean(),
  })),
  handler: async (ctx, args) => {
    const storeTxnId = String(args.storeTxnId ?? '').trim();
    if (!storeTxnId) throw new Error('storeTxnId is required');
    const baseUrl = String(args.storeBaseUrl ?? '').trim();
    if (!baseUrl) throw new Error('storeBaseUrl is required until real store adapters land');

    // Store transaction ids are opaque but path-safe in this prototype
    // (`apple:receipt_1`); a real adapter needs percent-encoding here.
    const response = await ctx.fetch({
      url: baseUrl + '/transactions/' + storeTxnId,
      method: 'GET',
      headers: {
        authorization: ctx.secrets.get('storeValidation').asBearer(),
      },
    });
    if (!response.ok) {
      throw new Error('store lookup refused: ' + response.status);
    }

    const state = JSON.parse(response.bodyText);
    const status = String(state.status ?? '');
    const environment = String(state.environment ?? '');
    const productId = String(state.productId ?? '');
    if (!isKnownTxnState(status)) {
      throw new Error('store returned an unknown status: ' + status);
    }
    if (environment !== 'sandbox' && environment !== 'production') {
      throw new Error('store returned an unknown environment: ' + environment);
    }
    if (!productId) throw new Error('store returned no productId');
    const expiresAt = readOptionalMs(state.expiresAt, 'expiresAt');
    const graceUntil = readOptionalMs(state.graceUntil, 'graceUntil');
    const resumesAt = readOptionalMs(state.resumesAt, 'resumesAt');
    if (status === 'grace' && graceUntil === null) {
      throw new Error('store reported grace with no graceUntil');
    }

    // Absent, never null — see the note on validateReceipt's payload.
    const payload = {
      userId: args.userId,
      productId: productId,
      store: args.store,
      storeTxnId: storeTxnId,
      status: status,
      environment: environment,
    };
    if (expiresAt !== null) payload.expiresAt = expiresAt;
    if (graceUntil !== null) payload.graceUntil = graceUntil;
    if (resumesAt !== null) payload.resumesAt = resumesAt;
    const commit = await ctx.runMutation('reconcileTransaction', payload);
    return {
      storeTxnId: storeTxnId,
      status: status,
      changed: commit.changed === true,
    };
  },
});

// --- Expiry -------------------------------------------------------------------

// Sweep grants whose access horizon has closed. Runs unauthenticated under
// system authority, so it is scoped by by_active rather than by_user.
//
// State-aware, and the guard is the point of the whole slice. Only 'active' and
// 'grace' rows own a clock the sweep may enforce:
//
//   active     -> expire once expiresAt passes
//   grace      -> expire once graceUntil passes
//   retry_hold -> NEVER. The store is still retrying payment; the subscription
//                 is alive and its `expiresAt` is already in the past, so a
//                 date-only sweep would tear it down mid-recovery.
//   paused     -> NEVER. `resumesAt` is a future RESUME, not an expiry. A sweep
//                 reading it as a deadline would delete paused subscriptions.
//   pending    -> NEVER. It never granted access; there is nothing to expire.
//
// Those three change only when the store says so, via an applyStoreState
// re-fetch. The three inactive states cannot reach this loop anyway — the
// by_active scan excludes them — so the explicit state guard is defence in
// depth for the one shape that could: a row that is active while naming a state
// this sweep does not own. It is left alone for the reconcile to resolve rather
// than expired on a horizon nobody promised.
export const applyGrantExpiry = defineJsMutation({
  args: {},
  reads: ['entitlementGrants', 'entitlementChanges', 'webhookEndpoints'],
  writes: ['entitlementGrants', 'entitlementChanges'],
  result: results.value(v.object({ expired: v.integer(), now: v.integer() })),
  handler: async (ctx) => {
    const now = ctx.runtime.now();
    // One sweep can flip many users at once, so the seq base is read once and
    // then advanced locally — every affected user still gets a distinct cursor
    // position even though they share a commit.
    let nextSeq = (await readMaxChangeSeq(ctx)) + 1;
    const notified = [];
    const live = await ctx.db
      .query('entitlementGrants')
      .withIndex('by_active')
      .eq('active', true)
      .collect();
    let expired = 0;
    for (const grant of live) {
      // Only a state whose clock this sweep owns may be expired by it.
      const state = grant.state === undefined ? null : grant.state;
      if (state !== 'active' && state !== 'grace') continue;
      const until = grant.activeUntil;
      // A grant with no activeUntil is perpetual (a non-consumable), so it is
      // never swept.
      if (until !== null && until !== undefined && until <= now) {
        // `state: null` alongside `active: false` keeps the read model's
        // invariant intact — an inactive row never names a lifecycle state.
        await ctx.db.patch('entitlementGrants', grant._id, { active: false, state: null });
        expired += 1;
        // One feed row per user, not per grant: the developer's question is
        // "whose access moved", and they re-read the whole answer anyway.
        if (notified.indexOf(grant.userId) < 0) {
          notified.push(grant.userId);
          // The paved queue admits 16 enqueues per mutation. Past that the
          // feed still records every user; only the courtesy ping is dropped.
          await appendChange(ctx, grant.userId, nextSeq, now, notified.length <= 16);
          nextSeq += 1;
        }
      }
    }
    return { expired: expired, now: now };
  },
});

// Cron targets an action, never a mutation; the action owns the commit call.
export const expireGrantsSweep = defineAction({
  args: {},
  writes: ['entitlementGrants', 'entitlementChanges'],
  result: results.value(v.object({ expired: v.integer() })),
  handler: async (ctx) => {
    const commit = await ctx.runMutation('applyGrantExpiry', {});
    return { expired: commit.expired };
  },
});

export const paymentsCron = defineCron({
  expireGrants: {
    // A minute is fine: expiry is a coarse, self-healing sweep, and a missed
    // tick only delays the flip. Jitter stays on (the default) — nothing about
    // this cadence is a product-fixed interval.
    schedule: { everyMs: 60_000 },
    action: 'expireGrantsSweep',
  },
});

// --- Outbound change feed (decision 20) -----------------------------------------

// The developer's poll. This is the mirror image of decision 19: just as we
// refuse to trust a store's payload, we refuse to hand the developer state in
// a notification. They learn *who* changed and re-read the authoritative
// answer themselves through getEntitlements.
//
// The result contract is the enforcement, not a convention: `records` of
// exactly { userId, seq } means adding entitlement state here would fail
// validation rather than quietly leaking.
//
// Cursor semantics are keyset, not "jump to the global max": resume from the
// last seq you received. With a bounded page, advancing to a global head
// instead would silently skip everything the page truncated.
export const pollChanges = defineJsQuery({
  args: { sinceSeq: v.integer() },
  reads: ['entitlementChanges'],
  result: results.records(v.object({ userId: v.string(), seq: v.integer() })),
  handler: async (ctx, args) => {
    const since = typeof args.sinceSeq === 'number' ? args.sinceSeq : 0;
    const rows = await ctx.db
      .query('entitlementChanges')
      .withIndex('by_seq')
      .gt('seq', since)
      .order('seq', 'asc')
      .take(100)
      .collect();
    return rows.map((row) => ({ userId: row.userId, seq: row.seq }));
  },
});

// A developer registers where they want pings delivered. One active endpoint
// per deployment in this prototype.
export const registerWebhookEndpoint = defineJsMutation({
  args: { url: v.string() },
  reads: ['webhookEndpoints'],
  writes: ['webhookEndpoints'],
  result: results.value(v.id('webhookEndpoints')),
  handler: async (ctx, args) => {
    const url = String(args.url ?? '').trim();
    if (!url) throw new Error('url is required');
    // Prototype fence only. A real registration must also refuse loopback and
    // link-local targets, or the webhook becomes an SSRF primitive.
    if (url.indexOf('http://') !== 0 && url.indexOf('https://') !== 0) {
      throw new Error('url must be http or https');
    }
    const existing = await ctx.db
      .query('webhookEndpoints')
      .withIndex('by_active')
      .eq('active', true)
      .take(1)
      .collect();
    if (existing.length > 0) {
      await ctx.db.patch('webhookEndpoints', existing[0]._id, { url: url });
      return existing[0]._id;
    }
    return await ctx.db.insert('webhookEndpoints', { url: url, active: true });
  },
});

// Actions have no ctx.db, so the delivery ledger is written through a mutation
// like every other durable effect. Attempt numbers are derived here rather
// than passed in, so a retried job cannot misreport which attempt it was.
export const recordDeliveryAttempt = defineJsMutation({
  args: {
    userId: v.string(),
    seq: v.integer(),
    endpoint: v.string(),
    outcome: v.string(),
    status: v.integer(),
  },
  reads: ['deliveries'],
  writes: ['deliveries'],
  result: results.value(v.integer()),
  handler: async (ctx, args) => {
    if (args.outcome !== 'delivered' && args.outcome !== 'failed') {
      throw new Error('outcome must be delivered or failed');
    }
    const prior = await ctx.db
      .query('deliveries')
      .withIndex('by_seq')
      .eq('seq', args.seq)
      .collect();
    const attempt = prior.length + 1;
    await ctx.db.insert('deliveries', {
      userId: args.userId,
      seq: args.seq,
      endpoint: args.endpoint,
      attempt: attempt,
      outcome: args.outcome,
      status: args.status,
      attemptedAt: ctx.runtime.now(),
    });
    return attempt;
  },
});

// The real outbound ping (decision 20, last mile). Run by the durable job
// queue, so a failing endpoint is retried with backoff instead of dropped.
//
// The body is { userId, seq } and nothing else. A developer receiving this
// learns only that something moved and must call back for the answer — which
// means a delayed, duplicated, or out-of-order ping is harmless.
//
// SIGNING GAP: the ping authenticates with a shared-secret bearer, which
// proves the sender but does NOT bind the body. A real webhook wants an HMAC
// over the payload, and the handler surface has no digest primitive to build
// one with (the host-op surface is db/jobs/runtime/host.fetch/sequence/push).
// See the demo README.
export const notifyDeveloper = defineAction({
  args: {
    userId: v.string(),
    seq: v.integer(),
    url: v.string(),
  },
  uses: ['developerWebhookSecret'],
  writes: ['deliveries'],
  result: results.value(v.object({
    delivered: v.boolean(),
    status: v.integer(),
    attempt: v.integer(),
  })),
  handler: async (ctx, args) => {
    const url = String(args.url ?? '').trim();
    if (!url) throw new Error('url is required');
    const body = JSON.stringify({ userId: args.userId, seq: args.seq });

    const response = await ctx.fetch({
      url: url,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: ctx.secrets.get('developerWebhookSecret').asBearer(),
      },
      body: body,
    });

    const delivered = response.ok === true && response.status === 200;
    // Record the attempt before deciding to fail, so the ledger shows the
    // whole retry ladder rather than only the attempt that finally worked.
    const attempt = await ctx.runMutation('recordDeliveryAttempt', {
      userId: args.userId,
      seq: args.seq,
      endpoint: url,
      outcome: delivered ? 'delivered' : 'failed',
      status: response.status,
    });
    if (!delivered) {
      // Throwing is what asks the queue for another attempt.
      throw new Error('developer endpoint refused: ' + response.status);
    }
    return { delivered: true, status: response.status, attempt: attempt };
  },
});

// The delivery ledger, so a suite can prove what was actually sent.
export const listDeliveries = defineQuery({
  table: 'deliveries',
  args: {},
  order: [asc('seq')],
  index: 'by_seq',
});
