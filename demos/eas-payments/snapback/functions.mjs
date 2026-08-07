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

// --- Derivation ---------------------------------------------------------------

// "Entitlements are derived from transactions" is only true if there is one
// derivation. These are same-file function declarations, so codegen resolves
// and splices them into every handler that calls them — the purchase path and
// the notification path cannot drift into two different answers.
//
// @ref LLP 0108#same-file-helper-sharing--2026-07-31-normative — statically
//   reachable same-file declarations are spliced with the calling handler;
//   imports and outer consts still are not captured.

// What the user's transactions currently justify for one entitlement. Pure
// read: several products can grant the same entitlement (pro_monthly and
// pro_annual both grant `pro`), so losing one does not necessarily lose it.
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

  let active = false;
  let perpetual = false;
  let maxUntil = -1;
  let source = '';
  for (const txn of transactions) {
    if (txn.status !== 'active') continue;
    if (productIds.indexOf(txn.productId) < 0) continue;
    active = true;
    const until = txn.expiresAt === undefined || txn.expiresAt === null ? null : txn.expiresAt;
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
  const activeUntil = perpetual || maxUntil < 0 ? null : maxUntil;
  return { active: active, activeUntil: activeUntil, source: source };
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
      source: derived.source,
    });
    return true;
  }

  const current = existing[0];
  const currentUntil = current.activeUntil === undefined ? null : current.activeUntil;
  // Going inactive keeps the last transaction that justified the grant, so the
  // row still says why it was ever on.
  const nextSource = derived.source === '' ? current.source : derived.source;

  // What counts as a change is (active, activeUntil) — the answer the app
  // gates on. `source` is provenance: when one of two products backing the
  // same entitlement expires, the surviving one becomes the justification, and
  // the row should say so, but the user's access never moved. Writing that
  // without reporting a change is what keeps a redundant notification quiet.
  const accessMoved = current.active !== derived.active || currentUntil !== derived.activeUntil;
  const sourceMoved = current.source !== nextSource;
  if (!accessMoved && !sourceMoved) return false;
  await ctx.db.patch('entitlementGrants', current._id, {
    active: derived.active,
    activeUntil: derived.activeUntil,
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
  },
  reads: ['transactions', 'productEntitlements', 'entitlementGrants', 'entitlementChanges'],
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

    // Derive, never assign: the new transaction is now one input among the
    // user's transactions, and the grant is recomputed from all of them.
    const granted = await applyProductEntitlements(ctx, userId, args.productId);
    if (granted > 0) {
      await ctx.db.insert('entitlementChanges', {
        userId: userId,
        seq: (await readMaxChangeSeq(ctx)) + 1,
        changedAt: ctx.runtime.now(),
      });
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
  result: results.value(v.object({
    storeTxnId: v.string(),
    status: v.string(),
    environment: v.string(),
    expiresAt: v.integer(),
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
    const expiresAt = state.expiresAt;
    if (!storeTxnId) throw new Error('store returned no storeTxnId');
    if (status !== 'active' && status !== 'expired' && status !== 'refunded') {
      throw new Error('store returned an unknown status: ' + status);
    }
    if (environment !== 'sandbox' && environment !== 'production') {
      throw new Error('store returned an unknown environment: ' + environment);
    }
    if (typeof expiresAt !== 'number' || Math.floor(expiresAt) !== expiresAt) {
      throw new Error('store returned a non-integer expiresAt');
    }

    const commit = await ctx.runMutation('recordPurchase', {
      productId: args.productId,
      store: args.store,
      storeTxnId: storeTxnId,
      status: status,
      environment: environment,
      expiresAt: expiresAt,
    });
    return {
      storeTxnId: storeTxnId,
      status: status,
      environment: environment,
      expiresAt: expiresAt,
      deduped: commit.deduped === true,
    };
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
  },
  reads: ['transactions', 'productEntitlements', 'entitlementGrants', 'entitlementChanges'],
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
    const nextUntil = args.expiresAt === undefined ? null : args.expiresAt;

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
      if (row.status !== args.status || rowUntil !== nextUntil) {
        await ctx.db.patch('transactions', row._id, {
          status: args.status,
          expiresAt: nextUntil,
        });
        transactionChanged = true;
      }
    }

    const entitlementsChanged = await applyProductEntitlements(ctx, userId, productId);
    // Only an actual move in the active set reaches the feed. A redundant
    // notification updates nothing and says nothing.
    if (entitlementsChanged > 0) {
      await ctx.db.insert('entitlementChanges', {
        userId: userId,
        seq: (await readMaxChangeSeq(ctx)) + 1,
        changedAt: ctx.runtime.now(),
      });
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
    const expiresAt = state.expiresAt;
    if (status !== 'active' && status !== 'expired' && status !== 'refunded') {
      throw new Error('store returned an unknown status: ' + status);
    }
    if (environment !== 'sandbox' && environment !== 'production') {
      throw new Error('store returned an unknown environment: ' + environment);
    }
    if (!productId) throw new Error('store returned no productId');
    if (typeof expiresAt !== 'number' || Math.floor(expiresAt) !== expiresAt) {
      throw new Error('store returned a non-integer expiresAt');
    }

    const commit = await ctx.runMutation('reconcileTransaction', {
      userId: args.userId,
      productId: productId,
      store: args.store,
      storeTxnId: storeTxnId,
      status: status,
      environment: environment,
      expiresAt: expiresAt,
    });
    return {
      storeTxnId: storeTxnId,
      status: status,
      changed: commit.changed === true,
    };
  },
});

// --- Expiry -------------------------------------------------------------------

// Sweep grants whose subscription window has closed. Runs unauthenticated
// under system authority, so it is scoped by by_active rather than by_user.
export const applyGrantExpiry = defineJsMutation({
  args: {},
  reads: ['entitlementGrants', 'entitlementChanges'],
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
      const until = grant.activeUntil;
      // A grant with no activeUntil is perpetual (a non-consumable), so it is
      // never swept.
      if (until !== null && until !== undefined && until <= now) {
        await ctx.db.patch('entitlementGrants', grant._id, { active: false });
        expired += 1;
        // One feed row per user, not per grant: the developer's question is
        // "whose access moved", and they re-read the whole answer anyway.
        if (notified.indexOf(grant.userId) < 0) {
          notified.push(grant.userId);
          await ctx.db.insert('entitlementChanges', {
            userId: grant.userId,
            seq: nextSeq,
            changedAt: now,
          });
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

// Slice-4 stub for the outbound ping. Actions have no ctx.db, so the durable
// record goes through a mutation like every other write.
export const recordDeliveryAttempt = defineJsMutation({
  args: { userId: v.string(), seq: v.integer(), endpoint: v.string() },
  writes: ['deliveries'],
  result: results.value(v.id('deliveries')),
  handler: async (ctx, args) => ctx.db.insert('deliveries', {
    userId: args.userId,
    seq: args.seq,
    endpoint: args.endpoint,
    attemptedAt: ctx.runtime.now(),
  }),
});

// The "something changed for this user" ping. Deliberately NOT sent in this
// slice — the deliverable here is the poll read model, and a fake webhook
// target would prove nothing the fake store does not already prove.
//
// What matters architecturally is the payload shape: { userId, seq } and
// nothing else, so the developer must come back and read. Slice 5 replaces the
// recorded attempt below with a real signed POST plus retry.
export const notifyDeveloper = defineAction({
  args: {
    userId: v.string(),
    seq: v.integer(),
    endpoint: v.optional(v.string()),
  },
  writes: ['deliveries'],
  result: results.value(v.object({
    recorded: v.boolean(),
    endpoint: v.string(),
    payloadKeys: v.string(),
  })),
  handler: async (ctx, args) => {
    const endpoint = String(args.endpoint ?? '').trim()
      || 'https://developer.example/webhooks/entitlements';
    // SLICE 5 goes here:
    //   await ctx.fetch({ url: endpoint, method: 'POST',
    //     headers: { 'x-snapback-signature': sign(body) },
    //     body: JSON.stringify({ userId: args.userId, seq: args.seq }) });
    await ctx.runMutation('recordDeliveryAttempt', {
      userId: args.userId,
      seq: args.seq,
      endpoint: endpoint,
    });
    return { recorded: true, endpoint: endpoint, payloadKeys: 'userId,seq' };
  },
});

// What the stub recorded, so a suite can prove the ping carried no state.
export const listDeliveries = defineQuery({
  table: 'deliveries',
  args: {},
  order: [asc('seq')],
  index: 'by_seq',
});
