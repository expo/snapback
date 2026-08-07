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
  transaction is now `expired` or `refunded`, and the reconcile revokes
  immediately. No scheduler involved.
- **The cron sweep** (`expireGrants` → `expireGrantsSweep` →
  `applyGrantExpiry`) — a window simply ran out and no notification arrived.

A grant with no `activeUntil` (a non-consumable) is perpetual and is never
swept.

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
