// Commerce is an exploratory, local-only pressure kernel while LLP 0069 is
// Draft. The application tables deliberately stop before provider authority:
// no provider response, webhook, paid state, or fulfillment row exists.
//
// @ref LLP 0069#boundaries-and-invariants — Snapback transaction authority
// owns immutable order money, inventory reservation, and payment intent.

import { defineSchema, defineTable, v } from '../../_kit/define.mjs';

export default defineSchema({
  products: defineTable({
    slug: v.string(),
    name: v.string(),
    currency: v.string(),
    exponent: v.integer(),
    unitMinorUnits: v.integer(),
    priceVersion: v.integer(),
    availableUnits: v.integer(),
    listed: v.boolean(),
  })
    .index('by_slug', ['slug'], { unique: true })
    .sync(),
  orders: defineTable({
    ownerId: v.principal(),
    clientOrderKey: v.string(),
    state: v.string(),
    currency: v.string(),
    exponent: v.integer(),
    totalMinorUnits: v.integer(),
    createdAt: v.integer(),
    attemptId: v.optional(v.id('paymentAttempts')),
  })
    .index('by_owner_client_key', ['ownerId', 'clientOrderKey'], { unique: true })
    .index('by_owner_created', ['ownerId', 'createdAt'])
    .sync(),
  orderLines: defineTable({
    ownerId: v.principal(),
    orderId: v.id('orders'),
    productId: v.id('products'),
    productSlug: v.string(),
    productName: v.string(),
    priceVersion: v.integer(),
    currency: v.string(),
    exponent: v.integer(),
    unitMinorUnits: v.integer(),
    quantity: v.integer(),
    lineMinorUnits: v.integer(),
  })
    .index('by_owner_order', ['ownerId', 'orderId'])
    .index('by_order_product', ['orderId', 'productId'], { unique: true })
    .sync(),
  paymentAttempts: defineTable({
    attemptKey: v.string(),
    ownerId: v.principal(),
    orderId: v.id('orders'),
    state: v.string(),
    currency: v.string(),
    exponent: v.integer(),
    minorUnits: v.integer(),
    providerProfile: v.string(),
    providerCommandKey: v.string(),
    providerCallAdmitted: v.boolean(),
    createdAt: v.integer(),
  })
    .index('by_attempt_key', ['attemptKey'], { unique: true })
    .index('by_order', ['orderId'], { unique: true })
    .index('by_owner', ['ownerId'])
    .sync(),
  reservations: defineTable({
    ownerId: v.principal(),
    orderId: v.id('orders'),
    attemptId: v.id('paymentAttempts'),
    productId: v.id('products'),
    quantity: v.integer(),
    state: v.string(),
    providerRequestMayHaveArrived: v.boolean(),
    expiresAt: v.integer(),
  })
    .index('by_order', ['orderId'], { unique: true })
    .index('by_owner_order', ['ownerId', 'orderId'], { unique: true })
    .index('by_product', ['productId'])
    .sync(),
}, { auth: { mode: 'dev' } });
