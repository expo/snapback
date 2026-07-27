# 0023 — commerce: exploratory transaction kernel

## 2026-07-26 — trusted pricing and final-unit contention

LLP 0063's commerce pressure is much larger than an inventory mutation:
anonymous/SEO product delivery, payment-provider commands, signed webhooks,
jobs, audit, fulfillment, and hosted recovery all matter. LLPs 0069–0072 are
still Draft. I therefore isolated the useful transaction-authority seam rather
than building a fake checkout success path.

The local kernel creates a buyer-owned order from a server-held product,
copies price/version and exact money facts into one immutable order line, then
admits checkout using only the order id. The checkout mutation decrements
inventory and creates one active reservation plus one provider-not-called
payment intent in the same commit.

### What felt good

- The generated closed argument schema makes the central trust claim easy to
  inspect: `beginCheckout` cannot accept amount, currency, quantity, tax, or
  discount fields.
- Snapback's captured reads and commit-time validation are the right primitive
  for final-unit contention. Two handlers may read the last unit concurrently,
  but only one complete reservation/attempt commit survives; the loser cannot
  leave a partial row or decrement.
- Unique owner/idempotency and order/attempt indexes make sequential replay
  explicit without using a wall clock or scanning.
- `ctx.runtime.now()` and `ctx.runtime.id()` keep reservation time and
  provider-command identity server-authored and replay-stable.

### What remains awkward or missing

- The proposed money type is unsigned 64-bit, while the current JSON and
  JavaScript handler path preserves exact integers only through
  `Number.MAX_SAFE_INTEGER`. This demo detects overflow but cannot prove the
  full RFC domain.
- A mutation conflict is a truthful contention result, but a polished checkout
  API will need a bounded reconcile that re-reads current inventory and returns
  the stable unavailable outcome without turning invariant conflicts into blind
  retries.
- The payment intent is deliberately inert. There is no command lease,
  idempotent provider request, ambiguous outcome, exact link, signed event,
  projection, or fulfillment. Adding app-local versions before LLP 0070/0071
  acceptance would create the wrong authority.
- Anonymous catalog reads under local dev auth are not a hosted anonymous
  storefront. Contract/React SSR, metadata, client capability custody,
  sessions, deployment, TLS, backup, restore, and rollback remain absent.

Compared with React plus a hosted commerce backend or Stripe Checkout, Snapback
makes the inventory/order transaction very reviewable and testable. The missing
surface is also stark: the provider and operations half is a platform project,
not a few application handlers. This kernel prices that gap honestly while
preserving one reusable concurrency witness.
