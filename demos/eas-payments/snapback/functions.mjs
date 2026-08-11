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

// Merchandising read: the cross-platform things on sale. Declarative because
// the plan vocabulary says it all.
//
// This is what a storefront lists — a user picks "Pro, monthly", not a Google
// base plan id. Which SKU that resolves to is the client's platform question,
// answered by listProducts below.
export const listPackages = defineQuery({
  table: 'packages',
  args: {},
  order: [asc('packageId')],
  index: 'by_package',
});

// The store SKUs. One row per (store, productId) — the atom a transaction
// names.
export const listProducts = defineQuery({
  table: 'products',
  args: {},
  order: [asc('store'), asc('productId')],
  index: 'by_store_product',
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

// The customer directory (slice 13). Derived from TRANSACTIONS, which is the
// only table that records every customer we have ever heard of.
//
// It replaces deriving the list from the change feed, and the bug that fixes is
// specific: before slice 13 the feed only carried entitlement events, so a
// customer who had only ever bought a consumable produced no feed row and was
// invisible to the dashboard. They had paid us money and did not exist.
//
// Purchase events (thread A) would now put them in the feed too, but the feed
// is still the wrong source: it is a CURSOR, bounded and meant to be walked
// forward from a position, while a directory is a set. Reading the set from the
// table that owns it means a customer appears because they transacted, not
// because an event about them happened to still be in the window.
//
// Projected, and deliberately narrow: who they are and how much they have
// bought. Entitlements are a separate read — that answer belongs to
// getEntitlements, and duplicating it here would be a second answer that could
// disagree with the one the app gates on.
//
// POC BOUND: 1,024 transactions scanned, which is the query ceiling — a bigger
// `take` is refused with SNAPBACK_QUERY_LIMIT_INVALID rather than silently
// truncated. `transactions` has no by-customer aggregate index, so this is an
// ordered scan over by_user; a real directory wants pagination over a customers
// table that this demo does not have.
export const listCustomers = defineJsQuery({
  args: {},
  reads: ['transactions'],
  result: results.records(v.object({
    userId: v.string(),
    transactions: v.integer(),
    firstPurchaseAt: v.integer(),
    lastPurchaseAt: v.integer(),
  })),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query('transactions')
      .withIndex('by_user')
      .order('userId', 'asc')
      .take(1024)
      .collect();
    // Grouped with plain locals rather than a lookup object: the inline-handler
    // surface forbids computed member access (`index[row.userId]`), and it does
    // not need one here — the by_user scan is ordered, so a customer's rows are
    // adjacent and one pass closes each group when the id changes.
    const out = [];
    let currentUser = null;
    let count = 0;
    let firstAt = 0;
    let lastAt = 0;
    for (const row of rows) {
      if (currentUser !== null && row.userId !== currentUser) {
        out.push({
          userId: currentUser,
          transactions: count,
          firstPurchaseAt: firstAt,
          lastPurchaseAt: lastAt,
        });
        currentUser = null;
      }
      if (currentUser === null) {
        currentUser = row.userId;
        count = 0;
        firstAt = row._createdAt;
        lastAt = row._createdAt;
      }
      count += 1;
      if (row._createdAt < firstAt) firstAt = row._createdAt;
      if (row._createdAt > lastAt) lastAt = row._createdAt;
    }
    if (currentUser !== null) {
      out.push({
        userId: currentUser,
        transactions: count,
        firstPurchaseAt: firstAt,
        lastPurchaseAt: lastAt,
      });
    }
    return out;
  },
});

// The join table itself, unaggregated. The dashboard renders one entitlement
// with its granting SKUs, and a developer debugging a mis-sold bundle
// wants the raw edges — so this hands back edges and lets the reader group
// them, rather than picking one direction of the many-to-many here and making
// the other direction unavailable.
//
// Each edge names the SKU by its compound identity, so `store` rides along:
// without it an edge row cannot say WHICH `pro_monthly` it means.
export const listProductEntitlements = defineJsQuery({
  args: {},
  reads: ['productEntitlements'],
  result: results.records(v.object({
    productId: v.string(),
    store: v.string(),
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
      store: row.store,
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
// read returns facts that were REPORTED to us — by the store, and since slice 13
// by the developer via acknowledgeConsumption — and never anything derived from
// them. No entitlement field will ever appear here; that answer is
// getEntitlements' alone.
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
    // Slice 13. The one field here that is NOT a store fact: whether the
    // developer says they gave the user what they bought. It belongs in the
    // audit anyway — "was this purchase honoured" is the question the audit
    // exists to answer for a consumable, and the alternative is a second read
    // that would have to be joined to this one at every call site.
    fulfillmentState: v.string(),
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
      fulfillmentState: row.fulfillmentState,
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

// The three closed vocabularies a developer may report. Factored out in slice 13
// because two surfaces now accept them — setConsumptionData (answering an open
// request) and acknowledgeConsumption (reporting fulfillment, usually long
// before any request exists) — and two copies of a vocabulary is how the two
// surfaces drift.
//
// 'unknown' is deliberately NOT admitted here even though
// defaultConsumptionAnswer emits it: that value is OUR abstention when the
// developer never answered, and a developer explicitly reporting "unknown"
// would be a different fact wearing the same word.
function isKnownConsumptionStatus(status) {
  return status === 'not_consumed'
    || status === 'partially_consumed'
    || status === 'fully_consumed';
}

function isKnownDeliveryStatus(status) {
  return status === 'delivered' || status === 'not_delivered';
}

// We never adjudicate, but the developer may state a preference and the store
// decides. 'no_preference' is the abstention.
function isKnownRefundPreference(preference) {
  return preference === 'no_preference'
    || preference === 'grant'
    || preference === 'decline';
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

// The SKU's compound identity as one comparable string. A NUL separator rather
// than ':' because store SKU strings legitimately contain colons and every other
// punctuation character a reader might reach for; NUL cannot appear in either
// half, so `apple` + `x:y` can never collide with `apple:x` + `y`.
function skuKey(store, productId) {
  return store + '\u0000' + productId;
}

// What the user's transactions currently justify for one entitlement. Pure
// read: several SKUs can grant the same entitlement — pro_monthly and pro_annual
// both grant `pro`, and so do the Apple, Google, and Stripe SKUs of each — so
// losing one does not necessarily lose it.
//
// THE PACKAGE IS NOT ON THIS PATH (slice 12). The walk is
// transaction -> product (SKU) -> productEntitlements -> entitlement, and the
// join key is the SKU's (store, productId). Grouping SKUs under a package is a
// merchandising convenience; making it load-bearing here would mean a catalog
// re-grouping could silently change what a past purchase grants.
//
// Decision 23's cross-platform union needs no code of its own as a result: a
// user holding both the Apple and the Google SKU for `pro` contributes two
// transactions to the same entitlement, and the union below is an ordinary max
// over both. There is no "same package" rule anywhere.
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
  // Membership is tested on the compound SKU identity, never on productId
  // alone: an Apple SKU and a Google SKU may share a string, and treating them
  // as one would grant `pro` for a purchase of somebody else's SKU.
  const skus = mappings.map((mapping) => skuKey(mapping.store, mapping.productId));
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
    if (skus.indexOf(skuKey(txn.store, txn.productId)) < 0) continue;
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
    .query('changeEvents')
    .withIndex('by_seq')
    .order('seq', 'desc')
    .take(1)
    .collect();
  return last.length === 0 ? 0 : last[0].seq;
}

// The closed event vocabulary (slice 13). Two types, one sequence.
function isKnownEventType(type) {
  return type === 'entitlement' || type === 'purchase';
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
async function appendChange(ctx, userId, seq, now, mayEnqueue, type) {
  if (!isKnownEventType(type)) {
    throw new Error('unknown event type: ' + type);
  }
  await ctx.db.insert('changeEvents', {
    userId: userId,
    seq: seq,
    type: type,
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
  //
  // `kind` lives on the PACKAGE, so this is the one place the SKU -> package
  // hop is load-bearing (slice 12). It is a merchandising fact — "this is a
  // consumable" is true of the thing being sold, not of one store's listing of
  // it — and reading it here rather than storing a copy on the SKU keeps a
  // single answer. A SKU whose package is missing yields '' and therefore
  // 'acknowledge', which is the safe default: acknowledging a consumable is
  // recoverable (it can be consumed later), while consuming a durable is not.
  const products = await ctx.db
    .query('products')
    .withIndex('by_store_product')
    .eq('store', store)
    .eq('productId', productId)
    .collect();
  const packageId = products.length === 0 ? '' : products[0].packageId;
  const packages = packageId === ''
    ? []
    : await ctx.db
      .query('packages')
      .withIndex('by_package')
      .eq('packageId', packageId)
      .collect();
  const kind = packages.length === 0 ? '' : packages[0].kind;
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

// Recompute every entitlement one SKU can affect. Returns how many moved.
//
// Scoped to the SKU, not to its package: buying the Apple SKU recomputes only
// the entitlements that Apple SKU maps to. The Google sibling's entitlements are
// recomputed too if and only if they are the same entitlements — which they
// normally are, and which is exactly how the cross-platform union stays correct
// without this function knowing anything about packages.
async function applyProductEntitlements(ctx, userId, store, productId) {
  const mappings = await ctx.db
    .query('productEntitlements')
    .withIndex('by_product')
    .eq('store', store)
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
//
// `productId` is the STORE SKU (slice 12) and travels with `store`; together
// they are the compound identity of a `products` row. Deliberately NOT
// validated against the catalog: the store is the authority on what was sold,
// and a purchase of a SKU we have not catalogued yet is a real event that must
// still be recorded. It simply maps to no entitlement — the same "good record,
// no grant" outcome a consumable already has.
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
  reads: ['transactions', 'productEntitlements', 'entitlementGrants', 'changeEvents', 'webhookEndpoints', 'products', 'packages'],
  writes: ['transactions', 'entitlementGrants', 'changeEvents'],
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
      // Nobody has fulfilled anything yet, and the developer has told us
      // nothing about consumption. Both are their axis, not ours.
      fulfillmentState: 'unfulfilled',
    });

    // Derive, never assign: the new transaction is now one input among the
    // user's transactions, and the grant is recomputed from all of them.
    const granted = await applyProductEntitlements(ctx, userId, args.store, args.productId);

    // Two event types, one sequence, causal order (slice 13). The seq base is
    // read ONCE — a mutation's writes are buffered, so re-reading the max after
    // the first append would not observe it — and advanced locally.
    //
    // The purchase event is unconditional. That is the change: a consumable
    // grants nothing, so before slice 13 a consumable purchase produced no
    // outbound signal at all and a developer polling the feed could not tell it
    // from silence. It now emits exactly one event, and that event is the only
    // one it emits — there is still no entitlement event, because nothing about
    // the user's access moved.
    const now = ctx.runtime.now();
    let nextSeq = (await readMaxChangeSeq(ctx)) + 1;
    await appendChange(ctx, userId, nextSeq, now, true, 'purchase');
    nextSeq += 1;
    // The entitlement event keeps its exact old meaning and its old condition:
    // emitted only when the active set actually moved.
    if (granted > 0) {
      await appendChange(ctx, userId, nextSeq, now, true, 'entitlement');
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
  writes: ['transactions', 'entitlementGrants', 'changeEvents'],
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
  reads: ['transactions', 'productEntitlements', 'entitlementGrants', 'changeEvents', 'webhookEndpoints', 'products', 'packages'],
  writes: ['transactions', 'entitlementGrants', 'changeEvents'],
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
    // The SKU's identity is (store, productId), so `store` is part of what the
    // stored row owns — see the identity note in the else-branch below. Reading
    // it from the payload after the row exists would let a notification's
    // `store` field re-point the reconcile at a different SKU's entitlements.
    let store = args.store;
    let transactionChanged = false;
    // Distinct from transactionChanged: that is true whenever any stored field
    // moved, while this is true only when the row did not exist before. Only
    // the second is a PURCHASE, and only it emits a purchase event.
    let recordedPurchase = false;
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
        fulfillmentState: 'unfulfilled',
      });
      // A notification can be the first time we hear about a purchase, and that
      // purchase owes the store an acknowledgement exactly like one we recorded
      // ourselves. Enqueuing here too closes what would otherwise be a hole
      // where a notification-first Google purchase is never acknowledged and is
      // auto-refunded three days later.
      await enqueueAcknowledgement(ctx, args.store, productId, storeTxnId);
      transactionChanged = true;
      recordedPurchase = true;
    } else {
      const row = seen[0];
      // The stored row owns the identity, not the notification. A payload
      // claiming someone else's transaction is a hard error, not a rewrite.
      if (row.userId !== userId) {
        throw new Error('storeTxnId belongs to a different user');
      }
      userId = row.userId;
      productId = row.productId;
      store = row.store;
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

    const entitlementsChanged = await applyProductEntitlements(ctx, userId, store, productId);

    // Same two-type, one-sequence shape as recordPurchase. The purchase event
    // is emitted only when this notification RECORDED a purchase — the
    // insert branch above — because a notification about a transaction we
    // already knew is not a new purchase however much of its state moved.
    const now = ctx.runtime.now();
    let nextSeq = (await readMaxChangeSeq(ctx)) + 1;
    if (recordedPurchase) {
      await appendChange(ctx, userId, nextSeq, now, true, 'purchase');
      nextSeq += 1;
    }
    // Only an actual move in the active set reaches the feed. A redundant
    // notification updates nothing and says nothing.
    if (entitlementsChanged > 0) {
      await appendChange(ctx, userId, nextSeq, now, true, 'entitlement');
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
  writes: ['transactions', 'entitlementGrants', 'changeEvents'],
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
  reads: ['entitlementGrants', 'changeEvents', 'webhookEndpoints'],
  writes: ['entitlementGrants', 'changeEvents'],
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
          // Expiry moves access, never a purchase: always 'entitlement'.
          await appendChange(ctx, grant.userId, nextSeq, now, notified.length <= 16, 'entitlement');
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
  writes: ['entitlementGrants', 'changeEvents'],
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
// exactly { userId, seq, type } means adding entitlement state here would fail
// validation rather than quietly leaking.
//
// `type` joined the contract in slice 13 and is the one thing here that is not
// pure routing: it tells a developer WHICH authoritative read to perform —
// getEntitlements for 'entitlement', listPurchases for 'purchase' — without
// telling them what that read will return. A consumable emits only a 'purchase'
// event, so without the type a developer would have to re-read entitlements,
// find them unchanged, and conclude nothing happened.
//
// Cursor semantics are keyset, not "jump to the global max": resume from the
// last seq you received. With a bounded page, advancing to a global head
// instead would silently skip everything the page truncated. The cursor is
// still one integer over one sequence — adding a type did not add a cursor.
export const pollChanges = defineJsQuery({
  args: { sinceSeq: v.integer() },
  reads: ['changeEvents'],
  result: results.records(v.object({
    userId: v.string(),
    seq: v.integer(),
    type: v.string(),
  })),
  handler: async (ctx, args) => {
    const since = typeof args.sinceSeq === 'number' ? args.sinceSeq : 0;
    const rows = await ctx.db
      .query('changeEvents')
      .withIndex('by_seq')
      .gt('seq', since)
      .order('seq', 'asc')
      .take(100)
      .collect();
    return rows.map((row) => ({ userId: row.userId, seq: row.seq, type: row.type }));
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
    if (!isKnownConsumptionStatus(args.consumptionStatus)) {
      throw new Error('unknown consumptionStatus: ' + args.consumptionStatus);
    }
    if (!isKnownDeliveryStatus(args.deliveryStatus)) {
      throw new Error('unknown deliveryStatus: ' + args.deliveryStatus);
    }
    if (!isKnownRefundPreference(args.refundPreference)) {
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

// The developer tells US they have fulfilled a purchase (slice 13).
//
// This is the missing half of the consumable story. `acknowledgePurchase` tells
// the STORE we accepted the sale; nothing until now recorded whether the
// DEVELOPER actually gave the user their coins. Those are different parties
// answering different questions and they fail independently, so this writes a
// separate `fulfillmentState` and never touches `ackState`.
//
// It does two things in one commit:
//
//   1. Records fulfillment on the transaction, with whatever consumption facts
//      the developer supplied.
//   2. If a CONSUMPTION_REQUEST is already open and unanswered for that
//      transaction, writes the same facts onto it — the setConsumptionData
//      path, reached without the developer having to notice a request exists.
//
// The transaction copy is the load-bearing one. Slice 9's setConsumptionData
// requires an open request, and rightly: you answer a question that was asked.
// But fulfillment happens at purchase time and Apple asks weeks later, if ever.
// Without somewhere to keep the answer early, every request would resolve to
// the deadline default even though the developer knew the answer all along.
// settleConsumptionRequest now reads these columns before falling back.
export const acknowledgeConsumption = defineJsMutation({
  args: {
    storeTxnId: v.string(),
    // All optional: the minimal call is "I fulfilled this", and that alone is
    // worth recording. Supplying facts is how the developer improves what we
    // will tell Apple if a refund is ever considered.
    consumptionStatus: v.optional(v.string()),
    deliveryStatus: v.optional(v.string()),
    refundPreference: v.optional(v.string()),
  },
  reads: ['transactions', 'consumptionRequests'],
  writes: ['transactions', 'consumptionRequests'],
  result: results.value(v.object({
    storeTxnId: v.string(),
    fulfillmentState: v.string(),
    changed: v.boolean(),
    requestUpdated: v.boolean(),
  })),
  handler: async (ctx, args) => {
    const storeTxnId = String(args.storeTxnId ?? '').trim();
    if (!storeTxnId) throw new Error('storeTxnId is required');
    if (args.consumptionStatus !== undefined
      && !isKnownConsumptionStatus(args.consumptionStatus)) {
      throw new Error('unknown consumptionStatus: ' + args.consumptionStatus);
    }
    if (args.deliveryStatus !== undefined && !isKnownDeliveryStatus(args.deliveryStatus)) {
      throw new Error('unknown deliveryStatus: ' + args.deliveryStatus);
    }
    if (args.refundPreference !== undefined
      && !isKnownRefundPreference(args.refundPreference)) {
      throw new Error('unknown refundPreference: ' + args.refundPreference);
    }

    const rows = await ctx.db
      .query('transactions')
      .withIndex('by_storeTxn')
      .eq('storeTxnId', storeTxnId)
      .collect();
    if (rows.length === 0) throw new Error('unknown storeTxnId: ' + storeTxnId);
    const txn = rows[0];

    // Acknowledging fulfillment IS reporting a delivery, so the default is
    // 'delivered' rather than absent. The other two stay absent unless supplied:
    // only the developer knows whether the user has spent the coins, and
    // guessing 'fully_consumed' on their behalf would be inventing evidence
    // Apple might act on.
    const deliveryStatus = args.deliveryStatus === undefined
      ? 'delivered'
      : args.deliveryStatus;
    const patch = { deliveryStatus: deliveryStatus };
    if (args.consumptionStatus !== undefined) patch.consumptionStatus = args.consumptionStatus;
    if (args.refundPreference !== undefined) patch.refundPreference = args.refundPreference;

    // One-way and idempotent, exactly like ackState: fulfillment is a fact
    // about the past. A repeat call may still refine the consumption facts —
    // 'partially_consumed' becoming 'fully_consumed' is real news — but it
    // never moves fulfilledAt, so an early fulfillment cannot be back-dated.
    const alreadyFulfilled = txn.fulfillmentState === 'fulfilled';
    if (!alreadyFulfilled) {
      patch.fulfillmentState = 'fulfilled';
      patch.fulfilledAt = ctx.runtime.now();
    }
    await ctx.db.patch('transactions', txn._id, patch);

    // If Apple has already asked, answer the open request too. Only while it is
    // unanswered: a response we have already sent is not revisable.
    let requestUpdated = false;
    const requests = await ctx.db
      .query('consumptionRequests')
      .withIndex('by_txn')
      .eq('storeTxnId', storeTxnId)
      .collect();
    if (requests.length > 0) {
      const request = requests[0];
      const answered = request.respondedAt !== undefined && request.respondedAt !== null;
      if (!answered) {
        const fallback = defaultConsumptionAnswer();
        await ctx.db.patch('consumptionRequests', request._id, {
          consumptionStatus: patch.consumptionStatus ?? fallback.consumptionStatus,
          deliveryStatus: deliveryStatus,
          refundPreference: patch.refundPreference ?? fallback.refundPreference,
        });
        requestUpdated = true;
      }
    }

    return {
      storeTxnId: storeTxnId,
      fulfillmentState: 'fulfilled',
      changed: !alreadyFulfilled,
      requestUpdated: requestUpdated,
    };
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
  reads: ['consumptionRequests', 'transactions'],
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

    // Nothing on the request — but the developer may have told us at FULFILLMENT
    // time, before Apple asked (slice 13). That answer lives on the transaction,
    // and using it is the difference between reporting what we actually know and
    // abstaining because the developer answered a question we had not yet been
    // asked.
    //
    // Missing fields fall back individually rather than discarding the whole
    // report: "delivered, consumption unknown" is a better answer than "unknown,
    // unknown", and it is the honest one when a developer acknowledged
    // fulfillment without claiming the user spent anything.
    const txns = await ctx.db
      .query('transactions')
      .withIndex('by_storeTxn')
      .eq('storeTxnId', args.storeTxnId)
      .collect();
    const txn = txns.length === 0 ? null : txns[0];
    if (txn !== null && txn.fulfillmentState === 'fulfilled') {
      return {
        respond: true,
        reason: 'fulfillment-data',
        outcome: 'reported',
        consumptionStatus: txn.consumptionStatus ?? fallback.consumptionStatus,
        deliveryStatus: txn.deliveryStatus ?? fallback.deliveryStatus,
        refundPreference: txn.refundPreference ?? fallback.refundPreference,
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


// --- Catalog management (slice 11, reshaped in slice 12) ------------------------

// The write side of the developer's catalog: the mutations behind the
// dashboard's /admin/* routes. Slice 12 split them across the new three-level
// shape — package CRUD, SKU CRUD, entitlement CRUD, and the SKU-level edge.
//
// PROTOTYPE AUTHORITY GAP, WRITE SIDE. The closed auth vocabulary is
// public | optional-user | authenticated (LLP 0058), so a mutation that should
// require a project secret key has no way to say so. These declare
// `auth: 'authenticated'` — the strongest requirement available — and are
// management-only because the devserver exposes them under /admin/*, exactly as
// the catalog READS are. The boundary is a proxy, not the engine. That is the
// same gap already recorded on `reconcileTransaction` for system authority and
// on the catalog reads for secret-tier reads; this is its most consequential
// face, because these mutations can rewrite what every user's purchases mean.
// In production the split is two APIs with two keys (decision 11). Nothing here
// should be read as the engine fencing them.
//
// Uniqueness is STRUCTURAL, not scanned: `packages.by_package`,
// `entitlements.by_entitlement`, the compound `products.by_store_product`, and
// the three-column `productEntitlements.by_product_entitlement` are unique
// indexes, so a duplicate create loses at the write boundary with
// SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION rather than racing a read-then-insert
// check.

// The closed package vocabulary, spelled as a function declaration because
// inline handlers capture same-file declarations but not outer consts.
function isKnownPackageKind(kind) {
  return kind === 'subscription'
    || kind === 'nonconsumable'
    || kind === 'consumable';
}

// The closed store vocabulary. A SKU belongs to exactly one store, and an
// unknown store would produce a row no notification could ever match.
function isKnownStore(store) {
  return store === 'apple' || store === 'google' || store === 'stripe';
}

// Trim to a non-empty string, or refuse. Catalog ids reach us from a dashboard
// form, so " " is a plausible input and an id of one space is not.
function requiredId(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(label + ' is required');
  return text;
}

// An optional structured store fact on the way IN. Absent means "this store
// does not use that concept", which is the ordinary case — only Google has base
// plans and offers.
//
// The empty string normalizes to absent rather than being stored: a dashboard
// form submits '' for a field the developer cleared, and a basePlanId of ''
// would otherwise be a present-but-meaningless value that reads as configured.
function optionalStoreField(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

// --- Packages ------------------------------------------------------------------

export const createPackage = defineJsMutation({
  auth: 'authenticated',
  args: {
    packageId: v.string(),
    kind: v.string(),
    // The schema requires a title; the dashboard does not force one. Defaulting
    // to the id keeps the column honest without inventing prose.
    title: v.optional(v.string()),
  },
  writes: ['packages'],
  result: results.value(v.object({
    id: v.id('packages'),
    packageId: v.string(),
  })),
  handler: async (ctx, args) => {
    const packageId = requiredId(args.packageId, 'packageId');
    if (!isKnownPackageKind(args.kind)) {
      throw new Error('unknown package kind: ' + args.kind);
    }
    const title = String(args.title ?? '').trim() || packageId;
    const id = await ctx.db.insert('packages', {
      packageId: packageId,
      title: title,
      kind: args.kind,
    });
    return { id: id, packageId: packageId };
  },
});

// Editing a package's merchandising facts. Required columns MERGE — omitting
// `kind` leaves it, because a package with no kind is not a legal row.
//
// `packageId` is identity and is deliberately not editable: every SKU names it,
// so renaming would strand them. That is a migration, not an edit.
export const updatePackage = defineJsMutation({
  auth: 'authenticated',
  args: {
    packageId: v.string(),
    title: v.optional(v.string()),
    kind: v.optional(v.string()),
  },
  reads: ['packages'],
  writes: ['packages'],
  result: results.value(v.object({ packageId: v.string(), changed: v.boolean() })),
  handler: async (ctx, args) => {
    const packageId = requiredId(args.packageId, 'packageId');
    const rows = await ctx.db
      .query('packages')
      .withIndex('by_package')
      .eq('packageId', packageId)
      .collect();
    if (rows.length === 0) throw new Error('unknown packageId: ' + packageId);
    const row = rows[0];

    const kind = args.kind === undefined ? row.kind : args.kind;
    if (!isKnownPackageKind(kind)) {
      throw new Error('unknown package kind: ' + kind);
    }
    const title = args.title === undefined
      ? row.title
      : (String(args.title).trim() || packageId);
    if (row.title === title && row.kind === kind) {
      return { packageId: packageId, changed: false };
    }
    await ctx.db.patch('packages', row._id, { title: title, kind: kind });
    return { packageId: packageId, changed: true };
  },
});

// Delete a package, its store SKUs, and those SKUs' entitlement edges — all in
// one commit, so there is no window in which a SKU names a package that does not
// exist or an edge names a SKU that does not.
//
// TRANSACTIONS ARE LEFT ALONE, deliberately. A transaction records the SKU a
// user actually bought, and withdrawing a package from sale does not un-sell it.
// The catalog is what is FOR SALE; transactions are what WAS sold, and the
// second is history we do not get to edit.
//
// POC BOUND: 200 SKUs and 500 edges, because one mutation buffers at most 1,024
// writes. The counts are returned rather than hidden so a caller can see the cap.
export const deletePackage = defineJsMutation({
  auth: 'authenticated',
  args: { packageId: v.string() },
  reads: ['packages', 'products', 'productEntitlements'],
  writes: ['packages', 'products', 'productEntitlements'],
  result: results.value(v.object({
    packageId: v.string(),
    deleted: v.boolean(),
    productsRemoved: v.integer(),
    edgesRemoved: v.integer(),
  })),
  handler: async (ctx, args) => {
    const packageId = requiredId(args.packageId, 'packageId');
    const rows = await ctx.db
      .query('packages')
      .withIndex('by_package')
      .eq('packageId', packageId)
      .collect();
    if (rows.length === 0) throw new Error('unknown packageId: ' + packageId);

    const skus = await ctx.db
      .query('products')
      .withIndex('by_package')
      .eq('packageId', packageId)
      .take(200)
      .collect();
    let edgesRemoved = 0;
    for (const sku of skus) {
      const edges = await ctx.db
        .query('productEntitlements')
        .withIndex('by_product')
        .eq('store', sku.store)
        .eq('productId', sku.productId)
        .take(500)
        .collect();
      for (const edge of edges) {
        await ctx.db.delete('productEntitlements', edge._id);
        edgesRemoved += 1;
      }
      await ctx.db.delete('products', sku._id);
    }
    await ctx.db.delete('packages', rows[0]._id);
    return {
      packageId: packageId,
      deleted: true,
      productsRemoved: skus.length,
      edgesRemoved: edgesRemoved,
    };
  },
});

// --- Products (store SKUs) ------------------------------------------------------

// Create one store SKU under an existing package.
//
// The package must exist. A SKU is defined by what it sells, and one pointing at
// no package would have no `kind` — which the acknowledgement path reads to
// decide consume-vs-acknowledge, and would silently resolve to 'acknowledge'.
export const createProduct = defineJsMutation({
  auth: 'authenticated',
  args: {
    productId: v.string(),
    store: v.string(),
    packageId: v.string(),
    basePlanId: v.optional(v.string()),
    offerId: v.optional(v.string()),
  },
  reads: ['packages'],
  writes: ['products'],
  result: results.value(v.object({
    id: v.id('products'),
    productId: v.string(),
    store: v.string(),
  })),
  handler: async (ctx, args) => {
    const productId = requiredId(args.productId, 'productId');
    const packageId = requiredId(args.packageId, 'packageId');
    if (!isKnownStore(args.store)) {
      throw new Error('unknown store: ' + args.store);
    }
    const packages = await ctx.db
      .query('packages')
      .withIndex('by_package')
      .eq('packageId', packageId)
      .collect();
    if (packages.length === 0) throw new Error('unknown packageId: ' + packageId);

    const id = await ctx.db.insert('products', {
      productId: productId,
      store: args.store,
      packageId: packageId,
      basePlanId: optionalStoreField(args.basePlanId),
      offerId: optionalStoreField(args.offerId),
    });
    return { id: id, productId: productId, store: args.store };
  },
});

// Edit a SKU: which package it belongs to, and its structured store fields.
//
// The merge rule follows the SCHEMA's own optionality, so there is one rule
// rather than a per-field convention:
//
//   required columns (packageId)          omitted -> unchanged
//   optional columns (basePlanId, offerId) omitted -> CLEARED
//
// Optional fields replace rather than merge because "this base plan no longer
// exists" has to be expressible, and a merge-only update cannot say it.
//
// (store, productId) is identity and is not editable: every transaction that
// named this SKU would be stranded. Delete and re-create instead.
export const updateProduct = defineJsMutation({
  auth: 'authenticated',
  args: {
    productId: v.string(),
    store: v.string(),
    packageId: v.optional(v.string()),
    basePlanId: v.optional(v.string()),
    offerId: v.optional(v.string()),
  },
  reads: ['products', 'packages'],
  writes: ['products'],
  result: results.value(v.object({
    productId: v.string(),
    store: v.string(),
    changed: v.boolean(),
  })),
  handler: async (ctx, args) => {
    const productId = requiredId(args.productId, 'productId');
    if (!isKnownStore(args.store)) {
      throw new Error('unknown store: ' + args.store);
    }
    const rows = await ctx.db
      .query('products')
      .withIndex('by_store_product')
      .eq('store', args.store)
      .eq('productId', productId)
      .collect();
    if (rows.length === 0) {
      throw new Error('unknown SKU: ' + args.store + ' ' + productId);
    }
    const row = rows[0];

    const packageId = args.packageId === undefined
      ? row.packageId
      : requiredId(args.packageId, 'packageId');
    if (packageId !== row.packageId) {
      const packages = await ctx.db
        .query('packages')
        .withIndex('by_package')
        .eq('packageId', packageId)
        .collect();
      if (packages.length === 0) throw new Error('unknown packageId: ' + packageId);
    }
    const next = {
      packageId: packageId,
      basePlanId: optionalStoreField(args.basePlanId),
      offerId: optionalStoreField(args.offerId),
    };

    // Absent and present-null are the same fact here, so compare them as one.
    // Without this a re-submitted unchanged form would report `changed: true`
    // forever, and a dashboard would poll on a lie.
    const same = row.packageId === next.packageId
      && (row.basePlanId ?? null) === next.basePlanId
      && (row.offerId ?? null) === next.offerId;
    if (same) return { productId: productId, store: args.store, changed: false };

    await ctx.db.patch('products', row._id, next);
    return { productId: productId, store: args.store, changed: true };
  },
});

// Delete one SKU and the entitlement edges that named it, in the same commit.
// Transactions that bought it are untouched history, as with a package.
export const deleteProduct = defineJsMutation({
  auth: 'authenticated',
  args: { productId: v.string(), store: v.string() },
  reads: ['products', 'productEntitlements'],
  writes: ['products', 'productEntitlements'],
  result: results.value(v.object({
    productId: v.string(),
    store: v.string(),
    deleted: v.boolean(),
    edgesRemoved: v.integer(),
  })),
  handler: async (ctx, args) => {
    const productId = requiredId(args.productId, 'productId');
    if (!isKnownStore(args.store)) {
      throw new Error('unknown store: ' + args.store);
    }
    const rows = await ctx.db
      .query('products')
      .withIndex('by_store_product')
      .eq('store', args.store)
      .eq('productId', productId)
      .collect();
    if (rows.length === 0) {
      throw new Error('unknown SKU: ' + args.store + ' ' + productId);
    }

    const edges = await ctx.db
      .query('productEntitlements')
      .withIndex('by_product')
      .eq('store', args.store)
      .eq('productId', productId)
      .take(500)
      .collect();
    for (const edge of edges) {
      await ctx.db.delete('productEntitlements', edge._id);
    }
    await ctx.db.delete('products', rows[0]._id);
    return {
      productId: productId,
      store: args.store,
      deleted: true,
      edgesRemoved: edges.length,
    };
  },
});

// --- Entitlements ---------------------------------------------------------------

export const createEntitlement = defineJsMutation({
  auth: 'authenticated',
  args: { entitlementId: v.string(), title: v.optional(v.string()) },
  writes: ['entitlements'],
  result: results.value(v.object({
    id: v.id('entitlements'),
    entitlementId: v.string(),
  })),
  handler: async (ctx, args) => {
    const entitlementId = requiredId(args.entitlementId, 'entitlementId');
    const title = String(args.title ?? '').trim() || entitlementId;
    const id = await ctx.db.insert('entitlements', {
      entitlementId: entitlementId,
      title: title,
    });
    return { id: id, entitlementId: entitlementId };
  },
});

// Rename an entitlement's human title. The id is identity — apps gate on that
// string, so changing it is a migration, not an edit.
export const updateEntitlement = defineJsMutation({
  auth: 'authenticated',
  args: { entitlementId: v.string(), title: v.string() },
  reads: ['entitlements'],
  writes: ['entitlements'],
  result: results.value(v.object({ entitlementId: v.string(), changed: v.boolean() })),
  handler: async (ctx, args) => {
    const entitlementId = requiredId(args.entitlementId, 'entitlementId');
    const title = requiredId(args.title, 'title');
    const rows = await ctx.db
      .query('entitlements')
      .withIndex('by_entitlement')
      .eq('entitlementId', entitlementId)
      .collect();
    if (rows.length === 0) throw new Error('unknown entitlementId: ' + entitlementId);
    if (rows[0].title === title) return { entitlementId: entitlementId, changed: false };
    await ctx.db.patch('entitlements', rows[0]._id, { title: title });
    return { entitlementId: entitlementId, changed: true };
  },
});

// Delete an entitlement, its mapping edges, AND the derived grants that named
// it — all in one commit.
//
// The grants are the part worth arguing about. `entitlementGrants` is derived
// state, and the honest instinct is to leave derived state to its derivation.
// That instinct fails here: `applyProductEntitlements` walks mappings BY SKU, so
// once an entitlement's edges are gone nothing will ever revisit its grants. A
// perpetual grant would then stay active forever, and the app would keep
// unlocking a feature whose entitlement the developer deleted. The cron sweep
// cannot save it either — it only expires grants that carry a horizon.
//
// So the choice is between deleting the grants and leaving an unreachable ghost
// that grants real access. The grant rows go.
//
// POC BOUND: 500 grants and 500 edges per delete, because one mutation buffers
// at most 1,024 writes. A deployment with more holders of one entitlement needs
// the paged-with-checkpoint shape from guide/backend/mutations.md; the count is
// returned rather than hidden so a caller can see it hit the cap.
export const deleteEntitlement = defineJsMutation({
  auth: 'authenticated',
  args: { entitlementId: v.string() },
  reads: ['entitlements', 'productEntitlements', 'entitlementGrants'],
  writes: ['entitlements', 'productEntitlements', 'entitlementGrants'],
  result: results.value(v.object({
    entitlementId: v.string(),
    deleted: v.boolean(),
    edgesRemoved: v.integer(),
    grantsRemoved: v.integer(),
  })),
  handler: async (ctx, args) => {
    const entitlementId = requiredId(args.entitlementId, 'entitlementId');
    const rows = await ctx.db
      .query('entitlements')
      .withIndex('by_entitlement')
      .eq('entitlementId', entitlementId)
      .collect();
    if (rows.length === 0) throw new Error('unknown entitlementId: ' + entitlementId);

    const edges = await ctx.db
      .query('productEntitlements')
      .withIndex('by_entitlement')
      .eq('entitlementId', entitlementId)
      .take(500)
      .collect();
    for (const edge of edges) {
      await ctx.db.delete('productEntitlements', edge._id);
    }

    // No by_entitlement index on the derived read model — it is partitioned by
    // user for the client's live query and by active for the sweep, and neither
    // answers "who holds this entitlement". Scanning the active partition is
    // what is available; an inactive grant for a deleted entitlement is inert,
    // so leaving those is not the ghost this guards against.
    const live = await ctx.db
      .query('entitlementGrants')
      .withIndex('by_active')
      .eq('active', true)
      .take(500)
      .collect();
    let grantsRemoved = 0;
    for (const grant of live) {
      if (grant.entitlementId !== entitlementId) continue;
      await ctx.db.delete('entitlementGrants', grant._id);
      grantsRemoved += 1;
    }

    await ctx.db.delete('entitlements', rows[0]._id);
    return {
      entitlementId: entitlementId,
      deleted: true,
      edgesRemoved: edges.length,
      grantsRemoved: grantsRemoved,
    };
  },
});

// --- The SKU -> entitlement edge -------------------------------------------------

// Record that one store SKU grants an entitlement.
//
// Both endpoints must exist. An edge naming a missing SKU is exactly the
// corruption the dashboard renders in red, and while the graph should keep
// showing one if it ever appears, this surface should not be the thing that
// mints it.
//
// SKU-LEVEL, not package-level (slice 12). Wiring a package would be less
// clicking and is the wrong primitive: a package's Apple SKU can be live while
// its Google SKU is still in review, and a package-level edge cannot express
// that one of them grants and the other does not yet.
//
// DOES NOT RECOMPUTE EXISTING GRANTS, and cannot cheaply. A user who already
// owns this SKU gains the newly mapped entitlement on their next reconcile — a
// store notification, a fresh purchase, or an applyStoreState re-fetch — not at
// the moment the edge is written. Recomputing would mean finding every user
// holding a transaction for this SKU, and `transactions` is indexed by user and
// by store id, not by (store, productId). The same limitation applies to
// removal, where it matters more: unmapping does not revoke the access it
// already justified. Naming it is better than a surface that silently
// half-applies.
export const addProductEntitlement = defineJsMutation({
  auth: 'authenticated',
  args: { productId: v.string(), store: v.string(), entitlementId: v.string() },
  reads: ['products', 'entitlements'],
  writes: ['productEntitlements'],
  result: results.value(v.object({
    id: v.id('productEntitlements'),
    productId: v.string(),
    store: v.string(),
    entitlementId: v.string(),
  })),
  handler: async (ctx, args) => {
    const productId = requiredId(args.productId, 'productId');
    const entitlementId = requiredId(args.entitlementId, 'entitlementId');
    if (!isKnownStore(args.store)) {
      throw new Error('unknown store: ' + args.store);
    }
    const products = await ctx.db
      .query('products')
      .withIndex('by_store_product')
      .eq('store', args.store)
      .eq('productId', productId)
      .collect();
    if (products.length === 0) {
      throw new Error('unknown SKU: ' + args.store + ' ' + productId);
    }
    const entitlements = await ctx.db
      .query('entitlements')
      .withIndex('by_entitlement')
      .eq('entitlementId', entitlementId)
      .collect();
    if (entitlements.length === 0) {
      throw new Error('unknown entitlementId: ' + entitlementId);
    }
    // A duplicate edge loses at the unique three-column index, not here.
    const id = await ctx.db.insert('productEntitlements', {
      productId: productId,
      store: args.store,
      entitlementId: entitlementId,
    });
    return {
      id: id,
      productId: productId,
      store: args.store,
      entitlementId: entitlementId,
    };
  },
});

// Remove one edge. See the note on addProductEntitlement: this does not revoke
// access already derived from the mapping.
export const removeProductEntitlement = defineJsMutation({
  auth: 'authenticated',
  args: { productId: v.string(), store: v.string(), entitlementId: v.string() },
  reads: ['productEntitlements'],
  writes: ['productEntitlements'],
  result: results.value(v.object({ removed: v.boolean() })),
  handler: async (ctx, args) => {
    const productId = requiredId(args.productId, 'productId');
    const entitlementId = requiredId(args.entitlementId, 'entitlementId');
    if (!isKnownStore(args.store)) {
      throw new Error('unknown store: ' + args.store);
    }
    const edges = await ctx.db
      .query('productEntitlements')
      .withIndex('by_product_entitlement')
      .eq('store', args.store)
      .eq('productId', productId)
      .eq('entitlementId', entitlementId)
      .collect();
    if (edges.length === 0) return { removed: false };
    await ctx.db.delete('productEntitlements', edges[0]._id);
    return { removed: true };
  },
});
