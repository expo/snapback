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
//   refunded, disputed, ambiguous, manualReview); this models a SUBSCRIPTION's
//   entitlement over time (grace, retry_hold, paused). The two are disjoint on
//   purpose — a reader coming from 0069 should not expect them to line up, and
//   an adapter will eventually have to translate between them.

import { defineSchema, defineTable, v } from '../../_kit/define.mjs';

export default defineSchema({
  // Catalog. One row per sellable product, carrying the per-platform ids the
  // store adapters will need. `kind` is a closed vocabulary the handlers
  // validate: 'subscription' | 'nonconsumable' | 'consumable'.
  products: defineTable({
    productId: v.string(),
    title: v.string(),
    kind: v.string(),
    appleId: v.optional(v.string()),
    googleId: v.optional(v.string()),
    stripePriceId: v.optional(v.string()),
  }).index('by_product', ['productId']),

  // What a purchase actually buys. Apps gate on these, never on products.
  entitlements: defineTable({
    entitlementId: v.string(),
    title: v.string(),
  }).index('by_entitlement', ['entitlementId']),

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
    .index('by_entitlement', ['entitlementId']),

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
