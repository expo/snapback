// EAS Payments — engine-first slice schema.
//
// The shape follows the Payments Engine architecture, not a receipt store:
// products carry per-platform ids, transactions are the raw store facts, and
// `entitlementGrants` is the DERIVED read model the app actually gates on.
//
// @ref LLP 0004#handler-api — server-owned _id/_version/_createdAt/_updatedAt,
//   so nothing here declares a timestamp field the runtime already owns.

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
  transactions: defineTable({
    userId: v.string(),
    productId: v.string(),
    store: v.string(),
    storeTxnId: v.string(),
    status: v.string(),
    environment: v.string(),
    expiresAt: v.optional(v.integer()),
  })
    .index('by_user', ['userId'])
    // by_storeTxn is what makes recordPurchase idempotent: a re-delivered
    // notification finds the existing row instead of double-granting.
    .index('by_storeTxn', ['storeTxnId']),

  // The derived read model. Everything above is input; this is the answer.
  entitlementGrants: defineTable({
    userId: v.string(),
    entitlementId: v.string(),
    active: v.boolean(),
    activeUntil: v.optional(v.integer()),
    source: v.string(),
  })
    // by_user backs the client's live query, index-first and auth-scoped.
    .index('by_user', ['userId'])
    // by_active backs the cron sweep, which is not user-scoped: without it the
    // expiry job would scan every grant in the table on every tick.
    .index('by_active', ['active'])
    // Declared syncable so getEntitlements can be a real live query.
    .sync(),
});
