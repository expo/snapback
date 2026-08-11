// EAS Payments — engine-first slice schema.
//
// The shape follows the Payments Engine architecture, not a receipt store:
// packages group the store SKUs that are actually purchasable, transactions are
// the raw store facts naming one SKU, and `entitlementGrants` is the DERIVED
// read model the app actually gates on.
//
// Slice 12 adopted RevenueCat's vocabulary (package / product / entitlement) and
// made the store SKU the atomic unit. The derive path is
// transaction -> product (SKU) -> entitlement; the package is grouping and the
// source of `kind`, and is deliberately NOT on that path.
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
  // --- Catalog (slice 12: the store SKU is the atom) --------------------------
  //
  // Three levels, RevenueCat's vocabulary:
  //
  //   package  the cross-platform thing a developer SELLS ("Pro, monthly")
  //   product  the STORE SKU that is actually purchasable on one store
  //   entitlement  what a purchase BUYS, and the only thing an app gates on
  //
  // The previous shape collapsed the first two: one `products` row carried
  // `appleId`/`googleId`/`stripePriceId` columns. That reads fine until a store
  // fact has to attach to one platform's SKU — a Google base plan, an Apple
  // promotional offer, a price, a store-specific status — and there is no row to
  // attach it to. Columns cannot carry per-SKU structure, so the SKU has to be a
  // row. That is the whole change.

  // The cross-platform purchasable. Carries NO store identity at all: it is the
  // grouping a developer thinks in and the source of `kind`, and it is
  // deliberately absent from the derive path (see deriveGrant).
  //
  // `kind` is a closed vocabulary the handlers validate:
  // 'subscription' | 'nonconsumable' | 'consumable'. It lives here rather than on
  // the SKU because it is a property of what is being sold, not of where — the
  // same package is a consumable on all three stores or on none.
  packages: defineTable({
    packageId: v.string(),
    title: v.string(),
    kind: v.string(),
  }).index('by_package', ['packageId'], { unique: true }),

  // The store SKU: the atom. One row per (store, productId), which is the exact
  // identity a store notification arrives carrying and the exact pair
  // `transactions` records.
  //
  // KEYED COMPOUND on (store, productId) rather than by a surrogate, because a
  // store SKU string is only unique WITHIN its store. `pro_monthly` is a
  // perfectly legal Google product id and a perfectly legal Stripe price lookup
  // key at the same time, so a global unique on productId alone would refuse a
  // real catalog. The acceptance proves that directly by creating one SKU string
  // under two stores and asserting both land.
  //
  // The seed makes the adjacent point: the Google SKU for the `pro_monthly`
  // package is itself the string `pro_monthly`, which is realistic and is
  // exactly why package ids and SKU strings must be separate namespaces rather
  // than one id space with a convention.
  //
  // A surrogate key was the alternative. It loses because it would be a second
  // spelling of an identity `transactions` already carries as two columns, and
  // slice 11's lesson was that a duplicated key is somewhere for two spellings
  // to drift.
  //
  // basePlanId and offerId are the structured store facts the old column shape
  // had nowhere to put. Nullable for now — nothing reads them yet, and they are
  // here to show the SKU row is where such facts LAND rather than to pretend
  // this demo models Google's base-plan/offer hierarchy.
  products: defineTable({
    productId: v.string(),
    store: v.string(),
    packageId: v.string(),
    basePlanId: v.optional(v.string()),
    offerId: v.optional(v.string()),
  })
    // The identity, and the lookup every purchase performs: given the (store,
    // productId) a transaction names, which SKU row is this.
    .index('by_store_product', ['store', 'productId'], { unique: true })
    // by_package is the grouping direction: the dashboard's "which stores sell
    // this package", and the cascade when a package is deleted.
    .index('by_package', ['packageId']),

  // What a purchase actually buys. Apps gate on these, never on packages and
  // never on SKUs.
  entitlements: defineTable({
    entitlementId: v.string(),
    title: v.string(),
  }).index('by_entitlement', ['entitlementId'], { unique: true }),

  // The SKU -> entitlement mapping. Moved down a level from the package: the
  // edge now names (store, productId), which is what makes decision 23's
  // cross-platform union fall out rather than being special-cased. The Apple SKU
  // and the Google SKU under one package both map to `pro`, so a user who
  // somehow holds both derives ONE grant — the union is just what a set union
  // does, with no "same package" rule anywhere in the code.
  //
  // Many-to-many in both directions, as before: a bundle SKU can grant several
  // entitlements, and many SKUs across many packages can grant the same one.
  //
  // A consumable's SKUs simply have no edge here. That is unchanged from the
  // package-level shape and is still how "records a purchase, grants nothing"
  // is expressed — it just happens one level down.
  productEntitlements: defineTable({
    productId: v.string(),
    store: v.string(),
    entitlementId: v.string(),
  })
    // The edges of one SKU. Compound, because the SKU's identity is compound.
    .index('by_product', ['store', 'productId'])
    // by_entitlement is the reverse direction: given an entitlement, which SKUs
    // can currently justify it.
    .index('by_entitlement', ['entitlementId'])
    // The edge itself is the unique thing, and it is now a THREE-column key.
    // Neither narrower index can state it: both directions are legitimately
    // many, and the SKU half is itself compound.
    .index('by_product_entitlement', ['store', 'productId', 'entitlementId'], { unique: true }),

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
  //
  // `productId` names the STORE SKU, not the package (slice 12), and with
  // `store` it is the compound identity of a `products` row. This is the
  // immutable store fact: the store told us which SKU was bought, and no later
  // catalog edit may rewrite it. Deleting the SKU from the catalog does not
  // un-sell it — the transaction keeps naming the string the store used.
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

    // DEVELOPER fulfillment (slice 13). Deliberately a separate axis from
    // `ackState`, and the distinction is the entire point:
    //
    //   ackState          did WE tell the STORE we accepted the purchase
    //                     (Google's server-side consume/acknowledge)
    //   fulfillmentState  did the DEVELOPER give the user what they bought
    //
    // Those are different parties answering different questions, and they fail
    // independently: a purchase can be consumed at Google while the developer's
    // coin grant crashed, or fulfilled in-app while our ack job is still
    // retrying. Overloading `ackState` with a 'fulfilled' value would make each
    // of those states unrepresentable and would let one party's success mask
    // the other's failure.
    //
    // 'unfulfilled' -> 'fulfilled'. One-way and idempotent, like ackState: a
    // developer re-reporting a delivery they already reported changes nothing.
    fulfillmentState: v.string(),
    fulfilledAt: v.optional(v.integer()),

    // The consumption facts the developer supplied WITH the fulfillment, held
    // here rather than only on a consumptionRequests row.
    //
    // Slice 9's setConsumptionData deliberately requires an open request — you
    // answer a question that was asked. But a developer fulfils a consumable at
    // purchase time, which is typically long BEFORE Apple asks anything. With
    // nowhere to put that answer early, every CONSUMPTION_REQUEST would resolve
    // to the deadline default even though the developer knew the answer all
    // along. These columns are that missing memory; settleConsumptionRequest
    // reads them before falling back.
    consumptionStatus: v.optional(v.string()),
    deliveryStatus: v.optional(v.string()),
    refundPreference: v.optional(v.string()),
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

  // The outbound event feed (decision 20, typed in slice 13). One row per thing
  // a developer needs to hear about, and nothing else. Deliberately carries NO
  // entitlement state: a developer polling this learns only that something
  // happened for a user, then re-reads our authoritative answer. That keeps the
  // feed useless to an eavesdropper and impossible to act on stale.
  //
  // Renamed from `entitlementChanges` in slice 13, because it stopped being
  // only about entitlements. Two types share one sequence:
  //
  //   'entitlement'  a reconcile moved this user's active set
  //   'purchase'     a purchase was recorded for this user
  //
  // ONE shared seq rather than a sequence per type, so a single cursor still
  // totally orders everything a developer must react to. Two sequences would
  // mean two cursors and no defined order between them — and "the purchase
  // event that granted this entitlement" would become unorderable against the
  // entitlement event it caused.
  //
  // `type` is the one piece of classification the feed carries, and it is not
  // state: it says WHICH authoritative read to go and perform, not what that
  // read will say. A consumable emits only a 'purchase' event, which is the
  // whole reason the type exists — without it a consumable purchase would be
  // indistinguishable from silence.
  changeEvents: defineTable({
    userId: v.string(),
    seq: v.integer(),
    // 'entitlement' | 'purchase'. Validated by isKnownEventType in the handlers.
    type: v.string(),
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
