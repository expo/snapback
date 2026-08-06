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
// of truth. For this slice the "store" is stubbed, so the re-fetch is a local
// derivation; the ctx.fetch seam is marked where the real call lands.
//
// @ref LLP 0027#external-data-and-action-egress — egress stays out of the
//   transactional path: the action resolves state, then a mutation commits it.
// @ref LLP 0108#inline-handlers — every JS handler here is the paved inline
//   `handler:` form, self-contained with its args, result contract, and
//   declared reads/writes.

import {
  asc,
  defineAction,
  defineConfig,
  defineCron,
  defineJsLiveQuery,
  defineJsMutation,
  defineQuery,
  results,
  v,
} from '../../_kit/define.mjs';

// --- Config -------------------------------------------------------------------

// @ref LLP 0036#declared-configuration-in-the-manifest — the grant slot the
// real store call will read through ctx.secrets. Declared now, unread by the
// stub, so wiring the live fetch is a handler change and not a schema change.
export const appConfig = defineConfig({
  storeValidation: {
    description: 'Store receipt-validation credential (Apple/Google/Stripe)',
    purpose: 'Re-fetches the authoritative transaction state after a notification',
    required: false,
    pool: false,
    howToGet:
      'Slice stub: no credential is read yet. The real adapters take an Apple '
      + 'App Store Server API key, a Google service account, or a Stripe secret key.',
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

// --- Write path ---------------------------------------------------------------

// The one place durable payment state is written. Idempotent on the store's
// own transaction id, so a re-delivered notification is a no-op rather than a
// second grant.
export const recordPurchase = defineJsMutation({
  args: {
    productId: v.string(),
    store: v.string(),
    storeTxnId: v.string(),
    status: v.string(),
    environment: v.string(),
    expiresAt: v.optional(v.integer()),
  },
  reads: ['transactions', 'productEntitlements', 'entitlementGrants'],
  writes: ['transactions', 'entitlementGrants'],
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

    const expiresAt = args.expiresAt === undefined ? null : args.expiresAt;
    const transactionId = await ctx.db.insert('transactions', {
      userId: userId,
      productId: args.productId,
      store: args.store,
      storeTxnId: storeTxnId,
      status: args.status,
      environment: args.environment,
      expiresAt: expiresAt,
    });

    // Derive entitlements from the product. A bundle product maps to several
    // rows here and every one of them upserts.
    const mappings = await ctx.db
      .query('productEntitlements')
      .withIndex('by_product')
      .eq('productId', args.productId)
      .collect();
    const active = args.status === 'active';
    let granted = 0;
    for (const mapping of mappings) {
      const existing = await ctx.db
        .query('entitlementGrants')
        .withIndex('by_user')
        .eq('userId', userId)
        .eq('entitlementId', mapping.entitlementId)
        .collect();
      if (existing.length > 0) {
        await ctx.db.patch('entitlementGrants', existing[0]._id, {
          active: active,
          activeUntil: expiresAt,
          source: storeTxnId,
        });
      } else {
        await ctx.db.insert('entitlementGrants', {
          userId: userId,
          entitlementId: mapping.entitlementId,
          active: active,
          activeUntil: expiresAt,
          source: storeTxnId,
        });
      }
      granted += 1;
    }
    return { transactionId: transactionId, deduped: false, grants: granted };
  },
});

// The notification/receipt trigger. The payload says "something happened";
// the action decides what is true and hands typed values to the mutation.
export const validateReceipt = defineAction({
  args: {
    productId: v.string(),
    store: v.string(),
    receipt: v.string(),
    environment: v.string(),
  },
  // Declared but unread by the stub — the grant the live adapter will use.
  uses: ['storeValidation'],
  writes: ['transactions', 'entitlementGrants'],
  result: results.value(v.object({
    storeTxnId: v.string(),
    expiresAt: v.integer(),
    deduped: v.boolean(),
  })),
  handler: async (ctx, args) => {
    const receipt = String(args.receipt ?? '').trim();
    if (!receipt) throw new Error('receipt is required');
    if (args.environment !== 'sandbox' && args.environment !== 'production') {
      throw new Error('environment must be sandbox or production');
    }

    // TODO(next slice): replace the derivation below with the real re-fetch.
    //   const key = ctx.secrets.storeValidation;
    //   const response = await ctx.fetch({ url: storeUrl, headers: [...key] });
    //   const state = JSON.parse(response.bodyText);
    // The payload is only a trigger: whatever comes back from the store is the
    // authoritative state, and nothing from `args.receipt` is committed.
    const now = ctx.runtime.now();
    const storeTxnId = args.store + ':' + receipt;
    const expiresAt = now + 2592000000; // ~30 days

    const commit = await ctx.runMutation('recordPurchase', {
      productId: args.productId,
      store: args.store,
      storeTxnId: storeTxnId,
      status: 'active',
      environment: args.environment,
      expiresAt: expiresAt,
    });
    return {
      storeTxnId: storeTxnId,
      expiresAt: expiresAt,
      deduped: commit.deduped === true,
    };
  },
});

// --- Expiry -------------------------------------------------------------------

// Sweep grants whose subscription window has closed. Runs unauthenticated
// under system authority, so it is scoped by by_active rather than by_user.
export const applyGrantExpiry = defineJsMutation({
  args: {},
  reads: ['entitlementGrants'],
  writes: ['entitlementGrants'],
  result: results.value(v.object({ expired: v.integer(), now: v.integer() })),
  handler: async (ctx) => {
    const now = ctx.runtime.now();
    const live = await ctx.db
      .query('entitlementGrants')
      .withIndex('by_active')
      .eq('active', true)
      .collect();
    let expired = 0;
    for (const grant of live) {
      const until = grant.activeUntil;
      // A grant with no activeUntil is perpetual (a non-consumable), so it is
      // never swept.
      if (until !== null && until !== undefined && until <= now) {
        await ctx.db.patch('entitlementGrants', grant._id, { active: false });
        expired += 1;
      }
    }
    return { expired: expired, now: now };
  },
});

// Cron targets an action, never a mutation; the action owns the commit call.
export const expireGrantsSweep = defineAction({
  args: {},
  writes: ['entitlementGrants'],
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
