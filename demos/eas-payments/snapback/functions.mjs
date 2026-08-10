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
  // Slice 8. The acknowledgement job's payload is just a storeTxnId, so unlike
  // validateReceipt and applyStoreState the ack action cannot be handed a store
  // URL by its caller — a job's arguments are minted inside a mutation that has
  // no idea what port a test fixture bound. Config is the paved way to inject a
  // deployment-specific endpoint, and it is what the testing-seam comments on
  // those two actions already said a real adapter should use instead of
  // accepting a caller URL.
  storeBaseUrl: {
    description: 'Base URL of the store API used for server-side acknowledgement',
    purpose: 'Lets the acknowledgement job reach the store without a caller-supplied URL',
    required: false,
    pool: false,
    howToGet:
      'Prototype: the acceptance sets the fake store\'s OS-assigned origin here. '
      + 'Real adapters carry a per-store constant (Google Play Developer API) '
      + 'rather than a configured value.',
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

// The two halves of the catalog graph, for the DEVELOPER rather than the app.
//
// An app never reads either of these: it asks "may this user do the thing" and
// gets entitlements back, and the mapping that produced them is deliberately
// invisible to it. A developer asks the opposite question — "which products
// grant this entitlement, and what is each of them called in each store" — and
// that is a management read, served under the /admin namespace (decision 11).
//
// Projected like listPurchases rather than `results.documents`, for the same
// reason: the shape is a contract. A column added to `entitlements` later
// cannot ride out to a dashboard because nobody re-read the payload.
//
// Both are bounded scans over an index with no equality bound, which is what a
// catalog listing is. The `take` is an honest cap rather than pagination — a
// products/entitlements catalog that outgrows it wants a real cursor, not a
// bigger number.
export const listEntitlements = defineJsQuery({
  args: {},
  reads: ['entitlements'],
  result: results.records(v.object({
    entitlementId: v.string(),
    title: v.string(),
  })),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query('entitlements')
      .withIndex('by_entitlement')
      .order('entitlementId', 'asc')
      .take(200)
      .collect();
    return rows.map((row) => ({
      entitlementId: row.entitlementId,
      title: row.title,
    }));
  },
});

// The join table itself, unaggregated. The dashboard renders one entitlement
// with its granting products, and a developer debugging a mis-sold bundle
// wants the raw edges — so this hands back edges and lets the reader group
// them, rather than picking one direction of the many-to-many here and making
// the other direction unavailable.
export const listProductEntitlements = defineJsQuery({
  args: {},
  reads: ['productEntitlements'],
  result: results.records(v.object({
    productId: v.string(),
    entitlementId: v.string(),
  })),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query('productEntitlements')
      .withIndex('by_entitlement')
      .order('entitlementId', 'asc')
      .take(500)
      .collect();
    return rows.map((row) => ({
      productId: row.productId,
      entitlementId: row.entitlementId,
    }));
  },
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
    // Slice 8. Still store facts, so they belong in the audit: whether the
    // store was told we accepted the purchase, and whether it was ever owed.
    ackState: v.string(),
    serverAckRequired: v.boolean(),
    // Slice 9. The money axis is a store fact too, and keeping it in the audit
    // rather than on the grant is deliberate: access derives from `status`, so a
    // refund's paper trail must not be somewhere an app might gate on it.
    refundState: v.string(),
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
      ackState: row.ackState,
      serverAckRequired: row.serverAckRequired,
      refundState: row.refundState,
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

// The after-sale money lifecycle (slice 9). A second axis, mirrored from the
// store and never computed here — we do not adjudicate refunds.
function isKnownRefundState(refundState) {
  return refundState === 'none'
    || refundState === 'requested'
    || refundState === 'granted'
    || refundState === 'reversed'
    || refundState === 'disputed'
    || refundState === 'dispute_won'
    || refundState === 'dispute_lost';
}

// What we tell the store when the consumption window is closing and the
// developer has not supplied anything.
//
// This is the documented default, and every field is a deliberate abstention:
// 'unknown' where we genuinely do not know, and 'no_preference' because we have
// no standing to ask for a refund outcome on the developer's behalf. Answering
// this is strictly better than missing the deadline — a missed deadline is Apple
// deciding without us, while this is Apple deciding without our input, which is
// the same outcome plus a record that we replied on time.
function defaultConsumptionAnswer() {
  return {
    consumptionStatus: 'unknown',
    deliveryStatus: 'unknown',
    refundPreference: 'no_preference',
  };
}

// Which adapters owe the store a server-side acknowledgement (slice 8).
//
// Only Google. Apple's acknowledgement is the client calling StoreKit's
// `finish` on a completed transaction — there is no server endpoint to call, and
// a server that tried would be inventing one. Stripe has no acknowledgement
// concept at all. Google Play is the outlier: an unacknowledged purchase is
// auto-refunded and revoked after three days, which makes acking a correctness
// requirement rather than hygiene.
//
// Keyed on the adapter rather than on a per-product flag because the obligation
// belongs to the store's protocol, not to what was sold.
function serverAckRequiredFor(store) {
  return store === 'google';
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

// Schedule the store acknowledgement for a freshly recorded transaction, in the
// SAME commit that recorded it (slice 8, reusing slice 5's outbox shape).
//
// Transactional enqueue is what makes the obligation safe to owe: a rolled-back
// purchase provably schedules no ack, and a committed one provably schedules
// exactly one. There is no window where the row exists and the obligation does
// not, which for a three-day deadline is the difference between "retried" and
// "auto-refunded".
//
// The idempotency key is the store's own transaction id, so however many times
// this mutation is retried the queue holds one ack per purchase.
// `maxAttempts: 5` mirrors the webhook ladder — finite, because a store that
// refuses five times needs an operator, not more retries.
//
// The operation rides in the payload because the choice needs `products.kind`
// and an action cannot read: there is no `ctx.runQuery`, and a mutation that
// only reads is refused at generation ("defineJsMutation requires declared
// writes or sequences"). Deciding here is safe in a way deciding a transaction's
// STATUS here would not be — `kind` is our own catalog fact and does not drift
// under a job the way a store's status does.
async function enqueueAcknowledgement(ctx, store, productId, storeTxnId) {
  if (!serverAckRequiredFor(store)) return false;
  // Consumables are CONSUMED, which also acknowledges. That is not a
  // preference: an unconsumed consumable cannot be bought again, so plain
  // acknowledge would silently cap the user at one purchase forever.
  const products = await ctx.db
    .query('products')
    .withIndex('by_product')
    .eq('productId', productId)
    .collect();
  const kind = products.length === 0 ? '' : products[0].kind;
  await ctx.jobs.enqueue(
    'acknowledgePurchase',
    {
      storeTxnId: storeTxnId,
      operation: kind === 'consumable' ? 'consume' : 'acknowledge',
    },
    { idempotencyKey: 'ack:' + storeTxnId, maxAttempts: 5 },
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
    refundState: v.optional(v.string()),
  },
  reads: ['transactions', 'productEntitlements', 'entitlementGrants', 'entitlementChanges', 'webhookEndpoints', 'products'],
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
    const refundState = args.refundState === undefined ? 'none' : args.refundState;
    if (!isKnownRefundState(refundState)) {
      throw new Error('unknown refund state: ' + refundState);
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
    const ackRequired = serverAckRequiredFor(args.store);
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
      // Every purchase starts unacknowledged. Whether anyone owes the store an
      // acknowledgement is the adapter's business, recorded alongside it.
      ackState: 'pending',
      serverAckRequired: ackRequired,
      refundState: refundState,
    });

    // Derive, never assign: the new transaction is now one input among the
    // user's transactions, and the grant is recomputed from all of them.
    const granted = await applyProductEntitlements(ctx, userId, args.productId);
    if (granted > 0) {
      await appendChange(ctx, userId, (await readMaxChangeSeq(ctx)) + 1, ctx.runtime.now(), true);
    }
    // Enqueued after the grant is written, and unconditionally on the grant
    // having moved: the obligation is owed for the PURCHASE, not for the
    // entitlement. A consumable grants nothing and still has to be consumed
    // before it can be bought again.
    await enqueueAcknowledgement(ctx, args.store, args.productId, storeTxnId);
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
    // Absent means 'none': a store that has nothing to say about refunds is the
    // ordinary case, not a malformed response.
    const refundState = state.refundState === undefined || state.refundState === null
      ? 'none'
      : String(state.refundState);
    if (!isKnownRefundState(refundState)) {
      throw new Error('store returned an unknown refund state: ' + refundState);
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
      refundState: refundState,
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
    refundState: v.optional(v.string()),
  },
  reads: ['transactions', 'productEntitlements', 'entitlementGrants', 'entitlementChanges', 'webhookEndpoints', 'products'],
  writes: ['transactions', 'entitlementGrants', 'entitlementChanges'],
  result: results.value(v.object({
    changed: v.boolean(),
    entitlementsChanged: v.integer(),
    transactionChanged: v.boolean(),
    refundState: v.string(),
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
    const nextRefundState = args.refundState === undefined ? 'none' : args.refundState;
    if (!isKnownRefundState(nextRefundState)) {
      throw new Error('unknown refund state: ' + nextRefundState);
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
        ackState: 'pending',
        serverAckRequired: serverAckRequiredFor(args.store),
        refundState: nextRefundState,
      });
      // A notification can be the first time we hear about a purchase, and that
      // purchase owes the store an acknowledgement exactly like one we recorded
      // ourselves. Enqueuing here too closes what would otherwise be a hole
      // where a notification-first Google purchase is never acknowledged and is
      // auto-refunded three days later.
      await enqueueAcknowledgement(ctx, args.store, productId, storeTxnId);
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
      const rowRefundState = row.refundState === undefined ? 'none' : row.refundState;
      // All three horizons join the comparison, not just expiresAt. A
      // subscription moving active -> grace often keeps the same expiresAt and
      // only gains a graceUntil; treating that as "unchanged" would leave the
      // stored row claiming the user is still fully paid up.
      //
      // refundState joins it too (slice 9), and it is the axis that moves on its
      // own most often: a dispute closing 'lost' leaves status 'revoked' exactly
      // where it already was, so refundState is the ONLY thing that changed. Omit
      // it here and the row would keep claiming the dispute is still open.
      if (row.status !== args.status
        || rowUntil !== nextUntil
        || rowGrace !== nextGrace
        || rowResumes !== nextResumes
        || rowRefundState !== nextRefundState) {
        await ctx.db.patch('transactions', row._id, {
          status: args.status,
          expiresAt: nextUntil,
          graceUntil: nextGrace,
          resumesAt: nextResumes,
          refundState: nextRefundState,
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
      refundState: nextRefundState,
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
    refundState: v.string(),
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
    // The after-sale axis (slice 9). Absent means 'none'.
    const refundState = state.refundState === undefined || state.refundState === null
      ? 'none'
      : String(state.refundState);
    if (!isKnownRefundState(refundState)) {
      throw new Error('store returned an unknown refund state: ' + refundState);
    }

    // Absent, never null — see the note on validateReceipt's payload.
    const payload = {
      userId: args.userId,
      productId: productId,
      store: args.store,
      storeTxnId: storeTxnId,
      status: status,
      environment: environment,
      refundState: refundState,
    };
    if (expiresAt !== null) payload.expiresAt = expiresAt;
    if (graceUntil !== null) payload.graceUntil = graceUntil;
    if (resumesAt !== null) payload.resumesAt = resumesAt;
    const commit = await ctx.runMutation('reconcileTransaction', payload);
    return {
      storeTxnId: storeTxnId,
      status: status,
      refundState: commit.refundState,
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

// --- Store acknowledgement (slice 8) -------------------------------------------

// Record that the store accepted our acknowledgement.
//
// Every durable guard lives here rather than in the action, because this is the
// only place that can see current state at commit time. The action carries a
// route; this decides whether the fact is allowed to land.
export const markAcknowledged = defineJsMutation({
  args: { storeTxnId: v.string(), ackState: v.string() },
  reads: ['transactions'],
  writes: ['transactions'],
  result: results.value(v.object({ changed: v.boolean(), ackState: v.string() })),
  handler: async (ctx, args) => {
    if (args.ackState !== 'acknowledged' && args.ackState !== 'consumed') {
      throw new Error('ackState must be acknowledged or consumed');
    }
    const rows = await ctx.db
      .query('transactions')
      .withIndex('by_storeTxn')
      .eq('storeTxnId', args.storeTxnId)
      .collect();
    if (rows.length === 0) throw new Error('unknown storeTxnId');
    const txn = rows[0];
    // Nothing was owed, so nothing may be recorded. This keeps an Apple or
    // Stripe row honest even if something calls the ack action directly.
    if (txn.serverAckRequired !== true) {
      return { changed: false, ackState: txn.ackState };
    }
    // One-way and idempotent: acknowledgement is a fact about the past, so a
    // duplicate job re-asserting it changes nothing. This is what makes the
    // queue's at-least-once delivery safe here.
    if (txn.ackState === 'acknowledged' || txn.ackState === 'consumed') {
      return { changed: false, ackState: txn.ackState };
    }
    await ctx.db.patch('transactions', txn._id, { ackState: args.ackState });
    return { changed: true, ackState: args.ackState };
  },
});

// The acknowledgement itself. Run by the durable job queue, so a store that is
// briefly unreachable is retried rather than leaving a purchase to be
// auto-refunded on the three-day deadline.
//
// Structurally identical to slice 5's notifyDeveloper: resolve, one outbound
// call, commit the outcome through a mutation, throw to ask for another attempt.
// The difference is who is owed — the developer's ping is a courtesy the feed
// makes redundant, while this one is an obligation with a refund attached, which
// is why it is enqueued for every qualifying purchase rather than only when
// something moved.
//
// @ref LLP 0036#runtime-exposure-d5-d8 — expose() rather than asBearer(): the
//   store origin is a configured endpoint, not a credential, and it has to be
//   concatenated into a URL rather than materialized into a header.
export const acknowledgePurchase = defineAction({
  args: { storeTxnId: v.string(), operation: v.string() },
  uses: ['storeValidation', 'storeBaseUrl'],
  writes: ['transactions'],
  result: results.value(v.object({
    operation: v.string(),
    acknowledged: v.boolean(),
    changed: v.boolean(),
  })),
  handler: async (ctx, args) => {
    const storeTxnId = String(args.storeTxnId ?? '').trim();
    if (!storeTxnId) throw new Error('storeTxnId is required');
    const operation = String(args.operation ?? '');
    if (operation !== 'acknowledge' && operation !== 'consume') {
      throw new Error('operation must be acknowledge or consume');
    }

    const baseUrl = String(ctx.secrets.get('storeBaseUrl').expose() ?? '').trim();
    if (!baseUrl) throw new Error('storeBaseUrl config is required to acknowledge');
    const route = operation === 'consume' ? '/consume/' : '/acknowledge/';

    // Both store routes are idempotent, as Google's are, so a retried job
    // re-asserting an acknowledgement is safe on the store's side too.
    const response = await ctx.fetch({
      url: baseUrl + route + storeTxnId,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: ctx.secrets.get('storeValidation').asBearer(),
      },
      body: '{}',
    });
    if (!response.ok) {
      // Throwing is what asks the queue for another attempt. Deliberately NOT
      // recorded as acknowledged: the store is the only authority on whether it
      // accepted, and guessing here is exactly what the three-day deadline
      // punishes — we would believe we were safe while the refund landed.
      throw new Error('store refused acknowledgement: ' + response.status);
    }

    // The mutation owns every durable guard: not-owed, and already-settled.
    const commit = await ctx.runMutation('markAcknowledged', {
      storeTxnId: storeTxnId,
      ackState: operation === 'consume' ? 'consumed' : 'acknowledged',
    });
    return {
      operation: operation,
      acknowledged: true,
      changed: commit.changed === true,
    };
  },
});

// --- Consumption requests (slice 9) --------------------------------------------

// Apple asks US for consumption data before deciding a refund, and gives us a
// window to answer. Recording the request is what makes the deadline durable:
// the obligation lives in a row, not in a timer.
//
// EXACTLY ONE job, and that is a correctness requirement rather than economy.
//
// The first version enqueued two — an eager attempt at delayMs 0 and a deadline
// alarm — so a request could be answered the moment the developer supplied data.
// Both became due in the same drain wave, both resolved "not answered yet"
// before either recorded, and the store received TWO consumption responses.
//
// The race is not fixable by claiming the response before the POST: a claim that
// precedes delivery makes a failed POST look answered, which for a deadline
// obligation is the worst possible failure. Send-then-record is the required
// order, and it means concurrent resolvers cannot be made safe — so there must
// not be concurrent resolvers.
//
// One alarm, therefore, keyed on the transaction. The cost is that we answer when
// the alarm fires rather than the instant the developer replies, and that cost is
// nothing: the obligation is "answer before the deadline", not "answer instantly".
// Apple does not care where in the window the response lands.
export const openConsumptionRequest = defineJsMutation({
  args: {
    storeTxnId: v.string(),
    windowMs: v.integer(),
    // Testing knob, in the same spirit as all-aboard's pollBudgetMs: when the
    // alarm fires inside the window. Clamped below so it can never land ON or
    // AFTER the deadline, which would defeat the point of having an alarm.
    alarmDelayMs: v.optional(v.integer()),
  },
  reads: ['consumptionRequests', 'transactions'],
  writes: ['consumptionRequests'],
  result: results.value(v.object({
    requestId: v.string(),
    deadlineAt: v.integer(),
    deduped: v.boolean(),
  })),
  handler: async (ctx, args) => {
    const storeTxnId = String(args.storeTxnId ?? '').trim();
    if (!storeTxnId) throw new Error('storeTxnId is required');
    if (args.windowMs <= 0) throw new Error('windowMs must be positive');

    const txns = await ctx.db
      .query('transactions')
      .withIndex('by_storeTxn')
      .eq('storeTxnId', storeTxnId)
      .collect();
    if (txns.length === 0) throw new Error('unknown storeTxnId: ' + storeTxnId);

    // A re-delivered CONSUMPTION_REQUEST is one obligation, not two. Returning
    // the existing row keeps the original deadline, which is the honest one.
    const existing = await ctx.db
      .query('consumptionRequests')
      .withIndex('by_txn')
      .eq('storeTxnId', storeTxnId)
      .collect();
    if (existing.length > 0) {
      return {
        requestId: existing[0]._id,
        deadlineAt: existing[0].deadlineAt,
        deduped: true,
      };
    }

    const now = ctx.runtime.now();
    const deadlineAt = now + args.windowMs;
    const requestId = await ctx.db.insert('consumptionRequests', {
      storeTxnId: storeTxnId,
      requestedAt: now,
      deadlineAt: deadlineAt,
    });

    const requested = args.alarmDelayMs === undefined
      ? Math.floor(args.windowMs / 2)
      : args.alarmDelayMs;
    // Never at or past the deadline: an alarm that fires when the window has
    // already closed is not an alarm.
    const alarmDelayMs = Math.max(0, Math.min(requested, args.windowMs - 1));

    // `atDeadline: true` because this job IS the deadline: when it runs, it
    // answers with whatever exists — the developer's facts if they arrived, the
    // documented default if not.
    await ctx.jobs.enqueue(
      'handleConsumptionRequest',
      { storeTxnId: storeTxnId, atDeadline: true },
      {
        idempotencyKey: 'consumption:' + storeTxnId,
        maxAttempts: 5,
        delayMs: alarmDelayMs,
      },
    );
    return { requestId: requestId, deadlineAt: deadlineAt, deduped: false };
  },
});

// How the developer supplies per-transaction consumption facts (management API).
//
// A stub in the sense that the real surface would be authenticated developer
// API rather than an app mutation — but the DIVISION is the real design: we hold
// no wallet, so we cannot know whether a user consumed what they bought. Only
// the developer knows. The Engine owns the deadline and the delivery; the
// developer owns the facts.
//
// Requires an open request. You answer a question that was asked — pre-supplying
// data for a refund nobody is considering is out of scope.
export const setConsumptionData = defineJsMutation({
  args: {
    storeTxnId: v.string(),
    consumptionStatus: v.string(),
    deliveryStatus: v.string(),
    refundPreference: v.string(),
  },
  reads: ['consumptionRequests'],
  writes: ['consumptionRequests'],
  result: results.value(v.object({ accepted: v.boolean() })),
  handler: async (ctx, args) => {
    if (args.consumptionStatus !== 'not_consumed'
      && args.consumptionStatus !== 'partially_consumed'
      && args.consumptionStatus !== 'fully_consumed') {
      throw new Error('unknown consumptionStatus: ' + args.consumptionStatus);
    }
    if (args.deliveryStatus !== 'delivered' && args.deliveryStatus !== 'not_delivered') {
      throw new Error('unknown deliveryStatus: ' + args.deliveryStatus);
    }
    // We never adjudicate, but the developer may state a preference and the store
    // decides. 'no_preference' is the abstention.
    if (args.refundPreference !== 'no_preference'
      && args.refundPreference !== 'grant'
      && args.refundPreference !== 'decline') {
      throw new Error('unknown refundPreference: ' + args.refundPreference);
    }
    const rows = await ctx.db
      .query('consumptionRequests')
      .withIndex('by_txn')
      .eq('storeTxnId', args.storeTxnId)
      .collect();
    if (rows.length === 0) throw new Error('no open consumption request for ' + args.storeTxnId);
    await ctx.db.patch('consumptionRequests', rows[0]._id, {
      consumptionStatus: args.consumptionStatus,
      deliveryStatus: args.deliveryStatus,
      refundPreference: args.refundPreference,
    });
    return { accepted: true };
  },
});

// The two halves of settling a consumption request, around one outbound call.
//
// One function with a phase rather than two functions, and the reason is a
// platform constraint worth naming: the resolve half must READ durable state at
// execution time (the developer's data may arrive between the request and the
// alarm, so it cannot be baked into a job's arguments), an action cannot read,
// and a mutation that only reads is refused at generation. Splitting this into a
// read-only `resolve` plus a writing `record` would mean declaring
// `writes: ['consumptionRequests']` on a function that never writes.
//
// Keeping them together makes the declaration truthful — this function does
// write consumptionRequests — and keeps the ordering obvious: resolve, send,
// record. Send-then-record is the required order, because claiming the response
// before the POST would leave a failed POST looking answered.
export const settleConsumptionRequest = defineJsMutation({
  args: {
    storeTxnId: v.string(),
    phase: v.string(),
    atDeadline: v.optional(v.boolean()),
    outcome: v.optional(v.string()),
  },
  reads: ['consumptionRequests'],
  writes: ['consumptionRequests'],
  result: results.value(v.object({
    respond: v.boolean(),
    reason: v.string(),
    outcome: v.string(),
    consumptionStatus: v.string(),
    deliveryStatus: v.string(),
    refundPreference: v.string(),
  })),
  handler: async (ctx, args) => {
    if (args.phase !== 'resolve' && args.phase !== 'record') {
      throw new Error('phase must be resolve or record');
    }
    const rows = await ctx.db
      .query('consumptionRequests')
      .withIndex('by_txn')
      .eq('storeTxnId', args.storeTxnId)
      .collect();
    if (rows.length === 0) throw new Error('no consumption request for ' + args.storeTxnId);
    const row = rows[0];
    const fallback = defaultConsumptionAnswer();

    if (args.phase === 'record') {
      const outcome = args.outcome === undefined ? 'reported' : args.outcome;
      if (outcome !== 'reported' && outcome !== 'default') {
        throw new Error('outcome must be reported or default');
      }
      // Idempotent: the first response is the one that counts, so a duplicate
      // job cannot move respondedAt later and make an on-time answer look late.
      if (row.respondedAt === undefined || row.respondedAt === null) {
        await ctx.db.patch('consumptionRequests', row._id, {
          respondedAt: ctx.runtime.now(),
          outcome: outcome,
        });
      }
      return {
        respond: false,
        reason: 'recorded',
        outcome: outcome,
        consumptionStatus: fallback.consumptionStatus,
        deliveryStatus: fallback.deliveryStatus,
        refundPreference: fallback.refundPreference,
      };
    }

    // resolve
    if (row.respondedAt !== undefined && row.respondedAt !== null) {
      return {
        respond: false,
        reason: 'already-answered',
        outcome: row.outcome === undefined ? 'reported' : row.outcome,
        consumptionStatus: fallback.consumptionStatus,
        deliveryStatus: fallback.deliveryStatus,
        refundPreference: fallback.refundPreference,
      };
    }
    const hasData = row.consumptionStatus !== undefined && row.consumptionStatus !== null;
    if (hasData) {
      return {
        respond: true,
        reason: 'developer-data',
        outcome: 'reported',
        consumptionStatus: row.consumptionStatus,
        deliveryStatus: row.deliveryStatus,
        refundPreference: row.refundPreference,
      };
    }
    if (args.atDeadline === true) {
      // The window is closing and nobody answered. Send the documented default
      // rather than miss the deadline.
      return {
        respond: true,
        reason: 'deadline-default',
        outcome: 'default',
        consumptionStatus: fallback.consumptionStatus,
        deliveryStatus: fallback.deliveryStatus,
        refundPreference: fallback.refundPreference,
      };
    }
    // Still inside the window: hold, and let the alarm decide.
    return {
      respond: false,
      reason: 'awaiting-developer-data',
      outcome: 'reported',
      consumptionStatus: fallback.consumptionStatus,
      deliveryStatus: fallback.deliveryStatus,
      refundPreference: fallback.refundPreference,
    };
  },
});

// Answer the store's consumption request. Run by the durable job queue in both
// its roles — the eager attempt and the deadline alarm — with `atDeadline`
// telling it which one it is.
//
// The obligation is outbound and time-bounded, so the failure we care most about
// is silence. Missing the deadline means Apple decides with no input from us;
// answering with the documented default means Apple decides with an explicit
// abstention on the record. The second is strictly better and is what the alarm
// guarantees.
export const handleConsumptionRequest = defineAction({
  args: { storeTxnId: v.string(), atDeadline: v.optional(v.boolean()) },
  uses: ['storeValidation', 'storeBaseUrl'],
  writes: ['consumptionRequests'],
  result: results.value(v.object({
    responded: v.boolean(),
    reason: v.string(),
    outcome: v.string(),
  })),
  handler: async (ctx, args) => {
    const storeTxnId = String(args.storeTxnId ?? '').trim();
    if (!storeTxnId) throw new Error('storeTxnId is required');
    const atDeadline = args.atDeadline === true;

    const plan = await ctx.runMutation('settleConsumptionRequest', {
      storeTxnId: storeTxnId,
      phase: 'resolve',
      atDeadline: atDeadline,
    });
    if (plan.respond !== true) {
      return { responded: false, reason: plan.reason, outcome: plan.outcome };
    }

    const baseUrl = String(ctx.secrets.get('storeBaseUrl').expose() ?? '').trim();
    if (!baseUrl) throw new Error('storeBaseUrl config is required to answer');

    const response = await ctx.fetch({
      url: baseUrl + '/consumption/' + storeTxnId,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: ctx.secrets.get('storeValidation').asBearer(),
      },
      body: JSON.stringify({
        consumptionStatus: plan.consumptionStatus,
        deliveryStatus: plan.deliveryStatus,
        refundPreference: plan.refundPreference,
      }),
    });
    if (!response.ok) {
      // Retry rather than record. An unrecorded response is recoverable; a
      // response recorded but never delivered is not.
      throw new Error('store refused the consumption response: ' + response.status);
    }

    await ctx.runMutation('settleConsumptionRequest', {
      storeTxnId: storeTxnId,
      phase: 'record',
      outcome: plan.outcome,
    });
    return { responded: true, reason: plan.reason, outcome: plan.outcome };
  },
});

// The consumption ledger, so a suite can prove we answered before the deadline.
export const listConsumptionRequests = defineQuery({
  table: 'consumptionRequests',
  args: {},
  order: [asc('storeTxnId')],
  index: 'by_txn',
});

// The delivery ledger, so a suite can prove what was actually sent.
export const listDeliveries = defineQuery({
  table: 'deliveries',
  args: {},
  order: [asc('seq')],
  index: 'by_seq',
});
