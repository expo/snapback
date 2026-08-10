# EAS Payments — engine-first slice

A learning/prototype **vertical slice** of the EAS Payments Engine on Snapback,
built to the briefs in [`BRIEF.md`](./BRIEF.md) and
[`BRIEF-slices-2-3.md`](./BRIEF-slices-2-3.md). It is not production M1. It
proves both halves of the notification design end to end:

```
        store                                              developer
          |  notification (trigger only)                       ^
          v                                                    |
      action ---- ctx.fetch ----> store (authoritative state)  |
          |                                                    |
          v                                                    |
      mutation (one atomic commit, idempotent)                 |
          |                                                    |
          +--> entitlementGrants  --> live query (the app gates here)
          |
          +--> entitlementChanges --> pollChanges { userId, seq } ---+
          |                                                          |
          +--> jobs.enqueue -----> notifyDeveloper --- POST ---------+
                                   (retried; a hint, not the truth)
```

```
eas-payments/
  BRIEF.md, BRIEF-slices-2-3.md   # the build briefs
  demo.snapback.json              # demo manifest (surfaces, capabilities, gaps)
  snapback/
    schema.mjs                    # source-authored schema (the source of truth)
    functions.mjs                 # inline JS handlers, actions, cron
    seed.json                     # deterministic catalog seed
    generated/artifacts.json      # committed review manifest
  tests/acceptance/
    headless.mjs                  # required surface acceptance suite
    fake-store.mjs                # stand-in for Apple/Google/Stripe
    fake-developer.mjs            # stand-in for a customer's webhook endpoint
```

## The three design constraints

**The notification is a trigger, never a source of truth.** `validateReceipt`
takes a receipt, asks the store what is actually true over `ctx.fetch`, and
hands typed values to `recordPurchase`. Nothing from the payload is committed.
The `environment` argument is routing input only — it selects which store
endpoint to ask, exactly as Apple's sandbox and production endpoints differ —
and whatever the store answers is what gets stored. The acceptance proves this
by having the store answer `production` to a request that said `sandbox`.

The credential reaches the request through
`ctx.secrets.get('storeValidation').asBearer()`, granted by
`uses: ['storeValidation']`. Queries and mutations get no config surface at
all, and a wrong credential fails the action with no write.

**Entitlements are derived from transactions.** `transactions` holds raw store
facts; `entitlementGrants` is the answer computed from *all* of a user's
transactions via `productEntitlements`. The app asks `getEntitlements`, never
`listProducts`, when deciding whether a user may do something.

Derivation is not per-purchase assignment, and the difference is observable:
`pro_monthly` and `pro_annual` both grant `pro`, so a user holding both keeps
`pro` when one expires. One same-file helper (`deriveGrant`) computes this, and
both the purchase path and the notification path call it, so they cannot drift
into two different answers.

**A notification is a thin trigger.** `applyStoreState` takes
`{ userId, store, storeTxnId }` — no status, no expiry, no entitlement. It asks
the store what is true *now* and reconciles. That is what makes a replayed,
delayed, reordered, or forged-payload notification harmless: none of them can
assert state. Reconciling twice over the same store state writes nothing and
reports `changed: false`.

**Products carry per-platform ids and transactions carry an environment.**
`appleId` / `googleId` / `stripePriceId` live on the product; every transaction
is tagged `sandbox` or `production` so metering can exclude test rows later
without a backfill. Nothing consumes the tag yet.

## Idempotency and expiry

`recordPurchase` dedupes on `transactions.by_storeTxn`, so a re-delivered
notification finds the existing row and grants nothing a second time. The
acceptance proves this both at the mutation and through a replayed action.

`entitlementGrants.activeUntil` is the subscription window. There are two ways
a grant goes away, and they are independent:

- **The notification path** (`applyStoreState`) — the store says the
  transaction is now `expired` or `revoked`, and the reconcile revokes
  immediately. No scheduler involved.
- **The cron sweep** (`expireGrants` → `expireGrantsSweep` →
  `applyGrantExpiry`) — a window simply ran out and no notification arrived.

A grant with no `activeUntil` (a non-consumable) is perpetual and is never
swept.

## Consumables (slice 6)

`coins_100` is the case where re-purchase is normal, and it exercises the
derivation rule from the other side. The product is catalogued like any other,
but it has **no `productEntitlements` row** — so `deriveGrant` finds nothing to
justify, `applyProductEntitlements` recomputes nothing, and the purchase writes
a `transactions` row and stops.

Three consequences follow from that one absence, and the acceptance asserts each:

- **It grants no entitlement.** `getEntitlements` is unchanged across a
  consumable buy, including for a user who already holds `pro` and `plus`.
- **It appends nothing to the change feed.** `appendChange` is reached only when
  a grant actually moves, so a consumable is silent — and because the outbound
  ping is enqueued inside `appendChange`, it schedules no delivery either. A
  feed row here would be a false wake-up on every coin pack sold.
- **It is repeatable.** Each buy carries a distinct receipt, so a distinct
  `storeTxnId`, so a distinct row. Dedupe is keyed on the store's identity, not
  on the product, which is exactly why it still collapses a *re-delivered*
  consumable while admitting a genuine second purchase.

`listPurchases` is the read that exposes them: a user-scoped, projected audit of
store facts (`{ productId, store, storeTxnId, status, environment, createdAt }`)
with nothing derived in it. That split is deliberate — `getEntitlements` answers
"may this user do the thing", `listPurchases` answers "what did the store sell
them", and a consumable only ever appears in the second.

**We keep an audit, not a wallet.** Nothing here holds a balance. The demo
client counts `coins_100` rows and multiplies by 100; a real developer credits
coins on their own side. Holding the number ourselves would make us the
authority on a value no store could ever reconcile us against.

Fixture artifact: the fake store stamps every new receipt with
`expiresAt = now + 30d`, so these consumable transactions carry an expiry a real
coin pack would not have. It is inert — nothing derives a grant from them, so
nothing can expire.

## The lifecycle state model (slice 7)

Slices 1–6 treated a transaction as active or not. Real subscriptions have more
states than that, and the interesting ones are in the middle. `transactions.status`
is now a normalized vocabulary of seven:

| State | Access | Why it is not just "expired" |
| --- | --- | --- |
| `active` | **yes** | Paid up. Bounded by `expiresAt`. |
| `grace` | **yes** | Billing failed but the store is holding access open. Bounded by `graceUntil`. |
| `retry_hold` | no | Payment is failing and the store is still retrying. The subscription is **alive** — its `expiresAt` is already in the past — so a clock must never tear it down. |
| `paused` | no | The user deliberately paused (Google Play). `resumesAt` is a future **resume**, not a deadline. |
| `pending` | no | Payment started and has not cleared (SCA, slow ACH, Ask to Buy). It never granted access, so it has nothing to lose. |
| `expired` | no | The window closed and nobody is retrying. |
| `revoked` | no | Refunded or revoked by the store. The old `refunded` spelling migrated here. |

**Access-granting states are exactly `{active, grace}`**, and one predicate —
`grantsAccess` — is the only thing allowed to decide it.

Three consequences the acceptance proves:

- **Grace keeps access on past expiry.** A grace transaction's `expiresAt` is in
  the past and the user still has access, because the horizon that matters is
  `graceUntil`. A model keyed off `expiresAt` alone drops the user the moment
  billing fails, which is the outage this slice exists to prevent.
- **`retry_hold`, `paused`, and `pending` change only by re-fetch.** They are
  never time-expired. The sweep guards on state, not just on a date, and the
  acceptance proves each survives repeated sweeps by asserting the grant row is
  the **same `_id`** after recovery — if the sweep had deleted it, recovery would
  insert a new row.
- **Active outranks grace.** An entitlement backed by one paid-up product and one
  lapsing product reports `state: 'active'`, so a user whose payments are fine
  never receives a dunning message on behalf of a second product.

`entitlementGrants` gained `state: 'active' | 'grace' | null`, non-null exactly
when `active` is true. `activeUntil` stays one column — it is the *access
horizon*, whichever clock produced it — so an app gating on it never has to know
which store field it came from.

**The change key grew to `(active, activeUntil, state)`.** `state` had to join it
because an `active → grace` transition can move neither of the other two: when a
second product's grace window is the later horizon, the user keeps access with
the same `activeUntil` and only the reason changes. That is the most actionable
signal the feed carries ("this customer's payment is failing"), and a key of
`(active, activeUntil)` would have dropped it silently. The poll payload is
unchanged — still `{userId, seq}`, with no state in it.

### Known prototype gap: a swept grace window can be re-granted

Derivation is deliberately **time-agnostic**. `deriveGrant` reads states and
horizons but never compares them to the clock; the sweep is the single horizon
enforcer. That split is what makes the sweep meaningful and testable at all — a
purchase can be written with a past horizon and still grant access until
something sweeps.

The price is a real wrinkle. If the store still reports `grace` with a
`graceUntil` that has already passed — a self-contradictory document a real store
would have moved to `expired` — then a redundant `applyStoreState` re-derives the
access the sweep just retired, and the grant comes back until the next sweep.

It is bounded (one cron interval, 60s declared) and self-healing, and the
acceptance asserts **both halves** rather than hiding it: the re-grant happens,
and the next sweep undoes it. The clean fix is either a time-aware derivation
(which would make the sweep untestable without a movable clock) or recording the
horizon the sweep retired so only a strictly later one can re-grant. Neither is
in this slice.

## The outbound change feed

The mirror image of the notification rule. Just as we refuse to trust a store's
payload, we refuse to hand a developer state in a notification.

`entitlementChanges` gets one row per reconcile that moved a user's active set
— and only then. A no-op reconcile appends nothing. Each row is
`{ userId, seq, changedAt }`, and `pollChanges({ sinceSeq })` projects exactly
`{ userId, seq }`. The result contract is the enforcement, not a convention:
adding entitlement state to that query would fail validation rather than
quietly leak.

```
developer server                    Snapback
     |  pollChanges({ sinceSeq: 41 })   |
     |--------------------------------->|
     |  [{ userId: "u_jo", seq: 42 }]   |
     |<---------------------------------|
     |  getEntitlements (as u_jo)       |   <- they re-read the real answer
     |--------------------------------->|
```

**Cursor semantics are keyset, not "jump to the head."** Resume from the last
`seq` you received. The page is bounded at 100; advancing to a separately
sampled global maximum would silently skip whatever the page truncated. This is
a deliberate deviation from the brief's "plus the current max seq" — with a
bounded page, the last returned seq *is* the correct resume point.

All three writers — purchase, notification reconcile, and the expiry sweep —
mint from one counter, and the acceptance asserts the feed is ascending, dense,
and duplicate-free across all of them. The sweep can flip several users in one
commit, and each still gets a distinct `seq`, so a poller resuming mid-sweep
cannot lose the later users.

## Real delivery, with retry

`notifyDeveloper` performs a real `ctx.fetch` POST to a registered endpoint,
and it is **run by the durable job queue** rather than called inline. The
enqueue happens inside the same mutation that appends the feed row, so the two
land in one commit — a rolled-back reconcile provably schedules no delivery,
and the mutation receipt carries the `enqueues` entry as evidence.

The body is `{ userId, seq }`. A failing endpoint throws, which is how the
handler asks the queue for another attempt; `maxAttempts: 5` bounds the ladder.
`deliveries` records one row per *attempt*, so the ladder is inspectable after
the fact rather than only in the job's own state.

`idempotencyKey: 'change:<seq>'` means one delivery per feed position however
many times the enqueueing mutation is retried.

**The feed is authoritative; the ping is a hint.** If delivery gives up after
five attempts, the change is still in `entitlementChanges` and still pollable —
the acceptance asserts exactly that. The same reasoning lets a sweep that moves
more users than the queue's 16-enqueues-per-mutation limit drop the extra
pings without losing anything.

## Known prototype gap: the ping is authenticated, not signed

The POST carries `Authorization: Bearer <developerWebhookSecret>`. That proves
the *sender*; it does **not** bind the *body*. A real webhook wants an HMAC
over the payload so a receiver can detect tampering, and this build cannot
produce one: the handler-reachable host-op surface is `db.*`, `jobs.enqueue`,
`runtime.now/id/log`, `host.fetch`, `sequence.allocate`, `push.send`,
`membership.write`, and `permissions.requireRole` — no digest primitive.

The alternative would be hand-rolling SHA-256 in the inline-handler subset,
which refuses dynamic computed member access (`buf[i]`) and would make that
implementation both grotesque and slow. Hand-rolled crypto in a reference demo
is worse than an honest gap, so the gap is here instead.

Also missing for production: the registration path fences only on
`http://` / `https://`. A real one must refuse loopback and link-local targets,
or the webhook becomes an SSRF primitive.

## Known prototype gap: change-feed sequence allocation

`seq` is minted by reading the current maximum and adding one, inside the
mutation. Two mutations committing concurrently can read the same maximum and
mint the same `seq`, which would let a poller miss one of them. The acceptance
is sequential, so it never hits this.

A real deployment needs an atomic allocator. Snapback has one —
`ctx.sequence.allocate(counter, scopeId)`
([`guide/backend/sequences.md`](../../guide/backend/sequences.md), Experimental
on contributor-source local builds) — but it does not fit this feed as written:
**a mutation may allocate only once**, and the expiry sweep appends a row per
affected user in a single commit. Adopting it would mean restructuring the
sweep to one mutation per user.

`_version` is not a substitute either, for the same reason: those rows share a
commit, so they would share a version.

## Known prototype gap: reconcile authority

`reconcileTransaction` takes `userId` as an argument rather than reading
`ctx.auth.userId`, because a store notification arrives with no user session
attached. Under dev auth that makes it callable for any user id. It does refuse
to rewrite a transaction that belongs to someone else, but that is a
consistency check, not an authority fence. A real deployment must restrict this
mutation to system authority; the authoring surface offers only
`public | optional-user | authenticated` today.

## Run it

```sh
SNAPBACK_OUTBOUND_ACTIONS=1 node packages/snapback-codegen/index.mjs demos/eas-payments/snapback
node demos/eas-payments/tests/acceptance/headless.mjs
```

**Generate with `SNAPBACK_OUTBOUND_ACTIONS=1`.** The opt-in is a codegen input:
the same sources generate a different `inputsHash`, bundle hash, and descriptor
identity with it off. Generating without it produces artifacts that do not match
the committed `artifacts.json`. (Codegen does not *fail* without the flag here,
because `ctx.fetch` is a host-mediated call rather than the global `fetch`
identifier that trips `BUNDLE_UNSUPPORTED_FETCH` — so the mismatch is silent.)

The acceptance sets `SNAPBACK_OUTBOUND_ACTIONS=1` on the server child it spawns,
so the test command needs no prefix. Generation opting in does not grant the
running process network authority; the runtime is a separate boundary.

The suite starts its own OS-port-isolated in-memory server with the scheduler
inert (`cronDisabled: true`) and forces every tick itself, so no assertion
waits on wall-clock cadence. It also starts a fake store
(`tests/acceptance/fake-store.mjs`) on an OS-assigned port and sets the store
credential through the admin config API.

## Out of scope for this slice

Real store adapters, outbound webhooks, per-project isolation, sessions auth,
offerings/merchandising, Stripe/web, and metering. See `notClaiming` in
[`demo.snapback.json`](./demo.snapback.json).

## Next slices

1. Replace the stub with a real `ctx.fetch` to a fake local store, keyed
   through `ctx.secrets`/`uses`.
2. Add `applyStoreState` (the re-fetch-on-notification path) and a second
   product/entitlement.
3. Add an outbound "entitlement changed" trigger the developer polls.
