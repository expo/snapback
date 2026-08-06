# EAS Payments — Engine first slice (Snapback build brief for Claude Code)

Purpose: a learning/prototype **vertical slice** of the Payments Engine on Snapback. Mirror `demos/todo`. This is not production M1 — it proves schema → mutation → action(+fetch) → live-query end to end.

## Read first (in this repo)
The repo guide is the source of truth for exact API; this brief is the *what*, not the *how*.
- `AGENTS.md` and `guide/conventions.md` — follow these (ref-check, `@ref` annotations, `./ref-check` before push).
- `guide/getting-started/your-first-backend.md` — schema/functions/seed/codegen loop. Prefer the **inline `handler:`** paved form over the legacy `handlers.mjs` split.
- `guide/backend/actions-and-fetch.md` — actions, `ctx.secrets`, `uses`, `ctx.runMutation`, `SNAPBACK_OUTBOUND_ACTIONS`.
- `guide/backend/cron.md`, `guide/testing/acceptance.md`.
- Mirror `demos/todo/` for structure and the headless acceptance harness.

## Design constraints (from the EAS Payments architecture)
- **Notification/receipt is a trigger.** The action re-fetches the store's authoritative state, then commits via a mutation. Never mutate from the payload. (For this slice the store is **stubbed** — no real fetch yet; wire real fetch behind `SNAPBACK_OUTBOUND_ACTIONS=1` later.)
- **Entitlements are derived from transactions.** The app gates on entitlements, not products.
- **Products carry per-platform ids.** Tag each transaction with `environment` (sandbox|production); test transactions are excluded from metering later (just carry the field now).
- Auth: use **dev mode** for the slice (`ctx.auth.userId`); sessions mode is out of scope.

## Build it as `demos/eas-payments/snapback/`

### schema.mjs (tables)
- `products` — `{ productId, title, kind ('subscription'|'nonconsumable'|'consumable'), appleId?, googleId?, stripePriceId? }`, index `by_product` on `productId`.
- `entitlements` — `{ entitlementId, title }`.
- `productEntitlements` — `{ productId, entitlementId }`, index `by_product`.
- `transactions` — `{ userId, productId, store, storeTxnId, status, environment, expiresAt? }`, indexes `by_user`, `by_storeTxn` on `storeTxnId`.
- `entitlementGrants` (the derived read model) — `{ userId, entitlementId, active (boolean), activeUntil? , source }`, index `by_user`, `.sync()` so it backs the live query.

### seed.json
- One product `pro_monthly` (kind `subscription`), one entitlement `pro`, and the `pro_monthly → pro` mapping.

### functions.mjs
- `getEntitlements` — **live query** (`defineJsLiveQuery`): the current user's active `entitlementGrants` via `by_user`; `authScopeField: 'userId'`; declared result shape. This is the client read path.
- `listProducts` — declarative `defineQuery` over `products` (for a client to display).
- `recordPurchase` — **mutation** (`defineJsMutation`, `writes: ['transactions','entitlementGrants']`): insert a `transactions` row; look up `productEntitlements` for the product; upsert `entitlementGrants` for the user (active, with `activeUntil = expiresAt`). Dedupe on `storeTxn` index (idempotent).
- `validateReceipt` — **action** (`defineAction`): args `{ productId, store, receipt, environment }`. For the slice, **stub validation** (derive a `storeTxnId` and an `expiresAt` ~30 days out); then `ctx.runMutation('recordPurchase', {...})`. Leave a `uses: [...]` slot + a `ctx.fetch` TODO where the real store call goes.

### cron
- `expireGrants` — sweep `entitlementGrants` past `activeUntil`, set `active = false` via a mutation.

### tests/acceptance/headless.mjs (mirror demos/todo)
- reset + seed → call `validateReceipt` (or `recordPurchase`) for a user → assert `getEntitlements` returns `pro` active → advance time / run expiry → assert it flips off.

## Run loop
```sh
node packages/snapback-codegen/index.mjs demos/eas-payments/snapback
node demos/eas-payments/tests/acceptance/headless.mjs
# when the action does a real fetch:
SNAPBACK_OUTBOUND_ACTIONS=1 node packages/snapback-codegen/index.mjs demos/eas-payments/snapback
```

## Out of scope for this slice
Real store adapters (Apple/Google/Stripe), outbound webhooks, per-project isolation, sessions auth, offerings/merchandising, Stripe/web, metering. Stub the store; keep it one backend, dev auth.

## Done when
A `validateReceipt`/`recordPurchase` call makes `getEntitlements` return the `pro` entitlement active for that user, and the `expireGrants` cron flips it off past `activeUntil`.

## Next slices (after this works)
1. Replace the stub with a real `ctx.fetch` to a fake local store, with a key via `ctx.secrets`/`uses`.
2. Add `applyStoreState` (the re-fetch-on-notification path) and a second product/entitlement.
3. Add an outbound "entitlement changed" trigger the developer polls.
