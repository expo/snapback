# EAS Payments — Engine slices 2–4 (Snapback build brief for Claude Code)

Purpose: extend the slice-1 vertical (`demos/eas-payments/`) toward the real notification-driven design. Slice 1 proved schema → mutation → action → live-query with a **stubbed** store. These slices replace the stub with a real fetch (2), add the re-fetch-on-notification path (3), and add the outbound change feed the developer polls (4). Still a prototype, not production M1: one backend, dev auth, a **fake local store**, no real Apple/Google/Stripe. Build them in order; each ends green before the next starts.

## Read first (in this repo)
The repo guide is the source of truth for exact API; this brief is the *what*, not the *how*.
- `AGENTS.md`, `guide/conventions.md` — ref-check, `@ref` annotations, `./ref-check` before push.
- `guide/backend/actions-and-fetch.md` — `ctx.fetch`, `ctx.secrets`, `uses`, `SNAPBACK_OUTBOUND_ACTIONS`. This is the core of slice 2.
- `guide/getting-started/your-first-backend.md`, `guide/testing/acceptance.md`.
- Keep mirroring `demos/todo/` structure and the headless harness.

## Design constraints (from the EAS Payments architecture)
- **Notification/receipt is a trigger** (decision 19). The action re-fetches the store's authoritative state, then commits via a mutation. Never mutate from the payload.
- **Entitlements are derived from transactions.** The app gates on entitlements, not products.
- **Every transaction carries `environment`** (sandbox|production); test transactions are excluded from metering later (carry the field now).
- Auth: dev mode (`ctx.auth.userId`). Sessions mode out of scope.

---

## Slice 2 — real `ctx.fetch` to a fake local store

Goal: `validateReceipt` stops fabricating the result and instead **calls out** to a fake store endpoint that returns the authoritative transaction state, keyed by a secret.

### The fake store
- Stand up a tiny local HTTP endpoint the action can reach (whatever the harness supports — a local handler, a fixture server, or the acceptance harness's own baseUrl). It takes `{ receipt, productId }` and returns `{ storeTxnId, status ('active'|'expired'), environment, expiresAt }`. Deterministic from the receipt string so tests are stable.
- Requires a key: the action reads it via `ctx.secrets` and declares `uses: [...]`. Wrong/missing key → the store returns 401 and `validateReceipt` fails cleanly (assert this).

### functions.mjs changes
- `validateReceipt` (action): replace the stub with a real `ctx.fetch` to the fake store behind `SNAPBACK_OUTBOUND_ACTIONS=1`. On success, `ctx.runMutation('recordPurchase', { ...authoritative state })`. The action still owns the outbound call + commit orchestration; the mutation stays pure.
- `recordPurchase` unchanged in shape; it now receives store-authoritative fields, not fabricated ones.

### acceptance
- Happy path: seed → `validateReceipt` with a receipt the fake store marks `active` → `getEntitlements` returns `pro` active.
- Auth path: bad secret → `validateReceipt` rejects, no grant written.
- Keep the existing 15 checks green.

### Run loop
```sh
SNAPBACK_OUTBOUND_ACTIONS=1 node packages/snapback-codegen/index.mjs demos/eas-payments/snapback
SNAPBACK_OUTBOUND_ACTIONS=1 node demos/eas-payments/tests/acceptance/headless.mjs
```

### Done when
A `validateReceipt` call fetches the fake store, and a store-reported `active` receipt grants `pro`; a bad key fails with no write.

---

## Slice 3 — `applyStoreState` (re-fetch-on-notification) + second entitlement

Goal: model decision 19 directly. A notification is a **thin trigger**: it carries only "something changed for this user/txn." The Engine re-fetches authoritative state and reconciles — it never trusts the payload.

### New second product/entitlement
- Add `pro_annual` (subscription) → same `pro` entitlement, **and** a second entitlement `plus` mapped from a new product `plus_monthly`. Enough to prove reconcile touches the right grants and leaves others alone.

### functions.mjs changes
- `applyStoreState` (action): args `{ userId, store, storeTxnId }` — a **trigger only**, no state in the args. It calls the fake store for that txn's *current* state, then `ctx.runMutation` to reconcile `entitlementGrants`:
  - store says `active` and later `expiresAt` → grant stays/extends,
  - store says `expired`/`refunded` → grant flips inactive.
- Reconcile mutation is idempotent: calling `applyStoreState` twice with the same store state is a no-op.
- The fake store must be able to **change its answer** for a given `storeTxnId` between calls (so a test can flip a txn to expired and re-notify).

### acceptance
- Grant `pro`, then flip the fake store's answer for that txn to `expired`, call `applyStoreState`, assert `pro` drops out of `getEntitlements` — **without** waiting on the expiry cron (this is the notification path, not the sweep).
- Assert a second user's `plus` grant is untouched by the first user's reconcile.
- Assert double-`applyStoreState` is a no-op.

### Done when
A store-state change reconciles the right user's entitlements via re-fetch (not payload), leaves unrelated grants alone, and is idempotent.

---

---

## Slice 4 — outbound "entitlement changed" trigger the developer polls (decision 20)

Goal: the symmetric other half of decision 19. When a user's entitlements change, the Engine emits a **thin outbound trigger** ("something changed for this user"). The developer does **not** get state in the notification — they poll our authoritative read to get it. No JWT, no payload state.

### The change feed
- Add a `entitlementChanges` table — `{ userId, seq, changedAt }`, index `by_seq` (monotonic). Every reconcile that alters a user's grants appends one row. `seq` is a per-backend monotonic counter (source it however the guide supports — a counter table or the framework's ordering; keep it deterministic for tests).
- Whichever mutations write `entitlementGrants` (`recordPurchase`, the slice-3 reconcile, the expiry sweep) also append to `entitlementChanges` **only when the active set actually changes** — a no-op reconcile writes nothing (reuse the slice-3 idempotency check).

### functions.mjs changes
- `pollChanges` — `defineQuery` args `{ sinceSeq }`: return `entitlementChanges` with `seq > sinceSeq`, ascending, plus the current max `seq`. This is what a developer's server polls. It returns **only** `{ userId, seq }` per change — no entitlement state.
- The developer then calls `getEntitlements` (or a server-read equivalent) for each changed `userId` to get authoritative state. Keep that read path as-is.

### The trigger itself (kept fake for the prototype)
- Model the outbound "ping" as a stubbed action `notifyDeveloper` — an `applyStoreState`-style outbound that, for the slice, just records that a ping *would* be sent (a `deliveries` row or a log), rather than hitting a real developer URL. Wire it behind `SNAPBACK_OUTBOUND_ACTIONS=1` so slice 5 can make it a real webhook. The point of this slice is the **poll read model + change feed**, not real delivery.

### acceptance
- Grant `pro` → `pollChanges({ sinceSeq: 0 })` returns one change for that user and the new max seq; a second poll with that seq returns empty.
- A no-op `applyStoreState` appends **no** change (assert seq unchanged).
- An expiry that flips a grant appends a change (the sweep participates in the feed).
- `pollChanges` never leaks entitlement state — assert the shape is `{ userId, seq }` only.

### Done when
A developer can poll `pollChanges` with a cursor, see exactly the users whose active set changed (no state, no dupes, no-ops excluded), and re-read authoritative entitlements themselves.

---

## Still out of scope (all slices)
Real Apple/Google/Stripe adapters, real signature/JWS verification, **real** outbound webhook delivery (slice 4 stubs the ping — the poll read model is the deliverable), per-project isolation, sessions auth, offerings/merchandising, metering. Keep it one backend, dev auth, fake store.

## Notes carried from slice 1
- Keep the JS-level `active` filter in `getEntitlements` (the index-level predicate wasn't confirmed safe for the expiring-grant refresh). Fine for prototype.
- Keep the Hermes `SNAPBACK_IBEX_CHECKOUT` bootstrap workaround handy for a clean rebuild.
- Demo stays out of `verify-local-proof` gating (prototype).

## After this
Slice 5 would make `notifyDeveloper` a real outbound webhook (real URL, retry, signing) — the last mile of decision 20. Hold unless we want it.
