// EAS Payments — engine-first slice schema.
//
// The shape follows the Payments Engine architecture, not a receipt store:
// products carry per-platform ids, transactions are the raw store facts, and
// `entitlementGrants` is the DERIVED read model the app actually gates on.
//
// @ref LLP 0004#handler-api — server-owned _id/_version/_createdAt/_updatedAt,
//   so nothing here declares a timestamp field the runtime already owns.
// @ref LLP 0069#generated-application-surface — `transactions.status` is
//   deliberately NOT that RFC's payment vocabulary. 0069 models one payment
//   ATTEMPT (notStarted, providerPending, authorized, capturePending, paid,
//   refunded, disputed, ambiguous, manualReview); `status` here models a
//   SUBSCRIPTION's entitlement over time (grace, retry_hold, paused). Those two
//   are disjoint on purpose, and a reader coming from 0069 should not expect
//   them to line up.
//
//   `refundState` (slice 9) is where the two vocabularies genuinely converge:
//   0069's `refunded`, `partiallyRefunded`, and `disputed` are the same events
//   this axis tracks. It is still a separate spelling because 0069 keeps them on
//   ONE state machine with the payment attempt, while the whole point of the
//   split here is that access and money move independently. An adapter will have
//   to translate, and this axis — not `status` — is the side it maps onto.

import { defineSchema, defineTable, v } from '../../_kit/define.mjs';

export default defineSchema({
  // Catalog. One row per sellable product, carrying the per-platform ids the
  // store adapters will need. `kind` is a closed vocabulary the handlers
  // validate: 'subscription' | 'nonconsumable' | 'consumable'.
  //
  // by_product is UNIQUE (catalog CRUD). Two products sharing a productId would
  // make `enqueueAcknowledgement`'s `kind` lookup and every mapping edge
  // ambiguous, and the catalog is now writable at runtime rather than only
  // seeded — so the invariant is declared structurally instead of scanned for in
  // a handler, which is a race between the scan and the insert.
  products: defineTable({
    productId: v.string(),
    title: v.string(),
    kind: v.string(),
    appleId: v.optional(v.string()),
    googleId: v.optional(v.string()),
    stripePriceId: v.optional(v.string()),
  }).index('by_product', ['productId'], { unique: true }),

  // What a purchase actually buys. Apps gate on these, never on products.
  entitlements: defineTable({
    entitlementId: v.string(),
    title: v.string(),
  }).index('by_entitlement', ['entitlementId'], { unique: true }),

  // The product -> entitlement mapping. Many-to-many by construction: a bundle
  // product can grant several entitlements, and several products can grant the
  // same one (pro_monthly and pro_annual both grant `pro`).
  productEntitlements: defineTable({
    productId: v.string(),
    entitlementId: v.string(),
  })
    .index('by_product', ['productId'])
    // by_entitlement is the reverse direction the reconcile needs: given an
    // entitlement, which products can currently justify it.
    .index('by_entitlement', ['entitlementId'])
    // The edge itself is the unique thing, and it is compound: `pro_monthly
    // grants pro` may be recorded once. Neither single-column index can say
    // that, since both directions are legitimately many.
    .index('by_product_entitlement', ['productId', 'entitlementId'], { unique: true }),

  // Raw store facts. `environment` ('sandbox' | 'production') rides every row
  // so metering can exclude test transactions later without a backfill.
  //
  // `status` is the normalized lifecycle vocabulary, not a boolean in disguise:
  // 'active' | 'grace' | 'retry_hold' | 'paused' | 'pending' | 'expired' |
  // 'revoked'. The handlers validate it (see `isKnownTxnState`); exactly two of
  // the seven grant access (see `grantsAccess`). The old 'refunded' spelling
  // migrated to 'revoked' so a store-initiated revoke and a refund are one
  // state — nothing downstream distinguished them.
  //
  // Each access-granting state reads its horizon from a DIFFERENT column, which
  // is why there are three and not one: `expiresAt` bounds 'active',
  // `graceUntil` bounds 'grace', and `resumesAt` is when a 'paused' subscription
  // is expected back. Collapsing them into one "endsAt" would lose which clock
  // is running, and the sweep needs exactly that to know what it may expire.
  transactions: defineTable({
    userId: v.string(),
    productId: v.string(),
    store: v.string(),
    storeTxnId: v.string(),
    status: v.string(),
    environment: v.string(),
    expiresAt: v.optional(v.integer()),
    graceUntil: v.optional(v.integer()),
    resumesAt: v.optional(v.integer()),

    // Acknowledgement (slice 8). This is not bookkeeping — it is a STORE
    // OBLIGATION with a deadline. Google auto-refunds the user and revokes the
    // purchase if it is not acknowledged within 3 days, and a consumable must be
    // CONSUMED (which also acknowledges) before it can be bought again.
    //
    // 'pending' -> 'acknowledged' (durables) or 'consumed' (consumables). The
    // transition is one-way: nothing un-acknowledges a purchase.
    ackState: v.string(),

    // Whether the obligation is OURS. Apple's acknowledgement is client-side
    // (StoreKit `finish`), and Stripe has no acknowledgement concept at all, so
    // for both of those a server-side ack is not merely unnecessary — there is
    // no endpoint to call. Only Google carries a server obligation, so this is
    // false for every other adapter and the ack job is never enqueued.
    //
    // Kept as its own boolean rather than a fourth ackState value: "nobody owes
    // an acknowledgement" and "we owe one and have not sent it" are different
    // facts, and collapsing them would make a pending Apple row look overdue.
    serverAckRequired: v.boolean(),

    // The after-sale money lifecycle (slice 9). A sale is not final.
    //
    // 'none' -> 'requested' -> 'granted' -> 'reversed', and the involuntary
    // branch 'disputed' -> 'dispute_won' | 'dispute_lost'.
    //
    // Deliberately a SECOND axis rather than more `status` values. `status`
    // answers "does this transaction currently grant access"; refundState
    // answers "what is happening to the money". They move independently: a
    // dispute and a granted refund both land on status 'revoked', and only
    // refundState distinguishes "the user asked and Apple agreed" from "a bank
    // reversed the charge over our heads". Access is derived from status alone,
    // so nothing here can accidentally change what a user may do.
    //
    // We MIRROR this from the store and never compute it. Adjudicating refunds
    // is the store's job; ours is to react to their verdict.
    refundState: v.string(),
  })
    .index('by_user', ['userId'])
    // by_storeTxn is what makes recordPurchase idempotent: a re-delivered
    // notification finds the existing row instead of double-granting.
    .index('by_storeTxn', ['storeTxnId']),

  // The derived read model. Everything above is input; this is the answer.
  //
  // `state` is 'active' | 'grace' | null and narrates WHY access is on: a user
  // in grace has access on borrowed time and is the one a developer may want to
  // nudge about billing, which `active` alone cannot express. The invariant is
  // that it is non-null exactly when `active` is true — going inactive clears
  // it, so the row can never claim a lifecycle state it is not granting.
  //
  // `activeUntil` stays a single column on purpose: it is the *access horizon*,
  // whichever clock produced it (expiresAt while active, graceUntil while in
  // grace). The read model answers "until when", and the app gating on it should
  // not have to know which store column that came from.
  entitlementGrants: defineTable({
    userId: v.string(),
    entitlementId: v.string(),
    active: v.boolean(),
    activeUntil: v.optional(v.integer()),
    state: v.optional(v.string()),
    source: v.string(),
  })
    // by_user backs the client's live query, index-first and auth-scoped.
    .index('by_user', ['userId'])
    // by_active backs the cron sweep, which is not user-scoped: without it the
    // expiry job would scan every grant in the table on every tick.
    .index('by_active', ['active'])
    // Declared syncable so getEntitlements can be a real live query.
    .sync(),

  // The outbound change feed (decision 20). One row per reconcile that moved a
  // user's active set — and nothing else. Deliberately carries NO entitlement
  // state: a developer polling this learns only that something changed for a
  // user, then re-reads our authoritative answer. That keeps the feed useless
  // to an eavesdropper and impossible to act on stale.
  entitlementChanges: defineTable({
    userId: v.string(),
    seq: v.integer(),
    changedAt: v.integer(),
  })
    // by_seq is the keyset cursor a poller walks.
    .index('by_seq', ['seq']),

  // Where a developer wants their pings delivered. Registered at runtime
  // rather than seeded, because a real one is configured per deployment.
  webhookEndpoints: defineTable({
    url: v.string(),
    active: v.boolean(),
  }).index('by_active', ['active']),

  // Apple's CONSUMPTION_REQUEST (slice 9). The store asks US for consumption
  // data before it decides a refund, and gives us a window (12 hours in
  // production) to answer. This is an OUTBOUND OBLIGATION, not a state change —
  // nothing about the transaction moves because we were asked.
  //
  // One row per request, so the deadline is durable state rather than a timer
  // living in a job's arguments. `respondedAt` before `deadlineAt` is the whole
  // claim this table exists to make checkable after the fact.
  //
  // We hold no wallet, so the consumption facts are DEVELOPER-supplied
  // (setConsumptionData) and optional here: the row exists from the moment we
  // are asked, and may still be waiting for an answer when the deadline nears.
  // That gap is exactly what the deadline default covers.
  consumptionRequests: defineTable({
    storeTxnId: v.string(),
    requestedAt: v.integer(),
    deadlineAt: v.integer(),
    respondedAt: v.optional(v.integer()),
    // 'reported' (developer data) | 'default' (deadline default).
    outcome: v.optional(v.string()),
    // Developer-supplied facts, absent until they answer.
    consumptionStatus: v.optional(v.string()),
    deliveryStatus: v.optional(v.string()),
    refundPreference: v.optional(v.string()),
  }).index('by_txn', ['storeTxnId']),

  // The delivery ledger. One row per *attempt*, not per change, so the retry
  // ladder is visible after the fact instead of only in the job's own state.
  deliveries: defineTable({
    userId: v.string(),
    seq: v.integer(),
    endpoint: v.string(),
    attempt: v.integer(),
    outcome: v.string(),
    status: v.integer(),
    attemptedAt: v.integer(),
  })
    .index('by_seq', ['seq'])
    .index('by_outcome', ['outcome']),
});
